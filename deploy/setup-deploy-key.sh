#!/usr/bin/env bash
# Generates a deploy SSH key for the backtest user, registers the public half
# in authorized_keys, and prints the private half for copying into the GitHub
# repo secret VPS_SSH_KEY.
set -euo pipefail

KEY=/home/backtest/.ssh/deploy_key

if [ ! -f "$KEY" ]; then
    sudo -u backtest mkdir -p /home/backtest/.ssh
    sudo -u backtest ssh-keygen -t ed25519 -N "" -f "$KEY" -C "github-actions-deploy"
fi

sudo -u backtest bash -c "grep -qxFf ${KEY}.pub /home/backtest/.ssh/authorized_keys 2>/dev/null || cat ${KEY}.pub >> /home/backtest/.ssh/authorized_keys"
sudo -u backtest chmod 600 /home/backtest/.ssh/authorized_keys

echo
echo "============================================================"
echo " COPY EVERYTHING BELOW (including BEGIN/END lines)"
echo " Paste into GitHub repo Secret: VPS_SSH_KEY"
echo "============================================================"
cat "$KEY"
echo "============================================================"
echo
echo " Also add Secret VPS_HOST = $(curl -s ifconfig.me || echo '<your-vps-ip>')"
echo "============================================================"
