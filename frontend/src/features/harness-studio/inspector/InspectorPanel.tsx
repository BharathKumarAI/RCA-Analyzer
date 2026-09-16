import React from 'react';
import { Code } from 'lucide-react';
import { AdkComponent, HarnessDefinition } from '../types/harness';
import { EnvironmentBindings } from './EnvironmentBindings';
import { COMPONENT_REGISTRY } from '../compiler/registry';

interface InspectorPanelProps {
  component: AdkComponent;
  harness: HarnessDefinition;
  onUpdateComponent: (updated: AdkComponent) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  component,
  harness,
  onUpdateComponent,
}) => {
  const isAgent = component.kind === 'agent';
  const editable = component.origin.editable;
  const isCustomPython = isAgent && component.origin.source === 'python';
  const registryEntry = isCustomPython ? COMPONENT_REGISTRY[component.id] : null;

  return (
    <div className="hs-panel-content">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 14, margin: 0, fontWeight: 600 }}>{component.name}</h3>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {isAgent ? component.agentClass : 'ADK 2.x Workflow'}
          </div>
          <div className="hs-inspector-provenance">
            <span>{component.origin.filePath || component.origin.source}</span>
            {!editable && <span className="hs-inspector-readonly">Read only</span>}
          </div>
        </div>

      </div>

      {/* Basic Properties */}
      {isAgent ? <div className="hs-form-group">
        <label className="hs-form-label">Component Name</label>
        <input type="text" className="hs-input" value={component.name} disabled={!editable} onChange={e => onUpdateComponent({ ...component, name: e.target.value })} />
      </div> : <div className="hs-inspector-resolved-details">
        <div className="hs-form-label">Resolved workflow component</div>
        <p>This node is compiled by the backend from the validated YAML graph.</p>
        {component.description && <div className="hs-form-hint">{component.description}</div>}
        <div className="hs-form-hint">Source: {component.origin.filePath || component.origin.source}</div>
        {'nodes' in component && <div className="hs-form-hint">Internal components: {component.nodes.length} · execution edges: {component.edges.length}</div>}
      </div>}

      {isAgent && (
        <>
          <div className="hs-form-group">
            <label className="hs-form-label">Model Profile</label>
            <input
              type="text"
              className="hs-input"
              value={component.modelProfile || ''}
              disabled={!editable}
              onChange={e => onUpdateComponent({ ...component, modelProfile: e.target.value, model: undefined })}
            />
            <div className="hs-form-hint">Resolved from the authorized backend model profile.</div>
          </div>
          <div className="hs-form-group">
            <label className="hs-form-label">Model Stage</label>
            <input aria-label="Model stage" type="text" className="hs-input" value={component.stageModel || ''} disabled={!editable}
              onChange={e => onUpdateComponent({ ...component, stageModel: e.target.value, model: undefined })} />
            <div className="hs-form-hint">Use a stage alias from the selected profile or an existing configured stage ID. The server validates availability on save.</div>
          </div>

          <div className="hs-form-group">
            <label className="hs-form-label">System Instruction</label>
            <textarea
              className="hs-textarea"
              value={component.instruction || ''}
              disabled={!editable}
              onChange={e => onUpdateComponent({ ...component, instruction: e.target.value })}
              placeholder="Enter agent instruction prompt..."
            />
          </div>

          {/* If Custom Python Agent */}
          {isCustomPython && registryEntry && (
            <div style={{ padding: 12, background: 'var(--surface-secondary)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
                <Code size={14} style={{ color: '#a78bfa' }} />
                <span>Python Implementation Reference</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
                {registryEntry.implementation.reference}
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <span className="badge badge-active" style={{ fontSize: 9 }}>Registry Approved</span>
                <span className="badge badge-neutral" style={{ fontSize: 9 }}>ADK {registryEntry.compatibility.adk}</span>
              </div>
            </div>
          )}

          {/* Subagents List */}
          {component.sub_agents && component.sub_agents.length > 0 && (
            <div className="hs-form-group">
              <label className="hs-form-label">Delegated Sub-Agents</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {component.sub_agents.map((sub, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 8px',
                      background: 'var(--surface-secondary)',
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                      {sub.type === 'config_path' && `config_path: ${sub.path}`}
                      {sub.type === 'code' && `code: ${sub.reference}`}
                      {sub.type === 'registry' && `registry: ${sub.componentId}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tools & Environment Bindings */}
          {component.tools && component.tools.length > 0 && (
            <div className="hs-form-group">
              <label className="hs-form-label">Active Tool Bindings</label>
              {component.tools.map(t => {
                const toolDef = harness.harness.tools.find(tool => tool.id === t.name) || {
                  id: t.name,
                  name: t.name,
                  scope: 'project' as const,
                  enabled: true,
                };
                const connector = harness.harness.connectors.find(c => c.connectorId === toolDef.requiredConnectorId);
                return <EnvironmentBindings key={t.name} tool={toolDef} connector={connector} />;
              })}
            </div>
          )}
        </>
      )}

    </div>
  );
};
