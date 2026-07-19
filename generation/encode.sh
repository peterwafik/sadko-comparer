#!/usr/bin/env bash
# SADKO scroll-world — Step 6: encode legs for smooth scrubbing.
#   desktop: native 1080p, crf 20, GOP 8, faststart, muted, light unsharp
#   mobile : 720p, crf 23, GOP 4 (cheaper seeks on phone decoders)  -> *-m.mp4
# Also extracts each leg's settled mid-frame as the section poster still.
set -eu
cd "$(dirname "$0")/.."
LEGS=generation/out/legs
VID=site/assets/vid
IMG=site/assets/img
mkdir -p "$VID" "$IMG"

for i in 1 2 3 4 5; do
  src="$LEGS/leg_$i.mp4"
  [ -f "$src" ] || { echo "skip leg_$i (missing)"; continue; }
  echo "== encode leg $i =="
  ffmpeg -y -loglevel error -i "$src" -an -vf "unsharp=5:5:0.8:5:5:0.0" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
    -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart "$VID/leg_$i.mp4"
  ffmpeg -y -loglevel error -i "$src" -an \
    -vf "scale=1280:720:flags=lanczos,unsharp=5:5:0.6:5:5:0.0" \
    -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
    -g 4 -keyint_min 4 -sc_threshold 0 -movflags +faststart "$VID/leg_$i-m.mp4"
  # poster = the settled mid-scene frame (55% in, where hotspots/copy peak)
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
  mid=$(awk -v d="$dur" 'BEGIN{printf "%.2f", d*0.55}')
  ffmpeg -y -loglevel error -ss "$mid" -i "$src" -frames:v 1 -q:v 3 "$IMG/still_$i.jpg"
  echo "   -> $VID/leg_$i.mp4  $VID/leg_$i-m.mp4  $IMG/still_$i.jpg"
done
ls -la "$VID"
echo "Now update site/index.html: set clip/clipMobile + still per section, then QA seams."
