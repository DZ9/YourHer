const api = require("./services/api");
const { computeNavigationMetrics } = require("./utils/layout");
const track = require("./utils/track");
const { copy } = require("./utils/copy");
const { markOnboardingCompletedLocal } = require("./utils/onboarding-flag");
const { isBelowMinVersion } = require("./utils/version");
track.installPageHook();
if (wx.canIUse && wx.canIUse("onNeedPrivacyAuthorization") && typeof wx.onNeedPrivacyAuthorization === "function") {
  try {
    wx.onNeedPrivacyAuthorization((resolve) => {
      wx.showModal({
        title: copy("app.privacyModal.title"),
        content: copy("app.privacyModal.content"),
        confirmText: copy("app.privacyModal.confirmText"),
        cancelText: copy("app.privacyModal.cancelText"),
        success: (res) => {
          if (res && res.confirm) {
            resolve({ event: "agree", buttonId: "agree-btn" });
          } else {
            resolve({ event: "disagree" });
          }
        },
        fail: () => {
          resolve({ event: "disagree" });
        }
      });
    });
  } catch (error) {
    console.warn("wx.onNeedPrivacyAuthorization register failed", error && error.message);
  }
}

App({
  globalData: {
    statusBarHeight: 20,
    navMetrics: {
      statusBarHeight: 20,
      topbarContentHeight: 32,
      topbarSideWidth: 112
    },
    version: "0.3.0",
    cloudEnvId: "",
    cloudFunctionName: "",
    currentUser: null,
    sessionReady: false,
    tabPagesPreloadStarted: false,
    tabPagesPreloaded: false,
    fontsLoaded: false,
    fontLoadStarted: false,
    localMockOnly: false,
    cloudbase: null
  },

  onLaunch(options) {
    const launchStartMs = Date.now();
    const navMetrics = computeNavigationMetrics();
    this.globalData.statusBarHeight = navMetrics.statusBarHeight;
    this.globalData.navMetrics = navMetrics;
    try {
      const inviter = options && options.query && options.query.inviter;
      this.globalData.pendingInviter = inviter ? String(inviter).slice(0, 64) : "";
    } catch (_) {
      this.globalData.pendingInviter = "";
    }

    track.init({ appVersion: this.globalData.version });
    track.onAppLaunch(options || {});
    setTimeout(() => {
      try {
        const appLaunchMs = Date.now() - launchStartMs;
        let firstRenderMs;
        if (typeof wx.getPerformance === "function") {
          try {
            const perf = wx.getPerformance();
            const entries = (perf && typeof perf.getEntriesByType === "function")
              ? perf.getEntriesByType("navigation")
              : [];
            const navEntry = entries && entries[0];
            if (navEntry && typeof navEntry.duration === "number") {
              firstRenderMs = Math.round(navEntry.duration);
            }
          } catch (_) {  }
        }
        const scene = (options && options.scene) || undefined;
        const referrerAppId = (options && options.referrerInfo && options.referrerInfo.appId) || undefined;
        track.track("app_launch_perf", {
          firstRenderMs,
          appLaunchMs,
          scene,
          referrerAppId
        });
      } catch (_) {  }
    }, 0);

    this.preloadTabPages();

    this.bootstrapSession()
      .catch((error) => {
        console.warn("bootstrapSession failed", error);
      })
      .finally(() => {
        this.warmShellData();
      });
    this.scheduleFontLoad();
    this.checkForUpdate();
  },
  checkForUpdate() {
    if (!wx.canIUse("getUpdateManager")) {
      wx.showModal({
        title: copy("app.versionTooLow.title"),
        content: copy("app.versionTooLow.content"),
        showCancel: false
      });
      return;
    }

    const updateManager = wx.getUpdateManager();

    updateManager.onCheckForUpdate((res) => {
      console.log("是否有更新:", res && res.hasUpdate);
    });

    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: copy("app.updateReady.title"),
        content: copy("app.updateReady.content"),
        showCancel: false,
        confirmText: copy("app.updateReady.confirmText"),
        confirmColor: "#f53d3d",
        success: (res) => {
          if (res.confirm) {
            updateManager.applyUpdate();
          }
        }
      });
    });

    updateManager.onUpdateFailed(() => {
      wx.showModal({
        title: copy("app.updateFailed.title"),
        content: copy("app.updateFailed.content"),
        showCancel: false
      });
    });
  },
  gateForceUpdate(minClientVersion) {
    if (!isBelowMinVersion(this.globalData.version, minClientVersion)) {
      return false;
    }

    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const current = pages.length ? pages[pages.length - 1] : null;
    if (current && current.route === "pages/force-update/index") {
      return true;
    }

    track.track("force_update_gate", {
      currentVersion: this.globalData.version || "",
      minClientVersion: String(minClientVersion || "")
    });

    wx.reLaunch({
      url: `/pages/force-update/index?min=${encodeURIComponent(minClientVersion)}`,
      fail(error) {
        console.warn("reLaunch force-update failed", error);
      }
    });
    return true;
  },

  onShow(options) {
    track.onAppShow(options || {});
  },

  onHide() {
    track.onAppHide();
  },

  onError(error) {
    track.onAppError(error);
  },

  async bootstrapSession() {
    const code = ""; // Self-hosted device session; no production WeChat login.

    try {
      const user = await api.login({
        code,
        silent: true,
        inviter: this.globalData.pendingInviter || ""
      });
      this.globalData.currentUser = user;
      if (user && user.onboardingCompleted) {
        markOnboardingCompletedLocal();
      }
      this.gateForceUpdate(user && user.minClientVersion);
      track.track("login_success", {
        hasCustomNickname: Boolean(user && user.nickname && user.nickname !== "微信用户"),
        hasPhone: Boolean(user && (user.phoneBound || user.phoneMasked)),
        gender: (user && user.gender) || ""
      });
    } catch (error) {
      track.track("login_failure", {
        reason: String((error && (error.message || error.errMsg)) || error || "").slice(0, 180)
      });
      throw error;
    } finally {
      this.globalData.sessionReady = true;
    }
  },

  warmShellData() {
    api.preloadShellData().catch((error) => {
      console.warn("preloadShellData failed", error);
    });
    setTimeout(() => {
      api.preloadSecondaryData().catch((error) => {
        console.warn("preloadSecondaryData failed", error);
      });
    }, 180);
    this.preloadTabPages();
    this.preloadSubpackages();
  },

  preloadTabPages(attempt = 0) {
    if (
      this.globalData.tabPagesPreloaded ||
      (attempt === 0 && this.globalData.tabPagesPreloadStarted) ||
      typeof wx.preloadPage !== "function"
    ) {
      return;
    }

    this.globalData.tabPagesPreloadStarted = true;

    setTimeout(() => {
      const currentPages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
      const currentPath = currentPages.length ? `/${currentPages[currentPages.length - 1].route}` : "";

      if (!currentPages.length && attempt < 4) {
        this.preloadTabPages(attempt + 1);
        return;
      }

      this.globalData.tabPagesPreloaded = true;
      ["/pages/records/index", "/pages/me/index"]
        .filter((url) => url !== currentPath)
        .forEach((url) => {
          wx.preloadPage({
            url,
            fail(error) {
              console.warn(`preload tab page failed: ${url}`, error);
            }
          });
        });
    }, 300);
  },

  preloadSubpackages() {
    if (typeof wx.preloadSubpackage !== "function") {
      return;
    }

    setTimeout(() => {
      wx.preloadSubpackage({
        name: "subpackages",
        fail(error) {
          console.warn("preload subpackage failed", error);
        }
      });
    }, 180);
  },

  scheduleFontLoad() {
    if (this.globalData.fontLoadStarted) {
      return;
    }

    this.globalData.fontLoadStarted = true;

    setTimeout(() => {
      this.loadFonts();
    }, 600);
  },

  loadFonts() { this.globalData.fontsLoaded = true; }
});
