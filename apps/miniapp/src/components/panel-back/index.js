const { copy } = require("../../utils/copy");

Component({
  options: {
    addGlobalClass: true
  },
  properties: {
    timeOfDay: { type: String, value: "day" },
    label: { type: String, value: copy("panels.panelBack.label") }
  },
  methods: {
    onTap() {
      this.triggerEvent("tap");
    }
  }
});
