const voice = require("./voice");
const { copy } = require("./copy");

const VOICE_CANCEL_THRESHOLD_PX = 60;

function handleSendOrVoiceTap(ctx) {
  if (ctx._voiceTriggered) {
    ctx._voiceTriggered = false;
    return;
  }
  if (ctx.data.inputValue && !ctx.data.sending) {
    ctx.handleStreamingSend();
    return;
  }
  if (ctx.data.voiceRecording) return;
  wx.showToast({ title: copy("voice.holdToSpeak"), icon: "none", duration: 1200 });
}

function handleVoiceTouchStart(ctx, event) {
  ctx._voiceTriggered = false;
  if (ctx.data.sending || ctx.data.voiceRecording) return;
  if (ctx.data.inputValue) return;

  const touch =
    (event && event.touches && event.touches[0]) ||
    (event && event.changedTouches && event.changedTouches[0]);
  ctx._voiceStartY = touch ? touch.clientY : 0;
  ctx._voiceShouldCancel = false;
  ctx._voicePressActive = true;

  if (ctx._voicePressTimer) clearTimeout(ctx._voicePressTimer);
  ctx._voicePressTimer = setTimeout(() => {
    ctx._voicePressTimer = null;
    if (!ctx._voicePressActive) return;
    beginVoiceRecord(ctx);
  }, 180);
}

function beginVoiceRecord(ctx) {
  ctx._voiceTriggered = true;

  if (!voice.isAvailable()) {
    ctx._voicePressActive = false;
    wx.showModal({
      title: copy("voice.notInstalled"),
      content: copy("voice.pluginMissing"),
      showCancel: false
    });
    return;
  }

  ctx.setData({
    voiceRecording: true,
    voicePartial: "",
    voiceCancelArmed: false
  });
  wx.vibrateShort && wx.vibrateShort({ type: "light" });

  voice
    .ensureAuth()
    .then(() => {
      if (ctx._isUnmounted) return;
      if (!ctx._voicePressActive) {
        ctx.setData({
          voiceRecording: false,
          voicePartial: "",
          voiceCancelArmed: false
        });
        wx.showToast({ title: copy("voice.micReady"), icon: "none" });
        return;
      }
      ctx._voiceRecordPromise = voice
        .record({
          onPartial: (text) => {
            if (ctx._isUnmounted || !ctx.data.voiceRecording) return;
            ctx.setData({ voicePartial: text || "" });
          }
        })
        .then((finalText) => {
          if (ctx._isUnmounted) return;
          handleVoiceFinish(ctx, finalText);
        })
        .catch((error) => {
          if (ctx._isUnmounted) return;
          console.warn("[chat-voice] record error:", error && error.message);
          ctx.setData({
            voiceRecording: false,
            voicePartial: "",
            voiceCancelArmed: false
          });
          const msg = (error && error.code === "PLUGIN_UNAVAILABLE")
            ? copy("voice.pluginNotEnabled")
            : copy("voice.notClear");
          wx.showToast({ title: msg, icon: "none" });
        });
    })
    .catch((error) => {
      if (ctx._isUnmounted) return;
      console.warn("[chat-voice] mic auth denied:", error && error.message);
      ctx.setData({
        voiceRecording: false,
        voicePartial: "",
        voiceCancelArmed: false
      });
    });
}

function handleVoiceTouchMove(ctx, event) {
  if (!ctx.data.voiceRecording) return;
  const touch =
    (event && event.touches && event.touches[0]) ||
    (event && event.changedTouches && event.changedTouches[0]);
  if (!touch) return;
  const dy = (ctx._voiceStartY || 0) - touch.clientY;
  const armed = dy > VOICE_CANCEL_THRESHOLD_PX;
  if (armed !== ctx.data.voiceCancelArmed) {
    ctx.setData({ voiceCancelArmed: armed });
  }
}

function handleVoiceTouchEnd(ctx) {
  ctx._voicePressActive = false;
  if (ctx._voicePressTimer) {
    clearTimeout(ctx._voicePressTimer);
    ctx._voicePressTimer = null;
  }
  if (!ctx.data.voiceRecording) return;
  ctx._voiceShouldCancel = ctx.data.voiceCancelArmed;
  voice.stop();
  ctx.setData({
    voiceRecording: false,
    voiceCancelArmed: false
  });
}

function handleVoiceTouchCancel(ctx) {
  ctx._voicePressActive = false;
  if (ctx._voicePressTimer) {
    clearTimeout(ctx._voicePressTimer);
    ctx._voicePressTimer = null;
  }
  if (!ctx.data.voiceRecording) return;
  ctx._voiceShouldCancel = true;
  voice.cancel();
  ctx.setData({
    voiceRecording: false,
    voiceCancelArmed: false,
    voicePartial: ""
  });
}

function handleVoiceFinish(ctx, finalText) {
  const cancelled = ctx._voiceShouldCancel;
  ctx._voiceShouldCancel = false;
  ctx.setData({
    voiceRecording: false,
    voiceCancelArmed: false,
    voicePartial: ""
  });

  if (cancelled) return;

  const text = String(finalText || "").trim();
  if (!text) {
    wx.showToast({ title: copy("voice.notClearRetry"), icon: "none" });
    return;
  }

  ctx.setData({ inputValue: text });
  ctx.handleStreamingSend();
}

function cleanupOnUnload(ctx) {
  if (ctx.data.voiceRecording) {
    ctx._voiceShouldCancel = true;
    voice.cancel();
  }
  if (ctx._voicePressTimer) {
    clearTimeout(ctx._voicePressTimer);
    ctx._voicePressTimer = null;
  }
}

module.exports = {
  handleSendOrVoiceTap,
  handleVoiceTouchStart,
  handleVoiceTouchMove,
  handleVoiceTouchEnd,
  handleVoiceTouchCancel,
  cleanupOnUnload,
  _beginVoiceRecord: beginVoiceRecord,
  _handleVoiceFinish: handleVoiceFinish
};
