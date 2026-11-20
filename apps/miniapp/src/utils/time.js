
const { copy, copyByTimeOfDay } = require("./copy");
const LEGACY_DEV_TIME_OVERRIDE_KEY = "chatnpc:dev-time-override";
try {
  wx.removeStorageSync(LEGACY_DEV_TIME_OVERRIDE_KEY);
} catch (_) {  }
const NIGHT_MODE_OVERRIDE_KEY = "chatnpc:night-mode-override";

function getAutoTimeOfDay(date) {
  const h = (date || new Date()).getHours();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 22 || h < 5) return "night";
  return "noon";
}

function getNightModeOverride() {
  try {
    const o = wx.getStorageSync(NIGHT_MODE_OVERRIDE_KEY);
    if (o === "night" || o === "day") return o;
  } catch (_) {  }
  return "";
}

function setNightModeOverride(value) {
  try {
    if (value === "night" || value === "day") {
      wx.setStorageSync(NIGHT_MODE_OVERRIDE_KEY, value);
    } else {
      wx.removeStorageSync(NIGHT_MODE_OVERRIDE_KEY);
    }
  } catch (_) {  }
}

function getTimeOfDay(date) {
  const auto = getAutoTimeOfDay(date);
  const override = getNightModeOverride();

  if (!override) return auto;
  if (override === "night" && auto === "night") {
    setNightModeOverride("");
    return auto;
  }
  if (override === "day" && auto !== "night") {
    setNightModeOverride("");
    return auto;
  }
  if (override === "night") return "night";
  return "noon";
}
function isNightMode(date) {
  return getTimeOfDay(date) === "night";
}
function isDeepNight(date) {
  const h = (date || new Date()).getHours();
  return h >= 23 || h < 5;
}

function getWhisperByState(state, timeOfDay) {
  if (state === "thinking") return copy("whisper.thinking");
  if (state === "speaking") return copy("whisper.speaking");
  if (state === "listening") return copy("whisper.listening");
  if (state === "tapped") return copy("whisper.tapped");
  return copyByTimeOfDay("whisper.idle", timeOfDay);
}
function broadcastTimeOfDayChange() {
  if (typeof getCurrentPages !== "function") return;
  const pages = getCurrentPages() || [];
  const timeOfDay = getTimeOfDay();
  pages.forEach((p) => {
    if (!p || !p.data) return;
    if (p.data.timeOfDay === undefined) return;
    const patch = {};
    if (p.data.timeOfDay !== timeOfDay) patch.timeOfDay = timeOfDay;
    if (p.data.nightModeOn !== undefined && p.data.nightModeOn !== (timeOfDay === "night")) {
      patch.nightModeOn = timeOfDay === "night";
    }
    if (p.data.starSeeds !== undefined && typeof p._buildStarSeeds === "function") {
      patch.starSeeds = timeOfDay === "night" ? p._buildStarSeeds() : [];
    }
    if (!Object.keys(patch).length) return;
    try { p.setData(patch); } catch (_) {  }
  });
}

module.exports = {
  getTimeOfDay,
  getWhisperByState,
  isNightMode,
  isDeepNight,
  setNightModeOverride,
  getNightModeOverride,
  broadcastTimeOfDayChange
};
