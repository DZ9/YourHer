const STORAGE_KEY = "yourher:state:" + require("../config").baseUrl;
const CACHE_STORAGE_KEY = "yourher:cache:" + require("../config").baseUrl;
const DEFAULT_LOGIN_AVATAR = "/assets/images/profile-avatar-stitch-me.jpg";
const DEFAULT_AI_NAME = "Alex";
const MAX_INTERESTS = 8;
const MAX_INTEREST_LENGTH = 16;
const MAX_AI_NAME_LENGTH = 12;
const MAX_USER_NICKNAME_LENGTH = 16;
const VALID_PREFERENCES = ["gentle", "grounded", "concise"];
const VALID_MEMORY_TYPES = ["profile", "preference", "event", "relation"];
const VALID_MEMORY_SOURCES = ["chat", "onboarding", "manual"];
const MEMORY_CONTENT_MAX = 120;
const MEMORY_LIST_LIMIT = 100;
const LOGIN_NICKNAME = "\u5fae\u4fe1\u7528\u6237";
const CONNECTED_SUMMARY = "\u5df2\u81ea\u52a8\u8fde\u63a5\u5f53\u524d\u5fae\u4fe1";
const PHONE_BOUND_SUMMARY = "\u624b\u673a\u53f7\u5df2\u7ed1\u5b9a\uff0c\u53ef\u8de8\u7aef\u540c\u6b65";
const LOGOUT_NICKNAME = "\u6b64\u523b\u8bbf\u5ba2";
const SHELL_CACHE_TTL = 60000;
const CONVERSATION_CACHE_TTL = 5 * 60 * 1000; // 5 分钟内回 chat 走纯本地 — 发消息后 invalidate 会把这个 entry 标记为 stale，逼下次 fetch 必拉 server
const CACHE_TTLS = {
  home: SHELL_CACHE_TTL,
  me: SHELL_CACHE_TTL,
  conversations: SHELL_CACHE_TTL,
  security: SHELL_CACHE_TTL,
  conversation: CONVERSATION_CACHE_TTL,
  checkin: 15000,
  highlight: 30000,
  weekly: 60000,
  companionStats: SHELL_CACHE_TTL,
  memory: 30000,
  recentCheckins: 60000
};

const HIGHLIGHT_EXCERPT_MAX = 240;
const VALID_CHECKIN_MOODS = ["happy", "calm", "sad", "great", "good", "okay", "down", "rough"];
const CHECKIN_MOOD_LABELS = {
  happy: "\u5f00\u5fc3",
  calm: "\u5e73\u9759",
  sad: "\u96be\u8fc7",
  great: "\u5f00\u5fc3",
  good: "\u5f00\u5fc3",
  okay: "\u5e73\u9759",
  down: "\u96be\u8fc7",
  rough: "\u96be\u8fc7"
};
const CHECKIN_NOTE_MAX = 120;
const DEFAULT_CONVERSATION_PAGE_SIZE = 20;
const MAX_CONVERSATION_PAGE_SIZE = 50;
const MAX_PERSISTED_CONVERSATION_SNAPSHOTS = 10;
const MAX_PERSISTED_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天 — chat 的"她替你攒着"语义下，一周内随时回来都应该看到上次的对话

const runtimeCache = {
  state: null,
  values: Object.create(null),
  inflight: Object.create(null),
  persistedStore: null
};
let cloudFallbackToastShown = false;

const QUICK_STARTS = [
  {
    id: "joy",
    title: "记录开心时刻",
    prompt: "今天有一件让我有点开心的小事，我想把它记下来。",
    icon: "sentiment_satisfied",
    iconImage: "../../assets/icons/quick-joy-0329-v2.png"
  },
  {
    id: "sort",
    title: "整理我的思绪",
    prompt: "我脑子里有点乱，想慢慢理一理现在最卡住我的是什么。",
    icon: "psychology_alt",
    iconImage: "../../assets/icons/quick-sort-0329-v2.png"
  },
  {
    id: "quote",
    title: "记下一句话",
    prompt: "我想记下一句刚刚很触动我的话，也想聊聊它为什么触动我。",
    icon: "format_quote",
    iconImage: "../../assets/icons/quick-quote-0329-v2.png"
  },
  {
    id: "low",
    title: "聊聊低落情绪",
    prompt: "虽然没有发生什么大事，但我就是有点低落，想有人陪我聊聊。",
    icon: "mood_bad",
    iconImage: "../../assets/icons/quick-low-0329-v2.png"
  }
];

const FEEDBACK_TYPES = [
  { value: "experience", label: "体验建议" },
  { value: "feature", label: "功能问题" },
  { value: "content", label: "内容不合适" },
  { value: "other", label: "其他" }
];

const PREFERENCE_LABELS = {
  concise: "更简洁",
  gentle: "更温柔",
  grounded: "更理性"
};

function getAppGlobalData() {
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    return (app && app.globalData) || null;
  } catch (error) {
    return null;
  }
}

function getCloudConfig() {
  const globalData = getAppGlobalData() || {};
  return {
    cloudEnvId: globalData.cloudEnvId,
    cloudFunctionName: globalData.cloudFunctionName
  };
}

function isLocalMockOnly() {
  const globalData = getAppGlobalData();
  return Boolean(globalData && globalData.localMockOnly);
}

function enableLocalMockOnly(reason) {
  const globalData = getAppGlobalData();

  if (globalData) {
    globalData.localMockOnly = true;
  }

  if (reason) {
    console.warn(`Cloud API disabled for this launch, switching to local mock only. ${reason}`);
  }
}

function syncCurrentUser(user) {
  const globalData = getAppGlobalData();

  if (globalData) {
    globalData.currentUser = user || null;
  }
}

function getCacheKey(scope, suffix = "") {
  return suffix ? `${scope}:${suffix}` : scope;
}

function createPersistedCacheStore() {
  return {
    version: 1,
    entries: Object.create(null)
  };
}

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function getPersistedCacheStore() {
  if (runtimeCache.persistedStore) {
    return runtimeCache.persistedStore;
  }

  let stored = null;

  try {
    stored = wx.getStorageSync(CACHE_STORAGE_KEY);
  } catch (error) {
    stored = null;
  }

  runtimeCache.persistedStore =
    stored && stored.entries
      ? {
          version: 1,
          entries: stored.entries
        }
      : createPersistedCacheStore();

  prunePersistedCacheStore();
  return runtimeCache.persistedStore;
}

function persistCacheStore() {
  try {
    wx.setStorageSync(CACHE_STORAGE_KEY, getPersistedCacheStore());
  } catch (error) {
    console.warn("persist cache store failed", error);
  }
}

function shouldPersistCacheKey(key) {
  return (
    key === "home" ||
    key === "me" ||
    key === "security" ||
    key === "weekly" ||
    key === "companionStats" ||
    key === "memory" ||
    key === "highlight" ||
    key === "checkin" ||
    /^recentCheckins:/.test(key) ||
    /^conversations:/.test(key) ||
    /^conversation:/.test(key)
  );
}

function prunePersistedCacheStore() {
  const store = runtimeCache.persistedStore || createPersistedCacheStore();
  const now = Date.now();

  Object.keys(store.entries).forEach((key) => {
    const entry = store.entries[key];

    if (!entry || !entry.updatedAt || now - entry.updatedAt > MAX_PERSISTED_CACHE_AGE) {
      delete store.entries[key];
    }
  });

  const conversationKeys = Object.keys(store.entries)
    .filter((key) => key.startsWith("conversation:"))
    .sort((left, right) => {
      const leftUpdatedAt = store.entries[left] ? store.entries[left].updatedAt : 0;
      const rightUpdatedAt = store.entries[right] ? store.entries[right].updatedAt : 0;
      return rightUpdatedAt - leftUpdatedAt;
    });

  conversationKeys.slice(MAX_PERSISTED_CONVERSATION_SNAPSHOTS).forEach((key) => {
    delete store.entries[key];
  });

  runtimeCache.persistedStore = store;
}

