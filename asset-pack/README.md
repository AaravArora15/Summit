# Summit — Marketing Asset Pack

Everything here is pulled from the real Summit brand: the colour and type
tokens in `summit/src/theme/tokens.ts`, and the finished screens in
`design-mockup-v4.html` (the app's design source of truth). Nothing was
invented for this pack — it's real UI and real brand marks, exported for use
outside the codebase.

## What's real vs. placeholder

The repo's `summit/assets/images/icon.png`, `splash-icon.png`, and
`android-icon-*.png` are still Expo's default scaffold assets (the blue
gridded "A"), **not** Summit branding — don't use those in marketing
material. The actual Summit mark is the mountain glyph + wordmark in
`logo/`, pulled directly out of the mockup's own header.

## Contents

- **logo/** — the Summit lockup (glyph + "SUMMIT" wordmark, Outfit Bold) and
  the glyph alone, each in forest-green and white, transparent PNG. Use white
  over dark/video footage, forest over light backgrounds.
- **badges/** — the four rarity-tier badge illustrations (common/rare/epic/
  legendary), the real in-app art, transparent PNG. Good for reveal/unlock
  animations — these are literally what a user sees when they earn one.
- **screens/** — 8 finished app screens exported at device size (394×856,
  transparent background, phone bezel included), picked to tell the product
  story: welcome, home, explore map, live trek, arrival, set-complete
  (badge reveal), monthly league, profile. Drop these into a phone-mockup or
  parallax/carousel animation as-is.
- **fonts/** — Inter (Regular/Medium/SemiBold/Bold) and Outfit Bold, the
  app's only two typefaces. Outfit Bold is reserved for the wordmark alone;
  everything else uses Inter.
- **brand/reference.png** — one-page colour + type cheat sheet with hex
  values, for matching titles/lower-thirds/captions to the app's palette.

## Palette quick reference

Forest `#1F3D2E` · Sage `#6F8F75` · Sand `#DCC6A1` · Rust `#A65A3A` ·
Slate `#7A8D99` · Ink `#1A1A1A` · Background `#F7F7F5`

Rarity: Common `#6F8F75` · Rare `#7A8D99` · Epic `#A65A3A` · Legendary `#1A1A1A`

Never use the safety colours (green/amber/red — `ok`/`warn`/`stop` in
tokens.ts) decoratively; in-product they mean one thing only.
