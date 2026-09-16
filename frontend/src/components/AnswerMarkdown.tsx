import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Children, isValidElement, type ReactNode } from 'react';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';

// Only the deployed handbook opts into local anchors. Raw HTML stays inert.
interface MarkdownNode { type: string; value?: string; children?: MarkdownNode[]; data?: { hProperties?: { id: string } } }
function guideAnchors() {
  return (tree: MarkdownNode) => {
    const counts = new Map<string, number>();
    const text = (node: MarkdownNode): string => typeof node.value === 'string' ? node.value : (node.children || []).map(text).join('');
    const visit = (node: MarkdownNode) => {
      if (node.type === 'heading') {
        const slug = text(node).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
        const count = counts.get(slug) || 0; counts.set(slug, count + 1);
        node.data = { hProperties: { id: `guide-${slug}${count ? '-' + count : ''}` } };
      } else if (node.type === 'html' || (node.type === 'paragraph' && node.children?.every(child => child.type === 'html'))) {
        const anchor = /^<a id="([a-z0-9_-]+)"><\/a>$/.exec(text(node).trim());
        if (anchor) { node.type = 'paragraph'; node.children = []; node.data = { hProperties: { id: `guide-${anchor[1]}` } }; delete node.value; }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/** Agent output is untrusted text. Never render HTML or fetch embedded images. */
export function AnswerMarkdown({ text, onDocumentLink }: { text: string; onDocumentLink?: (href: string) => void }) {
  return <div className="answer-markdown"><Markdown remarkPlugins={onDocumentLink ? [remarkGfm, guideAnchors] : [remarkGfm]} skipHtml components={{
    img: ({ alt }) => <span>{alt || 'Image reference'}</span>,
    a: ({ href, children }) => href && /^https?:\/\//i.test(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : href && onDocumentLink && /^(?:[a-z0-9][a-z0-9_-]*\.md(?:#[a-z0-9_-]+)?|#[a-z0-9_-]+)$/i.test(href)
        ? <button type="button" className="answer-document-link" onClick={() => onDocumentLink(href)}>{children}</button> : <span>{children}</span>,
    table: ({ children }) => <div className="answer-table" role="region" aria-label="Scrollable table" tabIndex={0}><table>{children}</table></div>,
    pre: ({ children }) => {
      const code = Children.toArray(children)[0];
      if (!isValidElement<{ className?: string; children?: ReactNode }>(code)) return <pre>{children}</pre>;
      const language = /(?:^|\s)language-([\w+-]{1,64})(?:\s|$)/.exec(code.props.className || '')?.[1] || 'text';
      return <MarkdownCodeBlock language={language} source={String(code.props.children ?? '').replace(/\n$/, '')} />;
    },
  }}>{text}</Markdown></div>;
}
