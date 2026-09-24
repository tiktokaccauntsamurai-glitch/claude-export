import { safeName, uniqueName } from './filenames.js';

const TYPE_EXT = {
  'text/markdown': 'md', 'text/html': 'html', 'image/svg+xml': 'svg',
  'application/vnd.ant.mermaid': 'mmd', 'application/vnd.ant.react': 'jsx', 'application/vnd.ant.code': null,
};
const LANG_EXT = {
  python: 'py', javascript: 'js', typescript: 'ts', jsx: 'jsx', tsx: 'tsx', html: 'html', css: 'css', json: 'json',
  bash: 'sh', shell: 'sh', sql: 'sql', rust: 'rs', go: 'go', java: 'java', cpp: 'cpp', c: 'c', csharp: 'cs',
  markdown: 'md', yaml: 'yml', xml: 'xml',
};

export class ArtifactCollector {
  constructor() { this.map = new Map(); }

  // Returns artifact id if the tool call was an artifact, else null.
  handleToolUse(name, input = {}) {
    if (name === 'artifacts') {
      const { command, id } = input;
      if (!id) return null;
      const prev = this.map.get(id);
      if (command === 'create' || command === 'rewrite' || !prev) {
        this.map.set(id, {
          id, title: input.title || prev?.title || id, type: input.type || prev?.type || '',
          language: input.language || prev?.language, content: input.content ?? prev?.content ?? '',
          versions: (prev?.versions || 0) + 1,
          history: [...(prev?.history || []), input.content ?? prev?.content ?? ''],
        });
      } else if (command === 'update' && input.old_str != null) {
        prev.content = prev.content.replace(input.old_str, () => input.new_str ?? '');
        prev.versions++;
        prev.history.push(prev.content);
      }
      return id;
    }
    if (name === 'create_file' && input.path) {
      const id = 'file:' + input.path;
      const prev = this.map.get(id);
      const base = input.path.replace(/\\/g, '/').split('/').pop();
      this.map.set(id, {
        id, title: base, type: 'file', filename: base,
        content: input.file_text ?? '', versions: (prev?.versions || 0) + 1,
        history: [...(prev?.history || []), input.file_text ?? ''],
      });
      return id;
    }
    if (name === 'visualize:show_widget' && input.widget_code) {
      const id = 'widget:' + (input.title || this.map.size);
      this.map.set(id, { id, title: input.title || 'widget', type: 'text/html', content: input.widget_code, versions: 1, history: [input.widget_code] });
      return id;
    }
    return null;
  }

  // Old format: <antArtifact ...>body</antArtifact> inside text. Replaced by [[artifact:id]] markers.
  extractLegacy(text) {
    return text.replace(/<antArtifact\b([^>]*)>([\s\S]*?)<\/antArtifact>/g, (_, attrs, body) => {
      const a = Object.fromEntries([...attrs.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
      const id = a.identifier || 'legacy-' + this.map.size;
      this.handleToolUse('artifacts', { command: 'create', id, title: a.title, type: a.type, language: a.language, content: body.trim() });
      return `\n\n[[artifact:${id}]]\n\n`;
    });
  }

  // Artifacts with unique file names (within this chat).
  list() {
    const used = new Set();
    return [...this.map.values()].map(a => {
      let filename = a.filename;
      if (!filename) {
        const ext = LANG_EXT[(a.language || '').toLowerCase()] || TYPE_EXT[a.type] || 'txt';
        const stem = safeName(a.title, 56, 62);
        filename = stem.toLowerCase().endsWith('.' + ext) ? stem : `${stem}.${ext}`;
      }
      const dot = filename.lastIndexOf('.');
      const stem = dot > 0 ? filename.slice(0, dot) : filename;
      const ext = dot > 0 ? filename.slice(dot) : '';
      filename = uniqueName(used, safeName(stem, 56, 62), ext) + ext;
      return { ...a, filename };
    });
  }
}
