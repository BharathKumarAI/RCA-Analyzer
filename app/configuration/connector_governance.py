"""Persistent connector field policy shared by admin, project forms and execution."""

import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.configuration.parameters import ParameterConflict, definitions, overrides, system_configurations
from app.identity.principals import Role

Tier = Literal['platform_only', 'project_locked', 'project_editable']
# Identity and credential routing always require platform authority, regardless of visibility.
PROTECTED = frozenset({'endpoint', 'credentials', 'auth_type', 'mcp_configuration', 'access_mode', 'environment_connections', 'service_user', 'host', 'port', 'username', 'private_key_ref', 'known_hosts_ref'})
ALIASES = {
    'external_resource': ('project_key', 'index', 'space_key', 'topic', 'topics', 'path', 'log_path', 'namespace'),
    'max_window_seconds': ('search_window_seconds',),
    'custom_field_mapping': ('custom_field_mappings',),
    'bindings': ('environment_mappings',),
    'environment_dependency': ('environment_dependent',),
}
COMMON = {
    'endpoint': 'Connection endpoint', 'credentials': 'Credential references', 'auth_type': 'Authentication profile',
    'mcp_configuration': 'MCP configuration', 'access_mode': 'Connection routing',
    'environment_connections': 'Environment connections', 'service_user': 'Service account',
    'external_resource': 'Authorized resource scope', 'bindings': 'Environment assignments',
    'owner': 'Owner', 'description': 'Description', 'tags': 'Tags', 'usage': 'Usage',
    'max_results': 'Maximum results',
}


class GovernanceChanges(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=0)
    fields: dict[str, Tier] = Field(min_length=1, max_length=100)


def field_catalog(template):
    fields = {f['variable_name']: dict(f) for f in template.get('parameter_fields', [])}
    for name, label in COMMON.items():
        fields.setdefault(name, dict(variable_name=name, label=label, description=label, value_type='json',
                                    default_value=None, nullable=True, default_source='none',
                                    visible_in_project=name not in PROTECTED, allow_project_override=name not in PROTECTED,
                                    ownership='platform_locked' if name in PROTECTED else 'project_override_allowed'))
    for name, label in {'rate_limit': 'Rate limit', 'retry_attempts': 'Retry attempts', 'retry_backoff': 'Retry backoff', 'ui_base_url': 'Presentation URL', 'protocol': 'Transport'}.items():
        fields.setdefault(name, dict(variable_name=name, label=label, description='Declared by the platform connector configuration.',
            value_type='json', default_value=None, nullable=True, default_source='none', visible_in_project=True,
            allow_project_override=False, ownership='derived'))
    adapter = template.get('provider_adapter_id') or template.get('type')
    extras = {'itsm': {'issue_types': 'Issue types'}, 'unix': {'max_tail_bytes': 'Maximum tail bytes'}}.get(adapter, {})
    for name, label in extras.items():
        fields.setdefault(name, dict(variable_name=name, label=label, description=label, value_type='json',
            default_value=None, nullable=True, default_source='none', visible_in_project=True,
            allow_project_override=True, ownership='project_override_allowed'))
    for profile in template.get('auth_profiles', []):
        for name in (*profile.get('required_fields', []), *profile.get('optional_fields', [])):
            fields.setdefault(name, dict(variable_name=name, label=name.replace('_', ' ').capitalize(),
                description='Authentication field; credential values remain protected.', value_type='json', default_value=None,
                nullable=True, default_source='none', visible_in_project=False, allow_project_override=False,
                ownership='platform_locked', credential_field=True))
    return fields


def tier(field):
    if field.get('visible_in_project') is False:
        return 'platform_only'
    return 'project_editable' if field.get('allow_project_override', True) and field.get('ownership') != 'platform_locked' else 'project_locked'


async def read_policies(engine, tenant):
    async with engine.connect() as c:
        rows = (await c.execute(select(system_configurations).where(
            system_configurations.c.tenant_id == tenant,
            system_configurations.c.config_type == 'connector_field_governance',
        ))).mappings().all()
    return {r['config_key']: r for r in rows}


