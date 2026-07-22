#!/usr/bin/env bash
# Pull the latest code and restart, with a health check and an automatic
# rollback hint if the service does not come back.
#   sudo bash deploy/update.sh
set -euo pipefail
REPO="${SADKO_REPO:-/opt/sadko/repo}"
PORT="${PORT:-8082}"

echo "==> backing up first"
/usr/local/bin/sadko-backup || echo "(backup script not installed yet — continuing)"

echo "==> fetching"
sudo -u sadko git -C "$REPO" pull --ff-only

echo "==> restarting"
systemctl restart sadko
sleep 3

echo "==> health"
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null; then
  curl -s "http://127.0.0.1:$PORT/healthz"; echo
  echo "OK"
else
  echo "FAILED — the service is not healthy. Recent logs:" >&2
  journalctl -u sadko -n 40 --no-pager >&2
  echo "Roll back with:  sudo -u sadko git -C $REPO reset --hard HEAD~1 && sudo systemctl restart sadko" >&2
  exit 1
fi
