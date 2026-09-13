import React from 'react';
import { Eye } from 'lucide-react';

interface ModuleCardProps {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  isCompatibility?: boolean;
  onSelect: (type: string) => void;
}

export const ModuleCard: React.FC<ModuleCardProps> = ({
  id,
  name,
  description,
  icon,
  isCompatibility,
  onSelect,
}) => {
  return (
    <div
      className={`hs-module-card ${isCompatibility ? 'compatibility' : ''}`}
      onClick={() => onSelect(id)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(id); } }}
      role="button"
      tabIndex={0}
      title={`Inspect ${name}`}
    >
      <div className="hs-module-icon">{icon}</div>
      <div className="hs-module-info">
        <div className="hs-module-name">
          {name}
          {isCompatibility && <span className="hs-compat-tag">Read only</span>}
        </div>
        <div className="hs-module-desc">{description}</div>
      </div>
      <button
        type="button"
        className="icon-btn"
        style={{ width: 22, height: 22 }}
        aria-label={`Inspect ${name}`}
        onClick={e => {
          e.stopPropagation();
          onSelect(id);
        }}
      >
        <Eye size={13} />
      </button>
    </div>
  );
};
