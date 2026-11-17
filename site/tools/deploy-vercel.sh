#!/usr/bin/env bash
# Deploy site/ to the SADKO Vercel project (team sadko2).
#
# Why a copy: the Vercel CLI attaches this repo's git metadata to a deploy,
# and on the Hobby plan Vercel BLOCKS a deployment whose commit author is not
# a member of the team ("TEAM_ACCESS_REQUIRED"). The commits here are authored
# by an address outside the SADKO team, so deploying from a git-free copy lets
# Vercel credit the deploy to the logged-in CLI account instead.
#
# Usage (from anywhere):  bash site/tools/deploy-vercel.sh [--prod]
set -euo pipefail

SITE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/sadko-vercel-deploy"

# Never ship a failing suite. In particular engine/markers.test.mjs refuses
# home-page marker tracks that no longer match their clips, anchor points or
# timings (fix: node tools/track-markers.mjs), which is what used to put the
# markers back on the walls after a deploy.
TEST_LOG="${TMPDIR:-/tmp}/sadko-deploy-tests.log"
(cd "$SITE" && node --test engine/*.test.mjs >"$TEST_LOG" 2>&1) || {
  echo "deploy-vercel: tests failing, not deploying. Failing tests:" >&2
  grep -E "^[[:space:]]*✖" "$TEST_LOG" | head -20 >&2
  echo "Full log: $TEST_LOG" >&2
  exit 1
}

rm -rf "$OUT"
mkdir -p "$OUT"
# Everything the build needs; never node_modules, databases, logs or secrets.
tar -C "$SITE" \
  --exclude=./node_modules --exclude=./public --exclude='./data/*.db' --exclude='./data/*.db-*' \
  --exclude=./data/uploads --exclude=./data/price-index.json --exclude='*.log' \
  --exclude='*.env' --exclude='.env*' \
  -cf - . | tar -C "$OUT" -xf -

cd "$OUT"
npx vercel deploy "$@" --scope sadko2 --yes
