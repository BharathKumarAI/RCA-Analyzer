import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const serviceSource = await fs.readFile(new URL('../frontend/src/services/chat.ts', import.meta.url), 'utf8');
const chatSource = await fs.readFile(new URL('../frontend/src/pages/Chat.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('Chat.tsx', chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['terminal', 'loadMoreConversations', 'loadEarlierTurns', 'upsertRun', 'send'].includes(node.name.getText(parsed))) {
    handlers.push(`globalThis.${node.name.getText(parsed)} = ${node.initializer.getText(parsed)};`);
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

test('chat service sends bounded timestamp/sequence cursors and cancellation signals', async () => {
  const calls = [];
  const context = { exports: {}, URLSearchParams, require: () => ({
    request: async (path, options) => { calls.push({ path, options }); return [{ id: 'newest' }, { id: 'oldest' }]; },
    mapRun: value => value,
  }) };
  vm.createContext(context);
  vm.runInContext(transpile(serviceSource), context);
  const api = context.exports;
  const controller = new AbortController();
  await api.fetchConversations();
  assert.equal(calls.at(-1).path, '/api/v1/chats?limit=50');
  await api.fetchConversations({ before: 123.456789, signal: controller.signal });
  assert.equal(calls.at(-1).path, '/api/v1/chats?limit=50&before=123.456789');
  assert.equal(calls.at(-1).options.signal, controller.signal);
  await api.fetchConversationMessages('chat / one', { before: 201, signal: controller.signal });
  assert.equal(calls.at(-1).path, '/api/v1/chats/chat%20%2F%20one/messages?limit=100&before=201');
  assert.equal(calls.at(-1).options.signal, controller.signal);
  const runs = await api.fetchConversationRuns('chat / one', { before: 0, signal: controller.signal });
  assert.equal(calls.at(-1).path, '/api/v1/chats/chat%20%2F%20one/runs?limit=50&before=0');
  assert.deepEqual(Array.from(runs, run => run.id), ['oldest', 'newest']);
});

function harness(overrides = {}) {
  const context = {
    AbortController, CHAT_PAGE_SIZE: 50, CHAT_MESSAGE_PAGE_SIZE: 100,
    mounted: { current: true }, operation: { current: 1 }, historyRequest: { current: null }, conversationRequest: { current: null },
    loading: false, busy: false, chatId: 'chat-1', historyHasMore: true, runsHasMore: true, messagesHasMore: true,
    knowledgeSelection: { environmentId: '', documentIds: [] },
    conversations: [{ chat_id: 'new', created_at: 100.5, title: 'Current title' }],
    runs: [{ id: 'new-run', raw: { created_at: 100.123456, revision: 2 } }],
    messages: [{ id: 'new-message', sequence: 201 }],
    errorText: error => error.message,
    fetchConversations: async () => [], fetchConversationRuns: async () => [], fetchConversationMessages: async () => [],
    ...overrides,
  };
  for (const state of ['conversations', 'historyHasMore', 'historyLoading', 'historyError', 'runs', 'messages', 'runsHasMore', 'messagesHasMore', 'olderLoading', 'olderError']) {
    context[`set${state[0].toUpperCase()}${state.slice(1)}`] = value => { context[state] = typeof value === 'function' ? value(context[state]) : value; };
  }
  vm.createContext(context);
  vm.runInContext(transpile(handlers.join('\n')), context);
  return context;
}

test('earlier history keeps refreshed records, uses exact independent cursors, and stops at the end', async () => {
  const calls = [];
  const state = harness({
    fetchConversationRuns: async (id, options) => { calls.push(['runs', id, options]); return [{ id: 'old-run', raw: { created_at: 1 } }, { id: 'new-run', raw: { revision: 1 } }]; },
    fetchConversationMessages: async (id, options) => { calls.push(['messages', id, options]); return [{ id: 'old-message', sequence: 1 }, { id: 'new-message', sequence: 201 }]; },
  });
  await state.loadEarlierTurns();
  assert.equal(calls[0][2].before, 100.123456, 'Timestamp must retain sub-millisecond precision');
  assert.equal(calls[1][2].before, 201);
  assert.equal(calls[0][2].signal, calls[1][2].signal);
  assert.deepEqual(Array.from(state.runs, item => item.id), ['old-run', 'new-run']);
  assert.equal(state.runs[1].raw.revision, 2, 'Older responses must not replace live status');
  assert.deepEqual(Array.from(state.messages, item => item.id), ['old-message', 'new-message']);
  assert.equal(state.runsHasMore, false);
  assert.equal(state.messagesHasMore, false);
  await state.loadEarlierTurns();
  assert.equal(calls.length, 2, 'An exhausted conversation must not issue another page request');
});

test('partial page failure preserves both cursors and supports retry', async () => {
  let failed = true;
  const state = harness({
    fetchConversationRuns: async () => [{ id: 'old-run', raw: { created_at: 1 } }],
    fetchConversationMessages: async () => { if (failed) throw new Error('Connection lost'); return []; },
  });
  await state.loadEarlierTurns();
  assert.equal(state.olderError, 'Connection lost');
  assert.equal(state.runs.length, 1);
  assert.equal(state.messages.length, 1);
  assert.equal(state.runsHasMore, true);
  assert.equal(state.messagesHasMore, true);
  assert.equal(state.olderLoading, false);
  failed = false;
  await state.loadEarlierTurns();
  assert.equal(state.olderError, null);
  assert.equal(state.runs.length, 2);
});

test('double clicks and responses after conversation change cannot duplicate or contaminate history', async () => {
  let resolvePage;
  let requests = 0;
  const state = harness({ messagesHasMore: false,
    fetchConversationRuns: () => { requests++; return new Promise(resolve => { resolvePage = resolve; }); },
  });
  const pending = state.loadEarlierTurns();
  await state.loadEarlierTurns();
  assert.equal(requests, 1);
  state.operation.current++;
  state.conversationRequest.current.abort();
  state.conversationRequest.current = new AbortController();
  state.runs = [{ id: 'different-chat' }];
  resolvePage([{ id: 'old-run' }]);
  await pending;
  assert.deepEqual(Array.from(state.runs, item => item.id), ['different-chat']);
  assert.notEqual(state.conversationRequest.current, null, 'An old finalizer must not clear the next request');
});

test('conversation pages preserve titles and newly created chats while loading, then stop', async () => {
  let resolvePage;
  let requests = 0;
  const state = harness({ fetchConversations: options => {
    requests++;
    assert.equal(options.before, 100.5);
    return new Promise(resolve => { resolvePage = resolve; });
  } });
  const pending = state.loadMoreConversations();
  await state.loadMoreConversations();
  state.conversations.unshift({ chat_id: 'created-during-load', created_at: 200 });
  resolvePage([{ chat_id: 'new', title: 'Stale title' }, { chat_id: 'old', created_at: 1 }]);
  await pending;
  assert.equal(requests, 1);
  assert.deepEqual(Array.from(state.conversations, item => item.chat_id), ['created-during-load', 'new', 'old']);
  assert.equal(state.conversations[1].title, 'Current title');
  assert.equal(state.historyHasMore, false);
  assert.equal(state.historyLoading, false);
});

test('conversation-list errors remain retryable and disposed page responses are ignored', async () => {
  const state = harness({ fetchConversations: async () => { throw new Error('Temporary failure'); } });
  await state.loadMoreConversations();
  assert.equal(state.historyError, 'Temporary failure');
  assert.equal(state.historyHasMore, true);
  assert.equal(state.historyLoading, false);
  let resolvePage;
  state.fetchConversations = () => new Promise(resolve => { resolvePage = resolve; });
  const pending = state.loadMoreConversations();
  state.mounted.current = false;
  state.historyRequest.current.abort();
  resolvePage([{ chat_id: 'must-not-appear' }]);
  await pending;
  assert.equal(state.conversations.length, 1);
});

function sendHarness(overrides = {}) {
  const state = harness({
    runs: [], messages: [], files: [], retainedAttachmentIds: [], question: 'Investigate checkout', capability: 'incident_triage',
    config: { file_limits: { max_files: 5, allowed_extensions: ['.txt'], max_file_bytes: 1000 }, execution: { max_upload_batch_bytes: 5000 } },
    connectorScope: { ready: true, selections: { jira: { instance_id: 'project-jira', environment_id: 'production' } } },
    controller: { current: null }, currentRun: { current: null }, composer: { current: null },
    pendingAttempt: { current: null }, submissionInFlight: { current: false },
    crypto: { randomUUID: () => 'request-key' }, active: () => false,
    onRunUpdated() {}, readable: value => value,
    mapRun: value => ({ id: value.run_id, status: value.status === 'SUCCEEDED' ? 'COMPLETED' : value.status, raw: value }),
    streamStudioRun: async () => {},
    resolveChatQuestion: async () => ({ status: 'ready', capability: 'incident_triage', message: 'Ready' }),
    loadRunConnectorGroups: async () => [], connectorSelectionsReady: () => true,
    ...overrides,
  });
  for (const name of ['error', 'question', 'busy', 'events', 'evidence', 'pendingQuestion', 'phase', 'retainedAttachmentIds', 'files', 'detailRevision', 'capability', 'stopping', 'chatId', 'selectedRun']) {
    state[`set${name[0].toUpperCase()}${name.slice(1)}`] = value => { state[name] = typeof value === 'function' ? value(state[name]) : value; };
  }
  return state;
}

test('sending captures source choices with the request and retains uploaded files during source-selection pause', async () => {
  let releaseUpload;
  let submitted;
  const explicit = sendHarness({
    files: [{ name: 'incident.txt', size: 100 }],
    uploadInvestigationFiles: () => new Promise(resolve => { releaseUpload = resolve; }),
    streamStudioRun: async (...args) => { submitted = args; },
  });
  const sending = explicit.send({ preventDefault() {} });
  explicit.connectorScope.selections.jira = { instance_id: 'must-not-change-running-request' };
  releaseUpload({ attachments: [{ attachment_id: 'uploaded-file' }] });
  await sending;
  assert.equal(submitted[0], 'incident_triage');
  assert.equal(submitted[1], 'Investigate checkout');
  assert.equal(submitted[4].connectorSelections.jira.instance_id, 'project-jira');
  assert.equal(submitted[4].connectorSelections.jira.environment_id, 'production');
  assert.deepEqual(Array.from(submitted[4].attachmentIds), ['uploaded-file']);
  assert.equal(submitted[4].idempotencyKey, 'request-key');

  let runsStarted = 0;
  const automatic = sendHarness({
    capability: '', connectorScope: { ready: true, selections: {} }, files: [{ name: 'incident.txt', size: 100 }],
    uploadInvestigationFiles: async () => ({ attachments: [{ attachment_id: 'retained-file' }] }),
    connectorSelectionsReady: () => false,
    streamStudioRun: async () => { runsStarted++; },
  });
  await automatic.send({ preventDefault() {} });
  assert.equal(runsStarted, 0);
  assert.equal(automatic.capability, 'incident_triage');
  assert.equal(automatic.question, 'Investigate checkout');
  assert.deepEqual(Array.from(automatic.retainedAttachmentIds), ['retained-file']);
  assert.equal(automatic.files.length, 0, 'Retry must reuse the recorded upload instead of uploading twice');
  assert.match(automatic.error, /Choose the sources/);
  assert.equal(automatic.busy, false);
});

test('unready source settings prevent submission and clarification refresh preserves older messages', async () => {
  let requests = 0;
  const blocked = sendHarness({ connectorScope: { ready: false, selections: {} }, streamStudioRun: async () => { requests++; } });
  await blocked.send({ preventDefault() {} });
  assert.equal(requests, 0);
  assert.equal(blocked.question, 'Investigate checkout');
  const clarification = sendHarness({ capability: '', messages: [{ id: 'older-message', sequence: 1 }],
    resolveChatQuestion: async () => ({ status: 'clarification', capability: null }),
    fetchConversationMessages: async () => [{ id: 'latest-message', sequence: 201 }],
  });
  await clarification.send({ preventDefault() {} });
  assert.deepEqual(Array.from(clarification.messages, item => item.id), ['older-message', 'latest-message']);
});

test('uncertain identical retries reuse their key; edited input and confirmed terminal results start a new attempt', async () => {
  let sequence = 0;
  const keys = [];
  const state = sendHarness({ crypto: { randomUUID: () => `key-${++sequence}` },
    streamStudioRun: async (...args) => { keys.push(args[4].idempotencyKey); throw new Error('Connection lost before response'); },
  });
  await state.send({ preventDefault() {} });
  assert.equal(state.question, 'Investigate checkout');
  await state.send({ preventDefault() {} });
  assert.deepEqual(keys, ['key-1', 'key-1']);
  state.question = 'Investigate payments';
  await state.send({ preventDefault() {} });
  assert.equal(keys.at(-1), 'key-2');
  state.connectorScope.selections = { jira: { instance_id: 'project-jira', environment_id: 'staging' } };
  await state.send({ preventDefault() {} });
  assert.equal(keys.at(-1), 'key-3');
  state.streamStudioRun = async (_capability, _prompt, onEvent, _signal, options) => {
    keys.push(options.idempotencyKey);
    onEvent({ type: 'complete', data: { run_id: 'saved-run', status: 'SUCCEEDED' } });
  };
  await state.send({ preventDefault() {} });
  assert.equal(keys.at(-1), 'key-3');
  assert.equal(state.pendingAttempt.current, null);
  state.question = 'Investigate payments';
  state.capability = 'incident_triage';
  await state.send({ preventDefault() {} });
  assert.equal(keys.at(-1), 'key-4');
});

test('submission lock prevents a second request before React applies busy state', async () => {
  let release;
  let requests = 0;
  const state = sendHarness({ streamStudioRun: async () => { requests++; await new Promise(resolve => { release = resolve; }); } });
  const pending = state.send({ preventDefault() {} });
  state.busy = false;
  state.question = 'Investigate checkout';
  await state.send({ preventDefault() {} });
  assert.equal(requests, 1);
  release();
  await pending;
  assert.equal(state.submissionInFlight.current, false);
});
