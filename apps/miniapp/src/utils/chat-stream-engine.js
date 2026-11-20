const api = require("../services/api");
const track = require("./track");
const { copy } = require("./copy");
const pendingFinalize = require("./pending-finalize");
const {
  MARKER_DETECT_REGEX,
  MARKER_CLEAN_REGEX,
  processAssistantForUI,
  sanitizeCandidates,
  parseCandidatesFromMarker
} = require("./chat-candidates");
const {
  appendTraceIdHint,
  getStreamingFailureText,
  getVisibleMessages,
  getMessageDate,
  decorateChatMessages,
  getAssistantMessagesFromResult,
  looksLikeMarkerPartial
} = require("./chat-message-helpers");

const STREAM_FALLBACK_CHUNK_THRESHOLD = 10;
const FALLBACK_RECENT_ASSISTANT_WINDOW_MS = 30 * 1000;
const PENDING_WRITE_THROTTLE_MS = 500;
const STREAMING_ERROR_TEXT = copy("chat.streamingErrorText");

function _genSessionId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function _getExtendAI() { return null; }
function _hasExtendAI() { return false; }

async function handleStreamingSend(ctx) {
  const content = (ctx.data.inputValue || "").trim();

  if (!content || ctx.data.sending) {
    if (typeof track.newTraceId === "function") {
      track.track(
        "chat_send_blocked",
        { reason: !content ? "empty" : "sending", route: "pages/chat" }
      );
    }
    return;
  }
  if (ctx.data.firstTouch && !ctx.data.consentChecked) {
    wx.showToast({ title: copy("chat.privacyAgreeToast"), icon: "none" });
    return;
  }

  const sendTraceId = (typeof track.newTraceId === "function") ? track.newTraceId() : undefined;
  const traceOpts = sendTraceId ? { traceId: sendTraceId } : undefined;
  ctx._currentSendTraceId = sendTraceId;
  const sendClientRequestId = (typeof track.newClientRequestId === "function")
    ? track.newClientRequestId()
    : undefined;
  ctx._currentSendClientRequestId = sendClientRequestId;
  getApp().globalData.lastRequestId = sendClientRequestId;
  const stashedChip = ctx._lastChipStash;
  ctx._lastChipStash = null;
  if (stashedChip && stashedChip.text && stashedChip.text !== content) {
    track.track(
      "chat_chip_edit_before_send",
      {
        source: stashedChip.source || "",
        chipText: String(stashedChip.text).slice(0, 32),
        finalText: content.slice(0, 80)
      },
      traceOpts
    );
  }
  ctx._activeInitialMood = ctx._pendingInitialMood || "";
  ctx._pendingInitialMood = "";

  const sendStartedAt = Date.now();
  const sendContext = {
    contentLength: content.length,
    from: ctx._sendFrom || "input",
    hasExtendAI: _hasExtendAI(ctx)
  };
  track.track("chat_message_send", sendContext, traceOpts);
  if (_hasExtendAI(ctx)) {
    try {
      await _sendViaExtendAIStream(ctx, content);
      track.track(
        "chat_message_succeed",
        {
          durationMs: Date.now() - sendStartedAt,
          mode: "extend_ai_stream",
          contentLength: content.length
        },
        traceOpts
      );
      return;
    } catch (error) {
      console.warn("extend.AI streaming failed, fall to polling", error && error.message);
    }
  }
  try {
    await _sendViaPollingStream(ctx, content);
    track.track(
      "chat_message_succeed",
      {
        durationMs: Date.now() - sendStartedAt,
        mode: "polling_stream",
        contentLength: content.length
      },
      traceOpts
    );
    return;
  } catch (error) {
    console.warn("polling stream failed, fall to non-streaming", error && error.message);
  }
  try {
    const result = await _sendViaCloudFunction(ctx, content);
    track.track(
      "chat_message_succeed",
      {
        durationMs: Date.now() - sendStartedAt,
        mode: "non_stream",
        contentLength: content.length
      },
      traceOpts
    );
    return result;
  } catch (error) {
    track.track(
      "chat_message_failed",
      {
        durationMs: Date.now() - sendStartedAt,
        reason: String((error && (error.message || error.errMsg)) || error || "").slice(0, 180),
        contentLength: content.length
      },
      traceOpts
    );
    throw error;
  } finally {
    ctx._currentSendTraceId = null;
    ctx._currentSendClientRequestId = null;
  }
}

