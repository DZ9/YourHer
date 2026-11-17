// A5 续聊纯 helper —— 判定逻辑 + 上次话题提取 + 随机取样
// OpenSpec #012 瘦身 · slice 2a/2b：从 chat/index.js 平移纯函数（行为 1:1 不变，无 wx 依赖，可 node 直测）。
// slice 2b（2026-06-23）：A5 续聊判定本体 computeA5State / buildA5Presentation 抽到这里，
//   chat 的 _maybeShowA5 / _debugCycleA5 瘦成薄壳（state 入参、返回结果）；方法留 chat 原地——⚠️禁 behaviors（Page 不混入）。

import { productCopy } from "./copy.js";
const {
  A5_OPENER_POOL,
  A5_FOOTER_QUESTION_POOL,
  FIRST_MEETING_CHIPS,
  copy
} = productCopy;

// 续聊候选抽取 + chip 质量过滤（slice 1）。单向依赖：chat-a5 → chat-candidates（chat-candidates 不引 chat-a5，无循环）。
import { tryExtractCandidatesFromMessage, isQualityA5Chip } from "./candidates.js";

// A5 分档阈值（PRD §3.1#A5）：≤30min 不出 / 30min–24h 出 chips / >24h 出 opener 短开场。
const A5_GAP_THRESHOLD_RECENT_MS = 30 * 60 * 1000;          // ≤ 30 min → 不触发（用户刚说完）
const A5_GAP_THRESHOLD_OPENER_MS = 24 * 60 * 60 * 1000;     // > 24 h  → 触发 opener 短开场

// A5 topic 提取阈值（仅 extractLastTopicHint 内部使用，不对外）
const A5_TOPIC_HINT_MAX_LEN = 14;
const A5_TOPIC_HINT_MIN_LEN = 6;
// "嗯" / "好的" / "等着呢" 这类没信息量的短回应 —— 当 topic 太尴尬（"上次你提到「嗯」"），跳过找下一条。
const A5_TOPIC_LOWVALUE_RE = /^(嗯+|好的?|对|哦+|啊+|懂了|知道了?|等等|等着(呢)?|没事|哈哈+|呵呵+|是的?|不是|可以|行|ok|yes|no)$/i;

// PRD §3.1#A5：从对话末段找一句"上次的话题"，给 >24h footer 用。
// 取末条非空 user/assistant 消息前若干字（先剥 marker），过滤过短 / 无信息量的消息。
// 末尾标点剥掉再判长度，避免 "等着呢。" 4 字但实际"等着呢"是低值短回应过不去。
function extractLastTopicHint(messages) {
  if (!Array.isArray(messages) || !messages.length) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.dateSeparator) continue;
    const raw = typeof m.content === "string" ? m.content : "";
    if (!raw) continue;
    // 取剥过 marker 的 content（fullMessages 已经 processAssistantForUI 过，content 干净）
    // 末尾标点剥掉再判 —— "等着呢。" / "嗯。" / "好的!" 应该按"等着呢"/"嗯"/"好的"算
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

// 过滤掉 dateSeparator，得到真实消息序列（与 chat 的 realMessages 同口径；幂等，二次过滤无害）。
function filterRealMessages(messages) {
  return Array.isArray(messages) ? messages.filter((m) => m && !m.dateSeparator) : [];
}

