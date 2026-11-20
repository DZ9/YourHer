const { copy, COPY, syncGenderedCopy } = require("../../utils/copy");
const api = require("../../services/api");
const track = require("../../utils/track");
const { todayDateKey, hasCheckinToday, pinTodayCheckin } = require("../../utils/mood-checkin");

const MOOD_COLORS = { happy: "#E0A45C", calm: "#7FA88C", sad: "#7E89B0" };
const CHECKIN_PROMPT = copy("panels.moodPanel.todayPrompt");
const MOOD_LEGEND = [
  { value: "happy", label: COPY.mood.options[0].label, color: MOOD_COLORS.happy },
  { value: "calm", label: COPY.mood.options[1].label, color: MOOD_COLORS.calm },
  { value: "sad", label: COPY.mood.options[2].label, color: MOOD_COLORS.sad }
];
const LEGACY_MOOD_TO_TONE = {
  great: "happy", good: "happy", okay: "calm", down: "sad", rough: "sad",
  happy: "happy", calm: "calm", sad: "sad"
};
const WEEKDAYS = COPY.panels.moodPanel.weekdayHeaders;

function pad(value) {
  return String(value).padStart(2, "0");
}

function buildMonth(checkins) {
  const map = {};
  (checkins || []).forEach((c) => {
    if (c && c.date) {
      const tone = LEGACY_MOOD_TO_TONE[c.mood];
      if (tone) map[c.date] = tone;
    }
  });

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstWeekday = new Date(y, m, 1).getDay();

  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push({ key: "b" + i, blank: true });

  const counts = { happy: 0, calm: 0, sad: 0 };
  let nights = 0;
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`;
    const tone = map[key] || "";
    if (tone) {
      nights += 1;
      counts[tone] += 1;
    }
    cells.push({
      key,
      day: d,
      tone,
      color: tone ? MOOD_COLORS[tone] : "",
      isToday: d === today,
      future: d > today
    });
  }

  let top = "calm";
  let topN = -1;
  Object.keys(counts).forEach((k) => {
    if (counts[k] > topN) { topN = counts[k]; top = k; }
  });
  const topLabel = (MOOD_LEGEND.find((x) => x.value === top) || {}).label || COPY.mood.options[1].label;

  return {
    cells,
    monthLabel: `${m + 1} 月`,
    nights,
    summaryNote: copy("panels.moodPanel.summaryMonth", { count: nights }),
    summarySub: nights > 0 ? `${topLabel}的夜晚最多` : copy("panels.moodPanel.summaryEmpty")
  };
}

Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    timeOfDay: { type: String, value: "day" },
    statusBarHeight: { type: Number, value: 20 },
    topbarContentHeight: { type: Number, value: 32 }
  },

  data: {
    copy: COPY,
    open: false,
    loading: true,
    weekdays: WEEKDAYS,
    legend: MOOD_LEGEND,
    cells: [],
    monthLabel: "",
    summaryNote: "这个月",
    summarySub: "",
    checkinVisible: false,
    checkinPrompt: CHECKIN_PROMPT
  },

  lifetimes: {
    attached() {
      syncGenderedCopy(this);
      this._hydrate();
      this._load();
      this._openTimer = setTimeout(() => this.setData({ open: true }), 20);
    },

    detached() {
      if (this._openTimer) clearTimeout(this._openTimer);
      if (this._closeTimer) clearTimeout(this._closeTimer);
    }
  },

  methods: {
    _apply(checkins) {
      this._checkins = checkins || [];
      const b = buildMonth(this._checkins);
      this.setData({
        cells: b.cells,
        monthLabel: b.monthLabel,
        summaryNote: b.summaryNote,
        summarySub: b.summarySub,
        checkinVisible: !hasCheckinToday({ items: this._checkins })
      });
    },

    _hydrate() {
      const cached = api.peekRecentCheckins && api.peekRecentCheckins(30);
      if (cached) {
        this._apply((cached && cached.items) || []);
        this.setData({ loading: false });
      } else {
        this._apply([]);
      }
    },

    async _load() {
      try {
        const checkins = await api.getRecentCheckins(30);
        this._apply((checkins && checkins.items) || []);
      } catch (error) {
        console.warn("mood-panel load failed", error);
      } finally {
        this.setData({ loading: false });
      }
    },
    handleCheckinPick(event) {
      const value = event.currentTarget.dataset.value;
      if (!value || this._checkinSubmitting) return;
      this._checkinSubmitting = true;
      pinTodayCheckin();
      track.track("mood_checkin_submit", { mood: value, from: "mood_panel" });
      const today = todayDateKey();
      const next = (this._checkins || [])
        .filter((c) => !(c && c.date === today))
        .concat([{ date: today, mood: value }]);
      this._apply(next);
      api.submitCheckin({ mood: value, note: "" }).catch((error) => {
        console.warn("mood-panel checkin save failed (silent)", error);
      });
    },

    handleClose() {
      if (this._closing) return;
      this._closing = true;
      this.setData({ open: false });
      this._closeTimer = setTimeout(() => this.triggerEvent("close"), 260);
    }
  }
});
