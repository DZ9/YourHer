const { copy, COPY, syncGenderedCopy } = require("../../utils/copy");
const api = require("../../services/api");

const LETTERS_LAST_READ_KEY = "records-letters-last-read-at";

const MEMORY_TAG_LABELS = {
  profile: copy("records.memoryTags.aboutYou"),
  preference: copy("records.memoryTags.preference"),
  event: copy("records.memoryTags.recent"),
  relation: copy("records.memoryTags.important")
};

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
  return { ...note, displayRange: formatDateRange(note) };
}

function decorateMemory(memory) {
  if (!memory) return null;
  return { ...memory, tagLabel: MEMORY_TAG_LABELS[memory.type] || copy("records.memoryFallbackTag") };
}
function markLettersReadNow() {
  const now = Date.now();
  try {
    const prev = Number(wx.getStorageSync(LETTERS_LAST_READ_KEY) || 0);
    if (now > prev) wx.setStorageSync(LETTERS_LAST_READ_KEY, now);
  } catch (_) {  }
  if (api.markLettersRead) {
    api.markLettersRead(now).catch((error) => {
      console.warn("push read cursor failed (silent)", error);
    });
  }
}

function getMaxLetterTs(items) {
  if (!Array.isArray(items) || !items.length) return 0;
  let max = 0;
  items.forEach((it) => {
    const ts = new Date((it && (it.publishAt || it.createdAt || it.updatedAt)) || 0).getTime();
    if (ts && ts > max) max = ts;
  });
  return max;
}

function markLettersReadFromItems(items) {
  const max = getMaxLetterTs(items);
  if (!max) return;
  try {
    const prev = Number(wx.getStorageSync(LETTERS_LAST_READ_KEY) || 0);
    if (max > prev) wx.setStorageSync(LETTERS_LAST_READ_KEY, max);
  } catch (_) {  }
  if (api.markLettersRead) {
    api.markLettersRead(max).catch(() => {});
  }
}

Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    kind: { type: String, value: "letters" }, // letters | memory
    timeOfDay: { type: String, value: "day" },
    statusBarHeight: { type: Number, value: 20 },
    topbarContentHeight: { type: Number, value: 32 }
  },

  data: {
    copy: COPY,
    open: false, // 滑入 class 开关
    title: copy("panels.recordsPanel.lettersTitle"),
    kicker: copy("panels.recordsPanel.lettersSub"),
    aiName: COPY.chat.defaultPageTitle,
    featuredLetter: null,
    pastLetters: [],
    memories: [],
    loading: true
  },

  lifetimes: {
    attached() {
      syncGenderedCopy(this);
      this._loadForKind();
      this._kindReady = true;
      this._openTimer = setTimeout(() => this.setData({ open: true }), 20);
    },

    detached() {
      if (this._openTimer) clearTimeout(this._openTimer);
      if (this._closeTimer) clearTimeout(this._closeTimer);
    }
  },

  observers: {
    kind() {
      if (this._kindReady) this._loadForKind();
    }
  },

  methods: {
    async handleGenerateLetter() {
      try { await api.generateWeeklyNote(); this._applyWeekly(await api.getWeeklyNotes({refresh: true})); }
      catch (e) { wx.showToast({title: e.message || "暂时无法写信", icon: "none"}); }
    },
    _loadForKind() {
      const isLetters = this.properties.kind !== "memory";
      this.setData({
        title: isLetters ? copy("panels.recordsPanel.lettersTitle") : copy("panels.recordsPanel.memoryTitle"),
        kicker: isLetters ? copy("panels.recordsPanel.lettersSub") : copy("panels.recordsPanel.memorySub"),
        loading: true,
        featuredLetter: null,
        pastLetters: [],
        memories: []
      });
      this._hydrate();
      this._load();
      if (isLetters) markLettersReadNow();
    },

    _hydrate() {
      const me = api.peekMe && api.peekMe();
      if (me && me.aiName) this.setData({ aiName: me.aiName });

      let hit = false;
      if (this.properties.kind !== "memory") {
        const weekly = api.peekWeeklyNotes && api.peekWeeklyNotes();
        if (weekly) { this._applyWeekly(weekly); hit = true; }
      } else {
        const memories = api.peekMemories && api.peekMemories();
        if (memories) { this._applyMemories(memories); hit = true; }
      }
      if (hit) this.setData({ loading: false });
    },

    async _load() {
      try {
        if (this.properties.kind !== "memory") {
          const weekly = await api.getWeeklyNotes();
          this._applyWeekly(weekly);
        } else {
          const memories = await api.getMemories();
          this._applyMemories(memories);
        }
      } catch (error) {
        console.warn("records-panel load failed", error);
      } finally {
        this.setData({ loading: false });
      }
    },

    _applyWeekly(payload) {
      const items = ((payload && payload.items) || []).map(decorateLetter).filter(Boolean);
      const [featured, ...rest] = items;
      this.setData({ featuredLetter: featured || null, pastLetters: rest, lettersEmptyDesc: copy("records.lettersEmpty.desc"), pastLetterCountText: `${rest.length} ${copy("me.stats.lettersUnit")}` });
      markLettersReadFromItems(items);
    },

    _applyMemories(payload) {
      const list = Array.isArray(payload) ? payload : (payload && payload.items) || [];
      const items = list.map(decorateMemory).filter(Boolean);
      this.setData({ memories: items, memoryEmptyDesc: copy("records.memoryEmpty.desc", { name: this.data.aiName }) });
    },

    handleClose() {
      if (this._closing) return;
      this._closing = true;
      this.setData({ open: false });
      this._closeTimer = setTimeout(() => this.triggerEvent("close"), 260);
    },
    noop() {}
  }
});
