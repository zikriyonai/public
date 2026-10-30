import { escapeHtml } from './util';

/**
 * Markdown → HTML (same renderer as the original app).
 * SAFETY: the raw text is HTML-escaped first, so only tags generated here can ever appear.
 * Links are restricted to http(s).
 */
export function renderMarkdown(raw: string): string {
  if (!raw) return '';
  const codeStore: { lang: string; code: string }[] = [];

  let text = escapeHtml(raw);

  text = text.replace(/```([a-zA-Z0-9+#-]*)\s*\n?([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const i = codeStore.length;
    codeStore.push({ lang: (lang || 'code').toLowerCase(), code: code.replace(/\n$/, '') });
    return `\u0000CB${i}\u0000`;
  });

  text = text.replace(/^######\s+(.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^#####\s+(.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^####\s+(.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  text = text.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  text = text.replace(/^\s*(?:---|\*\*\*|___)\s*$/gm, '<hr>');

  text = text.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  text = text.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  text = text.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

  text = text.replace(/(?:^|\n)((?:[-*+]\s+.+\n?)+)/g, (_m, block: string) => {
    const items = block
      .trim()
      .split('\n')
      .map((l) => `<li>${l.replace(/^\s*[-*+]\s+/, '')}</li>`)
      .join('');
    return `\n<ul>${items}</ul>`;
  });
  text = text.replace(/(?:^|\n)((?:\d+\.\s+.+\n?)+)/g, (_m, block: string) => {
    const items = block
      .trim()
      .split('\n')
      .map((l) => `<li>${l.replace(/^\s*\d+\.\s+/, '')}</li>`)
      .join('');
    return `\n<ol>${items}</ol>`;
  });

  text = text
    .split(/\n{2,}/)
    .map((chunk) => {
      const t = chunk.trim();
      if (!t) return '';
      if (/^<(h[1-3]|ul|ol|blockquote|hr|pre|div)/.test(t)) return t;
      return `<p>${t.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  text = text.replace(/\u0000CB(\d+)\u0000/g, (_m, idx: string) => {
    const { lang, code } = codeStore[+idx];
    return `<div class="code-block">
      <div class="code-header">
        <span class="code-language">${escapeHtml(lang)}</span>
        <div class="code-actions">
          <button class="code-btn" data-copy-code><span class="material-symbols-rounded">content_copy</span>Copy</button>
        </div>
      </div>
      <pre class="code-content">${code}</pre>
    </div>`;
  });

  return text;
}

/** If the answer contains html/css/js code blocks, build a sandboxed preview document. */
export function buildPreviewDoc(raw: string): string | null {
  const htmlM = raw.match(/```html\s*\n?([\s\S]*?)```/i);
  const cssM = raw.match(/```css\s*\n?([\s\S]*?)```/i);
  const jsM = raw.match(/```(?:javascript|js)\s*\n?([\s\S]*?)```/i);
  if (!htmlM && !cssM && !jsM) return null;

  let doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
  doc += '<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fff;color:#111}' + (cssM ? cssM[1] : '') + '</style></head><body>';
  doc += htmlM ? htmlM[1] : '<div id="app"></div>';
  if (jsM) doc += `<script>try{${jsM[1]}}catch(e){document.body.insertAdjacentHTML('beforeend','<pre style="color:#c00">'+e.message+'</pre>')}<\/script>`;
  doc += '</body></html>';
  return doc;
}
