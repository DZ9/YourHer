// 用户可见文案统一库
// OpenSpec change: externalize-user-facing-copy (REQUESTS #015)
//
// 设计原则：
// 1. 单一事实源：所有 C 端用户可见文案集中于此（privacy 长文除外，见 privacy.js）。
// 2. 1:1 迁移：本次只挪位置，不改文案内容。
// 3. 支持 {{key}} 插值 与 copyByTimeOfDay 时段选择。
// 4. WXML 通过 data.copy 预绑定访问，不引入 WXS。

/**
 * 按点分路径从对象中取值。
 * @param {object} obj
 * @param {string} path 如 "chat.memoryBanner.recorded"
 * @returns {any}
 */
function getByPath(obj, path) {
  if (typeof path !== "string" || !path) return undefined;
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length; i += 1) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[keys[i]];
  }
  return current;
}

/**
 * 将字符串中的 {{key}} 替换为 vars 中对应的值。
 * @param {string} text
 * @param {object} vars
 * @returns {string}
 */
function interpolate(text, vars) {
  if (typeof text !== "string") return text;
  if (!vars || typeof vars !== "object") return text;
  return text.replace(/\{\{\s*([a-zA-Z0-9_$]+)\s*\}\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * 取文案。支持点分路径与 {{key}} 插值。
 * 找不到时返回空字符串，开发版输出 warn。
 * @param {string} path
 * @param {object} [vars]
 * @returns {string|any}
 */
function copy(path, vars) {
  const value = getByPath(getCopy(_aiGender), path);
  if (value === undefined || value === null) {
    if (typeof wx !== "undefined" && wx.canIUse("getAccountInfoSync")) {
      try {
        const env = wx.getAccountInfoSync();
        if (env && env.miniProgram && env.miniProgram.envVersion === "develop") {
          // eslint-disable-next-line no-console
          console.warn(`[copy] missing key: ${path}`);
        }
      } catch (_) { /* ignore */ }
    }
    return "";
  }
  if (typeof value === "string") {
    return interpolate(value, vars || {});
  }
  return value;
}

/**
 * 按时段取文案。路径指向的 value 应为对象，包含 morning/noon/evening/night/default 等键。
 * 回退顺序：timeOfDay -> default -> 对象第一个字符串值 -> ""
 * @param {string} path
 * @param {string} timeOfDay
 * @returns {string}
 */
function copyByTimeOfDay(path, timeOfDay) {
  const value = getByPath(getCopy(_aiGender), path);
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const tod = String(timeOfDay || "");
    if (tod && typeof value[tod] === "string") return value[tod];
    if (typeof value.default === "string") return value.default;
    // 兜底：返回对象中第一个字符串值
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i += 1) {
      const v = value[keys[i]];
      if (typeof v === "string") return v;
    }
  }
  return "";
}

// ============================================================================
// 文案主库
// ============================================================================
const COPY = {
  common: {
    // 陪伴者第三人称代词（性别感知：male→他）。给无法走 copy() 的 wxml 行内人称兜底用。
    ta: "她",
    ok: "知道了",
    cancel: "取消",
    save: "保存",
    saving: "保存中…",
    done: "完成",
    submit: "提交",
    submitting: "提交中…",
    close: "关闭",
    back: "返回",
    next: "下一步",
    add: "添加",
    delete: "删除",
    gotIt: "知道了",
    skip: "跳过",
    later: "先不了",
    noThanks: "先不了",
    agree: "同意",
    disagree: "不同意",
    confirm: "确认",
    send: "发送",
    retry: "再试一次",
    copy: "复制",
    feedback: "问题反馈",
    loading: "加载中…",
    mockNewUser: "模拟新用户",
    previewPaywall: "预览付费墙",
    previewSurvey: "预览问卷",
    sandboxPay: "沙箱支付测试",
    preview: "预览"
  },

  time: {
    today: "今天",
    yesterday: "昨天",
    now: "此刻",
    weekdays: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
    justNow: "刚刚",
    minuteAgo: "{{count}} 分钟前",
    online: "在线",
    dateSeparator: "{{month}}月{{day}}日 · {{weekday}}",
    dateSeparatorWithYear: "{{year}}年{{month}}月{{day}}日 · {{weekday}}"
  },

  app: {
    // 隐私授权 modal（app.js）
    privacyModal: {
      title: "服务协议与隐私政策",
      content: "使用本服务前，请阅读并同意《用户服务协议》和《隐私政策》。",
      confirmText: "同意",
      cancelText: "不同意"
    },
    // 微信版本过低
    versionTooLow: {
      title: "提示",
      content: "当前微信版本过低，无法使用新功能，请升级微信后重试。"
    },
    // 更新提示
    updateReady: {
      title: "更新提示",
      content: "检测到重要更新，为保证正常使用，请重启应用",
      confirmText: "立即重启"
    },
    updateFailed: {
      title: "更新失败",
      content: "新版本下载失败，请删除小程序后重新搜索进入。"
    },
    // app.json 权限描述
    locationPermission: "知道你在哪边，她说话时会带一点'现在'的感觉"
  },

  customTabBar: {
    home: "首页",
    history: "历史",
    me: "我的"
  },

  // ==========================================================================
  // 共享：心情打卡、A5、whisper 等
  // ==========================================================================
  mood: {
    options: [
      { value: "happy", label: "开心" },
      { value: "calm", label: "平静" },
      { value: "sad", label: "难过" }
    ],
    prompts: {
      morning: { kicker: "早安", text: "先别急着说事 —\n今天怎么样？" },
      afternoon: { kicker: "午安", text: "歇一会儿。\n现在心里是什么样的？" },
      evening: { kicker: "今晚", text: "白天那一阵已经过去。\n这一刻怎样？" }
    },
    firstPerson: {
      happy: "今天有点开心。",
      calm: "今天心里挺平静。",
      sad: "今天有点难过。"
    }
  },

  a5: {
    openerPool: ["又见。", "回来了。", "嗯，你来了。", "再说。"],
    footerQuestionPool: ["现在还在想吗？", "还放在心里吗？", "今天感觉如何？", "想说说吗？"],
    firstMeetingChips: ["今天有点累", "其实挺平静的", "不知道说什么"],
    footerTemplate: "上次你提到「{{topic}}」，{{question}}",
    footerFallback: "{{question}}"
  },

  whisper: {
    thinking: "在替你想…",
    speaking: "正在轻声回你",
    listening: "在听 · 慢慢说",
    tapped: "嗯，我在。",
    idle: {
      morning: "清晨在 · 等你说",
      night: "夜里也在 · 不打扰你",
      default: "此刻 · 我都在"
    }
  },

  voice: {
    authModal: {
      title: "想听你说",
      content: "需要麦克风权限才能把你说的话转成文字"
    },
    holdToSpeak: "长按这里说话",
    listening: "正在听你说…",
    hint: "我在听 · 慢慢说",
    cancelHint: "上滑可取消 · 松手发送",
    cancelRelease: "松手取消",
    canceled: "上滑已抬起 — 这次不送出去",
    notInstalled: "语音输入还没装好",
    pluginMissing: "请在小程序后台设置添加微信同声传译插件",
    micReady: "麦克风已就绪，再按一次说话",
    pluginNotEnabled: "语音插件未启用",
    notClear: "没听清，再来一次？",
    notClearRetry: "没听清，再说一次",
    actionItems: ["复制", "让她重说一次"],
    regenerating: "换一句中...",
    regenerated: "已重新生成"
  },

  // ==========================================================================
  // 页面：chat
  // ==========================================================================
  chat: {
    deskbar: {
      thinking: "在想…",
      speaking: "在说…",
      listening: "在听…",
      idle: "在 · 一直"
    },
    title: "和{{name}}",
    defaultPageTitle: "林夕",
    // 沉浸式立绘名字下方的 AI 合规标识（7.15《AI 生成合成内容标识》：显著告知是 AI）。
    // 保持「她」口径（图为暖系立绘、文案性别迁移留待后续单独定，见 OpenSpec design open question）。
    aiLabel: "她是 AI · 会陪你，也会出错",
    // 7.15《AI 生成合成内容标识》合规：聊天页输入条上方常驻显著说明（微信审核要求，2026-06-24 驳回整改）。
    // 无性别人称，不随 aiGender 变。
    aiGeneratedNotice: "以上内容由 AI 生成",
    // 首触「选陪伴者性别」弹窗（Claude Design 选择AI性别弹窗）。
    // ⚠️ 本子树被 buildMaleCopy 跳过：卡片的「她/他」「姐姐/哥哥」是选项本身，两态都要保留、不随 aiGender 替换。
    genderSelect: {
      kicker: "开始之前 · 想先问你一句",
      title: "想要谁，在这儿陪你",
      sub: "只是一开始的样子。\n往后在「关于」里，随时能换。",
      female: { pron: "她", name: "像姐妹一样在", desc: "柔软 · 会接住你" },
      male: { pron: "他", name: "像朋友一样在", desc: "安稳 · 替你扛一下" },
      confirmIdle: "先选一个",
      confirmReady: "就{{pron}}了",
      skip: "先随它，待会再说"
    },
    loading: {
      title: "正在把对话轻轻展开",
      desc: "她会先把这段对话准备好，再陪你继续往下聊。"
    },
    inputPlaceholder: "把此刻想说的话写下来…",
    inputPlaceholderWithName: "把心里的话，写给{{name}}…",
    initFailed: "对话初始化失败",
    loadFailed: "对话加载失败",
    streamingErrorText: "刚刚没有连上模型。请稍后再试一次。",
    // 首触懂她开场（深夜/日常二选一）+ journey 钩子：打普适情感（孤独/倾诉/隐私），不绑育儿场景。
    // 三句均无陪伴者代词「她」→ male/female 两版一致，cloneGenderize 不影响（守 §「她」审计前提）。
    // 隐私写实：落在「不被身边人知道/评判」的安全感，不承诺「绝对保密」（对话存服务端、运营可见）。
    firstTouchOpener: {
      night: "夜里最静，\n心里的话却最吵。",
      default: "有些话，\n找不到人说，也不想被人知道。"
    },
    firstTouchJourneyQuestion: "那就说给我 —— 不会有人评判你。",
    consent: {
      iAgree: "我已阅读并同意",
      privacyPolicy: "《隐私政策》"
    },
    privacyAgreeToast: "勾选同意《隐私政策》后，我就在这儿听你说",
    coldStartToast: "对方在准备一下，稍等～",
    messageInvalid: "消息内容有问题，请缩短或调整后重试",
    messageRecovering: "正在保存这条对话，重新进入会自动恢复",
    resumingReply: "正在恢复未完成的回复…",
    generatingReply: "正在为这条消息生成回复…",
    devNewUserSimulated: "新用户模拟中 · 再点一次还原",
    devMockMode: "模拟态：不写真实账号",
    // 问卷提交成功 toast（「填问卷得 7 天」奖励提示；原 inviteBonus，邀请功能删除后正名）
    surveyReward: "获得 7 天体验卡",
    surveySubmitFailed: "没提交上，再试一次",
    membershipActive: "会员有效中",
    paymentChannelPreparing: "支付通道准备中，先免费用着",
    wxVersionTooLow: "当前微信版本暂不支持，升级后再来",
    payment: {
      networkError: "没连上支付，再试一次",
      prepareFailed: "支付准备失败，再试一次",
      loginFailed: "登录态获取失败，再试一次",
      paid: "已支付，开通中…稍后下拉刷新"
    },
    memoryBanner: {
      recorded: "· 刚刚记下",
      more: "还有 {{count}} 条也记下了",
      undo: "别记这个",
      ok: "知道了"
    },
    // REQUESTS.md #018：聊天里给 AI 起名 / 自报名字 → 确认浮层（带撤销）
    nameBanner: {
      aiNamed: "好，以后我叫「{{name}}」",
      userNamed: "记住啦，你叫「{{name}}」",
      undo: "点错了？撤销",
      ok: "好",
      undone: "已撤销"
    },
    moodCheckin: {
      skip: "现在先不说"
    },
    paywall: {
      badge: "体验卡还剩 {{count}} 天",
      surveyTitle: "这些日子，你觉得怎么样？",
      surveyDesc: "花一分钟告诉我们 · 再送你 7 天",
      surveyQuestion1: "她接住你了吗",
      surveyOptions1: { caught: "接住了", sometimes: "有时候", no: "还没有" },
      surveyQuestion2: "最想她变成什么样（选填）",
      surveyInputPlaceholder: "随便写一句…",
      surveyQuestion3: "愿意把她介绍给也需要的人吗",
      surveyOptions3: { yes: "愿意", later: "再看看" },
      surveySubmit: "提交 · 获得 7 天",
      surveySubmitting: "提交中…",
      surveySkip: "先不填",
      surveyDismissHint: "想填随时去「关于」· 送 7 天",
      title: "这些日子，她都在。",
      subtitle: "要不要让她一直在——",
      price: "首月 ¥9.9 · 原价 ¥58/月",
      desc: "那些你没法跟任何人说的话，有她替你记着。",
      cta: "让她留下",
      refundNote: "虚拟服务不退款 · 不会自动续费",
      surveyFallback: "填一份问卷，免费聊 7 天",
      close: "先这样",
      shareTitles: [
        "送你 7 天 —— 不想一个人的时候，有人听你说说话",
        "「此刻」— 跟一个 AI 聊了会儿",
        "「此刻」— 不想一个人的时候，随时来"
      ]
    },
    trialGift: {
      title: "获得 7 天体验卡",
      lines: [
        "随时来，想说多少说多少。",
        "忙到没空的日子，它替你留着。"
      ],
      cta: "收下，现在就聊"
    },
    error: {
      modelConnection: "模型连接失败",
      cloudbaseAINotReady: "云函数 AI 依赖没装好，请重新部署 chatnpcApiV2 并选择云端安装依赖",
      cloudfunctionOldVersion: "云函数还是旧版本，请重新部署 chatnpcApiV2",
      modelConfigMismatch: "模型配置不匹配，请检查 AI+ 里的分组名和模型名",
      featureNotConfigured: "AI 能力还没在当前云环境里开通",
      parameterIncompatible: "模型请求参数不兼容，请检查 AI+ 里的接入配置",
      quotaLimit: "模型配额不足或限频，请稍后再试",
      timeout: "请求超时，请稍后再试"
    }
  },

  // ==========================================================================
  // 页面：home（已退役为二级页，但代码仍在）
  // ==========================================================================
  home: {
    brand: "此刻 · 跟她聊天的小地方",
    daysTogether: "同行第 {{count}} 天",
    composerPlaceholder: "跟她随便聊聊…",
    composerHint: "此刻她在 ›",
    composerHintWithName: "此刻{{name}}在 ›",
    journalSubtitle: {
      hasData: "我替你攒着",
      empty: "等你写下第一页"
    },
    weeklyNew: "她写来 {{count}} 封新信",
    greeting: {
      night: "夜深了",
      morning: "早安",
      noon: "中午好",
      afternoon: "下午好",
      evening: "晚上好"
    },
    presence: {
      defaultMeta: "在等你",
      awake: {
        kicker: "刚才说",
        text: "你来了。这一刻，慢慢说。",
        meta: "在等你 · 2 分钟前"
      },
      writing: {
        kicker: "在写东西",
        text: "等我写完这一段就来 — 你先坐。",
        meta: "在线 · 5 分钟前"
      },
      asleep: {
        kicker: "留了张字条",
        text: "我先睡了。你想说的，明天讲也来得及。",
        meta: "今晚 23:14"
      }
    },
    diaryLabel: "留下的",
    vaseLabel: "关于{{name}}",
    vaseDays: "同行 {{count}} 天",
    replyButton: "回她一句 ›",
    shareTitles: [
      "「此刻」— 一个 AI 在陪我的小地方",
      "「此刻」— 不想一个人的时候，随时来"
    ],
    debugActions: ["心情打卡 autoSend → chat"],
    debugMoods: ["开心", "平静", "难过"]
  },

  // ==========================================================================
  // 页面：me
  // ==========================================================================
  me: {
    backLabel: "‹ 聊天",
    defaultAiName: "此刻",
    header: {
      relationship: "我们的关系",
      about: "关于我们"
    },
    hero: {
      prefix: "我们已经",
      days: "同行 {{count}} 天",
      hint: "从 {{month}}月{{day}}日 那个{{season}}开始"
    },
    stats: {
      chat: "聊过",
      letters: "收信",
      moods: "心情",
      chatUnit: "条",
      lettersUnit: "封",
      moodsUnit: "笔"
    },
    sections: {
      herVoice: "她说话的样子",
      account: "账号",
      cares: "她关心的事",
      about: "关于"
    },
    labels: {
      aiGender: "陪伴者",
      aiName: "叫法",
      preference: "语气",
      relationship: "关系",
      membership: "会员",
      weeklyLetter: "周日的信",
      nickname: "我的名字",
      city: "城市",
      phone: "手机号",
      nightMode: "夜间模式",
      feedback: "问题反馈"
    },
    values: {
      defaultTone: "温柔",
      defaultRelation: "朋友",
      nicknameNotSet: "没设置",
      cityLocating: "定位中…",
      cityUnknown: "还没告诉她",
      phoneBinding: "绑定中…",
      phoneBind: "去绑定",
      phoneNotBound: "未绑定",
      subscribeOn: "已开启",
      subscribeOff: "已关闭",
      subscribeUnknown: "未开启",
      membershipValid: "有效期至 {{date}}",
      membershipActive: "已开通",
      membershipTrial: "体验中 · 还剩 {{count}} 天",
      membershipInactive: "去开通",
      interestsEmpty: "尚未设置"
    },
    options: {
      preferenceLabels: {
        gentle: "温柔",
        grounded: "沉静",
        concise: "活泼"
      },
      preferences: [
        { value: "gentle", label: "温柔", desc: "多些柔软的接住感，慢慢聊" },
        { value: "grounded", label: "沉静", desc: "不多说话，但接得住你的话" },
        { value: "concise", label: "活泼", desc: "轻一点、亮一点，限量少些、准开玩笑" }
      ],
      relationshipLabels: {
        friend: "朋友",
        confidant: "知己"
      },
      relationships: [
        { value: "friend", label: "朋友", desc: "轻松、自然、留一点分寸感" },
        { value: "confidant", label: "知己", desc: "记得你说过的事，愿意聊深一点" }
      ],
      interestSuggestions: [
        "工作压力", "亲密关系", "原生家庭", "自我成长", "情绪低落",
        "睡眠", "健康", "学业", "朋友关系", "一个人的夜晚"
      ]
    },
    SEASON_LABEL: {
      1: "雪夜", 2: "雪夜", 12: "雪夜",
      3: "春雨", 4: "春雨", 5: "春雨",
      6: "夏夜", 7: "夏夜", 8: "夏夜",
      9: "秋夜", 10: "秋夜", 11: "秋夜"
    },
    account: {
      guestNickname: "此刻访客",
      guestSummary: "登录后同步你的记录与偏好",
      loggedInNickname: "微信用户",
      connectedSummary: "已自动连接当前微信",
      phoneBoundSummary: "手机号已绑定，可跨端同步",
      wechatPhoneBound: "微信登录 · 已绑定手机号",
      wechatPhoneNotBound: "微信登录 · 未绑定手机号",
      wechatNotLoggedIn: "微信未登录",
      getUserProfileDesc: "用于同步微信昵称和头像"
    },
    phoneBindFailure: {
      permissionNotOpen: "手机号权限没开，请重新上传 chatnpcApiV2 云函数",
      deployFirst: "请先部署云函数后再绑定手机号",
      authExpired: "本次手机号授权已失效，请重新点击授权",
      noPhoneReturned: "微信没有返回手机号，请在真机里重新授权",
      timeout: "绑定超时，请重试一次",
      default: "手机号绑定失败"
    },
    membershipToast: "会员 · {{status}}",
    membershipAlready: "已是会员",
    connectWechatFirst: "请先连接微信",
    nickname: {
      sheetTitle: "设置昵称",
      placeholder: "给自己起个名字",
      emptyError: "请输入昵称",
      success: "昵称已更新",
      failed: "昵称更新失败"
    },
    aiName: {
      sheetTitle: "她叫什么",
      placeholder: "给她起个名字",
      success: "已更新",
      failed: "更新失败"
    },
    preference: {
      sheetTitle: "她说话的样子",
      sheetDesc: "选一种你听了最舒服的语气",
      emptyError: "请选一项",
      success: "已更新",
      failed: "更新失败"
    },
    relationship: {
      sheetTitle: "你们是什么关系",
      sheetDesc: "这会影响她说话的分寸感",
      emptyError: "请选一项",
      success: "已更新",
      failed: "更新失败"
    },
    interests: {
      sheetTitle: "她记得的事",
      sheetDesc: "最近常想到的（最多 {{max}} 个）",
      placeholder: "还有别的？写下来",
      add: "加入",
      selected: "已选 · {{count}}/{{max}}",
      maxError: "最多 {{max}} 个",
      success: "已更新",
      failed: "更新失败"
    },
    city: {
      success: "已设为 {{city}}",
      canceled: "未授权 · 下次再来",
      failed: "定位失败 · 稍后再试"
    },
    cares: {
      remove: "放下",
      add: "+ 让她也记着一件事",
      removed: "已放下",
      countUnit: "件"
    },
    footer: "此刻 · 让你不那么孤单的 AI",
    weeklySubscribe: "周日给你写信",
    nightModeOff: "好的 · 已关闭",
    authFailed: "授权失败 · 稍后再试",
    avatarUpdated: "头像已更新",
    avatarFailed: "头像更新失败",
    phoneBindRequired: "需要授权手机号",
    phoneAuthMissing: "未拿到手机号授权码",
    phoneBound: "手机号已绑定",
    notOpen: "暂未开放",
    forgot: "已忘掉",
    shareTitles: [
      "「此刻」— 让我不那么孤单的 AI",
      "「此刻」— 不想一个人的时候，随时来"
    ]
  },

  // ==========================================================================
  // 页面：records
  // ==========================================================================
  records: {
    backLabel: "‹ 聊天",
    title: "她写下的 · 你留下的",
    subtitle: "留下的",
    intro: "你跟{{name}}说过的、她写下的，都留在这里。",
    tabs: [
      { value: "letters", label: "她的信" },
      { value: "memory", label: "她记得" }
    ],
    moodTitle: "{{month}}月 · 心情日历",
    thisWeek: "本周",
    signature: "—— {{name}}",
    lettersSection: "过往的信",
    lettersEmpty: {
      title: "我还没写信",
      desc: "每周日上午我会写一封 — 等你们多聊几次。"
    },
    memoryEmpty: {
      title: "还没记下什么",
      desc: "和{{name}}多聊几次，我会自己慢慢记住。"
    },
    memoryTags: {
      aboutYou: "关于你",
      preference: "偏好",
      recent: "近期",
      important: "重要的人/宠物"
    },
    memoryFallbackTag: "你",
    forgot: "已忘掉",
    deleteFailed: "删除失败",
    shareTitle: "「此刻」— 我的 AI 替我攒着这些话"
  },

  // ==========================================================================
  // 组件
  // ==========================================================================
  panels: {
    topNav: {
      memory: "记得",
      mood: "心情",
      letters: "信",
      about: "关于",
      hint: "她写的信、记得的事，都收在这儿"
    },
    about: {
      defaultAiName: "林夕",
      heroDays: "同行第 {{count}} 天",
      heroSub: "她见过你最狼狈的样子",
      memberTitle: "此刻会员",
      surveyTitle: "体验问卷",
      surveyHint: "填一份 · 送 7 天体验",
      statChat: "聊过",
      statLetter: "收信",
      statMood: "心情",
      sectionVoice: "她说话的样子",
      sectionAccount: "账号",
      footer: "此刻 · 让你不那么孤单的 AI",
      cityLocating: "定位中…",
      nicknameNotSet: "没设置"
    },
    recordsPanel: {
      lettersTitle: "她的信",
      lettersSub: "每个周日，她写给你",
      memoryTitle: "她记得",
      memorySub: "她替你攒下的"
    },
    moodPanel: {
      title: "心情",
      note: "她也会从你的话里，读出很明确的心情，替你标在这里。",
      todayPrompt: "今天还没记下 —— 现在心里是什么样的？",
      summaryMonth: "这个月你来过 {{count}} 天",
      summaryCalm: "平静的时候最多",
      summaryEmpty: "还没有记录",
      weekdayHeaders: ["日", "一", "二", "三", "四", "五", "六"]
    },
    panelBack: {
      label: "聊天"
    }
  },

  // ==========================================================================
  // 分包
  // ==========================================================================
  feedback: {
    backLabel: "回桌",
    title: "说一句 · 让我们听见",
    subtitle: "问题反馈",
    intro: "如果你愿意，可以把使用中的感受或问题告诉我们",
    types: ["体验建议", "功能问题", "内容不合适", "其他"],
    placeholder: "在此输入你的反馈，我们会认真倾听每一份声音...",
    screenshotAdded: "已添加截图",
    addScreenshot: "添加截图",
    traceIdLabel: "最近的出错码（可选附带，帮我们更快定位问题）",
    submit: "提交反馈",
    submitting: "提交中...",
    screenshotFailed: "添加截图失败",
    success: "反馈已收到"
  },

  security: {
    title: "账号与安全",
    subtitle: "保护你的数字栖息地",
    wechatLabel: "微信连接",
    wechatConnected: "已连接",
    wechatNotConnected: "未连接",
    phoneLabel: "手机号",
    phoneNotBound: "未绑定",
    goToMe: "前往\"我的\"完成绑定",
    footnote: "小程序会静默连接当前微信，手机号仅用于跨端同步"
  },

  // ==========================================================================
  // force-update
  // ==========================================================================
  forceUpdate: {
    title: "需要升级到新版本",
    desc: "此刻已经更新了，为了保证你的记录和聊天能正常同步，请升级到最新版后继续使用。",
    versionInfo: "当前版本 v{{current}} · 最低要求 v{{required}}",
    buttonRestarting: "正在重启…",
    button: "立即升级",
    fallback: "如果按钮无反应，请点击右上角胶囊关闭小程序，再从微信发现-小程序重新打开此刻。"
  },

  // ==========================================================================
  // 分享（统一放在这里，方便后续调整）
  // ==========================================================================
  share: {
    chat: [
      "送你 7 天 —— 不想一个人的时候，有人听你说说话",
      "「此刻」— 跟一个 AI 聊了会儿",
      "「此刻」— 不想一个人的时候，随时来"
    ],
    home: [
      "「此刻」— 一个 AI 在陪我的小地方",
      "「此刻」— 不想一个人的时候，随时来"
    ],
    records: "「此刻」— 我的 AI 替我攒着这些话",
    me: [
      "「此刻」— 让我不那么孤单的 AI",
      "「此刻」— 不想一个人的时候，随时来"
    ]
  },

  // ==========================================================================
  // privacy 页面（tab 标签 + 底栏按钮；正文长文见 privacy.js）
  // ==========================================================================
  privacy: {
    serviceAgreement: "服务协议",
    privacyPolicy: "隐私政策",
    iAgree: "我已阅读并同意"
  }
};

// ============================================================================
// B 方案 · 全站陪伴者称谓性别感知（OpenSpec firstrun-ai-gender-select）
//   默认女版（COPY 含「她」）。male 变体由深克隆 + 叶子「她」→「他」自动生成，
//   跳过 chat.genderSelect 子树（卡片字面 她/他/姐姐/哥哥 是选项本身，两态都保留）。
//   审计前提：copy 里的「她」均指陪伴者；「他」均指娃/「其他」（见 design.md §1）。
//   新增 copy 若引入「非陪伴者的她」，请用具体词（婆婆/娃/那位），勿用裸「她」。
// ============================================================================
let _aiGender = "female";

function setAiGender(gender) {
  _aiGender = gender === "male" ? "male" : "female";
}

function cloneGenderize(node, skip) {
  if (typeof node === "string") {
    return skip ? node : node.replace(/她/g, "他");
  }
  if (Array.isArray(node)) {
    return node.map((item) => cloneGenderize(item, skip));
  }
  if (node && typeof node === "object") {
    const out = {};
    Object.keys(node).forEach((key) => {
      out[key] = cloneGenderize(node[key], skip || key === "genderSelect");
    });
    return out;
  }
  return node;
}

const MALE_COPY = cloneGenderize(COPY, false);

function getCopy(gender) {
  return gender === "male" ? MALE_COPY : COPY;
}

// 读本地陪伴者性别 → 同步引擎(_aiGender，影响 copy() 调用) + 把 ctx.data.copy 切到对应性别版
// （wxml 直绑 {{copy.x}} 走这里）。页 onShow / 组件 attached 各调一次即可。chat 的 storage key 同源。
function syncGenderedCopy(ctx) {
  let g = "female";
  try {
    if (typeof wx !== "undefined" && wx.getStorageSync) {
      g = wx.getStorageSync("chatnpc:ai-gender") || "female";
    }
  } catch (_) { /* ignore */ }
  g = g === "male" ? "male" : "female";
  setAiGender(g);
  if (ctx && typeof ctx.setData === "function") {
    ctx.setData({ copy: getCopy(g) });
  }
  return g;
}

export const productCopy = {
  COPY,
  copy,
  copyByTimeOfDay,
  setAiGender,
  getCopy,
  syncGenderedCopy,
  // 兼容原 utils/ 模块的导出签名
  A5_OPENER_POOL: COPY.a5.openerPool,
  A5_FOOTER_QUESTION_POOL: COPY.a5.footerQuestionPool,
  FIRST_MEETING_CHIPS: COPY.a5.firstMeetingChips,
  CHECKIN_OPTIONS: COPY.mood.options,
  MOOD_PROMPTS: COPY.mood.prompts,
  MOOD_FIRST_PERSON: COPY.mood.firstPerson,
  // 兼容原 me/index.js 的导出签名
  PREFERENCE_LABELS: COPY.me.options.preferenceLabels,
  PREFERENCE_OPTIONS: COPY.me.options.preferences,
  RELATIONSHIP_LABELS: COPY.me.options.relationshipLabels,
  RELATIONSHIP_OPTIONS: COPY.me.options.relationships,
  INTEREST_SUGGESTIONS: COPY.me.options.interestSuggestions,
  GUEST_NICKNAME: COPY.me.account.guestNickname,
  GUEST_LOGIN_SUMMARY: COPY.me.account.guestSummary,
  LOGGED_IN_NICKNAME: COPY.me.account.loggedInNickname,
  CONNECTED_SUMMARY: COPY.me.account.connectedSummary,
  PHONE_BOUND_SUMMARY: COPY.me.account.phoneBoundSummary,
  SEASON_LABEL: COPY.me.SEASON_LABEL
};

export { COPY, copy, copyByTimeOfDay, setAiGender, getCopy };