// 给定 tier 构建 A5 呈现内容（chips + opener/footer），不含 gap 判定。
// tier "chips"|"opener"；其它（含 ""）→ 全空。pick 可注入做确定性单测（默认 pickRandom）。
// 被 computeA5State 与 chat 的 _debugCycleA5 薄壳共用 —— 单一事实源。
function buildA5Presentation(messages, tier, pick) {
  const choose = typeof pick === "function" ? pick : pickRandom;
  const result = { chips: [], openerText: "", footerText: "", fromLastReplyCandidates: false };
  if (tier !== "chips" && tier !== "opener") return result;

  const realMessages = filterRealMessages(messages);
  // 找末条 assistant —— marker 抽 chip 的来源（可能不在末位，若末条是 user）。
  let lastAssistant = null;
  for (let i = realMessages.length - 1; i >= 0; i -= 1) {
    const m = realMessages[i];
    if (m && m.role === "assistant") {
      lastAssistant = m;
      break;
    }
  }
  let chips = lastAssistant ? tryExtractCandidatesFromMessage(lastAssistant) : [];
  // 质量过滤：拒纯数字 / 纯标点 / 太短英文，脏 marker（测试数据 / 老消息）不该穿透到 UI。
  chips = chips.filter(isQualityA5Chip);
  result.fromLastReplyCandidates = chips.length >= 2;            // 抽到 ≥2 条才算"用 LLM 的"
  result.chips = chips.length >= 2 ? chips : FIRST_MEETING_CHIPS.slice();  // A2 兜底（保证至少 3 条可点）

  if (tier === "opener") {
    const topic = extractLastTopicHint(realMessages);
    result.openerText = choose(A5_OPENER_POOL);
    // PRD §A5 footer 格式："· 上次你提到「X」，{开放问句} ·"。topic 抽不到时退化成仅开放问句。
    const question = choose(A5_FOOTER_QUESTION_POOL);
    result.footerText = topic
      ? copy("a5.footerTemplate", { topic, question })
      : copy("a5.footerFallback", { question });
  }
  return result;
}

// PRD §3.1#A5：A5 续聊判定 —— 按 gap 决定 tier 并构建呈现内容。纯输入输出、无 this、无 wx 依赖。
// 返回 { tier, chips, openerText, footerText, fromLastReplyCandidates }；tier="" 表示不出
//（无历史 / gapMs 非数 / gap < 30min）。chat 的 _maybeShowA5 薄壳据此 setData + 埋点。
function computeA5State({ gapMs, messages, pick } = {}) {
  const empty = { tier: "", chips: [], openerText: "", footerText: "", fromLastReplyCandidates: false };
  const realMessages = filterRealMessages(messages);
  if (!realMessages.length) return empty;                 // 没历史就不算（A2 接管）
  if (typeof gapMs !== "number" || Number.isNaN(gapMs)) return empty;
  if (gapMs < A5_GAP_THRESHOLD_RECENT_MS) return empty;   // ≤ 30min 啥都不出
  const tier = gapMs > A5_GAP_THRESHOLD_OPENER_MS ? "opener" : "chips";
  return Object.assign({ tier }, buildA5Presentation(realMessages, tier, pick));
}

// #007：A5 抑制只认 autoSend —— 不再掺入可冷的 returning-user 启发式（peekMe 缓存温度）。
// 真新用户不出 A5 由「空历史 → computeA5State 返回 tier:''」+ A2 首触浮层（仅空会话渲染）共同保证，
// 不需在抑制层重复判定；这样有历史的回访用户在 me 缓存冷时 A5 触发不受影响。
function decideA5Suppressed({ autoSend } = {}) {
  return autoSend === "1";
}

// #007：A5 触发门 —— 决定是否进入判定（shouldCompute）+ 是否消费一次性 latch（latch）。
// - suppressed（autoSend）：终态，latch + 不进入（与原抑制分支同步设 _a5Computed=true）。
// - computed：已算过，不进入、不重复 latch。
// - 瞬时忙（sending/inputValue/voiceRecording）：★不 latch —— 后续触发点（hydrate→sameShape→load 末尾）可再试。
// - 其余：进入终态判定 → latch（无论最终出不出 A5）。
function evaluateA5Trigger({ suppressed, computed, sending, inputValue, voiceRecording } = {}) {
  if (suppressed) return { shouldCompute: false, latch: true };
  if (computed) return { shouldCompute: false, latch: false };
  if (sending || inputValue || voiceRecording) return { shouldCompute: false, latch: false };
  return { shouldCompute: true, latch: true };
}

export {
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
