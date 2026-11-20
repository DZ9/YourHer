
const {
  CHECKIN_OPTIONS,
  MOOD_PROMPTS,
  MOOD_FIRST_PERSON
} = require("./copy");
const CHECKIN_PIN_KEY = "home-mood-checkin-pin";

function todayDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMoodPromptKey() {
  const h = new Date().getHours();
  if (h < 11) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function pinTodayCheckin() {
  try {
    wx.setStorageSync(CHECKIN_PIN_KEY, todayDateKey());
  } catch (error) {
    console.warn("pin checkin failed", error);
  }
}

function isPinnedForToday() {
  try {
    return wx.getStorageSync(CHECKIN_PIN_KEY) === todayDateKey();
  } catch (error) {
    return false;
  }
}
function hasCheckinToday(recentCheckins) {
  const items = (recentCheckins && recentCheckins.items) || [];
  const key = todayDateKey();
  return items.some((c) => c && c.date === key);
}

module.exports = {
  CHECKIN_PIN_KEY,
  CHECKIN_OPTIONS,
  MOOD_PROMPTS,
  MOOD_FIRST_PERSON,
  todayDateKey,
  getMoodPromptKey,
  pinTodayCheckin,
  isPinnedForToday,
  hasCheckinToday
};
