import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, CalendarClock, CheckCircle2, Clipboard, RefreshCw, ShieldCheck } from "lucide-react";
import type { LocalAccount, LocalCalendarItem, StrategistConfig, StrategistProfile, StrategistSlot } from "./localApi";
import { getCalendar, listStrategistProfiles, listStrategistSlots, saveStrategistProfile } from "./localApi";
import { allowedPlatforms, normalizeProfile, strategistCoverage } from "../shared/strategist.mjs";
import "./StrategistPage.css";

const WEEKDAYS = [
  ["Mon",1],["Tue",2],["Wed",3],["Thu",4],["Fri",5],["Sat",6],["Sun",7],
] as const;

function strategyTask() {
  return [
    "Each morning run the Meta Manager AI Strategist for the next 14 days.",
    "Call get_strategist_brief. Work ONLY on explicitly enabled accounts.",
    "For each enabled account_id, independently call get_account_dashboard and research_content for that exact account_id.",
    "Use ONLY that account's separate brand profile and connected destinations. Never mix client businesses, logos, offers, audiences, media or platform IDs.",
    "Check each uncovered platform/date slot and compose a factual, original post appropriate to that business.",
    "For each valid gap call strategist_queue_post(account_id, platform, local_date, title, caption, hashtags and media_url when needed).",
    "Never generate the same slot twice. Never invent product details or promotions. Instagram requires publicly hosted HTTPS media; otherwise report the blocker.",
    "Leave posts as drafts unless the account owner has explicitly enabled schedule mode. Never call publish_post without explicit authorization.",
    "Report planned, pending approval, scheduled and blocked slots separately for each account.",
    "If Meta Manager MCP is disconnected, report the connectivity issue instead of claiming content was scheduled.",
  ].join("\n");
}

