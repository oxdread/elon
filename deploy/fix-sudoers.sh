#!/usr/bin/env bash
# Run as ubuntu (sudo) on the VPS: bash /home/backtest/app/deploy/fix-sudoers.sh
set -euo pipefail

python3 - <<'PYEOF'
content = (
    "Defaults:backtest !requiretty\n"
    "backtest ALL=(root) NOPASSWD:"
    " /usr/bin/systemctl stop backtest-fetcher,"
    " /usr/bin/systemctl stop backtest-web,"
    " /usr/bin/systemctl start backtest-fetcher,"
    " /usr/bin/systemctl start backtest-web,"
    " /usr/bin/systemctl restart backtest-fetcher,"
    " /usr/bin/systemctl restart backtest-web\n"
)
with open("/etc/sudoers.d/backtest", "w") as f:
    f.write(content)
print("written")
PYEOF

chmod 440 /etc/sudoers.d/backtest
visudo -c
echo "--- file content ---"
cat /etc/sudoers.d/backtest
echo "--- test sudo as backtest ---"
sudo -u backtest sudo -n systemctl status backtest-fetcher > /dev/null && echo "sudo OK"
