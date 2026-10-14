#!/bin/bash
# Turns the raw takes into constant-frame-rate clips for the demo edit (393x852, 30 fps).
set -e
R=/Users/cyber/kova/film/demo/raw; O=/Users/cyber/kova/film/public/demo
seg() { # seg <in> <start> <end> <out>
  ffmpeg -v error -y -ss $2 -to $3 -i $R/$1.mp4 -vf "fps=30,scale=394:854:flags=lanczos,setsar=1" -an -c:v libx264 -crf 12 -pix_fmt yuv420p $T/$4.mp4
}
T=/Users/cyber/.claude/jobs/15cd9816/tmp/segs; mkdir -p $T
join() { # join <out> <hold seconds> <seg files...>
  out=$1; hold=$2; shift 2; : > $T/list.txt; for s in "$@"; do echo "file '$T/$s.mp4'" >> $T/list.txt; done
  ffmpeg -v error -y -f concat -safe 0 -i $T/list.txt -vf "tpad=stop_mode=clone:stop_duration=$hold" -c:v libx264 -crf 12 -pix_fmt yuv420p -r 30 $O/$out.mp4
}
seg h-sam-home 5 7 home-a; join home 8 home-a
seg c-cafe 10 15 cafe-a; seg c-cafe 15 17.5 cafe-b; seg c-cafe 23.5 30 cafe-c; join cafe 1 cafe-a cafe-b cafe-c
seg l-link 10 13 link-a; seg l-link 13 15 link-b; seg l-link 19.5 25 link-c; join link 16 link-a link-b link-c
seg o-offline 11 14 off-a; seg o-offline 17 18.9 off-b; join offline 9 off-a off-b
seg o2-online 5 7 on-a; join online 6 on-a
seg p1-ada-private 11 14 pr-a; seg p1-ada-private 14 16 pr-b; seg p1-ada-private 22.5 30 pr-c; join private 1 pr-a pr-b pr-c
seg p2-sam-arrival 16 24 arr-a; join arrival 1 arr-a
# web: frames with their screencast timestamps
web() { # web <dir> <out> <hold>
  python3 - "$R/$1" "$T/$1.txt" <<'PY'
import json, sys
d, out = sys.argv[1], sys.argv[2]
t = json.load(open(f'{d}/times.json'))
with open(out, 'w') as f:
    for i in range(len(t)):
        dur = (t[i+1] - t[i]) if i + 1 < len(t) else 0.04
        f.write(f"file '{d}/f{i:05d}.jpg'\nduration {max(dur, 0.001):.4f}\n")
    f.write(f"file '{d}/f{len(t)-1:05d}.jpg'\n")
PY
  ffmpeg -v error -y -f concat -safe 0 -i $T/$1.txt -vf "fps=30,scale=394:854,setsar=1,tpad=stop_mode=clone:stop_duration=$3" -c:v libx264 -crf 12 -pix_fmt yuv420p $O/$2.mp4
}
web w1-claim claim 3; web w2-opage opage 3
# The settled page: its screencast starts on a blank tab, so hold its last (loaded) frame instead.
ffmpeg -v error -y -loop 1 -i "$(ls $R/w3-osettled/f*.jpg | tail -1)" -t 9 -vf "fps=30,scale=394:854,setsar=1" -c:v libx264 -crf 12 -pix_fmt yuv420p $O/settled.mp4
for s in scan-cafe scan-claim scan-offline scan-private scan-announce scan-mainnet-card; do cp $R/$s.png $O/$s.png; done
cp /Users/cyber/kova/film/demo/vo/*.mp3 $O/
for f in $O/*.mp4; do printf '%s %s\n' "$(basename $f)" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 $f)"; done
