# Provenance

YourHer is a general-purpose, self-hosted web and native miniapp edition derived from the owner's personal companion product, formerly maintained in the private `DZ9/chatNPC` repository. The private production repository and its history remain separate.

Reviewed source revision: `f2121dc1e323bc7143ba6d7e22c8c70fbbceb0fb`.

Ported personal-product modules:

- `src/copy/index.js` → `packages/conversation/copy.js`, with browser/ES module exports and configurable interface translation.
- `src/utils/chat-candidates.js` → `packages/conversation/candidates.js`, with Latin-script phrase lengths added.
- `src/utils/chat-a5.js` → `packages/conversation/returning.js`, preserving return-time tiers and continuation behavior.
- Optional feminine/masculine portraits from the personal product. Original generation marking is retained. The earlier abstract placeholder has been removed; the default is the original feminine portrait, with the original masculine portrait available as an option.

The web application, model/provider boundary, multi-account repository, locale loader, component factories, standalone memory engine, reusable mood/letter services and tests were created or reorganized for this edition. The source-message translation IDs preserve the original Chinese product copy so that migrated behavior and translated wording can be reviewed together.

Not included: company projects or derived company implementations, customer conversations, production environment files, private repository history, real account identifiers, merchant/payment configuration, production infrastructure, original analytics/monitoring, marketing material or developer session backups.

The old cloud backend originated from a CloudBase example. This edition does not distribute that SDK, cloud backend, merchant integration or its deployment configuration. Any future import from those sources requires its own provenance and license review.

The visual restoration ports the original miniapp chat CSS palette, overlay layers, spacing, typography, composer and navigation. Material Symbols are self-hosted with their Apache 2.0 notice. The web view preserves the mobile composition inside a centered canvas on wider screens.

## Native Mini Program distribution

`apps/miniapp/src` is an allowlisted import of the personal product's `apps/miniapp_v2/src` from the reviewed revision above. It includes native page/component JavaScript, WXML/WXSS, copy, utilities and product artwork. Personal development notes, release logs, compliance/admin backends, cloud functions, CloudRun sources, observability, production deployment files, original payment integration and production identifiers are excluded. The restored trial and membership prompts use the self-hosted WeChat adapter. Merchants and message templates are configured on the deployment server. No private repository history is copied.

The HTTP client, device-session boundary, miniapp compatibility API, account/data screen and startup documentation were added for this edition. The miniapp backend shares the existing web turn pipeline, memory engine, provider adapter and persistence. It does not import the old third-party cloud backend. The native client's original Chinese interface is preserved; browser locale catalogues apply to the web UI only.

The desk home page was recovered from the last revision before its removal (`0ff704d32b61a8c0b2536b32e581e52cfd5549e0`). The onboarding page was recovered separately from `fed1e3bc6b1442b066c657cf4795682dd1d80980`. The restored desk mood card connects the original check-in-to-chat flow to the self-hosted backend.
