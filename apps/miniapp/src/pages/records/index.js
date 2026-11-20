const api = require("../../services/api");
const { copy, COPY, syncGenderedCopy } = require("../../utils/copy");
const { safeBack } = require("../../utils/nav");
const { getNavigationLayout } = require("../../utils/layout");
const { getTimeOfDay } = require("../../utils/time");
const LETTERS_LAST_READ_KEY = "records-letters-last-read-at";

function getMaxLetterTs(items) {
  if (!Array.isArray(items) || !items.length) return 0;
  let max = 0;
  items.forEach((it) => {
    const ts = new Date((it && (it.publishAt || it.createdAt || it.updatedAt)) || 0).getTime();
    if (ts && ts > max) max = ts;
  });
  return max;
}
function pushReadCursorToCloud(ts) {
  if (!ts) return;
  if (!api.markLettersRead) return;
  api.markLettersRead(ts).catch((error) => {
    console.warn("push read cursor failed (silent)", error);
  });
}

function markLettersRead(items) {
  const max = getMaxLetterTs(items);
  if (!max) return;
  try {
    const prev = Number(wx.getStorageSync(LETTERS_LAST_READ_KEY) || 0);
    if (max > prev) {
      wx.setStorageSync(LETTERS_LAST_READ_KEY, max);
    }
  } catch (_) {  }
  pushReadCursorToCloud(max);
}
function markLettersReadNow() {
  const now = Date.now();
  try {
    const prev = Number(wx.getStorageSync(LETTERS_LAST_READ_KEY) || 0);
    if (now > prev) {
      wx.setStorageSync(LETTERS_LAST_READ_KEY, now);
    }
  } catch (_) {  }
  pushReadCursorToCloud(now);
}

const TABS = [
  { value: "letters", label: "她的信" },
  { value: "memory", label: "她记得" }
];

function tabValueToIndex(value) {
  const i = TABS.findIndex((t) => t.value === value);
  return i < 0 ? 0 : i;
}

const MOOD_LEGEND = [
  { value: "happy", label: "开心" },
  { value: "calm", label: "平静" },
  { value: "sad", label: "难过" }
];

const VALID_MOOD_TONES = new Set(MOOD_LEGEND.map((m) => m.value));
const LEGACY_MOOD_TO_TONE = {
  great: "happy",
  good: "happy",
  okay: "calm",
  down: "sad",
  rough: "sad",
  happy: "happy",
  calm: "calm",
  sad: "sad"
};

const MEMORY_TAG_LABELS = {
  profile: "关于你",
  preference: "偏好",
  event: "近期",
  relation: "重要的人/宠物"
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildMoodCalendar(checkins = []) {
  const map = {};
  checkins.forEach((c) => {
    if (c && c.date) map[c.date] = c.mood;
  });

  const result = [];
  const today = new Date();
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = formatDateKey(d);
    const mood = map[key];
    const tone = LEGACY_MOOD_TO_TONE[mood];
    result.push({
      date: key,
      tone: tone && VALID_MOOD_TONES.has(tone) ? tone : "empty"
    });
  }

  return result;
}

function formatDateRange(letter) {
  if (!letter) return "";
  if (letter.displayRange) return letter.displayRange;
  const start = letter.weekStart ? new Date(letter.weekStart) : null;
  const end = letter.weekEnd ? new Date(letter.weekEnd) : null;
  if (!start || Number.isNaN(start.getTime())) return "";
  if (!end || Number.isNaN(end.getTime())) {
    return `${start.getMonth() + 1}月${start.getDate()}日`;
  }
  return `${start.getMonth() + 1}月${start.getDate()}日 — ${end.getMonth() + 1}月${end.getDate()}日`;
}

function decorateLetter(note) {
  if (!note) return null;
  return {
    ...note,
    displayRange: formatDateRange(note)
  };
}

function decorateHighlight(highlight) {
  if (!highlight) return null;
  const time = new Date(highlight.savedAt || highlight.createdAt || Date.now());
  const display = Number.isNaN(time.getTime())
    ? ""
    : `${time.getMonth() + 1}月${time.getDate()}日`;
  return {
    ...highlight,
    displayTime: display
  };
}

function decorateMemory(memory) {
  if (!memory) return null;
  return {
    ...memory,
    tagLabel: MEMORY_TAG_LABELS[memory.type] || copy("records.memoryFallbackTag")
  };
}

