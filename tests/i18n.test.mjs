import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { DICT, t } from '../src/i18n.js';

test('i18n: en and ru have identical keys, no empty values', () => {
  assert.deepEqual(Object.keys(DICT.en).sort(), Object.keys(DICT.ru).sort());
  for (const l of ['en', 'ru']) for (const [k, v] of Object.entries(DICT[l])) assert.ok(v.length, `${l}.${k} empty`);
});

test('i18n: params, and default language is English', () => {
  assert.equal(t('to_export', { n: 5 }), 'To export: 5');
});

test('i18n: every data-i18n key used in html exists', () => {
  for (const f of ['export/export.html', 'popup/popup.html']) {
    const html = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const m of html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) assert.ok(m[1] in DICT.en, `${f}: missing ${m[1]}`);
  }
});

test('i18n: every t(\'key\') literal used in js exists', () => {
  for (const f of ['export/export.js', 'popup/popup.js']) {
    const js = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const m of js.matchAll(/\bt\('([a-z_]+)'/g)) assert.ok(m[1] in DICT.en, `${f}: missing ${m[1]}`);
  }
});
