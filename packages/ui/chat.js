import { escapeHTML as h } from './dom.js';
const $ = id => document.getElementById(id);
export function createChatView({getState,getCopy,getMessages,getBehavior,getTranslator,localizeDOM,day,time,splitBubbles}) {
let S,C,busy,streaming,recording,returnState;
const t=(...args)=>getTranslator()(...args);
const allMessages=getMessages;
function sync(){S=getState();C=getCopy();({busy,streaming,recording,returnState}=getBehavior());}
function renderChat() { sync();
  const records = allMessages(); $('first-touch').hidden = records.length > 0; $('older').hidden = !S.hasOlder;
  let previous = ''; const fragments = [];
  for (const message of records) {
    const date = day(message.createdAt); if (date !== previous) { fragments.push(`<div class="date-label">${h(date === S.serverDate ? '今天' : date)}</div>`); previous = date; }
    fragments.push(`<article class="message-group ${message.role}" data-message-id="${h(message.id)}">${splitBubbles(message.content).map(text => `<div class="bubble">${h(text)}</div>`).join('')}<div class="message-meta"><time datetime="${h(message.createdAt)}">${h(time(message.createdAt))}</time>${message.role === 'assistant' ? `<button data-action="speak" data-id="${h(message.id)}" aria-label="朗读这条回复">听一听</button>` : `<button data-action="reuse" data-id="${h(message.id)}">再说一次</button>`}</div></article>`);
  }
  if (busy) fragments.push(`<article class="message-group assistant pending">${streaming ? splitBubbles(streaming).map(text => `<div class="bubble">${h(text)}</div>`).join('') : '<div class="bubble typing" aria-label="正在回复">···</div>'}</article>`);
  $('messages').innerHTML = fragments.join(''); localizeDOM($('messages')); renderChips(); setBusyUI();
}
function renderChips() { sync();
  if (!S) return;
  const visible = !busy && !$('message').value.trim() && !recording;
  const messages = allMessages(); const last = messages.filter(m => m.role === 'assistant').at(-1);
  const chips = returnState?.tier ? returnState.chips : last?.replyCandidates?.length ? last.replyCandidates : !messages.length ? C.a5.firstMeetingChips : [];
  $('reply-chips').innerHTML = visible && S.config.features.chips ? chips.map(text => `<button class="reply-chip" data-action="chip" data-text="${h(t(text))}">${h(t(text))}</button>`).join('') : '';
  $('return-opener').innerHTML = visible && returnState?.tier === 'opener' ? `<p>${h(returnState.openerText)}</p><small>· ${h(returnState.footerText)} ·</small>` : '';
  localizeDOM($('reply-chips')); localizeDOM($('return-opener'));
}
function setBusyUI() { sync(); $('send').disabled = busy; $('mic').disabled = busy; $('presence').textContent = t(busy ? '在想…' : '在 · 一直'); const hasInput = Boolean($('message').value.trim()); $('send').hidden = !hasInput; $('mic').hidden = hasInput || !S?.config.features.voice; document.body.classList.toggle('first-visit', !getMessages().length); }

return {renderChat,renderChips,setBusyUI};
}
