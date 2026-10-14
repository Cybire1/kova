#!/bin/bash
# Master a demo cut: render the composition (voice only), duck the music bed under the voice, -14 LUFS.
#   demo/master2.sh <CompositionId> <out-name> <seconds>
set -e
ID=$1; NAME=$2; DUR=$3
cd /Users/cyber/kova/film
npx remotion render src/index.ts "$ID" "out/$NAME-raw.mp4" --image-format=png --crf=12 --concurrency=8 --log=error
FADE=$(python3 -c "print($DUR - 2.5)")
ffmpeg -v error -y -i "out/$NAME-raw.mp4" -stream_loop 1 -i public/demo/score.mp3 -filter_complex "[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[v][vsc];[1:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:$DUR,volume=-15.5dB,afade=t=out:st=$FADE:d=2.5[m];[m][vsc]sidechaincompress=threshold=0.012:ratio=9:attack=25:release=450[duck];[v][duck]amix=inputs=2:duration=first:normalize=0[mix]" -map "[mix]" -c:a pcm_s16le "/tmp/$NAME-mix.wav"
I=$(ffmpeg -nostats -i "/tmp/$NAME-mix.wav" -af ebur128 -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}')
G=$(python3 -c "print(round(-14 - float('$I'), 2))")
ffmpeg -v error -y -i "out/$NAME-raw.mp4" -i "/tmp/$NAME-mix.wav" -map 0:v -map 1:a -vf "scale=out_range=tv,format=yuv420p" -c:v libx264 -profile:v high -crf 14 -preset medium -r 30 -af "volume=${G}dB,alimiter=limit=0.84:level=false" -c:a aac -b:a 192k -ar 48000 -movflags +faststart "out/$NAME.mp4"
echo "$NAME: mix was $I LUFS, gain $G dB"
