#!/bin/bash
# The two-sends film with the narrator:  film/scripts/two-sends/voice.sh
#   → film/out/kova-private-two-sends-voice.mp4
# The picture is identical to the plain cut, so this renders only the voiced sound (TwoSendsVoice),
# masters it the same way (-14 LUFS, true peak about -1.5 dBTP) and puts it on the plain cut's video
# stream without re-encoding. Run scripts/two-sends/render.sh first if the picture changed.
set -e
cd "$(dirname "$0")/../.."
PLAIN=out/kova-private-two-sends.mp4
OUT=out/kova-private-two-sends-voice.mp4
T=out/.two-sends-voice
mkdir -p $T
npx remotion render src/two-sends/index.tsx TwoSendsVoice "$T/audio.wav" --codec=wav --log=error
lufs() { ffmpeg -nostats -i "$1" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}'; }
master() { ffmpeg -v error -y -i "$1" -af "volume=$(python3 -c "print(round(-14 - float('$(lufs "$1")'), 2))")dB,alimiter=limit=0.78:level=false:attack=3:release=60" -ar 48000 -c:a pcm_s16le "$2"; }
master $T/audio.wav $T/m1.wav
master $T/m1.wav $T/m2.wav
ffmpeg -v error -y -i $PLAIN -i $T/m2.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -rf $T
echo "$OUT: $(lufs "$OUT") LUFS"
