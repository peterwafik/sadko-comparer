# SADKO scroll-world — generation runbook (MCP-first)

Generation runs through the **Higgsfield MCP connector** (the user's linked
claude.ai account), NOT the CLI. The CLI (`~/bin/hf.exe`, authenticated) is
kept only as a fallback.

Status 2026-07-18 (afternoon): COMPLETE. API recovered; all 5 stills +
5 legs generated via MCP (stills on nano_banana_flash, legs on seedance_2_0,
no NSFW re-rolls needed), encoded, wired into site/index.html with
per-hotspot scroll anchors (`at`/`span` in hotspots.js), and QA'd:
4/4 seams frame-locked, blob seek OK, hotspot click → category page OK,
mobile -m.mp4 served, reduced-motion falls back to stills.
Spend: 370 credits (608 → 238). Raw sources in generation/out/.
Note for QA tooling: an occluded browser window throttles rAF to ~2fps —
use instant scrolls and wait on `window.__swApi` segment convergence.

Discoverability layer (hotspots.js): each section declares `showcase`
(scroll progress of the frame where ALL its categories are visible) and each
hotspot may carry `sfx/sfy` (its coordinates in that frame). A button in the
room's copy panel glides there and holds every marker open (labels + go
arrow); scrolling ±0.24 of section width away exits back to per-anchor
flight mode (exit check arms only after arrival). One-time coach toast
(localStorage `sadko-hs-coach-v1`) explains markers are shoppable category
links. Buttons use `pointer-events:inherit` so hidden copy panels can't
steal clicks; markers are 28px anchor dots with side-flipped labels
(direction-agnostic — the page is RTL).

## Prompts
All final prompts live in `prompts/`:
- `scene_1..5_*.txt` — stills (model: `nano_banana_2`, 16:9, 2k)
- `leg_1..5_*.txt`   — video legs (model: `seedance_2_0`, architecture A)

## MCP pipeline

### Stills
1. `generate_image` model `nano_banana_2`, prompt = scene_1 file, `aspect_ratio 16:9`,
   `resolution 2k`. **Check balance before/after — this is the unlimited-plan test.**
2. Review scene 1 (art-direction lock), download `result_url` → `out/stills/scene_1.png`.
3. Scenes 2–5: same call + `medias: [{value: <scene1_job_id>, role: "image"}]`
   so the whole house reads as one home.

### Video legs (SEQUENTIAL — never parallel)
Leg 1: `generate_video` model `seedance_2_0`,
  `medias: [{value: <scene1 media/job id>, role: "start_image"},
            {value: <scene1 job id>, role: "image_references"}]`,
  params: `mode std, resolution 1080p, aspect_ratio 16:9, duration 8, generate_audio false`.

Legs 2–5 (the frame-locked seam):
1. Download previous leg's mp4 → `out/legs/leg_N-1.mp4`
2. `ffmpeg -sseof -0.15 -i leg_N-1.mp4 -frames:v 1 -q:v 2 out/frames/leg_N-1_last.png`
3. **Eyeball that frame** — must read as a gentle forward-glide frame; re-roll the
   previous leg if not.
4. `media_upload` (filename leg_N-1_last.png) → `curl -X PUT` the bytes to the
   presigned `upload_url` → `media_confirm` → media_id
5. `generate_video` with `start_image` = that media_id + `image_references` =
   scene N's job id. NO `end_image`, ever (architecture A).

NSFW false-positives (interiors trip it): re-roll up to 3×; strip trigger words;
last resort one leg on `kling3_0` (different filter; slight character shift OK).

### Encode + wire (unchanged, local)
`bash generation/encode.sh` — desktop 1080p g8 + mobile 720p g4 `-m.mp4` +
poster stills. Then in `site/index.html` set per section:
`still: assets/img/still_i.jpg`, `clip: assets/vid/leg_i.mp4`,
`clipMobile: assets/vid/leg_i-m.mp4`. Hotspot coords: open `?spots`, click, paste.

### QA (skill Step 8)
Seam screenshots before/after each boundary (near-identical), blob seekable,
mobile beta checklist (CPU-throttled flick, -m.mp4 served, portrait crop).

## Cost sanity (as metered via MCP; unlimited plan may zero these)
- nano_banana_2 2k still ≈ 1.5–2 cr → 5 stills ≈ 10 cr
- seedance_2_0 8s 1080p std = 72 cr → 5 legs = 360 cr + re-roll headroom
- If balance (10 cr) doesn't move after scene 1 → unlimited confirmed → proceed.
  If it DOES move → stop after stills and confirm budget with the user.

## v2 rebuild (2026-07-19) — full-coverage rooms + merged family finale
Status: COMPLETE. 4 sections now (office+finale merged into أوضة العيلة).
- Stills: scene_1..3_v2.png (nano_banana_pro, old stills as refs), scene_4_merged.png
  (poster gallery wall w/ 3 blank canvases, handicraft shelves, heritage desk).
- Legs: leg_1..3_v2 (seedance_2_0 8s 1080p, sequential frame-locked chain),
  leg_4_v2 (seedance_2_0_mini 5s 720p — credits ran out; slight zoom at seam,
  covered by crossfade). Prompts inline in session; enriched-coverage per room.
- Coverage: living=TV/audio/console/AC/fan/air-cooler/heater/purifier/humidifier/
  water-cooler/fridge-tease; kitchen=full counter line-up (µwave..meat grinder)+
  dishwasher+hood+cooker+fridge/freezers; laundry=washer+dryer/heaters×2/iron/
  steamer/vacuums×3/sewing/personal-care. Finale has NO appliances — posters.js
  rotates real catalog offers inside the 3 blank frames (slots tuned to
  leg_4_v2 last frame), hotspots for offers/best-sellers/handicrafts.
- PRICING GOTCHA: get_cost preflight for seedance_2_0 reports HALF the real
  charge (36 shown, 72 billed). nano/mini preflights are honest. Check
  `transactions` after every burn. Spend this run: 236.5cr (238→1.5).
- Seam QA: SSIM 0.56-0.64 raw (baseline old chain 0.66-0.81); side-by-side
  frames visually locked, crossfade 0.1vh dissolves the grain shift.
