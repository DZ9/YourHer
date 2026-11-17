# Architecture

`apps/web` is the composition root. It wires the HTTP/SSE transport to the reusable packages; it does not own a second memory or chips implementation.

```text
Browser web app
  ├─ ui: chat / panels / dialogs / voice / privacy
  ├─ i18n: catalogue + fallback + runtime switching
  └─ conversation: event reader + bubbles + chips + return behavior
          ↓ HTTP / SSE
Web host
  ├─ providers: replies / extraction / letters / summaries
  ├─ memory: scoped facts / ranking / expiry / forgetting
  ├─ companion-core: profiles / moods / weekly letters
  └─ storage: accounts / sessions / serialized persistence
```

## Conversation lifecycle

1. Identify a guest or registered account from an HttpOnly session cookie.
2. Validate consent and an idempotent client request ID. Save the user message and turn record together.
3. Build context from the current profile, selected memories, summary and recent raw conversation.
4. Stream replacement text while withholding partial or complete chips markers.
5. Persist the assistant's visible content, raw content and parsed candidate replies before optional analysis.
6. Analyze explicit facts, names and moods, save accepted results, then mark the turn complete.
7. Send confirmation banners and a completion event. The browser refreshes authoritative state.

Disconnecting the browser removes a stream subscriber but does not cancel a reply already underway. Repeating a completed request ID returns its saved assistant response instead of another model call. A process restart marks incomplete pending turns as errors rather than silently reissuing paid requests.

## Data and isolation

All records are scoped by user ID. The product repository partitions memory records through an injected MemoryEngine store. Passwords use salted scrypt hashes; session token digests are persisted instead of raw cookies. Exports omit hashes, salts and session records. Forgetting checks ownership. Account deletion removes records belonging to that account.

The JSON repository serializes mutations within one process and atomically replaces its file. It is not a multi-process database. Background services must not recreate deleted accounts. Persistent data and environment files are ignored by Git.

## Languages and components

The public configuration contains branding, assistant defaults, feature flags, timezone and locale metadata, never provider keys. Locale JSON is loaded from explicitly configured files. UI text is localized synchronously before rendering; user messages, memory facts and letters are excluded from interface translation. The profile locale controls model replies and letters, and supplies browser speech metadata.

UI factories accept state getters and callbacks. They do not require this HTTP server. The memory package accepts an extractor and a store. The letter service accepts a repository and model; the mood service accepts a transactional store and clock.

## Deliberate limits

Exact memory deduplication does not resolve semantic contradictions. Memory and conversation updates are serialized but not one cross-domain transaction. Browser speech availability and provider compatibility vary. Deployment to multiple processes requires a database implementation with real transactions and uniqueness guarantees.

The web host keeps the original mobile composition in a centered viewport on large displays. Navigation is the source product’s compact vertical menu, and feature panels slide over the chat instead of introducing a desktop sidebar.
