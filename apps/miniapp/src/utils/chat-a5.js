
const {
  A5_OPENER_POOL,
  A5_FOOTER_QUESTION_POOL,
  FIRST_MEETING_CHIPS,
  copy
} = require("./copy");
const { tryExtractCandidatesFromMessage, isQualityA5Chip } = require("./chat-candidates");
const A5_GAP_THRESHOLD_RECENT_MS = 30 * 60 * 1000;          // ≤ 30 min → 不触发（用户刚说完）
const A5_GAP_THRESHOLD_OPENER_MS = 24 * 60 * 60 * 1000;     // > 24 h  → 触发 opener 短开场
const A5_TOPIC_HINT_MAX_LEN = 14;
const A5_TOPIC_HINT_MIN_LEN = 6;
const A5_TOPIC_LOWVALUE_RE = /^(嗯+|好的?|对|哦+|啊+|懂了|知道了?|等等|等着(呢)?|没事|哈哈+|呵呵+|是的?|不是|可以|行|ok|yes|no)$/i;
function extractLastTopicHint(messages) {
  if (!Array.isArray(messages) || !messages.length) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.dateSeparator) continue;
    const raw = typeof m.content === "string" ? m.content : "";
    if (!raw) continue;
    const trimmed = raw.replace(/^\s+|\s+$/g, "");
    const stripped = trimmed.replace(/[，。！？、,.!?\s…·～~]+$/g, "");
    if (stripped.length < A5_TOPIC_HINT_MIN_LEN) continue; // 短回应不当话题
    if (A5_TOPIC_LOWVALUE_RE.test(stripped)) continue; // "嗯嗯" / "好的" 跳过
    if (stripped.length <= A5_TOPIC_HINT_MAX_LEN) return stripped;
    return stripped.slice(0, A5_TOPIC_HINT_MAX_LEN) + "…";
  }
  return "";
}

function pickRandom(arr) {
  if (!Array.isArray(arr) || !arr.length) return "";
  return arr[Math.floor(Math.random() * arr.length)];
}
function filterRealMessages(messages) {
  return Array.isArray(messages) ? messages.filter((m) => m && !m.dateSeparator) : [];
}
function buildA5Presentation(messages, tier, pick) {
  const choose = typeof pick === "function" ? pick : pickRandom;
  const result = { chips: [], openerText: "", footerText: "", fromLastReplyCandidates: false };
  if (tier !== "chips" && tier !== "opener") return result;

  const realMessages = filterRealMessages(messages);
  let lastAssistant = null;
  for (let i = realMessages.length - 1; i >= 0; i -= 1) {
    const m = realMessages[i];
    if (m && m.role === "assistant") {
      lastAssistant = m;
      break;
    }
  }
  let chips = lastAssistant ? tryExtractCandidatesFromMessage(lastAssistant) : [];
  chips = chips.filter(isQualityA5Chip);
  result.fromLastReplyCandidates = chips.length >= 2;            // 抽到 ≥2 条才算"用 LLM 的"
  result.chips = chips.length >= 2 ? chips : FIRST_MEETING_CHIPS.slice();  // A2 兜底（保证至少 3 条可点）

  if (tier === "opener") {
    const topic = extractLastTopicHint(realMessages);
    result.openerText = choose(A5_OPENER_POOL);
    const question = choose(A5_FOOTER_QUESTION_POOL);
    result.footerText = topic
      ? copy("a5.footerTemplate", { topic, question })
      : copy("a5.footerFallback", { question });
  }
  return result;
}
function computeA5State({ gapMs, messages, pick } = {}) {
  const empty = { tier: "", chips: [], openerText: "", footerText: "", fromLastReplyCandidates: false };
  const realMessages = filterRealMessages(messages);
  if (!realMessages.length) return empty;                 // 没历史就不算（A2 接管）
  if (typeof gapMs !== "number" || Number.isNaN(gapMs)) return empty;
  if (gapMs < A5_GAP_THRESHOLD_RECENT_MS) return empty;   // ≤ 30min 啥都不出
  const tier = gapMs > A5_GAP_THRESHOLD_OPENER_MS ? "opener" : "chips";
  return Object.assign({ tier }, buildA5Presentation(realMessages, tier, pick));
}
function decideA5Suppressed({ autoSend } = {}) {
  return autoSend === "1";
}
function evaluateA5Trigger({ suppressed, computed, sending, inputValue, voiceRecording } = {}) {
  if (suppressed) return { shouldCompute: false, latch: true };
  if (computed) return { shouldCompute: false, latch: false };
  if (sending || inputValue || voiceRecording) return { shouldCompute: false, latch: false };
  return { shouldCompute: true, latch: true };
}

module.exports = {
  A5_GAP_THRESHOLD_RECENT_MS,
  A5_GAP_THRESHOLD_OPENER_MS,
  A5_OPENER_POOL,
  A5_FOOTER_QUESTION_POOL,
  FIRST_MEETING_CHIPS,
  extractLastTopicHint,
  pickRandom,
  buildA5Presentation,
  computeA5State,
  decideA5Suppressed,
  evaluateA5Trigger
};