Page({
  data: {
    statusBarHeight: 20,
    topbarContentHeight: 32,
    topbarSideWidth: 112,
    timeOfDay: getTimeOfDay(),
    aiName: COPY.chat.defaultPageTitle,
    currentMonth: new Date().getMonth() + 1,
    tabs: TABS,
    activeTab: "letters",
    activeTabIndex: 0,
    moodLegend: MOOD_LEGEND,
    moodCalendar: [],
    featuredLetter: null,
    pastLetters: [],
    highlights: [],
    memories: [],
    loading: false
  },

  onLoad(options) {
    this.setData({
      ...getNavigationLayout(),
      timeOfDay: getTimeOfDay()
    });
    const tab = options && options.tab;
    if (tab && TABS.some((t) => t.value === tab)) {
      this.setData({ activeTab: tab, activeTabIndex: tabValueToIndex(tab) });
    }
    this.hydrateFromCache();
  },

  onShow() {
    syncGenderedCopy(this);
    const timeOfDay = getTimeOfDay();
    if (timeOfDay !== this.data.timeOfDay) {
      this.setData({ timeOfDay });
    }
    markLettersReadNow();
    this.hydrateFromCache();
    this.loadEverything().catch((error) => {
      console.warn("loadEverything failed", error);
    });
  },
  hydrateFromCache() {
    const me = api.peekMe && api.peekMe();
    const weekly = api.peekWeeklyNotes && api.peekWeeklyNotes();
    const highlights = api.peekHighlights && api.peekHighlights();
    const memories = api.peekMemories && api.peekMemories();
    const checkins = api.peekRecentCheckins && api.peekRecentCheckins(30);

    if (me) this.applyMe(me);
    if (weekly) this.applyWeekly(weekly);
    if (highlights) this.applyHighlights(highlights);
    if (memories) this.applyMemories(memories);
    if (checkins) this.applyCheckins(checkins);

    if (me || weekly || highlights || memories || checkins) {
      this.setData({ loading: false });
    }
  },

  applyMe(me) {
    if (me && me.aiName) this.setData({ aiName: me.aiName, introText: copy("records.intro", { name: me.aiName }) });
  },

  applyWeekly(payload) {
    const items = ((payload && payload.items) || []).map(decorateLetter).filter(Boolean);
    const [featured, ...rest] = items;
    this.setData({
      featuredLetter: featured || null,
      pastLetters: rest,
      pastLetterCountText: `${rest.length} ${copy("me.stats.lettersUnit")}`,
      moodTitleText: copy("records.moodTitle", { month: this.data.currentMonth })
    });
    markLettersRead(items);
  },

  applyHighlights(payload) {
    const items = ((payload && payload.items) || []).map(decorateHighlight).filter(Boolean);
    this.setData({ highlights: items });
  },

  applyMemories(payload) {
    const list = Array.isArray(payload) ? payload : (payload && payload.items) || [];
    const items = list.map(decorateMemory).filter(Boolean);
    this.setData({ memories: items, memoryEmptyDesc: copy("records.memoryEmpty.desc", { name: this.data.aiName }) });
  },

  applyCheckins(payload) {
    const items = (payload && payload.items) || [];
    this.setData({ moodCalendar: buildMoodCalendar(items) });
  },

  async loadEverything() {
    if (this.loadingAll) return;
    this.loadingAll = true;

    try {
      const [meResult, weeklyResult, highlightsResult, memoriesResult, checkinsResult] = await Promise.allSettled([
        api.getMe(),
        api.getWeeklyNotes(),
        api.getHighlights(),
        api.getMemories(),
        api.getRecentCheckins(30)
      ]);

      if (meResult.status === "fulfilled" && meResult.value) {
        this.applyMe(meResult.value);
      }
      if (weeklyResult.status === "fulfilled") {
        this.applyWeekly(weeklyResult.value);
      }
      if (highlightsResult.status === "fulfilled") {
        this.applyHighlights(highlightsResult.value);
      }
      if (memoriesResult.status === "fulfilled") {
        this.applyMemories(memoriesResult.value);
      }
      if (checkinsResult.status === "fulfilled") {
        this.applyCheckins(checkinsResult.value);
      }
    } finally {
      this.loadingAll = false;
      this.setData({ loading: false });
    }
  },

  handleTabChange(event) {
    const { value } = event.currentTarget.dataset;
    if (!value || value === this.data.activeTab) return;
    this.setData({ activeTab: value, activeTabIndex: tabValueToIndex(value) });
  },
  handleSwiperChange(event) {
    const { current, source } = event.detail || {};
    if (source !== "touch" && source !== "autoplay") return;
    const next = TABS[current];
    if (!next || next.value === this.data.activeTab) return;
    this.setData({ activeTab: next.value, activeTabIndex: current });
  },

  handleBack() {
    safeBack("/pages/chat/index");
  },

  async handleDeleteHighlight(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) return;
    try {
      await api.deleteHighlight(id);
      this.setData({
        highlights: this.data.highlights.filter((h) => h.id !== id)
      });
      wx.showToast({ title: copy("records.forgot"), icon: "none" });
    } catch (error) {
      console.warn("delete highlight failed", error);
      wx.showToast({ title: copy("records.deleteFailed"), icon: "none" });
    }
  },
  onShareAppMessage() {
    return {
      title: copy("records.shareTitle"),
      path: "/pages/chat/index?from=share_records"
    };
  },

  onShareTimeline() {
    return {
      title: copy("records.shareTitle"),
      query: "from=share_timeline_records"
    };
  }
});