def project_template(template, policies):
    result = dict(template)
    key = template.get('system_name') or template.get('template_id')
    record = policies.get(key, {})
    choices = record.get('content_json', {})
    fields = field_catalog(template)
    for name, field in fields.items():
        canonical = next((key for key, aliases in ALIASES.items() if name in aliases), name)
        selected = choices.get(canonical, choices.get(name, tier(field)))
        field.update(visible_in_project=selected != 'platform_only', allow_project_override=selected == 'project_editable')
        if (canonical in choices or name in choices) and field.get('ownership') not in {'derived', 'secret_reference'}:
            field['ownership'] = 'project_override_allowed' if selected == 'project_editable' else 'platform_locked'
    result['parameter_fields'] = list(fields.values())
    result['governance_revision'] = record.get('revision', 0)
    result['field_governance'] = [dict(variable_name=n, label=f.get('label') or n, tier=tier(f),
        editable_allowed=n not in PROTECTED and not f.get('credential_field') and f.get('sensitivity') != 'secret_reference' and f.get('ownership') != 'derived',
        description=f.get('description', '')) for n, f in fields.items()]
    return result


async def save_policy(store, principal, template, payload):
    if Role.PLATFORM_ADMIN not in principal.roles:
        raise PermissionError('Platform administrator required')
    fields = field_catalog(template)
    if payload.fields.keys() - fields.keys():
        raise ValueError('Unknown connector field')
    for name, selected in payload.fields.items():
        field = fields[name]
        if selected == 'project_editable' and (name in PROTECTED or field.get('credential_field') or field.get('sensitivity') == 'secret_reference' or field.get('ownership') == 'derived'):
            raise ValueError('Connection identities, credentials and derived fields require platform authority')
    key = template.get('system_name') or template['template_id']
    scope = (system_configurations.c.tenant_id == principal.tenant_id,
             system_configurations.c.config_type == 'connector_field_governance', system_configurations.c.config_key == key)
    try:
        async with store.engine.begin() as c:
            row = (await c.execute(select(system_configurations).where(*scope).with_for_update())).mappings().first()
            if (row['revision'] if row else 0) != payload.expected_revision:
                raise ParameterConflict('Field policy changed; reload before saving')
            changes = {next((key for key, aliases in ALIASES.items() if name in aliases), name): value for name, value in payload.fields.items()}
            choices = dict(row['content_json'] if row else {}) | changes
            revision = payload.expected_revision + 1
            values = dict(content_json=choices, revision=revision, updated_at=time.time())
            if row:
                await c.execute(update(system_configurations).where(*scope).values(**values))
            else:
                await c.execute(insert(system_configurations).values(tenant_id=principal.tenant_id,
                    config_type='connector_field_governance', config_key=key, **values))
            affected = dict(changes)
            for name, selected in changes.items():
                affected.update({alias: selected for alias in ALIASES.get(name, ())})
            for name, selected in sorted(affected.items()):
                dscope = (definitions.c.tenant_id == principal.tenant_id, definitions.c.tool == key, definitions.c.variable_name == name)
                await c.execute(select(definitions).where(*dscope).with_for_update())
                # Removing delegation also removes obsolete project parameter overrides atomically.
                if selected != 'project_editable':
                    await c.execute(delete(overrides).where(overrides.c.tenant_id == principal.tenant_id,
                        overrides.c.tool == key, overrides.c.variable_name == name))
                await c.execute(update(definitions).where(*dscope).values(
                    scope={'platform_only': 'platform_only', 'project_locked': 'platform', 'project_editable': 'project'}[selected],
                    allow_project_override=selected == 'project_editable',
                    ownership='project_override_allowed' if selected == 'project_editable' else 'platform_locked',
                    revision=definitions.c.revision + 1, updated_at=time.time()))
                await store.record(c, principal, key, name, 'field_policy', revision)
    except IntegrityError:
        raise ParameterConflict('Field policy changed; reload before saving') from None
    return {'revision': revision}


async def governed_templates(engine, tenant, templates):
    policies = await read_policies(engine, tenant)
    result = []
    for template in templates:
        data = project_template(template.model_dump(mode='json'), policies)
        declared = {f.variable_name for f in template.parameter_fields}
        # Supplemental instance fields are UI/save contracts, not shared parameter defaults.
        result.append(template.model_copy(update={'parameter_fields': tuple(
            type(template.parameter_fields[0]).model_validate(f) for f in data['parameter_fields']
            if f['variable_name'] in declared
        )}) if declared else template)
    return tuple(result)
