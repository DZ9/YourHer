import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createWebApp } from '../server.js';
import { ProductStore } from '../../../packages/storage/product-store.js';
import { ProductDemoModel } from '../../../packages/providers/index.js';

async function setup(t, model = new ProductDemoModel()) {
  const dir = await mkdtemp(join(tmpdir(), 'yourher-miniapp-'));
  const store = new ProductStore(join(dir, 'records.json'));
  const server = createWebApp({store, model});
  await server.ready;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, {recursive:true, force:true}); });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function client() {
    const init = await fetch(base + '/api/state');
    const cookie = init.headers.get('set-cookie').split(';')[0];
    return async (path, method = 'GET', data = {}, consent = true) => {
      const response = await fetch(base + '/api/miniapp', {method:'POST', headers:{Cookie:cookie, 'Content-Type':'application/json'}, body:JSON.stringify({path, method, data, consent, locale:'zh-CN'})});
      return {status:response.status, body:await response.json()};
    };
  }
  return {client, base, store};
}

test('native contract runs chat, memory, checkins, letters and export using the shared pipeline', async t => {
  const {client} = await setup(t); const api = await client();
  assert.equal((await api('/api/login', 'POST')).body.wechatBound, false);
  assert.equal((await api('/api/me/settings', 'PATCH', {privacyConsentGranted:true})).status, 200);
  const conversation = (await api('/api/conversations', 'POST')).body;
  const path = '/api/conversations/' + conversation.id + '/stream-generate';
  const first = await api(path, 'POST', {sessionId:randomUUID(), content:'我养了一只猫叫橘子'});
  assert.equal(first.status, 200); assert.ok(first.body.assistantMessages.length >= 1);
  assert.ok(first.body.assistantMessages.at(-1).replyCandidates.length);
  assert.doesNotMatch(first.body.assistantMessages[0].content, /CANDIDATES/);
  const memories = (await api('/api/memory')).body.items;
  assert.equal(memories.length, 1);
  assert.equal((await api('/api/checkin', 'POST', {mood:'happy'})).body.checkin.mood, 'happy');
  assert.equal((await api('/api/checkin/recent?days=365')).body.items.length, 1);
  for (const content of ['我叫小雨', '今天想慢慢聊']) await api(path, 'POST', {sessionId:randomUUID(),content});
  assert.equal((await api('/api/me')).body.nickname, '小雨');
  assert.equal((await api('/api/weekly-notes', 'POST')).status, 200);
  assert.equal((await api('/api/weekly-notes')).body.items.length, 1);
  assert.equal((await api('/api/trial/survey', 'POST', {answers:{caught:'caught',wish:'更多角色',recommend:'yes'}})).status, 200);
  assert.equal((await api('/api/trial/survey', 'POST', {answers:{caught:'caught',wish:'',recommend:'yes'}})).status, 400);
  const exported = (await api('/api/export')).body.records;
  assert.ok(exported.some(r => r.kind === 'letter'));
  assert.ok(exported.every(r => !r.passwordHash && !r.digest));
  await api('/api/memory/' + memories[0].id, 'DELETE');
  assert.ok((await api('/api/memory')).body.items.every(m => m.id !== memories[0].id));
});

