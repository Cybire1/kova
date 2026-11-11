#!/bin/bash
# The mix: the score (music.sh) under the film's own sound (sfx.py). The music dips a few dB under the
# sound design (side-chained), then one master: a fixed gain to -14 LUFS and a limiter for peaks only.
set -e
cd "$(dirname "$0")/../.."
P=public/every-phone
bash scripts/every-phone/music.sh >/dev/null
python3 scripts/every-phone/sfx.py >/dev/null
ffmpeg -v error -y -i $P/music.wav -i $P/sfx.wav -filter_complex "[0:a]volume=0.9[m];[1:a]asplit=2[s][sc];[m][sc]sidechaincompress=threshold=0.015:ratio=3:attack=8:release=320:makeup=1[md];[md][s]amix=inputs=2:normalize=0:duration=longest[x]" -map "[x]" -ar 48000 -c:a pcm_s24le $P/.raw.wav
I=$(ffmpeg -nostats -i $P/.raw.wav -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}')
ffmpeg -v error -y -i $P/.raw.wav -af "volume=$(python3 -c "print(round(-14 - float('$I'), 2))")dB,alimiter=limit=0.84:level=false:attack=4:release=80" -ar 48000 -c:a pcm_s16le $P/mix.wav
rm -f $P/.raw.wav
echo "$P/mix.wav (raw $I LUFS)"
