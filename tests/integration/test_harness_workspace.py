"""Configuration changes persist and cannot bypass independent review."""
import io
import zipfile

from fastapi.testclient import TestClient

from app.api.application import create_app
from tests.support import connectors, settings_for


def test_workspace_review_and_restart(tmp_path):
    settings, token = settings_for(tmp_path)
    headers = token("owner")
    with TestClient(create_app(settings, connectors=connectors())) as client:
        result = client.get('/api/v1/harness/workspace', headers=headers)
        assert result.status_code == 200, result.text
        workspace = result.json()
        assert workspace['diagnostics'] == []
        categories = {item['category'] for item in workspace['catalog']}
        assert {'Agents', 'Template Workflows', 'Graph Workflows', 'References', 'Capabilities',
                'Context & Memory', 'Optimization', 'Governance', 'Quality'} <= categories
        catalog = {item['id']: item for item in workspace['catalog']}
        assert catalog['context:session']['details']['max_context_chars'] == settings.max_context_chars
        assert catalog['quality:traces']['details']['execution_mode'] == settings.mode
        assert all(not item['editable'] or item['source'] in workspace['files'] for item in workspace['catalog'])
        assert workspace['compatibility']['adk_version'] == '2.9.0'
        assert any(n['id'] == 'rca_synthesizer' for n in workspace['graph']['nodes'])
        saved = client.put('/api/v1/harness/draft', headers=headers, json={
            'files': workspace['files'], 'capability': workspace['capability'],
            'expected_revision': workspace['revision']})
        assert saved.status_code == 200, saved.text
        draft = saved.json()
        did = draft['draft_id']
        assert draft['status'] == 'DRAFT'
        stale = client.put('/api/v1/harness/draft', headers=headers, json={
            'files': workspace['files'], 'capability': workspace['capability'],
            'draft_id': did, 'expected_revision': workspace['revision']})
        assert stale.status_code == 409
        pending = client.post(f'/api/v1/harness/drafts/{did}/submit', headers=headers,
            json={'expected_revision': draft['revision'], 'reason': 'Ready for review'})
        assert pending.status_code == 200, pending.text
        revision = pending.json()['revision']
        own = client.post(f'/api/v1/harness/drafts/{did}/approve', headers=headers,
            json={'expected_revision': revision, 'reason': 'Own review'})
        assert own.status_code == 403
        approved = client.post(f'/api/v1/harness/drafts/{did}/approve', headers=token('admin'),
            json={'expected_revision': revision, 'reason': 'Verified bounded workflow'})
        assert approved.status_code == 200, approved.text
        active = approved.json()
        assert active['active_revision'] == active['revision']
        archive = client.get(f'/api/v1/harness/export?draft_id={did}', headers=headers)
        assert archive.status_code == 200
        with zipfile.ZipFile(io.BytesIO(archive.content)) as source:
            assert source.read('rca/workflow.yaml').decode() == workspace['files']['rca/workflow.yaml']
    with TestClient(create_app(settings, connectors=connectors())) as client:
        restored = client.get('/api/v1/harness/workspace', headers=headers).json()
        assert restored['draft_id'] == did
        assert restored['revision'] == active['revision']
        revoked = client.post(f'/api/v1/harness/drafts/{did}/revoke', headers=token('admin'),
            json={'expected_revision': restored['revision'], 'reason': 'Retired workflow'})
        assert revoked.status_code == 200, revoked.text
        assert client.get('/api/v1/harness/workspace', headers=headers).json()['status'] == 'PLATFORM'