test('miniapp enforces consent, request reuse, user isolation and deletion confirmation', async t => {
  let calls = 0; const model = new ProductDemoModel(); const stream = model.stream.bind(model);
  model.stream = async function* (...args) { calls++; yield* stream(...args); };
  const {client} = await setup(t, model); const a = await client(), b = await client();
  const data = {sessionId:randomUUID(), content:'我不吃香菜'};
  assert.equal((await a('/api/conversations/main/stream-generate', 'POST', data, false)).status, 400);
  assert.equal((await a('/api/conversations/main/stream-generate', 'POST', data)).status, 200);
  assert.equal((await a('/api/conversations/main/stream-generate', 'POST', data)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await a('/api/conversations/main/stream-generate', 'POST', {...data,content:'改了内容'})).status, 400);
  assert.equal((await b('/api/conversations/main')).body.messages.length, 0);
  const memory = (await a('/api/memory')).body.items[0];
  await b('/api/memory/' + memory.id, 'DELETE');
  assert.equal((await a('/api/memory')).body.items.length, 1);
  assert.equal((await a('/api/pay/order', 'POST')).status, 400);
  assert.equal((await a('/api/account', 'DELETE', {confirm:'yes'})).status, 400);
  assert.equal((await a('/api/account', 'DELETE', {confirm:'DELETE ALL MY DATA'})).status, 200);
  assert.equal((await a('/api/conversations/main')).body.messages.length, 0);
});

test('original miniapp API and native wx transport run against a real HTTP server', async t => {
  const model = new ProductDemoModel(); const original = model.stream.bind(model);
  model.stream = async function* (...args) { for await (const text of original(...args)) { await new Promise(resolve => setTimeout(resolve, 60)); yield text; } };
  const {base} = await setup(t, model);
  const require = createRequire(import.meta.url);
  const config = require('../../miniapp/src/config.js'); config.baseUrl = base;
  const saved = new Map(); const app = {globalData:{}};
  globalThis.getApp = () => app;
  globalThis.wx = {
    getStorageSync: key => saved.get(key), setStorageSync: (key,value) => saved.set(key,value), removeStorageSync: key => saved.delete(key),
    request(options) {
      fetch(options.url, {method:options.method, headers:options.header, ...(options.data === undefined ? {} : {body:JSON.stringify(options.data)})}).then(async r => options.success({statusCode:r.status,header:Object.fromEntries(r.headers),data:await r.json()})).catch(options.fail);
    }
  };
  t.after(() => { delete globalThis.wx; delete globalThis.getApp; });
  const api = require('../../miniapp/src/services/api.js');
  const users = await Promise.all([api.login(), api.getMe(), api.getCompanionStats()]);
  assert.equal(users[0].id, users[1].id);
  saved.set('privacy:consent-at:' + config.baseUrl, new Date().toISOString());
  const conv = await api.createConversation();
  const reply = await api.streamGenerate(conv.id, randomUUID(), '我养了一只猫叫橘子');
  assert.ok(reply.assistantMessages[0].content);
  assert.equal((await api.getMemories({refresh:true})).length, 1);
  await api.updateProfile({aiName:'Alex', currentCity:'上海', interests:['阅读']});
  assert.equal((await api.getMe()).currentCity, '上海');
  await api.submitCheckin({mood:'calm'});
  assert.equal((await api.getRecentCheckins(365, {refresh:true})).items.length, 1);
  const engine = require('../../miniapp/src/utils/chat-stream-engine.js');
  const snapshots = [];
  const ctx = {
    data: {inputValue:'今天想慢慢聊', messages:[], messageRenderLimit:100, sending:false, firstTouch:false, conversationId:conv.id}, fullMessages:[],
    setData(patch) { Object.assign(this.data, patch); },
    async ensureConversationId() { return conv.id; },
    commitMessages(messages) { this.fullMessages = messages; this.data.messages = messages; snapshots.push(structuredClone(messages)); },
    showMemoryBanner() {}, applyAiMood() {}, _applyServerNameUpdate() {}
  };
  await engine.handleStreamingSend(ctx);
  const assistant = ctx.fullMessages.filter(m => m.role === 'assistant');
  assert.ok(assistant.length > 1, 'original client renders separate paragraph bubbles');
  assert.ok(assistant.at(-1).replyCandidates.length);
  assert.equal(ctx.data.sending, false);
  assert.ok(snapshots.some(rows => rows.some(m => m.streaming)), 'polling rendered incremental content');
  assert.ok(snapshots.every(rows => rows.every(m => !/CANDIDATES/.test(m.content || ''))));
});