export default function StrategistPage({ accounts }: { accounts: LocalAccount[] }) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [profiles, setProfiles] = useState<Record<string, StrategistConfig>>({});
  const [calendar, setCalendar] = useState<LocalCalendarItem[]>([]);
  const [slots, setSlots] = useState<StrategistSlot[]>([]);
  const [draft, setDraft] = useState<StrategistConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [saved, items, reserved] = await Promise.all([listStrategistProfiles(), getCalendar(), listStrategistSlots()]);
      setProfiles(Object.fromEntries(saved.map((p: StrategistProfile) => [p.accountId, p.config])));
      setCalendar(items);
      setSlots(reserved);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (accounts.length && !accounts.some((a) => a.id === selectedId)) setSelectedId(accounts[0].id);
  }, [accounts, selectedId]);

  const selected = accounts.find((a) => a.id === selectedId);
  useEffect(() => {
    if (selected) setDraft(normalizeProfile(profiles[selected.id], selected));
    else setDraft(null);
    setMessage("");
  }, [selectedId, selected, profiles]);

  const coverage = useMemo(() => accounts.map((account) => {
    const config = normalizeProfile(profiles[account.id], account);
    return {
      account,
      config,
      audit: strategistCoverage({ profile: config, account, items: calendar, reservations: slots }),
    };
  }), [accounts, profiles, calendar, slots]);
  const enabledCount = coverage.filter((x) => x.config.enabled).length;
  const openCount = coverage.reduce((n, x) => n + x.audit.gaps.length, 0);
  const pendingCount = coverage.reduce((n, x) => n + x.audit.pending.length, 0);
  const selectedCoverage = coverage.find((x) => x.account.id === selectedId);
  const allowed = selected ? allowedPlatforms(selected) : [];

  function update<K extends keyof StrategistConfig>(key: K, value: StrategistConfig[K]) {
    setDraft((old) => old ? { ...old, [key]: value } : old);
  }

  async function save() {
    if (!selected || !draft) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const normalized = normalizeProfile(draft, selected);
      if (normalized.enabled && (!normalized.platforms.length || !normalized.weekdays.length ||
          normalized.description.length < 10 || !normalized.audience)) {
        throw new Error("Add a business description, audience, posting days and destinations before enabling AI.");
      }
      const saved = await saveStrategistProfile(selected.id, normalized);
      setProfiles((previous) => ({ ...previous, [selected.id]: saved.config }));
      setMessage("Saved for " + selected.name + ". Other accounts were not changed.");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function copyTask() {
    try {
      await navigator.clipboard.writeText(strategyTask());
      setMessage("Daily ChatGPT task instructions copied. Schedule them in ChatGPT Tasks with the Meta Manager connection enabled.");
    } catch {
      setError("Clipboard unavailable. Open ChatGPT and use the workflow described in this panel.");
    }
  }

  return (
    <section className="page-panel strategist-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">ACCOUNT-SAFE CONTENT AUTOMATION</span>
          <h2><BrainCircuit size={25} /> AI Strategist</h2>
          <p>Maintain a rolling 14-day calendar for selected brands. Every setting and destination is isolated by workspace ID.</p>
        </div>
        <button className="secondary" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw size={16}/> {loading ? "Refreshing..." : "Refresh coverage"}
        </button>
      </div>

      <div className="strategist-metrics">
        <article className="card"><strong>{enabledCount}</strong><span>Enabled accounts</span></article>
        <article className="card"><strong>{openCount}</strong><span>Open posting slots</span></article>
        <article className="card"><strong>{pendingCount}</strong><span>AI drafts awaiting approval</span></article>
        <article className="card"><strong>14 days</strong><span>Rolling content horizon</span></article>
      </div>

      <div className="strategist-layout">
        <aside className="card strategist-accounts">
          <h3>Individual accounts</h3>
          <p>Automation is off until enabled and saved for each account.</p>
          {accounts.map((account) => {
            const audit = coverage.find((c) => c.account.id === account.id);
            return (
              <button key={account.id} className={selectedId === account.id ? "strategist-account selected" : "strategist-account"}
                onClick={() => setSelectedId(account.id)}>
                <span><strong>{account.name}</strong><small>{audit?.config.enabled ? "AI enabled" : "AI disabled"}</small></span>
                <small>{audit?.config.enabled ? String(audit.audit.gaps.length) + " gaps" : "Off"}</small>
              </button>
            );
          })}
          {!accounts.length && <p>Connect a social account to configure a strategist.</p>}
        </aside>

        {selected && draft && (
          <div className="strategist-details">
            <article className="card strategist-editor">
              <div className="strategist-section-title"><div><h3>{selected.name} — strategy rules</h3><p>Private to this workspace. No cross-client content reuse.</p></div>
                <label className="strategist-toggle">
                  <input type="checkbox" checked={draft.enabled} onChange={(e) => update("enabled", e.target.checked)}/>
                  <span>Enable AI</span>
                </label>
              </div>
              <div className="strategist-fields">
                <label>Business / offering<textarea rows={3} value={draft.description} onChange={(e) => update("description", e.target.value)} placeholder="What this business offers, products, services and approved claims" /></label>
                <label>Target audience<input value={draft.audience} onChange={(e) => update("audience", e.target.value)} placeholder="Who this content serves" /></label>
                <label>Official website<input value={draft.website} onChange={(e) => update("website", e.target.value)} placeholder="https://..." /></label>
                <label>Voice and tone<input value={draft.tone} onChange={(e) => update("tone", e.target.value)} placeholder="Clear, friendly, professional..." /></label>
                <label>Content pillars<textarea rows={2} value={draft.pillars} onChange={(e) => update("pillars", e.target.value)} placeholder="Education, offers, behind-the-scenes..." /></label>
                <label>Never publish / avoid<textarea rows={2} value={draft.avoid} onChange={(e) => update("avoid", e.target.value)} placeholder="Forbidden claims, competitor mentions, confidential details..." /></label>
              </div>

              <div className="strategist-subsection">
                <h4>Publishing destinations</h4>
                <div className="strategist-options">
                  {allowed.map((platform) => <label key={platform}>
                    <input type="checkbox" checked={draft.platforms.includes(platform)} onChange={(e) =>
                      update("platforms", e.target.checked ? [...draft.platforms, platform] : draft.platforms.filter((p) => p !== platform))
                    }/>{platform === "linkedin" ? "LinkedIn" : platform === "facebook" ? "Facebook" : "Instagram"}
                  </label>)}
                  {!allowed.length && <span>No connected publishing destinations.</span>}
                </div>
              </div>

              <div className="strategist-subsection">
                <h4>Posting days</h4>
                <div className="strategist-options">
                  {WEEKDAYS.map(([name, n]) => <label key={n}>
                    <input type="checkbox" checked={draft.weekdays.includes(n)} onChange={(e) =>
                      update("weekdays", e.target.checked ? [...draft.weekdays, n] : draft.weekdays.filter((d) => d !== n))
                    }/>{name}
                  </label>)}
                </div>
              </div>

              <div className="strategist-row-fields">
                <label>Local posting time<input type="time" value={draft.timeLocal} onChange={(e) => update("timeLocal", e.target.value)} /></label>
                <label>Time zone<input value={draft.timezone} onChange={(e) => update("timezone", e.target.value)} placeholder="Asia/Karachi" /></label>
                <label>Content mode<select value={draft.mode} onChange={(e) => update("mode", e.target.value as StrategistConfig["mode"])}>
                  <option value="draft">Drafts — approval required</option>
                  <option value="schedule">Auto-schedule — authorized</option>
                </select></label>
              </div>
              <p className="strategist-warning"><ShieldCheck size={15}/> ChatGPT cannot publish automatically simply by enabling AI. The workflow needs a connected, scheduled ChatGPT task. Auto-schedule mode lets that task create scheduled posts, not publish instantly.</p>
              <div className="strategist-actions">
                <button className="primary" disabled={saving} onClick={() => void save()}>
                  <CheckCircle2 size={16}/> {saving ? "Saving..." : "Save this account"}
                </button>
              </div>
            </article>

            <article className="card strategist-coverage">
              <h3><CalendarClock size={19}/> Upcoming coverage — {selected.name}</h3>
              <p>Existing scheduled posts are preserved. AI drafts reserve their target dates to prevent duplication.</p>
              <div className="strategist-counts">
                <span><strong>{selectedCoverage?.audit.covered.length ?? 0}</strong> covered</span>
                <span><strong>{selectedCoverage?.audit.gaps.length ?? 0}</strong> gaps</span>
                <span><strong>{selectedCoverage?.audit.pending.length ?? 0}</strong> awaiting approval</span>
                <span><strong>{selectedCoverage?.audit.blocked.length ?? 0}</strong> review needed</span>
              </div>
              <div className="strategist-slot-list">
                {(selectedCoverage?.audit.gaps ?? []).slice(0, 14).map((slot) =>
                  <div key={slot.platform + slot.localDate}><span>{slot.localDate} · {slot.platform}</span><small>Content needed</small></div>)}
                {selectedCoverage?.config.enabled && !selectedCoverage.audit.gaps.length &&
                  <p>No uncovered future slots for this account.</p>}
                {!selectedCoverage?.config.enabled && <p>Save an enabled strategist profile to start checking for content gaps.</p>}
              </div>
            </article>
          </div>
        )}
      </div>

      <article className="card strategist-task">
        <h3><BrainCircuit size={19}/> Connect the daily ChatGPT workflow</h3>
        <p>Meta Manager never uses a hidden API key to invoke ChatGPT. A daily ChatGPT Task must call the connected MCP strategist tools. Scheduled posts can then be handed to the existing cloud publisher when those connections are configured.</p>
        <button className="secondary" onClick={() => void copyTask()}><Clipboard size={16}/> Copy ChatGPT task instructions</button>
      </article>
      {error && <p className="strategist-error" role="alert">{error}</p>}
      {message && <p className="strategist-notice" role="status">{message}</p>}
    </section>
  );
}
