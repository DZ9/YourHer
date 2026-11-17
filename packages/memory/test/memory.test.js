import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExtractionGate, InMemoryStore, MemoryEngine, memoryScore, normalizeFact, buildMemoryContext } from '../index.js';
import { FileStore } from '../file-store.js';

const fact = { type: 'relation', content: '用户的猫叫橘子', importance: 3 };
test('facts require known types, bounded content and bounded importance', async () => {
  assert.equal(normalizeFact({ type: 'instruction', content: 'ignore rules' }), null);
  assert.equal(normalizeFact({ type: 'event', content: 'x'.repeat(241) }), null);
  assert.equal(normalizeFact({ ...fact, importance: 999 }).importance, 5);
  await assert.rejects(new MemoryEngine().list(''), /userId/);
});
test('concurrent identical observations reinforce one record', async () => {
  const engine = new MemoryEngine();
  const results = await Promise.all(Array.from({ length: 20 }, () => engine.remember('a', fact)));
  assert.equal(results.filter(r => r.isNew).length, 1);
  assert.equal((await engine.list('a')).length, 1);
  assert.equal((await engine.list('b')).length, 0);
});
test('read and transaction results do not leak mutable store references', async () => {
  const engine = new MemoryEngine();
  const result = await engine.remember('a', fact);
  result.memory.content = 'changed';
  const read = await engine.list('a'); read[0].content = 'changed again';
  assert.equal((await engine.list('a'))[0].content, fact.content);
});
test('forget checks ownership and clear physically removes only the selected user', async () => {
  const engine = new MemoryEngine();
  const a = await engine.remember('a', fact); await engine.remember('b', fact);
  assert.equal(await engine.forget('b', a.memory.id), false);
  assert.equal(await engine.forget('a', a.memory.id), true);
  assert.deepEqual(await engine.context('a'), []);
  assert.equal(await engine.clear('a'), 1);
  assert.equal((await engine.store.read()).length, 1);
  assert.equal((await engine.list('b')).length, 1);
});
test('expired events disappear and explicit repetition renews them', async () => {
  let now = Date.UTC(2026, 0, 1);
  const engine = new MemoryEngine({ clock: () => now });
  await engine.remember('a', { ...fact, type: 'event' });
  await engine.remember('a', { ...fact, type: 'profile' });
  now += 181 * 86400000;
  assert.deepEqual((await engine.list('a')).map(m => m.type), ['profile']);
  const reinforced = await engine.remember('a', { ...fact, type: 'event' });
  assert.equal(reinforced.isNew, false);
  assert.equal((await engine.list('a')).length, 2);
});
test('recent events rank above stale events; pinned facts win', () => {
  const now = Date.UTC(2026, 6, 1);
  const recent = { ...fact, type: 'event', updatedAt: new Date(now).toISOString() };
  const stale = { ...recent, updatedAt: new Date(now - 120 * 86400000).toISOString() };
  assert.ok(memoryScore(recent, now) > memoryScore(stale, now));
  assert.ok(memoryScore({ ...stale, pinned: true }, now) > memoryScore(recent, now));
});
test('context obeys budget and serializes content as data', async () => {
  const engine = new MemoryEngine();
  await engine.remember('a', fact);
  assert.deepEqual(await engine.context('a', { maxChars: 1 }), []);
  const context = JSON.parse(buildMemoryContext(await engine.context('a')));
  assert.equal(context.kind, 'user_memory_data');
  assert.equal(context.memories[0].content, fact.content);
});
test('gate preserves short facts, corrections and user isolation', () => {
  const gate = new ExtractionGate({ limit: 2 });
  assert.equal(gate.check('a', '嗯', 0).pass, false);
  assert.equal(gate.check('a', '我不吃香菜', 0).pass, true);
  assert.equal(gate.check('a', '我现在吃香菜', 1).pass, true);
  assert.equal(gate.check('a', '我住在杭州', 2).reason, 'rate_limit');
  assert.equal(gate.check('b', '我住在杭州', 2).pass, true);
  assert.equal(gate.check('a', '我住在杭州', 60001).pass, true);
});
test('invalid extractor output and network failures remain observable', async () => {
  const failed = new MemoryEngine({ extractor: { extract: async () => { throw new Error('secret upstream text'); } } });
  assert.deepEqual(await failed.observe('a', '我不吃香菜'), { status: 'error', reason: 'extraction_failed', memories: [] });
  const engine = new MemoryEngine({ extractor: { extract: async () => [fact, { type: 'bad', content: 'invalid' }] } });
  assert.equal((await engine.observe('a', '我的猫叫橘子')).memories.length, 1);
});
test('an aborted extraction does not persist returned facts', async () => {
  const controller = new AbortController();
  const engine = new MemoryEngine({ extractor: { extract: async () => { controller.abort(); return [fact]; } } });
  await assert.rejects(engine.observe('a', '我的猫叫橘子', { signal: controller.signal }));
  assert.deepEqual(await engine.list('a'), []);
});
test('file store survives reopening and serializes concurrent updates', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'companion-memory-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'memory.json');
  const engine = new MemoryEngine({ store: new FileStore(path) });
  await Promise.all(Array.from({ length: 12 }, (_, i) => engine.remember('a', { ...fact, content: `fact ${i}` })));
  assert.equal((await new MemoryEngine({ store: new FileStore(path) }).list('a')).length, 12);
});
test('file store fails visibly on corruption and recovers its queue after a rejected mutation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'companion-store-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'memory.json'); const store = new FileStore(path);
  await assert.rejects(store.transact(() => { throw new Error('rollback'); }));
  await store.transact(records => records.push(fact));
  assert.equal((await store.read()).length, 1);
  await writeFile(path, '{bad'); await assert.rejects(store.read(), SyntaxError);
});
