# Visual fidelity QA

final result: passed

## Comparison target

- Source: original personal miniapp `src/pages/chat/index.wxml`, `index.wxss`, portrait assets and navigation styles at source revision `f2121dc1e323bc7143ba6d7e22c8c70fbbceb0fb`.
- Source visual truth: [source-first-touch.jpg](docs/visual-qa/source-first-touch.jpg).
- Web capture: [web-first-touch.jpg](docs/visual-qa/web-first-touch.jpg).
- Combined comparison: [source-comparison.jpg](docs/visual-qa/source-comparison.jpg).
- Both captures: 390 × 844 pixels, 390 × 844 CSS viewport, same Chinese first-meeting state and warm theme. No scaling or device frame was applied.

The reference is a browser-rendered fixture of the original app-owned markup/styles with rpx normalized to the 390 px viewport. It is not a capture from a physical WeChat device. Native status/capsule chrome is outside this comparison. This scopes the fidelity evidence to the original source-derived composition.

## Comparison history

1. Initial published screenshot: P1 abstract placeholder replaced the product portrait; P1 desktop sidebar and split panel changed the navigation/composition; P1 panel colors and opacity differed from the source. The input geometry and typography also drifted.
2. Fix: removed the placeholder asset and neutral option; restored original portraits, exact warm/violet color variables and overlay layers; restored compact vertical navigation, bottom-anchored chat, original bubble/input dimensions and full-frame slide-in panels. Self-hosted Material Symbols replace improvised glyph icons.
3. Post-fix comparison: same viewport/state reference and implementation placed side by side. No remaining P0/P1/P2 mismatch in the compared first-meeting composition.

## Required fidelity surfaces

- Typography: source Songti/Noto Serif/PingFang stack, 52rpx opener, 38rpx follow-up and 28rpx input/bubble text normalized from the original styles.
- Spacing: source opener position, margins, composer padding, 92rpx field/button geometry and canvas proportions match the source-derived fixture. On wide displays the original mobile composition is centered at a maximum 480 px width.
- Colors: original source day/night variables and wash/top/bottom gradients are reused. No luminosity blend, artificial image dimming or substitute illustration remains.
- Images: exact original portrait files, cover crop and center-top focal alignment. Material Symbols are locally served with Apache 2.0 attribution.
- Copy: source Chinese paragraph breaks and journey text restored; English and Chinese catalogues remain configurable. Runtime/model status copy stays honest about offline demo mode.

Focused checks covered the portrait face/crop, opener baselines, consent row, composer and microphone. The combined full-resolution comparison is readable enough for these regions, so separate enlarged crops were not needed.

## Functional and responsive verification

In Chrome: first-message consent, appearance selection, send/microphone visibility, split replies, reply chips, compact navigation expansion, memory/about panel switching and night-theme selection were exercised. No browser console errors were recorded in the restored preview. At a 390 px viewport the composer remains inside the viewport; at 1710 px the canvas is 480 px and the previous sidebar is absent.

## Follow-up polish

- P3: native browser input/checkbox antialiasing and consent-label spacing vary slightly from the source fixture's miniapp-style control representation.
- A physical WeChat device screenshot comparison has not been performed. The source-derived fixture is the recorded reference for this pass.
