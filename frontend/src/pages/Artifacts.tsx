import React, { useState, useEffect } from 'react';
import {
  HardDrive,
  Folder,
  FileText,
  Eye,
  RotateCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Code,
  Copy,
  Check,
  Package,
} from 'lucide-react';
import { fetchKnowledge, fetchSkills, fetchRuns } from '../services/api';

interface ArtifactItem {
  id: string;
  name: string;
  path: string;
  category: 'all' | 'skills' | 'knowledge' | 'evidence';
  size: string;
  updatedAt: string;
  content: string;
}

export const Artifacts: React.FC = () => {
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'skills' | 'knowledge' | 'evidence'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewItem, setPreviewItem] = useState<ArtifactItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadArtifacts = () => {
    setLoading(true);
    setError(null);
    Promise.allSettled([
      fetchKnowledge(),
      fetchSkills(),
      fetchRuns(),
    ]).then(([knowledgeRes, skillsRes, runsRes]) => {
      const items: ArtifactItem[] = [];
      if (knowledgeRes.status === 'fulfilled' && Array.isArray(knowledgeRes.value)) {
        knowledgeRes.value.forEach((k: any) => {
          items.push({
            id: `doc-${k.id || k.doc_id}`,
            name: k.title || 'Untitled Document',
            path: `knowledge/${k.category || 'Runbooks'}/${k.title || 'doc'}`,
            category: 'knowledge',
            size: k.size_bytes ? `${(k.size_bytes / 1024).toFixed(1)} KB` : `${k.content?.length || 0} chars`,
            updatedAt: k.updated_at ? new Date(k.updated_at * 1000).toLocaleDateString() : 'Active',
            content: k.content || 'No text content available.',
          });
        });
      }
      if (skillsRes.status === 'fulfilled' && Array.isArray(skillsRes.value)) {
        skillsRes.value.forEach((s: any) => {
          items.push({
            id: `skill-${s.skill_id}`,
            name: `${s.name}/SKILL.md`,
            path: `skills/${s.name}/SKILL.md`,
            category: 'skills',
            size: s.content ? `${(s.content.length / 1024).toFixed(1)} KB` : 'Defined',
            updatedAt: s.status || 'Registered',
            content: s.content || `# ${s.name}\n${s.description || ''}`,
          });
        });
      }
      if (runsRes.status === 'fulfilled' && Array.isArray(runsRes.value)) {
        runsRes.value
          .filter((r: any) => r.findings || (r.evidence_bundles_count && r.evidence_bundles_count > 0))
          .slice(0, 15)
          .forEach((r: any) => {
            items.push({
              id: `run-${r.id}`,
              name: `${r.id}_evidence.json`,
              path: `runs/${r.id}/evidence.json`,
              category: 'evidence',
              size: `${(r.findings || '').length} bytes`,
              updatedAt: r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Completed',
              content: JSON.stringify({ run_id: r.id, prompt: r.prompt, findings: r.findings, status: r.status }, null, 2),
            });
          });
      }
      setArtifacts(items);
      setPreviewItem(items.length > 0 ? items[0] : null);
    }).catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load project artifacts');
    }).finally(() => {
      setLoading(false);
    });
  };

  useEffect(() => {
    loadArtifacts();
  }, []);

  const filteredArtifacts = artifacts.filter((a) => {
    if (selectedCategory !== 'all' && a.category !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q);
    }
    return true;
  });

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        padding: '24px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        overflowY: 'auto',
        minHeight: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Header Banner */}
      <div
        className="platform-card"
        style={{
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--accent-rose), var(--accent-indigo))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 0 18px rgba(244, 63, 94, 0.25)',
            }}
          >
            <HardDrive size={24} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: 'var(--ink-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                }}
              >
                PROJECT ASSET CATALOG & ARTIFACTS
              </span>
              <span className="badge badge-teal">Live Storage</span>
            </div>
            <h1
              style={{
                fontSize: '20px',
                fontWeight: 700,
                color: 'var(--ink-primary)',
                margin: '4px 0 0 0',
              }}
            >
              Project Artifacts & Storage
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', margin: '2px 0 0 0' }}>
              Authentic catalog of approved specialist skills, reference knowledge runbooks, and captured investigation evidence bundles.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="badge badge-magenta">
            {artifacts.length} Assets Registered
          </span>
          <button
            onClick={loadArtifacts}
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: '12px', gap: '6px' }}
            title="Refresh assets"
          >
            <RotateCw size={13} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Search & Category Filter */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '6px 12px',
            width: '320px',
          }}
        >
          <Search size={14} color="var(--ink-tertiary)" />
          <input
            type="text"
            placeholder="Search artifacts by name or path..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--ink-primary)',
              fontSize: '12px',
              width: '100%',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {(['all', 'skills', 'knowledge', 'evidence'] as const).map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: '5px 12px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: isSelected ? '1px solid var(--accent-rose)' : '1px solid var(--border-subtle)',
                  background: isSelected ? 'rgba(244, 63, 94, 0.12)' : 'var(--bg-card)',
                  color: isSelected ? 'var(--accent-rose)' : 'var(--ink-secondary)',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  transition: 'all 0.15s ease',
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid: Artifacts Table + Live Preview */}
      {loading ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ink-secondary)' }}>
          <RotateCw className="spin" size={24} style={{ margin: '0 auto 12px auto', display: 'block' }} />
          <p>Loading project artifacts and assets...</p>
        </div>
      ) : error ? (
        <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--accent-rose)' }}>
          <AlertTriangle size={24} style={{ margin: '0 auto 8px auto', display: 'block' }} />
          <p>{error}</p>
        </div>
      ) : artifacts.length === 0 ? (
        <div
          className="platform-card"
          style={{
            padding: '60px 24px',
            textAlign: 'center',
            color: 'var(--ink-secondary)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
          }}
        >
          <Package size={36} style={{ margin: '0 auto 12px auto', opacity: 0.6, color: 'var(--ink-tertiary)' }} />
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink-primary)', margin: '0 0 6px 0' }}>
            No Project Artifacts Registered Yet
          </h2>
          <p style={{ fontSize: '13px', maxWidth: '460px', margin: '0 auto', lineHeight: 1.5 }}>
            Upload reference runbooks in Knowledge or approve specialist YAML agents to populate your project storage catalog.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(360px, 460px)', gap: '20px' }}>
          {/* Artifacts Table */}
          <div
            className="platform-card"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              overflow: 'hidden',
              height: 'fit-content',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--ink-secondary)' }}>Name & Path</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--ink-secondary)' }}>Category</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--ink-secondary)' }}>Size</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--ink-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredArtifacts.map((item) => {
                  const isSelected = previewItem?.id === item.id;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setPreviewItem(item)}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        background: isSelected ? 'rgba(244, 63, 94, 0.06)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                      }}
                      className="table-row-hover"
                    >
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--ink-primary)' }}>{item.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--ink-tertiary)', marginTop: '2px', fontFamily: "'JetBrains Mono', monospace" }}>
                          {item.path}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="badge badge-neutral" style={{ textTransform: 'uppercase', fontSize: '10px' }}>
                          {item.category}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--ink-secondary)', fontSize: '12px' }}>
                        {item.size}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewItem(item);
                          }}
                          className="btn btn-secondary"
                          style={{ padding: '3px 8px', fontSize: '11px', gap: '4px' }}
                        >
                          <Eye size={12} /> View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Preview Panel */}
          {previewItem && (
            <div
              className="platform-card"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                height: 'fit-content',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink-primary)', margin: 0 }}>
                    {previewItem.name}
                  </h3>
                  <div style={{ fontSize: '11px', color: 'var(--ink-tertiary)', marginTop: '2px', fontFamily: "'JetBrains Mono', monospace" }}>
                    {previewItem.path} • {previewItem.size}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleCopy(previewItem.content)}
                  className="btn btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '11px', gap: '4px', flexShrink: 0 }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copied ? 'Copied' : 'Copy Content'}</span>
                </button>
              </div>

              <div
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '14px',
                  maxHeight: '440px',
                  overflowY: 'auto',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '11.5px',
                  lineHeight: 1.6,
                  color: 'var(--ink-primary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {previewItem.content}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
