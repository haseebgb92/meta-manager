# Meta Manager — 00:15 rolling seven-day scheduling

## Enabled components

1. **Linux preflight at 00:05 Pakistan time** (systemd user timer, Persistent): checks the local MCP service and, if the computer is powered on, starts a missing Meta Manager GUI or ChatGPT MCP Bridge when a graphical session exists, with a headless local MCP fallback if needed. It records the next seven days' **confirmed cloud-scheduled/published** slots in `~/.local/state/meta-manager-ai/last_status.json` with a private log. It makes no external posting changes.
2. **ChatGPT scheduled content task at 00:15 Pakistan time**: attempts original, account-isolated writing and media production and schedules actual completed posts when the necessary approved connected tools can be accessed in that Scheduled task run.
3. **Meta Manager cloud publisher** runs independently at the scheduled per-post time (8 PM PKT). These previously queued cloud posts can publish even when desktop is shut down.

The workflow moves forward by one day every night. Existing posts count toward coverage. Native Instagram Reels count as Instagram content slots, not separate extra postings. LinkedIn uses configured weekdays, not necessarily every calendar day.

## Install and test

Run `bash scripts/install-overnight-systemd.sh` from the repository. If supported and approved, enable user-service persistence while logged out with `sudo loginctl enable-linger "$USER"`. `systemctl --user start meta-manager-overnight-preflight.service` executes a safe read-only test immediately.

Check `systemctl --user status meta-manager-overnight-preflight.timer` and `cat ~/.local/state/meta-manager-ai/last_status.json`. The local app and bridge need a running graphical X11 session to display windows; fallback local MCP can still run headless while the machine is on. **A PC that is powered off cannot be turned on remotely by this script or a ChatGPT web task.**

## Important content-generation limitation

ChatGPT Scheduled tasks do not inherently expose this computer's browser, Flow session, video renderer or the full local MCP tool catalog. A working scheduled task must be verified with a real, successful overnight run using the actual connected tool permissions. Without a supported media-generation/hosting integration, the content producer cannot automatically create true Instagram Reels; do not insert empty text-only posts or counterfeit media. The Python preflight is deliberately only a read-only audit, not a fake AI generator. No paid API has been configured.

The first successful unattended run must be validated for each account: account ID, brand profile fingerprint, 7-day buffer coverage, content originality, actual hosted MP4/JPEG, platform-specific post type, cloud job ID, and 8 PM PKT local scheduled time. Unknown status and expired social tokens are blockers, not silent success.

To disable local preflight without deleting scheduled cloud content: `systemctl --user disable --now meta-manager-overnight-preflight.timer`.
