import { useId } from 'react';
import type { KnowledgeStructure } from '../types/api';

const kinds = ['system', 'error', 'responsibility', 'process', 'query', 'check', 'sanity', 'resolution', 'reference'];

export function KnowledgeStructureEditor({ value, onChange, topics = [] }: {
  value: KnowledgeStructure; onChange: (value: KnowledgeStructure) => void; topics?: string[];
}) {
  const id = useId();
  const editBlock = (index: number, field: keyof KnowledgeStructure['blocks'][number], text: string) =>
    onChange({ ...value, blocks: value.blocks.map((block, position) => position === index ? { ...block, [field]: text } : block) });
  return <section className="knowledge-structure-editor">
    <label>Project topic<input required maxLength={128} list={`${id}-topics`} value={value.topic} onChange={event => onChange({ ...value, topic: event.target.value })} /></label>
    <datalist id={`${id}-topics`}>{topics.filter(Boolean).map(topic => <option key={topic} value={topic} />)}</datalist>
    <p>Use a topic that makes sense for this project. Existing topics are suggested; you can create another.</p>
    <label>Summary<textarea rows={3} maxLength={2000} value={value.summary} onChange={event => onChange({ ...value, summary: event.target.value })} /></label>
    <datalist id={`${id}-kinds`}>{kinds.map(kind => <option key={kind} value={kind} />)}</datalist>
    {value.blocks.map((block, index) => <fieldset key={index} className="knowledge-structure-block">
      <legend>Section {index + 1}</legend>
      <div className="knowledge-form-row"><label>Section title<input required maxLength={256} value={block.title} onChange={event => editBlock(index, 'title', event.target.value)} /></label><label>Kind<input required maxLength={64} list={`${id}-kinds`} value={block.kind} onChange={event => editBlock(index, 'kind', event.target.value)} /></label></div>
      <label>Content<textarea required rows={6} maxLength={16000} value={block.content} onChange={event => editBlock(index, 'content', event.target.value)} /></label>
      <p>Markdown is supported. Queries and checks are reference text; saving does not execute them.</p>
      <div className="knowledge-actions">
        {index > 0 && <button type="button" className="btn btn-secondary" onClick={() => { const blocks = [...value.blocks]; [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]]; onChange({ ...value, blocks }); }} aria-label={`Move section ${index + 1} up`}>Move up</button>}
        {index + 1 < value.blocks.length && <button type="button" className="btn btn-secondary" onClick={() => { const blocks = [...value.blocks]; [blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]]; onChange({ ...value, blocks }); }} aria-label={`Move section ${index + 1} down`}>Move down</button>}
        <button type="button" className="btn btn-secondary" disabled={value.blocks.length === 1} onClick={() => onChange({ ...value, blocks: value.blocks.filter((_, position) => position !== index) })} aria-label={`Remove section ${index + 1}`}>Remove section</button>
      </div>
    </fieldset>)}
    <button type="button" className="btn btn-secondary" disabled={value.blocks.length >= 40} onClick={() => onChange({ ...value, blocks: [...value.blocks, { kind: 'reference', title: '', content: '' }] })}>Add section</button>
    <p>Use systems, errors, responsibilities, processes, queries, checks or your own section kinds. Up to 40 sections; the saved document must also fit this project's text limit.</p>
  </section>;
}
