import { randomUUID } from 'node:crypto';
import { localDate, visibleStreamText, splitBubbles } from '../../packages/conversation/protocol.js';

/** Compatibility boundary for the native miniapp. Uses the web app's store and turn pipeline. */
export function createMiniappApi({ store, memory, active, runTurn, generateLetter, config, clock = Date.now, mode = "demo", letterLocks = new Set() }) {
  const now = () => new Date(clock()).toISOString();
  const viewUser = user => ({
    id: user.id, modelMode: mode, ...user.profile, ...(user.miniapp || {}), currentCity: user.profile.city,
    privacyConsentAt: user.profile.consentAt, sessionActive: true,
    loginSummary: '自托管设备会话', wechatBound: false, phoneBound: false,
    subscriptionActive: false, billingState: 'self-hosted', trialPhase: 0,
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
      return resultFor(user, turn);
    } finally { if (active.get(user.id) === turn) active.delete(user.id); }
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
    if (p === '/api/home') return { quickStarts: [], resumeCard: null, todayCheckin: null };
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
    if (p === '/api/me/letters-read') return viewUser(user);
    if (p === '/api/me/security') return { sessionActive: true, wechatBound: false, phoneBound: false, profileCompleted: true };
    if (p === '/api/companion/stats') return { daysTogether: Math.max(1, Math.floor((clock() - Date.parse(user.createdAt)) / 86400000) + 1), userMessageCount: (await messages(user.id)).filter(m => m.role === 'user').length, memoryCount: (await memory.list(user.id)).length, aiName: user.profile.aiName };
    if (p === '/api/conversations') {
      if (method === 'POST') return conversation(user);
      return { items: [{ ...conversation(user), lastMessageAt: (await messages(user.id)).at(-1)?.createdAt || user.createdAt }], nextCursor: null };
    }
    if (/^\/api\/conversations\/[^/]+$/.test(p)) return { conversation: conversation(user), messages: (await messages(user.id)).flatMap(message) };
    if (/^\/api\/conversations\/[^/]+\/(stream-generate|messages)$/.test(p)) return generate(user, data);
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
      if (method === 'DELETE') return { ok: await memory.forget(user.id, p.split('/').at(-1)) };
    }
    if (p.startsWith('/api/checkin')) {
      if (!config.features.mood) throw new Error('心情功能已关闭');
      if (method === 'POST') return { checkin: await store.checkin(user.id, data.mood), reply: '记下了。', isNew: true };
      const items = await store.read('checkin', user.id);
      if (p.endsWith('/today')) return { checkin: items.find(c => c.date === localDate(clock(), config.timeZone)) || null, streak: 0 };
      return { items };
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
    if (p.startsWith('/api/trial/')) return { granted: false, dismissed: true, selfHosted: true };
    if (p === '/api/export') return { records: await store.export(user.id) };
    if (p === '/api/account' && method === 'DELETE') {
      if (data.confirm !== 'DELETE ALL MY DATA') throw new Error('需要明确确认删除');
      if (active.has(user.id) || letterLocks.has(user.id)) throw new Error('请等当前任务完成');
      await store.deleteUser(user.id); return { ok: true };
    }
    throw new Error('此操作在自托管小程序版中不可用');
  };
}
