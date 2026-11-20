const { getNavigationLayout } = require("../../utils/layout");
const { copy, COPY } = require("../../utils/copy");

Page({
  data: {
    copy: COPY,
    statusBarHeight: 20,
    topbarContentHeight: 32,
    topbarSideWidth: 112,
    activeType: "privacy" // 'agreement' | 'privacy'
  },

  onLoad(options) {
    this.setData(getNavigationLayout());
    const type = options && options.type === "agreement" ? "agreement" : "privacy";
    this.setData({ activeType: type });
  },
  handleSwitchType(event) {
    const target = event.currentTarget.dataset.type;
    if (target !== "agreement" && target !== "privacy") return;
    if (target === this.data.activeType) return;
    this.setData({ activeType: target });
  },
  handleAgree() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: "/pages/chat/index" });
      }
    });
  },
  handleBack() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: "/pages/chat/index" });
      }
    });
  }
});
