"""Studio inventory projected from the same effective configuration as execution."""
from dataclasses import asdict

from app.capabilities.resolver import CapabilityResolver
from app.configuration.harness_bundles import CatalogItem


def workspace_catalog(service, principal, source, graph, runtime, editable):
    items = []

    def add(id, kind, label, category, description, path, details, enabled=True, can_edit=False):
        items.append(CatalogItem(id=id, kind=kind, label=label, category=category,
            description=description, source=path, details=details, enabled=enabled, editable=can_edit))

    for node in graph.nodes:
        category = ('Graph Workflows' if node.kind in {'sequence', 'parallel', 'graph', 'join'}
                    else 'Agents' if node.kind in {'agent', 'builtin'}
                    else 'Skills' if node.kind == 'skill'
                    else 'Governance' if node.kind == 'policy' else 'References')
        add(node.id, node.kind, node.label, category, node.reason or 'Resolved workflow component',
            node.source, {**node.details, 'graph_id': node.id, 'reason': node.reason}, node.enabled,
            editable and node.editable and node.source in source.files)
    for path in source.files:
        add('file:' + path, 'file', path, 'References', 'Preserved bundle source', path,
            {'bytes': len(source.files[path].encode()), 'executable': False}, can_edit=editable)
    for kind, native in [('sequence', 'Workflow'), ('parallel', 'Workflow + JoinNode'), ('graph', 'Workflow')]:
        add('template:' + kind, kind, kind.title(), 'Template Workflows',
            'Supported by the backend workflow compiler; configure children in workflow YAML',
            'rca/workflow.yaml', {'native_class': native, 'definition_version': 1,
                'manage_source': 'rca/workflow.yaml', 'implementation': 'app/configuration/workflow.py'},
            can_edit=editable and 'rca/workflow.yaml' in source.files)
    for definition in service.registry.list_all():
        resolved = CapabilityResolver(service.registry).resolve(definition.id, principal, check_health=False)
        if not resolved.is_authorized:
            continue
        cap = resolved.capability
        add('capability:' + cap.id, 'capability', cap.id, 'Capabilities',
            'Effective capability after platform and project inheritance',
            'capabilities/' + cap.id + '.yaml', cap.model_dump(mode='json'), cap.enabled)
    settings = runtime['settings']
    add('context:session', 'session', 'ADK session and run state', 'Context & Memory',
        'Persisted session state and bounded evidence context for each run', 'app/runtime/runner.py',
        {'max_context_chars': settings.max_context_chars, 'retention_days': settings.retention_days,
         'long_term_memory': False, 'manage_source': 'config/runtime.yaml'})
    limits = asdict(service.platform.file_limits)
    limits['allowed_extensions'] = sorted(limits['allowed_extensions'])
    add('context:attachments', 'attachments', 'Local attachment context', 'Context & Memory',
        'Bounded local parsing; images contribute OCR text only', 'config/file_processing.yaml',
        {**limits, 'attachment_ttl_seconds': settings.attachment_ttl_seconds}, runtime['workflow'].attachments)
    optimization = service.platform.optimization
    add('optimization:configuration', 'optimization', 'Prompt and skill optimization', 'Optimization',
        'Curated train/holdout evaluation with independent approval', 'config/optimization.yaml',
        {**optimization.model_dump(mode='json'), 'api': '/api/v1/optimizations',
         'datasets_api': '/api/v1/optimization-datasets'}, optimization.enabled)
    add('governance:limits', 'policy', 'Execution limits', 'Governance',
        'Effective server-enforced run limits', 'config/runtime.yaml',
        {name: getattr(settings, name) for name in ('run_timeout_seconds', 'max_llm_calls',
            'max_parallel_models', 'max_evidence_items', 'max_evidence_chars')}
        | {'max_tool_calls': runtime['max_tool_calls'], 'workflow': runtime['workflow'].model_dump(mode='json')})
    add('governance:approval', 'policy', 'Independent bundle review', 'Governance',
        'Authors submit drafts; a different administrator approves activation',
        'app/configuration/harness_workspace.py',
        {'delegated_sections': list(service.registry.inheritance.policy.project_sections),
         'review_required': True, 'immutable_run_snapshot': True})
    add('quality:evidence', 'validation', 'Evidence and citation validation', 'Quality',
        'Backend validates synthesis against persisted evidence before returning findings',
        'app/runtime/runner.py', {'max_evidence_items': settings.max_evidence_items,
            'max_evidence_chars': settings.max_evidence_chars})
    add('quality:traces', 'trace', 'Recorded execution traces', 'Quality',
        'Recorded events and measured usage only; historical runs may have no detailed trace',
        'app/persistence/run_events.py', {'api': '/api/v1/runs/{run_id}/trace', 'execution_mode': settings.mode})
    # Reuse the existing admin editors; platform-owned values remain read-only here.
    management_pages = {"capability": "capabilities", "model": "parameters", "connector": "tools",
        "tool": "tools", "skill": "skills", "policy": "policy", "session": "runtime",
        "attachments": "runtime", "optimization": "optimization", "trace": "runtime"}
    for item in items:
        if item.kind in management_pages:
            item.details["manage_page"] = management_pages[item.kind]
    return items
