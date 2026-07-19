#!/bin/sh
# SADKO rebuild v2 — encode the 4 new legs (desktop + mobile) and the 4 stills,
# then swap them into site/. Run from D:/SADKO/generation.
set -e
OUT=out/legs
VID=../site/assets/vid
IMG=../site/assets/img

enc() {  # $1 src, $2 dst — desktop master: native 1080p, crf20, GOP 8
  ffmpeg -y -loglevel error -i "$1" -an -vf "unsharp=5:5:0.8:5:5:0.0" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
    -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart "$2"
}
encm() { # $1 src, $2 dst — mobile: 720p, crf23, GOP 4 (cheap seeks on phones)
  ffmpeg -y -loglevel error -i "$1" -an -vf "scale=1280:720,unsharp=5:5:0.6:5:5:0.0" \
    -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
    -g 4 -keyint_min 4 -sc_threshold 0 -movflags +faststart "$2"
}

for i in 1 2 3 4; do
  enc  "$OUT/leg_${i}_v2.mp4" "$VID/leg_${i}.mp4"
  encm "$OUT/leg_${i}_v2.mp4" "$VID/leg_${i}-m.mp4"
  echo "leg_$i encoded"
done

# stills: new landing/poster frames (1920w jpg, q3)
ffmpeg -y -loglevel error -i out/stills/scene_1_v2.png     -vf scale=1920:-2 -q:v 3 "$IMG/still_1.jpg"
ffmpeg -y -loglevel error -i out/stills/scene_2_v2.png     -vf scale=1920:-2 -q:v 3 "$IMG/still_2.jpg"
ffmpeg -y -loglevel error -i out/stills/scene_3_v2.png     -vf scale=1920:-2 -q:v 3 "$IMG/still_3.jpg"
ffmpeg -y -loglevel error -i out/stills/scene_4_merged.png -vf scale=1920:-2 -q:v 3 "$IMG/still_4.jpg"

# retire the old 5th leg (kept in generation/out; removed from the site)
rm -f "$VID/leg_5.mp4" "$VID/leg_5-m.mp4" "$IMG/still_5.jpg"
echo "done"
