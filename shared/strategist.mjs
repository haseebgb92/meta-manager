// Shared by the desktop strategist view and ChatGPT-facing MCP service.
// No model API and no account data leaves Meta Manager in this module.
export const DEFAULT_STRATEGIST = Object.freeze({
  enabled: false,
  platforms: [],
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  timeLocal: "10:00",
  timezone: "Asia/Karachi",
  bufferDays: 14,
  mode: "draft",
  website: "",
  description: "",
  audience: "",
  tone: "",
  pillars: "",
  avoid: "",
});

export function allowedPlatforms(account) {
  if (!account) return [];
  if (account.status === "linkedin_connected") return ["linkedin"];
  const result = [];
  if (account.facebookPageId ?? account.facebook_page_id) result.push("facebook");
  if (account.instagramAccountId ?? account.instagram_account_id) result.push("instagram");
  return result;
}

export function normalizeProfile(profile, account) {
  const data = { ...DEFAULT_STRATEGIST, ...(profile ?? {}) };
  data.enabled = Boolean(data.enabled);
  const possible = allowedPlatforms(account);
  data.platforms = [...new Set(Array.isArray(data.platforms) ? data.platforms : [])]
    .filter((p) => possible.includes(p));
  data.weekdays = [...new Set(Array.isArray(data.weekdays) ? data.weekdays : [])]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
  data.timeLocal = typeof data.timeLocal === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(data.timeLocal)
    ? data.timeLocal : DEFAULT_STRATEGIST.timeLocal;
  data.bufferDays = 14;
  data.mode = data.mode === "schedule" ? "schedule" : "draft";
  try { new Intl.DateTimeFormat("en-US", { timeZone: data.timezone }).format(); }
  catch { data.timezone = DEFAULT_STRATEGIST.timezone; }
  for (const k of ["website", "description", "audience", "tone", "pillars", "avoid"]) {
    data[k] = String(data[k] ?? "").trim().slice(0, 4000);
  }
  return data;
}

const formatterCache = new Map();
function formatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }));
  }
  return formatterCache.get(timeZone);
}
function parts(instant, zone) {
  const entries = formatter(zone).formatToParts(new Date(instant));
  return Object.fromEntries(entries.filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
}
export function localDate(instant, zone) {
  const p = parts(instant, zone);
  return p.year + "-" + p.month + "-" + p.day;
}
export function zonedScheduleIso(day, time, zone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Invalid local date or time");
  }
  const requested = Date.parse(day + "T" + time + ":00Z");
  if (!Number.isFinite(requested)) throw new Error("Invalid date");
  let guess = requested;
  for (let n = 0; n < 4; n++) {
    const p = parts(guess, zone);
    const observed = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += requested - observed;
  }
  const p = parts(guess, zone);
  if (p.year + "-" + p.month + "-" + p.day !== day ||
      p.hour + ":" + p.minute !== time) {
    throw new Error("Nonexistent local time; choose a different time near daylight-saving changes");
  }
  return new Date(guess).toISOString();
}
function nextDay(day) {
  const ms = Date.parse(day + "T12:00:00Z") + 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}
function weekDay(day) {
  const dow = new Date(day + "T12:00:00Z").getUTCDay();
  return dow === 0 ? 7 : dow;
}
function itemDestinations(item) {
  if (item.platform === "both") return ["facebook", "instagram"];
  return [item.platform];
}

export function strategistCoverage({ profile, account, items = [], reservations = [], now = new Date() }) {
  const config = normalizeProfile(profile, account);
  const result = { accountId: account?.id, accountName: account?.name, enabled: config.enabled,
    timezone: config.timezone, mode: config.mode, platforms: config.platforms, gaps: [],
    pending: [], covered: [], blocked: [] };
  if (!config.enabled) return result;
  const today = localDate(now, config.timezone);
  let day = today;
  for (let i = 0; i < config.bufferDays; i++, day = nextDay(day)) {
    if (!config.weekdays.includes(weekDay(day))) continue;
    for (const platform of config.platforms) {
      const plannedIso = zonedScheduleIso(day, config.timeLocal, config.timezone);
      if (Date.parse(plannedIso) <= new Date(now).getTime()) continue;
      const slot = { accountId: account.id, accountName: account.name, platform,
        localDate: day, timeLocal: config.timeLocal, timezone: config.timezone,
        scheduledFor: plannedIso };
      const matching = items.find((item) => item.accountId === account.id &&
        ["scheduled", "published"].includes(item.status) &&
        itemDestinations(item).includes(platform) &&
        item.scheduledFor && localDate(item.scheduledFor, config.timezone) === day);
      if (matching) { result.covered.push({ ...slot, itemId: matching.id }); continue; }
      const reservation = reservations.find((item) => item.accountId === account.id &&
        item.platform === platform && item.localDate === day);
      if (reservation) {
        const created = items.find((item) => item.id === reservation.calendarItemId);
        if (created && created.status === "draft") {
          result.pending.push({ ...slot, itemId: created.id }); continue;
        }
        // A failed/deleted draft must be manually reconciled before retrying.
        result.blocked.push({ ...slot, reason: "Existing AI reservation requires review" });
        continue;
      }
      result.gaps.push(slot);
    }
  }
  return result;
}
