# Provenance

YourHer AI is a general-purpose, self-hosted web edition derived from the owner's personal companion product, formerly maintained in the private `DZ9/chatNPC` repository. The private production repository and its history remain separate.

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
