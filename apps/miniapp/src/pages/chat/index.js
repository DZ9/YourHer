const api = require("../../services/api");
const track = require("../../utils/track");
const { switchRoot } = require("../../utils/nav");
const { getNavigationLayout } = require("../../utils/layout");
const { getTimeOfDay, getWhisperByState, isDeepNight } = require("../../utils/time");
const pendingFinalize = require("../../utils/pending-finalize");
const { copy, copyByTimeOfDay, COPY, setAiGender, getCopy } = require("../../utils/copy");
const AI_GENDER_KEY = "chatnpc:ai-gender";
const PORTRAIT_BY_GENDER = {
  female: "/assets/images/companion-portrait-female.jpg",
  male: "/assets/images/companion-portrait.jpg"
};
const {
  MARKER_VARIANTS,
  MARKER_DETECT_REGEX,
  MARKER_CLEAN_REGEX,
  processAssistantForUI,
  sanitizeCandidates,
  parseCandidatesFromMarker
} = require("../../utils/chat-candidates");
const { FIRST_MEETING_CHIPS, computeA5State, buildA5Presentation, decideA5Suppressed, evaluateA5Trigger } = require("../../utils/chat-a5");
const debugFns = require("../../utils/chat-debug");
const voiceFns = require("../../utils/chat-voice");
const streamEngine = require("../../utils/chat-stream-engine");
const {
  CHECKIN_OPTIONS,
  MOOD_PROMPTS,
  MOOD_FIRST_PERSON,
  getMoodPromptKey,
  pinTodayCheckin,
  isPinnedForToday,
  hasCheckinToday
} = require("../../utils/mood-checkin");
const {
  appendTraceIdHint,
  getStreamingFailureText,
  getVisibleMessages,
  getMessageDate,
  decorateChatMessages,
  getAssistantMessagesFromResult,
  looksLikeMarkerPartial
} = require("../../utils/chat-message-helpers");
const STREAM_FALLBACK_CHUNK_THRESHOLD = 10;
const TOPNAV_HINT_SEEN_KEY = "topnav_hint_seen";
const TOPNAV_LETTERS_LAST_READ_KEY = "records-letters-last-read-at";
function computeNavUnread() {
  try {
    const cachedWeekly = api.peekWeeklyNotes && api.peekWeeklyNotes();
    if (!cachedWeekly || !Array.isArray(cachedWeekly.items)) return false;
    let lastReadAt = Number(wx.getStorageSync(TOPNAV_LETTERS_LAST_READ_KEY) || 0);
    const cachedMe = api.peekMe && api.peekMe();
    const remote = Number(cachedMe && cachedMe.lettersLastReadAt) || 0;
    if (remote > lastReadAt) lastReadAt = remote;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return cachedWeekly.items.some((it) => {
      const ts = new Date((it && (it.publishAt || it.createdAt || it.updatedAt)) || 0).getTime();
      return ts && now - ts < SEVEN_DAYS && ts > lastReadAt;
    });
  } catch (error) {
    return false;
  }
}
function markLettersReadNow() {
  const now = Date.now();
  try {
    const prev = Number(wx.getStorageSync(TOPNAV_LETTERS_LAST_READ_KEY) || 0);
    if (now > prev) wx.setStorageSync(TOPNAV_LETTERS_LAST_READ_KEY, now);
  } catch (_) {  }
  if (api.markLettersRead) api.markLettersRead(now).catch(() => {});
}
const FALLBACK_RECENT_ASSISTANT_WINDOW_MS = 30 * 1000;
const PENDING_WRITE_THROTTLE_MS = 500;
const INITIAL_RENDER_LIMIT = 20;
const LOAD_OLDER_BATCH_SIZE = 20;
const PREFETCH_BATCH_SIZE = 30;
const PREFETCH_INTERVAL_MS = 80;
const INITIAL_TIME_OF_DAY = getTimeOfDay();
const STREAMING_ERROR_TEXT = copy("chat.streamingErrorText");

const VALID_INITIAL_MOODS = ["happy", "calm", "sad"];
const AUTO_RENEW_CONFIRMED = false;
function getFirstTouchOpener() {
  return copyByTimeOfDay("chat.firstTouchOpener", isDeepNight() ? "night" : "default");
}

const PORTRAIT_TRIG_KEYS = new Set([
  "sending",
  "inputValue",
  "_inputFocused",
  "_portraitTapped",
  "_streamHasContent",
  "timeOfDay",
  "voiceRecording"
]);

function derivePortraitState(d) {
  if (d._portraitTapped) return "tapped";
  if (d.sending) return d._streamHasContent ? "speaking" : "thinking";
  if (d.voiceRecording) return "listening";
  if (d._inputFocused || (d.inputValue && d.inputValue.length > 0)) return "listening";
  return "idle";
}

function getErrorMessage(error) {
  return String((error && (error.errMsg || error.message)) || error || "");
}

function getLatestAnchor(messages = []) {
  return messages.length ? `message-${messages[messages.length - 1].id}` : "";
}

const WEEKDAYS = copy("time.weekdays");

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

