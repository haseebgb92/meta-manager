# Meta Manager AI Strategist — account-safe initial implementation

## Purpose

Maintain an independent, rolling **14-day** content calendar for each explicitly selected social workspace without using a separate OpenAI model API. ChatGPT is the content strategist; the Meta Manager desktop MCP service remains the source of truth for workspace identity, publishing destinations and scheduled slots.

## What's included

- **AI Strategist** tab in the desktop app.
- Per-workspace business/offer description, website, audience, voice, content pillars and restricted topics.
- Explicit opt-in by workspace, connected platform and weekdays; time and IANA time zone settings.
- Default **disabled**; default mode **draft requiring approval**.
- A 14-day gap scanner that counts existing scheduled posts for the correct workspace and platform, including dual-platform legacy posts.
- ChatGPT MCP **get_strategist_brief** (lists enabled brands and missing days) and **strategist_queue_post** (queues only a valid missing destination/date).
- SQLite reservation with UNIQUE(account_id, platform, local_date) for retry-safety; pending drafts are reserved, and failed/stale reservations require human review.
- Posts require a current workspace-specific profile fingerprint from the ChatGPT brief; stale or wrong-brand context is rejected.
- Drafts have an explicit per-post Approve & schedule control. Scheduled mode only when explicitly enabled in that workspace's settings. The tool never publishes immediately.
- Unit and SQLite MCP integration tests.

## Setup

1. Install the build containing AI Strategist; open **AI Strategist** from the sidebar.
2. Choose one connected workspace; fill in the brand profile. Select destinations and days, then choose **Drafts** (recommended) or **Auto-schedule**.
3. Enable AI for this workspace and press **Save this account**. Repeat only for other workspaces you want ChatGPT to manage.
4. In ChatGPT, with the existing Meta Manager MCP connection active, create a recurring ChatGPT Task. Copy the daily instructions from the AI Strategist tab or use the sample below.
5. Run a manual trial. Inspect generated drafts, media, destination accounts, date and voice before allowing automatic scheduling.
6. If cloud publication while the computer is off is desired, connect the existing cloud scheduler for the appropriate platforms. Local scheduling alone requires the desktop app to be running.

## Recommended ChatGPT task prompt

> Each morning, use the Meta Manager tools to call get_strategist_brief. Process only enabled accounts. For each account, call get_account_dashboard and research_content using that account's exact account_id. Consult its independent profile, avoid prohibited claims, and check every uncovered platform/date slot. Prepare relevant original copy and an approved media URL when the platform requires it. Call strategist_queue_post with the account's exact profile_fingerprint, account_id, platform, local_date, title, caption, hashtags and media URL for each valid slot. Never cross-use business details or creative between workspaces. Never schedule a duplicate slot. Draft mode means drafts for approval; schedule mode means the workspace owner has authorized scheduling. Do not publish immediately. Report gaps caused by missing media, disconnected accounts or publishing failures. Never report that a post was scheduled unless the tool confirms it.

## Operational limitations

- Meta Manager **does not and cannot itself summon a ChatGPT conversation** via the user's ChatGPT login. The unattended brain must be a **ChatGPT-side scheduled task** that can access the connected MCP service. Availability of actions in scheduled tasks depends on the current ChatGPT product/connection permissions.
- The MCP bridge and Meta Manager desktop must be online when ChatGPT calls their local tools. After content has been transferred to the cloud scheduler, cloud publishing can run without the desktop.
- Instagram publishing requires actual, public HTTPS media. This feature does not magically produce or host media: ChatGPT must obtain approved media and supply its URL or leave the slot blocked for review.
- AI content quality and compliance require review; a profile is guidance, not a guarantee.
- Automatic scheduling is per-account opt-in. Automatic publishing happens only through the existing authorized scheduler after the job is due.
- Pending drafts reserve an AI slot, even before approval; unlike scheduled posts, they do not guarantee content will go live. The dashboard shows them separately.
- No migrations delete or rewrite existing accounts, scheduled posts, or social connection secrets.
- There is no OAuth "Sign in with ChatGPT" integration in this version; it uses the existing connected MCP tools and no new model API key.

## Validation

- Run npm run test:strategist for coverage/isolated destination/date and MCP queue tests.
- Run npm run build and npm run mcp:bundle.
- Run cargo check --manifest-path src-tauri/Cargo.toml.
- Verify the AI Strategist tab displays each brand separately, default disabled.
- Enable only one test account first; confirm no posts appear under another account.
- Turn off AI to confirm subsequent get_strategist_brief excludes the workspace.
- Check the currently running build and cloud scheduler independently before promising unattended posting.
