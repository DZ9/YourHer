
const STORAGE_KEY = "chatnpc-v2-pending-finalize";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function safeTrack(eventName, props) {
  try {
    const tracker = require("./track");
    if (tracker && typeof tracker.track === "function") {
      tracker.track(eventName, props || {});
    }
  } catch (_) {

  }
}

function readPending() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw || typeof raw !== "object") return null;
    if (!raw.conversationId || !raw.clientRequestId || typeof raw.sendAt !== "number") {
      return null;
    }
    return {
      conversationId: String(raw.conversationId),
      fullText: typeof raw.fullText === "string" ? raw.fullText : "",
      clientRequestId: String(raw.clientRequestId),
      sendAt: Number(raw.sendAt)
    };
  } catch (error) {
    safeTrack("pending_finalize_storage_fail", {
      stage: "read",
      errMsg: String((error && error.errMsg) || (error && error.message) || error || "").slice(0, 120)
    });
    return null;
  }
}

function writePending(payload) {
  if (!payload || !payload.conversationId || !payload.clientRequestId) return false;
  const record = {
    conversationId: String(payload.conversationId),
    fullText: typeof payload.fullText === "string" ? payload.fullText : "",
    clientRequestId: String(payload.clientRequestId),
    sendAt: typeof payload.sendAt === "number" ? payload.sendAt : Date.now()
  };
  try {
    wx.setStorageSync(STORAGE_KEY, record);
    return true;
  } catch (error) {
    safeTrack("pending_finalize_storage_fail", {
      stage: "write",
      errMsg: String((error && error.errMsg) || (error && error.message) || error || "").slice(0, 120)
    });
    return false;
  }
}

function clearPending() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
    return true;
  } catch (error) {
    safeTrack("pending_finalize_storage_fail", {
      stage: "clear",
      errMsg: String((error && error.errMsg) || (error && error.message) || error || "").slice(0, 120)
    });
    return false;
  }
}

function isPendingExpired(pending, maxAgeMs) {
  if (!pending || typeof pending.sendAt !== "number") return true;
  const limit = typeof maxAgeMs === "number" && maxAgeMs > 0 ? maxAgeMs : DEFAULT_MAX_AGE_MS;
  return Date.now() - pending.sendAt > limit;
}

module.exports = {
  STORAGE_KEY,
  DEFAULT_MAX_AGE_MS,
  readPending,
  writePending,
  clearPending,
  isPendingExpired
};
