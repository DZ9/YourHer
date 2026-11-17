import { escapeHTML as h } from './dom.js';
export function renderPrivacy(t) {
  const paragraphs = [
    ['Where your data is stored', 'Conversations, memories, moods, letters, settings and feedback are stored on the server running this instance. An HttpOnly session cookie identifies your account. Register to access the same instance from another browser; clearing a guest cookie can make that guest account inaccessible.'],
    ['What the model receives', 'In connected-model mode, the configured provider receives your message, recent conversation, selected memories and a summary. It may generate replies, suggested responses, extracted facts, names, moods, letters and summaries. Offline mode does not send model requests. Provider credentials stay on the server.'],
    ['Voice and screenshots', 'Microphone access is requested only after you choose voice input. Browser speech recognition may use an online service operated by the browser vendor. Reading aloud uses browser or system voices. Screenshots you attach to feedback are stored on this instance.'],
    ['Memory and deletion', 'Forgetting a memory removes it from long-term context but does not remove the original conversation. You can export your records or permanently delete your account under Account & data. Server backups are subject to the instance operator’s retention policy.'],
    ['No default tracking', 'This edition includes no default third-party analytics, original-product payment connection or production monitoring. Accounts belong to this instance and do not pretend to be a third-party login.'],
    ['The limits of AI', 'The companion is AI and can misunderstand, remember incorrectly or give unreliable answers. It is not a doctor or a professional mental-health service. You can correct facts, delete memories or stop using the application at any time.']
  ];
  return `<h1>${h(t('隐私政策'))}</h1><p class="panel-sub">CompanionKit · ${h(t('Self-hosted edition'))} · 2026-11-17</p><div class="privacy-text">${paragraphs.map(([heading, body]) => `<h2>${h(t(heading))}</h2><p>${h(t(body))}</p>`).join('')}</div>`;
}
