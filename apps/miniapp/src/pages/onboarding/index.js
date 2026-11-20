const api = require("../../services/api");
const track = require("../../utils/track");
const { getNavigationLayout } = require("../../utils/layout");
const { WEEKLY_NOTE_PUSH_TEMPLATE_ID } = require("../../utils/subscriptions");
const { markOnboardingCompletedLocal } = require("../../utils/onboarding-flag");

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

const STEPS = ["hello", "chair", "name", "setTable"];
const AI_NAME_SUGGESTIONS = ["林夕", "夕夕", "小林"];
const NICKNAME_SUGGESTIONS = ["小满", "小朋友", "随便起"];
const RANDOM_NICKNAMES = ["阿亮", "小南", "一禾", "默"];

function getInitial(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "夕";
  return trimmed.slice(-1);
}

Page({
  data: {
    statusBarHeight: 20,
    topbarContentHeight: 32,
    topbarSideWidth: 112,
    stepIndex: 0,
    stepKey: STEPS[0],
    stepTotal: STEPS.length,

    aiName: "",
    nickname: "",
    aiNameSuggestions: AI_NAME_SUGGESTIONS,
    nicknameSuggestions: NICKNAME_SUGGESTIONS,
    aiNameInitial: "夕",
    namesReady: false,

    setPhase: 0,

    submitting: false
  },

  onLoad(options) {
    this.setData(getNavigationLayout());
    this._previewMode = options && options.preview === "1";
    if (!this._previewMode) {
      this.bounceIfAlreadyOnboarded();
    }
  },

  onUnload() {
    this.clearSetTimers();
  },

  async bounceIfAlreadyOnboarded() {
    const cached = api.peekMe && api.peekMe();
    if (this.maybeBounceToHome(cached)) return;
    await waitForSessionReady();
    const user = api.peekMe && api.peekMe();
    this.maybeBounceToHome(user);
  },

  maybeBounceToHome(user) {
    if (!user || !user.onboardingCompleted) return false;
    markOnboardingCompletedLocal();
    wx.reLaunch({ url: "/pages/home/index" });
    return true;
  },

  goStep(nextIndex) {
    if (nextIndex < 0 || nextIndex >= STEPS.length) return;
    const stepKey = STEPS[nextIndex];
    this.setData({ stepIndex: nextIndex, stepKey });

    if (stepKey === "setTable") {
      this.startSetTablePhase();
    } else {
      this.clearSetTimers();
    }
  },

  clearSetTimers() {
    if (!this.setTimers) return;
    this.setTimers.forEach((t) => clearTimeout(t));
    this.setTimers = null;
  },

  startSetTablePhase() {
    this.clearSetTimers();
    this.setData({ setPhase: 0 });
    this.setTimers = [
      setTimeout(() => this.setData({ setPhase: 1 }), 600),
      setTimeout(() => this.setData({ setPhase: 2 }), 1300),
      setTimeout(() => this.setData({ setPhase: 3 }), 2100),
      setTimeout(() => this.setData({ setPhase: 4 }), 2900)
    ];
  },

  handleNext() {
    this.goStep(this.data.stepIndex + 1);
  },

  handleAiNameInput(event) {
    const value = String(event.detail.value || "").slice(0, 6);
    this.setData({
      aiName: value,
      aiNameInitial: getInitial(value || "夕"),
      namesReady: Boolean(value.trim() && this.data.nickname.trim())
    });
  },

  handleNicknameInput(event) {
    const value = String(event.detail.value || "").slice(0, 6);
    this.setData({
      nickname: value,
      namesReady: Boolean(this.data.aiName.trim() && value.trim())
    });
  },

  handlePickAiName(event) {
    const { name } = event.currentTarget.dataset;
    if (typeof name !== "string") return;
    this.setData({
      aiName: name,
      aiNameInitial: getInitial(name),
      namesReady: Boolean(name.trim() && this.data.nickname.trim())
    });
  },

  handlePickNickname(event) {
    const { name } = event.currentTarget.dataset;
    if (typeof name !== "string") return;
    const value = name === "随便起"
      ? RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)]
      : name;
    this.setData({
      nickname: value,
      namesReady: Boolean(this.data.aiName.trim() && value.trim())
    });
  },

  handleNameSubmit() {
    if (!this.data.namesReady) {
      wx.showToast({ title: "两张牌都立起来", icon: "none" });
      return;
    }
    this.handleNext();
  },

  requestProactiveSubscription() {
    if (!WEEKLY_NOTE_PUSH_TEMPLATE_ID) return Promise.resolve();
    return new Promise((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds: [WEEKLY_NOTE_PUSH_TEMPLATE_ID],
        success: () => resolve(),
        fail: (error) => {
          console.warn("requestSubscribeMessage failed", error);
          resolve();
        }
      });
    });
  },

  async handleFinish() {
    if (this.data.submitting) return;
    if (this.data.setPhase < 4) return;
    if (this._previewMode) {
      wx.showToast({ title: "预览结束", icon: "none", duration: 1200 });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.reLaunch({ url: "/pages/home/index" })
        });
      }, 1200);
      return;
    }

    this.setData({ submitting: true });

    const startedAt = Date.now();
    const nickname = String(this.data.nickname || "").trim();
    const aiName = String(this.data.aiName || "").trim();

    try {
      await api.completeOnboarding({
        nickname,
        aiName,
        companionPreference: "gentle"
      });
      markOnboardingCompletedLocal();

      track.track("onboarding_complete", {
        durationMs: Date.now() - startedAt,
        hasNickname: Boolean(nickname),
        hasAiName: Boolean(aiName),
        stepCount: this.data.stepTotal
      });

      await this.requestProactiveSubscription();

      wx.reLaunch({ url: "/pages/home/index" });
    } catch (error) {
      console.warn("completeOnboarding failed", error);
      track.track("runtime_error", {
        source: "onboarding_complete",
        message: String((error && (error.message || error.errMsg)) || error || "").slice(0, 180)
      });
      wx.showToast({ title: "保存失败，再试一次", icon: "none" });
      this.setData({ submitting: false });
    }
  }
});
