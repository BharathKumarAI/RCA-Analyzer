import React, { useState } from 'react';
import {
  Bot,
  Cpu,
  Workflow,
  Sparkles,
  Shield,
  Layers,
  ExternalLink,
  Code,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { AdkComponent, HarnessDefinition } from '../types/harness';
import { EnvironmentBindings } from './EnvironmentBindings';
import { COMPONENT_REGISTRY } from '../compiler/registry';
import { WorkflowMigratorModal } from '../canvas/WorkflowMigratorModal';

interface InspectorPanelProps {
  component: AdkComponent;
  harness: HarnessDefinition;
  onUpdateComponent: (updated: AdkComponent) => void;
  onDeleteComponent: (id: string) => void;
  onMigrateToWorkflow?: (workflow: any) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  component,
  harness,
  onUpdateComponent,
  onDeleteComponent,
  onMigrateToWorkflow,
}) => {
  const [showMigrator, setShowMigrator] = useState(false);
  const isAgent = component.kind === 'agent';
  const isSequential = isAgent && component.agentClass === 'SequentialAgent';
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
        </div>

        {component.id !== 'root_orchestrator' && (
          <button
            type="button"
            className="icon-btn"
            style={{ color: '#ef4444' }}
            onClick={() => onDeleteComponent(component.id)}
            title="Remove from harness"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Migration callout for SequentialAgent */}
      {isSequential && (
        <div style={{ padding: '10px 12px', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: 8, marginBottom: 16, fontSize: 11 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#fef08a', fontWeight: 600 }}>SequentialAgent Deprecated</span>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 10, padding: '3px 8px' }}
              onClick={() => setShowMigrator(true)}
            >
              <Workflow size={11} /> Convert to Workflow
            </button>
          </div>
        </div>
      )}

      {/* Basic Properties */}
      <div className="hs-form-group">
        <label className="hs-form-label">Component Name</label>
        <input
          type="text"
          className="hs-input"
          value={component.name}
          onChange={e => onUpdateComponent({ ...component, name: e.target.value })}
        />
      </div>

      {isAgent && (
        <>
          <div className="hs-form-group">
            <label className="hs-form-label">Model Profile</label>
            <select
              className="hs-select"
              value={component.model || 'gemini-2.5-flash'}
              onChange={e => onUpdateComponent({ ...component, model: e.target.value })}
            >
              <option value="gemini-2.5-flash">gemini-2.5-flash (Fast Triage)</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro (Deep Investigation)</option>
              <option value="balanced-investigation">balanced-investigation (Platform Profile)</option>
            </select>
          </div>

          <div className="hs-form-group">
            <label className="hs-form-label">System Instruction</label>
            <textarea
              className="hs-textarea"
              value={component.instruction || ''}
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

      {/* Migration Modal */}
      {showMigrator && isSequential && (
        <WorkflowMigratorModal
          agent={component}
          onClose={() => setShowMigrator(false)}
          onConfirm={workflow => {
            setShowMigrator(false);
            if (onMigrateToWorkflow) {
              onMigrateToWorkflow(workflow);
            }
          }}
        />
      )}
    </div>
  );
};
