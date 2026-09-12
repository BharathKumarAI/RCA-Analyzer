import React, { useState } from 'react';
import { Bot, ChevronDown, ChevronRight, FileCode, GitBranch, Search, ShieldCheck, Workflow, Wrench } from 'lucide-react';
import { ModuleCard } from './ModuleCard';

export interface StudioLibraryModule {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: string;
  editable?: boolean;
}

interface ModuleLibraryProps { modules: StudioLibraryModule[]; onAddModule: (type: string) => void; }

function iconFor(kind: string): React.ReactNode {
  const value = kind.toLowerCase();
  if (value.includes('tool') || value.includes('connector')) return <Wrench size={15} />;
  if (value.includes('policy') || value.includes('governance')) return <ShieldCheck size={15} />;
  if (value.includes('workflow') || value.includes('sequence') || value.includes('parallel')) return <Workflow size={15} />;
  if (value.includes('config') || value.includes('yaml')) return <FileCode size={15} />;
  if (value.includes('join') || value.includes('branch')) return <GitBranch size={15} />;
  return <Bot size={15} />;
}

export const ModuleLibrary: React.FC<ModuleLibraryProps> = ({ modules, onAddModule }) => {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const filtered = modules.filter(module => !query.trim() || `${module.name} ${module.description} ${module.kind}`.toLowerCase().includes(query.trim().toLowerCase()));
  const categories = [...new Set(filtered.map(module => module.category))];
  return (
    <div className="hs-library">
      <div className="hs-library-search"><Search size={14} className="hs-search-icon" /><input type="search" className="hs-search-input" placeholder="Search resolved components" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="hs-library-scroll">
        {categories.length === 0 && <div className="hs-library-empty">No server-resolved components are available for this workspace.</div>}
        {categories.map(category => { const items = filtered.filter(module => module.category === category); const isCollapsed = Boolean(collapsed[category]); return <div key={category} className="hs-module-category"><div className="hs-category-head" onClick={() => setCollapsed(current => ({ ...current, [category]: !current[category] }))}><span>{category}</span>{isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</div>{!isCollapsed && items.map(module => <ModuleCard key={module.id} id={module.id} name={module.name} description={module.description} category={module.category} icon={iconFor(module.kind)} isCompatibility={module.editable === false} onAdd={onAddModule} />)}</div>; })}
      </div>
    </div>
  );
};
