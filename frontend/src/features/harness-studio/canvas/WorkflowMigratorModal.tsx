import React from 'react';
import { Workflow, ArrowRight, Check, X, AlertTriangle } from 'lucide-react';
import { AdkAgentComponent, AdkWorkflowComponent } from '../types/harness';
import { convertSequentialToWorkflow } from '../compiler/adk/workflow/migration';

interface WorkflowMigratorModalProps {
  agent: AdkAgentComponent;
  onConfirm: (workflow: AdkWorkflowComponent) => void;
  onClose: () => void;
}

export const WorkflowMigratorModal: React.FC<WorkflowMigratorModalProps> = ({
  agent,
  onConfirm,
  onClose,
}) => {
  const generatedWorkflow = convertSequentialToWorkflow(agent);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(234, 179, 8, 0.15)', display: 'grid', placeItems: 'center', color: '#eab308' }}>
              <Workflow size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: 16 }}>Migrate to ADK 2.x Graph Workflow</h2>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                Convert deprecated SequentialAgent into native graph orchestration
              </div>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ margin: '18px 0', padding: '12px', background: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.25)', borderRadius: 8, fontSize: 11, color: '#fef08a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 4 }}>
            <AlertTriangle size={13} />
            <span>Upstream Deprecation Notice</span>
          </div>
          Google ADK 2.x marks <code>SequentialAgent</code> as deprecated in favor of graph-based <code>Workflow</code>.
          This migration constructs a deterministic execution graph while keeping your existing subagent configurations intact.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center', margin: '18px 0' }}>
          {/* Before */}
          <div style={{ padding: '12px', background: 'var(--surface-secondary)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
              Before: SequentialAgent
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>
              {agent.name}
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>
              {(agent.sub_agents || []).length} sequential steps
            </div>
          </div>

          <ArrowRight size={18} style={{ color: 'var(--muted)' }} />

          {/* After */}
          <div style={{ padding: '12px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#10b981', marginBottom: 8 }}>
              After: Graph Workflow
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>
              {generatedWorkflow.name}
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>
              {generatedWorkflow.nodes.length} nodes · {generatedWorkflow.edges.length} edges
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onConfirm(generatedWorkflow)}
          >
            <Check size={13} />
            Apply Migration
          </button>
        </div>
      </div>
    </div>
  );
};
