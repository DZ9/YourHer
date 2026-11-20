const { COPY, syncGenderedCopy } = require("../../utils/copy");

Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    timeOfDay: { type: String, value: "day" }, // day | night
    active: { type: String, value: "" }, // 当前页 key：mood | letters | memory | about | ""(聊天页)
    unread: { type: Boolean, value: false }, // 「信」未读红点
    statusBarHeight: { type: Number, value: 20 },
    topbarContentHeight: { type: Number, value: 32 },
    topbarSideWidth: { type: Number, value: 112 },
    hintVisible: { type: Boolean, value: false } // 首次一次性提示（父页据本地标记下发）
  },

  data: {
    copy: COPY,
    open: false
  },

  lifetimes: {
    attached() {
      syncGenderedCopy(this);
    }
  },

  methods: {
    toggleOpen() {
      const next = !this.data.open;
      this.setData({ open: next });
      if (next && this.properties.hintVisible) {
        this.triggerEvent("hintdismiss");
      }
    },

    handleTap(event) {
      const key = event.currentTarget.dataset.key;
      if (!key) {
        return;
      }
      this.triggerEvent("nav", { key });
    },

    dismissHint() {
      this.triggerEvent("hintdismiss");
    }
  }
});
