const api = require("../../services/api");
const { copy, COPY, syncGenderedCopy, setAiGender, getCopy } = require("../../utils/copy");
const { isNightMode, setNightModeOverride, broadcastTimeOfDayChange } = require("../../utils/time");

const DEFAULT_AI_NAME = COPY.chat.defaultPageTitle;
const MAX_AI_NAME_LEN = 12;
const MAX_NICKNAME_LEN = 20;

const PREFERENCE_LABELS = COPY.me.options.preferenceLabels;
const RELATIONSHIP_LABELS = COPY.me.options.relationshipLabels;
const PREFERENCE_OPTIONS = COPY.me.options.preferences;
const RELATIONSHIP_OPTIONS = COPY.me.options.relationships;

function formatMembershipDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function deriveMembership(u) {
  const user = u || {};
  if (user.subscriptionActive) {
    const until = formatMembershipDate(user.subscriptionExpireAt);
    return { canSubscribe: false, statusText: until ? copy("me.values.membershipValid", { date: until }) : copy("me.values.membershipActive") };
  }
  if (user.billingState === "trial") {
    const remaining = Math.max(0, (Number(user.trialNightsTotal) || 0) - (Number(user.trialNightsUsed) || 0));
    return { canSubscribe: true, statusText: copy("me.values.membershipTrial", { count: remaining }) };
  }
  return { canSubscribe: true, statusText: copy("me.values.membershipInactive") };
}
function getLocationOnce() {
  return new Promise((resolve, reject) => wx.showModal({title: "所在城市", editable: true, placeholderText: "输入城市名称", success: r => r.confirm && r.content ? resolve({city: r.content}) : reject(new Error("已取消")), fail: reject}));
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
    heroDaysText: "",
    open: false,
    loading: true,
    aiName: COPY.chat.defaultPageTitle,
    daysTogether: 1,
    statChat: 0,
    statLetter: 0,
    statCheckin: 0,
    memberText: "",
    canSubscribe: true,
    surveyAvailable: false,
    toneLabel: COPY.me.values.defaultTone,
    relationLabel: COPY.me.values.defaultRelation,
    cityText: copy("me.values.cityUnknown"),
    nicknameText: copy("me.values.nicknameNotSet"),
    nightModeOn: false,
    aiGender: "female",   // 陪伴者性别（关于页可改，设计「随时能换」）
    locatingCity: false,
    version: "",
    editSheet: "",
    aiNameDraft: "",
    nicknameDraft: "",
    preferenceDraft: "",
    relationshipDraft: "",
    saving: false,
    keyboardOffset: 0,
    preferenceOptions: PREFERENCE_OPTIONS,
    relationshipOptions: RELATIONSHIP_OPTIONS
  },

  lifetimes: {
    attached() {
      const _g = syncGenderedCopy(this);
      this.setData({ aiGender: _g });
      this._hydrate();
      this._load();
      this.setData({ nightModeOn: isNightMode() });
      this._kbHandler = (res) => this.setData({ keyboardOffset: (res && res.height) || 0 });
      wx.onKeyboardHeightChange(this._kbHandler);
      this._openTimer = setTimeout(() => this.setData({ open: true }), 20);
    },

    detached() {
      if (this._openTimer) clearTimeout(this._openTimer);
      if (this._closeTimer) clearTimeout(this._closeTimer);
      if (this._kbHandler) wx.offKeyboardHeightChange(this._kbHandler);
    }
  },

  methods: {
    handleAccountData() { wx.navigateTo({url: "/subpackages/security/index"}); },
    _applyUser(user) {
      if (!user) return;
      this._user = user;
      const m = deriveMembership(user);
      this.setData({
        aiName: (user.aiName && String(user.aiName).trim()) || DEFAULT_AI_NAME,
        memberText: m.statusText,
        canSubscribe: m.canSubscribe,
        surveyAvailable: !user.surveyCompletedAt,
        toneLabel: PREFERENCE_LABELS[user.companionPreference] || COPY.me.values.defaultTone,
        relationLabel: RELATIONSHIP_LABELS[user.relationshipMode] || COPY.me.values.defaultRelation,
        cityText: (user.currentCity && String(user.currentCity).trim()) || "还没告诉她",
        nicknameText: (user.nickname && String(user.nickname).trim()) || "没设置",
        version: ((getApp() || {}).globalData || {}).version || ""
      });
    },

    _applyMetrics(stats, weekly, checkins) {
      const s = stats || {};
      this.setData({
        heroDaysText: copy("panels.about.heroDays", { count: s.daysTogether || 1 }),
        daysTogether: s.daysTogether || 1,
        statChat: s.userMessageCount || 0,
        statLetter: ((weekly && weekly.items) || []).length,
        statCheckin: ((checkins && checkins.items) || []).length
      });
    },

    _hydrate() {
      const user = api.peekMe && api.peekMe();
      if (user) this._applyUser(user);
      const stats = api.peekCompanionStats && api.peekCompanionStats();
      const weekly = api.peekWeeklyNotes && api.peekWeeklyNotes();
      const checkins = api.peekRecentCheckins && api.peekRecentCheckins(365);
      if (stats || weekly || checkins) this._applyMetrics(stats, weekly, checkins);
      if (user || stats) this.setData({ loading: false });
    },

    async _load() {
      try {
        const results = await Promise.allSettled([
          api.getMe(),
          api.getCompanionStats(),
          api.getWeeklyNotes(),
          api.getRecentCheckins(365)
        ]);
        const [u, stats, weekly, checkins] = results;
        if (u.status === "fulfilled" && u.value) this._applyUser(u.value);
        this._applyMetrics(
          stats.status === "fulfilled" ? stats.value : null,
          weekly.status === "fulfilled" ? weekly.value : null,
          checkins.status === "fulfilled" ? checkins.value : null
        );
      } catch (error) {
        console.warn("about-panel load failed", error);
      } finally {
        this.setData({ loading: false });
      }
    },

    handleClose() {
      if (this._closing) return;
      this._closing = true;
      this.setData({ open: false });
      this._closeTimer = setTimeout(() => this.triggerEvent("close"), 260);
    },
    handleMembership() {
      this.triggerEvent("membership", { canSubscribe: this.data.canSubscribe });
    },
    handleSurveyEntry() {
      this.triggerEvent("survey");
    },
    handleStatTap(event) {
      this.triggerEvent("gopanel", { panel: event.currentTarget.dataset.panel || "" });
    },
    handleToggleNightMode(event) {
      const wantNight = Boolean(event && event.detail && event.detail.value);
      setNightModeOverride(wantNight ? "night" : "day");
      broadcastTimeOfDayChange();
      this.setData({ nightModeOn: wantNight });
      this.triggerEvent("syncday");
    },
    handleToggleAiGender() {
      const next = this.data.aiGender === "male" ? "female" : "male";
      try { wx.setStorageSync("chatnpc:ai-gender", next); } catch (_) {  }
      setAiGender(next);
      this.setData({ aiGender: next, copy: getCopy(next) });
      if (typeof api.updateAiGender === "function") {
        api.updateAiGender(next).catch(() => {});
      }
      this.triggerEvent("gender", { gender: next });
    },
    handleOpenCity() {
      if (this.data.locatingCity) return;
      this.setData({ locatingCity: true });
      getLocationOnce()
        .then((loc) => api.resolveLocationCity({ city: loc.city }))
        .then((user) => {
          this._applyUser(user);
          wx.showToast({ title: copy("me.city.success", { city: (user && user.currentCity) || "" }), icon: "success" });
        })
        .catch((error) => {
          console.warn("locate city failed", error);
          wx.showToast({ title: copy("me.city.failed"), icon: "none" });
        })
        .then(() => this.setData({ locatingCity: false }));
    },
    handleFeedback() {
      wx.navigateTo({ url: "/subpackages/feedback/index" });
    },
    handleOpenAiName() {
      const cur = (this._user && this._user.aiName) || "";
      this.setData({ editSheet: "aiName", sheetTitle: copy("me.aiName.sheetTitle"), aiNameDraft: cur === DEFAULT_AI_NAME ? "" : cur });
    },
    handleOpenNickname() {
      this.setData({ editSheet: "nickname", sheetTitle: copy("me.labels.nickname"), nicknameDraft: (this._user && this._user.nickname) || "" });
    },
    handleOpenPreference() {
      this.setData({ editSheet: "preference", sheetTitle: copy("me.preference.sheetTitle"), preferenceDraft: (this._user && this._user.companionPreference) || "gentle" });
    },
    handleOpenRelationship() {
      this.setData({ editSheet: "relationship", sheetTitle: copy("me.relationship.sheetTitle"), relationshipDraft: (this._user && this._user.relationshipMode) || "friend" });
    },
    handleCloseSheet() {
      if (this.data.saving) return;
      this.setData({ editSheet: "", keyboardOffset: 0 });
    },
    noop() {},

    handleAiNameInput(event) {
      this.setData({ aiNameDraft: String(event.detail.value || "").slice(0, MAX_AI_NAME_LEN) });
    },
    handleNicknameInput(event) {
      this.setData({ nicknameDraft: String(event.detail.value || "").slice(0, MAX_NICKNAME_LEN) });
    },
    handlePickPreference(event) {
      this.setData({ preferenceDraft: event.currentTarget.dataset.value });
    },
    handlePickRelationship(event) {
      this.setData({ relationshipDraft: event.currentTarget.dataset.value });
    },
    async handleSaveSheet() {
      if (this.data.saving) return;
      const kind = this.data.editSheet;
      let patch = null;
      if (kind === "aiName") {
        const v = String(this.data.aiNameDraft || "").trim();
        if (!v) { wx.showToast({ title: copy("me.aiName.placeholder"), icon: "none" }); return; }
        patch = { aiName: v };
      } else if (kind === "nickname") {
        patch = { nickname: String(this.data.nicknameDraft || "").trim() };
      } else if (kind === "preference") {
        patch = { companionPreference: this.data.preferenceDraft };
      } else if (kind === "relationship") {
        patch = { relationshipMode: this.data.relationshipDraft };
      }
      if (!patch) { this.handleCloseSheet(); return; }

      this.setData({ saving: true });
      try {
        const user = await api.updateProfile(patch);
        this._applyUser(user);
        this.setData({ editSheet: "", keyboardOffset: 0 });
        wx.showToast({ title: copy("me.aiName.success"), icon: "success" });
      } catch (error) {
        console.warn("about-panel save failed", error);
        wx.showToast({ title: copy("me.aiName.failed"), icon: "none" });
      } finally {
        this.setData({ saving: false });
      }
    }
  }
});
