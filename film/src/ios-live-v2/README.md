# Kova for iOS — revised launch film

Nine seconds. “Hello, iOS.” → the Kova icon travels into the device → the app
opens → “Now live.” holds beside the real screen. Kovi uses the existing rig.

Outputs:

- `film/out/kova-ios-live-v2-4k.mp4` — 3840×2160 master.
- `film/out/kova-ios-live-v2.mp4` — 1920×1080 social copy.

From `film/`:

```bash
bash scripts/ios-live-v2/render.sh
python3 scripts/ios-live-v2/qa.py
```

The film has its own entry (`src/ios-live-v2/index.tsx`, composition `IosLaunch`).
The earlier film is preserved for comparison; this revision uses no hand-built
3D phone model. Device dimensions and the screen opening come from the source
frame. The app capture is composed at its original aspect ratio; the frame
supplies the hardware cutout. The held display uses a Lanczos-prefiltered image
at its master display size, drawn directly rather than through an intermediate
transformed texture. The original screenshot provides 1.524 source pixels per
master display pixel. See `public/ios-live-v2/SOURCES.md` for asset provenance.

The official Kova SVG, local Manrope and existing character rig match the earlier
Kova films. The music is the project's original instrumental, edited on its
120 bpm grid: six beats removed before its own final hit, placing that hit at
5.06 s. No new tonal ending was added.

QA artifacts are in `out/ios-live-v2/`: the actual export's 3 fps contact sheet,
transition frames at ±2 frames, ending at 4K, codec/loudness measurements and
screen-resolution diagnostics. TypeScript checking passes. Audio levels and
foley timing are measured; the mix still needs human listening.

Use this public link in the accompanying post:
https://testflight.apple.com/join/RPEhxUWv
