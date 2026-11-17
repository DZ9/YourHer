export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Synchronous localization preserves source text for live language switching. Never translates user data. */
export function createDOMLocalizer(getTranslator) {
  const originals = new WeakMap();
  function localized(value) {
    const t = getTranslator(); let result = t(value);
    if (result !== value) return result;
    const trimmed = value.trim(); result = t(trimmed);
    if (result !== trimmed) return value.replace(trimmed, result);
    if (/\s*›$/.test(trimmed)) return t(trimmed.replace(/\s*›$/, '')) + ' ›';
    return value;
  }
  return function localize(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; let node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (const text of nodes) {
      if (text.parentElement?.closest('.bubble,.letter-body,.memory-card p,.history-item p,.banner p,.identity #ai-name,input,textarea,script,style,[data-user-content]')) continue;
      let entry = originals.get(text);
      if (!entry || text.nodeValue !== entry.last) entry = { source: text.nodeValue };
      text.nodeValue = localized(entry.source); entry.last = text.nodeValue; originals.set(text, entry);
    }
    for (const element of root.querySelectorAll('[placeholder],[aria-label],[title],[alt],[data-text]')) {
      let entry = originals.get(element); if (!entry) entry = {};
      for (const attr of ['placeholder', 'aria-label', 'title', 'alt', 'data-text']) {
        if (!element.hasAttribute(attr)) continue;
        const value = element.getAttribute(attr); if (!entry[attr] || value !== entry[attr].last) entry[attr] = { source: value };
        const next = localized(entry[attr].source); element.setAttribute(attr, next); entry[attr].last = next;
      }
      originals.set(element, entry);
    }
  };
}
