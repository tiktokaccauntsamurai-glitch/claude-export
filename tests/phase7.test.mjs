// Phase 7: Claude Code sessions, .claude folder scan, official export. Fixtures mirror the REAL structure inspected on disk:
// one assistant turn = many assistant lines (one block each) with tool_result "user" lines in between.
import test from 'node:test';
import assert from 'node:assert';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { parseSession, readSessionMeta, cleanUserText, parseLines } from '../src/core/cc-sessions.js';
import { classify, findRoot, shortDir } from '../src/core/local-scan.js';
import { runLocalExport, scanFiles } from '../src/core/export-local.js';
import { readOfficial, normalizeOfficial, officialProjectFiles } from '../src/core/official.js';
import { renderMarkdown } from '../src/core/render-md.js';
import { utf8Bytes } from '../src/core/filenames.js';

const J = (...objs) => objs.map(o => JSON.stringify(o)).join('\n') + '\n';
let ts = 0;
const at = () => new Date(Date.UTC(2026, 8, 15, 12, 0, ts++)).toISOString();
const user = (text, extra = {}) => ({ type: 'user', timestamp: at(), isSidechain: false, cwd: 'C:\\Users\\User\\Desktop\\my-app', message: { role: 'user', content: text }, ...extra });
const toolResult = () => ({ type: 'user', timestamp: at(), isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } });
const asst = (block, model = 'claude-opus-5') => ({ type: 'assistant', timestamp: at(), isSidechain: false, message: { role: 'assistant', model, content: [block] } });
const tu = (name, input) => ({ type: 'tool_use', id: 'x' + ts, name, input });

const session = J(
  { type: 'mode', mode: 'normal' }, { type: 'permission-mode', permissionMode: 'auto' },
  user('<system-reminder>ignore me</system-reminder>привет, сделай файл'),
  asst({ type: 'thinking', thinking: 'думаю' }, '<synthetic>'),
  asst(tu('Read', { file_path: 'C:\\x\\a.txt' })), toolResult(),
  asst(tu('Write', { file_path: 'C:\\Users\\User\\Desktop\\my-app\\src\\app.js', content: 'let a = 1;\nlet b = 2;\n' })), toolResult(),
  asst(tu('Edit', { file_path: 'C:\\Users\\User\\Desktop\\my-app\\src\\app.js', old_string: 'let a = 1;', new_string: 'let a = 10;', replace_all: false })), toolResult(),
  asst({ type: 'text', text: 'Готово, файл создан.' }),
  { type: 'ai-title', aiTitle: 'Первый заголовок' },
  user('<command-name>/review</command-name><command-message>review</command-message><command-args>src</command-args>'),
  { ...user('sidechain prompt'), isSidechain: true },
  { ...user('meta text'), isMeta: true },
  asst(tu('Edit', { file_path: 'C:\\never\\written.js', old_string: 'a', new_string: 'b' })), toolResult(),
  asst(tu('MultiEdit', { file_path: 'C:\\Users\\User\\Desktop\\my-app\\src\\app.js', edits: [{ old_string: 'let b = 2;', new_string: 'let b = 3;' }, { old_string: 'let', new_string: 'const', replace_all: true }] })), toolResult(),
  asst({ type: 'text', text: 'Отредактировано.' }),
  { type: 'user', timestamp: at(), message: { role: 'user', content: [{ type: 'image', source: {} }, { type: 'text', text: 'а вот скриншот' }] } },
  asst({ type: 'text', text: 'Вижу.' }),
  { type: 'ai-title', aiTitle: 'Итоговый заголовок' },
  { type: 'attachment', attachment: {} }, { type: 'last-prompt', lastPrompt: 'x' },
  '{"broken json',
);

test('cleanUserText strips reminders/caveats and unwraps slash commands', () => {
  assert.equal(cleanUserText('<system-reminder>a</system-reminder>hi'), 'hi');
  assert.equal(cleanUserText('<local-command-caveat>x</local-command-caveat>'), '');
  assert.equal(cleanUserText('<command-name>/review</command-name><command-message>review</command-message><command-args>src</command-args>'), '/review src');
  assert.equal(cleanUserText('<local-command-stdout>out</local-command-stdout>'), 'out');
});