function setPersistedCacheEntry(key, entry) {
  if (!shouldPersistCacheKey(key)) {
    return;
  }

  const store = getPersistedCacheStore();
  store.entries[key] = clone(entry);
  prunePersistedCacheStore();
  persistCacheStore();
}

function getCachedEntry(key, options = {}) {
  const allowExpired = Boolean(options.allowExpired);
  let cached = runtimeCache.values[key];

  if (!cached) {
    const store = getPersistedCacheStore();
    const persistedEntry = store.entries[key];

    if (persistedEntry) {
      cached = clone(persistedEntry);
      runtimeCache.values[key] = cached;
    }
  }

  if (!cached) {
    return undefined;
  }

  if (!allowExpired && cached.expiresAt <= Date.now()) {
    return undefined;
  }

  return clone(cached);
}

function setCachedValue(key, value, ttl) {
  const cachedEntry = {
    expiresAt: Date.now() + ttl,
    updatedAt: Date.now(),
    value: clone(value)
  };

  runtimeCache.values[key] = cachedEntry;
  setPersistedCacheEntry(key, cachedEntry);
}

function getCachedValue(key) {
  const cached = getCachedEntry(key);
  return cached ? clone(cached.value) : undefined;
}

function getCachedSnapshot(key, options = {}) {
  const snapshot = getCachedEntry(key, { allowExpired: true });

  if (!snapshot) {
    return null;
  }

  const maxAge = Number.isFinite(options.maxAge) ? options.maxAge : MAX_PERSISTED_CACHE_AGE;

  if (maxAge > 0 && Date.now() - snapshot.updatedAt > maxAge) {
    return null;
  }

  return {
    updatedAt: snapshot.updatedAt,
    stale: snapshot.expiresAt <= Date.now(),
    value: clone(snapshot.value)
  };
}

function clearPersistedCacheEntry(key) {
  const store = getPersistedCacheStore();

  if (!store.entries[key]) {
    return;
  }

  delete store.entries[key];
  persistCacheStore();
}

function clearCachedValue(key, options = {}) {
  delete runtimeCache.values[key];
  delete runtimeCache.inflight[key];

  if (options.removeSnapshot) {
    clearPersistedCacheEntry(key);
  }
}
function markCacheStale(key) {
  const cached = runtimeCache.values[key];
  if (cached) {
    cached.expiresAt = 0;
  }
  delete runtimeCache.inflight[key];

  const store = getPersistedCacheStore();
  if (store.entries[key]) {
    store.entries[key].expiresAt = 0;
    persistCacheStore();
  }
}
function markCacheScopeStale(scope) {
  const prefix = `${scope}:`;

  Object.keys(runtimeCache.values).forEach((key) => {
    if (key === scope || key.startsWith(prefix)) {
      runtimeCache.values[key].expiresAt = 0;
    }
  });

  Object.keys(runtimeCache.inflight).forEach((key) => {
    if (key === scope || key.startsWith(prefix)) {
      delete runtimeCache.inflight[key];
    }
  });

  const store = getPersistedCacheStore();
  let dirty = false;
  Object.keys(store.entries).forEach((key) => {
    if (key === scope || key.startsWith(prefix)) {
      store.entries[key].expiresAt = 0;
      dirty = true;
    }
  });
  if (dirty) persistCacheStore();
}

function clearCachedScope(scope, options = {}) {
  const prefix = `${scope}:`;

  Object.keys(runtimeCache.values).forEach((key) => {
    if (key === scope || key.startsWith(prefix)) {
      delete runtimeCache.values[key];
    }
  });

  Object.keys(runtimeCache.inflight).forEach((key) => {
    if (key === scope || key.startsWith(prefix)) {
      delete runtimeCache.inflight[key];
    }
  });

  if (options.removeSnapshot) {
    const store = getPersistedCacheStore();

    Object.keys(store.entries).forEach((key) => {
      if (key === scope || key.startsWith(prefix)) {
        delete store.entries[key];
      }
    });

    persistCacheStore();
  }
}

function refreshCachedValue(key, ttl, loader) {
  if (runtimeCache.inflight[key]) {
    return runtimeCache.inflight[key];
  }

  runtimeCache.inflight[key] = Promise.resolve()
    .then(loader)
    .then((result) => {
      setCachedValue(key, result, ttl);
      delete runtimeCache.inflight[key];
      return result;
    })
    .catch((error) => {
      delete runtimeCache.inflight[key];
      throw error;
    });

  return runtimeCache.inflight[key];
}

async function loadCached(key, ttl, loader, options = {}) {
  if (!options.refresh) {
    const cached = getCachedValue(key);

    if (cached !== undefined) {
      return cached;
    }
  }

  return clone(await refreshCachedValue(key, ttl, loader));
}

function invalidateShellCaches(options = {}) {
  clearCachedScope("home", { removeSnapshot: Boolean(options.removeSnapshots) });
  clearCachedScope("me", { removeSnapshot: Boolean(options.removeSnapshots) });
  clearCachedScope("security", { removeSnapshot: Boolean(options.removeSnapshots) });
  clearCachedScope("conversations", { removeSnapshot: Boolean(options.removeSnapshots) });

  if (options.removeSnapshots) {
    return;
  }
}

function invalidateConversationListCaches() {
  markCacheScopeStale("home");
  markCacheScopeStale("conversations");
}

function getErrorMessage(error) {
  return String((error && error.message) || error || "");
}

function isCollectionMissingError(error) {
  const message = getErrorMessage(error);

  return (
    message.includes("DATABASE_COLLECTION_NOT_EXIST") ||
    message.includes("Db or Table not exist") ||
    message.includes("database collection not exists") ||
    message.includes("ResourceNotFound") ||
    message.includes("collection.add:fail") ||
    message.includes("collection.get:fail") ||
    message.includes("collection.where:fail") ||
    message.includes("collection.doc:fail")
  );
}

function isLocalConversationNotFound(path, error) {
  const message = getErrorMessage(error);
  return /^\/api\/conversations\/conv_/.test(path) && message.includes("Conversation not found");
}

function shouldUseLocalMockOnly(path, error) {
  return isCollectionMissingError(error) || isLocalConversationNotFound(path, error);
}

function canUseCloud() { return true; }
const TRACK_PATH = "/api/track";

function getTracker() {
  try {
    return require("../utils/track");
  } catch (e) {
    return null;
  }
}

function mintTraceId(options) {
  if (options && options.traceId) return options.traceId;
  const tracker = getTracker();
  if (tracker && typeof tracker.newTraceId === "function") {
    return tracker.newTraceId();
  }
  return undefined;
}

function emitApiLatency(path, startedAt, ok, traceId, errInfo) {
  const tracker = getTracker();
  if (!tracker || typeof tracker.track !== "function") return;
  try {
    tracker.track(
      "api_call_latency",
      {
        path,
        durationMs: Date.now() - startedAt,
        ok,
        err: ok ? undefined : String(errInfo || "").slice(0, 120)
      },
      { traceId }
    );
  } catch (e) {

  }
}

async function withCloudFallback(path, options = {}) {
  return require("./http").request(path, options);
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function invalidateConversationCache(conversationId) {
  markCacheStale(getCacheKey("conversation", conversationId));
}

function hasCustomNickname(user = {}) {
  const nickname = String(user.nickname || "").trim();
  return Boolean(nickname && nickname !== LOGIN_NICKNAME && nickname !== LOGOUT_NICKNAME);
}

function hasCustomAvatar(user = {}) {
  const avatar = String(user.avatar || "").trim();
  return Boolean(avatar && !/profile-avatar-stitch-me\.jpg(?:\?.*)?$/i.test(avatar));
}

function hasGender(user = {}) {
  return ["female", "male", "other"].includes(String(user.gender || "").trim());
}

function isProfileCompleted(user = {}) {
  return hasCustomNickname(user) && hasCustomAvatar(user) && hasGender(user);
}

function isPhoneBound(user = {}) {
  return Boolean(user.phoneBound || user.phoneMasked || user.phoneNumber);
}

function createLoginSummary(user = {}) {
  if (isPhoneBound(user)) {
    return PHONE_BOUND_SUMMARY;
  }

  return CONNECTED_SUMMARY;
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeInterestList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  value.forEach((item) => {
    const clean = cleanText(item);

    if (!clean || clean.length > MAX_INTEREST_LENGTH) {
      return;
    }

    if (seen.has(clean)) {
      return;
    }

    seen.add(clean);
    result.push(clean);
  });

  return result.slice(0, MAX_INTERESTS);
}

function normalizeAiName(value) {
  const clean = cleanText(value);
  return clean ? clean.slice(0, MAX_AI_NAME_LENGTH) : "";
}

function normalizeUserNickname(value) {
  const clean = cleanText(value);
  return clean ? clean.slice(0, MAX_USER_NICKNAME_LENGTH) : "";
}

function normalizeCompanionPreference(value) {
  const clean = cleanText(value);
  return VALID_PREFERENCES.includes(clean) ? clean : "";
}

function normalizePageLimit(value, fallback = DEFAULT_CONVERSATION_PAGE_SIZE) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, MAX_CONVERSATION_PAGE_SIZE);
}

