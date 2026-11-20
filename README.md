<div align="center">

# YourHer

### A familiar voice. A connection that grows.

A self-hosted AI companion with personality, memory, and conversations that carry on.

[![CI](https://github.com/DZ9/YourHer/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DZ9/YourHer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-8b7355.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-607a58.svg)](https://nodejs.org/)

[**Get started**](#quickstart) · [**Features**](#features) · [**Languages**](docs/i18n.md) · [**Documentation**](#documentation)

English · [简体中文](README.zh-CN.md)

</div>

<p align="center">
  <img src="docs/screenshots/first-meeting-english.jpg" width="250" alt="First conversation">
  <img src="docs/screenshots/conversation.jpg" width="250" alt="Chat with suggested replies">
  <img src="docs/screenshots/memory.jpg" width="250" alt="Saved memories">
</p>

YourHer is an AI companion you can host yourself. Choose a name, appearance and speaking style, connect your model, and come back to a conversation that remembers what you've shared.

Run the web app on your own server, or reuse its conversation and memory packages in your own project.

## Quickstart

**Node.js 24+**. No dependency installation is needed for the built-in demo.

```sh
git clone https://github.com/DZ9/YourHer.git
cd YourHer
npm start
```

Open **[localhost:4317](http://localhost:4317)**.

The app starts in a clearly labeled **offline demo**. Connect a model for natural conversation; scripted demo responses do not represent model quality.

<details>
<summary><strong>Connect an OpenAI-compatible model</strong></summary>

Copy `.env.example` to `.env`, then set:

```dotenv
MODEL_PROVIDER=openai-compatible
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=your-key
LLM_MODEL=your-model
```

Restart the server. Keys stay on the server. Replies, fact extraction, summaries and letters may make separate API calls and incur provider charges. Check compatibility with the model you choose.

</details>

<details>
<summary><strong>Run with Docker</strong></summary>

```sh
npm run docker
```

Open <http://localhost:4317>. Records persist in a named volume. Set `PUBLIC_ORIGIN` to your exact HTTPS origin when placing the app behind a reverse proxy. The supplied Compose file publishes its port on loopback.

</details>

## Features

| Feature | What you get |
| --- | --- |
| Conversation | Streaming replies, multiple bubbles, reply chips and saved history |
| Memory | Saved facts and preferences, with individual memories you can view and forget |
| Personalization | Companion name, appearance, speaking style, and day/night themes |
| Daily life | Mood check-ins, a calendar and weekly letters |
| Data control | Self-hosting, record export and account data deletion |

The web interface includes English and Simplified Chinese. Add languages and configure defaults in [`companion.config.json`](companion.config.json); see the [language guide](docs/i18n.md).

## How it works

The web app keeps model calls, memory processing and data storage on your server.

![YourHer architecture](docs/diagrams/architecture.svg)

Replies are saved before optional fact analysis. Accepted memories enter later context; extraction failures do not discard the conversation.

![YourHer conversation lifecycle](docs/diagrams/conversation-loop.svg)

## Components

The applications share the same conversation, memory and model pipeline. Individual packages can also be reused in another app.

See the [component guide](docs/components.md) for package boundaries and a memory integration example.

## Clients

| Client | Getting started | Status |
| --- | --- | --- |
| **Web app** | [Quickstart](#quickstart) | Primary client · English and Chinese |
| WeChat Mini Program | [Setup guide](docs/miniapp.md) | Optional native client · Chinese interface |

<details>
<summary>About the optional Mini Program</summary>

The native client preserves the original WXML/WXSS pages, portrait artwork and chat interactions, and connects to the same backend. It requires WeChat DevTools and your own AppID or a test account. DevTools compilation and physical-device preview have not yet been verified. Its model reply language is configurable; the interface remains Chinese.

See the [setup guide](docs/miniapp.md) for local networking and optional voice support.

</details>

## Documentation

[Developer guide](docs/development.md)

## License

Licensed under the [MIT License](LICENSE).
