// Classifies the files of a user-selected ~/.claude folder. WHITELIST only: credentials, settings, history,
// caches and everything unknown are never matched, so they can never be read or exported.
//
// input:  [{ path: 'webkitRelativePath', ref }]   output: { sessions, memory, skills, claudeMd, agents, commands, rules, ignored }

const SKIP_DIRS = /(^|\/)(node_modules|\.git|__pycache__|\.staging|\.bucket-[^/]*)(\/|$)/;

export function findRoot(paths) {
  // the user may pick ".claude" itself (root = 1 segment) or a parent folder that contains ".claude"
  for (const p of paths) {
    const segs = p.split('/');
    const i = segs.indexOf('.claude');
    if (i >= 0) return i + 1;
  }
  return 1;
}

export function classify(entries) {
  const out = { sessions: [], memory: [], skills: [], claudeMd: [], agents: [], commands: [], rules: [], ignored: 0 };
  const root = findRoot(entries.map(e => String(e.path).replace(/\\/g, '/')));
  for (const e of entries) {
    const full = String(e.path).replace(/\\/g, '/');
    const p = full.split('/').slice(root).join('/');
    let m;
    if ((m = /^projects\/([^/]+)\/([^/]+)\.jsonl$/.exec(p))) out.sessions.push({ ...e, p, dir: m[1] });
    else if ((m = /^projects\/([^/]+)\/memory\/(.+\.md)$/i.exec(p))) out.memory.push({ ...e, p, dir: m[1], rest: m[2] });
    else if (/^skills\/.+/.test(p) && !SKIP_DIRS.test(p) && !/^skills\/synced\/[^/]+\/manifest\.json$/.test(p)) out.skills.push({ ...e, p });
    else if (p === 'CLAUDE.md') out.claudeMd.push({ ...e, p });
    else if (/^agents\/.+\.md$/i.test(p)) out.agents.push({ ...e, p });
    else if (/^commands\/.+\.md$/i.test(p)) out.commands.push({ ...e, p });
    else if (/^rules\/.+\.md$/i.test(p)) out.rules.push({ ...e, p });
    else out.ignored++;
  }
  return out;
}

export const fromFileList = (fileList) => Array.from(fileList, f => ({ path: f.webkitRelativePath || f.name, ref: f }));

// "C--Users-User-Desktop-my-app" -> "Desktop-my-app"
export const shortDir = (dir) => String(dir).replace(/^[A-Za-z]--Users-[^-]+-/, '').replace(/^-+/, '') || String(dir);
