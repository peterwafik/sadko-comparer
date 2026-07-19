#!/usr/bin/env bash
# SADKO scroll-world — Step 4, architecture A: one continuous forward take,
# 5 legs generated SEQUENTIALLY on seedance_2_0.
#   leg 1: --start-image = scene_1 still
#   leg N: --start-image = leg N-1's ACTUAL last frame (frame-locked seam)
#   every leg ALSO gets its room's still as --image reference (steers content
#   without forcing a camera pull-back; NO --end-image, ever)
# NSFW false-positives: re-run a failed leg up to 3x; fallback model kling3_0.
# Usage: bash generation/run-legs.sh          (all, sequential)
#        bash generation/run-legs.sh 3        (regenerate leg 3 onward prep: re-extracts frame from leg 2)
set -u
cd "$(dirname "$0")/.."
HF="$HOME/bin/hf.exe"
STILLS=generation/out/stills
LEGS=generation/out/legs
FRAMES=generation/out/frames
mkdir -p "$LEGS" "$FRAMES"
PROMPTS=(leg_1_living leg_2_kitchen leg_3_laundry leg_4_office leg_5_finale)

gen_leg() {
  local i=$1 name=${PROMPTS[$((i-1))]} start ref attempt
  if [ "$i" -eq 1 ]; then
    start="$STILLS/scene_1.png"
  else
    local prev=$((i-1))
    [ -f "$LEGS/leg_$prev.mp4" ] || { echo "leg_$prev.mp4 missing — generate it first"; return 1; }
    ffmpeg -y -loglevel error -sseof -0.15 -i "$LEGS/leg_$prev.mp4" -frames:v 1 -q:v 2 "$FRAMES/leg_${prev}_last.png"
    start="$FRAMES/leg_${prev}_last.png"
  fi
  ref="$STILLS/scene_$i.png"
  for attempt in 1 2 3; do
    echo "== leg $i ($name) attempt $attempt =="
    "$HF" generate create seedance_2_0 \
      --prompt "$(cat generation/prompts/$name.txt)" \
      --start-image "$start" \
      --image "$ref" \
      --mode std --resolution 1080p --aspect_ratio 16:9 --duration 8 \
      --generate_audio false \
      --wait --wait-timeout 20m --json > "$LEGS/$name.json" 2> "$LEGS/$name.err"
    url=$(grep -oE '"result_url"[^,]*' "$LEGS/$name.json" | head -1 | sed 's/.*"result_url"[: "]*//; s/"$//')
    if [ -n "$url" ]; then
      curl -sL "$url" -o "$LEGS/leg_$i.mp4" && echo "   saved $LEGS/leg_$i.mp4"
      # eyeball frame for the NEXT leg's handoff quality
      ffmpeg -y -loglevel error -sseof -0.15 -i "$LEGS/leg_$i.mp4" -frames:v 1 -q:v 2 "$FRAMES/leg_${i}_last.png"
      echo "   >>> CHECK $FRAMES/leg_${i}_last.png — must look like a gentle forward glide frame"
      return 0
    fi
    if grep -qi nsfw "$LEGS/$name.json" "$LEGS/$name.err" 2>/dev/null; then
      echo "   nsfw false-positive — re-rolling"
    else
      echo "   failed — see $LEGS/$name.err"
    fi
  done
  echo "   3 attempts failed. Fallback: retry on kling3_0 (same start image):"
  echo "   $HF generate create kling3_0 --prompt \"\$(cat generation/prompts/$name.txt)\" --start-image $start --mode std --sound off --duration 10 --wait --json"
  return 1
}

START=${1:-1}
for i in $(seq "$START" 5); do gen_leg "$i" || exit 1; done
echo "All legs done. Next: bash generation/encode.sh"
