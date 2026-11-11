#!/bin/bash
# Render and master the two-sends film:  film/scripts/two-sends/render.sh
#   → film/out/kova-private-two-sends.mp4 (H.264 BT.709, AAC 192k, -14 LUFS, true peak about -1.5 dBTP)
# Frames go to disk when free memory looks low, so it renders in 200-frame chunks (less disk at once),
# joins them without re-encoding, renders the sound once, and masters only the sound.
set -e
cd "$(dirname "$0")/../.."
T=out/.two-sends-chunks
OUT=out/kova-private-two-sends.mp4
mkdir -p $T
TOTAL=$(node -e "const e=require('./src/two-sends/edit.json'); console.log(e.frames.length - 12 + 225 + 105)")
STEP=200
i=0
for ((a=0; a<TOTAL; a+=STEP)); do
  b=$((a+STEP-1)); [ $b -ge $TOTAL ] && b=$((TOTAL-1))
  npx remotion render src/two-sends/index.tsx TwoSendsFilm "$(printf "$T/c%02d.mp4" $i)" --frames=$a-$b --muted --image-format=jpeg --jpeg-quality=100 --crf=12 --color-space=bt709 --concurrency=4 --log=error
  i=$((i+1))
done
npx remotion render src/two-sends/index.tsx TwoSendsFilm "$T/audio.wav" --codec=wav --log=error
ls $T/c*.mp4 | sed "s#^#file '$PWD/#; s#\$#'#" > $T/list.txt
ffmpeg -v error -y -f concat -safe 0 -i $T/list.txt -c copy $T/video.mp4
lufs() { ffmpeg -nostats -i "$1" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}'; }
master() { ffmpeg -v error -y -i "$1" -af "volume=$(python3 -c "print(round(-14 - float('$(lufs "$1")'), 2))")dB,alimiter=limit=0.78:level=false:attack=3:release=60" -ar 48000 -c:a pcm_s16le "$2"; }
master $T/audio.wav $T/m1.wav
master $T/m1.wav $T/m2.wav
ffmpeg -v error -y -i $T/video.mp4 -i $T/m2.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf $T
echo "$OUT: $(lufs "$OUT") LUFS"
