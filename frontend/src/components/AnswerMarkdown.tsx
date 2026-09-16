import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Agent output is untrusted text. Never render HTML or fetch embedded images. */
export function AnswerMarkdown({ text }: { text: string }) {
  return <div className="answer-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: ({ alt }) => <span>{alt || 'Image reference'}</span>,
    a: ({ href, children }) => href && /^https?:\/\//i.test(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    table: ({ children }) => <div className="answer-table"><table>{children}</table></div>,
  }}>{text}</Markdown></div>;
}
