# Contributing

Start with an issue describing the behavior you want to improve. For visual changes, attach a screenshot and name the source or intended state. Preserve the original product's visual language instead of introducing a new layout without discussion.

1. Use Node.js 24 or later.
2. Run `npm start` and inspect the affected flow in a browser.
3. Keep feature code in its owning package; use `apps/web` for composition.
4. Add translations for new interface copy. Do not translate user-authored records in place.
5. Run `npm test` and `npm run eval` before submitting a pull request.
6. Describe the trigger, changed behavior and validation. Include before/after screenshots for visual work.

Use synthetic data in tests, screenshots and reports. Never commit environment files, provider keys, user conversations or runtime data.
