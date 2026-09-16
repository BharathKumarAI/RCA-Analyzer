import { useState } from 'react';
import { MermaidBlock } from './MermaidBlock';
import './markdown-blocks.css';

export function MarkdownCodeBlock({ source, language = 'text' }: { source: string; language?: string }) {
  const [copyMessage, setCopyMessage] = useState('');
  return <section className="markdown-code-block" aria-label={`${language} block`}>
    <header><span>{language}</span><button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(source); setCopyMessage('Copied'); }
      catch { setCopyMessage('Copy failed. Select the source text to copy it manually.'); }
    }}>Copy {language === 'mermaid' ? 'source' : 'code'}</button></header>
    {language.toLowerCase() === 'mermaid' ? <MermaidBlock source={source} /> : <pre tabIndex={0}><code className={`language-${language}`}>{source}</code></pre>}
    {copyMessage && <p role="status">{copyMessage}</p>}
  </section>;
}
