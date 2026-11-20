
const { copy } = require("../utils/copy");
const { MARKER_VARIANTS } = require("./chat-candidates");

function getErrorMessage(error) {
  return String((error && (error.errMsg || error.message)) || error || "");
}
function appendTraceIdHint(text, traceId) {
  if (!text) return text;
  if (typeof traceId !== "string" || !traceId) return text;
  const short = traceId.slice(0, 8);
  if (!short) return text;
  return `${text}  · 出错码: ${short}`;
}

function getStreamingFailureText(error, traceId) {
  const message = getErrorMessage(error);
  const lowerMessage = message.toLowerCase();

  if (!message) {
    return appendTraceIdHint(copy("chat.error.modelConnection"), traceId);
  }

  if (
    lowerMessage.includes("cannot find module '@cloudbase/node-sdk'") ||
    lowerMessage.includes("cloudbase ai is not available")
  ) {
    return copy("chat.error.cloudbaseAINotReady");
  }

  if (
    lowerMessage.includes("/user-messages") ||
    lowerMessage.includes("/assistant-messages") ||
    lowerMessage.includes("callfunction") ||
    lowerMessage.includes("cloud function") ||
    lowerMessage.includes("function not found") ||
    lowerMessage.includes("request failed with status code 404")
  ) {
    return copy("chat.error.cloudfunctionOldVersion");
  }

  if (
    lowerMessage.includes("ai_model_not_found") ||
    (lowerMessage.includes("model") && lowerMessage.includes("not found"))
  ) {
    return copy("chat.error.modelConfigMismatch");
  }

  if (
    lowerMessage.includes("env_feature_not_configured") ||
    lowerMessage.includes("feature_not_configured")
  ) {
    return copy("chat.error.featureNotConfigured");
  }

  if (
    lowerMessage.includes("ai_model_param_invalid") ||
    lowerMessage.includes("invalid parameter") ||
    lowerMessage.includes("invalid_request_error")
  ) {
    return copy("chat.error.parameterIncompatible");
  }

  if (lowerMessage.includes("429") || lowerMessage.includes("quota")) {
    return copy("chat.error.quotaLimit");
  }

  if (lowerMessage.includes("timed out")) {
    return copy("chat.error.timeout");
  }

  if (message.length <= 42) {
    return message;
  }

  return copy("chat.error.modelConnection");
}

function getVisibleMessages(messages = []) {
  return {
    hiddenCount: 0,
    visibleMessages: messages
  };
}

const WEEKDAYS = copy("time.weekdays");

function getMessageDate(message) {
  const raw = message && (message.createdAt || message.savedAt || message.timestamp || message.displayTime);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getDateSeparatorLabel(d) {
  if (!d) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const sameDay = getDateKey(d) === getDateKey(now);
  if (sameDay) return copy("time.today");
  if (sameYear) {
    return copy("time.dateSeparator", {
      month: d.getMonth() + 1,
      day: d.getDate(),
      weekday: WEEKDAYS[d.getDay()]
    });
  }
  return copy("time.dateSeparatorWithYear", {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: WEEKDAYS[d.getDay()]
  });
}

function decorateChatMessages(messages = []) {
  const cleaned = messages.filter((m) => {
    if (!m || m.dateSeparator) return false;
    if (m.role === "assistant" && typeof m.content === "string" && !m.content.trim()) return false;
    return true;
  });
  const result = [];
  let lastDateKey = "";
  let lastRole = "";

  cleaned.forEach((message, index) => {
    const next = cleaned[index + 1];
    const date = getMessageDate(message);
    const dateKey = date ? getDateKey(date) : "";

    if (date && dateKey && dateKey !== lastDateKey) {
      result.push({
        id: `sep-${dateKey}-${index}`,
        dateSeparator: getDateSeparatorLabel(date)
      });
      lastDateKey = dateKey;
      lastRole = "";
    }

    const showAvatar = message.role === "assistant" && lastRole !== "assistant";
    lastRole = message.role;

    result.push({
      ...message,
      showAvatar,
      showMessageTime: message.role !== "assistant" || !next || next.role !== "assistant"
    });
  });

  return result;
}

function getAssistantMessagesFromResult(result) {
  if (!result) return [];
  if (Array.isArray(result.assistantMessages)) return result.assistantMessages;
  if (result.assistantMessage) return [result.assistantMessage];
  return [];
}
function looksLikeMarkerPartial(text) {
  const t = String(text || "").replace(/^\s+|\s+$/g, "");
  if (!t) return false;
  return MARKER_VARIANTS.some((m) => m.length > t.length && m.startsWith(t));
}

module.exports = {
  getErrorMessage,
  appendTraceIdHint,
  getStreamingFailureText,
  getVisibleMessages,
  getMessageDate,
  decorateChatMessages,
  getAssistantMessagesFromResult,
  looksLikeMarkerPartial
};
