const api = require("../../services/api");
const track = require("../../utils/track");
const { copy, COPY } = require("../../utils/copy");
const { safeBack } = require("../../utils/nav");
const { getNavigationLayout } = require("../../utils/layout");
const { getTimeOfDay } = require("../../utils/time");

const FEEDBACK_TYPES = [
  { value: "experience", label: "体验建议" },
  { value: "feature", label: "功能问题" },
  { value: "content", label: "内容不合适" },
  { value: "other", label: "其他" }
];

function chooseImage() {
  return new Promise((resolve, reject) => {
    if (typeof wx.chooseMedia === "function") {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        success: (result) => resolve(result.tempFiles || []),
        fail: reject
      });
      return;
    }

    wx.chooseImage({
      count: 1,
      success: (result) =>
        resolve((result.tempFilePaths || []).map((item) => ({ tempFilePath: item }))),
      fail: reject
    });
  });
}

Page({
  data: {
    copy: COPY,
    statusBarHeight: 20,
    topbarContentHeight: 32,
    topbarSideWidth: 112,
    timeOfDay: getTimeOfDay(),
    feedbackTypes: [],
    selectedType: "experience",
    content: "",
    attachments: [],
    attachmentPreview: "",
    submitting: false,
    recentTraceIds: [],
    selectedTraceIds: {}  // { [traceId]: true } 选中态字典
  },

  onLoad() {
    const recentTraceIds = (typeof track.getRecentTraceIds === "function")
      ? track.getRecentTraceIds(5)
      : [];
    this.setData({
      ...getNavigationLayout(),
      timeOfDay: getTimeOfDay(),
      feedbackTypes: FEEDBACK_TYPES,
      selectedType: FEEDBACK_TYPES[0].value,
      recentTraceIds: recentTraceIds.map((t) => ({ id: t, short: t.slice(0, 8) }))
    });
  },
  handleTraceIdToggle(event) {
    const tid = (event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id) || "";
    if (!tid) return;
    const next = Object.assign({}, this.data.selectedTraceIds);
    if (next[tid]) {
      delete next[tid];
    } else {
      next[tid] = true;
    }
    this.setData({ selectedTraceIds: next });
  },

  onShow() {
    const timeOfDay = getTimeOfDay();
    if (timeOfDay !== this.data.timeOfDay) {
      this.setData({ timeOfDay });
    }
  },

  handleBack() {
    safeBack("/pages/chat/index");
  },

  handleSelectType(event) {
    const { value } = event.currentTarget.dataset;
    this.setData({
      selectedType: value
    });
  },

  handleContentInput(event) {
    this.setData({
      content: event.detail.value
    });
  },

  async handleChooseImage() {
    try {
      const attachments = await chooseImage();
      this.setData({
        attachments,
        attachmentPreview: attachments[0] ? attachments[0].tempFilePath || attachments[0] : ""
      });
    } catch (error) {
      if (error && error.errMsg && error.errMsg.includes("cancel")) {
        return;
      }

      console.warn("chooseImage failed", error);
      wx.showToast({
        title: "添加截图失败",
        icon: "none"
      });
    }
  },

  async handleSubmit() {
    const content = (this.data.content || "").trim();

    if (!content || this.data.submitting) {
      return;
    }

    this.setData({
      submitting: true
    });
    const selectedTraceIds = Object.keys(this.data.selectedTraceIds || {})
      .filter((k) => this.data.selectedTraceIds[k])
      .slice(0, 10);

    try {
      let attachment = null;
      if (this.data.attachmentPreview) {
        const base64 = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({filePath: this.data.attachmentPreview, encoding: 'base64', success: r => resolve(r.data), fail: reject}));
        if (base64.length > 1400000) throw new Error('截图须小于 1 MB');
        const type = /\.png(?:$|\?)/i.test(this.data.attachmentPreview) ? 'png' : /\.webp(?:$|\?)/i.test(this.data.attachmentPreview) ? 'webp' : 'jpeg';
        attachment = 'data:image/' + type + ';base64,' + base64;
      }
      await api.submitFeedback({
        attachment,
        type: this.data.selectedType,
        content,
        contact: "",
        recentTraceIds: selectedTraceIds
      });

      track.track("feedback_submit", {
        type: this.data.selectedType,
        contentLength: content.length,
        hasAttachment: (this.data.attachments || []).length > 0,
        traceIdCount: selectedTraceIds.length
      });

      wx.showToast({
        title: "反馈已收到",
        icon: "success"
      });

      this.setData({
        content: "",
        attachments: [],
        attachmentPreview: ""
      });
    } catch (e) {
      wx.showToast({title: e.message || "提交失败", icon: "none"});
    } finally {
      this.setData({
        submitting: false
      });
    }
  }
});