async function _sendViaCloudFunction(ctx, content) {
  const tempUserId = `temp_user_${Date.now()}`;
  const tempAssistantId = `temp_assistant_${Date.now()}`;
  const currentMessages = ctx.fullMessages || ctx.data.messages;
  const nextMessages = decorateChatMessages(currentMessages.concat(
    {
      id: tempUserId,
      role: "user",
      content,
      displayTime: "刚刚"
    }
  ));
  const nextViewState = getVisibleMessages(nextMessages, ctx.data.messageRenderLimit);

  ctx.fullMessages = nextMessages;
  ctx.setData({
    messages: nextViewState.visibleMessages.slice().reverse(),
    hiddenMessageCount: nextViewState.hiddenCount,
    inputValue: "",
    sending: true
  });

  try {
    const ensuredConversationId = await ctx.ensureConversationId(content);
    const result = await api.sendMessage(ensuredConversationId, content);

    if (result && result.conversationId && result.conversationId !== ctx.data.conversationId) {
      ctx.setData({
        conversationId: result.conversationId
      });
    }

    const confirmedUserMessage =
      result && result.userMessage
        ? result.userMessage
        : {
            id: tempUserId,
            role: "user",
            content,
            displayTime: "刚刚"
          };
    const assistantMessages = getAssistantMessagesFromResult(result);
    const baseMessages = (ctx.fullMessages || [])
      .filter((item) => item.id !== tempUserId && item.id !== tempAssistantId)
      .concat([confirmedUserMessage]);

    if (!assistantMessages.length) {
      const errMsg = {
        id: tempAssistantId,
        role: "assistant",
        content: appendTraceIdHint(STREAMING_ERROR_TEXT, ctx._currentSendTraceId),
        displayTime: "此刻"
      };
      const finalMessages = decorateChatMessages(baseMessages.concat([errMsg]));
      ctx.fullMessages = finalMessages;
      ctx.commitMessages(finalMessages, {
        renderLimit: ctx.data.messageRenderLimit,
        scrollToLatest: true,
        scrollWithAnimation: true
      });
      ctx.setData({ sending: false });
    } else {
      await playAssistantMessages(ctx, assistantMessages, baseMessages);
    }

    if (result && result.aiError) {
      wx.showToast({
        title: result.aiError,
        icon: "none"
      });
    }

    if (result && Array.isArray(result.newMemories) && result.newMemories.length) {
      ctx.showMemoryBanner(result.newMemories);
    }

    if (result && result.aiMood) {
      ctx.applyAiMood(result.aiMood);
    }
  } catch (error) {
    console.warn("stream message failed", error);
    const failedMessages = decorateChatMessages((ctx.fullMessages || []).concat({
      id: tempAssistantId,
      role: "assistant",
      content: appendTraceIdHint(STREAMING_ERROR_TEXT, ctx._currentSendTraceId),
      displayTime: copy("time.now"),
      pending: false,
      streaming: false
    }));

    ctx.fullMessages = failedMessages;
    ctx.commitMessages(failedMessages, {
      renderLimit: ctx.data.messageRenderLimit,
      scrollToLatest: true,
      scrollWithAnimation: false
    });
    wx.showToast({
      title: getStreamingFailureText(error, ctx._currentSendTraceId),
      icon: "none"
    });
    ctx.setData({ sending: false });
  }
}
async function _sendViaPollingStream(ctx, content) {
  const sessionId = _genSessionId();
  const playbackId = (ctx._playbackCounter = (ctx._playbackCounter || 0) + 1);
  ctx._currentPlaybackId = playbackId;
  const aborted = () => ctx._currentPlaybackId !== playbackId;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tempUserId = `temp_user_${Date.now()}`;
  const baseBeforeUser = ctx.fullMessages || ctx.data.messages || [];
  const withTempUser = decorateChatMessages(baseBeforeUser.concat({
    id: tempUserId,
    role: "user",
    content,
    displayTime: copy("time.justNow")
  }));
  const tempView = getVisibleMessages(withTempUser, ctx.data.messageRenderLimit);
  ctx.fullMessages = withTempUser;
  ctx.setData({
    messages: tempView.visibleMessages.slice().reverse(),
    hiddenMessageCount: tempView.hiddenCount,
    inputValue: "",
    sending: true
  });
  const ensuredConversationId = await ctx.ensureConversationId(content);
  const pollSendTraceId = ctx._currentSendTraceId || null;
  const pollApiOpts = { traceId: pollSendTraceId, clientRequestId: ctx._currentSendClientRequestId };
  const tempBubbleIds = new Set();
  let baseAcc = (ctx.fullMessages || []).slice();  // 含 temp_user

  const renderProgress = (text) => {
    if (aborted()) return;
    const segments = String(text || "")
      .split(/\n{2,}/)
      .map((s) => s.replace(/^\s+|\s+$/g, ""))
      .filter(Boolean);
    if (segments.length && !ctx.data._streamHasContent) {
      ctx.setData({ _streamHasContent: true });
    }
    const cleaned = (ctx.fullMessages || []).filter((m) => !tempBubbleIds.has(m.id));
    tempBubbleIds.clear();
    const fresh = cleaned.slice();
    segments.forEach((seg, i) => {
      const id = `temp_assist_${sessionId}_${i}`;
      tempBubbleIds.add(id);
      fresh.push({
        id,
        role: "assistant",
        content: seg,
        displayTime: copy("time.now"),
        streaming: true
      });
    });
    const decorated = decorateChatMessages(fresh);
    ctx.fullMessages = decorated;
    ctx.commitMessages(decorated, {
      renderLimit: ctx.data.messageRenderLimit,
      scrollToLatest: true,
      scrollWithAnimation: true
    });
  };
  let generateError = null;
  let generateResult = null;
  let pollDone = false;

  const generatePromise = api
    .streamGenerate(ensuredConversationId, sessionId, content, pollApiOpts)
    .then((r) => { generateResult = r; })
    .catch((err) => { generateError = err; })
    .finally(() => { pollDone = true; });

  const pollLoop = (async () => {
    await wait(300);
    while (!pollDone && !aborted()) {
      try {
        const poll = await api.streamPoll(sessionId, pollApiOpts);
        if (aborted()) return;
        if (poll && poll.content) {
          renderProgress(poll.content);
        }
        if (poll && poll.done) break;
      } catch (error) {
        console.warn("[poll-stream] poll error:", error && error.message);
      }
      await wait(300);
    }
  })();

  await Promise.all([generatePromise, pollLoop]);

  if (aborted()) return;
  if (generateError) {
    const cleaned = (ctx.fullMessages || []).filter((m) => !tempBubbleIds.has(m.id) && m.id !== tempUserId);
    ctx.fullMessages = decorateChatMessages(cleaned);
    ctx.commitMessages(ctx.fullMessages, {
      renderLimit: ctx.data.messageRenderLimit,
      scrollToLatest: false,
      scrollWithAnimation: false
    });
    ctx.setData({ sending: false });
    throw generateError;
  }
  if (generateResult && generateResult.conversationId &&
      generateResult.conversationId !== ctx.data.conversationId) {
    ctx.setData({ conversationId: generateResult.conversationId });
  }

  let acc = (ctx.fullMessages || []).filter(
    (m) => !tempBubbleIds.has(m.id) && m.id !== tempUserId
  );
  if (generateResult && generateResult.userMessage) {
    acc.push(generateResult.userMessage);
  }
  if (generateResult && Array.isArray(generateResult.assistantMessages)) {
    acc = acc.concat(generateResult.assistantMessages);
  }
  acc = decorateChatMessages(acc);
  ctx.fullMessages = acc;
  ctx.commitMessages(acc, {
    renderLimit: ctx.data.messageRenderLimit,
    scrollToLatest: true,
    scrollWithAnimation: false
  });

  if (generateResult && generateResult.aiError) {
    wx.showToast({ title: generateResult.aiError, icon: "none" });
  }
  if (generateResult && Array.isArray(generateResult.newMemories) && generateResult.newMemories.length) {
    ctx.showMemoryBanner(generateResult.newMemories);
  }
  if (generateResult && generateResult.profileUpdate) ctx._applyServerNameUpdate(generateResult.profileUpdate);
  if (generateResult && generateResult.aiMood) {
    ctx.applyAiMood(generateResult.aiMood);
  }

  ctx.setData({ sending: false });
}