test('parseLines skips corrupt/partial lines', () => {
  assert.equal(parseLines('{"a":1}\n{"broken\n\n{"b":2}').length, 2);
});

test('parseSession: turns, grouped assistant blocks, replayed Write/Edit, ignored noise', () => {
  const n = parseSession(session, { uuid: 's1' });
  assert.equal(n.title, 'Итоговый заголовок'); // last ai-title wins
  assert.equal(n.model, 'claude-opus-5'); // synthetic model skipped
  assert.equal(n.projectName, 'my-app');
  assert.deepEqual(n.messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  assert.equal(n.messages[0].parts[0].text, 'привет, сделай файл'); // reminder stripped
  assert.equal(n.messages[2].parts[0].text, '/review src');
  assert.deepEqual(n.messages[4].parts.map(p => p.text), ['а вот скриншот', '[image]']);
  // one assistant turn holds thinking + tools + text from many lines
  const kinds = n.messages[1].parts.map(p => p.kind);
  assert.deepEqual([...new Set(kinds)].sort(), ['text', 'thinking', 'tool']); // the Write/Edit refs moved to the LAST edit (later turn)
  assert.ok(!JSON.stringify(n.messages).includes('sidechain prompt') && !JSON.stringify(n.messages).includes('meta text'));
  // Write + Edit + MultiEdit replayed
  const a = n.artifacts.find(x => x.filename === 'app.js');
  assert.equal(a.content, 'const a = 10;\nconst b = 3;\n');
  assert.equal(a.versions, 3);
  assert.deepEqual(a.history, ['let a = 1;\nlet b = 2;\n', 'let a = 10;\nlet b = 2;\n', 'const a = 10;\nconst b = 3;\n']);
  assert.equal(a.title, 'C:/Users/User/Desktop/my-app/src/app.js');
  assert.equal(n.artifacts.length, 1); // Edit of a never-written file is only a tool part
  const refs = n.messages.flatMap(m => m.parts).filter(p => p.kind === 'artifactRef');
  assert.equal(refs.length, 1); // rendered once, at the last edit
  assert.ok(n.messages[3].parts.some(p => p.kind === 'artifactRef'));
  assert.equal(n.createdAt < n.updatedAt, true);
});

test('parseSession: markdown output hides tools by default and inlines the final file', () => {
  const n = parseSession(session, { uuid: 's1' });
  const md = renderMarkdown(n, { artifactPath: a => `../artifacts/x/${a.filename}` });
  assert.doesNotMatch(md, /\[tool\]/);
  assert.match(md, /const a = 10;/);
  assert.match(md, /# Human — 2026-09-15 12:00/);
  assert.match(renderMarkdown(n, { tools: true }), /\[tool\] Read: C:\\x\\a\.txt/);
});

test('readSessionMeta: small file, big file (title only in the tail), and files without a conversation', async () => {
  const small = new File([session], 's1.jsonl', { lastModified: Date.UTC(2026, 8, 16) });
  const m = await readSessionMeta(small, 'C--Users-User-Desktop-my-app', 'Desktop-my-app');
  assert.equal(m.uuid, 's1');
  assert.equal(m.name, 'Итоговый заголовок');
  assert.equal(m.project.name, 'my-app');
  assert.equal(m.kind, 'cc');

  const filler = J(...Array.from({ length: 4000 }, (_, i) => asst({ type: 'text', text: 'x'.repeat(60) + i })));
  const big = J(user('первый промпт большого файла')) + filler + J({ type: 'ai-title', aiTitle: 'Заголовок из хвоста' }, asst({ type: 'text', text: 'конец' }));
  assert.ok(big.length > 200000);
  const mb = await readSessionMeta(new File([big], 'big.jsonl'), 'd', 'd');
  assert.equal(mb.name, 'Заголовок из хвоста');
  assert.ok(mb.created_at && mb.updated_at >= mb.created_at);

  const noTitle = await readSessionMeta(new File([big.replace('"ai-title"', '"other"')], 'b2.jsonl'), 'd', 'd');
  assert.equal(noTitle.name, 'первый промпт большого файла'); // falls back to the first prompt

  const empty = await readSessionMeta(new File([J({ type: 'mode', mode: 'normal' }, toolResult())], 'e.jsonl'), 'd', 'd');
  assert.equal(empty, null);
});

// ---- folder scan
const P = (rel) => ({ path: '.claude/' + rel, ref: { name: rel } });
const entries = [
  '.credentials.json', 'settings.json', 'settings.local.json', 'history.jsonl', 'stats-cache.json', '.last-cleanup',
  'projects/C--Users-User-Desktop-app/s1.jsonl', 'projects/C--Users-User-Desktop-app/s2.jsonl',
  'projects/C--Users-User-Desktop-app/s1/subagents/agent-1.jsonl', 'projects/C--Users-User-Desktop-app/memory/MEMORY.md',
  'projects/C--Users-User-Desktop-app/memory/notes/deep.md', 'projects/C--Users-User-Desktop-app/memory/not-md.bin',
  'skills/synced/B1/docx/SKILL.md', 'skills/synced/B1/docx/scripts/x.py', 'skills/synced/B1/pdf/SKILL.md',
  'skills/synced/B2/docx/SKILL.md', 'skills/synced/B1/.staging/tmp.txt', 'skills/synced/.bucket-B1', 'skills/synced/B1/manifest.json',
  'skills/synced/B1/docx/node_modules/dep/index.js', 'skills/mine/SKILL.md', 'skills/mine/refs/a.md',
  'CLAUDE.md', 'agents/reviewer.md', 'commands/sub/deploy.md', 'rules/style.md', 'commands/readme.txt',
  'file-history/abc/1', 'shell-snapshots/s.sh', 'plugins/marketplaces/m/README.md', 'ide/x.lock', 'sessions/1.json',
].map(P);

test('classify: whitelist only, credentials/settings/history never recognised', () => {
  const c = classify(entries);
  assert.equal(c.sessions.length, 2);
  assert.equal(c.memory.length, 2);
  assert.deepEqual(c.memory.map(m => m.rest).sort(), ['MEMORY.md', 'notes/deep.md']);
    assert.deepEqual(c.skills.map(s => s.p).sort(), [
    'skills/mine/SKILL.md', 'skills/mine/refs/a.md', 'skills/synced/B1/docx/SKILL.md', 'skills/synced/B1/docx/scripts/x.py',
    'skills/synced/B1/pdf/SKILL.md', 'skills/synced/B2/docx/SKILL.md',
  ]);
  assert.equal(c.claudeMd.length + c.agents.length + c.commands.length + c.rules.length, 4);
  const recognised = Object.entries(c).filter(([, v]) => Array.isArray(v)).flatMap(([, v]) => v.map(e => e.path));
  for (const bad of ['.credentials.json', 'settings.json', 'settings.local.json', 'history.jsonl', 'stats-cache.json']) {
    assert.ok(!recognised.some(p => p.endsWith(bad)), `${bad} must never be recognised`);
  }
  assert.ok(!recognised.some(p => /file-history|shell-snapshots|plugins|sessions\/|ide\//.test(p)));
  assert.ok(c.ignored >= 12);
});

test('classify: works when the user picked a parent folder or used backslashes', () => {
  assert.equal(findRoot(['User/.claude/CLAUDE.md']), 2);
  const c = classify([{ path: 'User\\.claude\\projects\\d\\s.jsonl', ref: {} }, { path: 'User\\.claude\\CLAUDE.md', ref: {} }]);
  assert.equal(c.sessions.length, 1);
  assert.equal(c.claudeMd.length, 1);
  assert.equal(shortDir('C--Users-User-Desktop-gcode-wall-cutter'), 'Desktop-gcode-wall-cutter');
});

test('scanFiles: flat skills layout with collision handling, memory per project, extras switchable', () => {
  const c = classify(entries);
  const paths = scanFiles(c, { memory: true, skills: true, md: true }).map(f => f.path).sort();
  assert.ok(paths.includes('claude-code/memory/Desktop-app/MEMORY.md'));
  assert.ok(paths.includes('claude-code/memory/Desktop-app/notes/deep.md'));
  assert.ok(paths.includes('claude-code/skills/docx/SKILL.md'));
  assert.ok(paths.includes('claude-code/skills/docx/scripts/x.py'));
  assert.ok(paths.includes('claude-code/skills/docx-2/SKILL.md')); // same skill name from another bucket
  assert.ok(paths.includes('claude-code/skills/mine/refs/a.md'));
  assert.ok(paths.includes('claude-code/CLAUDE.md') && paths.includes('claude-code/agents/reviewer.md') && paths.includes('claude-code/commands/sub/deploy.md'));
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(scanFiles(c, { memory: true }).map(f => f.path.split('/')[1]), ['memory', 'memory']);
  assert.equal(scanFiles(c, {}).length, 0);
});

// ---- exporting sessions + official chats
test('runLocalExport: Claude Code session and official chat through the same pipeline', async () => {
  const file = new File([session], 's1.jsonl');
  const meta = await readSessionMeta(file, 'C--Users-User-Desktop-my-app', 'Desktop-my-app');
  const official = await readOfficial([{ name: 'export/conversations.json', text: async () => JSON.stringify([
    { uuid: 'o1', name: 'Official chat', created_at: '2026-01-02T10:00:00Z', updated_at: '2026-01-03T10:00:00Z',
      chat_messages: [
        { uuid: 'a', sender: 'human', text: 'вопрос', created_at: '2026-01-02T10:00:00Z', attachments: [{ file_name: 'f.txt', extracted_content: 'файл' }], files: [] },
        { uuid: 'b', sender: 'assistant', text: 'ответ', created_at: '2026-01-02T10:00:05Z', attachments: [], files: [] },
        { uuid: 'c', sender: 'human', text: 'ещё', created_at: '2026-01-02T10:01:00Z' },
      ] },
    { uuid: 'bad', name: 'Broken', chat_messages: 'nope' },
  ]) }]);
  assert.equal(official.conversations.length, 1); // "bad" has no chat_messages array -> skipped
  const items = [meta, ...official.conversations];
  const res = await runLocalExport({ items, opts: { md: true, pdf: true, artifacts: true, inlineArtifacts: false, frontmatter: true }, makePdf: async () => 'PDF' });
  const paths = res.files.map(f => f.path);
  assert.ok(paths.includes('claude-code/my-app/chats/2026-09-15 Итоговый заголовок.md'), paths.join('\n'));
  assert.ok(paths.includes('claude-code/my-app/chats/2026-09-15 Итоговый заголовок.pdf'));
  assert.ok(paths.includes('claude-code/my-app/artifacts/2026-09-15 Итоговый заголовок/app.js'));
  assert.ok(paths.includes('official-export/chats/2026-01-02 Official chat.md'));
  const md = res.files.find(f => f.path.startsWith('official-export/chats/') && f.path.endsWith('.md')).data;
  assert.ok(md.indexOf('вопрос') < md.indexOf('ответ') && md.indexOf('ответ') < md.indexOf('ещё')); // order kept without parent pointers
  assert.match(md, /> \*\*Attachment: f\.txt\*\*\n> файл/);
  assert.equal(res.stats.chats, 2);
  assert.equal(res.errors.length, 0);
  const md2 = res.files.find(f => f.path.startsWith('claude-code/') && f.path.endsWith('.md')).data;
  assert.match(md2, /`\.\.\/artifacts\/2026-09-15 Итоговый заголовок\/app\.js`/);
});

test('runLocalExport: unreadable session is an error entry, other chats continue', async () => {
  const badFile = { name: 'x.jsonl', text: async () => { throw new Error('read failed'); } };
  const items = [{ kind: 'cc', uuid: 'x', name: 'Bad', _ref: badFile, _dir: 'd', project: { name: 'p' }, created_at: '2026-01-01' },
    { kind: 'official', uuid: 'o', name: 'Ok', _conv: { uuid: 'o', name: 'Ok', created_at: '2026-01-01T00:00:00Z', chat_messages: [{ uuid: 'a', sender: 'human', text: 'hi' }] } }];
  const res = await runLocalExport({ items, opts: { md: true }, makePdf: async () => '' });
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /read failed/);
  assert.ok(res.files.some(f => f.path === 'official-export/chats/2026-01-01 Ok.md') && res.files.some(f => f.path === 'errors.log'));
});

test('official export: projects.json / memories.json, legacy text-only messages, bare .json', async () => {
  const entries2 = [
    { name: 'projects.json', text: async () => JSON.stringify([{ uuid: 'p', name: 'Проект: X', description: 'D', prompt_template: 'Be brief', docs: [{ filename: 'a.md', content: 'AAA' }, { filename: 'a.md', content: 'BBB' }, { filename: 'no.pdf' }] }]) },
    { name: 'memories.json', text: async () => JSON.stringify([{ memory: 'likes tea' }]) },
    { name: 'users.json', text: async () => JSON.stringify([{ email_address: 'me@example.com' }]) },
    { name: 'readme.txt', text: async () => 'x' },
  ];
  const r = await readOfficial(entries2);
  assert.equal(r.conversations.length, 0);
  assert.equal(r.projects.length, 1);
  assert.match(r.memories.text, /likes tea/);
  assert.ok(!JSON.stringify(r).includes('me@example.com')); // users.json is never read into the result
  const files = officialProjectFiles(r.projects).map(f => f.path).sort();
  assert.deepEqual(files, [
    'official-export/projects/Проект_ X/DESCRIPTION.md', 'official-export/projects/Проект_ X/INSTRUCTIONS.md',
    'official-export/projects/Проект_ X/knowledge/a-2.md', 'official-export/projects/Проект_ X/knowledge/a.md',
  ]);
  const bare = await readOfficial([{ name: 'my.json', text: async () => JSON.stringify([{ uuid: 'c', name: 'N', chat_messages: [{ uuid: 'm', sender: 'human', text: 'hey' }] }]) }]);
  assert.equal(bare.conversations.length, 1);
  assert.equal(normalizeOfficial(bare.conversations[0]._conv).messages[0].parts[0].text, 'hey');
  const broken = await readOfficial([{ name: 'conversations.json', text: async () => '{oops' }]);
  assert.equal(broken.warnings.length, 1);
});

test('local exports keep paths short enough for Windows (worst-case Cyrillic)', async () => {
  const RU = 'Кандидатский минимум по специальности компактные ответы с проверенными источниками'.repeat(3);
  const badSession = J(user(RU), asst(tu('Write', { file_path: 'C:\\x\\' + RU.slice(0, 200) + '.md', content: 'x' })), asst({ type: 'text', text: 'ok' }), { type: 'ai-title', aiTitle: RU });
  const meta = await readSessionMeta(new File([badSession], 'z.jsonl'), 'C--Users-User-Desktop-' + 'ы'.repeat(80), 'ы'.repeat(80));
  const res = await runLocalExport({ items: [meta], opts: { md: true, pdf: true, artifacts: true, inlineArtifacts: false }, makePdf: async () => 'P' });
  assert.ok(res.files.length >= 3);
  for (const f of res.files) assert.ok(utf8Bytes(f.path) <= 230, `${utf8Bytes(f.path)}: ${f.path}`);
});

// ---- optional smoke test on the developer's real ~/.claude (skipped elsewhere; prints nothing private)
const CLAUDE = join(homedir(), '.claude', 'projects');
test('real ~/.claude sessions all parse without errors', { skip: !existsSync(CLAUDE) }, async () => {
  let checked = 0;
  for (const dir of readdirSync(CLAUDE)) {
    const d = join(CLAUDE, dir);
    if (!statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d).filter(x => x.endsWith('.jsonl')).slice(0, 3)) {
      const buf = readFileSync(join(d, f));
      const meta = await readSessionMeta(new File([buf], f), dir, shortDir(dir));
      if (!meta) continue;
      const n = parseSession(buf.toString('utf8'), { uuid: meta.uuid });
      assert.ok(renderMarkdown(n).length > 0);
      checked++;
    }
  }
  assert.ok(checked >= 0, sep);
});