Page({
  data: {
    copy: COPY,
    statusBarHeight: 20,
    topbarContentHeight: 32,
    topbarSideWidth: 112,
    navUnread: false,
    navHintVisible: false,
    activePanel: "",
    moodCheckinVisible: false,
    moodPromptKicker: "",
    moodPromptText: "",
    checkinOptions: CHECKIN_OPTIONS,
    pageTitle: copy("chat.defaultPageTitle"),
    pageTitleLabel: copy("chat.title", { name: copy("chat.defaultPageTitle") }),
    aiMood: "quiet",
    aiAvatarSrc: "/assets/desk/companion-face.svg",
    loadingTitle: copy("chat.loading.title"),
    loadingDesc: copy("chat.loading.desc"),
    inputPlaceholder: copy("chat.inputPlaceholder"),
    conversationId: "",
    messages: [],
    hiddenMessageCount: 0,
    messageRenderLimit: INITIAL_RENDER_LIMIT,
    inputValue: "",
    loading: true,
    sending: false,
    memoryBanner: null,
    nameBanner: null,
    timeOfDay: INITIAL_TIME_OF_DAY,
    portraitState: "idle",
    portraitVariant: "女",
    portraitSrc: "/assets/images/companion-portrait-female.jpg",
    aiGender: "female",          // 'female' | 'male'，默认女（skip 也落女）
    genderSheetVisible: false,   // 首触性别选择浮层
    genderPick: "",              // 浮层内确认前的选中（'female'|'male'）
    genderConfirmText: COPY.chat.genderSelect.confirmIdle,  // 确认键文案（选后→「就她/他了」）
    portraitWhisper: getWhisperByState("idle", INITIAL_TIME_OF_DAY),
    collapsedAvatarOpacity: 0,     // \u7acb\u7ed8\u88ab\u63a8\u5230\u53ea\u5269\u5934\u90e8\u65f6 mini \u5934\u50cf\u6e10\u5165
    topbarBgVisible: false,        // \u6eda\u5230 60rpx \u540e\u9876\u680f\u76d6\u4e00\u5c42\u80cc\u666f
    showHistoryHint: false,        // \u8fdb\u5165\u9875\u9762\u65f6\u4e0d\u663e\u793a"\u8fd8\u6709 X \u6761\u66f4\u65e9\u7684\u8bdd"\uff0c\u7b49\u7528\u6237\u4e3b\u52a8\u6ed1\u8fc7\u624d\u51fa
    loadingMore: false,            // \u6b63\u5728\u81ea\u52a8\u52a0\u8f7d\u66f4\u65e9\u6d88\u606f\u4e2d\uff08hint \u6587\u6848\u5207\u5230"\u6b63\u5728\u62c9\u66f4\u65e9\u7684\u8bdd\u2026"\uff09
    starSeeds: [],
    _inputFocused: false,
    _portraitTapped: false,
    _streamHasContent: false,
    voiceRecording: false,        // \u662f\u5426\u6b63\u5904\u4e8e\u957f\u6309\u5f55\u97f3\u4e2d\uff08\u63a7\u5236\u8499\u5c42 + \u8f93\u5165\u6846 disabled\uff09
    voicePartial: "",             // \u5b9e\u65f6 STT \u4e2d\u95f4\u7ed3\u679c\uff0c\u6d6e\u5c42\u91cc\u9010\u5b57\u663e\u793a
    voiceCancelArmed: false,      // \u624b\u6307\u5df2\u4e0a\u6ed1\u5230\u53d6\u6d88\u533a\uff0c\u677e\u624b\u5c06\u4e22\u5f03\u8fd9\u6b21\u5f55\u97f3
    keyboardHeight: 0,            // iOS \u4e0a chat-compose \u662f fixed\uff0c\u952e\u76d8\u5f39\u8d77\u65f6 input \u81ea\u5e26 adjust-position \u9876\u4e0d\u52a8\u5bb9\u5668\uff0c\u81ea\u5df1\u76d1\u542c\u5f80\u4e0a\u63a8
    firstMeetingChips: FIRST_MEETING_CHIPS,
    chipMessageId: "",
    demoMode: false,
    firstTouch: false,
    firstTouchOpener: "",
    _consentTracked: false,
    consentChecked: false,
    trialCardVisible: false,      // S0 赠卡弹窗（trialPhase>0 && 未收下，本会话只弹一次）
    trialRemaining: 0,            // 剩余免费夜
    trialDots: [],                // 试用位点阵（min(剩余,7) 个）
    billingState: "",             // legacy/trial/survey_invite/paywall/subscribed（referral_invite 漏斗环已下线）
    trialBadgeExpanded: false,    // 试用位点开小卡
    surveyVisible: false,         // 体验问卷浮层（survey_invite 态，可跳过）
    surveySubmitting: false,
    surveyQ1: "",                 // 她接住你了吗
    surveyQ2: "",                 // 最想她变成什么样（短文本）
    surveyQ3: "",                 // 愿意把她介绍给也需要的人吗（推荐意愿，纯调研）
    paywallVisible: false,
    paywallProactive: false,
    surveyDone: false,            // 已填过问卷（付费墙回填入口 wx:if 用）
    debugFunnelLabel: "",         // dev 漏斗步进器当前步标签（_debugFunnelAdvance 写）
    a5Tier: "",              // '' | 'chips' | 'opener'
    a5Chips: [],
    a5OpenerText: "",
    a5OpenerFooter: "",
    debugMode: false,
    a5DebugSuppress: false,
  },

  onLoad(options) {
    this.entryOptions = options || {};

    this._isUnmounted = false;
    this._resolveGenderOnLoad();
    this._pendingOpenPaywall = Boolean(options && options.openPaywall === "1");
    try {
      const acc = wx.getAccountInfoSync && wx.getAccountInfoSync();
      const env = (acc && acc.miniProgram && acc.miniProgram.envVersion) || "";
      if (env === "develop" && options?.debug === "1") {
        this.setData({ debugMode: true });
      }
    } catch (_) {  }

    track.track("chat_open", {
      source: String((options && options.source) || "direct").slice(0, 32),
      autoSend: Boolean(options && options.autoSend)
    });
    const _origSetData = this.setData.bind(this);
    this._origSetData = (data, cb) => {
      if (this._isUnmounted) return;
      _origSetData(data, cb);
    };
    this.setData = (data, cb) => {
      if (this._isUnmounted) return;
      if (data && data.sending === true && data._streamHasContent !== false) {
        data = Object.assign({}, data, { _streamHasContent: false });
      }
      _origSetData(data, () => {
        if (this._isUnmounted) return;
        if (data && Object.keys(data).some((k) => PORTRAIT_TRIG_KEYS.has(k))) {
          this._refreshPortraitState();
        }
        if (typeof cb === "function") cb();
      });
    };

    const timeOfDay = getTimeOfDay();
    this._origSetData({
      ...getNavigationLayout(),
      timeOfDay,
      portraitWhisper: getWhisperByState("idle", timeOfDay),
      starSeeds: timeOfDay === "night" ? this._buildStarSeeds() : []
    });

    this._scheduleNextTodCheck();
    const cachedMe = api.peekMe && api.peekMe();
    if (cachedMe) {
      if (cachedMe.aiName) {
        this.setData({
          pageTitle: cachedMe.aiName,
          pageTitleLabel: copy("chat.title", { name: cachedMe.aiName }),
          inputPlaceholder: copy("chat.inputPlaceholderWithName", { name: cachedMe.aiName })
        });
      }
      if (cachedMe.aiMoodSnapshot) this.applyAiMood(cachedMe.aiMoodSnapshot);
      this._syncTrialState(cachedMe);
    }
    api.getMe().then((me) => {
      if (me && me.aiName) {
        this.setData({
          pageTitle: me.aiName,
          pageTitleLabel: copy("chat.title", { name: me.aiName }),
          inputPlaceholder: copy("chat.inputPlaceholderWithName", { name: me.aiName })
        });
      }
      if (me && me.aiMoodSnapshot) this.applyAiMood(me.aiMoodSnapshot);
      this._syncTrialState(me);
      if (!this._debugNewUserMode) {
        this.setData({ demoMode: me && me.modelMode === "demo", firstTouch: !me?.privacyConsentAt });
      }
      if (me && (me.aiGender === "female" || me.aiGender === "male")) {
        this._genderResolved = true;
        this._applyAiGender(me.aiGender);
      }
      this._maybeShowGenderSheet();
      if (this._pendingOpenPaywall) {
        this._pendingOpenPaywall = false;
        if (!(me && me.subscriptionActive)) this._openPaywallProactive();
      }
    }).catch(() => {});

    this.bootstrap(this.entryOptions).catch((error) => {
      console.warn("bootstrap chat failed", error);
      this.setData({ loading: false });
      wx.showToast({ title: copy("chat.initFailed"), icon: "none" });
    });
    if (typeof wx.onKeyboardHeightChange === "function") {
      this._keyboardHandler = (res) => {
        if (this._isUnmounted) return;
        const height = (res && res.height) || 0;
        if (height === this.data.keyboardHeight) return;
        this.setData({ keyboardHeight: height });
      };
      wx.onKeyboardHeightChange(this._keyboardHandler);
    }
  },

  onShow() {
    const timeOfDay = getTimeOfDay();
    if (timeOfDay !== this.data.timeOfDay) {
      this.setData({
        timeOfDay,
        starSeeds: timeOfDay === "night" ? this._buildStarSeeds() : []
      });
    }
    this._syncTopNav();
    this._maybeShowMoodCheckin();
  },

  onUnload() {
    if (this.data.a5Tier) {
      track.track("chat_a5_dismiss", { reason: "page_left" });
    }
    this._isUnmounted = true;
    this._currentPlaybackId = null;
    if (this.memoryBannerTimer) {
      clearTimeout(this.memoryBannerTimer);
      this.memoryBannerTimer = null;
    }
    if (this.nameBannerTimer) {
      clearTimeout(this.nameBannerTimer);
      this.nameBannerTimer = null;
    }
    if (this._todTimer) {
      clearTimeout(this._todTimer);
      this._todTimer = null;
    }
    if (this._tappedTimer) {
      clearTimeout(this._tappedTimer);
      this._tappedTimer = null;
    }
    if (this._prefetchTimer) {
      clearTimeout(this._prefetchTimer);
      this._prefetchTimer = null;
    }
    voiceFns.cleanupOnUnload(this);
    this._voicePressActive = false;

    if (this._keyboardHandler && typeof wx.offKeyboardHeightChange === "function") {
      wx.offKeyboardHeightChange(this._keyboardHandler);
      this._keyboardHandler = null;
    }
  },

  _refreshPortraitState() {
    const next = derivePortraitState(this.data);
    if (next === this.data.portraitState) return;
    this._origSetData({
      portraitState: next,
      portraitWhisper: getWhisperByState(next, this.data.timeOfDay)
    });
  },

  _scheduleNextTodCheck() {
    if (this._todTimer) clearTimeout(this._todTimer);
    this._todTimer = setTimeout(() => {
      const next = getTimeOfDay();
      if (next !== this.data.timeOfDay) {
        this.setData({
          timeOfDay: next,
          starSeeds: next === "night" ? this._buildStarSeeds() : []
        });
      }
      this._scheduleNextTodCheck();
    }, 5 * 60 * 1000);
  },

  _buildStarSeeds() {
    return Array.from({ length: 18 }, (_, i) => ({
      id: i,
      x: Math.round(Math.random() * 100),
      y: Math.round(Math.random() * 60),
      r: Math.round((Math.random() * 0.8 + 0.4) * 10) / 10,
      delay: Math.round(Math.random() * 30) / 10,
      dur: Math.round((Math.random() * 2 + 2.5) * 10) / 10
    }));
  },

  handleScroll(event) {
    const scrollTop = (event && event.detail && event.detail.scrollTop) || 0;
    const last = this._lastScrollY || 0;
    if (Math.abs(scrollTop - last) < 4) return;
    this._lastScrollY = scrollTop;
    const collapsedOpacity = Math.min(1, Math.max(0, (scrollTop - 80) / 240));
    const topbarBgVisible = scrollTop > 60;

    this._origSetData({
      collapsedAvatarOpacity: Math.round(collapsedOpacity * 100) / 100,
      topbarBgVisible
    });
  },
  handleScrollToOlder() {
    if (this._isUnmounted) return;
    if (this._loadingMore) return;
    if (!this.data.hiddenMessageCount) return;  // 没有更早就 no-op
    this._loadingMore = true;
    this.handleShowEarlierMessages();
    this._loadingMore = false;
  },

  handleInputFocus() {
    this.setData({ _inputFocused: true });
  },

  handleInputBlur() {
    this.setData({ _inputFocused: false });
  },

  handlePortraitTap() {
    if (this._tappedTimer) clearTimeout(this._tappedTimer);
    this.setData({ _portraitTapped: true });
    this._tappedTimer = setTimeout(() => {
      this.setData({ _portraitTapped: false });
      this._tappedTimer = null;
    }, 720);
  },
  _applyAiGender(gender) {
    const g = gender === "male" ? "male" : "female";
    setAiGender(g);
    this.setData({
      aiGender: g,
      portraitVariant: g === "male" ? "男" : "女",
      portraitSrc: PORTRAIT_BY_GENDER[g],
      copy: getCopy(g)
    });
  },
  _resolveGenderOnLoad() {
    let stored = "";
    try { stored = wx.getStorageSync(AI_GENDER_KEY) || ""; } catch (_) {  }
    if (stored === "female" || stored === "male") {
      this._genderResolved = true;
      this._applyAiGender(stored);
    } else {
      this._genderResolved = false;
      this._applyAiGender("female");
    }
  },
  _maybeShowGenderSheet() {
    if (this._isUnmounted) return;
    if (this._genderResolved) return;
    if (this.data.genderSheetVisible) return;
    if (!this.data.firstTouch) return;
    if (this.data.messages.length || this.data.conversationId) return;
    this.setData({ genderSheetVisible: true });
  },

  handleGenderPick(e) {
    const v = e.currentTarget.dataset.value;
    if (v !== "female" && v !== "male") return;
    const pron = COPY.chat.genderSelect[v].pron;
    this.setData({
      genderPick: v,
      genderConfirmText: copy("chat.genderSelect.confirmReady", { pron })
    });
  },

  handleGenderConfirm() {
    const g = this.data.genderPick || "female";
    track.track("firstrun_gender_select", { gender: g, action: "confirm" });
    this._commitGender(g);
  },

  handleGenderSkip() {
    track.track("firstrun_gender_select", { gender: "female", action: "skip" });
    this._commitGender("female");
  },

  _commitGender(gender) {
    const g = gender === "male" ? "male" : "female";
    this._genderResolved = true;
    try { wx.setStorageSync(AI_GENDER_KEY, g); } catch (_) {  }
    this._applyAiGender(g);
    this.setData({ genderSheetVisible: false, genderPick: "" });
    if (typeof api.updateAiGender === "function") {
      api.updateAiGender(g).catch(() => {});
    }
  },
  handleAboutGender(e) {
    const g = e && e.detail && e.detail.gender;
    if (g === "female" || g === "male") this._applyAiGender(g);
  },
  _debugTogglePortrait() { return debugFns.debugTogglePortrait(this); },

  async bootstrap(options) {
    const moodArg = options && options.mood ? decodeURIComponent(options.mood) : "";
    this._pendingInitialMood = VALID_INITIAL_MOODS.includes(moodArg) ? moodArg : "";
    if (this._pendingInitialMood) {
      track.track("chat_initial_mood_present", { mood: this._pendingInitialMood });
    }
    const _cachedMe = api.peekMe && api.peekMe();
    const _isReturningUser = Boolean(_cachedMe?.privacyConsentAt);
    this.setData({ firstTouch: !_isReturningUser, firstTouchOpener: getFirstTouchOpener() });
    this._maybeShowGenderSheet();
    this._a5Suppressed = decideA5Suppressed({ autoSend: options && options.autoSend });

    let conversationId = options.conversationId || "";
    if (!conversationId) {
      const cachedHome = api.peekHome();
      const resume = cachedHome && cachedHome.resumeCard;
      if (resume && resume.conversationId) {
        conversationId = resume.conversationId;
      }
    }
    if (!conversationId) {
      const peekedList = api.peekConversations && api.peekConversations({ limit: 1 });
      const peekedLatest = (peekedList && peekedList.items && peekedList.items[0]) || null;
      if (peekedLatest && (peekedLatest.id || peekedLatest._id)) {
        conversationId = peekedLatest.id || peekedLatest._id;
        console.log("[chat-load] resolved conversationId from peek=", conversationId);
      } else {
        try {
          const list = await api.listConversations({ limit: 1 });
          const latest = (list && list.items && list.items[0]) || null;
          console.log(
            "[chat-load] listConversations top1 \u2192",
            latest ? { id: latest.id || latest._id, lastMessageAt: latest.lastMessageAt, title: latest.title } : "(empty)"
          );
          if (latest && (latest.id || latest._id)) {
            conversationId = latest.id || latest._id;
          }
        } catch (error) {
          console.warn("resolve eternal conversation failed", error);
        }
      }
    }

    console.log("[chat-load] resolved conversationId=", conversationId, "(source=", options && options.conversationId ? "query" : "listOrCache", ")");
    this.setData({ conversationId });
    this.hydrateConversationSnapshot(conversationId);

    const hasAutoSend = options.autoSend === "1" && options.initialMessage;

    let loadPromise = null;
    if (conversationId) {
      loadPromise = this.loadConversation(conversationId, { deferRecovery: Boolean(hasAutoSend) }).catch((error) => {
        console.warn("loadConversation failed", error);
        wx.showToast({
          title: "\u5bf9\u8bdd\u52a0\u8f7d\u5931\u8d25",
          icon: "none"
        });
      });
    } else {
      this.setData({ loading: false });
    }
    if (hasAutoSend) {
      if (loadPromise) {
        await loadPromise;
      }
      const initialMessage = decodeURIComponent(options.initialMessage);
      this.setData({
        inputValue: initialMessage
      });
      if (!this.data.firstTouch || this.data.consentChecked) await this.handleStreamingSend();
    }
  },

  hydrateConversationSnapshot(conversationId) {
    const cachedConversation = conversationId ? api.peekConversation(conversationId) : null;

    if (cachedConversation && Array.isArray(cachedConversation.messages)) {
      this.applyConversationPayload(cachedConversation, {
        scrollToLatest: true,
        scrollWithAnimation: false
      });
      this._maybeShowA5();
      return;
    }

    this.showConversationShell();
  },

  applyConversationPayload(payload, options = {}) {
    const rawMessages = (payload && payload.messages) || [];
    const cleanedRaw = rawMessages.map(processAssistantForUI);
    const messages = decorateChatMessages(cleanedRaw);
    console.log(
      "[chat-render] applyConversationPayload",
      "rawMessages.length=", rawMessages.length,
      "decorated.length=", messages.length,
      "decorated.first.createdAt=", messages[0] && messages[0].createdAt,
      "decorated.last.createdAt=", messages[messages.length - 1] && messages[messages.length - 1].createdAt
    );

    this.fullMessages = messages;
    this.commitMessages(messages, {
      loading: false,
      renderLimit: messages.length,  // 一次渲完
      scrollToLatest: options.scrollToLatest === true && Boolean(messages.length),
      scrollWithAnimation: Boolean(options.scrollWithAnimation)
    });
    this._maybeShowMoodCheckin();
  },
  _schedulePrefetchHidden() {
    if (this._prefetchTimer) {
      clearTimeout(this._prefetchTimer);
      this._prefetchTimer = null;
    }

    const tick = () => {
      if (this._isUnmounted) return;
      const total = (this.fullMessages || []).length;
      const current = this.data.messageRenderLimit || INITIAL_RENDER_LIMIT;
      if (current >= total) return;

      const nextLimit = Math.min(current + PREFETCH_BATCH_SIZE, total);
      this.commitMessages(this.fullMessages, { renderLimit: nextLimit });

      if (nextLimit < total) {
        this._prefetchTimer = setTimeout(tick, PREFETCH_INTERVAL_MS);
      } else {
        this._prefetchTimer = null;
      }
    };

    this._prefetchTimer = setTimeout(tick, PREFETCH_INTERVAL_MS);
  },

  async loadConversation(conversationId, options = {}) {
    const deferRecovery = options.deferRecovery === true;
    console.log("[chat-load] loadConversation begin id=", conversationId, "deferRecovery=", deferRecovery);
    const payload = await api.getConversation(conversationId);
    const msgCount = (payload && Array.isArray(payload.messages) && payload.messages.length) || 0;
    console.log(
      "[chat-load] loadConversation done id=", conversationId,
      "messages.count=", msgCount,
      "first/last createdAt=",
      msgCount ? [payload.messages[0].createdAt, payload.messages[msgCount - 1].createdAt] : [],
      "first/last id=",
      msgCount ? [payload.messages[0].id || payload.messages[0]._id, payload.messages[msgCount - 1].id || payload.messages[msgCount - 1]._id] : []
    );
    const nextRaw = (payload && payload.messages) || [];
    const curDecorated = (this.fullMessages || []).filter((m) => m && !m.dateSeparator);
    const lastCur = curDecorated[curDecorated.length - 1];
    const lastRaw = nextRaw[nextRaw.length - 1];
    const sameShape =
      curDecorated.length === nextRaw.length &&
      lastCur && lastRaw &&
      (lastCur.id === lastRaw.id || lastCur._id === lastRaw._id) &&
      lastCur.createdAt === lastRaw.createdAt;
    if (sameShape) {
      console.log("[chat-load] loadConversation: same shape as hydrate, skip re-apply");
      this._maybeShowA5();
      return;
    }
    this.applyConversationPayload(payload, { scrollToLatest: true });
    if (!deferRecovery) {
      try {
        await this._resumePendingFinalize(conversationId);
      } catch (error) {
        console.warn("[pending-finalize] resume failed", error && (error.message || error.errMsg));
      }
      try {
        await this._recoverOrphanLastUserMessage(conversationId);
      } catch (error) {
        console.warn("[orphan-recover] failed", error && (error.message || error.errMsg));
      }
    }

    this._maybeShowA5();
  },

  showConversationShell() {
    this.fullMessages = [];
    this.commitMessages([], {
      loading: false,
      renderLimit: INITIAL_RENDER_LIMIT,
      scrollToLatest: false,
      scrollWithAnimation: false
    });
  },

  commitMessages(messages, options = {}) {
    const renderLimit = options.renderLimit || this.data.messageRenderLimit || INITIAL_RENDER_LIMIT;
    const { visibleMessages, hiddenCount } = getVisibleMessages(messages, renderLimit);
    let chipMessageId = "";
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      const m = visibleMessages[i];
      if (m && !m.dateSeparator && m.role === "assistant") {
        chipMessageId = m.id || "";
        break;
      }
    }
    const nextData = {
      messages: visibleMessages.slice().reverse(),
      hiddenMessageCount: hiddenCount,
      messageRenderLimit: renderLimit,
      chipMessageId
    };
    console.log(
      "[chat-render] commitMessages setData",
      "messages.length=", visibleMessages.length,
      "hiddenCount=", hiddenCount,
      "renderLimit=", renderLimit,
      "fullMessages.length=", (this.fullMessages || []).length,
      "earliest.visible.createdAt=", visibleMessages[0] && visibleMessages[0].createdAt,
      "newest.visible.createdAt=", visibleMessages[visibleMessages.length - 1] && visibleMessages[visibleMessages.length - 1].createdAt
    );

    if (typeof options.loading === "boolean") {
      nextData.loading = options.loading;
    }
    if (typeof options.sending === "boolean") {
      nextData.sending = options.sending;
    }

    this.setData(nextData);
  },

  handleShowEarlierMessages() {
    const fullMessages = this.fullMessages || [];

    if (!fullMessages.length || !this.data.hiddenMessageCount) {
      return;
    }

    this.commitMessages(fullMessages, {
      renderLimit: this.data.messageRenderLimit + LOAD_OLDER_BATCH_SIZE
    });
  },

  handleInput(event) {
    const value = event.detail.value;
    this.setData({
      inputValue: value
    });
    if (value && this.data.a5Tier) {
      this._clearA5("user_typed");
    }
  },

  async ensureConversationId(initialContent = "") {
    if (this.data.conversationId) {
      return this.data.conversationId;
    }

    if (this.creatingConversationPromise) {
      return this.creatingConversationPromise;
    }

    const source = (this.entryOptions && this.entryOptions.source) || "chat_entry";

    this.creatingConversationPromise = api
      .createConversation({
        source,
        initialMessage: initialContent
      })
      .then((conversation) => {
        const conversationId = conversation && (conversation.id || conversation._id);

        if (!conversationId) {
          throw new Error("Conversation creation returned no id");
        }

        this.setData({
          conversationId
        });

        return conversationId;
      })
      .finally(() => {
        this.creatingConversationPromise = null;
      });

    return this.creatingConversationPromise;
  },
  _genSessionId() {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  },
  _getExtendAI() { return null; },

  hasExtendAI() {
    const got = this._getExtendAI();
    if (!got) return false;

    if (!this._extendAIProbed) {
      this._extendAIProbed = true;
      try {
        console.log("[extend.AI probe] source=", got.source, "keys=", Object.keys(got.ai));
        if (got.ai.bot) {
          console.log("[extend.AI probe] bot keys=", Object.keys(got.ai.bot));
        }
      } catch (probeErr) {
        console.warn("[extend.AI probe] failed:", probeErr);
      }
    }

    return typeof got.ai.createModel === "function";
  },

  async handleStreamingSend() { return streamEngine.handleStreamingSend(this); },

  async _sendViaCloudFunction(content) { return streamEngine._sendViaCloudFunction(this, content); },

  async _sendViaPollingStream(content) { return streamEngine._sendViaPollingStream(this, content); },

  async _sendViaExtendAIStream(content) { return streamEngine._sendViaExtendAIStream(this, content); },

  _fallbackToCloudGenerate(prep, tempBubbleIds) { return streamEngine._fallbackToCloudGenerate(this, prep, tempBubbleIds); },

  _resumePendingFinalize(currentConversationId) { return streamEngine._resumePendingFinalize(this, currentConversationId); },

  _regeneratePendingAssistant(pending) { return streamEngine._regeneratePendingAssistant(this, pending); },

  _recoverOrphanLastUserMessage(conversationId) { return streamEngine._recoverOrphanLastUserMessage(this, conversationId); },
  playAssistantMessages(assistantMessages, baseMessages) { return streamEngine.playAssistantMessages(this, assistantMessages, baseMessages); },

  async handleSend() {
    return this.handleStreamingSend();
  },
  handleFirstMeetingChip(event) {
    if (this.data.sending) return;
    const text = String((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.text) || "").trim();
    if (!text) return;
    track.track("chat_first_meeting_chip_click", {
      chipText: text.slice(0, 32)
    });
    this._lastChipStash = { source: "first_meeting", text };
    this._sendFrom = "first_meeting_chip";
    this.setData({ inputValue: text });
    this.handleStreamingSend();
  },
  _maybeShowA5() {
    const gate = evaluateA5Trigger({
      suppressed: this._a5Suppressed,
      computed: this._a5Computed,
      sending: this.data.sending,
      inputValue: this.data.inputValue,        // 用户已经在输入，不打扰（但不烧 latch）
      voiceRecording: this.data.voiceRecording
    });
    if (gate.latch) this._a5Computed = true;
    if (!gate.shouldCompute) return;

    const fullMessages = this.fullMessages || [];
    const realMessages = fullMessages.filter((m) => m && !m.dateSeparator);
    if (!realMessages.length) return;            // 没历史就不算（A2 接管）

    const lastMessage = realMessages[realMessages.length - 1];
    const lastTime = getMessageDate(lastMessage);
    if (!lastTime) return;
    const gapMs = Date.now() - lastTime.getTime();
    const state = computeA5State({ gapMs, messages: realMessages });
    if (!state.tier) return;   // ≤ 30min 啥都不出

    this._a5FromLastReplyCandidates = state.fromLastReplyCandidates;
    const nextData = { a5Tier: state.tier, a5Chips: state.chips };
    if (state.tier === "opener") {
      nextData.a5OpenerText = state.openerText;
      nextData.a5OpenerFooter = state.footerText;
    }
    this.setData(nextData);

    track.track("chat_a5_show", {
      gapMinutes: Math.round(gapMs / 60000),
      hadOpener: state.tier === "opener",
      fromLastReplyCandidates: state.fromLastReplyCandidates
    });
  },
  handleA5Chip(event) {
    if (this.data.sending) return;
    const ds = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const text = String(ds.text || "").trim();
    if (!text) return;
    track.track("chat_a5_chip_click", {
      chipText: text.slice(0, 32),
      chipIndex: Number(ds.index) || 0,
      fromLastReplyCandidates: Boolean(this._a5FromLastReplyCandidates)
    });
    this._lastChipStash = { source: "a5_chip", text };
    this._sendFrom = "a5_chip";
    this.setData({ inputValue: text });
    this._clearA5("chip_clicked", { skipTrack: true });   // 点击不再走 dismiss 埋点（chip_click 已经覆盖）
  },
  _clearA5(reason, options = {}) {
    if (!this.data.a5Tier) return;
    if (!options.skipTrack) {
      track.track("chat_a5_dismiss", { reason: String(reason || "").slice(0, 32) });
    }
    this.setData({
      a5Tier: "",
      a5Chips: [],
      a5OpenerText: "",
      a5OpenerFooter: ""
    });
  },
  _debugSimulateNewUser() { return debugFns.debugSimulateNewUser(this); },

  _debugCycleA5() { return debugFns.debugCycleA5(this); },
  _debugToggleA5Suppress() { return debugFns.debugToggleA5Suppress(this); },
  handleReplyChip(event) {
    if (this.data.sending) return;
    const ds = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const text = String(ds.text || "").trim();
    if (!text) return;
    track.track("chat_chip_click", {
      messageId: String(ds.messageId || "").slice(0, 64),
      chipText: text.slice(0, 32),
      chipIndex: Number(ds.index) || 0
    });
    this._lastChipStash = { source: "reply_chip", text, messageId: String(ds.messageId || "") };
    this._sendFrom = "reply_chip";
    this.setData({ inputValue: text });
  },
  handleSendOrVoiceTap() {
    return voiceFns.handleSendOrVoiceTap(this);
  },
  handleVoiceTouchStart(event) {
    return voiceFns.handleVoiceTouchStart(this, event);
  },
  _beginVoiceRecord() {
    return voiceFns._beginVoiceRecord(this);
  },
  handleVoiceTouchMove(event) {
    return voiceFns.handleVoiceTouchMove(this, event);
  },
  handleVoiceTouchEnd() {
    return voiceFns.handleVoiceTouchEnd(this);
  },
  handleVoiceTouchCancel() {
    return voiceFns.handleVoiceTouchCancel(this);
  },
  _handleVoiceFinish(finalText) {
    return voiceFns._handleVoiceFinish(this, finalText);
  },
  handleBubbleLongPress(event) {
    const { index } = event.currentTarget.dataset;
    const message = this.data.messages[index];
    if (!message || message.pending || !message.content) return;
    const isLastAssistant =
      message.role === "assistant" && this.isLastAssistantMessage(message);
    const itemList = ["\u590d\u5236"];
    if (isLastAssistant) {
      itemList.push("\u8ba9\u5979\u91cd\u8bf4\u4e00\u6b21");
    }

    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.setClipboardData({ data: String(message.content || "") });
        } else if (res.tapIndex === 1 && isLastAssistant) {
          this.regenerateAssistant(message);
        }
      }
    });
  },

  isLastAssistantMessage(message) {
    const all = this.fullMessages || this.data.messages;
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const item = all[i];
      if (item && item.role === "assistant") {
        return item.id === message.id;
      }
    }
    return false;
  },

  async regenerateAssistant(message) {
    if (this.regeneratingId) return;
    this.regeneratingId = message.id;
    wx.showLoading({ title: "\u6362\u4e00\u53e5\u4e2d...", mask: true });
    try {
      const result = await api.regenerateMessage(this.data.conversationId);
      if (!result?.assistantMessages?.length) throw new Error("没有生成回复");
      const updated = (this.fullMessages || [])
        .filter(item => !(item.role === "assistant" && item.turnId === message.turnId))
        .concat(result.assistantMessages);
      this.fullMessages = decorateChatMessages(updated);
      this.commitMessages(this.fullMessages, {
        renderLimit: this.data.messageRenderLimit,
        scrollToLatest: false,
        scrollWithAnimation: false
      });

      if (result && result.aiMood) this.applyAiMood(result.aiMood);
      wx.hideLoading();
      wx.showToast({ title: "\u5df2\u91cd\u751f\u6210", icon: "success" });
    } catch (error) {
      console.warn("regenerate failed", error);
      wx.hideLoading();
      wx.showToast({ title: "\u91cd\u751f\u6210\u5931\u8d25", icon: "none" });
    } finally {
      this.regeneratingId = null;
    }
  },

  async saveHighlight(message) {
    try {
      await api.createHighlight({
        messageId: message.id,
        conversationId: this.data.conversationId,
        role: message.role,
        excerpt: String(message.content || "").slice(0, 240)
      });
      wx.showToast({ title: "\u5df2\u6536\u85cf", icon: "success" });
    } catch (error) {
      console.warn("save highlight failed", error);
      wx.showToast({ title: "\u6536\u85cf\u5931\u8d25", icon: "none" });
    }
  },

  applyAiMood(mood) {
    const valid = ["happy", "caring", "quiet", "worried"];
    const next = valid.includes(mood) ? mood : "quiet";
    if (next === this.data.aiMood) return;
    this.setData({
      aiMood: next,
      aiAvatarSrc: `/assets/avatars/she-${next}.svg`
    });
  },

  showMemoryBanner(memories) {
    if (!memories || !memories.length) return;
    const first = memories[0];
    const extraCount = memories.length - 1;
    const banner = {
      id: first.id,
      content: first.content,
      extraCount,
      title: copy("chat.memoryBanner.recorded"),
      action: copy("chat.memoryBanner.ok"),
      moreText: copy("chat.memoryBanner.more", { count: extraCount }),
      undoText: copy("chat.memoryBanner.undo")
    };
    this.setData({ memoryBanner: banner });

    if (this.memoryBannerTimer) {
      clearTimeout(this.memoryBannerTimer);
    }
    this.memoryBannerTimer = setTimeout(() => {
      if (this.data.memoryBanner && this.data.memoryBanner.id === banner.id) {
        this.setData({ memoryBanner: null });
      }
      this.memoryBannerTimer = null;
    }, 8000);
  },

  async handleMemoryBannerUndo() {
    const banner = this.data.memoryBanner;
    if (!banner || !banner.id) return;
    if (this.memoryBannerTimer) {
      clearTimeout(this.memoryBannerTimer);
      this.memoryBannerTimer = null;
    }
    this.setData({ memoryBanner: null });
    try {
      await api.deleteMemory(banner.id);
      wx.showToast({ title: "\u5df2\u5fd8\u6389", icon: "none" });
    } catch (error) {
      console.warn("undo memory failed", error);
    }
  },

  handleMemoryBannerDismiss() {
    if (this.memoryBannerTimer) {
      clearTimeout(this.memoryBannerTimer);
      this.memoryBannerTimer = null;
    }
    this.setData({ memoryBanner: null });
  },
  _applyServerNameUpdate(profileUpdate) {
    if (!profileUpdate || typeof profileUpdate !== "object") return;
    const me = (api.peekMe && api.peekMe()) || {};
    const aiName = profileUpdate.aiName && String(profileUpdate.aiName).trim();
    const nickname = profileUpdate.nickname && String(profileUpdate.nickname).trim();
    const curAi = (me.aiName && String(me.aiName).trim()) || this.data.pageTitle || "";
    const curNick = (me.nickname && String(me.nickname).trim()) || "";

    let banner = null;   // 同时改俩时 aiName 优先占浮层（两者都已落库+刷缓存）
    if (aiName && aiName !== curAi) {
      if (api.mergeLocalUser) api.mergeLocalUser({ aiName });
      this.setData({
        pageTitle: aiName,
        pageTitleLabel: copy("chat.title", { name: aiName }),
        inputPlaceholder: copy("chat.inputPlaceholderWithName", { name: aiName })
      });
      banner = { kind: "aiName", name: aiName, prev: curAi };
    }
    if (nickname && nickname !== curNick) {
      if (api.mergeLocalUser) api.mergeLocalUser({ nickname });
      if (!banner) banner = { kind: "nickname", name: nickname, prev: curNick };
    }
    if (banner) {
      this._showNameBanner(banner.kind, banner.name, banner.prev);
      track.track("chat_name_intent_applied", { kind: banner.kind, source: "sse_meta" });
    }
  },

  _showNameBanner(kind, nextName, prevName) {
    const banner = {
      id: `name-${kind}-${Date.now()}`,
      kind,
      prevName: prevName || "",
      title: kind === "aiName"
        ? copy("chat.nameBanner.aiNamed", { name: nextName })
        : copy("chat.nameBanner.userNamed", { name: nextName }),
      undoText: copy("chat.nameBanner.undo"),
      action: copy("chat.nameBanner.ok")
    };
    this.setData({ nameBanner: banner });
    if (this.nameBannerTimer) clearTimeout(this.nameBannerTimer);
    this.nameBannerTimer = setTimeout(() => {
      if (this.data.nameBanner && this.data.nameBanner.id === banner.id) {
        this.setData({ nameBanner: null });
      }
      this.nameBannerTimer = null;
    }, 8000);
  },
  async handleNameBannerUndo() {
    const banner = this.data.nameBanner;
    if (!banner) return;
    if (this.nameBannerTimer) {
      clearTimeout(this.nameBannerTimer);
      this.nameBannerTimer = null;
    }
    this.setData({ nameBanner: null });
    const kind = banner.kind;
    const prevName = banner.prevName || "";
    try {
      if (kind === "aiName") {
        const restore = prevName || COPY.chat.defaultPageTitle;
        await api.updateProfile({ aiName: restore });
        this.setData({
          pageTitle: restore,
          pageTitleLabel: copy("chat.title", { name: restore }),
          inputPlaceholder: copy("chat.inputPlaceholderWithName", { name: restore })
        });
      } else if (prevName) {
        await api.updateProfile({ nickname: prevName });
      }
      wx.showToast({ title: copy("chat.nameBanner.undone"), icon: "none" });
      track.track("chat_name_intent_undo", { kind });
    } catch (error) {
      console.warn("undo name intent failed", error);
    }
  },

  handleNameBannerDismiss() {
    if (this.nameBannerTimer) {
      clearTimeout(this.nameBannerTimer);
      this.nameBannerTimer = null;
    }
    this.setData({ nameBanner: null });
  },

  handleOpenDesk() {
    const previous = getCurrentPages().slice(-2, -1)[0];
    if (previous?.route === "pages/home/index") {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: "/pages/home/index" });
    }
  },
  _syncTopNav() {
    const navUnread = computeNavUnread();
    const navHintVisible = !this._navHintDismissed && !wx.getStorageSync(TOPNAV_HINT_SEEN_KEY);
    const patch = {};
    if (navUnread !== this.data.navUnread) patch.navUnread = navUnread;
    if (navHintVisible !== this.data.navHintVisible) patch.navHintVisible = navHintVisible;
    if (Object.keys(patch).length) this.setData(patch);
  },

  handleNav(event) {
    const key = event && event.detail && event.detail.key;
    if (!key) return;
    track.track("chat_topnav_nav", { key });
    if (key === "letters" || key === "memory" || key === "mood" || key === "about") {
      if (key === "letters" && this.data.navUnread) {
        markLettersReadNow();
        this.setData({ navUnread: false });
      }
      this.setData({ activePanel: key });
    }
  },

  handlePanelClose() {
    this.setData({ activePanel: "" });
    this._syncTopNav();
  },
  _maybeShowMoodCheckin() {
    if (this.data.firstTouch || !this.data.conversationId) return;
    if (this.data.moodCheckinVisible || this._moodCheckinShownThisSession) return;
    if (isPinnedForToday()) return;
    if (hasCheckinToday(api.peekRecentCheckins && api.peekRecentCheckins(30))) return;
    this._moodCheckinShownThisSession = true;
    this._a5Suppressed = true;
    this._clearA5("mood_checkin");
    const prompt = MOOD_PROMPTS[getMoodPromptKey()] || MOOD_PROMPTS.evening;
    clearTimeout(this._moodCheckinTimer);
    this._moodCheckinTimer = setTimeout(() => {
      if (this.data.sending || this.data.inputValue || this.data.voiceRecording) return;
      if (this.data.activePanel || this.data.paywallVisible || this.data.trialCardVisible || this.data.surveyVisible) return;
      this._clearA5("mood_checkin"); // 800ms 内 A5 若又冒出来，浮出前再清一次
      this.setData({
        moodCheckinVisible: true,
        moodPromptKicker: prompt.kicker,
        moodPromptText: prompt.text
      });
      pinTodayCheckin();
    }, 800);
  },

  handleMoodCheckinPick(event) {
    const value = event.currentTarget.dataset.value;
    if (!value || this.data.sending) return;
    pinTodayCheckin();
    track.track("mood_checkin_submit", { mood: value, from: "chat" });
    api.submitCheckin({ mood: value, note: "" }).catch((error) => {
      console.warn("mood checkin save failed (silent)", error);
    });
    this._pendingInitialMood = value;
    this._a5Suppressed = true;
    const msg = MOOD_FIRST_PERSON[value] || "";
    this.setData({ moodCheckinVisible: false, inputValue: msg });
    if (msg) this.handleStreamingSend();
  },

  handleMoodCheckinDismiss() {
    pinTodayCheckin(); // 今天不再弹
    track.track("mood_checkin_dismiss", { from: "chat" });
    this.setData({ moodCheckinVisible: false });
  },
  handleAboutMembership(event) {
    const canSubscribe = event && event.detail && event.detail.canSubscribe;
    this.setData({ activePanel: "" });
    if (canSubscribe) {
      this._openPaywallProactive();
    } else {
      wx.showToast({ title: copy("chat.membershipActive"), icon: "none" });
    }
  },
  handleAboutSurvey() {
    this._surveyDismissed = false;
    this.setData({ activePanel: "", surveyVisible: true });
  },
  handleAboutGoPanel(event) {
    const panel = (event && event.detail && event.detail.panel) || "";
    this.setData({ activePanel: panel });
    if (!panel) this._syncTopNav();
  },
  handleAboutSyncDay() {
    const timeOfDay = getTimeOfDay();
    if (timeOfDay !== this.data.timeOfDay) {
      this.setData({
        timeOfDay,
        starSeeds: timeOfDay === "night" ? this._buildStarSeeds() : []
      });
    }
  },

  handleNavHintDismiss() {
    this._navHintDismissed = true;
    try {
      wx.setStorageSync(TOPNAV_HINT_SEEN_KEY, 1);
    } catch (error) {
    }
    if (this.data.navHintVisible) this.setData({ navHintVisible: false });
  },
  handleToggleConsent() {
    const next = !this.data.consentChecked;
    this.setData({ consentChecked: next });
    if (next && !this._consentTracked) {
      this._consentTracked = true;
      const at = new Date().toISOString();
      try { track.track("privacy_consent_granted", { via: "first_touch_checkbox", consentAt: at, policyVersion: "v1" }); } catch (_) {  }
      try { wx.setStorageSync("privacy:consent-at:" + require("../../config").baseUrl, at); } catch (_) {  }
      if (!this._debugNewUserMode) {
        try { api.patchSettings({ privacyConsentGranted: true, privacyConsentVersion: "v1" }).catch(() => {}); } catch (_) {  }
      }
    }
  },
  handleOpenPrivacyPolicy() {
    wx.navigateTo({
      url: "/pages/privacy/index?type=privacy",
      fail(error) {
        console.warn("navigateTo privacy(policy) failed", error);
      }
    });
  },
  _syncTrialState(me) {
    if (this._debugNewUserMode) return;   // dev 模拟新用户态：不被真实账号状态覆盖
    if (!me || !me.trialPhase) return;
    const total = Number(me.trialNightsTotal) || 0;
    const used = Number(me.trialNightsUsed) || 0;
    const remaining = Math.max(0, total - used);
    const data = {
      trialRemaining: remaining,
      trialBadgeText: copy("chat.paywall.badge", { count: remaining }),
      trialDots: new Array(Math.min(remaining, 7)).fill(1),
      billingState: me.billingState || ""
    };
    if (!me.trialCardAcceptedAt && !this._trialCardShown) {
      this._trialCardShown = true;
      data.trialCardVisible = true;
    }
    const restPopOk = !this.data.sending && !this.data.inputValue && !this._a5Suppressed;
    data.surveyVisible = me.billingState === "survey_invite" && !this._surveyDismissed && restPopOk;
    data.surveyDone = Boolean(me.surveyCompletedAt);
    data.paywallVisible = Boolean(me.paymentAvailable && me.billingState === "paywall" && !this._paywallDismissed);
    data.paywallProactive = false;
    this.setData(data);
  },
  handlePaywallLater() {
    this._paywallDismissed = true;
    this.setData({ paywallVisible: false, paywallProactive: false });
    try { track.track("paywall_later", {}); } catch (_) {  }
  },
  _openPaywallProactive() {
    wx.navigateTo({ url: "/subpackages/security/index" });
  },
  handlePaywallPay() {
    this.setData({ paywallVisible: false });
    this._openPaywallProactive();
  },
  _confirmPayWithRetry() {
    wx.showToast({ title: "自托管版无需付费", icon: "none" });
  },
  _payPlatform() {
    try {
      const info = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()) || {};
      return String(info.platform || "").toLowerCase().indexOf("ios") >= 0 ? "ios" : "android";
    } catch (_) { return "android"; }
  },
  handlePaywallSurveyEntry() {
    this._surveyDismissed = false;
    this.setData({ paywallVisible: false, surveyVisible: true });
  },
  _debugPreviewPaywall() { return debugFns.debugPreviewPaywall(this); },
  _debugPreviewSurvey() { return debugFns.debugPreviewSurvey(this); },
  _debugFunnelAdvance() { return debugFns.debugFunnelAdvance(this); },
  _debugSandboxPay() { return debugFns.debugSandboxPay(this); },
  handleAcceptTrialCard() {
    this.setData({ trialCardVisible: false });
    if (this._debugNewUserMode) return;
    try { track.track("trial_card_accepted", {}); } catch (_) {  }
    api.acceptTrialCard().catch(() => {});
  },

  handleTrialBadgeTap() {
    this.setData({ trialBadgeExpanded: !this.data.trialBadgeExpanded });
  },

  handleSurveyPick(event) {
    const ds = (event && event.currentTarget && event.currentTarget.dataset) || {};
    if (ds.field === "q1") this.setData({ surveyQ1: String(ds.value || "") });
    if (ds.field === "q3") this.setData({ surveyQ3: String(ds.value || "") });
  },

  handleSurveyInput(event) {
    this.setData({ surveyQ2: String((event && event.detail && event.detail.value) || "").slice(0, 200) });
  },

  handleSurveyDismiss() {
    this._surveyDismissed = true;
    this.setData({ surveyVisible: false });
    try { track.track("trial_survey_dismissed", {}); } catch (_) {  }
    wx.showToast({ title: copy("chat.paywall.surveyDismissHint"), icon: "none", duration: 2400 });
    if (!this._debugNewUserMode) api.dismissTrialSurvey().catch(() => {});
  },

  async handleSurveySubmit() {
    if (this.data.surveySubmitting) return;
    if (this._debugNewUserMode) {
      this._surveyDismissed = true;
      this.setData({ surveyVisible: false });
      wx.showToast({ title: copy("chat.devMockMode"), icon: "none" });
      return;
    }
    this.setData({ surveySubmitting: true });
    try {
      await api.submitTrialSurvey({
        caught: this.data.surveyQ1,
        wish: this.data.surveyQ2,
        recommend: this.data.surveyQ3
      });
      this._surveyDismissed = true;
      this.setData({ surveyVisible: false, surveySubmitting: false });
      wx.showToast({ title: copy("chat.surveyReward"), icon: "none" });
      try { track.track("trial_survey_submitted", {}); } catch (_) {  }
      api.getMe().then((me) => this._syncTrialState(me)).catch(() => {});
    } catch (error) {
      console.warn("submit trial survey failed", error);
      this.setData({ surveySubmitting: false });
      wx.showToast({ title: copy("chat.surveySubmitFailed"), icon: "none" });
    }
  },
  onShareAppMessage() {
    return {
      title: copy("share.chat[1]"),
      path: "/pages/chat/index?from=share_chat"
    };
  },

  onShareTimeline() {
    return {
      title: copy("share.chat[2]"),
      query: "from=share_timeline_chat"
    };
  }
});
