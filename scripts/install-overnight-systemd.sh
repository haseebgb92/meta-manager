#!/usr/bin/env bash
# Idempotent Linux Mint / systemd-user setup. Requires opt-in for linger via sudo.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install -d -m 700 "$HOME/.local/lib/meta-manager" "$HOME/.local/state/meta-manager-ai"
install -d -m 755 "$HOME/.config/systemd/user"
install -m 700 "$REPO_ROOT/scripts/overnight_preflight.py" "$HOME/.local/lib/meta-manager/overnight_preflight.py"
for unit in meta-manager-overnight-desktop.service meta-manager-overnight-bridge.service meta-manager-overnight-mcp.service meta-manager-overnight-preflight.service meta-manager-overnight-preflight.timer; do
    install -m 644 "$REPO_ROOT/linux/systemd/$unit" "$HOME/.config/systemd/user/$unit"
done
systemctl --user daemon-reload
systemctl --user enable --now meta-manager-overnight-preflight.timer
printf '\nNight preflight scheduled at 00:05 local time; cloud ChatGPT Task is a separate 00:15 step.\n'
systemctl --user list-timers meta-manager-overnight-preflight.timer
printf '\nTo enable timer persistence while logged out and PC remains powered on: sudo loginctl enable-linger "$USER"\n'
