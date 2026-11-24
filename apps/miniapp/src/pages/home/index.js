const { MOOD_FIRST_PERSON } = require("../../utils/mood-checkin");
const api = require("../../services/api");
const track = require("../../utils/track");
const { switchRoot, syncCustomTabBar } = require("../../utils/nav");
const { getNavigationLayout } = require("../../utils/layout");
const { getTimeOfDay } = require("../../utils/time");
const { stripMarkerFromContent } = require("../../utils/chips-marker");
const { copy, COPY, copyByTimeOfDay } = require("../../utils/copy");
const PRESENCE_TEXT_MAX = 80;

const WEEKDAYS = copy("time.weekdays");

function formatPresenceMeta(ts) {
  if (!ts) return copy("home.presence.defaultMeta");
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return copy("home.presence.defaultMeta");
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return copy("time.justNow");
  if (diffMin < 60) return copy("time.minuteAgo", { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    const h = date.getHours();
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${copy("time.today")} ${h}:${m}`;
  }
  if (diffHour < 48) return copy("time.yesterday");
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

const PRESENCE_COPY = COPY.home.presence;

const MOOD_PROMPTS = COPY.mood.prompts;


const COMPANION_SPRITES = {
  awake: "companion-happy.svg",
  writing: "companion-writing.svg",
  asleep: "companion-sleepy.svg"
};

function getLettersLastReadAt() {
  const user = api.peekMe();
  return Math.max(Number(user?.lettersLastReadAt) || 0, Number(wx.getStorageSync("records-letters-last-read-at")) || 0);
}

function computeJournalSubtitle() {
  const cachedWeekly = api.peekWeeklyNotes && api.peekWeeklyNotes();
  const cachedMemories = api.peekMemories && api.peekMemories();
  const cachedCheckins = api.peekRecentCheckins && api.peekRecentCheckins(30);

  const weeklyItems = cachedWeekly && Array.isArray(cachedWeekly.items) ? cachedWeekly.items : null;
  const memoryItems = Array.isArray(cachedMemories)
    ? cachedMemories
    : (cachedMemories && Array.isArray(cachedMemories.items) ? cachedMemories.items : null);
  const checkinItems = cachedCheckins && Array.isArray(cachedCheckins.items) ? cachedCheckins.items : null;

  if ((weeklyItems && weeklyItems.length > 0) ||
      (memoryItems && memoryItems.length > 0) ||
      (checkinItems && checkinItems.length > 0)) {
    return copy("home.journalSubtitle.hasData");
  }

  if (weeklyItems || memoryItems || checkinItems) {
    return copy("home.journalSubtitle.empty");
  }

  return "";
}



const CHECKIN_OPTIONS = COPY.mood.options;

function getAppInstance() {
  try {
    return typeof getApp === "function" ? getApp() : null;
  } catch (error) {
    return null;
  }
}

function wait(ms = 80) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSessionReady(maxAttempts = 40) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const app = getAppInstance();
    if (!app || !app.globalData || app.globalData.sessionReady) {
      return;
    }
    await wait();
  }
}

function syncCurrentUser(user) {
  const app = getAppInstance();
  if (app && app.globalData) {
    app.globalData.currentUser = user || null;
  }
}

function getDateKicker() {
  const now = new Date();
  return `${now.getMonth() + 1}月${now.getDate()}日 · ${WEEKDAYS[now.getDay()]}`;
}

function getGreetingByHour() {
  const h = new Date().getHours();
  if (h < 5) return copy("home.greeting.night");
  if (h < 11) return copy("home.greeting.morning");
  if (h < 14) return copy("home.greeting.noon");
  if (h < 18) return copy("home.greeting.afternoon");
  if (h < 22) return copy("home.greeting.evening");
  return copy("home.greeting.night");
}

function getPresenceByHour() {
  const h = new Date().getHours();
  if (h >= 23 || h < 6) return "asleep";
  if (h >= 19) return "writing";
  return "awake";
}

function getMoodPromptKey() {
  const h = new Date().getHours();
  if (h < 11) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

Page({
  data: {
    copy: COPY,
    statusBarHeight: 20,
    topbarContentHeight: 32,
    topbarSideWidth: 112,
    timeOfDay: getTimeOfDay(),
    dateKicker: "",
    greeting: "",
    aiName: "",
    presence: "awake",
    presenceKicker: "",
    presenceText: "",
    presenceMeta: "",
    moodPromptKicker: "",
    moodPromptText: "",
    companionSpriteFile: COMPANION_SPRITES.awake,
    companionDays: 0,
    needsCheckin: true,
    hasUnread: false,
    weeklyNewCount: 0,
    unreadSubtitle: "",
    journalSubtitle: "",
    composerPlaceholder: copy("home.composerPlaceholder"),
    composerHint: copy("home.composerHint"),
    checkinOptions: CHECKIN_OPTIONS,
    submitting: false,
    debugMode: false,
    heroDaysText: "",
    journalLabel: copy("home.diaryLabel"),
    weeklyNewLabel: "",
    replyButtonLabel: copy("home.replyButton"),
    brandText: copy("home.brand")
  },

  onLoad(options = {}) {
    try {
      const acc = wx.getAccountInfoSync && wx.getAccountInfoSync();
      const env = (acc && acc.miniProgram && acc.miniProgram.envVersion) || "";
      if (env === "develop" && options.debug === "1") {
        this.setData({ debugMode: true });
      }
    } catch (_) { /* 老基础库读不到就不开 debug */ }

    const presence = getPresenceByHour();
    const presenceCopy = PRESENCE_COPY[presence];
    const moodKey = getMoodPromptKey();
    const moodPrompt = MOOD_PROMPTS[moodKey];
    const cachedHome = api.peekHome && api.peekHome();
    const cachedUser = api.peekMe && api.peekMe();
    const cachedStats = api.peekCompanionStats && api.peekCompanionStats();
    const cachedWeekly = api.peekWeeklyNotes && api.peekWeeklyNotes();
    const resume = cachedHome && cachedHome.resumeCard;
    let presenceText = presenceCopy.text;
    let presenceMeta = presenceCopy.meta;
    if (resume) {
      const inlineLast = resume.lastAssistantMessage || resume.lastMessage;
      if (inlineLast) {
        const text = stripMarkerFromContent(String(inlineLast)).trim();
        presenceText = text.length > PRESENCE_TEXT_MAX
          ? text.slice(0, PRESENCE_TEXT_MAX) + "…"
          : text;
        presenceMeta = formatPresenceMeta(resume.lastMessageAt);
      }
      if (resume.conversationId) {
        this._resumeConversationId = resume.conversationId;
      }
    }
    const checkinStreak = Number((cachedHome && cachedHome.checkinStreak) || 0);
    const companionDays = Math.max(
      Number((cachedStats && cachedStats.daysTogether) || 0),
      checkinStreak,
      1
    );
    const aiName = (cachedUser && cachedUser.aiName) || "";
    if (cachedUser) syncCurrentUser(cachedUser);
    let hasUnread = false;
    let weeklyNewCount = 0;
    let unreadSubtitle = "";
    if (cachedWeekly && Array.isArray(cachedWeekly.items)) {
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const lastReadAt = getLettersLastReadAt();
      weeklyNewCount = cachedWeekly.items.filter((it) => {
        const ts = new Date((it && (it.publishAt || it.createdAt || it.updatedAt)) || 0).getTime();
        return ts && (now - ts) < SEVEN_DAYS && ts > lastReadAt;
      }).length;
      hasUnread = weeklyNewCount > 0;
      unreadSubtitle = hasUnread ? `她写来 ${weeklyNewCount} 封新信` : "";
    }
    const todayCheckin = cachedHome && cachedHome.todayCheckin;

    const needsCheckin = !todayCheckin || todayCheckin.source === "inferred";
    const journalSubtitle = computeJournalSubtitle();

    this.setData({
      ...getNavigationLayout(),
      timeOfDay: getTimeOfDay(),
      dateKicker: getDateKicker(),
      greeting: getGreetingByHour(),
      presence,
      presenceKicker: presenceCopy.kicker,
      presenceText,
      presenceMeta,
      moodPromptKicker: moodPrompt.kicker,
      moodPromptText: moodPrompt.text,
      companionSpriteFile: COMPANION_SPRITES[presence] || COMPANION_SPRITES.awake,
      needsCheckin,
      companionDays,
      aiName,
      composerPlaceholder: `跟${aiName || "她"}随便聊聊…`,
      composerHint: aiName && aiName !== "林夕" ? "此刻 TA 在 ›" : "此刻她在 ›",
      hasUnread,
      weeklyNewCount,
      unreadSubtitle,
      journalSubtitle
    });
    if (resume && resume.conversationId) {
      this.loadLatestSay(resume.conversationId, { refresh: true });
    }
  },

  onShow() {
    const timeOfDay = getTimeOfDay();
    if (timeOfDay !== this.data.timeOfDay) {
      this.setData({ timeOfDay });
    }
    this.hydrateHomeSnapshot();
    syncCustomTabBar("home");
    this.loadHome().catch((error) => {
      console.warn("loadHome failed", error);
    });
    api.prewarmBot();
  },

  hydrateHomeSnapshot() {
    const cachedHome = api.peekHome();
    const cachedUser = api.peekMe();
    const cachedStats = api.peekCompanionStats && api.peekCompanionStats();
    const cachedWeekly = api.peekWeeklyNotes && api.peekWeeklyNotes();
    if (cachedHome) this.applyHomePayload(cachedHome, { fromCache: true });
    if (cachedUser) this.applyGuideState(cachedUser);
    if (cachedStats) this.applyCompanionStats(cachedStats);
    if (cachedWeekly) this.applyWeeklyNotes(cachedWeekly);
    if (!cachedHome && !cachedWeekly) {
      this.setData({ journalSubtitle: computeJournalSubtitle() });
    }
  },
  applyCompanionStats(stats) {
    const days = Number(stats && stats.daysTogether);
    if (!days || days < 1) return;
    if (days === this.data.companionDays) return;
    this.setData({ companionDays: days });
  },
  applyWeeklyNotes(payload) {
    const items = (payload && payload.items) || [];
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const lastReadAt = getLettersLastReadAt();
    const weeklyNewCount = items.filter((it) => {
      const ts = new Date((it && (it.publishAt || it.createdAt || it.updatedAt)) || 0).getTime();
      return ts && (now - ts) < SEVEN_DAYS && ts > lastReadAt;
    }).length;

    const hasUnread = weeklyNewCount > 0;
    this.setData({
      hasUnread,
      weeklyNewCount,
      unreadSubtitle: hasUnread ? `她写来 ${weeklyNewCount} 封新信` : "",
      journalSubtitle: computeJournalSubtitle()
    });
  },
  applyGuideState(user) {
    syncCurrentUser(user);
    this.setData({ showOnboarding: Boolean(user && !user.onboardingCompleted) });
    const aiName = (user && user.aiName) || "";

    this.setData({
      aiName,
      composerPlaceholder: `跟${aiName || "她"}随便聊聊…`,
      composerHint: aiName && aiName !== "林夕" ? "此刻 TA 在 ›" : "此刻她在 ›"
    });
  },
  handleDebugPreview() {
    wx.showActionSheet({
      itemList: ["心情打卡 autoSend → chat"],
      success: (res) => {
        if (res.tapIndex !== 0) return;
        wx.showActionSheet({
          itemList: ["开心", "平静", "难过"],
          success: (moodRes) => {
            const moodValue = ["happy", "calm", "sad"][moodRes.tapIndex];
            if (!moodValue) return;
            this.handleMoodPick({ currentTarget: { dataset: { value: moodValue } } });
          },
          fail: () => { /* 用户取消 */ }
        });
      },
      fail: () => { /* 用户取消 */ }
    });
  },

  applyHomePayload(home = {}, options = {}) {
    const todayCheckin = home.todayCheckin || null;
    const checkinStreak = Number(home.checkinStreak) || 0;
    const resumeCard = home.resumeCard || null;
    const checkedInToday = Boolean(todayCheckin && todayCheckin.source !== "inferred");

    this.setData({
      needsCheckin: !checkedInToday,
      companionDays: Math.max(this.data.companionDays || 1, checkinStreak, 1),
      journalSubtitle: computeJournalSubtitle()
    });
    const resumeId = resumeCard && resumeCard.conversationId;
    if (resumeId) {
      this._resumeConversationId = resumeId;
      const inlineLast = resumeCard.lastAssistantMessage || resumeCard.lastMessage;
      if (inlineLast) {
        this.applyLatestSay(inlineLast, resumeCard.lastMessageAt);
      }
      this.loadLatestSay(resumeId, { refresh: !options.fromCache });
    }
  },
  applyLatestSay(rawText, ts) {
    const text = stripMarkerFromContent(String(rawText || "")).trim();
    if (!text) return;
    const truncated = text.length > PRESENCE_TEXT_MAX
      ? text.slice(0, PRESENCE_TEXT_MAX) + "…"
      : text;
    this.setData({
      presenceText: truncated,
      presenceMeta: formatPresenceMeta(ts)
    });
  },

  async loadLatestSay(conversationId, options = {}) {
    try {
      const conv = await api.getConversation(conversationId, options);
      const messages = (conv && conv.messages) || [];
      let lastAssistant = null;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m && m.role === "assistant" && m.content) {
          lastAssistant = m;
          break;
        }
      }
      if (!lastAssistant) return;
      this.applyLatestSay(
        lastAssistant.content,
        lastAssistant.createdAt || lastAssistant.savedAt || lastAssistant.timestamp
      );
    } catch (error) {
      console.warn("loadLatestSay failed", error);
    }
  },

  async loadHome() {
    const loadToken = Date.now();
    this._loadToken = loadToken;
    await waitForSessionReady();
    const [homeResult, userResult, statsResult, weeklyResult] = await Promise.allSettled([
      api.getHome({ refresh: true }),
      api.getMe(),
      api.getCompanionStats(),
      api.getWeeklyNotes()
    ]);
    if (this._loadToken !== loadToken) return;

    if (homeResult.status === "fulfilled") {
      this.applyHomePayload(homeResult.value);
    }

    if (userResult.status === "fulfilled") {
      const user = userResult.value;
      this.applyGuideState(user);
    }

    if (statsResult.status === "fulfilled") {
      this.applyCompanionStats(statsResult.value);
    }

    if (weeklyResult.status === "fulfilled") {
      this.applyWeeklyNotes(weeklyResult.value);
    }
  },

  noop() {},

  handleEnterChat(event) {
    api.prewarmBot();
    track.track("home_portrait_tap", {
      source: (event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.source) || "portrait"
    });
    const resumeId = this._resumeConversationId;
    const url = resumeId
      ? `/pages/chat/index?source=home_desk&conversationId=${resumeId}`
      : "/pages/chat/index?source=home_desk";
    wx.navigateTo({ url });
  },

  async handleMoodPick(event) {
    const value = event.currentTarget.dataset.value;
    const text = Object.prototype.hasOwnProperty.call(MOOD_FIRST_PERSON, value) && MOOD_FIRST_PERSON[value];
    if (!text || this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      await api.submitCheckin({ mood: value });
      this.setData({ needsCheckin: false });
      track.track("mood_checkin_submit", { mood: value, from: "home" });
      wx.navigateTo({ url: `/pages/chat/index?source=home_mood&autoSend=1&initialMessage=${encodeURIComponent(text)}&mood=${encodeURIComponent(value)}` });
    } catch (error) {
      wx.showToast({ title: error.message || "打卡保存失败，请重试", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  handleOpenOnboarding() {
    wx.navigateTo({ url: "/pages/onboarding/index" });
  },

  handleGoRecords() {
    track.track("home_diary_tap");
    switchRoot("/pages/records/index");
  },

  handleGoMe() {
    track.track("home_vase_tap");
    switchRoot("/pages/me/index");
  },
  onShareAppMessage() {
    return {
      title: "「YourHer」— 一个 AI 在陪我的小地方",
      path: "/pages/home/index?from=share_home"
    };
  },

  onShareTimeline() {
    return {
      title: "「YourHer」— 不想一个人的时候，随时来",
      query: "from=share_timeline_home"
    };
  }
});
