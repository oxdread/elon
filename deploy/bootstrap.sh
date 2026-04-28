#!/usr/bin/env bash
# One-time VPS bootstrap. Run AS ROOT on a fresh Ubuntu 22.04+ VPS.
#
#   bash bootstrap.sh <github-user>/<repo>
#
# Example:
#   bash bootstrap.sh punyaku/backtest
#
# After this finishes, the dashboard is at http://<vps-ip>:3000
# Make sure port 3000 is open in your cloud provider's firewall.
set -euo pipefail

REPO="${1:?usage: bootstrap.sh <github-user>/<repo>}"
APP_USER=backtest
APP_DIR=/home/$APP_USER/app

echo "[bootstrap] installing system packages..."
apt-get update
apt-get install -y \
    git curl ca-certificates build-essential \
    python3 python3-venv python3-pip

# Node 20 from NodeSource
if ! command -v node >/dev/null || [[ "$(node -v)" != v20* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo "[bootstrap] creating user $APP_USER..."
id -u $APP_USER >/dev/null 2>&1 || useradd -m -s /bin/bash $APP_USER

echo "[bootstrap] cloning repo..."
# Use SSH so private repos work via deploy key. Make sure github.com is in
# known_hosts for the backtest user to avoid the interactive prompt.
sudo -u $APP_USER mkdir -p /home/$APP_USER/.ssh
sudo -u $APP_USER ssh-keyscan -H github.com >> /home/$APP_USER/.ssh/known_hosts 2>/dev/null
# Copy the ubuntu user's deploy key over to backtest so it can pull
if [ -f /home/ubuntu/.ssh/id_ed25519 ] && [ ! -f /home/$APP_USER/.ssh/id_ed25519 ]; then
    cp /home/ubuntu/.ssh/id_ed25519 /home/$APP_USER/.ssh/id_ed25519
    cp /home/ubuntu/.ssh/id_ed25519.pub /home/$APP_USER/.ssh/id_ed25519.pub
    chown $APP_USER:$APP_USER /home/$APP_USER/.ssh/id_ed25519 /home/$APP_USER/.ssh/id_ed25519.pub
    chmod 600 /home/$APP_USER/.ssh/id_ed25519
fi
if [ ! -d "$APP_DIR/.git" ]; then
    sudo -u $APP_USER git clone "git@github.com:$REPO.git" "$APP_DIR"
else
    sudo -u $APP_USER git -C "$APP_DIR" pull
fi

echo "[bootstrap] python venv..."
sudo -u $APP_USER python3 -m venv "$APP_DIR/.venv"
sudo -u $APP_USER "$APP_DIR/.venv/bin/pip" install --upgrade pip
sudo -u $APP_USER "$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

echo "[bootstrap] data dir..."
sudo -u $APP_USER mkdir -p "$APP_DIR/data"

echo "[bootstrap] web build..."
cd "$APP_DIR/web"
sudo -u $APP_USER npm ci
sudo -u $APP_USER npm run build
cd -

echo "[bootstrap] systemd units..."
cp "$APP_DIR/deploy/systemd/backtest-fetcher.service" /etc/systemd/system/
cp "$APP_DIR/deploy/systemd/backtest-web.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now backtest-fetcher backtest-web

echo "[bootstrap] sudoers (allow $APP_USER to restart services)..."
cat > /etc/sudoers.d/backtest <<EOF
Defaults:$APP_USER !requiretty
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl stop backtest-fetcher, /usr/bin/systemctl stop backtest-web, /usr/bin/systemctl start backtest-fetcher, /usr/bin/systemctl start backtest-web, /usr/bin/systemctl restart backtest-fetcher, /usr/bin/systemctl restart backtest-web
EOF
chmod 440 /etc/sudoers.d/backtest

# Open port 3000 if ufw is active
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 3000/tcp || true
fi

echo
echo "[bootstrap] done."
echo "  - Services:    systemctl status backtest-fetcher backtest-web"
echo "  - Logs:        journalctl -u backtest-fetcher -f"
echo "  - Dashboard:   http://<this-vps-ip>:3000"
echo
echo "IMPORTANT: open TCP port 3000 in your cloud provider's firewall console"
echo "           (Tencent Lighthouse, AWS security group, etc) — ufw alone is"
echo "           not enough."
echo
echo "Next: add an SSH key for the '$APP_USER' user and put the private half"
echo "in GitHub repo secrets as VPS_SSH_KEY (and VPS_HOST=<this server's IP>)."
