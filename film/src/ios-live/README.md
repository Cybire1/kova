# Kova for iOS is live

12-second launch animation. A coral live dot expands into LIVE, a lit 3D phone
turns toward the viewer, and the final frame holds on Kova's real app screen.

Final video: `film/out/kova-ios-live.mp4`.

From `film/`:

```bash
bash scripts/ios-live/render.sh
python3 scripts/ios-live/qa.py
```

Entry: `src/ios-live/index.tsx`, composition `IosLive`.
Design stills: `IosLive-opening`, `IosLive-impact`, `IosLive-end`.

The screen is the existing `private/sam/01-home-before.png` capture. The score
reuses the project's original `wall/music/a.mp3`, with existing foley. Fonts
load from the local Kova Manrope files. Rendering uses no remote assets.

Pair with the public TestFlight link in the post:
https://testflight.apple.com/join/RPEhxUWv

Output is H.264 High, 1920×1080, 30 fps, 360 frames, BT.709, yuv420p,
AAC stereo at 48 kHz. Frame and audio measurements are in `out/ios-live/qa.json`.

## Review

Inspected the export's 3 fps contact sheet, transition frames at ±2 frames,
and the opening, reveal and ending at full resolution. Text is legible,
the phone settles upright, and the screen remains visible through the final frame.
No black intervals were detected. TypeScript checking passed.

Measured final audio: −14.43 LUFS integrated, −1.49 dBTP. Sound effects are
peak-aligned to the visual cues; the principal changes at 2.067 s and 5.067 s
match the source track's measured onsets at 2.07 s and 5.06 s.
The display uses about 3.12 source pixels per output pixel at the ending.

Visual craft review (0–5): hook 4, governing idea 4, arc 4, rhythm 4,
motivated transitions 4, eye trace 4, economy 4, grade/finish 4.5,
platform fit 4, originality 4. The original element is the live punctuation
becoming the reveal and then the phone's signal rings.

Audio was measured, not auditioned. Human listening remains necessary to judge
the music and foley balance perceptually; no audible-quality score is claimed.
