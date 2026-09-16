import type { KnowledgeItem } from '../types/api';

export function documentTopic(item: KnowledgeItem): string {
  return item.structure?.topic.trim() || '';
}

export function knowledgeTopics(items: KnowledgeItem[]): { topic: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const topic = documentTopic(item);
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts].map(([topic, count]) => ({ topic, count })).sort((left, right) => left.topic.localeCompare(right.topic));
}

export function KnowledgeTopicFilter({ items, value, onChange }: {
  items: KnowledgeItem[]; value: string | null; onChange: (topic: string | null) => void;
}) {
  return <label>Topic<select value={value === null ? 'all' : JSON.stringify(value)} onChange={event => onChange(event.target.value === 'all' ? null : JSON.parse(event.target.value))}>
    <option value="all">All topics ({items.length})</option>
    {knowledgeTopics(items).map(({ topic, count }) => <option key={topic} value={JSON.stringify(topic)}>{topic || 'Unclassified'} ({count})</option>)}
  </select></label>;
}
