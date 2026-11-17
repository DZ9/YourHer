import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTranslator } from '../index.js';
import { loadConfig } from '../config.js';

test('English and Chinese catalogues support runtime interpolation without fixed language branches', async () => {
  const config = await loadConfig();
  const en = createTranslator({ messages: config.dictionaries.en });
  const zh = createTranslator({ messages: config.dictionaries['zh-CN'] });
  assert.equal(en('聊天'), 'Chat'); assert.equal(zh('聊天'), '聊天');
  assert.equal(en('同行第 12 天'), 'Day 12 together');
  assert.equal(en('上次你提到「work」，想说说吗？'), 'Last time you mentioned “work”. Want to talk about it?');
  assert.equal(en('这个月你来过 {{count}} 天', { count: 5 }), 'You checked in on 5 days this month');
});
test('a third language can be configured from JSON, with fallback and speech metadata', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-i18n-')); t.after(() => rm(root, { recursive: true, force: true }));
  const base = JSON.parse(await readFile('companion.config.json', 'utf8'));
  await writeFile(join(root, 'en.json'), JSON.stringify({ '聊天': 'Chat', '心情': 'Mood' }));
  await writeFile(join(root, 'fr.json'), JSON.stringify({ '聊天': 'Discussion' }));
  base.i18n = { defaultLocale: 'fr', fallbackLocale: 'en', locales: [{ code: 'en', label: 'English', file: 'en.json', speechLocale: 'en-US' }, { code: 'fr', label: 'Français', file: 'fr.json', speechLocale: 'fr-FR', direction: 'ltr' }] };
  await writeFile(join(root, 'config.json'), JSON.stringify(base));
  const config = await loadConfig(join(root, 'config.json'));
  const tfr = createTranslator({ messages: config.dictionaries.fr, fallback: config.dictionaries.en });
  assert.equal(tfr('聊天'), 'Discussion'); assert.equal(tfr('心情'), 'Mood');
  assert.equal(config.i18n.locales[1].speechLocale, 'fr-FR'); assert.ok(!('file' in config.i18n.locales[1]));
});
test('invalid default locale fails before the app starts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-bad-locale-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'config.json'), JSON.stringify({ i18n: { defaultLocale: 'xx', fallbackLocale: 'en', locales: [{ code: 'en' }] } }));
  await assert.rejects(loadConfig(join(root, 'config.json')), /Invalid locale defaults/);
});
