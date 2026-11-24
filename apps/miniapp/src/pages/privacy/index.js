const { getNavigationLayout } = require("../../utils/layout");
const { getTimeOfDay } = require("../../utils/time");
const { safeBack } = require("../../utils/nav");

Page({
  data: { timeOfDay: "noon" },
  onLoad() { this.setData(getNavigationLayout()); },
  onShow() { this.setData({ timeOfDay: getTimeOfDay() }); },
  handleBack() { safeBack("/pages/chat/index"); }
});
