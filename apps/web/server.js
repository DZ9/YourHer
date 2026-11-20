import { createWechat } from './wechat.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMiniappApi } from './miniapp-api.js';
import { LetterService } from '../../packages/companion-core/letters.js';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../packages/i18n/config.js';
import { ProductStore } from '../../packages/storage/product-store.js';
import { ProductModel, ProductDemoModel, buildSystem } from '../../packages/providers/index.js';
import { buildMemoryContext, normalizeFact } from '../../packages/memory/index.js';
import { finalizeReply, visibleStreamText, localDate, weekStart } from '../../packages/conversation/protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = await loadConfig(resolve(HERE, '../../companion.config.json'));
const STATIC = { '/': ['public/index.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/style.css': ['public/style.css', 'text/css'], '/shared/copy.js': ['../../packages/conversation/copy.js', 'text/javascript'], '/shared/candidates.js': ['../../packages/conversation/candidates.js', 'text/javascript'], '/shared/returning.js': ['../../packages/conversation/returning.js', 'text/javascript'], '/shared/protocol.js': ['../../packages/conversation/protocol.js', 'text/javascript'] };
const cookieToken = req => req.headers.cookie?.match(/(?:^|;\s*)cike_session=([A-Za-z0-9_-]+)/)?.[1] || '';
function json(res, status, object) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(object)); }
async function readBody(req, limit = 20000) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('请求内容太大'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function safeUser(user) { return { id: user.id, email: user.email, createdAt: user.createdAt, profile: user.profile }; }

export function createWebApp({ store, model = new ProductDemoModel(), mode = 'demo', publicOrigin = '', clock = Date.now, autoLetters = false, config = DEFAULT_CONFIG, wechat = null } = {}) {
  if (!store) throw new Error('ProductStore required');
  store.defaults = { aiName: config.assistant.name, aiGender: config.assistant.appearance, locale: config.i18n.defaultLocale };
  store.locales = config.i18n.locales.map(l => l.code); store.timeZone = config.timeZone;
  const memory = store.memory(); const active = new Map(); const letterService = new LetterService({store, memory, model, mode, clock, timeZone: config.timeZone}); const letterLocks = letterService.busy; const failedLogins = new Map();
  const setCookie = (res, token) => res.setHeader('Set-Cookie', `cike_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${publicOrigin.startsWith('https:') ? '; Secure' : ''}`);
  const send = (turn, type, data = {}) => { for (const res of turn.clients) if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); };
  const messages = id => store.read('message', id);
  async function state(user) {
    const allMessages = await messages(user.id);
    const turn = active.get(user.id);
    const { dictionaries, ...publicConfig } = config;
    return { user: safeUser(user), mode, config: publicConfig, messages: allMessages.slice(-100), stats: { userMessageCount: allMessages.filter(m => m.role === 'user').length }, hasOlder: allMessages.length > 100, memories: await memory.list(user.id, { limit: 1000 }), checkins: await store.read('checkin', user.id), letters: await store.read('letter', user.id), surveys: (await store.read('survey', user.id)).map(r => ({ id: r.id, createdAt: r.createdAt })), activeTurn: turn ? { id: turn.id, content: visibleStreamText(turn.raw || ''), status: turn.status } : null, billing: { enabled: false, plan: 'self-hosted', label: '自托管版 · 无订阅限制' }, serverDate: localDate(clock(), config.timeZone) };
  }
  async function generateLetter(user) {
    const letter = await letterService.generate(user);
    if (!wechat?.weeklyTemplateId || user.wechatAppId !== wechat.appId || !user.wechatOpenId) return letter;
    const claimed = await store.db.transact(rows => {
      const account = rows.find(row => row.kind === 'user' && row.id === user.id);
      if (!account?.miniapp?.weeklySubscriptionRequested || account.miniapp.lastWeeklyNotification === letter.id) return false;
      account.miniapp.weeklySubscriptionRequested = false;
      account.miniapp.lastWeeklyNotification = letter.id;
      return true;
    });
    if (claimed) {
      try { await wechat.sendWeekly(user.wechatOpenId, letter); }
      catch { console.warn('WeChat weekly notification was not delivered'); }
    }
    return letter;
  }
  async function runTurn(user, turn, text) {
    try {
      const history = (await messages(user.id)).filter(m => m.turnId !== turn.id).slice(-20).map(m => ({ role: m.role, content: m.rawContent || m.content }));
      const summary = (await store.read('summary', user.id)).at(-1)?.content || '';
      const context = await memory.context(user.id);
      const request = [{ role: 'system', content: buildSystem(user.profile, context, summary) }, ...history, { role: 'user', content: text }];
      for await (const delta of model.stream(request, { signal: turn.controller.signal })) {
        turn.controller.signal.throwIfAborted();
        turn.raw += delta;
        if (turn.raw.length > 30000) throw new Error('回复过长');
        send(turn, 'replace', { text: visibleStreamText(turn.raw) });
      }
      const reply = finalizeReply(turn.raw);
      if (!reply.content) throw new Error('未收到正文');
      turn.status = 'saving'; send(turn, 'status', { text: '正在记下…' });
      // Save assistant before optional post-processing; a disconnected browser cannot lose this reply.
      const assistant = await store.save('message', user.id, { role: 'assistant', turnId: turn.id, ...reply });
      turn.assistant = assistant;
      const newMemories = []; let profileUpdate = null; let previousProfile = null; let analysisStatus = 'skipped';
      if (memory.gate.check(user.id, text, clock()).pass) {
        try {
          const result = await model.analyze(text, { signal: turn.controller.signal, locale: user.profile.locale });
          for (const fact of result.memories || []) if (config.features.memory && normalizeFact(fact)) { const saved = await memory.remember(user.id, fact); if (saved.isNew) newMemories.push(saved.memory); }
          const patch = {};
          for (const key of ['aiName', 'nickname']) if (typeof result.profileUpdate?.[key] === 'string' && result.profileUpdate[key].trim() && result.profileUpdate[key].length <= (key === 'aiName' ? 12 : 20) && user.profile[key] !== result.profileUpdate[key].trim()) patch[key] = result.profileUpdate[key].trim();
          if (Object.keys(patch).length) { previousProfile = Object.fromEntries(Object.keys(patch).map(k => [k, user.profile[k]])); profileUpdate = await store.patchProfile(user.id, patch); }
          if (config.features.mood && result.mood) await store.checkin(user.id, result.mood, 'inferred');
          analysisStatus = 'ok';
        } catch { analysisStatus = 'error'; }
      }
      await store.db.transact(rows => { const record = rows.find(r => r.kind === 'turn' && r.id === turn.id); if (record) { record.status = 'done'; record.updatedAt = new Date(clock()).toISOString(); record.analysisStatus = analysisStatus; record.assistantId = assistant.id; } });
      turn.result = { assistant, newMemories, profileUpdate, previousProfile, analysisStatus };
      send(turn, 'done', turn.result);
      // Compact older history, retaining markers only in recent raw dialogue.
      const all = await messages(user.id);
      if (all.length >= 60 && all.length % 30 === 0) {
        void model.summarize(summary, all.slice(-50, -20).map(m => ({ role: m.role, content: m.content }))).then(content => store.save('summary', user.id, { content, untilMessageId: all.at(-21)?.id })).catch(() => {});
      }
    } catch {
      await store.db.transact(rows => { const record = rows.find(r => r.kind === 'turn' && r.id === turn.id); if (record) record.status = turn.assistant ? 'done' : 'error'; }).catch(() => {});
      if (turn.assistant) send(turn, 'done', { assistant: turn.assistant, newMemories: [], analysisStatus: 'error' });
      else send(turn, 'error', { text: '刚刚没有连上模型。你的消息已保存，可以重新发送。' });
    } finally {
      for (const res of turn.clients) res.end();
      if (active.get(user.id) === turn) active.delete(user.id);
    }
  }
  function subscribe(req, res, turn) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
    turn.clients.add(res); res.write(`data: ${JSON.stringify({ type: 'start', turnId: turn.id, mode })}\n\n`);
    if (turn.raw) res.write(`data: ${JSON.stringify({ type: 'replace', text: visibleStreamText(turn.raw) })}\n\n`);
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 10000);
    res.on('close', () => { clearInterval(heartbeat); turn.clients.delete(res); });
  }
  const miniapp = createMiniappApi({ store, memory, active, runTurn, generateLetter, config, model, clock, mode, letterLocks, wechat });
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const origin = publicOrigin || `http://${req.headers.host}`;
    if (!publicOrigin && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return json(res, 403, { error: '请配置 PUBLIC_ORIGIN' });
    if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: '请求来源不匹配' });
    try {
      const url = new URL(req.url, origin);
      const feature = url.pathname.startsWith('/api/memories') ? 'memory' : url.pathname === '/api/letters' ? 'letters' : url.pathname === '/api/checkins' ? 'mood' : url.pathname === '/api/feedback' ? 'feedback' : null;
      if (feature && config.features[feature] === false) return json(res, 404, {error:'Feature disabled.'});
      if (req.method === 'GET' && url.pathname.startsWith('/api/i18n/')) {
        const locale = url.pathname.split('/').at(-1);
        if (!Object.hasOwn(config.dictionaries, locale)) return json(res, 404, { error: 'Unknown locale' });
        return json(res, 200, { locale, messages: config.dictionaries[locale], fallback: config.dictionaries[config.i18n.fallbackLocale] });
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        let asset = STATIC[url.pathname];
        if (/^\/assets\/companion-portrait(?:-female)?\.jpg$/.test(url.pathname)) asset = [`public${url.pathname}`, 'image/jpeg'];
        if (url.pathname === '/assets/material-symbols-rounded.ttf') asset = ['public/assets/material-symbols-rounded.ttf', 'font/ttf'];
        if (/^\/ui\/(dom|chat|panels|dialogs|voice|privacy)\.js$/.test(url.pathname)) asset = ['../../packages' + url.pathname, 'text/javascript'];
        if (url.pathname === '/shared/sse-client.js') asset = ['../../packages/conversation/sse-client.js', 'text/javascript'];
        if (url.pathname === '/i18n/index.js') asset = ['../../packages/i18n/index.js', 'text/javascript'];
        if (!asset) return json(res, 404, { error: 'Not found' });
        const data = await readFile(resolve(HERE, asset[0]));
        res.writeHead(200, { 'Content-Type': `${asset[1]}${asset[1].startsWith('text/') ? '; charset=utf-8' : ''}`, 'Cache-Control': 'no-cache' }); return res.end(data);
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok' });
      let token = cookieToken(req); let session = await store.session(token); let user = session ? await store.user(session.userId) : null;
      if (!user) { const guest = await store.guest(); user = guest.user; token = guest.token; setCookie(res, token); if (config.i18n.detectBrowserLanguage) { const matched = store.locales.find(code => req.headers['accept-language']?.toLowerCase().includes(code.toLowerCase())); if (matched) user.profile = await store.patchProfile(user.id, { locale: matched }); } }
      if (req.method === 'POST' && url.pathname === '/api/miniapp/wechat-login') {
        if (!wechat) return json(res, 404, { error: '当前服务器未配置微信登录' });
        const input = await readBody(req);
        const openId = await wechat.identify(input.code);
        if (active.has(user.id) || letterLocks.has(user.id)) return json(res, 409, { error: '请等当前任务结束' });
        const id = await store.linkWechat(user.id, wechat.appId, openId);
        const nextSession = await store.startSession(id);
        await store.logout(token);
        setCookie(res, nextSession);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/miniapp') return json(res, 200, await miniapp(user, await readBody(req, 1500000)));
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, await state(user));
      if (req.method === 'GET' && url.pathname === '/api/messages') {
        const all = await messages(user.id); const before = url.searchParams.get('before'); const end = before ? all.findIndex(m => m.id === before) : all.length;
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        if (end < 0) return json(res, 404, { error: '消息不存在' });
        return json(res, 200, { messages: all.slice(Math.max(0, end - limit), end), hasOlder: end > limit });
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        res.setHeader('Content-Disposition', 'attachment; filename="cike-data.json"'); return json(res, 200, { exportedAt: new Date(clock()).toISOString(), records: await store.export(user.id) });
      }
      if (req.method === 'PATCH' && url.pathname === '/api/profile') return json(res, 200, { profile: await store.patchProfile(user.id, await readBody(req)) });
      if (req.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(url.pathname)) {
        const input = await readBody(req); const key = req.socket.remoteAddress || 'local';
        const attempts = (failedLogins.get(key) || []).filter(t => clock() - t < 60000);
        if (attempts.length >= 8) return json(res, 429, { error: '尝试过于频繁，请稍后重试' });
        failedLogins.set(key, [...attempts, clock()]);
        const newToken = url.pathname.endsWith('register') ? await store.register(user.id, input.email, input.password) : await store.login(input.email, input.password);
        setCookie(res, newToken); return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') { await store.logout(token); res.setHeader('Set-Cookie', 'cike_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const input = await readBody(req);
        if (!user.profile.consentAt) return json(res, 403, { error: '请先阅读并同意隐私政策' });
        if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 4000 || !/^[\w-]{8,80}$/.test(input.requestId || '')) return json(res, 400, { error: '消息或请求编号无效' });
        const previous = (await store.read('turn', user.id)).find(t => t.requestId === input.requestId);
        if (previous && previous.message !== input.message.trim()) return json(res, 409, { error: '请求编号不能复用给不同消息' });
        if (previous?.status === 'done') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
          const assistant = (await messages(user.id)).find(m => m.id === previous.assistantId || m.turnId === previous.id && m.role === 'assistant');
          return res.end(`data: ${JSON.stringify({ type: 'done', assistant, replay: true, newMemories: [] })}\n\n`);
        }
        if (active.has(user.id)) {
          const turn = active.get(user.id);
          if (previous?.id === turn.id) return subscribe(req, res, turn);
          return json(res, 409, { error: '上一条回复还在继续', turnId: turn.id });
        }
        if (previous) return json(res, 409, { error: '这条请求已结束，请使用新的编号重试' });
        const turn = { id: randomUUID(), raw: '', status: 'generating', clients: new Set(), controller: new AbortController() };
        active.set(user.id, turn);
        try {
          await store.db.transact(rows => rows.push(
            { kind: 'turn', id: turn.id, userId: user.id, requestId: input.requestId, message: input.message.trim(), status: 'pending', createdAt: new Date(clock()).toISOString() },
            { kind: 'message', id: randomUUID(), userId: user.id, turnId: turn.id, role: 'user', content: input.message.trim(), createdAt: new Date(clock()).toISOString() }
          ));
          subscribe(req, res, turn); void runTurn(user, turn, input.message.trim()); return;
        } catch (error) { active.delete(user.id); throw error; }
      }
      if (req.method === 'POST' && url.pathname === '/api/checkins') return json(res, 200, { checkin: await store.checkin(user.id, (await readBody(req)).mood) });
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/memories/')) {
        if (active.has(user.id)) return json(res, 409, { error: '请等本轮对话保存完成' });
        const id = url.pathname.split('/').at(-1); return json(res, 200, { removed: await memory.forget(user.id, id) });
      }
      if (req.method === 'POST' && url.pathname === '/api/letters') return json(res, 200, { letter: await generateLetter(user) });
      if (req.method === 'POST' && url.pathname === '/api/feedback') {
        const input = await readBody(req, 1500000);
        if (!['体验建议', '功能问题', '内容不合适', '其他'].includes(input.type) || typeof input.content !== 'string' || input.content.trim().length < 2 || input.content.length > 2000) return json(res, 400, { error: '请填写 2–2000 字反馈' });
        if (input.attachment && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.attachment) || input.attachment.length > 1400000)) return json(res, 400, { error: '请上传小于 1 MB 的 PNG/JPEG/WebP 截图' });
        const record = await store.save('feedback', user.id, { type: input.type, content: input.content.trim(), attachment: input.attachment || null });
        return json(res, 201, { id: record.id, message: '反馈已保存到当前自托管实例' });
      }
      if (req.method === 'POST' && url.pathname === '/api/survey') {
        const input = await readBody(req);
        if (!['caught', 'sometimes', 'no'].includes(input.q1) || !['yes', 'later'].includes(input.q3) || typeof input.q2 !== 'string' || input.q2.length > 200) return json(res, 400, { error: '请完成问卷' });
        if ((await store.read('survey', user.id)).length) return json(res, 409, { error: '已经收到你的问卷' });
        return json(res, 201, { survey: await store.save('survey', user.id, input), message: '谢谢你，问卷已保存。自托管版无需体验卡。' });
      }
      if (req.method === 'DELETE' && url.pathname === '/api/account') {
        const input = await readBody(req); if (!['删除我的全部数据', 'DELETE ALL MY DATA'].includes(input.confirm)) return json(res, 400, { error: '请输入确认文字' });
        if (active.has(user.id) || letterLocks.has(user.id)) return json(res, 409, { error: '请等当前任务完成再删除' });
        await store.deleteUser(user.id); res.setHeader('Set-Cookie', 'cike_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return json(res, 200, { ok: true });
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      if (!res.headersSent) json(res, 400, { error: error instanceof SyntaxError ? '请求格式不正确' : error.message?.slice(0, 160) || '请求未完成' }); else res.end();
    }
  });
  // Recover turns interrupted by a process restart without reissuing paid model requests.
  server.ready = store.db.transact(rows => { for (const row of rows) if (row.kind === 'turn' && row.status === 'pending') row.status = 'error'; });
  let timer;
  if (autoLetters) {
    timer = setInterval(async () => {
      if (new Date(`${localDate(clock(), config.timeZone)}T12:00:00Z`).getUTCDay() !== 0) return;
      for (const user of (await store.db.read()).filter(r => r.kind === 'user' && r.profile.consentAt)) void generateLetter(user).catch(() => {});
    }, 3600000); timer.unref();
  }
  server.on('close', () => { if (timer) clearInterval(timer); for (const turn of active.values()) turn.controller.abort(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.env.MODEL_PROVIDER || 'demo';
  if (!['demo', 'openai-compatible'].includes(mode)) throw new Error('MODEL_PROVIDER must be demo or openai-compatible');
  const model = mode === 'demo' ? new ProductDemoModel() : new ProductModel({ baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL });
  const store = new ProductStore(resolve(process.env.DATA_DIR || '.data-web', 'product.json'));
  const config = process.env.CONFIG_FILE ? await loadConfig(resolve(process.env.CONFIG_FILE)) : DEFAULT_CONFIG;
  const server = createWebApp({ store, model, mode, config, publicOrigin: process.env.PUBLIC_ORIGIN || '', autoLetters: process.env.AUTO_WEEKLY_LETTERS === 'true', wechat: createWechat({ appId: process.env.WX_APP_ID, secret: process.env.WX_APP_SECRET, weeklyTemplateId: process.env.WX_WEEKLY_TEMPLATE_ID, payment: process.env.WX_PAYMENT_ENABLED === 'true' ? { key: process.env.WX_PAY_APP_KEY, offerId: process.env.WX_PAY_OFFER_ID, productId: process.env.WX_PAY_PRODUCT_ID, priceFen: Number(process.env.WX_PAY_PRICE_FEN) } : null }) });
  await server.ready;
  server.listen(Number(process.env.PORT || 4317), process.env.HOST || '127.0.0.1', () => console.log(`YourHer: http://127.0.0.1:${server.address().port} (${mode})`));
}