async function _sendViaExtendAIStream(ctx, content) {
  const got = _getExtendAI();
  if (!got) throw new Error("extend.AI not available");
  const ai = got.ai;
  const tempUserId = `temp_user_${Date.now()}`;
  const currentMessages = ctx.fullMessages || ctx.data.messages;
  const withTempUser = decorateChatMessages(currentMessages.concat({
    id: tempUserId,
    role: "user",
    content,
    displayTime: copy("time.justNow")
  }));
  const tempView = getVisibleMessages(withTempUser, ctx.data.messageRenderLimit);
  ctx.fullMessages = withTempUser;
  ctx.setData({
    messages: tempView.visibleMessages.slice().reverse(),
    hiddenMessageCount: tempView.hiddenCount,
    inputValue: "",
    sending: true
  });
  const ensuredConversationId = await ctx.ensureConversationId(content);
  const sendTraceId = ctx._currentSendTraceId || null;
  const apiOpts = sendTraceId ? { traceId: sendTraceId } : undefined;
  const sendClientRequestId = ctx._currentSendClientRequestId || null;
  const prepareOpts = sendClientRequestId
    ? Object.assign({}, apiOpts || {}, { clientRequestId: sendClientRequestId })
    : apiOpts;
  let prep;
  try {
    prep = await api.prepareStream(ensuredConversationId, content, prepareOpts);
  } catch (prepareErr) {
    throw prepareErr;
  }

  if (prep.conversationId && prep.conversationId !== ctx.data.conversationId) {
    ctx.setData({ conversationId: prep.conversationId });
  }
  if (sendClientRequestId && prep && prep.conversationId) {
    pendingFinalize.writePending({
      conversationId: prep.conversationId,
      fullText: "",
      clientRequestId: sendClientRequestId,
      sendAt: Date.now()
    });
    ctx._pendingFinalizeConversationId = prep.conversationId;
    ctx._pendingFinalizeLastWriteAt = Date.now();
  }
  let acc = decorateChatMessages(
    (ctx.fullMessages || [])
      .filter((m) => m.id !== tempUserId)
      .concat([prep.userMessage])
  );
  ctx.fullMessages = acc;
  ctx.commitMessages(acc, {
    renderLimit: ctx.data.messageRenderLimit,
    scrollToLatest: true,
    scrollWithAnimation: false
  });
  const playbackId = (ctx._playbackCounter = (ctx._playbackCounter || 0) + 1);
  ctx._currentPlaybackId = playbackId;
  const aborted = () => ctx._currentPlaybackId !== playbackId;
  if (!ai.bot || typeof ai.bot.sendMessage !== "function") {
    throw new Error("extend.AI.bot.sendMessage not available");
  }
  if (!prep.botId) {
    throw new Error("prep.botId missing — check cloud function AI_CONFIG.botId");
  }
  api.setCachedBotId(prep.botId);
  const tempBubbleIds = [];
  const historyForBot = (ctx.fullMessages || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-19, -1) // 最近 18 条历史，不含最后一条（最新 user，msg 字段单独传）
    .map((m) => ({
      role: m.role,
      content: String(m.role === "assistant" && m.rawContent ? m.rawContent : m.content)
    }));
  const isLikelyColdStart = (err) => {
    const msg = String((err && (err.errMsg || err.message)) || err || "").toLowerCase();
    return /504|gateway timeout|timeout|no response|gateway error/.test(msg);
  };
  const moodForThisSend = ctx._activeInitialMood || "";
  ctx._activeInitialMood = "";

  let streamResult = null;
  let coldStartRetried = false;
  const streamStartedAt = Date.now();
  let firstByteEmitted = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const sendData = {
        botId: prep.botId,
        msg: content,
        history: historyForBot
      };
      if (moodForThisSend) {
        sendData.initialMood = moodForThisSend;
      }
      if (sendTraceId) {
        sendData._traceId = sendTraceId;
      }
      if (sendClientRequestId) {
        sendData._clientRequestId = sendClientRequestId;
      }
      streamResult = await ai.bot.sendMessage({ data: sendData });
      break;
    } catch (error) {
      const coldStart = isLikelyColdStart(error);
      console.warn(
        `[chat-stream] bot.sendMessage failed attempt=${attempt + 1} coldStart=${coldStart}:`,
        error && (error.errMsg || error.message)
      );
      if (attempt === 0 && coldStart) {
        coldStartRetried = true;
        wx.showToast({ title: copy("chat.coldStartToast"), icon: "none", duration: 2000 });
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      await _fallbackToCloudGenerate(ctx, prep, tempBubbleIds);
      return;
    }
  }
  if (coldStartRetried) {
    console.log("[chat-stream] cold start recovered on retry");
  }

  if (!streamResult) {
    console.warn("[chat-stream] bot.sendMessage returned empty, falling back");
    await _fallbackToCloudGenerate(ctx, prep, tempBubbleIds);
    return;
  }

  console.log("[chat-stream] bot.sendMessage returned. shape=", {
    botId: prep.botId,
    hasTextStream: !!streamResult.textStream,
    hasEventStream: !!streamResult.eventStream,
    hasDataStream: !!streamResult.dataStream,
    isAsyncIter: typeof streamResult[Symbol.asyncIterator] === "function",
    keys: streamResult && typeof streamResult === "object" ? Object.keys(streamResult) : []
  });
  let buffer = "";
  let fullText = "";
  let inMarker = false;
  let markerText = "";
  let metaCandidates = null;
  const BUBBLE_GAP_MS = 1000;  // 段与段之间至少 1s 节奏感；chip 到达时如末段还卡在 wait 会立刻 flush（见 meta event handler）
  let lastFlushAt = 0;
  const flushQueue = [];
  let drainTimer = null;
  let streamFinished = false;
  let drainResolve;
  const drainPromise = new Promise((resolve) => { drainResolve = resolve; });
  const _doFlushBubble = (text) => {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    if (!ctx.data._streamHasContent) {
      ctx.setData({ _streamHasContent: true });
    }
    const tempId = `temp_assist_${Date.now()}_${tempBubbleIds.length}`;
    tempBubbleIds.push(tempId);
    acc = decorateChatMessages(acc.concat({
      id: tempId,
      role: "assistant",
      content: trimmed,
      displayTime: copy("time.now"),
      streaming: true
    }));
    ctx.fullMessages = acc;
    ctx.commitMessages(acc, {
      renderLimit: ctx.data.messageRenderLimit,
      scrollToLatest: true,
      scrollWithAnimation: true
    });
  };

  const scheduleNextFlush = () => {
    if (drainTimer) return;
    const tick = () => {
      if (flushQueue.length === 0) {
        drainTimer = null;
        if (streamFinished) drainResolve();
        return;
      }
      const wait = Math.max(0, BUBBLE_GAP_MS - (Date.now() - lastFlushAt));
      drainTimer = setTimeout(() => {
        drainTimer = null;
        const next = flushQueue.shift();
        _doFlushBubble(next);
        lastFlushAt = Date.now();
        tick();
      }, wait);
    };
    tick();
  };
  const flushBubble = (text) => {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    flushQueue.push(trimmed);
    scheduleNextFlush();
  };
  const markStreamFinished = () => {
    if (streamFinished) return;
    streamFinished = true;
    if (!drainTimer && flushQueue.length === 0) {
      drainResolve();
    }
  };
  const extractText = (chunk) => {
    if (chunk == null) return "";
    if (typeof chunk === "string") return chunk;
    if (typeof chunk !== "object") return String(chunk);
    if (chunk.type === "thinking") return "";
    if (typeof chunk.text === "string") return chunk.text;
    if (typeof chunk.content === "string") return chunk.content;
    if (typeof chunk.delta === "string") return chunk.delta;
    if (chunk.delta && typeof chunk.delta === "object") {
      if (typeof chunk.delta.content === "string") return chunk.delta.content;
      if (typeof chunk.delta.text === "string") return chunk.delta.text;
    }
    if (chunk.record && typeof chunk.record === "object") {
      if (typeof chunk.record.content === "string") return chunk.record.content;
      if (typeof chunk.record.text === "string") return chunk.record.text;
      if (typeof chunk.record.delta === "string") return chunk.record.delta;
    }
    if (Array.isArray(chunk.choices) && chunk.choices[0]) {
      const c = chunk.choices[0];
      if (c.delta && typeof c.delta.content === "string") return c.delta.content;
      if (c.message && typeof c.message.content === "string") return c.message.content;
      if (typeof c.text === "string") return c.text;
    }
    if (typeof chunk.data === "string") {
      if (chunk.data === "[DONE]") return "";
      try {
        const parsed = JSON.parse(chunk.data);
        return extractText(parsed);
      } catch (_) {
        return chunk.data;
      }
    }
    return "";
  };

  const consumePiece = (piece) => {
    if (!piece) return;
    fullText += piece;
    if (sendClientRequestId && ctx._pendingFinalizeConversationId) {
      const now = Date.now();
      if (now - (ctx._pendingFinalizeLastWriteAt || 0) >= PENDING_WRITE_THROTTLE_MS) {
        pendingFinalize.writePending({
          conversationId: ctx._pendingFinalizeConversationId,
          fullText,
          clientRequestId: sendClientRequestId,
          sendAt: now
        });
        ctx._pendingFinalizeLastWriteAt = now;
      }
    }
    if (inMarker) {
      markerText += piece;
      return;
    }

    buffer += piece;
    const markerMatch = MARKER_DETECT_REGEX.exec(buffer);
    const markerIdx = markerMatch && typeof markerMatch.index === "number" ? markerMatch.index : -1;
    if (markerIdx >= 0) {
      let beforeMarker = buffer.slice(0, markerIdx);
      let nlIdx;
      while ((nlIdx = beforeMarker.indexOf("\n")) >= 0) {
        flushBubble(beforeMarker.slice(0, nlIdx));
        beforeMarker = beforeMarker.slice(nlIdx + 1);
      }
      if (beforeMarker.replace(/^\s+|\s+$/g, "")) {
        flushBubble(beforeMarker);
      }
      inMarker = true;
      markerText = buffer.slice(markerIdx);
      buffer = "";
      return;
    }
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      flushBubble(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  };

  let chunkSeenCount = 0;
  let firstChunkSample = null;

  try {
    const ev = streamResult && streamResult.eventStream;
    const ts = streamResult && streamResult.textStream;

    if (ev && typeof ev[Symbol.asyncIterator] === "function") {
      const sampleLog = [];
      for await (const event of ev) {
        if (aborted()) return;
        chunkSeenCount += 1;
        if (chunkSeenCount === 1) {
          firstChunkSample = event;
          if (!firstByteEmitted) {
            firstByteEmitted = true;
            track.track(
              "stream_first_byte",
              { durationMs: Date.now() - streamStartedAt, mode: "extend_ai_stream" },
              apiOpts
            );
          }
        }
        if (!event) continue;
        if (typeof event.delta === "string" && event.delta) {
          if (sampleLog.length < 3) sampleLog.push({ via: "delta", event });
          consumePiece(event.delta);
          continue;
        }
        if (typeof event.data === "string") {
          if (event.data === "[DONE]") break;
          try {
            const payload = JSON.parse(event.data);
            if (payload && payload.type === "debug") {
              console.log("[DEBUG-PIPE] tag=", payload.tag, "payload=", payload.payload);
              continue;
            }
            if (payload && payload.type === "error") {
              ctx._streamErrorClass = payload.errorClass || "unknown";
              ctx._streamErrorRetryable = payload.retryable !== false;  // 缺字段默认 retryable
              ctx._streamErrorRetryAfterMs = payload.retryAfterMs;
              console.warn("[chat-stream] SSE error event:", {
                errorClass: ctx._streamErrorClass,
                retryable: ctx._streamErrorRetryable,
                retryAfterMs: ctx._streamErrorRetryAfterMs,
                message: (payload.error && payload.error.message) || ""
              });
              continue;
            }
            if (payload && payload.type === "meta") {
              if (payload.aiMood) {
                ctx.applyAiMood(payload.aiMood);
              }
              if (Array.isArray(payload.newMemories) && payload.newMemories.length) {
                ctx.showMemoryBanner(payload.newMemories);
              }
              if (payload.profileUpdate) {
                ctx._applyServerNameUpdate(payload.profileUpdate);
              }
              console.log("[chat-stream] meta event:", payload);
              continue;
            }
            if (payload && payload.type === "finish") {
              if (!inMarker && buffer.replace(/^\s+|\s+$/g, "")) {
                if (looksLikeMarkerPartial(buffer)) {
                  markerText = buffer;
                  inMarker = true;
                } else {
                  flushBubble(buffer);
                }
                buffer = "";
              }
              markStreamFinished();
              continue;
            }
            const piece = extractText(payload);
            if (piece) {
              if (sampleLog.length < 3) sampleLog.push({ via: "data->extract", payload, piece });
              consumePiece(piece);
            }
          } catch (_) {
          }
          continue;
        }
        const piece = extractText(event);
        if (piece) {
          if (sampleLog.length < 3) sampleLog.push({ via: "event-extract", event, piece });
          consumePiece(piece);
        }
      }
      console.log("[chat-stream] event samples=", sampleLog);
    } else if (ts && typeof ts[Symbol.asyncIterator] === "function") {
      for await (const chunk of ts) {
        if (aborted()) return;
        chunkSeenCount += 1;
        if (chunkSeenCount === 1) firstChunkSample = chunk;
        consumePiece(extractText(chunk));
      }
    } else if (ev && typeof ev.on === "function") {
      await new Promise((resolve, reject) => {
        ev.on("data", (event) => {
          if (aborted()) return;
          chunkSeenCount += 1;
          if (chunkSeenCount === 1) firstChunkSample = event;
          if (!event || typeof event.data !== "string") return;
          if (event.data === "[DONE]") return resolve();
          try {
            const payload = JSON.parse(event.data);
            const delta = payload && payload.choices && payload.choices[0] && payload.choices[0].delta;
            const piece = (delta && delta.content) || "";
            if (piece) consumePiece(piece);
          } catch (_) {  }
        });
        ev.on("end", resolve);
        ev.on("error", reject);
      });
    }

    console.log("[chat-stream] chunks=", chunkSeenCount,
      "fullText.len=", fullText.length,
      "firstChunk=", firstChunkSample);
    console.log("[CHIPS-DEBUG] fullText:", JSON.stringify(fullText));
    console.log("[CHIPS-DEBUG] inMarker=", inMarker, "markerText=", JSON.stringify(markerText));

    if (aborted()) return;
    if (!inMarker && buffer.replace(/^\s+|\s+$/g, "")) {
      if (looksLikeMarkerPartial(buffer)) {
        markerText = buffer;
        inMarker = true;
      } else {
        flushBubble(buffer);
      }
      buffer = "";
    }
    markStreamFinished();
    const cleanedFullText = (inMarker
      ? fullText.slice(0, Math.max(0, fullText.length - markerText.length))
      : fullText
    ).replace(MARKER_CLEAN_REGEX, "").replace(/\s+$/, "");
    let parsedCandidates = metaCandidates
      ? sanitizeCandidates(metaCandidates)
      : parseCandidatesFromMarker(markerText);
    if (!parsedCandidates.length) {
      parsedCandidates = parseCandidatesFromMarker(fullText);
    }

    if (!cleanedFullText.trim()) {
      throw new Error(`Empty assistant stream (chunks=${chunkSeenCount})`);
    }
    const fullTextNormalized = fullText.replace(
      /\n+(_{0,2}CANDIDATES_{0,2}\s*\[[\s\S]*?\])(\s*)$/,
      " $1$2"
    );
    const finalizeOpts = sendClientRequestId
      ? Object.assign({}, apiOpts || {}, { clientRequestId: sendClientRequestId })
      : apiOpts;
    const final = await api.finalizeStream(prep.conversationId, content, fullTextNormalized, finalizeOpts);
    if (aborted()) return;
    if (sendClientRequestId) {
      pendingFinalize.clearPending();
      ctx._pendingFinalizeConversationId = null;
      ctx._pendingFinalizeLastWriteAt = 0;
    }
    await drainPromise;
    if (aborted()) return;
    console.log(
      "[chat-stream] finalizeStream done. persistedAssistant.count=",
      (final && Array.isArray(final.assistantMessages) && final.assistantMessages.length) || 0,
      "tempBubbleIds.count=", (Array.isArray(tempBubbleIds) ? tempBubbleIds.length : 0)
    );
    const persistedAssistant = ((final && final.assistantMessages) || []).map(processAssistantForUI);
    if (persistedAssistant.length) {
      if (tempBubbleIds.length === persistedAssistant.length) {
        const tempIdToPersisted = new Map();
        tempBubbleIds.forEach((tid, idx) => tempIdToPersisted.set(tid, persistedAssistant[idx]));
        acc = decorateChatMessages(
          (ctx.fullMessages || []).map((m) => {
            if (!tempIdToPersisted.has(m.id)) return m;
            const p = tempIdToPersisted.get(m.id);
            return Object.assign({}, m, p, {
              id: m.id,
              content: (p && p.content) || m.content,
              streaming: false
            });
          })
        );
      } else {
        acc = decorateChatMessages(
          (ctx.fullMessages || [])
            .filter((m) => !tempBubbleIds.includes(m.id))
            .concat(persistedAssistant)
        );
      }
      if (parsedCandidates && parsedCandidates.length) {
        let attachedMessageId = "";
        for (let i = acc.length - 1; i >= 0; i -= 1) {
          const m = acc[i];
          if (m && !m.dateSeparator && m.role === "assistant") {
            acc[i] = Object.assign({}, m, { replyCandidates: parsedCandidates });
            attachedMessageId = m.id || "";
            break;
          }
        }
        if (attachedMessageId) {
          track.track("chat_chip_show", {
            messageId: String(attachedMessageId).slice(0, 64),
            chipCount: parsedCandidates.length,
            chips: parsedCandidates
          });
        }
      }

      ctx.fullMessages = acc;
      ctx.commitMessages(acc, {
        renderLimit: ctx.data.messageRenderLimit,
        scrollToLatest: true,
        scrollWithAnimation: false,
        sending: false
      });

    }

    if (final && Array.isArray(final.newMemories) && final.newMemories.length) {
      ctx.showMemoryBanner(final.newMemories);
    }
    if (final && final.aiMood) {
      ctx.applyAiMood(final.aiMood);
    }
    if (ctx.data.sending) {
      ctx.setData({ sending: false });
    }
  } catch (streamErr) {
    const earlyFailure = chunkSeenCount < STREAM_FALLBACK_CHUNK_THRESHOLD;
    const isAborted = aborted();
    const ssePayloadSaysNoRetry = ctx._streamErrorRetryable === false;
    const shouldFallback = (earlyFailure || isAborted) && !ssePayloadSaysNoRetry;
    const sseErrorClass = ctx._streamErrorClass;
    ctx._streamErrorClass = null;
    ctx._streamErrorRetryable = null;
    ctx._streamErrorRetryAfterMs = null;
    console.warn(
      "[chat-stream] post-prep error;",
      shouldFallback ? "fall to cloud generate" : "keep already-rendered bubble, rely on pending finalize retry",
      ":", streamErr && streamErr.message,
      "chunkSeen=", chunkSeenCount
    );
    track.track(
      "stream_chunk_anomaly",
      {
        stage: firstByteEmitted ? "after_first_byte" : "before_first_byte",
        reason: String((streamErr && (streamErr.message || streamErr.errMsg)) || streamErr || "").slice(0, 160),
        partialLen: fullText ? fullText.length : 0,
        chunkSeen: chunkSeenCount,
        willFallback: shouldFallback,
        sseErrorClass: ctx._streamErrorClass || undefined
      },
      apiOpts
    );
    if (shouldFallback) {
      await _fallbackToCloudGenerate(ctx, prep, tempBubbleIds);
    } else {
      if (ctx.data.sending) {
        ctx.setData({ sending: false });
      }
      try {
        const toastTitle = ssePayloadSaysNoRetry
          ? (sseErrorClass === "invalid_input"
            ? copy("chat.messageInvalid")
            : `请求被拒：${sseErrorClass || "unknown"}`)
          : copy("chat.messageRecovering");
        wx.showToast({
          title: toastTitle,
          icon: "none",
          duration: 2500
        });
      } catch (_) {  }
    }
  }
}
async function _fallbackToCloudGenerate(ctx, prep, tempBubbleIds = []) {
  const fullMessages = ctx.fullMessages || [];
  const recentAssistant = (() => {
    const now = Date.now();
    for (let i = fullMessages.length - 1; i >= 0; i -= 1) {
      const m = fullMessages[i];
      if (m && !m.dateSeparator && m.role === "assistant" && !tempBubbleIds.includes(m.id)) {
        const ts = m.createdAt || m._createdAt;
        const tsMs = typeof ts === "number" ? ts : (ts ? new Date(ts).getTime() : 0);
        if (tsMs && (now - tsMs) < FALLBACK_RECENT_ASSISTANT_WINDOW_MS) return m;
        break; // 只看最末 assistant，旧的不算
      }
    }
    return null;
  })();
  if (recentAssistant) {
    track.track(
      "fallback_skipped_recent_assistant",
      {
        messageId: String(recentAssistant.id || recentAssistant._id || "").slice(0, 64),
        ageMs: Date.now() - (typeof recentAssistant.createdAt === "number"
          ? recentAssistant.createdAt
          : new Date(recentAssistant.createdAt || recentAssistant._createdAt || 0).getTime())
      },
      ctx._currentSendTraceId ? { traceId: ctx._currentSendTraceId } : undefined
    );
    const cleanAcc = decorateChatMessages(
      (ctx.fullMessages || []).filter((m) => !tempBubbleIds.includes(m.id))
    );
    ctx.fullMessages = cleanAcc;
    ctx.commitMessages(cleanAcc, {
      renderLimit: ctx.data.messageRenderLimit,
      scrollToLatest: true,
      scrollWithAnimation: false,
      sending: false
    });
    if (ctx._currentSendClientRequestId) {
      pendingFinalize.clearPending();
      ctx._pendingFinalizeConversationId = null;
      ctx._pendingFinalizeLastWriteAt = 0;
    }
    return;
  }

  const cleanAcc = decorateChatMessages(
    (ctx.fullMessages || []).filter((m) => !tempBubbleIds.includes(m.id))
  );
  ctx.fullMessages = cleanAcc;
  ctx.commitMessages(cleanAcc, {
    renderLimit: ctx.data.messageRenderLimit,
    scrollToLatest: true,
    scrollWithAnimation: false
  });
  let fallbackPersisted = false;

  try {
    const fallbackOpts = {};
    if (ctx._currentSendTraceId) fallbackOpts.traceId = ctx._currentSendTraceId;
    if (ctx._currentSendClientRequestId) fallbackOpts.clientRequestId = ctx._currentSendClientRequestId;
    const final = await api.generateAssistantFromHistory(prep.conversationId, Object.keys(fallbackOpts).length ? fallbackOpts : undefined);

    const persisted = (final && final.assistantMessages) || [];
    if (persisted.length) {
      const next = decorateChatMessages(cleanAcc.concat(persisted));
      ctx.fullMessages = next;
      ctx.commitMessages(next, {
        renderLimit: ctx.data.messageRenderLimit,
        scrollToLatest: true,
        scrollWithAnimation: true,
        sending: false
      });
      fallbackPersisted = true;
    }

    if (final && final.aiError) {
      wx.showToast({ title: final.aiError, icon: "none" });
    }
    if (final && Array.isArray(final.newMemories) && final.newMemories.length) {
      ctx.showMemoryBanner(final.newMemories);
    }
    if (final && final.aiMood) {
      ctx.applyAiMood(final.aiMood);
    }
  } catch (genErr) {
    console.warn("[chat-stream] cloud fallback also failed:", genErr);
    wx.showToast({
      title: getStreamingFailureText(genErr, ctx._currentSendTraceId),
      icon: "none"
    });
  } finally {
    ctx.setData({ sending: false });
    if (ctx._currentSendClientRequestId && fallbackPersisted) {
      pendingFinalize.clearPending();
      ctx._pendingFinalizeConversationId = null;
      ctx._pendingFinalizeLastWriteAt = 0;
    }
  }
}
async function _resumePendingFinalize(ctx, currentConversationId) {
  const pending = pendingFinalize.readPending();
  if (!pending) return;
  if (currentConversationId && pending.conversationId !== currentConversationId) return;

  if (pendingFinalize.isPendingExpired(pending)) {
    track.track("pending_finalize_expired", {
      conversationId: String(pending.conversationId).slice(0, 64),
      sendAt: pending.sendAt,
      ageMs: Date.now() - pending.sendAt,
      partialLen: (pending.fullText || "").length
    });
    pendingFinalize.clearPending();
    return;
  }
  const messagesNow = ctx.fullMessages || [];
  let lastNonSeparator = null;
  for (let i = messagesNow.length - 1; i >= 0; i -= 1) {
    const m = messagesNow[i];
    if (m && !m.dateSeparator) {
      lastNonSeparator = m;
      break;
    }
  }
  if (lastNonSeparator && lastNonSeparator.role === "assistant") {
    const createdAtMs = typeof lastNonSeparator.createdAt === "number"
      ? lastNonSeparator.createdAt
      : (lastNonSeparator.createdAt ? new Date(lastNonSeparator.createdAt).getTime() : 0);
    const sendAt = typeof pending.sendAt === "number" ? pending.sendAt : 0;
    const WINDOW_BEFORE_MS = 5 * 1000;
    const WINDOW_AFTER_MS = 60 * 1000;
    if (
      createdAtMs &&
      sendAt &&
      createdAtMs >= sendAt - WINDOW_BEFORE_MS &&
      createdAtMs <= sendAt + WINDOW_AFTER_MS
    ) {
      track.track("pending_finalize_skip_cloudrun_persisted", {
        conversationId: String(pending.conversationId).slice(0, 64),
        sendAt,
        assistantCreatedAt: createdAtMs,
        deltaMs: createdAtMs - sendAt
      });
      pendingFinalize.clearPending();
      ctx._pendingFinalizeConversationId = null;
      ctx._pendingFinalizeLastWriteAt = 0;
      return;
    }
  }

  if (!pending.fullText || !pending.fullText.trim()) {
    await _regeneratePendingAssistant(ctx, pending);
    return;
  }

  track.track("pending_finalize_retry", {
    conversationId: String(pending.conversationId).slice(0, 64),
    fullTextLen: pending.fullText.length,
    ageMs: Date.now() - pending.sendAt
  });
  const placeholderId = `pending_retry_${pending.clientRequestId}`;
  const cleanedContent = String(pending.fullText || "").replace(/\n*_{0,2}CANDIDATES_{0,2}\s*\[[\s\S]*?\]\s*$/, "").trim();
  const placeholder = {
    id: placeholderId,
    role: "assistant",
    content: cleanedContent || pending.fullText,
    rawContent: pending.fullText,
    createdAt: pending.sendAt,
    _pendingRetry: true
  };
  let nextMessages = decorateChatMessages((ctx.fullMessages || []).concat([placeholder]));
  ctx.fullMessages = nextMessages;
  ctx.commitMessages(nextMessages, {
    renderLimit: ctx.data.messageRenderLimit,
    scrollToLatest: true,
    scrollWithAnimation: false
  });
  try {
    const final = await api.finalizeStream(
      pending.conversationId,
      "",
      pending.fullText,
      { clientRequestId: pending.clientRequestId }
    );
    pendingFinalize.clearPending();

    const persisted = (final && final.assistantMessages) || [];
    if (persisted.length) {
      const replaced = decorateChatMessages(
        (ctx.fullMessages || []).map((m) => {
          if (m.id !== placeholderId) return m;
          const p = persisted[0];   // 取第一段（finalize 切段后通常 1-2 段）
          return Object.assign({}, p, {
            _pendingRetry: false
          });
        }).concat(persisted.slice(1))  // 多段时把剩余追加到末尾
      );
      ctx.fullMessages = replaced;
      ctx.commitMessages(replaced, {
        renderLimit: ctx.data.messageRenderLimit,
        scrollToLatest: true,
        scrollWithAnimation: false
      });
    } else {
      const filtered = (ctx.fullMessages || []).filter((m) => m.id !== placeholderId);
      ctx.fullMessages = filtered;
      ctx.commitMessages(filtered, {
        renderLimit: ctx.data.messageRenderLimit,
        scrollToLatest: true,
        scrollWithAnimation: false
      });
    }
  } catch (error) {
    track.track("pending_finalize_retry_failed", {
      conversationId: String(pending.conversationId).slice(0, 64),
      errMsg: String((error && (error.message || error.errMsg)) || error || "").slice(0, 160)
    });
  }
}
async function _regeneratePendingAssistant(ctx, pending) {
  const conversationIdPrefix = String(pending.conversationId || "").slice(0, 8);
  const placeholderId = `pending_regenerate_${pending.clientRequestId}`;
  const placeholder = {
    id: placeholderId,
    role: "assistant",
    content: copy("chat.resumingReply"),
    createdAt: pending.sendAt,
    _pendingRetry: true
  };
  let nextMessages = decorateChatMessages((ctx.fullMessages || []).concat([placeholder]));
  ctx.fullMessages = nextMessages;
  ctx.commitMessages(nextMessages, {
    renderLimit: ctx.data.messageRenderLimit,
    scrollToLatest: true,
    scrollWithAnimation: false
  });

  const startedAt = Date.now();
  try {
    const final = await api.generateAssistantFromHistory(
      pending.conversationId,
      { clientRequestId: pending.clientRequestId }
    );
    const persisted = (final && final.assistantMessages) || [];
    if (persisted.length) {
      const replaced = decorateChatMessages(
        (ctx.fullMessages || []).map((m) => {
          if (m.id !== placeholderId) return m;
          return Object.assign({}, persisted[0], { _pendingRetry: false });
        }).concat(persisted.slice(1))
      );
      ctx.fullMessages = replaced;
      ctx.commitMessages(replaced, {
        renderLimit: ctx.data.messageRenderLimit,
        scrollToLatest: true,
        scrollWithAnimation: false
      });
      pendingFinalize.clearPending();
      track.track("pending_finalize_regenerate_attempt", {
        outcome: "success",
        conversationIdPrefix,
        regenerateMs: Date.now() - startedAt
      });
    } else {
      track.track("pending_finalize_regenerate_failed", {
        errMsg: "empty_assistantMessages",
        conversationIdPrefix
      });
    }
  } catch (error) {
    track.track("pending_finalize_regenerate_failed", {
      errMsg: String((error && (error.message || error.errMsg)) || error || "").slice(0, 160),
      conversationIdPrefix
    });
  }
}
async function _recoverOrphanLastUserMessage(ctx, conversationId) {
  const existingPending = pendingFinalize.readPending();
  if (existingPending) return;

  const messages = ctx.fullMessages || [];
  let last = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && !m.dateSeparator) {
      last = m;
      break;
    }
  }
  if (!last || last.role !== "user") return;  // happy path：末位是 assistant

  const conversationIdPrefix = String(conversationId || "").slice(0, 8);
  const createdAtMs = typeof last.createdAt === "number"
    ? last.createdAt
    : (last.createdAt ? new Date(last.createdAt).getTime() : 0);
  const ageMs = createdAtMs ? Date.now() - createdAtMs : Number.POSITIVE_INFINITY;
  const MAX_RECOVER_AGE_MS = 24 * 60 * 60 * 1000;
  if (ageMs > MAX_RECOVER_AGE_MS) {
    track.track("orphan_user_recovery_skipped", {
      reason: "too_old",
      ageMs: ageMs === Number.POSITIVE_INFINITY ? -1 : ageMs,
      conversationIdPrefix
    });
    return;
  }

  const clientRequestId = (typeof track.newClientRequestId === "function")
    ? track.newClientRequestId()
    : `orphan_${Date.now()}`;
  const placeholderId = `orphan_recover_${clientRequestId}`;
  const placeholder = {
    id: placeholderId,
    role: "assistant",
    content: copy("chat.generatingReply"),
    createdAt: Date.now(),
    _pendingRetry: true
  };
  let nextMessages = decorateChatMessages((ctx.fullMessages || []).concat([placeholder]));
  ctx.fullMessages = nextMessages;
  ctx.commitMessages(nextMessages, {
    renderLimit: ctx.data.messageRenderLimit,
    scrollToLatest: true,
    scrollWithAnimation: false
  });

  const startedAt = Date.now();
  try {
    const final = await api.generateAssistantFromHistory(
      conversationId,
      { clientRequestId }
    );
    const persisted = (final && final.assistantMessages) || [];
    if (persisted.length) {
      const replaced = decorateChatMessages(
        (ctx.fullMessages || []).map((m) => {
          if (m.id !== placeholderId) return m;
          return Object.assign({}, persisted[0], { _pendingRetry: false });
        }).concat(persisted.slice(1))
      );
      ctx.fullMessages = replaced;
      ctx.commitMessages(replaced, {
        renderLimit: ctx.data.messageRenderLimit,
        scrollToLatest: true,
        scrollWithAnimation: false
      });
      track.track("orphan_user_recovery_attempt", {
        outcome: "success",
        conversationIdPrefix,
        ageMs,
        regenerateMs: Date.now() - startedAt
      });
    } else {
      track.track("orphan_user_recovery_failed", {
        errMsg: "empty_assistantMessages",
        conversationIdPrefix,
        ageMs
      });
    }
  } catch (error) {
    track.track("orphan_user_recovery_failed", {
      errMsg: String((error && (error.message || error.errMsg)) || error || "").slice(0, 160),
      conversationIdPrefix,
      ageMs
    });
  }
}
async function playAssistantMessages(ctx, assistantMessages, baseMessages) {
  ctx._currentPlaybackId = (ctx._playbackCounter = (ctx._playbackCounter || 0) + 1);

  const acc = decorateChatMessages(baseMessages.concat(assistantMessages));
  ctx.fullMessages = acc;
  ctx.commitMessages(acc, {
    renderLimit: ctx.data.messageRenderLimit,
    scrollToLatest: true,
    scrollWithAnimation: true,
    sending: false
  });
}

module.exports = {
  handleStreamingSend,
  _sendViaCloudFunction,
  _sendViaPollingStream,
  _sendViaExtendAIStream,
  _fallbackToCloudGenerate,
  _resumePendingFinalize,
  _regeneratePendingAssistant,
  _recoverOrphanLastUserMessage,
  playAssistantMessages
};
