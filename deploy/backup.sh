#!/usr/bin/env bash
# Nightly backup of both SQLite databases.
# `.backup` is an online backup: safe to run while the server is writing.
# Installed by setup-vm.sh as /usr/local/bin/sadko-backup, run by a systemd timer.
set -euo pipefail

DATA_DIR="${SADKO_DATA:-/opt/sadko/repo/site/data}"
DEST="${SADKO_BACKUP_DIR:-/var/backups/sadko}"
KEEP_DAYS="${SADKO_BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DEST"
for db in accounts catalog; do
  src="$DATA_DIR/$db.db"
  [[ -f "$src" ]] || continue
  out="$DEST/$db-$STAMP.db"
  sqlite3 "$src" ".backup '$out'"
  gzip -9 "$out"
  echo "backed up $db -> $out.gz"
done

# accounts.db holds personal data: keep the copies unreadable by other users.
chmod 600 "$DEST"/*.gz 2>/dev/null || true
find "$DEST" -name '*.db.gz' -mtime "+$KEEP_DAYS" -delete
echo "kept the last $KEEP_DAYS days in $DEST"
