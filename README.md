<div align="center">

# YourHer AI

### A familiar voice. A connection that grows.

A self-hosted AI companion with personality, memory, and conversations that carry on.

[![CI](https://github.com/DZ9/YourHerAI/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DZ9/YourHerAI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-8b7355.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-607a58.svg)](https://nodejs.org/)

[**Get started**](#quickstart) · [**Components**](#use-the-parts-you-need) · [**Languages**](docs/i18n.md) · [**Architecture**](docs/architecture.md)

English · [简体中文](README.zh-CN.md)

</div>

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/first-meeting-english.jpg" width="250" alt="English first-meeting screen with the original portrait"><br><sub>A place to start</sub></td>
    <td align="center"><img src="docs/screenshots/conversation.jpg" width="250" alt="Streaming conversation with suggested replies"><br><sub>A conversation that continues</sub></td>
    <td align="center"><img src="docs/screenshots/memory.jpg" width="250" alt="Your companion's memory panel"><br><sub>The things that stay</sub></td>
  </tr>
</table>

YourHer AI is a companion you can make your own. Choose a name, an appearance and a speaking style. Talk about your day, share what matters, and return to a conversation with a little more continuity.

**Personality makes a conversation feel familiar. Memory helps it continue.** YourHer AI brings both together with streaming replies, contextual reply chips, mood check-ins and weekly letters.

Run the complete web app on your own instance, connect the model you choose, or reuse its individual components to build your own companion experience.

The interface carries over the original companion product's portrait artwork, warm/violet themes, compact navigation and slide-in panels. Branding, language and model provider remain configurable.

## Quickstart

**Node.js 24+**. No dependency installation is needed for the built-in demo.

```sh
git clone https://github.com/DZ9/YourHerAI.git
cd YourHerAI
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

## A companion, shaped around you

| Keep the conversation going | Make your companion your own |
| --- | --- |
| Streamed, multi-bubble replies and contextual reply chips | Companion appearance, name, voice and relationship preferences |
| Saved history, reconnect recovery and idempotent requests | Original portrait backgrounds and day/night themes |
| First-meeting prompts and returning-user continuations | Live English / Chinese switching and configurable locales |

| Memory you control | Space for everyday life |
| --- | --- |
| Typed facts, importance, recency and expiry | Daily mood check-ins and a monthly calendar |
| Remember / forget banners and name-change undo | Weekly letters with saved history |
| Data export and account deletion | Guest accounts, sign-in, feedback and an experience survey |

## Use the parts you need

The web app uses these same packages. There is no separate demo-only memory or chips implementation.

| Component | What it owns |
| --- | --- |
| [Conversation](packages/conversation) | Reply chips, streaming events, bubbles and returning-user behavior |
| [Memory](packages/memory) | Extraction, ranking, expiry, reinforcement and forgetting |
| [UI](packages/ui) | Chat, panels, dialogs, browser voice and privacy components |
| [Providers](packages/providers) | Model adapter, companion prompts and offline demo |
| [Storage](packages/storage) | Accounts, sessions and persistent records |
| [Internationalization](packages/i18n) | Catalogues, interpolation, language switching and fallback |
| [Companion core](packages/companion-core) | Profiles, mood rules and weekly letters |

```js
import { MemoryEngine, InMemoryStore } from './packages/memory/index.js';

const memory = new MemoryEngine({ store: new InMemoryStore() });
await memory.remember('user-1', {
  type: 'preference', content: 'The user likes hiking', importance: 3
});

const context = await memory.context('user-1');
```

Components use injected state, repositories and model interfaces. They do not require WeChat or CloudBase. Package names are workspace names, not published npm releases.

## Your language, your configuration

English and Simplified Chinese are included. Language selection applies to the interface, subsequent replies, letters and browser speech settings. Previously saved content keeps its original language.

Edit `companion.config.json` to configure defaults:

```json
"i18n": {
  "defaultLocale": "en",
  "fallbackLocale": "en",
  "detectBrowserLanguage": false,
  "locales": [ "...locale declarations..." ]
}
```

Add a translation JSON and one locale declaration to extend the app. Brand, companion defaults, timezone and feature visibility are configurable too.

**[Read the language configuration guide →](docs/i18n.md)**

## Documentation

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
