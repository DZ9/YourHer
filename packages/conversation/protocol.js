import { MARKER_VARIANTS, MARKER_DETECT_REGEX, parseCandidatesFromMarker, stripMarkerFromContent, isQualityA5Chip } from './candidates.js';
export * from './candidates.js';
export * from './returning.js';

/** Hold even a partial marker suffix until the next chunk, including _CANDIDATES_ variants. */
export function visibleStreamText(raw, final = false) {
  const match = raw.match(MARKER_DETECT_REGEX);
  if (match) return raw.slice(0, match.index).trimEnd();
  if (!final) {
    for (let n = Math.min(raw.length, 14); n > 0; n--) {
      if (MARKER_VARIANTS.some(marker => marker.startsWith(raw.slice(-n)))) return raw.slice(0, -n);
    }
  }
  return raw;
}
export function finalizeReply(raw) {
  return { content: stripMarkerFromContent(raw).trim(), rawContent: raw, replyCandidates: parseCandidatesFromMarker(raw).filter(isQualityA5Chip) };
}
export function splitBubbles(text) { return String(text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean); }
export function localDate(timestamp = Date.now(), timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}
export function weekStart(timestamp = Date.now(), timeZone = 'Asia/Shanghai') {
  const date = new Date(`${localDate(timestamp, timeZone)}T12:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  return date.toISOString().slice(0, 10);
}
