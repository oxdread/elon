# Deploy

One Ubuntu VPS runs two systemd services. The Next.js dashboard is exposed
directly on port 3000 (no nginx, no HTTPS — IP-only access). GitHub Actions
SSHes in on every push to `main` and runs `deploy/deploy.sh`.

## Layout on the VPS

```
/home/backtest/app          ← git checkout (this repo)
              /.venv        ← Python venv
              /data         ← SQLite DB lives here (gitignored)
              /web/.next    ← built Next.js app
```

Two services:
- `backtest-fetcher` → `python -m collector.fetcher`
- `backtest-web`     → `npm run start` in `web/` (binds 0.0.0.0:3000)

## First-time setup

1. **Spin up an Ubuntu 22.04+ VPS**.
2. **Open TCP port 3000** in your cloud provider's firewall console
   (Tencent Lighthouse, AWS security group, etc). The provider firewall is
   separate from `ufw` and must be configured in the web console.
3. **SSH in as root** and run:
   ```bash
   curl -O https://raw.githubusercontent.com/<you>/backtest/main/deploy/bootstrap.sh
   bash bootstrap.sh <you>/backtest
   ```
   This installs everything, clones the repo, builds, and starts services.

4. **Visit** `http://<vps-ip>:3000` — you should see the dashboard.

5. **Create a deploy SSH key** on the VPS for the `backtest` user:
   ```bash
   sudo -u backtest ssh-keygen -t ed25519 -N "" -f /home/backtest/.ssh/deploy_key
   sudo -u backtest bash -c 'cat /home/backtest/.ssh/deploy_key.pub >> /home/backtest/.ssh/authorized_keys'
   sudo -u backtest cat /home/backtest/.ssh/deploy_key   # copy this private key
   ```

6. **Add GitHub repo secrets** (Settings → Secrets and variables → Actions):
   - `VPS_HOST` — VPS IP
   - `VPS_SSH_KEY` — the private key from step 5

7. **Push to main** — the workflow runs and re-deploys automatically.

## Commands

```bash
# status / logs
systemctl status backtest-fetcher backtest-web
journalctl -u backtest-fetcher -f
journalctl -u backtest-web -f

# manual deploy (as backtest user)
sudo -u backtest /home/backtest/app/deploy/deploy.sh

# restart manually
sudo systemctl restart backtest-fetcher backtest-web
```
