import { randomUUID } from 'node:crypto';
import { localDate, visibleStreamText, splitBubbles, finalizeReply } from '../../packages/conversation/protocol.js';

import { buildSystem } from '../../packages/providers/index.js';
import { normalizeFact } from '../../packages/memory/index.js';

/** Compatibility boundary for the native miniapp. Uses the web app's store and turn pipeline. */
export function createMiniappApi({ store, memory, active, runTurn, generateLetter, config, model, clock = Date.now, mode = "demo", letterLocks = new Set(), wechat = null }) {
  const now = () => new Date(clock()).toISOString();
  function billing(user) {
    const account = user.miniapp || {};
    const enabled = Boolean(wechat?.paymentEnabled && user.wechatAppId === wechat.appId);
    const subscribed = Date.parse(account.subscriptionExpireAt || '') > clock();
    const used = (account.trialDates || []).length;
    const total = account.surveyCompletedAt ? 14 : 7;
    const state = subscribed ? 'subscribed' : used < total ? 'trial'
      : account.surveyCompletedAt || account.surveyDismissedAt ? 'paywall' : 'survey_invite';
    return {
      billingState: enabled ? state : 'self-hosted',
      trialPhase: enabled ? (account.surveyCompletedAt ? 2 : 1) : 0,
      trialNightsTotal: enabled ? total : 0,
      trialNightsUsed: enabled ? Math.min(used, total) : 0
    };
  }
  const viewUser = user => ({
    id: user.id, modelMode: mode, ...user.profile, ...(user.miniapp || {}), currentCity: user.profile.city,
    privacyConsentAt: user.profile.consentAt, sessionActive: true,
    loginSummary: user.wechatIdentity ? '已关联微信' : '自托管设备会话',
    wechatLoginAvailable: Boolean(wechat), wechatBound: Boolean(user.wechatIdentity),
    phoneBound: Boolean(user.phoneMasked), phoneMasked: user.phoneMasked || '',
    weeklyTemplateId: user.wechatAppId && user.wechatAppId === wechat?.appId ? wechat.weeklyTemplateId || null : null,
    paymentAvailable: Boolean(wechat?.paymentEnabled && user.wechatAppId === wechat.appId),
    paymentPriceFen: wechat?.paymentPrice || 0,
    subscriptionExpireAt: user.miniapp?.subscriptionExpireAt || '',
    subscriptionActive: Date.parse(user.miniapp?.subscriptionExpireAt || '') > clock(), ...billing(user),
    onboardingCompleted: user.profile.onboardingDone,
    createdAt: user.createdAt, avatar: '/assets/images/profile-avatar-stitch-me.jpg'
  });
  const conversation = user => ({ id: 'main', title: user.profile.aiName, createdAt: user.createdAt, lastMessageAt: now(), status: 'active' });
  const messages = id => store.read('message', id);
  const message = row => row.role === 'assistant' ? splitBubbles(row.content).map((content, i, parts) => ({ ...row, id: row.id + '_bubble_' + i, content, replyCandidates: i === parts.length - 1 ? row.replyCandidates : [], conversationId: 'main', type: 'text' })) : [{ ...row, conversationId: 'main', type: 'text' }];
  const resultFor = async (user, turn) => {
    const all = (await messages(user.id)).filter(m => m.turnId === turn.id);
    return { conversationId: 'main', userMessage: all.find(m => m.role === 'user'), assistantMessages: all.filter(m => m.role === 'assistant').flatMap(message), user: viewUser(await store.user(user.id)), newMemories: turn.result?.newMemories || [], profileUpdate: turn.result?.profileUpdate || null };
  };
  async function generate(user, data) {
    if (!user.profile.consentAt) throw new Error('请先阅读并同意隐私说明');
    if (typeof data.content !== 'string' || !data.content.trim() || data.content.length > 4000) throw new Error('消息长度须为 1–4000 字');
    const requestId = data.clientRequestId || data.sessionId;
    if (!/^[\w-]{8,100}$/.test(requestId || '')) throw new Error('请求编号无效');
    const previous = (await store.read('turn', user.id)).find(t => t.requestId === requestId);
    if (previous) {
      if (previous.message !== data.content.trim()) throw new Error('请求编号已被使用');
      const live = active.get(user.id);
      if (live?.id === previous.id && live.promise) await live.promise;
      const updated = (await store.read('turn', user.id)).find(t => t.id === previous.id);
      if (updated?.status !== 'done') throw new Error('该次回复未完成，请重新发送');
      return resultFor(user, previous);
    }
    if (active.has(user.id)) throw new Error('请等上一条回复完成');
    const turn = { id: randomUUID(), requestId, sessionId: data.sessionId, raw: '', status: 'generating', clients: new Set(), controller: new AbortController() };
    active.set(user.id, turn);
    try {
      await store.db.transact(rows => rows.push(
        { kind: 'turn', id: turn.id, userId: user.id, requestId, message: data.content.trim(), status: 'pending', createdAt: now() },
        { kind: 'message', id: randomUUID(), userId: user.id, turnId: turn.id, role: 'user', content: data.content.trim(), createdAt: now() }
      ));
      turn.promise = runTurn(user, turn, data.content.trim());
      await turn.promise;
      if (!turn.assistant) throw new Error('模型未返回回复，消息已保存');
      if (wechat?.paymentEnabled && user.wechatAppId === wechat.appId) {
        await store.db.transact(rows => {
          const account = rows.find(row => row.kind === 'user' && row.id === user.id);
          if (!account || billing(account).billingState !== 'trial') return;
          const dates = new Set(account.miniapp?.trialDates || []);
          dates.add(localDate(clock(), config.timeZone));
          account.miniapp = { ...account.miniapp, trialDates: [...dates] };
        });
      }
      return resultFor(user, turn);
    } finally { if (active.get(user.id) === turn) active.delete(user.id); }
  }
  function checkinSummary(items) {
    const today = localDate(clock(), config.timeZone);
    const dates = new Set(items.filter(item => item.source !== 'inferred').map(item => item.date));
    const cursor = new Date(today + 'T12:00:00Z');
    if (!dates.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
    let streak = 0;
    while (dates.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return { checkin: items.find(item => item.date === today) || null, streak, date: today };
  }

  async function regenerate(user) {
    if (!user.profile.consentAt) throw new Error('请先同意隐私说明');
    if (active.has(user.id)) throw new Error('请等上一条回复完成');
    const turn = { id: randomUUID(), raw: '', status: 'generating', clients: new Set(), controller: new AbortController() };
    active.set(user.id, turn);
    try {
      const all = await messages(user.id);
      const previous = all.at(-1);
      if (previous?.role !== 'assistant') throw new Error('没有可以重新生成的回复');
      const summary = (await store.read('summary', user.id)).at(-1)?.content || '';
      const context = await memory.context(user.id);
      const history = all.slice(-21, -1).map(row => ({ role: row.role, content: row.rawContent || row.content }));
      const request = [{ role: 'system', content: buildSystem(user.profile, context, summary) }, ...history];
      for await (const delta of model.stream(request, { signal: turn.controller.signal })) {
        turn.raw += delta;
        if (turn.raw.length > 30000) throw new Error('回复过长');
      }
      const reply = finalizeReply(turn.raw);
      if (!reply.content) throw new Error('未收到正文');
      const saved = await store.db.transact(rows => {
        const row = rows.find(item => item.kind === 'message' && item.userId === user.id && item.id === previous.id);
        if (!row) throw new Error('原回复不存在');
        Object.assign(row, reply, { updatedAt: now() });
        return row;
      });
      return { assistantMessages: message(saved) };
    } finally {
      active.delete(user.id);
    }
  }

  return async function miniapp(user, input) {
    if (typeof input.path !== 'string' || input.path.length > 300) throw new Error('无效路径');
    const url = new URL(input.path, 'http://miniapp.local');
    const p = url.pathname.replace(/^\/api\/memory(?=\/|$)/, '/api/memories'), method = input.method || 'GET', data = input.data || {};
    if (input.consent === true && !user.profile.consentAt) user.profile = await store.patchProfile(user.id, { consent: true });
    if (p === '/api/me/login' || p === '/api/login') {
      if (store.locales.includes(input.locale)) user.profile = await store.patchProfile(user.id, { locale: input.locale });
      return viewUser(user);
    }
    if (p === '/api/home' && method === 'GET') {
      const all = await messages(user.id);
      const last = all.at(-1);
      const assistant = all.findLast(row => row.role === 'assistant');
      const { checkin, streak } = checkinSummary(await store.read('checkin', user.id));
      return {
        resumeCard: last ? { conversationId: 'main', title: user.profile.aiName, lastMessageAt: last.createdAt, lastAssistantMessage: assistant?.content || '' } : null,
        todayCheckin: checkin, checkinStreak: streak
      };
    }
    if (p === '/api/me') return viewUser(user);
    if (['/api/me/profile', '/api/me/settings', '/api/onboarding'].includes(p)) {
      const patch = {};
      for (const key of ['aiName', 'nickname', 'aiGender', 'companionPreference', 'relationshipMode', 'theme', 'locale']) if (data[key] !== undefined) patch[key] = data[key];
      if (data.currentCity !== undefined) patch.city = data.currentCity;
      if (data.privacyConsentGranted === true) patch.consent = true;
      if (p === '/api/onboarding') patch.onboardingDone = true;
      if (Object.keys(patch).length) user.profile = await store.patchProfile(user.id, patch);
      const extra = {};
      if (data.interests !== undefined) {
        if (!Array.isArray(data.interests) || data.interests.length > 8 || data.interests.some(s => typeof s !== 'string' || s.length > 16)) throw new Error('兴趣标签无效');
        extra.interests = data.interests;
      }
      if (data.gender !== undefined && ['female', 'male', 'other', ''].includes(data.gender)) extra.gender = data.gender;
      if (typeof data.notificationEnabled === 'boolean') extra.notificationEnabled = data.notificationEnabled;
      if (Object.keys(extra).length) await store.db.transact(rows => { const saved = rows.find(r => r.kind === 'user' && r.id === user.id); saved.miniapp = { ...saved.miniapp, ...extra }; user.miniapp = saved.miniapp; });
      return viewUser(user);
    }
    if (p === '/api/me/weekly-subscription' && method === 'POST') {
      if (!wechat?.weeklyTemplateId || user.wechatAppId !== wechat.appId || data.templateId !== wechat.weeklyTemplateId) throw new Error('订阅消息未配置');
      await store.db.transact(rows => {
        const account = rows.find(row => row.kind === 'user' && row.id === user.id);
        account.miniapp = { ...account.miniapp, weeklySubscriptionRequested: true };
      });
      return { ok: true };
    }
    if (p === '/api/me/letters-read' && method === 'POST') {
      if (!Number.isFinite(data.ts) || data.ts <= 0 || data.ts > clock() + 60000) throw new Error('已读时间无效');
      return store.db.transact(rows => {
        const saved = rows.find(row => row.kind === 'user' && row.id === user.id);
        saved.miniapp = { ...saved.miniapp, lettersLastReadAt: Math.max(saved.miniapp?.lettersLastReadAt || 0, data.ts) };
        return viewUser(saved);
      });
    }
    if (p === '/api/me/security') return viewUser(user);
    if (p === '/api/me/phone' && method === 'POST') {
      if (!wechat || !user.wechatIdentity) throw new Error('请先关联微信账号');
      return viewUser(await store.bindWechatPhone(user.id, await wechat.phone(data.code)));
    }
    if (p === '/api/companion/stats') return { daysTogether: Math.max(1, Math.floor((clock() - Date.parse(user.createdAt)) / 86400000) + 1), userMessageCount: (await messages(user.id)).filter(m => m.role === 'user').length, memoryCount: (await memory.list(user.id)).length, aiName: user.profile.aiName };
    if (p === '/api/conversations') {
      if (method === 'POST') return conversation(user);
      return { items: [{ ...conversation(user), lastMessageAt: (await messages(user.id)).at(-1)?.createdAt || user.createdAt }], nextCursor: null };
    }
    if (/^\/api\/conversations\/[^/]+$/.test(p)) return { conversation: conversation(user), messages: (await messages(user.id)).flatMap(message) };
    if (/^\/api\/conversations\/[^/]+\/(stream-generate|messages)$/.test(p)) return generate(user, data);
    if (p === '/api/conversations/main/regenerate' && method === 'POST') return regenerate(user);
    if (p === '/api/stream-poll') {
      const live = active.get(user.id);
      if (live?.sessionId === data.sessionId) return { content: visibleStreamText(live.raw), done: false };
      return { content: '', done: true };
    }
    if (p === '/api/memories' || p.startsWith('/api/memories/')) {
      if (!config.features.memory) throw new Error('记忆功能已关闭');
      if (method === 'GET') return { items: await memory.list(user.id, { limit: 100 }) };
      if (active.has(user.id)) throw new Error('请等回复保存后再修改记忆');
      if (method === 'POST') return (await memory.remember(user.id, { ...data, source: 'manual' })).memory;
      if (method === 'PATCH') {
        const id = p.split('/').at(-1);
        return memory.store.transact(rows => {
          const row = rows.find(item => item.userId === user.id && item.id === id && !item.deletedAt);
          if (!row) throw new Error('记忆不存在');
          const fact = normalizeFact({ ...row, ...data });
          if (!fact) throw new Error('记忆内容无效');
          Object.assign(row, fact, { updatedAt: now() });
          return row;
        });
      }
      if (method === 'DELETE') return { ok: await memory.forget(user.id, p.split('/').at(-1)) };
    }
    if (p.startsWith('/api/checkin')) {
      if (!config.features.mood) throw new Error('心情功能已关闭');
      if (p === '/api/checkin' && method === 'POST') {
        const saved = await store.checkin(user.id, data.mood, 'manual', data.note);
        return { ...checkinSummary(await store.read('checkin', user.id)), checkin: saved, reply: '记下了。' };
      }
      const items = await store.read('checkin', user.id);
      if (p === '/api/checkin/today' && method === 'GET') return checkinSummary(items);
      if (p === '/api/checkin/recent' && method === 'GET') {
        const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
        const date = new Date(localDate(clock(), config.timeZone) + 'T12:00:00Z');
        date.setUTCDate(date.getUTCDate() - (days - 1));
        return { items: items.filter(item => item.date >= date.toISOString().slice(0, 10)) };
      }
      throw new Error('打卡操作无效');
    }
    if (p === '/api/weekly-notes') {
      if (!config.features.letters) throw new Error('信件功能已关闭');
      if (method === 'POST') return generateLetter(user);
      return { items: (await store.read('letter', user.id)).map(l => ({ ...l, weekStart: l.week, weekEnd: l.until, publishAt: l.createdAt })).reverse() };
    }
    if (p === '/api/highlights') {
      if (method === 'GET') return { items: await store.read('highlight', user.id) };
      if (method === 'POST' && typeof data.excerpt === 'string' && data.excerpt.trim() && data.excerpt.length <= 240) return store.save('highlight', user.id, { excerpt: data.excerpt, messageId: String(data.messageId || '').slice(0, 100), savedAt: now() });
    }
    if (p.startsWith('/api/highlights/') && method === 'DELETE') {
      await store.db.transact(rows => { const i = rows.findIndex(r => r.kind === 'highlight' && r.userId === user.id && r.id === p.split('/').at(-1)); if (i >= 0) rows.splice(i, 1); });
      return { ok: true };
    }
    if (p === '/api/feedback' && method === 'POST') {
      if (!config.features.feedback) throw new Error('反馈功能已关闭');
      if (typeof data.content !== 'string' || data.content.trim().length < 2 || data.content.length > 2000) throw new Error('请填写 2–2000 字反馈');
      if (data.attachment && (typeof data.attachment !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data.attachment) || data.attachment.length > 1400000)) throw new Error('截图须小于 1 MB');
      const record = await store.save('feedback', user.id, { content: data.content.trim(), type: String(data.type || 'other').slice(0, 30), attachment: data.attachment || null });
      return { id: record.id };
    }
    if (p === '/api/location/resolve-city' || p === '/api/location/city' || p === '/api/me/location/resolve') {
      if (typeof data.city !== 'string' || !data.city.trim() || data.city.length > 40) throw new Error('请输入城市名称');
      user.profile = await store.patchProfile(user.id, { city: data.city });
      return viewUser(user);
    }
    if (p === '/api/pay/order' && method === 'POST') {
      if (!wechat?.paymentEnabled || !user.wechatIdentity) throw new Error('微信支付未配置或账号未关联');
      const id = randomUUID().replaceAll('-', '');
      const { openId, client } = await wechat.signOrder(data.code, id);
      if (!store.matchesWechat(user, wechat.appId, openId)) throw new Error('微信身份与当前账号不一致');
      await store.save('wechatOrder', user.id, { id, openId, offerId: wechat.offerId, priceFen: wechat.paymentPrice, status: 'pending' });
      return { orderId: id, ...client };
    }
    if (p === '/api/pay/confirm' && method === 'POST') {
      if (!wechat?.paymentEnabled || !user.wechatIdentity) throw new Error('微信支付未配置或账号未关联');
      const order = (await store.read('wechatOrder', user.id)).find(row => row.id === data.orderId);
      if (!order) throw new Error('订单不存在');
      if (order.status === 'paid') return { ok: true, user: viewUser(await store.user(user.id)) };
      if (!await wechat.verifyOrder(order)) return { ok: false };
      return store.db.transact(rows => {
        const record = rows.find(row => row.kind === 'wechatOrder' && row.id === order.id && row.userId === user.id);
        const account = rows.find(row => row.kind === 'user' && row.id === user.id);
        if (!record || !account) throw new Error('订单或账号不存在');
        if (record.status !== 'paid') {
          const start = Math.max(clock(), Date.parse(account.miniapp?.subscriptionExpireAt || '') || 0);
          account.miniapp = { ...account.miniapp, subscriptionExpireAt: new Date(start + 30 * 86400000).toISOString() };
          record.status = 'paid';
        }
        return { ok: true, user: viewUser(account) };
      });
    }
    if (p === '/api/trial/survey') {
      const answers = data.answers || {};
      if (!['caught', 'sometimes', 'no'].includes(answers.caught) || !['yes', 'later'].includes(answers.recommend) || typeof answers.wish !== 'string' || answers.wish.length > 200) throw new Error('请完成问卷');
      const completedAt = now();
      await store.db.transact(rows => {
        if (rows.some(r => r.kind === 'survey' && r.userId === user.id)) throw new Error('问卷已经提交');
        rows.push({kind:'survey', id:randomUUID(), userId:user.id, answers, createdAt:completedAt});
        const saved = rows.find(r => r.kind === 'user' && r.id === user.id);
        saved.miniapp = {...saved.miniapp, surveyCompletedAt:completedAt};
      });
      return {ok:true};
    }
    if (['/api/trial/accept', '/api/trial/survey/dismiss'].includes(p) && method === 'POST') {
      const key = p.endsWith('/accept') ? 'trialCardAcceptedAt' : 'surveyDismissedAt';
      return store.db.transact(rows => {
        const account = rows.find(row => row.kind === 'user' && row.id === user.id);
        account.miniapp = { ...account.miniapp, [key]: account.miniapp?.[key] || now() };
        return viewUser(account);
      });
    }
    if (p === '/api/export') return { records: await store.export(user.id) };
    if (p === '/api/account' && method === 'DELETE') {
      if (data.confirm !== 'DELETE ALL MY DATA') throw new Error('需要明确确认删除');
      if (active.has(user.id) || letterLocks.has(user.id)) throw new Error('请等当前任务完成');
      await store.deleteUser(user.id); return { ok: true };
    }
    throw new Error('此操作在自托管小程序版中不可用');
  };
}
