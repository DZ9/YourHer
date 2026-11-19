<div align="center">

# YourHer

### 熟悉的声音，慢慢建立的联结。

有个性、能记忆、可以持续交流的自托管 AI 陪伴。

[![CI](https://github.com/DZ9/YourHer/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DZ9/YourHer/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/License-MIT-8b7355.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-607a58.svg)](https://nodejs.org/)

[快速启动](#快速启动) · [组件](#按需使用组件) · [多语言配置](docs/i18n.md) · [架构](docs/architecture.md)

[English](README.md) · 简体中文

</div>

<table><tr>
<td align="center"><img src="docs/screenshots/first-meeting-english.jpg" width="250" alt="原版立绘与英文首次见面"><br><sub>从一句话开始</sub></td>
<td align="center"><img src="docs/screenshots/conversation.jpg" width="250" alt="连续对话与续聊 chips"><br><sub>把对话继续下去</sub></td>
<td align="center"><img src="docs/screenshots/memory.jpg" width="250" alt="可查看和删除的记忆"><br><sub>记下重要的小事</sub></td>
</tr></table>

YourHer 是可以由你塑造的 AI 陪伴者。选择名字、外观和说话风格，聊聊日常，分享在意的事，再回来接着聊。个性让对话有熟悉感，记忆让它能继续。流式多气泡回复、续聊 chips、长期记忆、心情打卡和每周信件共同构成完整体验。界面沿用原应用的人物立绘、日夜主题、右上纵向导航与滑入面板，同时保留通用品牌、多语言和模型配置。

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

## 持续对话，也由你掌控

| 对话 | 记忆 | 陪伴 |
| --- | --- | --- |
| 流式多气泡、续聊 chips | 事实分类、重要度、时间衰减 | 心情月历、每日打卡 |
| 回访续接、历史加载 | 过期、重复强化、遗忘 | 每周信件、偏好设置 |
| 服务端保存、断线恢复 | 记忆与改名确认条、撤销 | 访客与账户、反馈与问卷 |

## 按需使用组件

完整应用直接使用这些组件，不再另写一套演示逻辑。

| 组件 | 职责 |
| --- | --- |
| [conversation](packages/conversation) | chips、流式事件、气泡、回访续聊 |
| [memory](packages/memory) | 抽取、排序、过期、强化与遗忘 |
| [ui](packages/ui) | 聊天、面板、弹窗、语音和隐私组件 |
| [providers](packages/providers) | 模型适配、人设与离线演示 |
| [storage](packages/storage) | 账户、会话与持久化 |
| [i18n](packages/i18n) | 翻译、插值、回退和切换 |
| [companion-core](packages/companion-core) | 个人资料、心情与信件 |

## 可配置的多语言

内置英文与简体中文，可切换界面和后续回复语言。新增语言只需添加翻译 JSON 和配置项，无需修改页面分支。默认语言、回退、语音语言、方向、品牌和时区都可配置；已保存的对话和信件不会被切换语言改写。

[查看多语言配置指南 →](docs/i18n.md)

## 文档与开发

[架构](docs/architecture.md) · [功能清单](docs/web-port.md) · [验证记录](docs/validation.md) · [路线图](docs/roadmap.md) · [贡献指南](CONTRIBUTING.md)

```sh
npm test
npm run eval
```

目前 JSON 持久化仅支持单进程；尚无语义冲突自动解决、邮件验证、找回密码或 OAuth。真实模型、浏览器语音、Docker 和 RTL 需要实际环境验收。自托管版没有订阅限制，也不连接原商户支付。

## 许可证

[MIT](LICENSE) · [来源说明](docs/provenance.md) · [第三方声明](THIRD_PARTY_NOTICES.md)
