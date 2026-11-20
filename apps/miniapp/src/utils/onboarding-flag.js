
const STORAGE_KEY = "onboarding:completed";

function isOnboardingCompletedLocal() {
  try {
    return wx.getStorageSync(STORAGE_KEY) === true;
  } catch (error) {
    return false;
  }
}

function markOnboardingCompletedLocal() {
  try {
    wx.setStorageSync(STORAGE_KEY, true);
  } catch (error) {
    console.warn("mark onboarding completed failed", error);
  }
}

function clearOnboardingCompletedLocal() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (error) {
    console.warn("clear onboarding completed failed", error);
  }
}

module.exports = {
  isOnboardingCompletedLocal,
  markOnboardingCompletedLocal,
  clearOnboardingCompletedLocal
};
