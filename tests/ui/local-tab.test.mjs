// UI tests of the "Claude Code & files" tab: folder picker and official ZIP, through the real page code.
import test from 'node:test';
import assert from 'node:assert';
import { loadPage, waitFor, getJSZip } from './harness.mjs';
import { makeBackend } from './fixtures.mjs';

async function boot(o = {}) {
  const p = await loadPage({ page: 'export', fx: makeBackend(), ...o });
  await waitFor(() => p.text('exportBtn') !== '');
  await p.tab('local');
  return p;
}

const J = (...o) => o.map(x => JSON.stringify(x)).join('\n') + '\n';
const session = J(
  { type: 'user', timestamp: '2026-09-15T12:00:00Z', cwd: 'C:\\Users\\User\\Desktop\\my-app', message: { role: 'user', content: 'сделай файл' } },
  { type: 'assistant', timestamp: '2026-09-15T12:00:05Z', message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'tool_use', id: 'a', name: 'Write', input: { file_path: 'C:\\Users\\User\\Desktop\\my-app\\a.js', content: 'let a = 1;' } }] } },
  { type: 'user', timestamp: '2026-09-15T12:00:06Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] } },
  { type: 'assistant', timestamp: '2026-09-15T12:00:07Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Готово' }] } },
  { type: 'ai-title', aiTitle: 'Файл для проверки' },
);

const file = (rel, content) => {
  const f = new File([content], rel.split('/').pop(), { lastModified: Date.UTC(2026, 8, 16) });
  Object.defineProperty(f, 'webkitRelativePath', { value: rel });
  return f;
};
// a file that must never be read: any access throws
const forbidden = (rel) => {
  const f = file(rel, 'SECRET');
  for (const m of ['text', 'arrayBuffer', 'slice', 'stream']) Object.defineProperty(f, m, { value() { throw new Error('READ FORBIDDEN FILE ' + rel); } });
  return f;
};
const folder = () => [
  file('.claude/projects/C--Users-User-Desktop-my-app/s1.jsonl', session),
  file('.claude/projects/C--Users-User-Desktop-my-app/junk.jsonl', J({ type: 'mode', mode: 'normal' })),
  file('.claude/projects/C--Users-User-Desktop-my-app/memory/MEMORY.md', '# memory'),
  file('.claude/skills/synced/B1/docx/SKILL.md', '# docx skill'),
  file('.claude/skills/mine/SKILL.md', '# my skill'),
  file('.claude/CLAUDE.md', '# rules'),
  file('.claude/agents/rev.md', '# agent'),
  forbidden('.claude/.credentials.json'), forbidden('.claude/settings.json'), forbidden('.claude/history.jsonl'),
  forbidden('.claude/plugins/marketplaces/x/README.md'),
];
const names = (zip) => Object.keys(zip.files).filter(n => !zip.files[n].dir);
const finish = (p) => waitFor(() => /Done|Error|Ошибка|Готово/.test(p.text('out')), { timeout: 15000, what: 'export result' }).then(() => p.text('out'));

test('picking .claude: counts, sessions table, sensitive files never read; export everything', async () => {
  const p = await boot();
  p.setFiles('ccPick', folder());
  await waitFor(() => p.text('ccInfo').startsWith('Sessions: 1'), { what: 'scan' });
  assert.equal(p.text('ccInfo'), 'Sessions: 1, memory files: 1, skills files: 2, CLAUDE.md / agents / commands / rules: 2');
  const rows = [...p.$('tbl').tBodies[0].rows];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells[1].textContent, 'Файл для проверки');
  assert.equal(rows[0].cells[2].textContent, 'my-app');
  assert.equal(p.text('count'), 'To export: 6'); // 1 session + 1 memory + 2 skills + CLAUDE.md + 1 agent
  assert.equal(p.$('main').hidden, false);
  assert.equal([...p.$('project').options].map(o => o.textContent).join('|'), 'All projects|my-app');
  await p.click('exportBtn');
  const out = await finish(p);
  assert.match(out, /Done: chats 1, files 7, errors 0/);
  const zip = await p.readZip();
  assert.deepEqual(names(zip).sort(), [
    'claude-code/CLAUDE.md', 'claude-code/agents/rev.md',
    'claude-code/memory/Desktop-my-app/MEMORY.md',
    'claude-code/my-app/artifacts/2026-09-15 Файл для проверки/a.js',
    'claude-code/my-app/chats/2026-09-15 Файл для проверки.md',
    'claude-code/skills/docx/SKILL.md', 'claude-code/skills/mine/SKILL.md',
  ].sort());
  assert.equal(await zip.file('claude-code/skills/docx/SKILL.md').async('string'), '# docx skill');
  const md = await zip.file('claude-code/my-app/chats/2026-09-15 Файл для проверки.md').async('string');
  assert.match(md, /сделай файл/);
  assert.match(md, /let a = 1;/);
  assert.deepEqual(p.errors, []);
  p.close();
});

