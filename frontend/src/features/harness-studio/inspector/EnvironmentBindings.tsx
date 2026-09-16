import React from 'react';
import { ConnectorBinding, ToolBinding } from '../types/harness';
import { Server } from 'lucide-react';

interface EnvironmentBindingsProps {
  tool: ToolBinding;
  connector?: ConnectorBinding;
}

export const EnvironmentBindings: React.FC<EnvironmentBindingsProps> = ({ tool, connector }) => (
  <div className="hs-inspector-resolved-details">
    <div className="hs-form-label"><Server size={14} aria-hidden="true" /> {tool.name}</div>
    <dl>
      <dt>Binding scope</dt><dd>{tool.scope}</dd>
      {tool.requiredConnectorId && <><dt>Connector</dt><dd>{connector?.connectorId || tool.requiredConnectorId}</dd></>}
      <dt>Project environment</dt><dd>{connector?.projectEnvironment || 'Selected when running'}</dd>
    </dl>
    <p className="hs-form-hint">Choose a configured connector instance and environment in the Playground before starting an investigation. The server verifies access to that selection.</p>
  </div>
);
