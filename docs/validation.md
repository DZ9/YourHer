# Verification

Date: 2026-11-17. Runtime: Node.js 24.22.1 on macOS.

- Automated tests: 40 passed. Includes multi-account isolation, cookie/account lifecycle, export/deletion, request idempotency, disconnect recovery, chips buffering, English phrase lengths, file persistence, memory lifecycle, mood precedence, letters and locale loading.
- Locale configuration: English and Simplified Chinese loaded; a third synthetic French catalogue tested fallback and speech metadata without adding application branches.
- Offline rule smoke check: 12/12 synthetic cases. This is not an LLM memory benchmark.
- Browser verification: full conversation, first meeting, appearance selection, chips, memory banners/panel, mood calendar/check-in, settings persistence, weekly letter, English interface and runtime English/Chinese switching.
- Responsive verification: a 390 px viewport had no horizontal overflow and the composer remained within the viewport. Desktop panels and navigation were also checked.
- Not verified: actual API provider behavior, browser speech permissions, a Docker build, comprehensive RTL layout, high-concurrency/multi-process deployment, clinical quality or a live commercial payment flow.

The browser and tests used synthetic content. No real user conversations were imported. GitHub Actions runs the same checks after publication; a local pass is not a claim that remote CI has already succeeded.

Visual restoration: original portraits, original theme variables and app-owned mobile composition were compared with a source-derived browser fixture at 390 × 844. See [visual QA](../design-qa.md). The previous abstract placeholder and desktop sidebar are removed. README screenshots are actual restored app states.

## Native Mini Program

The native contract integration tests execute the original API module and original polling renderer with a `wx.request` transport shim against a real HTTP server. They verify multi-bubble replies, incremental visible text without chips markers, final chips, shared bootstrap identity, memory and profile persistence, checkins, letters, export, consent, idempotency, user isolation and deletion. `npm run check:miniapp` verifies page/component/module/image references and JavaScript/JSON parsing.

WeChat DevTools is not installed in the preparation environment. Native compilation, font rendering, layout, device networking, plugin activation and app review have not been verified. The transport shim is not a WeChat runtime.