test('extras can be switched off; only chosen sessions exported', async () => {
  const p = await boot();
  p.setFiles('ccPick', folder());
  await waitFor(() => p.text('ccInfo').startsWith('Sessions: 1'));
  for (const id of ['oLcMemory', 'oLcSkills', 'oLcMd']) p.check(id, false);
  assert.equal(p.text('count'), 'To export: 1');
  p.w.document.querySelector('input[name=mode][value=selected]').click();
  assert.equal(p.$('exportBtn').disabled, true);
  p.$('tbl').tBodies[0].rows[0].cells[0].firstChild.click();
  p.check('oArtifacts', false);
  p.w.document.querySelector('input[name=pack][value=files]').click();
  await p.click('exportBtn');
  await finish(p);
  await waitFor(() => p.log.downloads.length === 1);
  assert.match(p.log.downloads[0].filename, /\/claude-code\/my-app\/chats\/2026-09-15 Файл для проверки\.md$/);
  p.close();
});

test('wrong folder: friendly message, nothing offered', async () => {
  const p = await boot();
  p.setFiles('ccPick', [file('Documents/notes/a.txt', 'x')]);
  await waitFor(() => p.text('ccInfo') === 'Nothing recognised. Choose the .claude folder itself.');
  assert.equal(p.$('main').hidden, true);
  assert.equal(p.$('exportBtn').disabled, true);
  p.close();
});

const officialZip = async () => {
  const z = new (getJSZip())();
  z.file('conversations.json', JSON.stringify([{ uuid: 'o1', name: 'Официальный чат', created_at: '2026-02-01T10:00:00Z', updated_at: '2026-02-02T10:00:00Z',
    chat_messages: [{ uuid: 'm1', sender: 'human', text: 'вопрос', created_at: '2026-02-01T10:00:00Z', attachments: [{ file_name: 'a.txt', extracted_content: 'ФАЙЛ' }], files: [] },
      { uuid: 'm2', sender: 'assistant', text: 'ответ', created_at: '2026-02-01T10:00:05Z', attachments: [], files: [] }] }]));
  z.file('projects.json', JSON.stringify([{ uuid: 'p', name: 'ПроектX', prompt_template: 'Кратко', docs: [{ filename: 'k.md', content: 'ЗНАНИЯ' }] }]));
  z.file('users.json', JSON.stringify([{ email_address: 'me@example.com' }]));
  return new File([await z.generateAsync({ type: 'nodebuffer' })], 'data-2026.zip');
};

test('official export ZIP: chats listed, exported with projects; users.json ignored', async () => {
  const p = await boot();
  p.setFiles('offPick', [await officialZip()]);
  await waitFor(() => p.text('offInfo') === 'Conversations: 1, projects: 1', { what: 'official read' });
  const rows = [...p.$('tbl').tBodies[0].rows];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells[1].textContent, 'Официальный чат');
  await p.click('exportBtn');
  await finish(p);
  const zip = await p.readZip();
  assert.deepEqual(names(zip).sort(), [
    'official-export/chats/2026-02-01 Официальный чат.md',
    'official-export/projects/ПроектX/INSTRUCTIONS.md', 'official-export/projects/ПроектX/knowledge/k.md',
  ].sort());
  const md = await zip.file('official-export/chats/2026-02-01 Официальный чат.md').async('string');
  assert.ok(md.indexOf('вопрос') < md.indexOf('ответ'));
  assert.match(md, /> \*\*Attachment: a\.txt\*\*\n> ФАЙЛ/);
  assert.ok(!(await Promise.all(names(zip).map(n => zip.file(n).async('string')))).join('').includes('me@example.com'));
  p.close();
});

test('bare conversations.json and a broken file', async () => {
  const p = await boot();
  const bare = new File([JSON.stringify([{ uuid: 'c', name: 'Bare', created_at: '2026-03-01T00:00:00Z', chat_messages: [{ uuid: 'm', sender: 'human', text: 'hey' }] }])], 'conversations.json');
  p.setFiles('offPick', [bare]);
  await waitFor(() => p.text('offInfo') === 'Conversations: 1, projects: 0');
  p.setFiles('offPick', [new File(['{not json'], 'conversations.json')]);
  await waitFor(() => p.text('offInfo') === 'No conversations found in this file.');
  p.close();
});

test('sessions and official chats live in one table; each source replaces only itself', async () => {
  const p = await boot();
  p.setFiles('ccPick', folder());
  await waitFor(() => p.text('ccInfo').startsWith('Sessions: 1'));
  p.setFiles('offPick', [await officialZip()]);
  await waitFor(() => p.$('tbl').tBodies[0].rows.length === 2);
  p.setFiles('ccPick', [file('nothing/here.txt', 'x')]); // cc source emptied
  await waitFor(() => p.$('tbl').tBodies[0].rows.length === 1);
  assert.equal(p.$('tbl').tBodies[0].rows[0].cells[1].textContent, 'Официальный чат');
  p.close();
});

test('chat tab and local tab keep separate lists and selections', async () => {
  const p = await boot();
  p.setFiles('ccPick', folder());
  await waitFor(() => p.$('tbl').tBodies[0].rows.length === 1);
  await p.tab('chats');
  await p.click('loadBtn');
  await waitFor(() => p.$('tbl').tBodies[0].rows.length === 3);
  p.$('tbl').tBodies[0].rows[0].cells[0].firstChild.click();
  await p.tab('local');
  assert.equal(p.$('tbl').tBodies[0].rows.length, 1);
  assert.equal(p.$('tbl').tBodies[0].rows[0].cells[0].firstChild.checked, false);
  await p.tab('chats');
  assert.equal(p.$('tbl').tBodies[0].rows.length, 3);
  assert.equal(p.$('tbl').tBodies[0].rows[0].cells[0].firstChild.checked, true);
  p.close();
});
