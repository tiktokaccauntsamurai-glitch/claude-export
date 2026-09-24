import { marked } from '../../vendor/marked.esm.js';

const inline = (tokens = []) => tokens.flatMap(t => {
  switch (t.type) {
    case 'strong': return [{ text: inline(t.tokens), bold: true }];
    case 'em': return [{ text: inline(t.tokens), italics: true }];
    case 'codespan': return [{ text: t.text, style: 'code' }];
    case 'link': return [{ text: inline(t.tokens), link: t.href, color: '#2563eb' }];
    case 'br': return ['\n'];
    default: return [t.tokens ? inline(t.tokens) : (t.text ?? t.raw)].flat();
  }
});

const CODE_LAYOUT = { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => '#f3f4f6' };

function block(t) {
  switch (t.type) {
    case 'heading': return { text: inline(t.tokens), style: 'h' + Math.min(t.depth, 4) };
    case 'paragraph': return { text: inline(t.tokens), margin: [0, 0, 0, 6] };
    case 'code': return { table: { widths: ['*'], body: [[{ text: t.text || ' ', style: 'codeBlock' }]] }, layout: CODE_LAYOUT, margin: [0, 2, 0, 8] };
    case 'blockquote': return { stack: t.tokens.map(block), margin: [12, 0, 0, 6], color: '#555' };
    case 'list': return { [t.ordered ? 'ol' : 'ul']: t.items.map(i => ({ stack: i.tokens.map(block) })), margin: [0, 0, 0, 6] };
    case 'table': return {
      table: {
        headerRows: 1, widths: t.header.map(() => '*'),
        body: [t.header.map(h => ({ text: inline(h.tokens), bold: true })), ...t.rows.map(r => r.map(c => ({ text: inline(c.tokens) })))],
      },
      margin: [0, 0, 0, 8],
    };
    case 'hr': return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5 }], margin: [0, 6] };
    case 'text': return { text: t.tokens ? inline(t.tokens) : t.text };
    case 'space': return { text: '' };
    default: return { text: t.raw || '' };
  }
}

// Roboto (bundled) has no emoji glyphs.
const stripEmoji = (s) => s.replace(/\p{Extended_Pictographic}|️|‍/gu, '');

export function mdToPdfDoc(md, title) {
  const body = stripEmoji(md.replace(/^---\n[\s\S]*?\n---\n/, ''));
  return {
    info: { title: stripEmoji(title) },
    pageMargins: [40, 50, 40, 50],
    content: [{ text: stripEmoji(title), style: 'title' }, ...marked.lexer(body).map(block)],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25 },
    styles: {
      title: { fontSize: 18, bold: true, margin: [0, 0, 0, 12] },
      h1: { fontSize: 14, bold: true, margin: [0, 10, 0, 4] }, h2: { fontSize: 13, bold: true, margin: [0, 8, 0, 4] },
      h3: { fontSize: 12, bold: true, margin: [0, 6, 0, 3] }, h4: { fontSize: 11, bold: true },
      code: { fontSize: 9, background: '#f3f4f6' },
      codeBlock: { fontSize: 8.5, preserveLeadingSpaces: true, margin: [4, 4, 4, 4] },
    },
    footer: (p, n) => ({ text: `${p} / ${n}`, alignment: 'center', fontSize: 8, color: '#888' }),
  };
}

// pdfMake is a global from vendor/pdfmake.min.js (loaded by a classic <script> tag)
export const pdfBlob = (doc) => new Promise((res, rej) => {
  try { globalThis.pdfMake.createPdf(doc).getBlob(res); } catch (e) { rej(e); }
});
