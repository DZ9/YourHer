// 续聊候选 chip / __CANDIDATES__ marker 解析 —— 纯函数 + 常量
// OpenSpec #012 瘦身 · slice 1（slim-chat-pure-helpers）：从 chat/index.js 平移，行为 1:1 不变。
// 全部无状态、无 wx 依赖，可被 node 直测。chat/index.js 通过 require 引回，引用名不变。

// PRD §3.1#A1 续聊候选 chips —— LLM 在每次回复结尾追加 __CANDIDATES__[...] 一行（bot-config.yaml 已约定）。
// 前端在流式过程中检测到 marker 后扣住，避免标记原文滚到屏幕上；流末统一 parse 出 candidates。
const CANDIDATES_MARKER = "__CANDIDATES__";
// LLM（特别是 deepseek-v4-flash）会把 __CANDIDATES__ 当 markdown bold（__bold__）处理，
// 输出时丢掉前后双下划线变成 "CANDIDATES[...]"。前端 detect/parse 容忍 0-2 个下划线变体。
const MARKER_VARIANTS = ["__CANDIDATES__", "_CANDIDATES_", "CANDIDATES"];
const MARKER_DETECT_REGEX = /_{0,2}CANDIDATES_{0,2}/;
const MARKER_PARSE_REGEX = /_{0,2}CANDIDATES_{0,2}\s*(\[[\s\S]*?\])/;
const MARKER_CLEAN_REGEX = /\n*_{0,2}CANDIDATES_{0,2}[\s\S]*$/;
const CANDIDATES_CHIP_MAX_LEN = 8; // PRD: chip 长度 ≤ 8 字，超过截断 + …
const CANDIDATES_CHIPS_PER_REPLY = 3; // PRD: 3 条覆盖拒绝 / 中性 / 推进
// English and other Latin-script suggestions need word-sized labels rather than an 8-character cut.
function clipCandidate(text) {
  const limit = /^[\p{Script=Latin}\p{P}\p{N}\p{Z}\p{S}]+$/u.test(text) ? 32 : 8;
  const chars = Array.from(text);
  return chars.length <= limit ? text : chars.slice(0, limit).join('') + '…';
}

// A5 chip 质量过滤 —— 拒绝纯数字 / 纯标点 / 太短，避免测试数据 / 老消息 / 异常 marker 穿透到 UI。
// PRD §A1 chip ≤ 8 字，所以 2-8 字是合理窗口；纯数字（"123"）、纯标点（"。。。"）一律拒。
function isQualityA5Chip(text) {
  if (typeof text !== "string") return false;
  const t = text.replace(/^\s+|\s+$/g, "");
  if (t.length < 2) return false;
  if (/^\d+$/.test(t)) return false; // 纯数字
  if (/^[\p{P}\p{S}\s…·]+$/u.test(t)) return false; // 纯标点/符号
  if (/^[a-zA-Z]{1,3}$/.test(t)) return false; // "ok" / "no" 这类太短英文
  return true;
}

// 把 assistant content 末尾的 __CANDIDATES__[...] marker 剔掉给 UI 渲染。
function stripMarkerFromContent(content) {
  if (!content) return content;
  return String(content).replace(MARKER_CLEAN_REGEX, "").replace(/\s+$/, "");
}

// 给一条 message 做"UI 展示用 strip + 保留 rawContent"。
// rawContent 是含 marker 的原始 DB 内容，前端给 cloudrun 发 history 时用这个，
// 让 LLM 在 in-context history 里看到每条 assistant 都带 marker。
function processAssistantForUI(m) {
  if (!m || m.role !== "assistant" || typeof m.content !== "string") return m;
  const stripped = stripMarkerFromContent(m.content);
  if (stripped === m.content) return m; // 无 marker 不动
  return Object.assign({}, m, { content: stripped, rawContent: m.content });
}

function sanitizeCandidates(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s) => typeof s === "string")
    .map((s) => {
      const trimmed = s.replace(/^\s+|\s+$/g, "");
      if (!trimmed) return "";
      return clipCandidate(trimmed);
    })
    .filter(Boolean)
    .slice(0, CANDIDATES_CHIPS_PER_REPLY);
}

function parseCandidatesFromMarker(markerText) {
  if (!markerText) return [];
  // markerText 形如 "__CANDIDATES__[\"a\",\"b\",\"c\"]"，前面可能含 \n 或残留空白
  const match = String(markerText).match(MARKER_PARSE_REGEX);
  if (!match) return [];
  let arr;
  try {
    arr = JSON.parse(match[1]);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s) => typeof s === "string")
    .map((s) => {
      const trimmed = s.replace(/^\s+|\s+$/g, "");
      if (!trimmed) return "";
      return clipCandidate(trimmed);
    })
    .filter(Boolean)
    .slice(0, CANDIDATES_CHIPS_PER_REPLY);
}

// PRD §3.1#A5：从一条 assistant message 抽 chip —— 优先 message.replyCandidates（同 session 内存挂载，
// loadConversation 拿不到），其次走 rawContent（含 __CANDIDATES__ marker 的原始 DB 内容）。
// 都没有就返回空数组，调用方走 A2 FIRST_MEETING_CHIPS 兜底。
function tryExtractCandidatesFromMessage(message) {
  if (!message || message.role !== "assistant") return [];
  if (Array.isArray(message.replyCandidates) && message.replyCandidates.length) {
    return sanitizeCandidates(message.replyCandidates);
  }
  if (typeof message.rawContent === "string" && message.rawContent) {
    return parseCandidatesFromMarker(message.rawContent);
  }
  // 兼容 hydrate 阶段 cache 里可能尚未跑 processAssistantForUI 的边缘 case
  if (typeof message.content === "string" && MARKER_DETECT_REGEX.test(message.content)) {
    return parseCandidatesFromMarker(message.content);
  }
  return [];
}

export {
  CANDIDATES_MARKER,
  MARKER_VARIANTS,
  MARKER_DETECT_REGEX,
  MARKER_PARSE_REGEX,
  MARKER_CLEAN_REGEX,
  CANDIDATES_CHIP_MAX_LEN,
  CANDIDATES_CHIPS_PER_REPLY,
  isQualityA5Chip,
  stripMarkerFromContent,
  processAssistantForUI,
  sanitizeCandidates,
  parseCandidatesFromMarker,
  tryExtractCandidatesFromMessage
};
