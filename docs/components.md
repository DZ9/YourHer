# Components

Both clients use the web host's model, memory, storage and letter services. The native client has an HTTP compatibility layer for the original page API. It does not require the former CloudBase backend.

- [Conversation](../packages/conversation): reply chips, streaming events, bubbles and returning-user behavior.
- [Memory](../packages/memory): extraction, ranking, expiry, reinforcement and forgetting.
- [UI](../packages/ui): browser chat, panels, dialogs, speech and privacy components. Native WXML components live in [apps/miniapp/src/components](../apps/miniapp/src/components).
- [Providers](../packages/providers): model adapter, companion prompts and offline demo.
- [Storage](../packages/storage): accounts, sessions and persistent records.
- [Internationalization](../packages/i18n): web catalogues, interpolation, language switching and fallback.
- [Companion core](../packages/companion-core): profiles, mood rules and weekly letters.

## Using memory independently

```js
import { MemoryEngine, InMemoryStore } from '../packages/memory/index.js';

const memory = new MemoryEngine({ store: new InMemoryStore() });
await memory.remember('user-1', {
  type: 'preference', content: 'The user likes hiking', importance: 3
});

const context = await memory.context('user-1');
```

Adjust the import path to your entry point. Components accept injected state, repositories and model interfaces. Package names are workspace names; they are not published npm releases.
