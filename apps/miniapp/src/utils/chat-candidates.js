const CANDIDATES_MARKER = "__CANDIDATES__";
const MARKER_VARIANTS = ["__CANDIDATES__", "_CANDIDATES_", "CANDIDATES"];
const MARKER_DETECT_REGEX = /_{0,2}CANDIDATES_{0,2}/;
const MARKER_PARSE_REGEX = /_{0,2}CANDIDATES_{0,2}\s*(\[[\s\S]*?\])/;
const MARKER_CLEAN_REGEX = /\n*_{0,2}CANDIDATES_{0,2}[\s\S]*$/;
const CANDIDATES_CHIP_MAX_LEN = 8; // PRD: chip 长度 ≤ 8 字，超过截断 + …
const CANDIDATES_CHIPS_PER_REPLY = 3; // PRD: 3 条覆盖拒绝 / 中性 / 推进
function isQualityA5Chip(text) {
  if (typeof text !== "string") return false;
  const t = text.replace(/^\s+|\s+$/g, "");
  if (t.length < 2) return false;
  if (/^\d+$/.test(t)) return false; // 纯数字
  if (/^[\p{P}\p{S}\s…·]+$/u.test(t)) return false; // 纯标点/符号
  if (/^[a-zA-Z]{1,3}$/.test(t)) return false; // "ok" / "no" 这类太短英文
  return true;
}
function stripMarkerFromContent(content) {
  if (!content) return content;
  return String(content).replace(MARKER_CLEAN_REGEX, "").replace(/\s+$/, "");
}
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
      if (trimmed.length <= CANDIDATES_CHIP_MAX_LEN) return trimmed;
      return trimmed.slice(0, CANDIDATES_CHIP_MAX_LEN) + "…";
    })
    .filter(Boolean)
    .slice(0, CANDIDATES_CHIPS_PER_REPLY);
}

function parseCandidatesFromMarker(markerText) {
  if (!markerText) return [];
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
      if (trimmed.length <= CANDIDATES_CHIP_MAX_LEN) return trimmed;
      return trimmed.slice(0, CANDIDATES_CHIP_MAX_LEN) + "…";
    })
    .filter(Boolean)
    .slice(0, CANDIDATES_CHIPS_PER_REPLY);
}
function tryExtractCandidatesFromMessage(message) {
  if (!message || message.role !== "assistant") return [];
  if (Array.isArray(message.replyCandidates) && message.replyCandidates.length) {
    return sanitizeCandidates(message.replyCandidates);
  }
  if (typeof message.rawContent === "string" && message.rawContent) {
    return parseCandidatesFromMarker(message.rawContent);
  }
  if (typeof message.content === "string" && MARKER_DETECT_REGEX.test(message.content)) {
    return parseCandidatesFromMarker(message.content);
  }
  return [];
}

module.exports = {
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
