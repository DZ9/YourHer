const { getTimeOfDay } = require("../../utils/time");
const { copy, COPY } = require("../../utils/copy");

Page({
  data: {
    copy: COPY,
    timeOfDay: "noon",
    currentVersion: "",
    minVersion: "",
    applying: false,
    showFallback: false
  },

  onShow() { this.setData({ timeOfDay: getTimeOfDay() }); },
  onLoad(options) {
    const app = getApp();
    this.setData({
      currentVersion: (app && app.globalData && app.globalData.version) || "",
      minVersion: (options && options.min) || ""
    });

    if (!wx.canIUse("getUpdateManager")) {
      this.setData({ showFallback: true });
      return;
    }

    this.updateManager = wx.getUpdateManager();
    this.updateManager.onUpdateReady(() => {
      this.updateReady = true;
    });

    this.updateManager.onUpdateFailed(() => {
      this.setData({ showFallback: true });
    });
  },
  onUnload() {
  },

  handleApply() {
    if (this.data.applying) return;

    if (this.updateManager && (this.updateReady || typeof this.updateManager.applyUpdate === "function")) {
      this.setData({ applying: true });
      try {
        this.updateManager.applyUpdate();
      } catch (error) {
        console.warn("applyUpdate failed", error);
      }
      setTimeout(() => {
        this.setData({ applying: false, showFallback: true });
      }, 1200);
      return;
    }

    this.setData({ showFallback: true });
  }
});
