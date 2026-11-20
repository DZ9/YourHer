const api = require("../../services/api");
const { switchRoot, syncCustomTabBar } = require("../../utils/nav");
const { getNavigationLayout } = require("../../utils/layout");
const { WEEKLY_NOTE_PUSH_TEMPLATE_ID } = require("../../utils/subscriptions");
const { getTimeOfDay, isNightMode, setNightModeOverride, broadcastTimeOfDayChange } = require("../../utils/time");
const { copy, COPY, syncGenderedCopy, PREFERENCE_LABELS, PREFERENCE_OPTIONS, RELATIONSHIP_LABELS, RELATIONSHIP_OPTIONS, INTEREST_SUGGESTIONS, GUEST_NICKNAME, GUEST_LOGIN_SUMMARY, LOGGED_IN_NICKNAME, CONNECTED_SUMMARY, PHONE_BOUND_SUMMARY, SEASON_LABEL } = require("../../utils/copy");
const WEEKLY_SUBSCRIBE_STATUS_KEY = "chatnpc:weekly-subscribe-status";

function readSubscribeStatus() {
  try {
    const v = wx.getStorageSync(WEEKLY_SUBSCRIBE_STATUS_KEY);
    if (v === "subscribed" || v === "rejected") return v;
  } catch (_) {  }
  return "unknown";
}

function writeSubscribeStatus(status) {
  try {
    if (status === "subscribed" || status === "rejected") {
      wx.setStorageSync(WEEKLY_SUBSCRIBE_STATUS_KEY, status);
    } else {
      wx.removeStorageSync(WEEKLY_SUBSCRIBE_STATUS_KEY);
    }
  } catch (_) {  }
}

const MOJIBAKE_MARKERS = ["�", "鐧", "犵", "厹", "濈", "绋", "鍏", "闂", "娑", "闄", "鐗", "粦"];

const DEFAULT_AVATAR = "../../assets/images/profile-avatar-stitch-me.jpg";
const DEFAULT_AI_NAME = COPY.me.defaultAiName;
const MAX_AI_NAME_LEN = 12;
const MAX_INTEREST_LEN = 16;
const MAX_INTERESTS = 8;
function looksMojibake(text) {
  const value = String(text || "");
  return MOJIBAKE_MARKERS.some((marker) => value.includes(marker));
}

function getDisplayText(value, fallback) {
  const text = String(value || "").trim();
  return text && !looksMojibake(text) ? text : fallback;
}

function deriveCaresList(displayUser) {
  const list = (displayUser && displayUser.interests) || [];
  return Array.isArray(list) ? list.slice(0, MAX_INTERESTS) : [];
}

function deriveJoinedHint(user) {
  if (!user) return "";
  const raw = user.createdAt || user.firstSeenAt || user.joinedAt;
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const month = d.getMonth() + 1;
  const season = SEASON_LABEL[month] || "夜晚";
  return `从 ${month}月${d.getDate()}日 那个${season}开始`;
}

const VALID_MOODS = ["happy", "caring", "quiet", "worried"];

function deriveAiAvatarSrc(displayUser) {
  const mood = (displayUser && displayUser.aiMoodSnapshot) || "";
  const key = VALID_MOODS.includes(mood) ? mood : "quiet";
  return `/assets/avatars/she-${key}.svg`;
}

