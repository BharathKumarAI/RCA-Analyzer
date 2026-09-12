import React from 'react';
import { Plus } from 'lucide-react';

interface ModuleCardProps {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  isCompatibility?: boolean;
  onAdd: (type: string) => void;
}

export const ModuleCard: React.FC<ModuleCardProps> = ({
  id,
  name,
  description,
  icon,
  isCompatibility,
  onAdd,
}) => {
  return (
    <div
      className={`hs-module-card ${isCompatibility ? 'compatibility' : ''}`}
      onClick={() => onAdd(id)}
      title={`Click to add ${name} to canvas`}
    >
      <div className="hs-module-icon">{icon}</div>
      <div className="hs-module-info">
        <div className="hs-module-name">
          {name}
          {isCompatibility && <span className="hs-compat-tag">Legacy</span>}
        </div>
        <div className="hs-module-desc">{description}</div>
      </div>
      <button
        type="button"
        className="icon-btn"
        style={{ width: 22, height: 22 }}
        onClick={e => {
          e.stopPropagation();
          onAdd(id);
        }}
      >
        <Plus size={13} />
      </button>
    </div>
  );
};
