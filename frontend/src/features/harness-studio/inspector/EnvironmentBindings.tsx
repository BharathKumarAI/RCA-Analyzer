import React from 'react';
import { ConnectorBinding, ToolBinding } from '../types/harness';
import { Globe, Layers, Server, Shield, Key } from 'lucide-react';

interface EnvironmentBindingsProps {
  tool: ToolBinding;
  connector?: ConnectorBinding;
  onUpdateConnector?: (updated: ConnectorBinding) => void;
}

export const EnvironmentBindings: React.FC<EnvironmentBindingsProps> = ({
  tool,
  connector,
  onUpdateConnector,
}) => {
  return (
    <div style={{ marginTop: 16, padding: '12px', background: 'var(--surface-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
        <Server size={14} style={{ color: 'var(--acc)' }} />
        <span>Infrastructure & Environment Binding</span>
      </div>

      <div className="hs-form-group">
        <label className="hs-form-label">Binding Scope</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['global', 'project', 'environment'] as const).map(scope => (
            <button
              key={scope}
              type="button"
              className={`btn btn-secondary ${tool.scope === scope ? 'active' : ''}`}
              style={{
                fontSize: '10px',
                padding: '3px 8px',
                borderColor: tool.scope === scope ? 'var(--acc)' : undefined,
                color: tool.scope === scope ? 'var(--acc)' : undefined,
              }}
            >
              {scope === 'global' && <Globe size={11} />}
              {scope === 'project' && <Layers size={11} />}
              {scope === 'environment' && <Server size={11} />}
              {scope.charAt(0).toUpperCase() + scope.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {tool.requiredConnectorId && connector && (
        <>
          <div className="hs-form-group">
            <label className="hs-form-label">Underlying Connector</label>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text)', padding: '5px 8px', background: 'var(--bg)', borderRadius: 5 }}>
              {connector.connectorId}
            </div>
          </div>

          <div className="hs-form-group">
            <label className="hs-form-label">Target Project Environment</label>
            <select
              className="hs-select"
              value={connector.projectEnvironment || 'QA'}
              onChange={e => {
                if (onUpdateConnector) {
                  onUpdateConnector({ ...connector, projectEnvironment: e.target.value });
                }
              }}
            >
              <option value="DEV">DEV (Integration Testbed)</option>
              <option value="QA">QA (Primary Quality Lab)</option>
              <option value="PLAB01">PLAB01 (Pre-Prod Mirror)</option>
              <option value="PRD">PRD (Production Bounded)</option>
            </select>
          </div>

          {connector.secretRefs && Object.keys(connector.secretRefs).length > 0 && (
            <div className="hs-form-group" style={{ marginBottom: 0 }}>
              <label className="hs-form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Key size={11} />
                <span>Credential Reference</span>
              </label>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#10b981' }}>
                {Object.values(connector.secretRefs).join(', ')}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