function formatDateChinese(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return copy("time.today");
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return copy("time.yesterday");
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function normalizeAvatar(avatar, loggedIn) {
  const value = String(avatar || "").trim();
  return loggedIn && value ? value : DEFAULT_AVATAR;
}

function isPhoneBound(user = {}) {
  return Boolean(user.phoneBound || user.phoneMasked || user.phoneNumber);
}

function hasCustomNickname(user = {}) {
  const nickname = String(user.nickname || "").trim();
  return Boolean(nickname && nickname !== LOGGED_IN_NICKNAME && nickname !== GUEST_NICKNAME);
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

function resolveNicknameDraft(displayUser) {
  if (!displayUser || !displayUser.sessionActive) {
    return "";
  }

  return displayUser.nickname === LOGGED_IN_NICKNAME ? "" : displayUser.nickname;
}

function createDisplayUser(user = {}) {
  const sessionActive = user.sessionActive !== false;
  const wechatBound = sessionActive && user.wechatBound !== false;
  const phoneBound = isPhoneBound(user);
  const profileCompleted = Boolean(user.profileCompleted);
  const nicknameFallback = wechatBound ? LOGGED_IN_NICKNAME : GUEST_NICKNAME;
  const summaryFallback = sessionActive
    ? phoneBound
      ? PHONE_BOUND_SUMMARY
      : CONNECTED_SUMMARY
    : GUEST_LOGIN_SUMMARY;
  const rawNickname = String(user.nickname || "").trim();

  return {
    ...user,
    sessionActive,
    wechatBound,
    phoneBound,
    profileCompleted: profileCompleted || isProfileCompleted(user),
    avatarSrc: normalizeAvatar(user.avatar, sessionActive),
    nickname:
      sessionActive && rawNickname && rawNickname !== GUEST_NICKNAME
        ? getDisplayText(rawNickname, nicknameFallback)
        : nicknameFallback,
    accountSummary: sessionActive
      ? phoneBound
        ? copy("me.account.wechatPhoneBound")
        : copy("me.account.wechatPhoneNotBound")
      : copy("me.account.wechatNotLoggedIn"),
    loginSummary: summaryFallback,
    notificationEnabled: Boolean(user.notificationEnabled),
    companionPreference: user.companionPreference || "gentle",
    companionPreferenceLabel: PREFERENCE_LABELS[user.companionPreference] || PREFERENCE_LABELS.gentle,
    relationshipMode: user.relationshipMode || "friend",
    relationshipModeLabel: RELATIONSHIP_LABELS[user.relationshipMode] || RELATIONSHIP_LABELS.friend,
    aiName: (user.aiName && String(user.aiName).trim()) || DEFAULT_AI_NAME,
    interests: Array.isArray(user.interests) ? user.interests : [],
    interestsSummary: buildInterestsSummary(user.interests),
    currentCity: getDisplayText(user.currentCity, ""),
    version: ((getApp() || {}).globalData || {}).version || ""
  };
}

function buildInterestsSummary(interests) {
  const list = Array.isArray(interests) ? interests.filter(Boolean) : [];
  if (!list.length) {
    return copy("me.values.interestsEmpty");
  }
  if (list.length <= 2) {
    return list.join("\u3001");
  }
  return `${list.slice(0, 2).join("\u3001")} \u7b49 ${list.length} \u4e2a`;
}
function formatMembershipDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}.${m}.${day}`;
}
function deriveMembership(displayUser) {
  const u = displayUser || {};
  if (u.subscriptionActive) {
    const until = formatMembershipDate(u.subscriptionExpireAt);
    return { canSubscribe: false, statusText: until ? copy("me.values.membershipValid", { date: until }) : copy("me.values.membershipActive") };
  }
  if (u.billingState === "trial") {
    const remaining = Math.max(0, (Number(u.trialNightsTotal) || 0) - (Number(u.trialNightsUsed) || 0));
    return { canSubscribe: true, statusText: copy("me.values.membershipTrial", { count: remaining }) };
  }
  return { canSubscribe: true, statusText: copy("me.values.membershipInactive") };
}

function wxLogin() {
  return new Promise((resolve, reject) => {
    if (!wx.login) {
      resolve({ code: "" });
      return;
    }

    wx.login({
      success: resolve,
      fail: reject
    });
  });
}

function getLocationOnce() {
  return new Promise((resolve, reject) => wx.showModal({title: "所在城市", editable: true, success: r => r.confirm && r.content ? resolve({city: r.content}) : reject(new Error("已取消")), fail: reject}));
}

function getWechatProfile() {
  return new Promise((resolve) => {
    if (!wx.getUserProfile) {
      resolve(null);
      return;
    }

    wx.getUserProfile({
      desc: copy("me.account.getUserProfileDesc"),
      success(result) {
        resolve((result && result.userInfo) || null);
      },
      fail(error) {
        console.warn("getUserProfile failed", error);
        resolve(null);
      }
    });
  });
}

function createAvatarCloudPath(filePath) {
  const cleanPath = String(filePath || "").split("?")[0];
  const extensionMatch = cleanPath.match(/\.([a-zA-Z0-9]+)$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "jpg";
  const token = Math.random().toString(36).slice(2, 10);
  return `avatars/${Date.now()}-${token}.${extension}`;
}

function uploadAvatarFile(filePath) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.uploadFile !== "function") {
      resolve(filePath);
      return;
    }

    wx.cloud.uploadFile({
      cloudPath: createAvatarCloudPath(filePath),
      filePath,
      success(result) {
        resolve(result.fileID || filePath);
      },
      fail: reject
    });
  });
}

function getErrorMessage(error) {
  return String((error && (error.errMsg || error.message)) || error || "");
}

function getPhoneBindFailureText(error) {
  const message = getErrorMessage(error);

  if (
    message.includes("-604101") ||
    message.includes("has no permission to call this API") ||
    message.includes("当前云函数没有手机号接口权限")
  ) {
    return "手机号权限没开，请重新上传 chatnpcApiV2 云函数";
  }

  if (message.includes("Cloud function is required")) {
    return copy("me.phoneBindFailure.deployFirst");
  }

  return copy("me.phoneBindFailure.default");
}

function resolvePhoneBindFailureText(error) {
  const message = getErrorMessage(error);
  const lowerMessage = message.toLowerCase();

  if (
    message.includes("-604101") ||
    message.includes("has no permission to call this API") ||
    message.includes("\u5f53\u524d\u4e91\u51fd\u6570\u6ca1\u6709\u624b\u673a\u53f7\u63a5\u53e3\u6743\u9650")
  ) {
    return copy("me.phoneBindFailure.permissionNotOpen");
  }

  if (message.includes("Cloud function is required")) {
    return copy("me.phoneBindFailure.deployFirst");
  }

  if (
    message.includes("Phone authorization code is required") ||
    (lowerMessage.includes("code") &&
      (lowerMessage.includes("invalid") ||
        lowerMessage.includes("used") ||
        lowerMessage.includes("expire") ||
        lowerMessage.includes("expired"))) ||
    message.includes("\u6388\u6743\u5df2\u5931\u6548")
  ) {
    return copy("me.phoneBindFailure.authExpired");
  }

  if (
    message.includes("Phone number missing from WeChat response") ||
    (lowerMessage.includes("phone") &&
      lowerMessage.includes("missing") &&
      lowerMessage.includes("response")) ||
    message.includes("\u5fae\u4fe1\u6ca1\u6709\u8fd4\u56de\u624b\u673a\u53f7")
  ) {
    return copy("me.phoneBindFailure.noPhoneReturned");
  }

  if (lowerMessage.includes("timed out")) {
    return copy("me.phoneBindFailure.timeout");
  }

  if (message && message.length <= 40) {
    return message;
  }

  return copy("me.phoneBindFailure.default");
}

Page({
  data: {
    statusBarHeight: 20,
    topbarContentHeight: 32,
    topbarSideWidth: 112,
    timeOfDay: getTimeOfDay(),
    nightModeOn: isNightMode(),
    user: null,
    displayUser: null,
    loggingIn: false,
    loggingOut: false,
    savingNickname: false,
    nicknameEditorVisible: false,
    nicknameDraft: "",
    keyboardOffset: 0,
    uploadingAvatar: false,
    bindingPhone: false,
    aiNameEditorVisible: false,
    aiNameDraft: "",
    savingAiName: false,
    interestsEditorVisible: false,
    interestsDraft: [],
    customInterestDraft: "",
    savingInterests: false,
    interestSuggestions: INTEREST_SUGGESTIONS,
    maxInterests: MAX_INTERESTS,
    locatingCity: false,
    preferenceEditorVisible: false,
    preferenceDraft: "gentle",
    savingPreference: false,
    preferenceOptions: PREFERENCE_OPTIONS,
    relationshipEditorVisible: false,
    relationshipDraft: "friend",
    savingRelationship: false,
    relationshipOptions: RELATIONSHIP_OPTIONS,
    stats: null,
    recentMemories: [],
    recentMemoryHint: "",
    caresList: [],
    joinedHint: "",
    aiAvatarSrc: "/assets/desk/companion-face.svg",
    subscribeStatus: "unknown",
    membership: { canSubscribe: true, statusText: "" }
  },

  onLoad() {
    this.setData({
      ...getNavigationLayout(),
      timeOfDay: getTimeOfDay()
    });
    this.setData({ subscribeStatus: readSubscribeStatus() });
    this.hydrateProfileSnapshot();
    this._keyboardHandler = (res) => {
      const height = (res && res.height) || 0;
      if (!this.data.nicknameEditorVisible && height === 0) return;
      if (height === this.data.keyboardOffset) return;
      this.setData({ keyboardOffset: height });
    };
    if (typeof wx.onKeyboardHeightChange === "function") {
      wx.onKeyboardHeightChange(this._keyboardHandler);
    }
  },

  onUnload() {
    if (this._keyboardHandler && typeof wx.offKeyboardHeightChange === "function") {
      wx.offKeyboardHeightChange(this._keyboardHandler);
    }
    this._keyboardHandler = null;
  },

  onShow() {
    syncGenderedCopy(this);
    const timeOfDay = getTimeOfDay();
    const nightModeOn = timeOfDay === "night";
    const patch = {};
    if (timeOfDay !== this.data.timeOfDay) patch.timeOfDay = timeOfDay;
    if (nightModeOn !== this.data.nightModeOn) patch.nightModeOn = nightModeOn;
    if (Object.keys(patch).length) this.setData(patch);
    syncCustomTabBar("me", this.data.nicknameEditorVisible);
    this.hydrateProfileSnapshot();
    this.loadProfile().catch((error) => {
      console.warn("loadProfile failed", error);
    });
    this.loadCompanionMetrics();
    this.loadRecentMemories();
  },

  applyMetrics({ stats, weekly, checkins }) {
    const baseStats = stats || {};
    const letterItems = (weekly && weekly.items) || [];
    const checkinItems = (checkins && checkins.items) || [];
    this.setData({
      stats: {
        ...baseStats,
        letterCount: letterItems.length,
        checkinCount: checkinItems.length
      }
    });
    this._refreshMeCopy();
  },

  async loadCompanionMetrics() {
    try {
      const [statsResult, weeklyResult, checkinsResult] = await Promise.allSettled([
        api.getCompanionStats(),
        api.getWeeklyNotes(),
        api.getRecentCheckins(365)
      ]);
      this.applyMetrics({
        stats: statsResult.status === "fulfilled" ? statsResult.value : null,
        weekly: weeklyResult.status === "fulfilled" ? weeklyResult.value : null,
        checkins: checkinsResult.status === "fulfilled" ? checkinsResult.value : null
      });
    } catch (error) {
      console.warn("loadCompanionMetrics failed", error);
    }
  },

  handleBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.reLaunch({ url: "/pages/home/index" });
  },
  handleOpenMembership() {
    const du = this.data.displayUser || {};
    if (du.subscriptionActive) {
      const m = this.data.membership || {};
      wx.showToast({ title: m.statusText ? `会员 · ${m.statusText}` : copy("me.membershipAlready"), icon: "none" });
      return;
    }
    wx.reLaunch({ url: "/pages/chat/index?openPaywall=1&source=me_membership" });
  },
  handleStatGoChat() {
    wx.navigateTo({ url: "/pages/chat/index?source=me_stat_chat" });
  },
  handleStatGoLetters() {
    switchRoot("/pages/records/index?tab=letters");
  },
  handleStatGoMood() {
    switchRoot("/pages/records/index?tab=letters");
  },

  applyMemories(memories) {
    const list = Array.isArray(memories) ? memories : (memories && memories.items) || [];
    const sorted = list
      .slice()
      .sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return tb - ta;
      });
    const top = sorted.slice(0, 3).map((m) => ({
      id: m.id || m._id,
      content: String(m.content || "").slice(0, 36)
    }));
    const latestDate = sorted[0] && (sorted[0].updatedAt || sorted[0].createdAt);
    this.setData({
      recentMemories: top,
      recentMemoryHint: latestDate ? `最近一条 ${formatDateChinese(latestDate)}` : ""
    });
  },

  async loadRecentMemories() {
    try {
      const items = (await api.getMemories()) || [];
      this.applyMemories(items);
    } catch (error) {
      console.warn("loadRecentMemories failed", error);
    }
  },

  applyProfile(user) {
    if (!user) return;
    const displayUser = createDisplayUser(user);
    this.setData({
      user,
      displayUser,
      nicknameDraft: resolveNicknameDraft(displayUser),
      caresList: deriveCaresList(displayUser),
      joinedHint: deriveJoinedHint(user),
      aiAvatarSrc: deriveAiAvatarSrc(displayUser),
      membership: deriveMembership(displayUser)
    });
    this._refreshMeCopy();
  },

  _refreshMeCopy() {
    const du = this.data.displayUser || {};
    const caresList = this.data.caresList || [];
    const bindingPhone = this.data.bindingPhone;
    const maxInterests = this.data.maxInterests || MAX_INTERESTS;
    const interestsDraft = this.data.interestsDraft || [];
    const daysTogether = (this.data.stats && this.data.stats.daysTogether) || 1;
    this.setData({
      heroDaysText: copy("me.hero.days", { count: daysTogether }),
      nicknameDisplay: du.nickname || copy("me.values.nicknameNotSet"),
      cityDisplay: this.data.locatingCity
        ? copy("me.values.cityLocating")
        : (du.currentCity || copy("me.values.cityUnknown")),
      phoneDisplay: bindingPhone ? copy("me.values.phoneBinding") : copy("me.values.phoneBind"),
      phoneMaskedDisplay: du.phoneMasked || copy("me.values.phoneNotBound"),
      caresCountText: `${caresList.length}${copy("me.cares.countUnit")}`,
      interestsSheetDesc: copy("me.interests.sheetDesc", { max: maxInterests }),
      interestsSelectedLabel: copy("me.interests.selected", { count: interestsDraft.length, max: maxInterests })
    });
  },
  hydrateProfileSnapshot() {
    const user = api.peekMe();
    if (user) this.applyProfile(user);

    const stats = api.peekCompanionStats && api.peekCompanionStats();
    const weekly = api.peekWeeklyNotes && api.peekWeeklyNotes();
    const checkins = api.peekRecentCheckins && api.peekRecentCheckins(365);
    if (stats || weekly || checkins) {
      this.applyMetrics({ stats, weekly, checkins });
    }

    const memories = api.peekMemories && api.peekMemories();
    if (memories) this.applyMemories(memories);
  },

  async loadProfile() {
    const user = await api.getMe();
    this.applyProfile(user);
  },

  handleNicknameInput(event) {
    this.setData({
      nicknameDraft: event.detail.value
    });
  },

  async handleNicknameBlur(event) {
    await this.saveNickname((event.detail && event.detail.value) || this.data.nicknameDraft, {
      closeOnSuccess: false
    });
  },

  handleOpenNicknameEditor() {
    if (!this.data.displayUser || !this.data.displayUser.sessionActive) {
      wx.showToast({
        title: copy("me.connectWechatFirst"),
        icon: "none"
      });
      return;
    }

    this.setData({
      nicknameDraft: resolveNicknameDraft(this.data.displayUser),
      nicknameEditorVisible: true,
      keyboardOffset: 0 // 重置上次的键盘偏移，避免开 sheet 那一帧就有旧偏移
    });
    syncCustomTabBar("me", true);
  },

  handleCloseNicknameEditor() {
    if (this.data.savingNickname) {
      return;
    }

    this.setData({
      nicknameDraft: resolveNicknameDraft(this.data.displayUser),
      nicknameEditorVisible: false,
      keyboardOffset: 0
    });
    syncCustomTabBar("me", false);
  },

  async handleNicknameSubmit(event) {
    await this.saveNickname((event.detail && event.detail.value) || this.data.nicknameDraft, {
      closeOnSuccess: true
    });
  },

  noop() {},

  async saveNickname(value, options = {}) {
    if (this.data.savingNickname || !this.data.displayUser || !this.data.displayUser.sessionActive) {
      return;
    }

    const nickname = String(value || "").trim();

    if (!nickname) {
      wx.showToast({
        title: copy("me.nickname.emptyError"),
        icon: "none"
      });
      this.setData({
        nicknameDraft: resolveNicknameDraft(this.data.displayUser)
      });
      return;
    }

    if (nickname === this.data.user.nickname) {
      this.setData({
        nicknameDraft: resolveNicknameDraft(this.data.displayUser),
        nicknameEditorVisible: options.closeOnSuccess ? false : this.data.nicknameEditorVisible
      });
      if (options.closeOnSuccess) {
        syncCustomTabBar("me", false);
      }
      return;
    }

    this.setData({ savingNickname: true });

    try {
      const user = await api.updateProfile({ nickname });
      const displayUser = createDisplayUser(user);

      this.setData({
        user,
        displayUser,
        nicknameDraft: resolveNicknameDraft(displayUser),
        nicknameEditorVisible: options.closeOnSuccess ? false : this.data.nicknameEditorVisible
      });
      if (options.closeOnSuccess) {
        syncCustomTabBar("me", false);
      }

      wx.showToast({
        title: copy("me.nickname.success"),
        icon: "success"
      });
    } catch (error) {
      console.warn("update nickname failed", error);
      wx.showToast({
        title: copy("me.nickname.failed"),
        icon: "none"
      });
      this.setData({
        nicknameDraft: resolveNicknameDraft(this.data.displayUser)
      });
    } finally {
      this.setData({ savingNickname: false });
    }
  },

  async handleWechatLogin() {
    if (this.data.loggingIn) {
      return;
    }

    this.setData({ loggingIn: true });

    try {
      const userInfo = await getWechatProfile();
      const loginResult = await wxLogin();
      const user = await api.login({
        code: loginResult.code || "",
        userInfo: userInfo || {}
      });
      const displayUser = createDisplayUser(user);

      this.setData({
        user,
        displayUser,
        nicknameDraft: resolveNicknameDraft(displayUser)
      });

      wx.showToast({
        title: copy("me.account.connectedSummary"),
        icon: "success"
      });
    } catch (error) {
      console.warn("wechat login failed", error);
      const message = String((error && (error.errMsg || error.message)) || error || "");
      const isCanceled = message.includes("cancel") || message.includes("canceled");

      if (!isCanceled) {
        wx.showToast({
          title: copy("me.connectWechatFirst"),
          icon: "none"
        });
      }
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  async handleChooseAvatar(event) {
    const avatarUrl = event.detail && event.detail.avatarUrl;

    if (!avatarUrl || this.data.uploadingAvatar) {
      return;
    }

    if (!this.data.displayUser || !this.data.displayUser.sessionActive) {
      wx.showToast({
        title: copy("me.connectWechatFirst"),
        icon: "none"
      });
      return;
    }

    const previousUser = this.data.user;

    this.setData({
      uploadingAvatar: true,
      displayUser: {
        ...this.data.displayUser,
        avatarSrc: avatarUrl
      }
    });

    try {
      const avatar = await uploadAvatarFile(avatarUrl);
      const user = await api.updateProfile({ avatar });
      const displayUser = createDisplayUser(user);

      this.setData({
        user,
        displayUser,
        nicknameDraft: resolveNicknameDraft(displayUser)
      });

      wx.showToast({
        title: copy("me.avatarUpdated"),
        icon: "success"
      });
    } catch (error) {
      console.warn("update avatar failed", error);
      this.setData({
        displayUser: createDisplayUser(previousUser)
      });
      wx.showToast({
        title: copy("me.avatarFailed"),
        icon: "none"
      });
    } finally {
      this.setData({ uploadingAvatar: false });
    }
  },

  async handleGetPhoneNumber(event) {
    if (this.data.bindingPhone) {
      return;
    }

    const detail = event.detail || {};
    const message = getErrorMessage(detail);

    if (message && !message.includes(":ok")) {
      wx.showToast({
        title: copy("me.phoneBindRequired"),
        icon: "none"
      });
      return;
    }

    if (!detail.code) {
      wx.showToast({
        title: copy("me.phoneAuthMissing"),
        icon: "none"
      });
      return;
    }

    this.setData({ bindingPhone: true });

    try {
      const user = await api.bindPhone({
        code: detail.code
      });
      const displayUser = createDisplayUser(user);

      this.setData({
        user,
        displayUser,
        nicknameDraft: resolveNicknameDraft(displayUser)
      });

      wx.showToast({
        title: copy("me.phoneBound"),
        icon: "success"
      });
    } catch (error) {
      console.warn("bind phone failed", error);
      wx.showToast({
        title: resolvePhoneBindFailureText(error),
        icon: "none"
      });
    } finally {
      this.setData({ bindingPhone: false });
      this._refreshMeCopy();
    }
  },

  handleOpenMemory() {
    wx.redirectTo({ url: "/pages/records/index?tab=memory" });
  },
  handleSubscribeProactive() {
    if (!WEEKLY_NOTE_PUSH_TEMPLATE_ID) {
      wx.showToast({ title: copy("me.notOpen"), icon: "none" });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [WEEKLY_NOTE_PUSH_TEMPLATE_ID],
      success: (res) => {
        const status = res[WEEKLY_NOTE_PUSH_TEMPLATE_ID];
        if (status === "accept") {
          writeSubscribeStatus("subscribed");
          this.setData({ subscribeStatus: "subscribed" });
          this._syncNotificationOptIn(true);
          wx.showToast({ title: copy("me.weeklySubscribe"), icon: "success", duration: 2000 });
          return;
        }
        writeSubscribeStatus("rejected");
        this.setData({ subscribeStatus: "rejected" });
        this._syncNotificationOptIn(false);
        wx.showToast({ title: copy("me.nightModeOff"), icon: "none", duration: 1500 });
      },
      fail: (error) => {
        console.warn("requestSubscribeMessage failed", error);
        wx.showToast({ title: copy("me.authFailed"), icon: "none" });
      }
    });
  },
  _syncNotificationOptIn(enabled) {
    api.updateProfile({ notificationEnabled: Boolean(enabled) }).catch((error) => {
      console.warn("sync notificationEnabled failed", error && (error.errMsg || error.message));
    });
  },

  handleGoFeedback() {
    wx.navigateTo({
      url: "/subpackages/feedback/index"
    });
  },
  handleToggleNightMode(event) {
    const wantNight = Boolean(event && event.detail && event.detail.value);
    setNightModeOverride(wantNight ? "night" : "day");
    broadcastTimeOfDayChange();
  },

  handleOpenAiNameEditor() {
    if (!this.data.displayUser || !this.data.displayUser.sessionActive) {
      wx.showToast({ title: copy("me.connectWechatFirst"), icon: "none" });
      return;
    }

    const current = this.data.displayUser.aiName || DEFAULT_AI_NAME;
    this.setData({
      aiNameEditorVisible: true,
      aiNameDraft: current === DEFAULT_AI_NAME ? "" : current
    });
    syncCustomTabBar("me", true);
  },

  handleCloseAiNameEditor() {
    if (this.data.savingAiName) return;
    this.setData({ aiNameEditorVisible: false, aiNameDraft: "" });
    syncCustomTabBar("me", false);
  },

  handleAiNameInput(event) {
    const value = String(event.detail.value || "").slice(0, MAX_AI_NAME_LEN);
    this.setData({ aiNameDraft: value });
  },

  async handleAiNameSubmit() {
    const value = String(this.data.aiNameDraft || "").trim();

    if (!value) {
      wx.showToast({ title: copy("me.aiName.placeholder"), icon: "none" });
      return;
    }

    if (this.data.savingAiName) return;
    this.setData({ savingAiName: true });

    try {
      const user = await api.updateProfile({ aiName: value });
      const displayUser = createDisplayUser(user);
      this.setData({
        user,
        displayUser,
        aiNameEditorVisible: false,
        aiNameDraft: ""
      });
      syncCustomTabBar("me", false);
      wx.showToast({ title: copy("me.aiName.success"), icon: "success" });
    } catch (error) {
      console.warn("update aiName failed", error);
      wx.showToast({ title: copy("me.aiName.failed"), icon: "none" });
    } finally {
      this.setData({ savingAiName: false });
    }
  },

  handleOpenRelationshipEditor() {
    if (!this.data.displayUser || !this.data.displayUser.sessionActive) {
      wx.showToast({ title: copy("me.connectWechatFirst"), icon: "none" });
      return;
    }
    const current = (this.data.displayUser && this.data.displayUser.relationshipMode) || "friend";
    this.setData({
      relationshipEditorVisible: true,
      relationshipDraft: current
    });
    syncCustomTabBar("me", true);
  },

  handleCloseRelationshipEditor() {
    this.setData({ relationshipEditorVisible: false });
    syncCustomTabBar("me", false);
  },

  handleSelectRelationshipDraft(event) {
    const value = event.currentTarget.dataset.value;
    if (!value) return;
    this.setData({ relationshipDraft: value });
  },

  async handleRelationshipSubmit() {
    if (this.data.savingRelationship) return;
    const value = this.data.relationshipDraft;
    if (!value) {
      wx.showToast({ title: copy("me.preference.emptyError"), icon: "none" });
      return;
    }
    if (this.data.displayUser && this.data.displayUser.relationshipMode === value) {
      this.setData({ relationshipEditorVisible: false });
      syncCustomTabBar("me", false);
      return;
    }
    this.setData({ savingRelationship: true });
    try {
      const user = await api.updateProfile({ relationshipMode: value });
      const displayUser = createDisplayUser(user);
      this.setData({
        user,
        displayUser,
        relationshipEditorVisible: false
      });
      syncCustomTabBar("me", false);
      wx.showToast({ title: copy("me.aiName.success"), icon: "success" });
    } catch (error) {
      console.warn("update relationship failed", error);
      wx.showToast({ title: copy("me.aiName.failed"), icon: "none" });
    } finally {
      this.setData({ savingRelationship: false });
    }
  },

  handleOpenPreferenceEditor() {
    if (!this.data.displayUser || !this.data.displayUser.sessionActive) {
      wx.showToast({ title: copy("me.connectWechatFirst"), icon: "none" });
      return;
    }
    const current = (this.data.displayUser && this.data.displayUser.companionPreference) || "gentle";
    this.setData({
      preferenceEditorVisible: true,
      preferenceDraft: current
    });
    syncCustomTabBar("me", true);
  },

  handleClosePreferenceEditor() {
    this.setData({
      preferenceEditorVisible: false
    });
    syncCustomTabBar("me", false);
  },

  handleSelectPreferenceDraft(event) {
    const value = event.currentTarget.dataset.value;
    if (!value) return;
    this.setData({ preferenceDraft: value });
  },

  async handlePreferenceSubmit() {
    if (this.data.savingPreference) return;
    const value = this.data.preferenceDraft;
    if (!value) {
      wx.showToast({ title: copy("me.preference.emptyError"), icon: "none" });
      return;
    }
    if (this.data.displayUser && this.data.displayUser.companionPreference === value) {
      this.setData({ preferenceEditorVisible: false });
      syncCustomTabBar("me", false);
      return;
    }

    this.setData({ savingPreference: true });
    try {
      const user = await api.updateProfile({ companionPreference: value });
      const displayUser = createDisplayUser(user);
      this.setData({
        user,
        displayUser,
        preferenceEditorVisible: false
      });
      syncCustomTabBar("me", false);
      wx.showToast({ title: copy("me.aiName.success"), icon: "success" });
    } catch (error) {
      console.warn("update preference failed", error);
      wx.showToast({ title: copy("me.aiName.failed"), icon: "none" });
    } finally {
      this.setData({ savingPreference: false });
    }
  },

  handleOpenInterestsEditor() {
    if (!this.data.displayUser || !this.data.displayUser.sessionActive) {
      wx.showToast({ title: copy("me.connectWechatFirst"), icon: "none" });
      return;
    }

    const current = Array.isArray(this.data.displayUser.interests)
      ? this.data.displayUser.interests.slice()
      : [];
    this.setData({
      interestsEditorVisible: true,
      interestsDraft: current,
      customInterestDraft: ""
    });
    this._refreshMeCopy();
    syncCustomTabBar("me", true);
  },

  handleCloseInterestsEditor() {
    if (this.data.savingInterests) return;
    this.setData({
      interestsEditorVisible: false,
      interestsDraft: [],
      customInterestDraft: ""
    });
    syncCustomTabBar("me", false);
  },

  handleToggleInterestDraft(event) {
    const { tag } = event.currentTarget.dataset;
    if (!tag) return;

    const current = this.data.interestsDraft.slice();
    const index = current.indexOf(tag);

    if (index >= 0) {
      current.splice(index, 1);
    } else if (current.length < MAX_INTERESTS) {
      current.push(tag);
    } else {
      wx.showToast({ title: copy("me.interests.maxError", { max: MAX_INTERESTS }), icon: "none" });
      return;
    }

    this.setData({ interestsDraft: current });
    this._refreshMeCopy();
  },

  handleCustomInterestInput(event) {
    const value = String(event.detail.value || "").slice(0, MAX_INTEREST_LEN);
    this.setData({ customInterestDraft: value });
  },

  handleAddCustomInterest() {
    const value = String(this.data.customInterestDraft || "").trim();
    if (!value) return;

    const current = this.data.interestsDraft.slice();
    if (current.includes(value)) {
      this.setData({ customInterestDraft: "" });
      return;
    }

    if (current.length >= MAX_INTERESTS) {
      wx.showToast({ title: copy("me.interests.maxError", { max: MAX_INTERESTS }), icon: "none" });
      return;
    }

    current.push(value);
    this.setData({
      interestsDraft: current,
      customInterestDraft: ""
    });
    this._refreshMeCopy();
  },

  async handleInterestsSubmit() {
    if (this.data.savingInterests) return;
    this.setData({ savingInterests: true });

    try {
      const user = await api.updateProfile({
        interests: this.data.interestsDraft
      });
      const displayUser = createDisplayUser(user);
      this.setData({
        user,
        displayUser,
        interestsEditorVisible: false,
        interestsDraft: [],
        customInterestDraft: "",
        caresList: deriveCaresList(displayUser)
      });
      this._refreshMeCopy();
      syncCustomTabBar("me", false);
      wx.showToast({ title: copy("me.aiName.success"), icon: "success" });
    } catch (error) {
      console.warn("update interests failed", error);
      wx.showToast({ title: copy("me.aiName.failed"), icon: "none" });
    } finally {
      this.setData({ savingInterests: false });
    }
  },
  handleOpenCityEditor() {
    if (!this.data.displayUser || !this.data.displayUser.sessionActive) {
      wx.showToast({ title: copy("me.connectWechatFirst"), icon: "none" });
      return;
    }
    if (this.data.locatingCity) return;
    this.runLocateCity();
  },
  async runLocateCity() {
    if (this.data.locatingCity) return;
    if (!this.data.displayUser || !this.data.displayUser.sessionActive) {
      wx.showToast({ title: copy("me.connectWechatFirst"), icon: "none" });
      return;
    }
    this.setData({ locatingCity: true });
    try {
      const loc = await getLocationOnce();
      const user = await api.resolveLocationCity({
        city: loc.city,
        latitude: loc.latitude,
        longitude: loc.longitude
      });
      const displayUser = createDisplayUser(user);
      this.setData({ user, displayUser });
      wx.showToast({ title: copy("me.city.success", { city: displayUser.currentCity }), icon: "success" });
    } catch (error) {
      console.warn("auto locate city failed", error);
      const msg = getErrorMessage(error);
      const isDenied = msg.includes("auth deny") || msg.includes("拒绝");
      wx.showToast({
        title: isDenied ? copy("me.city.canceled") : copy("me.city.failed"),
        icon: "none",
        duration: 1800
      });
    } finally {
      this.setData({ locatingCity: false });
      this._refreshMeCopy();
    }
  },

  async handleDropCare(event) {
    const tag = event.currentTarget.dataset.tag;
    if (!tag) return;
    const current = (this.data.displayUser && this.data.displayUser.interests) || [];
    const next = current.filter((it) => it !== tag);
    if (next.length === current.length) return;
    try {
      const user = await api.updateProfile({ interests: next });
      const displayUser = createDisplayUser(user);
      this.setData({
        user,
        displayUser,
        caresList: deriveCaresList(displayUser)
      });
      this._refreshMeCopy();
      wx.showToast({ title: copy("me.cares.removed"), icon: "success" });
    } catch (error) {
      console.warn("drop care failed", error);
      wx.showToast({ title: copy("me.interests.failed"), icon: "none" });
    }
  },
  onShareAppMessage() {
    return {
      title: copy("share.me[0]"),
      path: "/pages/chat/index?from=share_me"
    };
  },

  onShareTimeline() {
    return {
      title: copy("share.me[1]"),
      query: "from=share_timeline_me"
    };
  }
});
