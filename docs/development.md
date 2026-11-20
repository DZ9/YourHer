# Developer guide

Use Node.js 24 or later. Start the web app with `npm start` from the repository root.

## Guides

| Guide | Use it for |
| --- | --- |
| [Language configuration](i18n.md) | Changing default languages and adding translations |
| [Contributing](../.github/CONTRIBUTING.md) | Preparing changes and submitting pull requests |
| [Architecture](architecture.md) | Understanding service boundaries and data flow |
| [Reusable components](components.md) | Integrating individual packages |

## Checks

Run these commands from the repository root:

| Command | Purpose |
| --- | --- |
| `npm test` | Automated unit and integration tests |
| `npm run eval` | Deterministic memory-gate smoke checks; not an LLM benchmark |
| `npm run check:miniapp` | Native page, component, module and asset reference checks |

See [verification records](validation.md) for the scope of previous checks and environment-specific gaps.

## Current limits

This is an early self-hosted edition. JSON persistence supports one Node process; multi-process use needs a transactional database adapter. Memory deduplication is exact, and semantic contradiction resolution is not implemented. Local accounts do not yet include email verification, recovery or OAuth. Real providers, browser voice, Docker and RTL layouts need environment-specific verification.

The self-hosted app has no subscription restriction and no commercial payment connection.
