# 微信小程序 / WeChat Mini Program

`apps/miniapp` contains the original native WXML/WXSS client, adapted for YourHer's self-hosted backend. It is a native client, not a web-view wrapper. The interface remains Chinese; `src/config.js` selects the language used for subsequent model replies. Web interface translations do not automatically translate native templates.

## 本地启动

1. 在仓库根目录执行 `npm start`，保持服务运行。Node.js 需要 24 或以上版本。
2. 打开微信开发者工具，导入仓库中的 `apps/miniapp` 目录，选择“小程序”。目录内已包含 `project.config.json`，源码目录是 `src/`。
3. 使用你自己的 AppID 或工具提供的测试号。仓库中的 `touristappid` 是占位符，不是原产品的 AppID。无需开通原 CloudBase 环境，无需构建 npm。
4. 默认客户端连接 `http://127.0.0.1:4317`。**仅在本地调试时**，在开发者工具“详情 → 本地设置”启用“不校验合法域名、web-view 域名、TLS 版本以及 HTTPS 证书”。正式部署保持域名校验开启。
5. 编译后进入桌面首页。可以布置桌子、打卡、继续上次对话或查看记录。首次发消息前阅读隐私说明并勾选同意，聊天右上角可进入记忆、心情、信件和关于。

后端默认使用明确标注的规则演示。要获得真实模型回复，在仓库根目录配置 `.env`，参照 [README](../README.md#quickstart)，然后重启服务。API 密钥始终保存在后端，不能写进小程序。

## 客户端配置

编辑 `apps/miniapp/src/config.js`：

```js
module.exports = {
  baseUrl: 'http://127.0.0.1:4317',
  locale: 'zh-CN',
  voicePlugin: false
};
```

`baseUrl` 是自托管后端地址，`locale` 须为后端支持的语言代码。改为 `en` 可让后续模型回复使用英文，小程序界面仍为中文。

`apps/miniapp/config.local.example.js` 提供同样的配置示例，内容可复制到 `src/config.js`。项目配置不包含生产 AppID 或环境标识；开发者工具生成的 `project.private.config.json` 被 Git 忽略。

## 真机与部署

手机上的 `127.0.0.1` 指向手机自身，不能连接电脑上的服务。真机预览需要手机可以访问的后端地址。正式使用时：

- 将服务部署到你控制的 HTTPS 域名，并配置后端 `PUBLIC_ORIGIN`。
- 将该域名加入小程序后台的 request 合法域名，修改客户端 `baseUrl`，开启域名校验。
- 使用自己的 AppID，补充部署者的隐私声明、服务类目和需要的接口权限，再通过微信审核。

协议参考：[项目配置](https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html)、[wx.request](https://developers.weixin.qq.com/miniprogram/dev/api/network/request/wx.request.html)。

## 页面和功能

包含原版桌面首页、新手引导、独立心情打卡页、聊天页、聊天内的记忆/信件/心情/关于面板、个人设置页、记录页、隐私说明、版本提示，以及反馈和账号数据分包。保留原立绘、日夜主题、多气泡、chips、回访提示、记忆确认条和改名提示。

聊天通过原客户端的轮询渲染流程接入共享后端。模型流式生成时每 300 ms 查询一次累积正文；完成后替换为持久化气泡，最后一个气泡携带续聊 chips。记忆提取、模型提示、个人资料和心情写入与网页版使用相同服务。

信件面板提供“写本周的信”按钮，本周至少三条用户消息后可生成。打开面板只读取已有信件，不触发付费模型请求。反馈支持一张小于 1 MB 的截图。“关于 → 账号与数据”可导出当前会话记录或确认删除全部数据。城市采用手动输入，不要求位置权限。

默认体验为免费自托管。可选微信模式支持 7 天体验卡、问卷续期和会员提示。体验期限按发生回复的自然日计数，会员提示可以关闭并继续聊天。

## 会话与数据

默认是设备访客会话：先向后端取得随机会话 Cookie，再将其保存在小程序本地存储，每次请求显式携带。后端只保存令牌摘要，所有记录按用户隔离。它不会把 `wx.login` 的 code 当作已验证身份，也不会连接原用户数据。

设备访客在换机或清空缓存之前可先导出数据。配置微信登录后，在首页的「账号与数据」关联微信。同一个微信账号可以在另一台设备恢复这个自托管实例里的数据。手机号是可选的绑定资料，恢复身份仍由微信登录验证。已有访客数据和已关联的账号在恢复时分开保存，可先导出访客记录。

## 可选微信服务

在服务端 `.env` 填入自己的 `WX_APP_ID` 和 `WX_APP_SECRET`，客户端导入时使用相同 AppID。有关手机号授权、订阅和支付的权限由该 AppID 控制。

| 功能 | 配置和操作 |
| --- | --- |
| 微信登录及手机号 | 在「账号与数据」调用微信授权。后端验证微信凭证并建立会话 |
| 信件订阅 | 设置 `WX_WEEKLY_TEMPLATE_ID`，使用含 `time1` 和 `thing2` 的模板。用户授权后收到下次生成的信件提醒 |
| 可选 30 天会员 | 设置 `WX_PAYMENT_ENABLED=true`，填写 `WX_PAY_APP_KEY`、`WX_PAY_OFFER_ID`、`WX_PAY_PRODUCT_ID`、`WX_PAY_PRICE_FEN`。后端查单确认金额后增加有效期 |

会员使用单个 30 天道具。待确认订单可在账号页查询。部署前须用自有账号联调订单、模板、授权和真机行为。原生产商户、数据及历史运营规则单独维护。实现参照[腾讯云微信虚拟支付接入说明](https://github.com/TencentCloudBase/skills/blob/main/skills/cloudbase-wechat-integration/references/virtual-payment.md)。

每个访客使用一条持续对话，与网页版一致；原来的 conversation ID 在兼容层映射到这条对话。小程序读取该会话的完整历史，长历史尚无分页。真实模型、语音插件和真机运行需要部署环境验收。

## 可选语音

语音默认关闭，以便没有插件授权的 AppID 也能导入项目。需要语音时，在自己的小程序后台申请 WechatSI 插件，并按照[插件使用指南](https://developers.weixin.qq.com/miniprogram/dev/framework/plugin/using.html)配置 `app.json`，再设置 `voicePlugin: true`。插件申请、可用版本、录音权限和隐私声明由部署者配置。文字聊天不依赖插件。

## 验证范围

```sh
npm test
npm run check:miniapp
```

自动测试覆盖原客户端 API → 原生请求适配器 → 实际 HTTP 服务的链路，包括共享会话、聊天/chips、记忆、偏好和心情；服务端测试覆盖信件、重放去重、隔离、导出和删除。源码检查覆盖 JavaScript 语法、JSON、十个页面入口、组件依赖和静态图片引用。

这些检查不等同于微信编译。本次整理环境未安装微信开发者工具，因此开发者工具编译、布局、字体渲染、手机预览和插件尚未现场验收；不能据此声称已通过微信审核。
