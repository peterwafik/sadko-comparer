#!/usr/bin/env bash
# SADKO scroll-world — Step 2: generate the 5 scene stills (nano_banana_2).
# Scene 1 is generated first and reviewed; scenes 2-5 take it as a style
# reference (--image) so the whole house reads as ONE home.
# Usage: bash generation/run-stills.sh            (all)
#        bash generation/run-stills.sh 3          (re-roll scene 3 only)
set -u
cd "$(dirname "$0")/.."
HF="$HOME/bin/hf.exe"
OUT=generation/out/stills
mkdir -p "$OUT"
SCENES=(scene_1_living scene_2_kitchen scene_3_laundry scene_4_office scene_5_finale)

gen() {
  local i=$1 name=${SCENES[$((i-1))]} ref_flag=""
  # scenes 2-5 reference scene 1 for cohesion (same home, same light)
  if [ "$i" -gt 1 ] && [ -f "$OUT/scene_1.png" ]; then ref_flag="--image $OUT/scene_1.png"; fi
  echo "== still $i: $name =="
  "$HF" generate create nano_banana_2 \
    --prompt "$(cat generation/prompts/$name.txt)" \
    $ref_flag \
    --aspect_ratio 16:9 --resolution 2k \
    --wait --wait-timeout 15m --json > "$OUT/$name.json" 2> "$OUT/$name.err"
  url=$(grep -oE '"result_url"[^,]*' "$OUT/$name.json" | head -1 | sed 's/.*"result_url"[: "]*//; s/"$//')
  if [ -n "$url" ]; then
    curl -sL "$url" -o "$OUT/scene_$i.png" && echo "   saved $OUT/scene_$i.png"
  else
    echo "   FAILED — see $OUT/$name.err / $OUT/$name.json (re-roll: bash generation/run-stills.sh $i)"
  fi
}

if [ $# -ge 1 ]; then gen "$1"; else
  gen 1
  echo ">>> REVIEW scene_1.png BEFORE CONTINUING (art direction lock). Ctrl-C to stop."
  sleep 5
  for i in 2 3 4 5; do gen "$i"; done
fi
echo "Done. Review all stills for cohesion before running run-legs.sh"
