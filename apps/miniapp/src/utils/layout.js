function rpxToPx(windowWidth, rpx) {
  return Math.round((windowWidth * rpx) / 750);
}

function getFallbackMetrics() {
  return {
    statusBarHeight: 20,
    topbarContentHeight: 32,
    topbarSideWidth: 112
  };
}

function getNavigationLayout() {
  const app = getApp();
  const metrics = app && app.globalData && app.globalData.navMetrics;

  if (metrics) {
    return {
      statusBarHeight: metrics.statusBarHeight,
      topbarContentHeight: metrics.topbarContentHeight,
      topbarSideWidth: metrics.topbarSideWidth
    };
  }

  return getFallbackMetrics();
}

function computeNavigationMetrics() {
  let systemInfo;

  try {
    systemInfo =
      typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
  } catch (error) {
    return getFallbackMetrics();
  }

  const statusBarHeight = systemInfo.statusBarHeight || 20;
  const windowWidth = systemInfo.windowWidth || 375;
  const menuButton =
    typeof wx.getMenuButtonBoundingClientRect === "function"
      ? wx.getMenuButtonBoundingClientRect()
      : null;

  if (!menuButton || !menuButton.width) {
    return {
      statusBarHeight,
      topbarContentHeight: 32,
      topbarSideWidth: 112
    };
  }

  const edgeGap = Math.max(windowWidth - menuButton.right, 0);
  const topbarSideWidth = Math.max(
    Math.round(windowWidth - menuButton.left + edgeGap),
    menuButton.width + edgeGap * 2,
    112
  );

  return {
    statusBarHeight,
    topbarContentHeight: Math.max(Math.round(menuButton.height), 32),
    topbarSideWidth: Math.max(topbarSideWidth, rpxToPx(windowWidth, 168))
  };
}

module.exports = {
  computeNavigationMetrics,
  getNavigationLayout
};
