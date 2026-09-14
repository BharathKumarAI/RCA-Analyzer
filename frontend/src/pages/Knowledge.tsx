import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Tag,
  Edit2,
  Trash2,
  Eye,
  RefreshCw,
  FileText,
  AlertTriangle,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';
import { NotificationBanner } from '../components/NotificationBanner';
import {
  fetchKnowledge,
  createKnowledgeDoc,
  uploadKnowledgeDoc,
  updateKnowledgeDoc,
  deleteKnowledgeDoc,
} from '../services/api';
import type { KnowledgeItem, KnowledgePayload } from '../types/api';

export const Knowledge: React.FC = () => {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [viewingItem, setViewingItem] = useState<KnowledgeItem | null>(null);

  // Form inputs
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Incident Triage');
  const [tagsInput, setTagsInput] = useState('');
  const [content, setContent] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [status, setStatus] = useState('active');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKnowledge();
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load knowledge sources.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openAdd = () => {
    setTitle('');
    setCategory('');
    setTagsInput('');
    setContent('');
    setSourceFile(null);
    setStatus('active');
    setShowAddModal(true);
  };

  const openEdit = (item: KnowledgeItem) => {
    setEditingItem(item);
    setTitle(item.title);
    setCategory(item.category || 'General');
    setTagsInput((item.tags || []).join(', '));
    setContent(item.content || '');
    setSourceFile(null);
    setStatus(item.status || 'active');
  };

  const handleSaveDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || (!content.trim() && !sourceFile)) return;

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    const payload: KnowledgePayload = {
      title: title.trim(),
      category: category.trim() || 'Runbook',
      tags,
      content: content.trim(),
      media_type: 'text/markdown',
      status,
    };

    try {
      if (editingItem) {
        const updated = await updateKnowledgeDoc(editingItem.id, payload);
        setItems(prev => prev.map(it => (it.id === editingItem.id ? updated : it)));
        setEditingItem(null);
        setSuccessMsg('Runbook document updated successfully!');
      } else {
        const created = sourceFile
          ? await uploadKnowledgeDoc(sourceFile, title.trim(), category.trim() || 'Runbook')
          : await createKnowledgeDoc(payload);
        setItems(prev => [created, ...prev]);
        setShowAddModal(false);
        setSuccessMsg(sourceFile ? 'File uploaded and extracted into the project corpus.' : 'Knowledge document published to the project corpus.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save knowledge document');
    } finally {
      setSourceFile(null);
      setSubmitting(false);
    }
  };

  const handleDelete = async (docId: string, docTitle: string) => {
    if (!window.confirm(`Are you sure you want to delete "${docTitle}"?`)) return;

    try {
      await deleteKnowledgeDoc(docId);
      setItems(prev => prev.filter(it => it.id !== docId));
      if (viewingItem?.id === docId) setViewingItem(null);
      setSuccessMsg('Runbook document deleted successfully.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete knowledge document');
    }
  };

  // Categories list
  const categories = ['ALL', ...Array.from(new Set(items.map(it => it.category).filter(Boolean)))];

  // Filtered items
  const filtered = items.filter(it => {
    const matchesCat = categoryFilter === 'ALL' || it.category === categoryFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      it.title.toLowerCase().includes(q) ||
      (it.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (it.content || '').toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  return (
    <div className="view-container">
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Knowledge & <span>Runbook Corpus</span>
          </h1>
          <p className="hero-lede">
            Curate operational playbooks, troubleshooting guidelines, and domain runbooks automatically referenced during investigation synthesis.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <BookOpen size={12} style={{ color: 'var(--acc)' }} />{' '}
              <b>Total Runbooks:</b> {items.length}
            </span>
            <span className="hero-stat-chip">
              <CheckCircle2 size={12} style={{ color: '#10b981' }} />{' '}
              <b>Active:</b> {items.filter(i => i.status === 'active').length}
            </span>
            <span className="hero-stat-chip">
              <Tag size={12} /> <b>Categories:</b> {categories.length - (categories.includes('ALL') ? 1 : 0)}
            </span>
          </div>
        </div>
        <div className="hero-actions" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openAdd}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={13} /> Add Runbook / Doc
          </button>
        </div>
      </section>

      {error && (
        <NotificationBanner
          type="error"
          message={error}
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {successMsg && (
        <NotificationBanner
          type="success"
          message={successMsg}
          onClose={() => setSuccessMsg(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Filter and Search Bar */}
      <div
        className="card"
        style={{
          padding: '14px 18px',
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 260 }}>
          <Search size={16} style={{ color: 'var(--muted)' }} />
          <input
            type="text"
            placeholder="Search runbooks by title, tag, or content keywords..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text)',
              fontSize: 13,
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SlidersHorizontal size={14} style={{ color: 'var(--muted)' }} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Category:</span>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            style={{
              padding: '6px 10px',
              background: 'var(--bg)',
              color: 'var(--text)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            {categories.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Runbook Cards Grid */}
      {filtered.length === 0 ? (
        <div className="card empty-state" style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <FileText size={32} style={{ color: 'var(--muted)', margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: 16, margin: '0 0 6px' }}>No Knowledge Documents Found</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, maxWidth: 400, margin: '0 auto 16px' }}>
            {search
              ? 'No runbooks matched your search query. Try broadening your terms.'
              : 'Add your first troubleshooting runbook to empower agents with domain operational knowledge.'}
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={openAdd} style={{ width: 'auto', alignSelf: 'center' }}>
            <Plus size={12} /> Create Runbook
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {filtered.map(item => (
            <article
              key={item.id}
              className="card"
              style={{
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'border-color 0.2s',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      color: 'var(--acc)',
                      background: 'rgba(59, 130, 246, 0.1)',
                      padding: '2px 8px',
                      borderRadius: 4,
                    }}
                  >
                    {item.category || 'General'}
                  </span>
                  <span
                    className="badge"
                    style={{
                      fontSize: 10,
                      textTransform: 'uppercase',
                      background: item.status === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                      color: item.status === 'active' ? '#34d399' : 'var(--muted)',
                    }}
                  >
                    {item.status}
                  </span>
                </div>

                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    margin: '0 0 8px',
                    lineHeight: 1.4,
                    cursor: 'pointer',
                  }}
                  onClick={() => setViewingItem(item)}
                >
                  {item.title}
                </h3>

                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    lineHeight: 1.5,
                    margin: '0 0 12px',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {item.content}
                </p>

                {/* Tags */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
                  {(item.tags || []).map(t => (
                    <span
                      key={t}
                      style={{
                        fontSize: 10,
                        background: 'var(--surface-sunken)',
                        border: '1px solid var(--line)',
                        padding: '1px 6px',
                        borderRadius: 10,
                        color: 'var(--muted)',
                      }}
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Card Footer Actions */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid var(--line)',
                  paddingTop: 10,
                  marginTop: 6,
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {item.size_bytes ? `${(item.size_bytes / 1024).toFixed(1)} KB` : 'Markdown'}
                </span>
                {item.upload && (
                  <span title={`Extracted from ${item.upload.filename}`} style={{ fontSize: 10, color: 'var(--muted)' }}>
                    extracted text · {item.upload.warnings.length ? `${item.upload.warnings.length} warning${item.upload.warnings.length === 1 ? '' : 's'}` : 'source verified'}
                  </span>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => setViewingItem(item)}
                    title="View Document"
                    style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => openEdit(item)}
                    title="Edit Document"
                    style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => void handleDelete(item.id, item.title)}
                    title="Delete Document"
                    style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Modal: Add or Edit Document */}
      {(showAddModal || editingItem) && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            style={{
              width: 640,
              maxWidth: '92vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 26,
              border: '1px solid var(--line)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 600 }}>
              {editingItem ? 'Edit Knowledge Runbook' : 'Add Knowledge Runbook'}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
              Configure markdown instructions and incident guidelines for AI agents.
            </p>

            <form onSubmit={handleSaveDoc}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Document Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Postgres Connection Pool Starvation Runbook"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                    Category
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Database, Kubernetes, Network"
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                    Lifecycle Status
                  </label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                  >
                    <option value="active">Active (Available to Agents)</option>
                    <option value="draft">Draft (Private)</option>
                    <option value="deprecated">Deprecated</option>
                  </select>
                </div>
              </div>

              {!editingItem && (
                <div style={{ marginBottom: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--card-subtle)' }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                    Upload a local runbook or document
                  </label>
                  <input
                    type="file"
                    onChange={e => setSourceFile(e.target.files?.[0] || null)}
                    disabled={submitting}
                    accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,.yaml,.yml"
                    style={{ width: '100%', color: 'var(--text)', fontSize: 12 }}
                  />
                  <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 11, lineHeight: 1.45 }}>
                    The backend extracts bounded text and retains the extracted content only. Original files are not retained.
                  </p>
                  {sourceFile && <span style={{ display: 'block', marginTop: 5, color: 'var(--acc3)', fontSize: 11 }}>Selected: {sourceFile.name}</span>}
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Index Tags (Comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="postgres, connection-pool, high-latency, timeout"
                  value={tagsInput}
                  onChange={e => setTagsInput(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  {sourceFile ? 'Optional note (ignored for uploaded content)' : 'Markdown Content *'}
                </label>
                <textarea
                  required
                  rows={9}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 12,
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    lineHeight: 1.5,
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingItem(null);
                  }}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : editingItem ? 'Save Changes' : 'Publish Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: View Document */}
      {viewingItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            style={{
              width: 700,
              maxWidth: '92vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 26,
              border: '1px solid var(--line)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    color: 'var(--acc)',
                    marginRight: 8,
                  }}
                >
                  {viewingItem.category}
                </span>
                <span className="badge" style={{ fontSize: 10 }}>
                  {viewingItem.status}
                </span>
                <h2 style={{ fontSize: 18, margin: '6px 0 0', fontWeight: 600 }}>{viewingItem.title}</h2>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setViewingItem(null)}
              >
                Close
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {(viewingItem.tags || []).map(t => (
                <span
                  key={t}
                  style={{
                    fontSize: 11,
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--line)',
                    padding: '2px 8px',
                    borderRadius: 12,
                    color: 'var(--muted)',
                  }}
                >
                  #{t}
                </span>
              ))}
            </div>

            <div
              style={{
                padding: 16,
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                whiteSpace: 'pre-wrap',
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.6,
                marginBottom: 20,
              }}
            >
              {viewingItem.content}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const it = viewingItem;
                  setViewingItem(null);
                  openEdit(it);
                }}
              >
                <Edit2 size={13} /> Edit Document
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
