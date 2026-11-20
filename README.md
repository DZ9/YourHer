<div align="center">

# YourHer

### A familiar voice. A connection that grows.

A self-hosted AI companion with personality, memory, and conversations that carry on.

[![CI](https://github.com/DZ9/YourHer/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DZ9/YourHer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-8b7355.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-607a58.svg)](https://nodejs.org/)

[**Get started**](#quickstart) · [**Mini Program**](docs/miniapp.md) · [**Languages**](docs/i18n.md) · [**Documentation**](#documentation)

English · [简体中文](README.zh-CN.md)

</div>

<p align="center">
  <img src="docs/screenshots/first-meeting-english.jpg" width="250" alt="First conversation">
  <img src="docs/screenshots/conversation.jpg" width="250" alt="Chat with suggested replies">
  <img src="docs/screenshots/memory.jpg" width="250" alt="Saved memories">
</p>

YourHer is an AI companion you can host yourself. Choose a name, appearance and speaking style, connect your model, and come back to a conversation that remembers what you've shared.

The repository includes a web app and the original native WeChat Mini Program, adapted to use the same backend.

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
docker compose up --build
```

Open <http://localhost:4317>. Records persist in a named volume. Set `PUBLIC_ORIGIN` to your exact HTTPS origin when placing the app behind a reverse proxy. The supplied Compose file publishes its port on loopback.

</details>

## Features

- **Conversation.** Streaming replies, multiple chat bubbles, suggested replies and saved history.
- **Memory.** Remember facts and preferences, see what has been saved, and forget individual memories.
- **Personalization.** Set your companion's name, appearance and speaking style. Switch between day and night themes.
- **Daily life.** Record your mood, browse the calendar and receive weekly letters based on your conversations.
- **Your data.** Run your own server, export your records and delete your account data.

The web interface includes English and Simplified Chinese. Add languages and configure defaults in [`companion.config.json`](companion.config.json); see the [language guide](docs/i18n.md). The native Mini Program keeps the original Chinese interface, with a configurable model reply language.

## WeChat Mini Program

Start the server with `npm start`, then import [`apps/miniapp`](apps/miniapp) into WeChat DevTools. It contains the original WXML/WXSS pages, portrait artwork, chat interactions and slide-in panels.

The default client connects to `http://127.0.0.1:4317`. Use your own AppID or a test account, and follow the [Mini Program setup guide](docs/miniapp.md) for local networking, device preview and optional voice support.

## How it works

Both clients use the same backend. The native client keeps its own WXML interface; model calls and memory processing stay on the server.

![YourHer architecture](docs/diagrams/architecture.svg)

Replies are saved before optional fact analysis. Accepted memories enter later context; extraction failures do not discard the conversation.

![YourHer conversation lifecycle](docs/diagrams/conversation-loop.svg)

## Components

The applications share the same conversation, memory and model pipeline. Individual packages can also be reused in another app.

See the [component guide](docs/components.md) for package boundaries and a memory integration example.

## Documentation

- [Mini Program setup](docs/miniapp.md)
- [Reusable components](docs/components.md)
- [Architecture and data flow](docs/architecture.md)
- [Full product coverage](docs/web-port.md)
- [Language configuration](docs/i18n.md)
- [Verification and current limits](docs/validation.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)

## Development status

This is an early self-hosted edition. JSON persistence supports one Node process; multi-process use needs a transactional database adapter. Memory deduplication is exact, and semantic contradiction resolution is not implemented. Local accounts do not yet include email verification, recovery or OAuth. Real providers, browser voice, Docker and RTL layouts need environment-specific verification.

```sh
npm test       # automated unit and integration tests
npm run eval   # deterministic gate smoke checks, not an LLM benchmark
```

The self-hosted app has no subscription restriction and no commercial payment connection.

## License

[MIT](LICENSE). [Provenance](docs/provenance.md) · [Third-party notices](THIRD_PARTY_NOTICES.md).
