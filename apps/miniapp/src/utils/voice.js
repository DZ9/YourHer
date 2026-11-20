
const { copy } = require("./copy");

const PLUGIN_NAME = "WechatSI";

let pluginRef = null;
let pluginLoadAttempted = false;
let managerRef = null;
let scopeRecordAuthed = false;

function loadPlugin() {
  if (!require("../config").voicePlugin) return null;
  if (pluginLoadAttempted) return pluginRef;
  pluginLoadAttempted = true;
  try {
    pluginRef = requirePlugin(PLUGIN_NAME);
  } catch (error) {
    console.warn("[voice] requirePlugin failed:", error && error.message);
    pluginRef = null;
  }
  return pluginRef;
}

function getManager() {
  if (managerRef) return managerRef;
  const plugin = loadPlugin();
  if (!plugin || typeof plugin.getRecordRecognitionManager !== "function") {
    return null;
  }
  managerRef = plugin.getRecordRecognitionManager();
  return managerRef;
}

function isAvailable() {
  return Boolean(getManager());
}
function record({ onStart, onPartial, lang = "zh_CN", duration = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const manager = getManager();
    if (!manager) {
      const err = new Error("voice plugin unavailable");
      err.code = "PLUGIN_UNAVAILABLE";
      reject(err);
      return;
    }

    let settled = false;
    const finish = (fn, payload) => {
      if (settled) return;
      settled = true;
      manager.onStart = null;
      manager.onRecognize = null;
      manager.onStop = null;
      manager.onError = null;
      fn(payload);
    };

    manager.onStart = (res) => {
      if (typeof onStart === "function") {
        try { onStart(res); } catch (_) {  }
      }
    };

    manager.onRecognize = (res) => {
      if (typeof onPartial === "function" && res && res.result) {
        try { onPartial(res.result); } catch (_) {  }
      }
    };

    manager.onStop = (res) => {
      const text = (res && res.result) || "";
      finish(resolve, text);
    };

    manager.onError = (err) => {
      const wrapped = new Error((err && err.msg) || "voice recognize error");
      wrapped.code = (err && err.retcode) || "VOICE_ERROR";
      wrapped.original = err;
      finish(reject, wrapped);
    };

    try {
      manager.start({ duration, lang });
    } catch (error) {
      finish(reject, error);
    }
  });
}

function stop() {
  const manager = getManager();
  if (manager && typeof manager.stop === "function") {
    try { manager.stop(); } catch (_) {  }
  }
}
function cancel() {
  stop();
}
function ensureAuth() {
  if (scopeRecordAuthed) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    wx.getSetting({
      success: (res) => {
        if (res.authSetting["scope.record"] === true) {
          scopeRecordAuthed = true;
          resolve(true);
          return;
        }
        if (res.authSetting["scope.record"] === false) {
          wx.showModal({
            title: copy("voice.authModal.title"),
            content: copy("voice.authModal.content"),
            confirmText: "去开启",
            success: (modalRes) => {
              if (!modalRes.confirm) {
                reject(new Error("user denied mic auth"));
                return;
              }
              wx.openSetting({
                success: (settingRes) => {
                  if (settingRes.authSetting["scope.record"]) {
                    scopeRecordAuthed = true;
                    resolve(true);
                  } else {
                    reject(new Error("mic auth still denied"));
                  }
                },
                fail: reject
              });
            }
          });
          return;
        }
        wx.authorize({
          scope: "scope.record",
          success: () => {
            scopeRecordAuthed = true;
            resolve(true);
          },
          fail: (err) => reject(err)
        });
      },
      fail: reject
    });
  });
}

module.exports = {
  isAvailable,
  ensureAuth,
  record,
  stop,
  cancel
};
