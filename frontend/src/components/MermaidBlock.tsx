import { useEffect, useMemo, useRef, useState } from 'react';

/** Diagrams are untrusted data; the renderer cannot fetch assets or change its policy. */
export function diagramSource(source: string): string {
  if (source.length > 24_000 || source.split('\n').length > 400) throw new Error('This diagram is too large to render. Its source is available below.');
  if ((source.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0) > 800 || (source.match(/[;&]/g)?.length ?? 0) > 200) throw new Error('This diagram is too complex to render. Split it into smaller diagrams.');
  if (/^\s*---|%%\s*\{|(?:https?|ftp|file|data|javascript|vbscript):|!\s*\[|url\s*\(|@import|@\s*\{/im.test(source)) throw new Error('This diagram contains configuration or external content that cannot be rendered.');
  if (/(?:^|[;\n])\s*(?:classDef|style|linkStyle)\s/i.test(source)) throw new Error('This diagram contains custom styles. Remove them to use the safe diagram theme.');
  if (/(?:^|[;\n])\s*(?:properties|details)\s|\bUpdate(?:ElementStyle|RelStyle|LayoutConfig)\s*\(/i.test(source)) throw new Error('This diagram contains custom assets or styles that cannot be rendered.');
  // Plain line breaks are supported without enabling HTML labels.
  const text = source.replace(/<br\s*\/?\s*>/gi, '\\n');
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(text)) throw new Error('This diagram contains HTML labels, which are not supported.');
  // The handbook provides ordinary reading-path links next to its diagrams.
  return text.replace(/^\s*(?:click|links?)\s+[^\n]+$/gm, '');
}

let renderer: Promise<typeof import('mermaid')['default']> | undefined;
const getRenderer = () => renderer ??= import('mermaid').then(({ default: mermaid }) => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
    maxTextSize: 24_000, maxEdges: 200, theme: 'neutral', fontFamily: 'system-ui, sans-serif',
    htmlLabels: false, flowchart: { htmlLabels: false },
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'theme', 'themeCSS', 'fontFamily', 'dompurifyConfig'],
  });
  return mermaid;
}).catch(error => { renderer = undefined; throw error; });

export function diagramFrame(svg: string, fullSize: boolean): { html: string; ratio: number } {
  if (svg.length > 2_000_000) throw new Error('The rendered diagram exceeds the display limit.');
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('The diagram could not be displayed.');
  parsed.querySelectorAll('script, foreignObject, image, iframe, object, embed').forEach(node => node.remove());
  parsed.querySelectorAll('a').forEach(node => node.replaceWith(...Array.from(node.childNodes)));
  for (const node of parsed.querySelectorAll('*')) {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name) || (/href$/i.test(attribute.name) && !attribute.value.startsWith('#'))) node.removeAttribute(attribute.name);
    }
  }
  const dimensions = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const ratio = dimensions.length === 4 && dimensions[2] > 0 && dimensions[3] > 0 ? Math.max(0.1, Math.min(10, dimensions[2] / dimensions[3])) : 1.6;
  const width = dimensions[2] > 0 && Number.isFinite(dimensions[2]) ? Math.min(8000, dimensions[2]) : 800;
  root.setAttribute('style', `display:block;width:${fullSize ? `${width}px` : '100%'};max-width:none;height:auto;`);
  const safeSvg = new XMLSerializer().serializeToString(root);
  return { ratio, html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>html,body{margin:0;background:#fff;color:#222}body{padding:12px;box-sizing:border-box}</style></head><body>${safeSvg}</body></html>` };
}

export function MermaidBlock({ source }: { source: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [fullSize, setFullSize] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSvg(''); setError('');
    const render = async () => {
      const id = `diagram_${crypto.randomUUID().replaceAll('-', '')}`;
      try {
        const text = diagramSource(source);
        const mermaid = await getRenderer();
        if (cancelled) return;
        const result = await mermaid.render(id, text);
        if (!cancelled) { diagramFrame(result.svg, false); setSvg(result.svg); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error && cause.message.startsWith('This diagram') ? cause.message : 'This diagram could not be rendered. Check its source or retry.');
      } finally { document.getElementById(`d${id}`)?.remove(); document.getElementById(`i${id}`)?.remove(); }
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void render(); }
    }, { rootMargin: '300px' });
    if (container.current) observer.observe(container.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [source, retry]);
  const frame = useMemo(() => svg ? diagramFrame(svg, fullSize) : null, [svg, fullSize]);
  return <div ref={container} className="mermaid-block">
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry diagram</button></p> : frame ? <><button type="button" onClick={() => setFullSize(value => !value)}>{fullSize ? 'Fit diagram to page' : 'View diagram at full size'}</button><iframe title="Mermaid diagram" sandbox="" referrerPolicy="no-referrer" srcDoc={frame.html} className={fullSize ? 'mermaid-frame is-full-size' : 'mermaid-frame'} style={{ aspectRatio: frame.ratio }} /></> : <p role="status">Rendering diagram…</p>}
    <details><summary>Diagram source</summary><pre tabIndex={0}><code>{source}</code></pre></details>
  </div>;
}
