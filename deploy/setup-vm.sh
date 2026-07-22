#!/usr/bin/env bash
# =============================================================================
# SADKO — one-shot provisioning for a fresh Ubuntu 24.04 LTS x86_64 VM
# (written for a Google Compute Engine e2-medium, but works on any Debian-family
# box with 2 vCPU / 4 GB).
#
#   sudo bash deploy/setup-vm.sh yourdomain.com you@example.com
#
# Installs Node 24, Google Chrome (for the comparer's headless tier), Caddy for
# automatic HTTPS, and a hardened systemd service. Safe to re-run: every step is
# idempotent, and it never overwrites /etc/sadko.env if you have already put
# secrets in it.
# =============================================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
APP_USER=sadko
APP_DIR=/opt/sadko
PORT=8082

if [[ $EUID -ne 0 ]]; then echo "Run with sudo: sudo bash $0 <domain> <email>" >&2; exit 1; fi
if [[ -z "$DOMAIN" ]]; then echo "Usage: sudo bash $0 <domain> <email-for-tls>" >&2; exit 1; fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Updating the base system"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg sqlite3 ufw >/dev/null

# ---------------------------------------------------------------------------
say "Installing Node.js 24 (the engine needs node:sqlite, built in since 22)"
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

# ---------------------------------------------------------------------------
# Chrome, NOT the snap. Ubuntu's `chromium-browser` package is a transitional
# snap, and snap confinement breaks the --remote-debugging-pipe + temp
# user-data-dir combination that site/headless.mjs relies on. The official .deb
# lands at /usr/bin/google-chrome, which headless.mjs already looks for.
say "Installing Google Chrome (headless tier for JS-rendered stores)"
if ! command -v google-chrome >/dev/null; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list
  apt-get update -qq
  apt-get install -y -qq google-chrome-stable >/dev/null
fi
google-chrome --version

# ---------------------------------------------------------------------------
say "Installing Caddy (automatic Let's Encrypt certificates)"
if ! command -v caddy >/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# ---------------------------------------------------------------------------
say "Creating the service account and directories"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" /var/backups/sadko
chown -R "$APP_USER:$APP_USER" "$APP_DIR" /var/backups/sadko

# ---------------------------------------------------------------------------
say "Writing /etc/sadko.env (secrets live here, never in git)"
if [[ ! -f /etc/sadko.env ]]; then
  cat > /etc/sadko.env <<EOF
# SADKO runtime configuration. Restart after editing:  sudo systemctl restart sadko
PORT=$PORT

# Sign in with Google — free. See LAUNCH.md for how to create the client id.
# Leave blank and the site simply hides the Google button.
GOOGLE_CLIENT_ID=

# Both optional. Without them the comparer falls back to its rule-based path.
NVIDIA_API_KEY=
TAVILY_API_KEY=
EOF
  chmod 600 /etc/sadko.env
  echo "created /etc/sadko.env — fill in GOOGLE_CLIENT_ID when you have it"
else
  echo "/etc/sadko.env already exists, leaving it alone"
fi

# ---------------------------------------------------------------------------
say "Installing the systemd service"
install -m 644 "$(dirname "$0")/sadko.service" /etc/systemd/system/sadko.service
systemctl daemon-reload
systemctl enable sadko >/dev/null

say "Configuring Caddy for $DOMAIN"
sed -e "s|{{DOMAIN}}|$DOMAIN|g" -e "s|{{EMAIL}}|${EMAIL:-admin@$DOMAIN}|g" -e "s|{{PORT}}|$PORT|g" \
  "$(dirname "$0")/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null

# ---------------------------------------------------------------------------
say "Firewall (host level — you must ALSO open 80/443 in the GCP firewall)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -8

say "Installing the nightly backup timer"
install -m 755 "$(dirname "$0")/backup.sh" /usr/local/bin/sadko-backup
cat > /etc/systemd/system/sadko-backup.service <<'EOF'
[Unit]
Description=SADKO database backup
[Service]
Type=oneshot
User=sadko
ExecStart=/usr/local/bin/sadko-backup
EOF
cat > /etc/systemd/system/sadko-backup.timer <<'EOF'
[Unit]
Description=Nightly SADKO database backup
[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now sadko-backup.timer >/dev/null

cat <<EOF

$(printf '\033[1;32m')Provisioning done.$(printf '\033[0m')

Next:
  1. Put the code in place (as the sadko user):
       sudo -u $APP_USER git clone <your-repo-url> $APP_DIR/repo
     ...or rsync your working copy to $APP_DIR/repo (the service expects
     $APP_DIR/repo/site/compare-server.mjs).

  2. Point $DOMAIN at this VM's external IP (an A record), and open 80+443
     in the GCP firewall (see LAUNCH.md §5G.4).

  3. Start it:
       sudo systemctl start sadko caddy
       curl -s localhost:$PORT/healthz

  4. Watch the logs the first time:
       sudo journalctl -u sadko -f

EOF
