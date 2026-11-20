const api = require("../services/api");
const CHAT_PATH = "/pages/chat/index";

function syncCustomTabBar() {
}

function switchRoot(path) {
  const currentPages = getCurrentPages();
  const currentRoute = currentPages.length ? `/${currentPages[currentPages.length - 1].route}` : "";

  if (currentRoute === path) {
    return;
  }

  wx.navigateTo({
    url: path,
    fail() {
      wx.redirectTo({ url: path });
    }
  });
}

function safeBack(fallbackPath) {
  const currentPages = getCurrentPages();

  if (currentPages.length > 1) {
    wx.navigateBack({ delta: 1 });
    return;
  }

  if (fallbackPath) {
    wx.reLaunch({ url: fallbackPath });
    return;
  }

  wx.reLaunch({ url: CHAT_PATH });
}

function backToDesk() {
  safeBack(CHAT_PATH);
}

function openConversation(conversationId, extra = {}) {
  if (conversationId && api && typeof api.preloadConversation === "function") {
    api.preloadConversation(conversationId).catch((error) => {
      console.warn("preload conversation failed", error);
    });
  }

  const query = [];

  if (conversationId) {
    query.push(`conversationId=${conversationId}`);
  }

  Object.keys(extra).forEach((key) => {
    if (extra[key] !== undefined && extra[key] !== null && extra[key] !== "") {
      query.push(`${key}=${encodeURIComponent(String(extra[key]))}`);
    }
  });

  wx.navigateTo({
    url: `/pages/chat/index${query.length ? `?${query.join("&")}` : ""}`
  });
}

module.exports = {
  openConversation,
  safeBack,
  backToDesk,
  syncCustomTabBar,
  switchRoot
};