def test_invalid_sources_saved_but_never_submitted(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        headers = token('owner')
        workspace = client.get('/api/v1/harness/workspace', headers=headers).json()
        invalid = {'root_agent.yaml': 'name: [unterminated'}
        checked = client.post('/api/v1/harness/validate', headers=headers,
            json={'files': invalid, 'capability': 'incident_triage'})
        assert checked.status_code == 200
        assert checked.json()['diagnostics']
        saved = client.put('/api/v1/harness/draft', headers=headers, json={
            'files': invalid, 'capability': 'incident_triage', 'expected_revision': workspace['revision']})
        assert saved.status_code == 200, saved.text
        draft = saved.json()
        denied = client.post(f"/api/v1/harness/drafts/{draft['draft_id']}/submit", headers=headers,
            json={'expected_revision': draft['revision'], 'reason': 'Try invalid definition'})
        assert denied.status_code == 422
        assert client.get('/api/v1/harness/workspace', headers=headers).json()['status'] == 'PLATFORM'
        tamper = client.put('/api/v1/harness/draft', headers=headers, json={
            'files': invalid, 'capability': 'incident_triage', 'expected_revision': workspace['revision'],
            'tenant_id': 'another'})
        assert tamper.status_code == 422
        viewer = client.put('/api/v1/harness/draft', headers=token('viewer'), json={
            'files': invalid, 'capability': 'incident_triage', 'expected_revision': workspace['revision']})
        assert viewer.status_code == 403


def test_approved_workflow_executes_and_freezes_source(tmp_path):
    import json
    import yaml
    from tests.support import model_factory
    settings, token = settings_for(tmp_path, mode='live')
    with TestClient(create_app(settings, connectors=connectors(), model_factory=model_factory)) as client:
        headers = token('owner')
        workspace = client.get('/api/v1/harness/workspace', headers=headers).json()
        files = dict(workspace['files'])
        flow = yaml.safe_load(files['rca/workflow.yaml'])
        flow['nodes'].append({'id': 'additional_review', 'kind': 'agent', 'ref': 'agents/additional_review.yaml'})
        root = next(n for n in flow['nodes'] if n['id'] == flow['root'])
        root['children'].insert(-1, 'additional_review')
        files['rca/workflow.yaml'] = yaml.safe_dump(flow)
        files['agents/additional_review.yaml'] = yaml.safe_dump({
            'name': 'additional_review', 'instruction': 'Review captured evidence and report uncertainty.',
            'output_key': 'additional_notes',
            'x-rca': {'model_profile': 'balanced-investigation', 'stage_model': 'logs'}})
        saved = client.put('/api/v1/harness/draft', headers=headers, json={
            'files': files, 'capability': 'incident_triage', 'expected_revision': workspace['revision']})
        assert saved.status_code == 200, saved.text
        draft = saved.json()
        assert not draft['diagnostics'], draft['diagnostics']
        did = draft['draft_id']
        pending = client.post(f'/api/v1/harness/drafts/{did}/submit', headers=headers,
            json={'expected_revision': draft['revision'], 'reason': 'Review additional stage'}).json()
        approved = client.post(f'/api/v1/harness/drafts/{did}/approve', headers=token('admin'),
            json={'expected_revision': pending['revision'], 'reason': 'Approved bounded stage'})
        assert approved.status_code == 200, approved.text
        run = client.post('/api/v1/runs', headers=token(),
            json={'prompt': 'Investigate the incident', 'incident_id': 'SAMSON-101'})
        assert run.status_code == 200, run.text
        assert run.json()['status'] in {'SUCCEEDED', 'PARTIAL'}, run.text
        run_id = run.json()['run_id']
        trace = client.get(f'/api/v1/runs/{run_id}/trace', headers=token()).json()
        assert any(n['id'] == 'additional_review' for n in trace['graph']['nodes'])
        assert not any(n['id'] == 'file_investigator' for n in trace['graph']['nodes'])
        assert any(e['node_id'] == 'additional_review' and e['kind'] == 'completed' for e in trace['events'])
        source_graph = json.dumps(trace['graph'], sort_keys=True)
        client.post(f'/api/v1/harness/drafts/{did}/revoke', headers=token('admin'),
            json={'expected_revision': approved.json()['revision'], 'reason': 'Retire test stage'})
        historical = client.get(f'/api/v1/runs/{run_id}/trace', headers=token()).json()
        assert json.dumps(historical['graph'], sort_keys=True) == source_graph


def test_harness_delegation_cannot_be_bypassed(tmp_path):
    settings, token = settings_for(tmp_path)
    with TestClient(create_app(settings, connectors=connectors())) as client:
        service = client.app.state.harness_workspace
        policy = service.registry.inheritance.policy
        service.registry.inheritance.policy = policy.model_copy(update={
            'project_sections': tuple(s for s in policy.project_sections if s != 'harness')})
        headers = token('owner')
        workspace = client.get('/api/v1/harness/workspace', headers=headers).json()
        assert not workspace['permissions']['edit']
        saved = client.put('/api/v1/harness/draft', headers=headers, json={
            'files': workspace['files'], 'capability': workspace['capability'],
            'expected_revision': workspace['revision']})
        assert saved.status_code == 403
