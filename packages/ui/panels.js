import { renderPrivacy } from './privacy.js';
import { escapeHTML as h } from './dom.js';
const $ = id => document.getElementById(id);
const moods={happy:'开心',calm:'平静',sad:'难过'};
const memoryLabels={profile:'关于你',preference:'偏好',event:'近期',relation:'重要的人 / 宠物'};
export function createPanels({getState,getCopy,getMessages,getRoute,getMonthOffset,getTranslator,localizeDOM,day,time}) {
let S,C,route,monthOffset;const allMessages=getMessages;
function sync(){S=getState();C=getCopy();route=getRoute();monthOffset=getMonthOffset();}
function panelTitle(title, subtitle) { return `<h1>${h(title)}</h1><p class="panel-sub">${h(subtitle)}</p>`; }
function setting(label, value, action, data = '') { return `<button class="setting-row" data-action="${h(action)}" ${data}><span>${h(label)}</span><span>${h(value)}　›</span></button>`; }
function renderPanel() { sync();
  if (!S) return;
  $('panel').hidden = route === 'chat'; $('panel-kicker').textContent = '此刻 · 留下的';
  for (const link of document.querySelectorAll('[data-route]')) if (link.dataset.route === route) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  if (route === 'chat') return;
  const p = S.user.profile; const records = allMessages(); const count = S.stats?.userMessageCount ?? records.filter(m => m.role === 'user').length;
  let content = '';
  if (route === 'memory') {
    content = panelTitle(C.panels.recordsPanel.memoryTitle, C.panels.recordsPanel.memorySub);
    content += S.memories.length ? S.memories.map(memory => `<article class="card memory-card"><span class="tag">${h(memoryLabels[memory.type])}</span><p>${h(memory.content)}</p><div class="card-foot"><time>${h(day(memory.updatedAt))}</time><button class="subtle-button" data-action="forget" data-id="${h(memory.id)}">别记这个</button></div></article>`).join('') : `<div class="empty-state">${h(C.records.memoryEmpty.title)}<p>和${h(p.aiName)}多聊几次，会慢慢记下你明确说过的事。</p></div>`;
    content += '<p class="panel-note">忘记后不再注入长期记忆，但最近对话中仍可能有这句话。可以在账户与数据中导出或删除全部记录。</p>';
  } else if (route === 'letters') {
    content = panelTitle(C.panels.recordsPanel.lettersTitle, '每个周日，把这一周轻轻收好。');
    const letters = [...S.letters].reverse();
    content += letters.length ? letters.map((letter, i) => `<article class="card letter-card"><span class="letter-meta">${i === 0 ? '最近的一封 · ' : ''}${h(letter.week)} — ${h(letter.until)}</span><div class="letter-body">${h(letter.content)}</div><div class="card-foot"><span>—— ${h(p.aiName)}</span><button class="subtle-button" data-action="copy-letter" data-id="${h(letter.id)}">复制</button></div></article>`).join('') : `<div class="empty-state">${h(C.records.lettersEmpty.title)}<p>等这一周多聊几句，再把那些话写成一封信。</p></div>`;
    content += `<button class="primary" data-action="write-letter">${letters.length ? '查看 / 写本周的信' : '写一封本周的信'}</button><p class="panel-note">至少留下三条消息后可生成；同一周只保存一封。自动周日写信由部署者配置，当前按钮可手动触发。${S.mode === 'demo' ? '离线模式生成的是明确标注的规则示例信。' : ''}</p>`;
  } else if (route === 'mood') {
    content = renderMood();
  } else if (route === 'about') {
    const days = Math.max(1, Math.floor((Date.now() - new Date(S.user.createdAt)) / 86400000) + 1);
    content = `<div class="about-hero"><h1>同行第 ${days} 天</h1><p>${h(C.panels.about.heroSub)}</p></div><div class="stats"><button class="stat" data-action="route" data-route="history"><strong>${count}${S.hasOlder ? '+' : ''}</strong><span>聊过</span></button><button class="stat" data-action="route" data-route="letters"><strong>${S.letters.length}</strong><span>收信</span></button><button class="stat" data-action="route" data-route="mood"><strong>${S.checkins.length}</strong><span>心情</span></button></div>`;
    content += `<div class="settings">${setting('此刻会员', '自托管 · 无订阅限制', 'route', 'data-route="membership"')}${!S.surveys.length ? setting('体验问卷', '说说你的感受', 'route', 'data-route="survey"') : ''}</div><h2 class="section-heading">${h(C.panels.about.sectionVoice)}</h2><div class="settings">${setting('陪伴者的样子', p.aiGender === 'neutral' ? '中性' : p.aiGender === 'male' ? '他' : '她', 'gender')}${setting('怎么叫她 / 他', p.aiName, 'edit', 'data-field="aiName"')}${setting('你的名字', p.nickname || '没设置', 'edit', 'data-field="nickname"')}${setting('说话的样子', C.me.options.preferenceLabels[p.companionPreference], 'options', 'data-field="companionPreference"')}${setting('我们的关系', C.me.options.relationshipLabels[p.relationshipMode], 'options', 'data-field="relationshipMode"')}</div><h2 class="section-heading">账号与偏好</h2><div class="settings">${setting('所在城市', p.city || '没设置', 'edit', 'data-field="city"')}${setting('语言', S.config.i18n.locales.find(l => l.code === S.user.profile.locale)?.label || S.config.i18n.defaultLocale, 'options', 'data-field="locale"')}${setting('日夜模式', { auto: '跟随时间', day: '日间暖色', night: '夜间紫金' }[p.theme], 'options', 'data-field="theme"')}${setting('账户与数据', S.user.email || '本机访客', 'route', 'data-route="security"')}${setting('问题反馈', '', 'route', 'data-route="feedback"')}${setting('隐私政策', '', 'route', 'data-route="privacy"')}</div><div class="brand-footer">${h(C.panels.about.footer)}<br>Web v0.3.0</div>`;
  } else if (route === 'feedback') {
    content = panelTitle('问题反馈', C.feedback.intro) + `<form id="feedback-form"><label class="form-label" for="feedback-type">反馈类型</label><select id="feedback-type">${C.feedback.types.map(t => `<option value="${h(t)}">${h(t)}</option>`).join('')}</select><label class="form-label" for="feedback-content">想告诉我们的话</label><textarea id="feedback-content" maxlength="2000" required placeholder="${h(C.feedback.placeholder)}"></textarea><label class="form-label" for="feedback-image">添加截图（可选，小于 1 MB）</label><input id="feedback-image" type="file" accept="image/png,image/jpeg,image/webp"><img id="attachment-preview" class="attachment-preview" alt="截图预览" hidden><p class="panel-note">反馈只保存到你正在使用的自托管实例，不会发送给原产品团队或第三方。</p><button class="primary" type="submit">提交反馈</button></form>`;
  } else if (route === 'security') {
    content = panelTitle('账户与数据', S.user.email ? '已登录 · ' + S.user.email : '本机访客 · 注册后可在其他浏览器登录同一实例');
    content += `<div class="settings">${setting('当前身份', S.user.email || '本机访客', S.user.email ? 'noop' : 'auth')}${!S.user.email ? setting('登录 / 注册', '保留访客数据', 'auth') : ''}${setting('隐私政策', '查看', 'route', 'data-route="privacy"')}</div><a class="primary" href="/api/export" download="cike-data.json">导出我的全部数据</a><p class="panel-note">导出包含聊天、记忆、心情、信和反馈，不包含密码或会话令牌。请妥善保存。</p>${S.user.email ? '<button class="subtle-button" data-action="logout">退出当前账户</button>' : ''}<h2 class="section-heading">删除数据</h2><p class="panel-note">删除当前账户及其全部记录，不影响其他账户。这个操作无法通过应用恢复。</p><button class="subtle-button danger" data-action="delete-account">删除我的全部数据</button>`;
  } else if (route === 'membership') {
    content = panelTitle('此刻会员', '完整体验，在自己的实例里。') + '<div class="card"><h2>自托管版</h2><p class="panel-sub">聊天、记忆、心情、信和所有设置均可使用。</p><strong>无订阅限制</strong></div><p class="panel-note">原小程序的体验卡和微信虚拟支付属于商业部署能力。此开源网页版不接入原商户、不收款，也不会显示虚假的支付成功。部署模型所产生的费用由实例运营者承担。</p><button class="primary" data-action="route" data-route="chat">回去聊聊</button>';
  } else if (route === 'survey') {
    content = panelTitle(C.chat.paywall.surveyTitle, '花一分钟说说感受。自托管版不需要体验卡。');
    content += S.surveys.length ? '<div class="card">已经收到你的问卷，谢谢你。</div>' : `<form id="survey-form"><label class="form-label" for="survey-q1">${h(C.chat.paywall.surveyQuestion1)}</label><select id="survey-q1"><option value="caught">接住了</option><option value="sometimes">有时候</option><option value="no">还没有</option></select><label class="form-label" for="survey-q2">${h(C.chat.paywall.surveyQuestion2)}</label><textarea id="survey-q2" maxlength="200" placeholder="随便写一句…"></textarea><label class="form-label" for="survey-q3">${h(C.chat.paywall.surveyQuestion3)}</label><select id="survey-q3"><option value="yes">愿意</option><option value="later">再看看</option></select><button class="primary" type="submit">提交问卷</button></form>`;
  } else if (route === 'history') {
    content = panelTitle('聊过的话', '向前翻翻，那些话都还在。') + '<label class="sr-only" for="history-search">搜索聊天</label><input id="history-search" class="search" placeholder="在已加载对话中搜索…"><div id="history-results"></div>' + (S.hasOlder ? '<button class="subtle-button" data-action="load-older">加载更早的话</button>' : '');
  } else if (route === 'privacy') {
    content = renderPrivacy(getTranslator());
  }
  $('panel-content').innerHTML = content; localizeDOM($('panel'));
  if (route === 'history') renderHistory('');
}
function renderMood() {
  const now = new Date(`${S.serverDate}T12:00:00`); const display = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1); const year = display.getFullYear(), month = display.getMonth();
  const cells = Array.from({ length: display.getDay() }, () => '<span></span>');
  for (let i = 1; i <= new Date(year, month + 1, 0).getDate(); i++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`; const record = S.checkins.find(c => c.date === date);
    cells.push(`<div class="day ${date === S.serverDate ? 'today' : ''} ${date > S.serverDate ? 'future' : ''}" ${record ? `data-mood="${record.mood}"` : ''} title="${h(date)}${record ? ' · ' + moods[record.mood] : ''}">${i}</div>`);
  }
  const today = S.checkins.find(c => c.date === S.serverDate); const monthly = S.checkins.filter(c => c.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`));
  return panelTitle('心情', `这个月你来过 ${monthly.length} 天`) + `<div class="mood-legend">${Object.entries(moods).map(([k, v]) => `<span><i class="mood-dot ${k}"></i>${v}</span>`).join('')}</div><div class="calendar-nav"><button data-action="month" data-step="-1" aria-label="上个月">‹</button><span>${year} 年 ${month + 1} 月</span><button data-action="month" data-step="1" aria-label="下个月">›</button></div><div class="calendar-grid">${C.panels.moodPanel.weekdayHeaders.map(w => `<div class="weekday">${w}</div>`).join('')}${cells.join('')}</div><h2 class="section-heading">${today ? '今天已经记下了，也可以改一改' : '现在心里是什么样的？'}</h2><div class="mood-picks">${Object.entries(moods).map(([key, label]) => `<button data-action="checkin" data-mood="${key}" class="${today?.mood === key ? 'selected' : ''}"><i class="mood-dot ${key}"></i>${label}</button>`).join('')}</div><p class="panel-note">${h(C.panels.moodPanel.note)} 明确打卡优先于自动推断，心情不会自动变成长期记忆。</p>`;
}
function renderHistory(query) { sync(); const results = allMessages().filter(m => !query || m.content.toLowerCase().includes(query.toLowerCase())); $('history-results').innerHTML = results.map(m => `<article class="history-item"><time>${h(day(m.createdAt))} ${h(time(m.createdAt))} · ${m.role === 'user' ? getTranslator()('你') : h(S.user.profile.aiName)}</time><p>${h(m.content)}</p></article>`).join('') || '<p class="panel-note">没有找到这句话。</p>'; localizeDOM($('history-results')); }

return {renderPanel,renderHistory};
}