function normalizePageCursor(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function createConversationListPath(options = {}) {
  const limit = normalizePageLimit(options.limit);
  const cursor = normalizePageCursor(options.cursor);
  const query = [`limit=${limit}`];

  if (cursor > 0) {
    query.push(`cursor=${cursor}`);
  }

  return `/api/conversations?${query.join("&")}`;
}

function getConversationListCacheKey(options = {}) {
  const limit = normalizePageLimit(options.limit);
  const cursor = normalizePageCursor(options.cursor);
  return getCacheKey("conversations", `${limit}:${cursor}`);
}

function resolveLoginNickname(user = {}, payload = {}, userInfo = {}) {
  const explicit = cleanText(payload.nickname);

  if (explicit) {
    return explicit;
  }

  if (hasCustomNickname(user)) {
    return cleanText(user.nickname);
  }

  const wechatNickname = cleanText(userInfo.nickName);

  if (wechatNickname) {
    return wechatNickname;
  }

  const savedNickname = cleanText(user.nickname);
  return savedNickname && savedNickname !== LOGOUT_NICKNAME ? savedNickname : LOGIN_NICKNAME;
}

function resolveLoginAvatar(user = {}, payload = {}, userInfo = {}) {
  const explicit = cleanText(payload.avatar);

  if (explicit) {
    return explicit;
  }

  if (hasCustomAvatar(user)) {
    return cleanText(user.avatar);
  }

  const wechatAvatar = cleanText(userInfo.avatarUrl);

  if (wechatAvatar) {
    return wechatAvatar;
  }

  return cleanText(user.avatar) || DEFAULT_LOGIN_AVATAR;
}

function mergeQuickStarts(primary = [], fallback = []) {
  const fallbackMap = fallback.reduce((map, item) => {
    map[item.id] = item;
    return map;
  }, {});

  return (primary || []).map((item) => ({
    ...(fallbackMap[item.id] || {}),
    ...item,
    iconImage: (fallbackMap[item.id] && fallbackMap[item.id].iconImage) || item.iconImage || ""
  }));
}

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function withOffset(baseDate, offsetHours) {
  return new Date(baseDate.getTime() + offsetHours * 60 * 60 * 1000).toISOString();
}

function buildTitle(content) {
  const normalized = (content || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "新的对话";
  }

  return normalized.length > 12 ? `${normalized.slice(0, 12)}…` : normalized;
}

function buildSummary(content) {
  const normalized = (content || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "慢一点也没关系，我们可以从此刻最想说的一句开始。";
  }

  return normalized.length > 30 ? `${normalized.slice(0, 30)}…` : normalized;
}

function formatClock(iso) {
  const date = new Date(iso);
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatConversationTime(iso) {
  const target = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const diffDays = Math.floor((today - targetDay) / 86400000);

  if (diffDays <= 0) {
    return `今天 · ${formatClock(iso)}`;
  }

  if (diffDays === 1) {
    return `昨天 · ${formatClock(iso)}`;
  }

  return `${target.getMonth() + 1}月${target.getDate()}日`;
}

function formatRelativeTime(iso) {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - target;
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (hours < 1) {
    return "刚刚";
  }

  if (hours < 24) {
    return `${hours}小时前`;
  }

  if (days === 1) {
    return "昨天";
  }

  if (days < 7) {
    return `${days}天前`;
  }

  return formatConversationTime(iso);
}

function getConversationExchangeCount(messages = []) {
  const userTurns = messages.filter((item) => item.role === "user").length;
  return Math.max(1, userTurns || Math.ceil(messages.length / 2) || 1);
}

function buildResumeSessionLabel(exchangeCount) {
  return `我们的第 ${Math.max(1, exchangeCount || 1)} 次交流`;
}

function mergeResumeCard(primary, fallback) {
  if (!primary && !fallback) {
    return null;
  }

  return {
    ...(fallback || {}),
    ...(primary || {}),
    title: (primary && primary.title) || (fallback && fallback.title) || "继续上次对话",
    sessionLabel:
      (primary && primary.sessionLabel) || (fallback && fallback.sessionLabel) || "",
    summary: (primary && primary.summary) || (fallback && fallback.summary) || ""
  };
}

function getLatestUserMessage(messages) {
  const userMessages = messages.filter((item) => item.role === "user");
  return userMessages[userMessages.length - 1];
}

function decorateMessage(message) {
  return {
    ...message,
    displayTime: formatClock(message.createdAt)
  };
}

function decorateConversation(conversation) {
  return {
    ...conversation,
    displayTime: formatConversationTime(conversation.lastMessageAt)
  };
}

function sortConversations(state) {
  return [...state.conversations].sort(
    (left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime()
  );
}

function createSeedState() {
  return { user: { id: "", aiName: "Alex", nickname: "", avatar: DEFAULT_LOGIN_AVATAR, sessionActive: false, interests: [] }, quickStarts: QUICK_STARTS, conversations: [], messagesByConversation: {}, feedbacks: [], memories: [], checkins: [], highlights: [], weeklyNotes: [] };
}

function ensureState() {
  if (runtimeCache.state) {
    return runtimeCache.state;
  }

  const cached = wx.getStorageSync(STORAGE_KEY);

  if (cached && cached.user && cached.conversations) {
    runtimeCache.state = cached;
    return runtimeCache.state;
  }

  const seeded = createSeedState();
  runtimeCache.state = seeded;
  wx.setStorageSync(STORAGE_KEY, seeded);
  return runtimeCache.state;
}

function saveState(state) {
  runtimeCache.state = state;
  wx.setStorageSync(STORAGE_KEY, state);
  return state;
}

async function getHome() {
  await wait();
  const state = ensureState();
  const recentConversation = sortConversations(state)[0];
  const recentMessages = recentConversation ? state.messagesByConversation[recentConversation.id] || [] : [];

  return clone({
    welcome: {
      title: "今天，想从哪里开始？",
      subtitle: "我可以陪你整理一下此刻的心绪。"
    },
    quickStarts: state.quickStarts,
    resumeCard: recentConversation
      ? {
          conversationId: recentConversation.id,
          title: "继续上次对话",
          summary: recentConversation.summary,
          sessionLabel: buildResumeSessionLabel(getConversationExchangeCount(recentMessages)),
          lastMessageAt: recentConversation.lastMessageAt,
          displayTime: formatConversationTime(recentConversation.lastMessageAt)
        }
      : null,
    todayCheckin: getTodayCheckinLocal(state),
    checkinStreak: computeCheckinStreakLocal(state)
  });
}

function todayDateKeyLocal(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeCheckinMoodLocal(value) {
  const v = String(value || "").trim();
  return VALID_CHECKIN_MOODS.indexOf(v) >= 0 ? v : "calm";
}

function decorateCheckinLocal(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    date: doc.date,
    mood: doc.mood,
    moodLabel: CHECKIN_MOOD_LABELS[doc.mood] || "",
    note: doc.note || "",
    createdAt: doc.createdAt
  };
}

function getTodayCheckinLocal(state) {
  const today = todayDateKeyLocal();
  const found = (state.checkins || []).find((c) => c.date === today);
  return found ? decorateCheckinLocal(found) : null;
}

function computeCheckinStreakLocal(state) {
  const dates = new Set((state.checkins || []).map((c) => c.date));
  if (!dates.size) return 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!dates.has(todayDateKeyLocal(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!dates.has(todayDateKeyLocal(cursor))) return 0;
  }
  let streak = 0;
  while (dates.has(todayDateKeyLocal(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function getTodayCheckinApi() {
  await wait();
  const state = ensureState();
  return clone({
    checkin: getTodayCheckinLocal(state),
    streak: computeCheckinStreakLocal(state)
  });
}

async function submitCheckinLocal(payload = {}) {
  await wait();
  const state = ensureState();
  const today = todayDateKeyLocal();
  const mood = normalizeCheckinMoodLocal(payload.mood);
  const note = String(payload.note || "").trim().slice(0, CHECKIN_NOTE_MAX);
  const now = new Date().toISOString();
  let existing = (state.checkins || []).find((c) => c.date === today);
  let isNew = false;
  if (existing) {
    existing.mood = mood;
    existing.note = note;
    existing.updatedAt = now;
  } else {
    existing = {
      id: createId("chk"),
      date: today,
      mood,
      note,
      createdAt: now,
      updatedAt: now
    };
    state.checkins = (state.checkins || []).concat(existing);
    isNew = true;
  }

  const replies = {
    happy: "\u90a3\u5c31\u597d\u3002\u62ff\u4f4f\u8fd9\u79cd\u8f7b\u76c8\u3002",
    calm: "\u5ef6\u7eed\u4e00\u5929\u4e5f\u662f\u7a33\u3002",
    sad: "\u6211\u5728\u3002\u6162\u6162\u8bf4\u4e0d\u6025\u3002"
  };
  return clone({
    checkin: decorateCheckinLocal(existing),
    reply: replies[mood] || replies.calm,
    streak: computeCheckinStreakLocal(state),
    isNew
  });
}

async function fetchTodayCheckin(options = {}) {
  return loadCached(
    "checkin",
    CACHE_TTLS.checkin,
    () =>
      withCloudFallback("/api/checkin/today", {}, () => getTodayCheckinApi()),
    options
  );
}

async function submitCheckinCloud(payload = {}) {
  const result = await withCloudFallback(
    "/api/checkin",
    {
      method: "POST",
      data: payload,
      allowFallback: false
    },
    () => submitCheckinLocal(payload)
  );
  markCacheScopeStale("checkin");
  markCacheScopeStale("recentCheckins");   // me 看 365 天 / records 看 30 天
  markCacheScopeStale("companionStats");   // 同行天数变了
  markCacheScopeStale("home");             // home 的 todayCheckin 字段
  return result;
}

function decorateHighlightLocal(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    messageId: doc.messageId || "",
    conversationId: doc.conversationId || "",
    role: doc.role || "assistant",
    excerpt: doc.excerpt || "",
    savedAt: doc.savedAt || doc.createdAt,
    createdAt: doc.createdAt
  };
}

async function listHighlightsLocal() {
  await wait();
  const state = ensureState();
  const items = (state.highlights || [])
    .slice()
    .sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""))
    .map(decorateHighlightLocal);
  return clone({ items });
}

async function addHighlightLocal(payload = {}) {
  await wait();
  const state = ensureState();
  const messageId = String(payload.messageId || "").trim();
  const excerpt = String(payload.excerpt || "").trim().slice(0, HIGHLIGHT_EXCERPT_MAX);
  if (!excerpt) throw new Error("Highlight excerpt is required");

  if (messageId) {
    const existing = (state.highlights || []).find((h) => h.messageId === messageId);
    if (existing) return clone(decorateHighlightLocal(existing));
  }
  const now = new Date().toISOString();
  const doc = {
    id: createId("hl"),
    messageId,
    conversationId: String(payload.conversationId || "").trim(),
    role: payload.role === "user" ? "user" : "assistant",
    excerpt,
    savedAt: now,
    createdAt: now
  };
  state.highlights = (state.highlights || []).concat(doc);
  return clone(decorateHighlightLocal(doc));
}

async function deleteHighlightLocal(highlightId) {
  await wait();
  const state = ensureState();
  state.highlights = (state.highlights || []).filter((h) => h.id !== highlightId);
  return { ok: true };
}

async function listWeeklyNotesLocal() {
  await wait();
  const state = ensureState();
  const items = (state.weeklyNotes || [])
    .slice()
    .sort((a, b) => (b.weekStart || "").localeCompare(a.weekStart || ""));
  return clone({ items });
}

async function fetchHighlights(options = {}) {
  return loadCached(
    "highlight",
    CACHE_TTLS.highlight,
    () => withCloudFallback("/api/highlights", {}, () => listHighlightsLocal()),
    options
  );
}

async function createHighlight(payload = {}) {
  const result = await withCloudFallback(
    "/api/highlights",
    { method: "POST", data: payload, allowFallback: false },
    () => addHighlightLocal(payload)
  );
  clearCachedScope("highlight");
  return result;
}

async function removeHighlight(highlightId) {
  const result = await withCloudFallback(
    `/api/highlights/${highlightId}`,
    { method: "DELETE", allowFallback: false },
    () => deleteHighlightLocal(highlightId)
  );
  clearCachedScope("highlight");
  return result;
}

async function fetchWeeklyNotes(options = {}) {
  return loadCached(
    "weekly",
    CACHE_TTLS.weekly,
    () => withCloudFallback("/api/weekly-notes", {}, () => listWeeklyNotesLocal()),
    options
  );
}

async function createConversation(payload = {}) {
  await wait();
  const state = ensureState();
  const createdAt = new Date().toISOString();
  const conversation = {
    id: createId("conv"),
    title: buildTitle(payload.initialMessage),
    summary: buildSummary(payload.initialMessage),
    status: "active",
    source: payload.source || "manual",
    createdAt,
    updatedAt: createdAt,
    lastMessageAt: createdAt
  };

  state.conversations = state.conversations.map((item) => ({
    ...item,
    status: "archived"
  }));
  state.conversations.unshift(conversation);
  state.messagesByConversation[conversation.id] = [];
  saveState(state);

  return clone(conversation);
}

async function listConversations(options = {}) {
  await wait();
  const state = ensureState();
  const limit = normalizePageLimit(options.limit);
  const offset = normalizePageCursor(options.cursor);
  const sorted = sortConversations(state);
  const pageItems = sorted.slice(offset, offset + limit).map((item) => decorateConversation(item, state));

  return clone({
    items: pageItems,
    nextCursor: offset + limit < sorted.length ? String(offset + limit) : null
  });
}

async function getConversation(conversationId) {
  await wait();
  const state = ensureState();
  const conversation = state.conversations.find((item) => item.id === conversationId);
  const messages = (state.messagesByConversation[conversationId] || []).map(decorateMessage);

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return clone({
    conversation: decorateConversation(conversation, state),
    messages
  });
}

async function sendMessage(conversationId, content) {
  throw new Error("Local mock dialogue is disabled; CloudBase AI is required.");
}

async function getMe() {
  await wait();
  const user = ensureState().user;
  return clone({
    ...user,
    sessionActive: true,
    phoneBound: isPhoneBound(user),
    gender: user.gender || "",
    profileCompleted: isProfileCompleted(user),
    aiName: user.aiName || DEFAULT_AI_NAME,
    aiMoodSnapshot: user.aiMoodSnapshot || "",
    interests: Array.isArray(user.interests) ? user.interests : [],
    onboardingCompleted: Boolean(user.onboardingCompleted),
    onboardingCompletedAt: user.onboardingCompletedAt || "",
    loginSummary: createLoginSummary(user)
  });
}

async function login(payload = {}) {
  await wait();
  const state = ensureState();
  const userInfo = payload.userInfo || {};

  if (payload.silent && state.user.sessionActive === false) {
    return clone(state.user);
  }

  state.user = {
    ...state.user,
    nickname: resolveLoginNickname(state.user, payload, userInfo),
    avatar: resolveLoginAvatar(state.user, payload, userInfo),
    sessionActive: true,
    wechatBound: true,
    loginSummary: createLoginSummary({
      ...state.user,
      sessionActive: true
    })
  };
  saveState(state);
  return clone(state.user);
}

async function updateSettings(payload) {
  await wait();
  const state = ensureState();
  state.user = {
    ...state.user,
    ...payload
  };
  saveState(state);
  return clone(state.user);
}

async function updateProfile(payload = {}) {
  await wait();
  const state = ensureState();
  const nextUser = {
    ...state.user
  };

  if (payload.avatar) {
    nextUser.avatar = payload.avatar;
  }

  if (typeof payload.nickname === "string" && payload.nickname.trim()) {
    nextUser.nickname = normalizeUserNickname(payload.nickname);
  }

  if (payload.gender) {
    nextUser.gender = payload.gender;
  }

  if (typeof payload.aiName === "string") {
    const aiName = normalizeAiName(payload.aiName);
    if (aiName) {
      nextUser.aiName = aiName;
    }
  }

  if (Array.isArray(payload.interests)) {
    nextUser.interests = normalizeInterestList(payload.interests);
  }

  const preference = normalizeCompanionPreference(payload.companionPreference);
  if (preference) {
    nextUser.companionPreference = preference;
  }

  if (typeof payload.currentCity === "string" && payload.currentCity.trim()) {
    nextUser.currentCity = payload.currentCity.trim().slice(0, 32);
  }
  if (typeof payload.currentCityAdcode === "string" && /^\d{6}$/.test(payload.currentCityAdcode.trim())) {
    nextUser.currentCityAdcode = payload.currentCityAdcode.trim();
  }

  nextUser.profileCompleted = isProfileCompleted(nextUser);
  nextUser.loginSummary = createLoginSummary(nextUser);
  state.user = nextUser;
  saveState(state);
  return clone(state.user);
}

async function completeOnboarding(payload = {}) {
  await wait();
  const state = ensureState();
  const nextUser = {
    ...state.user
  };

  const userNickname = normalizeUserNickname(payload.nickname);
  if (userNickname) {
    nextUser.nickname = userNickname;
  }

  const aiName = normalizeAiName(payload.aiName);
  nextUser.aiName = aiName || nextUser.aiName || DEFAULT_AI_NAME;

  const preference = normalizeCompanionPreference(payload.companionPreference);
  if (preference) {
    nextUser.companionPreference = preference;
  }

  if (Array.isArray(payload.interests)) {
    nextUser.interests = normalizeInterestList(payload.interests);
  }

  nextUser.onboardingCompleted = true;
  nextUser.onboardingCompletedAt = new Date().toISOString();
  nextUser.profileCompleted = isProfileCompleted(nextUser);
  nextUser.loginSummary = createLoginSummary(nextUser);
  state.user = nextUser;

  writeOnboardingMemoriesLocal(state, {
    nickname: nextUser.nickname,
    aiName: nextUser.aiName,
    companionPreference: nextUser.companionPreference,
    interests: nextUser.interests
  });

  saveState(state);
  return clone(state.user);
}

function normalizeMemoryType(value) {
  const clean = cleanText(value);
  return VALID_MEMORY_TYPES.includes(clean) ? clean : "event";
}

function normalizeMemorySource(value) {
  const clean = cleanText(value);
  return VALID_MEMORY_SOURCES.includes(clean) ? clean : "manual";
}

function normalizeMemoryContent(value) {
  const clean = cleanText(value);
  return clean ? clean.slice(0, MEMORY_CONTENT_MAX) : "";
}

function decorateMemory(doc = {}) {
  return {
    id: doc.id || doc._id,
    type: doc.type,
    content: doc.content,
    source: doc.source || "manual",
    pinned: Boolean(doc.pinned),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt || doc.createdAt
  };
}

function generateLocalId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sortMemoriesList(list = []) {
  return list.slice().sort((a, b) => {
    if (Boolean(b.pinned) !== Boolean(a.pinned)) {
      return Boolean(b.pinned) ? 1 : -1;
    }
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}

function writeOnboardingMemoriesLocal(state, payload = {}) {
  const memories = Array.isArray(state.memories) ? state.memories : [];
  const now = new Date().toISOString();

  function pushIfMissing(type, content, source, pinned) {
    const trimmed = normalizeMemoryContent(content);
    if (!trimmed) return;
    const exists = memories.some((item) => item.type === type && item.content === trimmed);
    if (exists) return;
    memories.push({
      id: generateLocalId("mem"),
      type,
      content: trimmed,
      source,
      pinned: Boolean(pinned),
      createdAt: now,
      updatedAt: now
    });
  }

  if (payload.nickname) {
    pushIfMissing("profile", `\u7528\u6237\u5e0c\u671b\u88ab\u79f0\u547c\u4e3a\u300c${payload.nickname}\u300d`, "onboarding", true);
  }
  if (payload.aiName) {
    pushIfMissing("profile", `\u7528\u6237\u7ed9\u6211\u53d6\u7684\u540d\u5b57\u662f\u300c${payload.aiName}\u300d`, "onboarding", true);
  }
  const preferenceLabels = { gentle: "\u6e29\u67d4", grounded: "\u6c89\u9759", concise: "\u6d3b\u6cfc" };
  if (payload.companionPreference && preferenceLabels[payload.companionPreference]) {
    pushIfMissing(
      "preference",
      `\u7528\u6237\u5e0c\u671b\u6211\u7684\u8bed\u6c14\u662f${preferenceLabels[payload.companionPreference]}\u7684`,
      "onboarding",
      false
    );
  }
  if (Array.isArray(payload.interests)) {
    payload.interests.forEach((item) => {
      pushIfMissing("preference", `\u7528\u6237\u6700\u8fd1\u5728\u610f\u7684\u4e8b\uff1a${item}`, "onboarding", false);
    });
  }

  state.memories = memories;
}

async function listMemoriesLocal() {
  await wait();
  const state = ensureState();
  const memories = Array.isArray(state.memories) ? state.memories : [];
  return {
    items: sortMemoriesList(memories).slice(0, MEMORY_LIST_LIMIT).map(decorateMemory)
  };
}

async function addMemoryLocal(payload = {}) {
  await wait();
  const state = ensureState();
  const type = normalizeMemoryType(payload.type);
  const content = normalizeMemoryContent(payload.content);
  const source = normalizeMemorySource(payload.source);

  if (!content) {
    throw new Error("Memory content is required");
  }

  const memories = Array.isArray(state.memories) ? state.memories : [];
  const existing = memories.find((item) => item.type === type && item.content === content);
  if (existing) {
    return decorateMemory(existing);
  }

  const now = new Date().toISOString();
  const doc = {
    id: generateLocalId("mem"),
    type,
    content,
    source,
    pinned: Boolean(payload.pinned),
    createdAt: now,
    updatedAt: now
  };
  memories.push(doc);
  state.memories = memories;
  saveState(state);
  return decorateMemory(doc);
}

async function updateMemoryLocal(memoryId, payload = {}) {
  await wait();
  const state = ensureState();
  const memories = Array.isArray(state.memories) ? state.memories : [];
  const target = memories.find((item) => item.id === memoryId);

  if (!target) {
    throw new Error("Memory not found");
  }

  if (typeof payload.content === "string") {
    const content = normalizeMemoryContent(payload.content);
    if (!content) throw new Error("Memory content is required");
    target.content = content;
  }
  if (typeof payload.type === "string") {
    target.type = normalizeMemoryType(payload.type);
  }
  if (typeof payload.pinned === "boolean") {
    target.pinned = payload.pinned;
  }
  target.updatedAt = new Date().toISOString();

  saveState(state);
  return decorateMemory(target);
}

async function deleteMemoryLocal(memoryId) {
  await wait();
  const state = ensureState();
  const memories = Array.isArray(state.memories) ? state.memories : [];
  state.memories = memories.filter((item) => item.id !== memoryId);
  saveState(state);
  return { ok: true };
}

async function getSecurity() {
  await wait();
  const state = ensureState();
  return clone({
    sessionActive: true,
    wechatBound: state.user.wechatBound,
    phoneBound: isPhoneBound(state.user),
    phoneMasked: state.user.phoneMasked,
    gender: state.user.gender || "",
    profileCompleted: isProfileCompleted(state.user)
  });
}

async function submitFeedback(payload) {
  await wait(40);
  const state = ensureState();
  const feedback = {
    id: createId("fb"),
    userId: state.user.id,
    type: payload.type,
    content: payload.content,
    contact: payload.contact || "",
    createdAt: new Date().toISOString()
  };
  state.feedbacks.unshift(feedback);
  saveState(state);
  return clone(feedback);
}
async function logout() {
  await wait();
  return clone(ensureState().user);
}

function getFeedbackTypes() {
  return clone(FEEDBACK_TYPES);
}

function getPreferenceOptions() {
  return clone([
    { value: "gentle", label: PREFERENCE_LABELS.gentle },
    { value: "grounded", label: PREFERENCE_LABELS.grounded },
    { value: "concise", label: PREFERENCE_LABELS.concise }
  ]);
}

function getLocalHomeSnapshot() {
  const state = ensureState();
  const recentConversation = sortConversations(state)[0];
  const recentMessages = recentConversation ? state.messagesByConversation[recentConversation.id] || [] : [];

  return clone({
    welcome: {
      title: "浠婂ぉ锛屾兂浠庡摢閲屽紑濮嬶紵",
      subtitle: "鎴戝彲浠ラ櫔浣犳暣鐞嗕竴涓嬫鍒荤殑蹇冪华銆?"
    },
    quickStarts: state.quickStarts,
    resumeCard: recentConversation
      ? {
          conversationId: recentConversation.id,
          title: "缁х画涓婃瀵硅瘽",
          summary: recentConversation.summary,
          sessionLabel: buildResumeSessionLabel(getConversationExchangeCount(recentMessages)),
          lastMessageAt: recentConversation.lastMessageAt,
          displayTime: formatConversationTime(recentConversation.lastMessageAt)
        }
      : null
  });
}

function getLocalConversationListSnapshot(options = {}) {
  const state = ensureState();
  const limit = normalizePageLimit(options.limit);
  const offset = normalizePageCursor(options.cursor);
  const sorted = sortConversations(state);
  const pageItems = sorted.slice(offset, offset + limit).map((item) => decorateConversation(item, state));

  return clone({
    items: pageItems,
    nextCursor: offset + limit < sorted.length ? String(offset + limit) : null
  });
}

function getLocalConversationSnapshot(conversationId) {
  const state = ensureState();
  const conversation = state.conversations.find((item) => item.id === conversationId);
  const messages = (state.messagesByConversation[conversationId] || []).map(decorateMessage);

  if (!conversation) {
    return null;
  }

  return clone({
    conversation: decorateConversation(conversation, state),
    messages
  });
}

function getLocalMeSnapshot() {
  const user = ensureState().user;

  return clone({
    ...user,
    sessionActive: true,
    phoneBound: isPhoneBound(user),
    gender: user.gender || "",
    profileCompleted: isProfileCompleted(user),
    loginSummary: createLoginSummary(user)
  });
}

function getLocalSecuritySnapshot() {
  const state = ensureState();

  return clone({
    sessionActive: true,
    wechatBound: state.user.wechatBound,
    phoneBound: isPhoneBound(state.user),
    phoneMasked: state.user.phoneMasked,
    gender: state.user.gender || "",
    profileCompleted: isProfileCompleted(state.user)
  });
}

function getHomeShellSnapshot() {
  return clone({
    welcome: {
      title: "今天，想从哪里开始？",
      subtitle: "我可以陪你整理一下此刻的心绪。"
    },
    quickStarts: QUICK_STARTS,
    resumeCard: null
  });
}

function peekHome() {
  const snapshot = getCachedSnapshot("home");
  return snapshot ? snapshot.value : getHomeShellSnapshot();
}

function peekConversations(options = {}) {
  const snapshot = getCachedSnapshot(getConversationListCacheKey(options));
  return snapshot ? snapshot.value : null;
}

function peekConversation(conversationId) {
  if (!conversationId) {
    return null;
  }

  const snapshot = getCachedSnapshot(getCacheKey("conversation", conversationId));
  return snapshot ? snapshot.value : null;
}

function peekMe() {
  const globalData = getAppGlobalData();
  const currentUser = globalData && globalData.currentUser;

  if (currentUser) {
    return clone(currentUser);
  }

  const snapshot = getCachedSnapshot("me");
  return snapshot ? snapshot.value : null;
}
function mergeLocalUser(patch) {
  if (!patch || typeof patch !== "object") return null;
  const current = peekMe() || {};
  const merged = { ...current, ...patch };
  syncCurrentUser(merged);
  try {
    setCachedValue("me", merged, CACHE_TTLS.me);
  } catch (_) {

  }
  return merged;
}

function peekSecurity() {
  const snapshot = getCachedSnapshot("security");
  if (snapshot) {
    return snapshot.value;
  }

  const globalData = getAppGlobalData();
  const currentUser = globalData && globalData.currentUser;

  if (!currentUser) {
    return null;
  }

  return clone({
    sessionActive: true,
    wechatBound: currentUser.wechatBound !== false,
    phoneBound: isPhoneBound(currentUser),
    phoneMasked: currentUser.phoneMasked || "",
    gender: currentUser.gender || "",
    profileCompleted: isProfileCompleted(currentUser)
  });
}

async function fetchHome(options = {}) {
  return loadCached("home", CACHE_TTLS.home, async () => {
    const localHome = await getHome();
    let cloudHome = null;

    try {
      cloudHome = await withCloudFallback("/api/home", { allowFallback: false }, () => localHome);
    } catch (error) {
      console.warn("Cloud home unavailable; showing shell without mock resume.", error);
      cloudHome = {};
    }

    const mergedQuickStarts =
      cloudHome && cloudHome.quickStarts && cloudHome.quickStarts.length
        ? mergeQuickStarts(cloudHome.quickStarts, localHome.quickStarts)
        : localHome.quickStarts;

    return {
      welcome: {
        ...localHome.welcome,
        ...((cloudHome && cloudHome.welcome) || {})
      },
      quickStarts: mergedQuickStarts,
      resumeCard: cloudHome && cloudHome.resumeCard ? mergeResumeCard(cloudHome.resumeCard, null) : null,
      todayCheckin: (cloudHome && cloudHome.todayCheckin) || (localHome && localHome.todayCheckin) || null,
      checkinStreak: (cloudHome && cloudHome.checkinStreak) || (localHome && localHome.checkinStreak) || 0
    };
  }, options);
}

async function createConversationEntry(payload = {}) {
  const result = await withCloudFallback(
    "/api/conversations",
    {
      method: "POST",
      data: payload,
      allowFallback: false
    },
    () => createConversation(payload)
  );

  if (result && result._id && !result.id) {
    invalidateConversationListCaches();
    return {
      ...result,
      id: result._id
    };
  }

  invalidateConversationListCaches();
  return result;
}

async function fetchConversations(options = {}) {
  const requestOptions = {
    ...options
  };
  const cacheKey = getConversationListCacheKey(requestOptions);

  delete requestOptions.refresh;

  return loadCached(
    cacheKey,
    CACHE_TTLS.conversations,
    () =>
      withCloudFallback(createConversationListPath(requestOptions), { allowFallback: false }, () =>
        listConversations(requestOptions)
      ),
    options
  );
}

async function fetchConversation(conversationId, options = {}) {
  return loadCached(
    getCacheKey("conversation", conversationId),
    CACHE_TTLS.conversation,
    () =>
      withCloudFallback(`/api/conversations/${conversationId}`, { allowFallback: false }, () =>
        getConversation(conversationId)
      ),
    options
  );
}

async function createMessage(conversationId, content) {
  const result = await withCloudFallback(
    `/api/conversations/${conversationId}/messages`,
    {
      method: "POST",
      data: { content, clientRequestId: getAppGlobalData() && getAppGlobalData().lastRequestId },
      allowFallback: false,
      timeout: 70000
    },
    () => sendMessage(conversationId, content)
  );

  invalidateConversationListCaches();
  invalidateConversationCache(conversationId);
  return result;
}

async function createUserMessage(conversationId, content) {
  const result = await withCloudFallback(
    `/api/conversations/${conversationId}/user-messages`,
    {
      method: "POST",
      data: { content, clientRequestId: getAppGlobalData() && getAppGlobalData().lastRequestId },
      allowFallback: false,
      timeout: 30000
    },
    () => sendMessage(conversationId, content)
  );

  invalidateConversationListCaches();
  invalidateConversationCache(conversationId);
  return result;
}

async function createAssistantMessage(conversationId, content) {
  const result = await withCloudFallback(
    `/api/conversations/${conversationId}/assistant-messages`,
    {
      method: "POST",
      data: { content, clientRequestId: getAppGlobalData() && getAppGlobalData().lastRequestId },
      allowFallback: false,
      timeout: 30000
    },
    () => sendMessage(conversationId, content)
  );

  invalidateConversationListCaches();
  invalidateConversationCache(conversationId);
  return result;
}
async function prepareStream(conversationId, content, opts) {
  const result = await withCloudFallback(
    `/api/conversations/${conversationId}/prepare-stream`,
    {
      method: "POST",
      data: {
        content,
        clientRequestId: opts && opts.clientRequestId
      },
      allowFallback: false,
      timeout: 30000,
      traceId: opts && opts.traceId
    },
    () => Promise.reject(new Error("prepareStream requires cloud function"))
  );
  invalidateConversationListCaches();
  invalidateConversationCache(conversationId);
  return result;
}
async function streamGenerate(conversationId, sessionId, content, opts) {
  const result = await withCloudFallback(
    `/api/conversations/${conversationId}/stream-generate`,
    {
      method: "POST",
      data: { sessionId, content, clientRequestId: opts && opts.clientRequestId },
      allowFallback: false,
      timeout: 70000,
      traceId: opts && opts.traceId
    },
    () => Promise.reject(new Error("streamGenerate requires cloud function"))
  );
  invalidateConversationListCaches();
  invalidateConversationCache(conversationId);
  return result;
}
async function streamPoll(sessionId, opts) {
  return withCloudFallback(
    `/api/stream-poll`,
    {
      method: "POST",
      data: { sessionId },
      allowFallback: false,
      timeout: 8000,
      traceId: opts && opts.traceId
    },
    () => Promise.reject(new Error("streamPoll requires cloud function"))
  );
}
async function generateAssistantFromHistory(conversationId, opts) {
  const result = await withCloudFallback(
    `/api/conversations/${conversationId}/generate-assistant`,
    {
      method: "POST",
      data: {
        clientRequestId: opts && opts.clientRequestId
      },
      allowFallback: false,
      timeout: 70000,
      traceId: opts && opts.traceId
    },
    () => Promise.reject(new Error("generateAssistantFromHistory requires cloud function"))
  );
  invalidateConversationListCaches();
  invalidateConversationCache(conversationId);
  return result;
}
async function finalizeStream(conversationId, userContent, assistantContent, opts) {
  const result = await withCloudFallback(
    `/api/conversations/${conversationId}/finalize-stream`,
    {
      method: "POST",
      data: {
        userContent,
        assistantContent,
        clientRequestId: opts && opts.clientRequestId
      },
      allowFallback: false,
      timeout: 30000,
      traceId: opts && opts.traceId
    },
    () => Promise.reject(new Error("finalizeStream requires cloud function"))
  );
  invalidateConversationListCaches();
  invalidateConversationCache(conversationId);
  return result;
}

async function fetchRecentCheckins(days = 30, options = {}) {
  return loadCached(
    getCacheKey("recentCheckins", String(days)),
    CACHE_TTLS.recentCheckins,
    () => withCloudFallback(
      `/api/checkin/recent?days=${days}`,
      {},
      () => Promise.resolve({ items: [] })
    ),
    options
  );
}

async function fetchCompanionStats(options = {}) {
  return loadCached(
    "companionStats",
    CACHE_TTLS.companionStats,
    () => withCloudFallback(
      "/api/companion/stats",
      {},
      () => Promise.resolve({
        daysTogether: 1,
        userMessageCount: 0,
        memoryCount: 0,
        aiName: "\u6b64\u523b"
      })
    ),
    options
  );
}

function peekCompanionStats() {
  const snapshot = getCachedSnapshot("companionStats");
  return snapshot ? snapshot.value : null;
}

function peekWeeklyNotes() {
  const snapshot = getCachedSnapshot("weekly");
  return snapshot ? snapshot.value : null;
}

function peekTodayCheckin() {
  const snapshot = getCachedSnapshot("checkin");
  return snapshot ? snapshot.value : null;
}

function peekHighlights() {
  const snapshot = getCachedSnapshot("highlight");
  return snapshot ? snapshot.value : null;
}

function peekMemories() {
  const snapshot = getCachedSnapshot("memory");
  return snapshot ? snapshot.value : null;
}
function peekRecentCheckins(days = 30) {
  const snapshot = getCachedSnapshot(getCacheKey("recentCheckins", String(days)));
  return snapshot ? snapshot.value : null;
}

async function regenerateAssistantMessage(conversationId) {
  const result = await withCloudFallback(
    `/api/conversations/${conversationId}/regenerate`,
    {
      method: "POST",
      data: {},
      allowFallback: false,
      timeout: 70000
    },
    () => Promise.reject(new Error("regenerate not supported in local mode"))
  );

  invalidateConversationListCaches();
  invalidateConversationCache(conversationId);
  return result;
}

async function fetchMe(options = {}) {
  const user = await loadCached(
    "me",
    CACHE_TTLS.me,
    () => withCloudFallback("/api/me", {}, () => getMe()),
    options
  );
  syncCurrentUser(user);
  return user;
}

async function loginUser(payload = {}) {
  const user = await withCloudFallback(
    "/api/login",
    {
      method: "POST",
      data: payload
    },
    () => login(payload)
  );

  syncCurrentUser(user);
  clearCachedScope("security");
  clearCachedScope("home");
  setCachedValue("me", user, CACHE_TTLS.me);
  return user;
}
async function acceptTrialCard() {
  const result = await withCloudFallback(
    "/api/trial/accept",
    { method: "POST", data: {}, allowFallback: false },
    () => Promise.resolve({ accepted: true, localMock: true })
  );
  clearCachedScope("me");
  return result;
}
async function submitTrialSurvey(answers = {}) {
  const result = await withCloudFallback(
    "/api/trial/survey",
    { method: "POST", data: { answers }, allowFallback: false },
    () => Promise.resolve({ granted: true, localMock: true })
  );
  clearCachedScope("me");
  return result;
}
async function dismissTrialSurvey() {
  const result = await withCloudFallback(
    "/api/trial/survey/dismiss",
    { method: "POST", data: {}, allowFallback: false },
    () => Promise.resolve({ dismissed: true, localMock: true })
  );
  clearCachedScope("me");
  return result;
}
async function createPayOrder(payload = {}) {
  return withCloudFallback(
    "/api/pay/order",
    { method: "POST", data: payload, allowFallback: false },
    () => Promise.resolve({ dryRun: true, localMock: true })
  );
}
async function confirmPay(orderId) {
  const result = await withCloudFallback(
    "/api/pay/confirm",
    { method: "POST", data: { orderId: String(orderId || "") }, allowFallback: false },
    () => Promise.resolve({ ok: false, localMock: true })
  );
  clearCachedScope("me");
  return result;
}

async function patchSettings(payload) {
  const user = await withCloudFallback(
    "/api/me/settings",
    {
      method: "PATCH",
      data: payload
    },
    () => updateSettings(payload)
  );

  syncCurrentUser(user);
  setCachedValue("me", user, CACHE_TTLS.me);
  clearCachedScope("security");
  return user;
}

async function patchProfile(payload = {}) {
  const user = await withCloudFallback(
    "/api/me/profile",
    {
      method: "PATCH",
      data: payload
    },
    () => updateProfile(payload)
  );

  syncCurrentUser(user);
  setCachedValue("me", user, CACHE_TTLS.me);
  clearCachedScope("security");
  clearCachedScope("home");
  return user;
}
async function markLettersReadCloud(ts) {
  const tsNum = Number(ts) || 0;
  if (!tsNum) return null;

  if (!canUseCloud()) return null;

  try {
    const user = await withCloudFallback(
      "/api/me/letters-read",
      {
        method: "POST",
        data: { ts: tsNum },
        allowFallback: false
      },
      () => Promise.resolve(null)
    );

    if (user) {
      syncCurrentUser(user);
      setCachedValue("me", user, CACHE_TTLS.me);
    }
    return user;
  } catch (error) {
    console.warn("markLettersReadCloud failed (silent)", error);
    return null;
  }
}

async function submitOnboarding(payload = {}) {
  const user = await withCloudFallback(
    "/api/onboarding",
    {
      method: "POST",
      data: payload
    },
    () => completeOnboarding(payload)
  );

  syncCurrentUser(user);
  setCachedValue("me", user, CACHE_TTLS.me);
  clearCachedScope("security");
  clearCachedScope("home");
  clearCachedScope("memory");
  return user;
}

async function fetchMemories(options = {}) {
  return loadCached(
    "memory",
    CACHE_TTLS.memory,
    async () => {
      const result = await withCloudFallback(
        "/api/memory",
        { method: "GET" },
        () => listMemoriesLocal()
      );
      return (result && result.items) || [];
    },
    options
  );
}

async function createMemory(payload = {}) {
  const memory = await withCloudFallback(
    "/api/memory",
    { method: "POST", data: payload },
    () => addMemoryLocal(payload)
  );
  markCacheScopeStale("memory");
  return memory;
}

async function patchMemory(memoryId, payload = {}) {
  if (!memoryId) throw new Error("memoryId is required");
  const memory = await withCloudFallback(
    `/api/memory/${encodeURIComponent(memoryId)}`,
    { method: "PATCH", data: payload },
    () => updateMemoryLocal(memoryId, payload)
  );
  markCacheScopeStale("memory");
  return memory;
}

async function removeMemory(memoryId) {
  if (!memoryId) throw new Error("memoryId is required");
  const result = await withCloudFallback(
    `/api/memory/${encodeURIComponent(memoryId)}`,
    { method: "DELETE" },
    () => deleteMemoryLocal(memoryId)
  );
  markCacheScopeStale("memory");
  return result;
}

async function fetchSecurity(options = {}) {
  return loadCached(
    "security",
    CACHE_TTLS.security,
    () => withCloudFallback("/api/me/security", {}, () => getSecurity()),
    options
  );
}

async function bindPhoneNumber(payload = {}) {
  if (!payload.code) {
    throw new Error("Phone authorization code is required");
  }

  if (!canUseCloud()) {
    throw new Error("Cloud function is required to bind a real phone number");
  }

  const user = await withCloudFallback("/api/me/phone", {
    method: "POST",
    data: payload
  });

  syncCurrentUser(user);
  setCachedValue("me", user, CACHE_TTLS.me);
  clearCachedScope("security");
  clearCachedScope("home");
  return user;
}

async function resolveLocationCity(payload = {}) {
  if (!canUseCloud()) {
    throw new Error("Cloud function is required to resolve location");
  }

  const user = await withCloudFallback("/api/me/location/resolve", {
    method: "POST",
    data: payload
  });

  syncCurrentUser(user);
  setCachedValue("me", user, CACHE_TTLS.me);
  clearCachedScope("home");
  return user;
}

async function createFeedback(payload) {
  return withCloudFallback(
    "/api/feedback",
    {
      method: "POST",
      data: payload
    },
    () => submitFeedback(payload)
  );
}

function preloadShellData() {
  return Promise.allSettled([fetchHome(), fetchMe(), fetchConversations()]);
}

function preloadSecondaryData() {
  return Promise.allSettled([fetchSecurity()]);
}

function preloadConversations(options = {}) {
  return fetchConversations({
    limit: DEFAULT_CONVERSATION_PAGE_SIZE,
    ...options
  });
}

function preloadConversation(conversationId) {
  if (!conversationId) {
    return Promise.resolve(null);
  }

  return fetchConversation(conversationId);
}
async function trackEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return { ingested: 0 };
  if (!canUseCloud()) throw new Error("Cloud API unavailable for track events");
  return withCloudFallback("/api/track", {
    method: "POST",
    data: { events }
  });
}

const BOT_ID_STORAGE_KEY = "chatnpc:botId";
let _botIdMemCache = null;
let _prewarmInflightAt = 0;

function setCachedBotId(botId) {
  if (!botId || typeof botId !== "string") return;
  if (_botIdMemCache === botId) return;
  _botIdMemCache = botId;
  try {
    wx.setStorageSync(BOT_ID_STORAGE_KEY, botId);
  } catch (_) {  }
}

function getCachedBotId() {
  if (_botIdMemCache) return _botIdMemCache;
  try {
    const v = wx.getStorageSync(BOT_ID_STORAGE_KEY);
    if (v && typeof v === "string") {
      _botIdMemCache = v;
      return v;
    }
  } catch (_) {  }
  return null;
}

function _getExtendAIInstance() {
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    const cloudbase = app && app.globalData && app.globalData.cloudbase;
    if (cloudbase && cloudbase.extend && cloudbase.extend.AI) {
      return cloudbase.extend.AI;
    }
  } catch (_) {  }
  try {
    if (wx && wx.cloud && wx.cloud.extend && wx.cloud.extend.AI) {
      return wx.cloud.extend.AI;
    }
  } catch (_) {  }
  return null;
}
function prewarmBot() {}

module.exports = {
  patchSettings,
  generateWeeklyNote: () => withCloudFallback("/api/weekly-notes", { method: "POST" }),
  bindPhone: bindPhoneNumber,
  mergeLocalUser,
  createConversation: createConversationEntry,
  createAssistantMessage,
  createUserMessage,
  getConversation: fetchConversation,
  getFeedbackTypes,
  getHome: fetchHome,
  login: loginUser,
  acceptTrialCard,
  submitTrialSurvey,
  dismissTrialSurvey,
  createPayOrder,
  confirmPay,
  getMe: fetchMe,
  getPreferenceOptions,
  getSecurity: fetchSecurity,
  listConversations: fetchConversations,
  peekConversation,
  peekConversations,
  peekHome,
  peekMe,
  peekSecurity,
  peekCompanionStats,
  peekWeeklyNotes,
  peekTodayCheckin,
  peekHighlights,
  peekMemories,
  peekRecentCheckins,
  preloadConversation,
  preloadConversations,
  preloadSecondaryData,
  sendMessage: createMessage,
  prepareStream,
  finalizeStream,
  generateAssistantFromHistory,
  streamGenerate,
  streamPoll,
  regenerateMessage: regenerateAssistantMessage,
  getCompanionStats: fetchCompanionStats,
  getRecentCheckins: fetchRecentCheckins,
  submitFeedback: createFeedback,
  preloadShellData,
  completeOnboarding: submitOnboarding,
  getMemories: fetchMemories,
  createMemory,
  updateMemory: patchMemory,
  deleteMemory: removeMemory,
  getTodayCheckin: fetchTodayCheckin,
  submitCheckin: submitCheckinCloud,
  getHighlights: fetchHighlights,
  createHighlight,
  deleteHighlight: removeHighlight,
  getWeeklyNotes: fetchWeeklyNotes,
  markLettersRead: markLettersReadCloud,
  updateProfile: patchProfile,
  updateSettings: patchSettings,
  resolveLocationCity,
  trackEvents,
  prewarmBot,
  setCachedBotId,
  getCachedBotId
};
