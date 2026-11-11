#!/bin/bash
# The score: the phone film's own warm track (kovaphone/music-a.mp3, ElevenLabs, 103.4 BPM; beats at
# 0.81 + 0.5803 j s). Six bars of its steady full section (18.22 → 32.15 s) play twice, joined on beats
# with an equal-power crossfade, so the track's own fall and final chord land on the end card (≈ 50 s).
# (A first version joined at 35.15 s, where the original is already fading: a 9 dB jump. Not this one.)
set -e
cd "$(dirname "$0")/../.."
R=18.2187; A=32.1453
ffmpeg -v error -y -i public/kovaphone/music-a.mp3 -filter_complex "[0:a]atrim=0:$A,asetpts=PTS-STARTPTS[a];[0:a]atrim=$R,asetpts=PTS-STARTPTS[b];[a][b]acrossfade=d=0.04:c1=qsin:c2=qsin,apad=whole_dur=56,atrim=0:56[o]" -map "[o]" -ar 48000 public/every-phone/music.wav
echo public/every-phone/music.wav
