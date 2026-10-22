import crypto from "node:crypto";
import { normalizeProfile, strategistCoverage } from "../shared/strategist.mjs";

// The model NEVER supplies destination IDs or schedule timestamps. Both are
// resolved server-side from the selected local workspace and its saved profile.
export function registerStrategistTools(server, { db, getAccount, listAccounts, httpsUrl, textResult, z }) {
  function connection() {
    const c = db();
    c.exec("PRAGMA foreign_keys=ON");
    c.exec("CREATE TABLE IF NOT EXISTS strategist_profiles (account_id TEXT PRIMARY KEY, config_json TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE)");
    c.exec("CREATE TABLE IF NOT EXISTS strategist_slots (account_id TEXT NOT NULL, platform TEXT NOT NULL, local_date TEXT NOT NULL, calendar_item_id TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(account_id,platform,local_date), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE, FOREIGN KEY(calendar_item_id) REFERENCES calendar_items(id) ON DELETE CASCADE)");
    return c;
  }
  function profile(c, account) {
    const record = c.prepare("SELECT config_json FROM strategist_profiles WHERE account_id=?").get(account.id);
    let parsed = {};
    if (record) {
      try { parsed = JSON.parse(record.config_json); }
      catch { throw new Error("Strategist settings are corrupt for workspace " + account.id); }
    }
    return normalizeProfile(parsed, account);
  }
  function localItems(c, accountId) {
    return c.prepare("SELECT id,account_id AS accountId,platform,status,scheduled_for AS scheduledFor FROM calendar_items WHERE account_id=?").all(accountId);
  }
  function reserved(c, accountId) {
    return c.prepare("SELECT account_id AS accountId,platform,local_date AS localDate,calendar_item_id AS calendarItemId FROM strategist_slots WHERE account_id=?").all(accountId);
  }
  function brief(c, account, now) {
    const config = profile(c, account);
    const coverage = strategistCoverage({ profile: config, account, items: localItems(c, account.id),
      reservations: reserved(c, account.id), now });
    const profileFingerprint = crypto.createHash("sha256").update(account.id + "\n" + JSON.stringify(config)).digest("hex").slice(0, 32);
    return {
      accountId: account.id, accountName: account.name, profileFingerprint,
      connectedDestinations: { facebookPageId: account.facebookPageId ?? null,
        instagramAccountId: account.instagramAccountId ?? null,
        linkedinWorkspace: account.status === "linkedin_connected" },
      profile: config, coverage,
      rule: "Use ONLY this workspace's description, audience, tone, pillars and avoid topics. Research this account independently. Do not copy content, assets, facts, or destination IDs from another workspace. Never invent offers or prices.",
    };
  }

  server.registerTool("get_strategist_brief", {
    description: "Find safe upcoming content gaps for explicitly enabled AI Strategist workspaces. Includes their separate brand profiles, pending approvals, and destination IDs. Use before creating any AI-managed posts. No API key required.",
    inputSchema: { account_id: z.string().optional() },
  }, async ({ account_id }) => {
    const c = connection();
    try {
      const accounts = account_id ? [getAccount(account_id)].filter(Boolean) : listAccounts();
      if (account_id && accounts.length === 0) throw new Error("Workspace not found");
      const all = accounts.map((a) => brief(c, a, new Date())).filter((b) => b.profile.enabled);
      return textResult({ generatedAt: new Date().toISOString(), bufferDays: 14,
        accounts: all, disabledCount: accounts.length - all.length,
        workflow: "For each enabled account: call get_account_dashboard and research_content with that same account_id; build original content according to its separate brand profile; for each gap call strategist_queue_post with the exact account_id, platform and local_date. Never call publish_post without explicit user approval. The initial mode is draft only. Cloud scheduling is a separate step requiring permitted cloud connections and confirmation." });
    } finally { c.close(); }
  });

  server.registerTool("strategist_queue_post", {
    description: "Create exactly one account-bound AI post for a missing planned date/platform. Draft by default; scheduled only if the human explicitly enabled schedule mode in that account's saved profile. Does not immediately publish. Enforces unique slot reservation, connected destination, profile, schedule and media constraints.",
    inputSchema: {
      account_id: z.string(), profile_fingerprint: z.string().length(32), platform: z.enum(["facebook", "instagram", "linkedin"]),
      local_date: z.string(), title: z.string().min(1).max(160),
      caption: z.string().min(1).max(10000),
      hashtags: z.array(z.string()).max(30).optional(),
      media_url: z.string().url().optional(), link_url: z.string().url().optional(),
    },
  }, async ({ account_id, profile_fingerprint, platform, local_date, title, caption, hashtags = [], media_url, link_url }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(local_date)) throw new Error("Invalid local date");
    const account = getAccount(account_id);
    if (!account) throw new Error("Unknown workspace");
    if (account.status !== "connected" && account.status !== "linkedin_connected") throw new Error("Social workspace is disconnected");
    if (media_url && !httpsUrl(media_url)) throw new Error("Media must use public HTTPS");
    if (link_url && !httpsUrl(link_url)) throw new Error("Link must use HTTPS");
    if (platform === "instagram" && !media_url) throw new Error("Instagram requires publicly hosted media");
    if (hashtags.some((h) => typeof h !== "string" || h.length > 100)) throw new Error("Invalid hashtag");
    const c = connection();
    try {
      c.exec("BEGIN IMMEDIATE");
      const b = brief(c, account, new Date());
      if (!b.profile.enabled) throw new Error("AI Strategist is disabled for this workspace");
      if (profile_fingerprint !== b.profileFingerprint) throw new Error("Brand profile has changed or belongs to another account; refresh the strategist brief");
      if (!b.profile.platforms.includes(platform)) throw new Error("Destination not enabled in this workspace");
      const slot = b.coverage.gaps.find((g) => g.platform === platform && g.localDate === local_date);
      if (!slot) throw new Error("No eligible empty slot; already filled, reserved, or outside the 14-day calendar");
      const id = crypto.randomUUID();
      const schedule = b.profile.mode === "schedule";
      c.prepare("INSERT INTO calendar_items (id,account_id,title,platform,status,caption,hashtags,media_url,link_url,scheduled_for,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
        .run(id, account_id, title.trim(), platform, schedule ? "scheduled" : "draft",
          caption.trim(), JSON.stringify(hashtags), media_url ?? null, link_url ?? null,
          schedule ? slot.scheduledFor : null);
      c.prepare("INSERT INTO strategist_slots(account_id,platform,local_date,calendar_item_id) VALUES(?,?,?,?)")
        .run(account_id, platform, local_date, id);
      c.exec("COMMIT");
      return textResult({ id, accountId: account_id, accountName: account.name, platform,
        localDate: local_date, plannedFor: slot.scheduledFor,
        scheduledFor: schedule ? slot.scheduledFor : null, status: schedule ? "scheduled" : "draft",
        approvalRequired: !schedule,
        note: schedule ? "Scheduled in local calendar; cloud scheduling requires a separate authorized step." :
          "Held as a draft, reserving this slot until approval." });
    } catch (error) {
      try { c.exec("ROLLBACK"); } catch {}
      throw error;
    } finally { c.close(); }
  });
}
