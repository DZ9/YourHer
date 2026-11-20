
const api = require("../services/api");
const { copy, COPY, copyByTimeOfDay } = require("./copy");
const { isDeepNight } = require("./time");
const { buildA5Presentation } = require("./chat-a5");
function getFirstTouchOpener() {
  return copyByTimeOfDay("chat.firstTouchOpener", isDeepNight() ? "night" : "default");
}
function debugTogglePortrait(ctx) {
  const next = ctx.data.aiGender === "male" ? "female" : "male";
  ctx._commitGender(next);
  wx.showToast({ title: next === "male" ? "立绘：男版" : "立绘：女版", icon: "none" });
}
function debugSimulateNewUser(ctx) {
  if (ctx._debugNewUserMode) {
    wx.reLaunch({ url: "/pages/chat/index" });
    return;
  }
  ctx._debugNewUserMode = true;
  ctx._a5Suppressed = true;
  ctx.fullMessages = [];
  ctx.setData({
    firstTouch: true,
    firstTouchOpener: getFirstTouchOpener(),
    _consentTracked: true,
    consentChecked: true,   // 模拟态预勾，dev 不被同意门禁挡住发送
    messages: [],
    hiddenMessageCount: 0,
    conversationId: "",
    loading: false,
    sending: false,
    inputValue: "",
    a5Tier: "",
    a5Chips: [],
    a5OpenerText: "",
    a5OpenerFooter: "",
    memoryBanner: null,
    nameBanner: null,
    trialCardVisible: true,
    billingState: "trial",
    trialRemaining: 7,
    trialDots: [1, 1, 1, 1, 1, 1, 1],
    trialBadgeExpanded: false,
    surveyVisible: false
  });
  wx.showToast({ title: copy("chat.devNewUserSimulated"), icon: "none", duration: 2000 });
}
function debugCycleA5(ctx) {
  const cycle = ["", "chips", "opener"];
  const cur = ctx.data.a5Tier || "";
  const nextIdx = (cycle.indexOf(cur) + 1) % cycle.length;
  const next = cycle[nextIdx];

  if (!next) {
    ctx.setData({ a5Tier: "", a5Chips: [], a5OpenerText: "", a5OpenerFooter: "" });
    wx.showToast({ title: "A5: off", icon: "none", duration: 800 });
    return;
  }
  const presentation = buildA5Presentation(ctx.fullMessages || [], next);
  ctx.setData({
    a5Tier: next,
    a5Chips: presentation.chips,
    a5OpenerText: presentation.openerText,   // chips 档为 ""（与原 else 分支清空一致）
    a5OpenerFooter: presentation.footerText
  });
  wx.showToast({ title: `A5: ${next}`, icon: "none", duration: 800 });
}
function debugToggleA5Suppress(ctx) {
  ctx._a5Suppressed = !ctx._a5Suppressed;
  ctx._a5Computed = false;
  ctx.setData({
    a5Tier: "",
    a5Chips: [],
    a5OpenerText: "",
    a5OpenerFooter: "",
    a5DebugSuppress: ctx._a5Suppressed
  });
  ctx._maybeShowA5();
  const tier = ctx.data.a5Tier || "off";
  wx.showToast({
    title: `suppress=${ctx._a5Suppressed ? "on" : "off"} → A5: ${tier}`,
    icon: "none",
    duration: 1500
  });
}
function debugPreviewPaywall(ctx) {
  ctx.setData({ paywallVisible: true, trialBadgeExpanded: false });
}
function debugPreviewSurvey(ctx) {
  ctx._surveyDismissed = false;
  ctx.setData({ surveyVisible: true, paywallVisible: false });
}
function debugFunnelAdvance(ctx) {
  const steps = ["off", "gender", "giftcard", "firsttouch", "trial", "survey", "refill", "paywall", "subscribed"];
  const labels = {
    off: "关闭", gender: "1·选性别", giftcard: "2·赠卡(获7天)", firsttouch: "3·首触三件套",
    trial: "4·体验中(7天)", survey: "5·问卷(用尽)", refill: "6·问卷后+7天",
    paywall: "7·付费墙(9.9/58)", subscribed: "8·付费墙之后(已开通)"
  };
  const idx = ((ctx._debugFunnelIdx || 0) + 1) % steps.length;
  ctx._debugFunnelIdx = idx;
  const step = steps[idx];
  if (step === "off") {
    ctx._debugFunnelIdx = 0;
    wx.reLaunch({ url: "/pages/chat/index" });
    return;
  }
  ctx._debugNewUserMode = true;
  ctx._a5Suppressed = true;
  ctx._consentTracked = true;
  ctx._surveyDismissed = false;
  ctx._paywallDismissed = false;
  ctx._genderResolved = false;
  ctx.fullMessages = [];
  const sevenDots = [1, 1, 1, 1, 1, 1, 1];
  const badge7 = copy("chat.paywall.badge", { count: 7 });
  const base = {
    _consentTracked: true, consentChecked: true,
    messages: [], hiddenMessageCount: 0, conversationId: "",
    loading: false, sending: false, inputValue: "",
    a5Tier: "", a5Chips: [], memoryBanner: null, nameBanner: null,
    firstTouch: false, genderSheetVisible: false, trialCardVisible: false,
    surveyVisible: false, paywallVisible: false, paywallProactive: false,
    debugFunnelLabel: labels[step]
  };
  const per = {
    gender:     { firstTouch: true, firstTouchOpener: getFirstTouchOpener(), genderSheetVisible: true, genderPick: "", genderConfirmText: COPY.chat.genderSelect.confirmIdle, billingState: "trial", trialRemaining: 7, trialDots: sevenDots },
    firsttouch: { firstTouch: true, firstTouchOpener: getFirstTouchOpener(), billingState: "trial", trialRemaining: 7, trialDots: sevenDots },
    giftcard:   { trialCardVisible: true, billingState: "trial", trialRemaining: 7, trialDots: sevenDots, trialBadgeText: badge7 },
    trial:      { billingState: "trial", trialRemaining: 7, trialDots: sevenDots, trialBadgeText: badge7, trialBadgeExpanded: true },
    survey:     { billingState: "survey_invite", surveyVisible: true, trialRemaining: 0, trialDots: [], surveyDone: false },
    refill:     { billingState: "trial", trialRemaining: 7, trialDots: sevenDots, trialBadgeText: badge7, surveyDone: true },
    paywall:    { billingState: "paywall", paywallVisible: true, surveyDone: true, trialRemaining: 0, trialDots: [] },
    subscribed: { billingState: "subscribed", trialCardVisible: false }
  };
  ctx.setData(Object.assign(base, per[step] || {}));
  if (step === "subscribed") wx.showToast({ title: "模拟已开通（dev）", icon: "none", duration: 1500 });
}
function debugSandboxPay() {}

module.exports = {
  debugTogglePortrait,
  debugSimulateNewUser,
  debugCycleA5,
  debugToggleA5Suppress,
  debugPreviewPaywall,
  debugPreviewSurvey,
  debugFunnelAdvance,
  debugSandboxPay
};
