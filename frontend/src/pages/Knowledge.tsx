import React, { useState } from 'react';
import { BookOpen, RefreshCw, Plus, Search, Layers, HardDrive, Zap, CheckCircle2 } from 'lucide-react';
import { MOCK_KNOWLEDGE } from '../services/api';

export const Knowledge: React.FC = () => {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = MOCK_KNOWLEDGE.filter(s => {
    const matchesSearch = s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.type.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || s.type === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="view-container">
      {/* Clean & Elegant Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Knowledge & <span>Runbook Corpus</span>
          </h1>
          <p className="hero-lede">
            Curated postmortem archives, SRE architecture runbooks, and vector indexes referenced for citation verification.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{MOCK_KNOWLEDGE.length}</b> Stores Ready
            </span>
            <span className="hero-stat-chip">
              <b>Indexing:</b> Bounded Local Context
            </span>
            <span className="hero-stat-chip">
              <b>Footprint:</b> 110.4 MB
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button type="button" className="btn btn-primary" title="Connect a new runbook directory or vector corpus">
              <Plus size={13} strokeWidth={2.5} /> Link Knowledge Base
            </button>
          </div>
        </div>
      </section>

      {/* KPI Metric Strip */}
      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label-row">
            <span>Indexed Documents</span>
            <BookOpen size={15} color="var(--acc)" />
          </div>
          <div className="metric-value">188</div>
          <div className="metric-meta">Across 3 active stores</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Vector Footprint</span>
            <HardDrive size={15} color="var(--acc2)" />
          </div>
          <div className="metric-value">110.4 MB</div>
          <div className="metric-meta">ChromaDB local vector space</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Retrieval Latency</span>
            <Zap size={15} color="var(--acc3)" />
          </div>
          <div className="metric-value">14ms</div>
          <div className="metric-meta">Top-5 nearest cosine similarity</div>
        </div>

        <div className="metric-card">
          <div className="metric-label-row">
            <span>Sync Freshness</span>
            <CheckCircle2 size={15} color="var(--acc3)" />
          </div>
          <div className="metric-value">100%</div>
          <div className="metric-meta">All indexes within 24h SLA</div>
        </div>
      </div>

      {/* Compact Toolbar */}
      <div className="toolbar">
        <div className="search-box">
          <Search size={14} />
          <input
            type="search"
            placeholder="Search documents, stores, or runbooks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            spellCheck={false}
          />
        </div>

        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="env-dropdown"
        >
          <option value="all">All Store Types</option>
          <option value="runbook">Runbooks</option>
          <option value="archive">Postmortem Archives</option>
          <option value="architecture">Architecture Topology</option>
        </select>

        <div className="count-badge">
          <b>{filtered.length}</b> stores indexed
        </div>
      </div>

      {/* Fluid Card List */}
      <div className="card-list">
        {filtered.map((source, index) => {
          const numStr = String(index + 1).padStart(3, '0');

          return (
            <article key={source.id} className="card">
              <div className="card-top">
                <div className="num">{numStr}</div>

                <div className="card-main">
                  <div className="card-title-row">
                    <h2 className="card-title">{source.title}</h2>
                    <span className="brand-badge">{source.type}</span>
                    <span className={`badge badge-${source.status}`}>
                      {source.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="card-meta-pills">
                    <span className="meta-pill highlight">{source.entries_count} documents</span>
                    <span className="meta-pill">{source.size_mb} MB</span>
                    <span className="meta-pill highlight">{source.freshness}</span>
                    <span className="meta-pill">Access: {source.access_level}</span>
                  </div>
                </div>

                <div className="card-actions">
                  <button type="button" className="btn btn-open">
                    <RefreshCw size={12} />
                    Sync
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
