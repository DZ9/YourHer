import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createWebApp } from '../server.js';
import { ProductStore } from '../../../packages/storage/product-store.js';
import { ProductDemoModel } from '../../../packages/providers/index.js';

async function setup(t, model = new ProductDemoModel()) {
  const dir = await mkdtemp(join(tmpdir(), 'cike-web-')); const store = new ProductStore(join(dir, 'product.json'));
  const server = createWebApp({ store, model }); await server.ready; server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function client() {
    let cookie = '';
    async function request(path, method = 'GET', body, headers = {}) {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    }
    await request('/api/state');
    return { request, state: async () => (await request('/api/state')).json(), consent: () => request('/api/profile', 'PATCH', { consent: true, onboardingDone: true, locale: 'zh-CN' }), chat: (message, requestId = randomUUID()) => request('/api/chat', 'POST', { message, requestId }) };
  }
  return { base, store, client };
}
test('full conversation saves raw candidates, clean bubbles, facts and names', async t => {
  const { client } = await setup(t); const c = await client(); await c.consent();
  const raw = await (await c.chat('我养了一只猫叫橘子')).text(); assert.match(raw, /"type":"done"/);
  const replacements = raw.split('\n\n').filter(block => block.startsWith('data: ')).map(block => JSON.parse(block.slice(6))).filter(event => event.type === 'replace');
  assert.ok(replacements.every(event => !/CANDIDATES|\["/.test(event.text)));
  let state = await c.state(); assert.equal(state.messages.length, 2); assert.equal(state.memories.length, 1);
  assert.deepEqual(state.messages[1].replyCandidates, ['先听我说', '慢慢聊吧', '换个话题']);
  assert.match(state.messages[1].rawContent, /__CANDIDATES__/); assert.doesNotMatch(state.messages[1].content, /CANDIDATES/);
  await (await c.chat('我叫小雨')).text(); state = await c.state(); assert.equal(state.user.profile.nickname, '小雨');
});
test('idempotency replays a completed response without a second model request', async t => {
  let calls = 0; const model = new ProductDemoModel(); const original = model.stream.bind(model);
  model.stream = async function* (...args) { calls++; yield* original(...args); };
  const { client } = await setup(t, model); const c = await client(); await c.consent(); const id = randomUUID();
  await (await c.chat('今天有点累', id)).text(); const replay = await (await c.chat('今天有点累', id)).text();
  assert.match(replay, /"replay":true/); assert.equal(calls, 1); assert.equal((await c.state()).messages.length, 2);
  assert.equal((await c.chat('另一句话', id)).status, 409);
});
test('guest isolation covers messages, memories, letters, checkins, exports and deletion', async t => {
  const { client } = await setup(t); const a = await client(); const b = await client(); await a.consent();
  await (await a.chat('我不吃香菜')).text(); await a.request('/api/checkins', 'POST', { mood: 'sad' });
  const stateA = await a.state(), stateB = await b.state(); assert.equal(stateB.messages.length, 0); assert.equal(stateB.memories.length, 0); assert.equal(stateB.checkins.length, 0);
  const deletion = await b.request('/api/memories/' + stateA.memories[0].id, 'DELETE'); assert.equal((await deletion.json()).removed, false);
  const exported = await (await b.request('/api/export')).json(); assert.ok(!JSON.stringify(exported).includes('香菜'));
  assert.ok(!JSON.stringify(stateA).includes('passwordHash')); assert.ok(!JSON.stringify(exported).includes('digest'));
});
test('mood checkin is upserted per day and manual input wins over inferred mood', async t => {
  const { client } = await setup(t); const c = await client(); await c.consent();
  await c.request('/api/checkins', 'POST', { mood: 'calm' }); await (await c.chat('我今天很难过')).text();
  const state = await c.state(); assert.equal(state.checkins.length, 1); assert.equal(state.checkins[0].mood, 'calm'); assert.equal(state.checkins[0].source, 'manual');
});
test('letter generation requires real conversation and is idempotent per week', async t => {
  const { client } = await setup(t); const c = await client(); await c.consent();
  assert.equal((await c.request('/api/letters', 'POST', {})).status, 400);
  for (const text of ['今天有点累', '我养了一只猫叫橘子', '我不吃香菜']) await (await c.chat(text)).text();
  const a = await (await c.request('/api/letters', 'POST', {})).json(); const b = await (await c.request('/api/letters', 'POST', {})).json();
  assert.equal(a.letter.id, b.letter.id); assert.match(a.letter.content, /离线规则示例信/); assert.equal((await c.state()).letters.length, 1);
});
test('registration preserves guest data, login restores account and logout isolates a new guest', async t => {
  const { client } = await setup(t); const c = await client(); await c.consent(); await (await c.chat('我不吃香菜')).text();
  const userId = (await c.state()).user.id;
  assert.equal((await c.request('/api/auth/register', 'POST', { email: 'test@example.invalid', password: 'only-for-test-123' })).status, 200);
  assert.equal((await c.state()).user.id, userId); await c.request('/api/auth/logout', 'POST', {}); assert.equal((await c.state()).messages.length, 0);
  assert.equal((await c.request('/api/auth/login', 'POST', { email: 'test@example.invalid', password: 'wrong-password' })).status, 400);
  assert.equal((await c.request('/api/auth/login', 'POST', { email: 'test@example.invalid', password: 'only-for-test-123' })).status, 200);
  assert.equal((await c.state()).user.id, userId); assert.equal((await c.state()).messages.length, 2);
  const exported = await (await c.request('/api/export')).json(); assert.ok(!JSON.stringify(exported).includes('passwordHash')); assert.ok(!JSON.stringify(exported).includes('only-for-test'));
});
test('feedback and survey persist without fake payment or duplicate rewards', async t => {
  const { client, store } = await setup(t); const c = await client();
  const feedback = await c.request('/api/feedback', 'POST', { type: '体验建议', content: '希望网页也能读信', attachment: null }); assert.equal(feedback.status, 201);
  const survey = { q1: 'caught', q2: '更自然一点', q3: 'yes' }; assert.equal((await c.request('/api/survey', 'POST', survey)).status, 201); assert.equal((await c.request('/api/survey', 'POST', survey)).status, 409);
  const state = await c.state(); assert.equal(state.billing.enabled, false); assert.equal((await store.read('feedback', state.user.id)).length, 1);
});
test('account deletion requires exact confirmation and removes only the current account', async t => {
  const { client, store } = await setup(t); const a = await client(); const b = await client(); const id = (await a.state()).user.id; const bId = (await b.state()).user.id;
  assert.equal((await a.request('/api/account', 'DELETE', { confirm: 'delete' })).status, 400);
  assert.equal((await a.request('/api/account', 'DELETE', { confirm: '删除我的全部数据' })).status, 200);
  assert.equal(await store.user(id), undefined); assert.ok(await store.user(bId)); assert.notEqual((await a.state()).user.id, id);
});
test('consent and cross-origin checks protect state-changing routes', async t => {
  const { client } = await setup(t); const c = await client();
  assert.equal((await c.chat('你好')).status, 403);
  assert.equal((await c.request('/api/profile', 'PATCH', { nickname: 'changed' }, { Origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await c.state()).user.profile.nickname, '');
});
test('all page routes, shared product code and original portrait assets are served', async t => {
  const { base } = await setup(t);
  for (const path of ['/', '/app.js', '/style.css', '/shared/copy.js', '/shared/protocol.js', '/shared/returning.js', '/shared/candidates.js', '/assets/companion-portrait-female.jpg', '/assets/companion-portrait.jpg', '/assets/material-symbols-rounded.ttf', '/ui/chat.js', '/ui/panels.js', '/ui/dialogs.js', '/ui/privacy.js', '/ui/voice.js', '/i18n/index.js']) assert.equal((await fetch(base + path)).status, 200, path);
  assert.equal((await fetch(base + '/.env')).status, 404);
});
test('locale settings expose public catalogues and default to a generic English companion', async t => {
  const { client } = await setup(t); const c = await client(); let state = await c.state();
  assert.equal(state.user.profile.locale, 'en'); assert.equal(state.user.profile.aiGender, 'female'); assert.equal(state.user.profile.aiName, 'Alex');
  const catalogue = await (await c.request('/api/i18n/en')).json(); assert.equal(catalogue.messages['聊天'], 'Chat');
  assert.ok(!JSON.stringify(state.config).includes('LLM_API_KEY')); assert.ok(!('dictionaries' in state.config));
  assert.equal((await c.request('/api/profile', 'PATCH', { locale: 'unknown' })).status, 400);
  assert.equal((await c.request('/api/profile', 'PATCH', { locale: 'zh-CN' })).status, 200);
  state = await c.state(); assert.equal(state.user.profile.locale, 'zh-CN');
});
test('closing the browser stream does not lose the server-generated reply', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const model = new ProductDemoModel(); model.stream = async function* () { yield 'start'; await pending; yield ' completed\nCANDIDATES["Keep talking","Something else"]'; };
  const { client } = await setup(t, model); const c = await client(); await c.consent();
  const response = await c.chat('hello'); await response.body.cancel(); release();
  let state;
  for (let i = 0; i < 40; i++) { state = await c.state(); if (!state.activeTurn) break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(state.activeTurn, null); assert.equal(state.messages.at(-1).content, 'start completed');
  assert.deepEqual(state.messages.at(-1).replyCandidates, ['Keep talking', 'Something else']);
});
test('English replies and letters follow the selected profile locale', async t => {
  const { client } = await setup(t); const c = await client();
  await c.request('/api/profile', 'PATCH', { consent: true, onboardingDone: true, locale: 'en' });
  for (const text of ['I am a little tired', 'My cat is named Mango', 'I like hiking']) await (await c.chat(text)).text();
  const state = await c.state(); assert.ok(state.messages.filter(m => m.role === 'assistant').every(m => !/[\u3400-\u9fff]/.test(m.content)));
  assert.ok(state.messages.at(-1).replyCandidates.includes('Let’s take our time'));
  const result = await (await c.request('/api/letters', 'POST', {})).json(); assert.match(result.letter.content, /Offline scripted sample/); assert.doesNotMatch(result.letter.content, /[\u3400-\u9fff]/);
});
