import { COPY, getCopy, setAiGender } from '/shared/copy.js';
import { computeA5State } from '/shared/returning.js';
import { splitBubbles } from '/shared/protocol.js';
import { createTranslator } from '/i18n/index.js';
import { createDOMLocalizer } from '/ui/dom.js';
import { createChatView } from '/ui/chat.js';
import { createPanels } from '/ui/panels.js';
import { createDialogs } from '/ui/dialogs.js';
import { attachVoiceInput, readAloud } from '/ui/voice.js';
import { readEvents } from '/shared/sse-client.js';

const $ = id => document.getElementById(id);
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = { letters: '✉', memory: '◇', mood: '◡', about: '☷' };
const moods = { happy: '开心', calm: '平静', sad: '难过' };
const memoryLabels = { profile: '关于你', preference: '偏好', event: '近期', relation: '重要的人 / 宠物' };
let S, C = COPY, busy = false, streaming = '', recording = false, returnState = null, toastTimer, pollTimer, attachedImage = '', monthOffset = 0, extraMessages = [], modalFocus;
let route = 'chat', pendingSend = '', recognitionHandle;
let t = source => source, loadedLocale = '', languagePack;
const localizeDOM = createDOMLocalizer(() => t);
const {renderChat,renderChips,setBusyUI}=createChatView({getState:()=>S,getCopy:()=>C,getMessages:allMessages,getBehavior:()=>({busy,streaming,recording,returnState}),getTranslator:()=>t,localizeDOM,day,time,splitBubbles});
const {renderPanel,renderHistory}=createPanels({getState:()=>S,getCopy:()=>C,getMessages:allMessages,getRoute:()=>route,getMonthOffset:()=>monthOffset,getTranslator:()=>t,localizeDOM,day,time});
const {openModal,closeModal,edit,optionSheet,genderSheet,dailyMood,auth}=createDialogs({getState:()=>S,getCopy:()=>C,isBusy:()=>busy,localizeDOM});
async function loadLocale() {
  const locale = S.config.i18n.locales.find(l => l.code === S.user.profile.locale) || S.config.i18n.locales.find(l => l.code === S.config.i18n.defaultLocale);
  if (loadedLocale !== locale.code) { languagePack = await api('/api/i18n/' + encodeURIComponent(locale.code)); loadedLocale = locale.code; t = createTranslator(languagePack); }
  document.documentElement.lang = locale.code; document.documentElement.dir = locale.direction || 'ltr';
  document.title = S.config.brand.name;
  for (const brand of document.querySelectorAll('[data-brand]')) brand.textContent = S.config.brand.name;
  $('language-switch').innerHTML = S.config.i18n.locales.map(l => `<option value="${h(l.code)}" ${l.code === locale.code ? 'selected' : ''}>${h(l.label)}</option>`).join('');
}
const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求未完成');
  return result;
};
const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
function toast(text) { clearTimeout(toastTimer); $('toast').textContent = t(text); $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function day(value) { return new Intl.DateTimeFormat('sv-SE', { timeZone: S?.config.timeZone || 'UTC' }).format(new Date(value)); }
function time(value) { return new Date(value).toLocaleTimeString(loadedLocale || 'en', { hour: '2-digit', minute: '2-digit', timeZone: S?.config.timeZone || 'UTC' }); }
function applyTheme() {
  const hour = new Date().getHours(); const auto = hour >= 22 || hour < 5 ? 'night' : 'day';
  const theme = S.user.profile.theme === 'auto' ? auto : S.user.profile.theme;
  document.documentElement.dataset.theme = theme; $('theme-toggle').textContent = theme === 'night' ? '☀' : '☾';
}
function allMessages() { return [...new Map([...extraMessages, ...S.messages].map(m => [m.id, m])).values()]; }
async function refresh({ initial = false, messages = true, panel = true } = {}) {
  const previousId = S?.user.id; S = await api('/api/state');
  await loadLocale();
  if (previousId && previousId !== S.user.id) { extraMessages = []; $('message').value = ''; returnState = null; }
  setAiGender(S.user.profile.aiGender); C = getCopy(S.user.profile.aiGender); applyTheme();
  $('ai-name').textContent = S.user.profile.aiName;
  $('portrait').src = S.user.profile.aiGender === 'neutral' ? '/assets/companion-neutral.svg' : `/assets/companion-portrait${S.user.profile.aiGender === 'female' ? '-female' : ''}.jpg`;
  $('message').placeholder = `把心里的话，写给${S.user.profile.aiName}…`;
  $('mode-label').textContent = S.mode === 'demo' ? '◌ 离线规则演示' : '● 模型已连接';
  $('mode-caption').textContent = S.mode === 'demo' ? '离线演示 · 不是模型效果' : '内容由 AI 生成';
  $('consent-label').hidden = Boolean(S.user.profile.consentAt);
  $('chat-status').hidden = !S.user.profile.consentAt;
  if (messages) renderChat(); if (panel) renderPanel();
  localizeDOM(document.body);
  for (const link of document.querySelectorAll('[data-route]')) if (S.config.features[link.dataset.route] === false) link.hidden = true;
  $('mic').hidden = !S.config.features.voice;
  if (initial) {
    const last = allMessages().filter(m => m.role === 'assistant').at(-1);
    returnState = last ? computeA5State({ gapMs: Date.now() - new Date(last.createdAt).getTime(), messages: allMessages() }) : null;
    renderChips();
    if (S.activeTurn) { busy = true; streaming = S.activeTurn.content; renderChat(); poll(); }
  }
}
function scrollBottom() { $('thread-scroll').scrollTop = $('thread-scroll').scrollHeight; }
function navigate() { const next = location.hash.replace(/^#\/?/, '') || 'chat'; route = ({ me: 'about', records: 'letters' })[next] || next; if (!['chat', 'letters', 'memory', 'mood', 'about', 'security', 'feedback', 'survey', 'membership', 'history', 'privacy'].includes(route)) route = 'chat'; $('mobile-menu').hidden = true; $('menu-toggle').setAttribute('aria-expanded', 'false'); renderPanel(); }
function showMemoryBanner(memories) { if (!memories?.length) return; const box = document.createElement('div'); box.className = 'banner'; box.innerHTML = `<div class="banner-top"><span>${h(C.chat.memoryBanner.recorded)}</span><button data-action="dismiss-banner">知道了</button></div><p>“${h(memories[0].content)}”${memories.length > 1 ? ` · 还有 ${memories.length - 1} 条` : ''}</p><button class="undo" data-action="undo-memory" data-id="${h(memories[0].id)}">别记这个</button>`; $('banners').append(box); localizeDOM(box); }
function showNameBanner(profile, previous) { if (!profile || !previous) return; const box = document.createElement('div'); box.className = 'banner'; const fields = Object.keys(previous); box.innerHTML = `<div class="banner-top"><span>${h(fields.includes('aiName') ? `好，以后我叫「${profile.aiName}」` : `记住啦，你叫「${profile.nickname}」`)}</span><button data-action="dismiss-banner">好</button></div><button class="undo" data-action="undo-name" data-patch="${h(JSON.stringify(previous))}">点错了？撤销</button>`; $('banners').append(box); localizeDOM(box); }
async function poll() {
  clearTimeout(pollTimer);
  try { await refresh(); if (S.activeTurn) { busy = true; streaming = S.activeTurn.content; renderChat(); pollTimer = setTimeout(poll, 1200); } else { busy = false; streaming = ''; renderChat(); $('chat-status').textContent = t('对话已同步。'); scrollBottom(); } } catch { pollTimer = setTimeout(poll, 2500); }
}
async function sendMessage(text) {
  if (busy || !text.trim()) return;
  if (!S.user.profile.consentAt) {
    if (!$('consent').checked) return toast(C.chat.privacyAgreeToast);
    await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ consent: true }) }); S.user.profile.consentAt = new Date().toISOString();
    $('consent-label').hidden = true; $('chat-status').hidden = false;
  }
  if (!S.user.profile.onboardingDone) { pendingSend = text; genderSheet(); return; }
  const requestId = crypto.randomUUID(); busy = true; streaming = ''; returnState = null;
  S.messages.push({ id: requestId, role: 'user', content: text, createdAt: new Date().toISOString() }); $('message').value = ''; renderChat(); scrollBottom(); $('chat-status').textContent = t('在想…');
  let completed = false;
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, requestId }) });
    if (!response.ok) { const result = await response.json(); throw new Error(result.error); }
    for await (const item of readEvents(response)) {
        if (item.type === 'replace') { streaming = item.text; const nearBottom = $('thread-scroll').scrollHeight - $('thread-scroll').scrollTop - $('thread-scroll').clientHeight < 160; renderChat(); if (nearBottom) scrollBottom(); }
        if (item.type === 'status') $('chat-status').textContent = t(item.text);
        if (item.type === 'error') throw new Error(item.text);
        if (item.type === 'done') { completed = true; showMemoryBanner(item.newMemories); showNameBanner(item.profileUpdate, item.previousProfile); $('chat-status').textContent = t(item.analysisStatus === 'error' ? '回复已保存 · 本轮信息整理未完成' : '不急，慢慢说。'); }
    }
    if (!completed) throw new Error('连接中断，正在同步服务端记录…');
    busy = false; streaming = ''; await refresh(); scrollBottom();
  } catch (error) { toast(error.message || '连接中断'); $('chat-status').textContent = t('正在确认回复状态…'); await poll(); }
  finally { setBusyUI(); $('message').focus(); }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const { action, field, value, id } = button.dataset;
  try {
    if (action === 'route') location.hash = '/' + button.dataset.route;
    if (action === 'chip') await sendMessage(button.dataset.text);
    if (action === 'edit') edit(field);
    if (action === 'options') optionSheet(field);
    if (action === 'gender') genderSheet();
    if (action === 'close-modal') closeModal();
    if (action === 'set-option') { await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ [field]: value, ...(field === 'aiGender' ? { onboardingDone: true } : {}) }) }); closeModal(); await refresh({ messages: false }); if (pendingSend) { const text = pendingSend; pendingSend = ''; await sendMessage(text); } }
    if (action === 'gender-skip') { await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ onboardingDone: true }) }); closeModal(); await refresh({ messages: false }); if (pendingSend) { const text = pendingSend; pendingSend = ''; await sendMessage(text); } }
    if (action === 'month') { monthOffset += Number(button.dataset.step); renderPanel(); }
    if (action === 'checkin') { await post('/api/checkins', { mood: button.dataset.mood }); await refresh({ messages: false }); toast('今天的心情，记下了。'); }
    if (action === 'daily-checkin') { await post('/api/checkins', { mood: button.dataset.mood }); closeModal(); await refresh({ messages: false }); toast('今天的心情，记下了。'); }
    if (action === 'forget' || action === 'undo-memory') { await api('/api/memories/' + encodeURIComponent(id), { method: 'DELETE' }); button.closest('.banner')?.remove(); await refresh({ messages: false }); toast('这条长期记忆已忘记。'); }
    if (action === 'dismiss-banner') button.closest('.banner').remove();
    if (action === 'undo-name') { await api('/api/profile', { method: 'PATCH', body: button.dataset.patch }); button.closest('.banner').remove(); await refresh({ messages: false }); toast('已撤销'); }
    if (action === 'auth') auth();
    if (action === 'auth-tab') auth(button.dataset.mode);
    if (action === 'logout') { await post('/api/auth/logout'); extraMessages = []; await refresh({ initial: true }); toast('已退出，当前是新的访客身份。'); }
    if (action === 'write-letter') { button.disabled = true; button.textContent = '正在写信…'; try { await post('/api/letters'); await refresh({ messages: false }); } finally { button.disabled = false; } }
    if (action === 'copy-letter') { await navigator.clipboard.writeText(S.letters.find(l => l.id === id).content); toast('信已复制'); }
    if (action === 'reuse') { $('message').value = allMessages().find(m => m.id === id).content; $('message').focus(); renderChips(); }
    if (action === 'speak') readAloud(allMessages().find(m=>m.id===id).content, S.config.i18n.locales.find(l=>l.code===loadedLocale)?.speechLocale || loadedLocale);
    if (action === 'load-older') await loadOlder();
    if (action === 'delete-account') openModal('<h2>删除我的全部数据</h2><p>这会删除当前账户的聊天、记忆、心情、信和反馈，且无法通过应用恢复。输入“删除我的全部数据”后确认。</p><form id="delete-form"><label class="sr-only" for="delete-confirm">确认文字</label><input id="delete-confirm" required placeholder="删除我的全部数据"><div class="modal-actions"><button type="button" class="subtle-button" data-action="close-modal">保留数据</button><button class="primary" type="submit">确认删除</button></div></form>');
  } catch (error) { toast(error.message); if (action === 'write-letter') { button.disabled = false; button.textContent = '再试一次'; } }
});
document.addEventListener('submit', async event => {
  const form = event.target; if (form.id === 'chat-form') return; event.preventDefault();
  const submit = form.querySelector('[type=submit]'); if (submit) submit.disabled = true;
  try {
    if (form.id === 'edit-form') { await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ [form.dataset.field]: $('edit-value').value }) }); closeModal(); await refresh({ messages: false }); }
    if (form.id === 'auth-form') { await post('/api/auth/' + form.dataset.mode, { email: $('auth-email').value, password: $('auth-password').value }); closeModal(); extraMessages = []; await refresh({ initial: true }); toast('已登录，数据已同步。'); }
    if (form.id === 'feedback-form') { const result = await post('/api/feedback', { type: $('feedback-type').value, content: $('feedback-content').value, attachment: attachedImage || null }); form.reset(); attachedImage = ''; $('attachment-preview').hidden = true; toast(result.message); }
    if (form.id === 'survey-form') { const result = await post('/api/survey', { q1: $('survey-q1').value, q2: $('survey-q2').value, q3: $('survey-q3').value }); await refresh({ messages: false }); toast(result.message); }
    if (form.id === 'delete-form') { await api('/api/account', { method: 'DELETE', body: JSON.stringify({ confirm: $('delete-confirm').value }) }); closeModal(); extraMessages = []; $('banners').replaceChildren(); await refresh({ initial: true }); location.hash = '/chat'; toast('当前账户数据已删除，已创建新访客。'); }
  } catch (error) { if (form.id === 'auth-form') $('auth-error').textContent = t(error.message); else toast(error.message); } finally { if (submit?.isConnected) submit.disabled = false; }
});
async function loadOlder() {
  const first = allMessages()[0]; if (!first) return;
  const oldHeight = $('thread-scroll').scrollHeight;
  const result = await api('/api/messages?limit=50&before=' + encodeURIComponent(first.id));
  extraMessages = [...result.messages, ...extraMessages]; S.hasOlder = result.hasOlder; renderChat(); renderPanel(); $('thread-scroll').scrollTop = $('thread-scroll').scrollHeight - oldHeight;
}
document.addEventListener('input', event => { if (event.target.id === 'history-search') renderHistory(event.target.value); });
document.addEventListener('change', async event => {
  if (event.target.id === 'language-switch') { try { await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ locale: event.target.value }) }); loadedLocale = ''; await refresh(); } catch (error) { toast(error.message); } return; }
  if (event.target.id !== 'feedback-image') return;
  const file = event.target.files[0]; if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1000000) { event.target.value = ''; return toast('请选择小于 1 MB 的 PNG/JPEG/WebP'); }
  const reader = new FileReader(); reader.onload = () => { attachedImage = reader.result; $('attachment-preview').src = attachedImage; $('attachment-preview').hidden = false; }; reader.readAsDataURL(file);
});
$('chat-form').onsubmit = event => { event.preventDefault(); sendMessage($('message').value.trim()).catch(error => toast(error.message)); };
$('message').oninput = () => { $('message').style.height = 'auto'; $('message').style.height = Math.min(120, $('message').scrollHeight) + 'px'; renderChips(); };
$('message').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-form').requestSubmit(); } };
$('older').onclick = () => loadOlder().catch(error => toast(error.message));
$('panel-back').onclick = () => { location.hash = '/chat'; };
$('menu-toggle').onclick = () => { $('mobile-menu').hidden = !$('mobile-menu').hidden; $('menu-toggle').setAttribute('aria-expanded', String(!$('mobile-menu').hidden)); };
$('theme-toggle').onclick = async () => { try { const theme = document.documentElement.dataset.theme === 'night' ? 'day' : 'night'; await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ theme }) }); await refresh({ messages: false, panel: route === 'about' }); } catch (error) { toast(error.message); } };
attachVoiceInput({button:$('mic'),input:$('message'),getLocale:()=>S.config.i18n.locales.find(l=>l.code===loadedLocale)?.speechLocale || loadedLocale,onRecording:value=>{recording=value;renderChips();},onStatus:text=>{$('chat-status').textContent=t(text);},onError:toast});
window.addEventListener('hashchange', navigate);
window.addEventListener('visibilitychange', () => { if (!document.hidden && S) { if (busy || S.activeTurn) poll(); else refresh({ messages: false, panel: false }).catch(() => {}); } });
setInterval(() => { if (S) applyTheme(); }, 60000);
refresh({ initial: true }).then(() => { navigate(); scrollBottom(); if (route === 'chat') dailyMood(); }).catch(error => { $('chat-status').hidden = false; $('chat-status').textContent = t('连接失败，请刷新重试。'); toast(error.message); });
