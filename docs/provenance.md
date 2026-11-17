# Provenance

CompanionKit is a general-purpose, self-hosted web edition derived from the owner's personal companion product, formerly maintained in the private `DZ9/chatNPC` repository. The private production repository and its history remain separate.

Reviewed source revision: `f2121dc1e323bc7143ba6d7e22c8c70fbbceb0fb`.

Ported personal-product modules:

- `src/copy/index.js` → `packages/conversation/copy.js`, with browser/ES module exports and configurable interface translation.
- `src/utils/chat-candidates.js` → `packages/conversation/candidates.js`, with Latin-script phrase lengths added.
- `src/utils/chat-a5.js` → `packages/conversation/returning.js`, preserving return-time tiers and continuation behavior.
- Optional feminine/masculine portraits from the personal product. Original generation marking is retained. The neutral default is a new code-native SVG.

The web application, model/provider boundary, multi-account repository, locale loader, component factories, standalone memory engine, reusable mood/letter services and tests were created or reorganized for this edition. The source-message translation IDs preserve the original Chinese product copy so that migrated behavior and translated wording can be reviewed together.

Not included: company projects or derived company implementations, customer conversations, production environment files, private repository history, real account identifiers, merchant/payment configuration, production infrastructure, original analytics/monitoring, marketing material or developer session backups.

The old cloud backend originated from a CloudBase example. This edition does not distribute that SDK, cloud backend, merchant integration or its deployment configuration. Any future import from those sources requires its own provenance and license review.
