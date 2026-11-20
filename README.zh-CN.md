<div align="center">

# YourHer

### 熟悉的声音，慢慢建立的联结。

有个性、能记忆、可以持续交流的自托管 AI 陪伴。

[![CI](https://github.com/DZ9/YourHer/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DZ9/YourHer/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/License-MIT-8b7355.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-607a58.svg)](https://nodejs.org/)

[快速启动](#快速启动) · [微信小程序](docs/miniapp.md) · [多语言配置](docs/i18n.md) · [架构](docs/architecture.md)

[English](README.md) · 简体中文

</div>

<p align="center">
  <img src="docs/screenshots/first-meeting-english.jpg" width="250" alt="首次对话">
  <img src="docs/screenshots/conversation.jpg" width="250" alt="聊天和续聊建议">
  <img src="docs/screenshots/memory.jpg" width="250" alt="保存的记忆">
</p>

YourHer 是可以自己部署的 AI 陪伴应用。选择陪伴者的名字、外观和说话风格，接入模型，聊聊日常，再回来接着聊。

仓库包含网页版和由原产品整理而来的原生微信小程序，共用一套后端。

## 快速启动

需要 Node.js 24+，内置演示不需要安装第三方依赖。

```sh
git clone https://github.com/DZ9/YourHer.git
cd YourHer
npm start
```

打开 **[localhost:4317](http://localhost:4317)**。默认是明确标注的离线规则演示，不代表模型效果。

<details><summary><strong>接入真实模型</strong></summary>

复制 `.env.example` 为 `.env`，填写后重启：

```dotenv
MODEL_PROVIDER=openai-compatible
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=your-key
LLM_MODEL=your-model
```

密钥留在服务端。回复、信息抽取、摘要和信件可能分别调用 API，请核对所选提供方的兼容性和费用。

</details>

## 功能

- **对话：** 流式多气泡回复、续聊建议和聊天历史。
- **记忆：** 记下事实与偏好，查看和删除单条记忆。
- **个性设置：** 自定义名字、外观、说话风格，切换日夜主题。
- **日常记录：** 心情打卡、月历，以及根据聊天内容生成的每周信件。
- **数据管理：** 自己部署服务器，导出记录或删除账户数据。

网页内置英文和简体中文。新增语言与修改默认设置见[多语言配置指南](docs/i18n.md)。小程序保留原版中文界面，可配置模型回复语言。

## 微信小程序

运行 `npm start` 启动后端，然后用微信开发者工具导入 [`apps/miniapp`](apps/miniapp)。原版 WXML/WXSS 页面、人物立绘、聊天交互和滑入面板均包含在内。

默认连接 `http://127.0.0.1:4317`。使用你自己的 AppID 或测试号；本地网络、真机预览和可选语音插件的设置见[小程序启动指南](docs/miniapp.md)。

## 组件

应用共用对话、记忆和模型处理逻辑，各个包也可以单独用于其他项目。

包的职责与记忆模块接入示例见[组件指南](docs/components.md)。

## 文档与开发

[小程序启动](docs/miniapp.md) · [组件](docs/components.md) · [架构](docs/architecture.md) · [功能清单](docs/web-port.md) · [验证记录](docs/validation.md) · [路线图](docs/roadmap.md) · [贡献指南](CONTRIBUTING.md)

```sh
npm test
npm run eval
```

目前 JSON 持久化仅支持单进程；尚无语义冲突自动解决、邮件验证、找回密码或 OAuth。真实模型、浏览器语音、Docker 和 RTL 需要实际环境验收。自托管版没有订阅限制，也不连接原商户支付。

## 许可证

[MIT](LICENSE) · [来源说明](docs/provenance.md) · [第三方声明](THIRD_PARTY_NOTICES.md)
