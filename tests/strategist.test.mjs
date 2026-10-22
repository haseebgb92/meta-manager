import assert from "node:assert/strict";
import test from "node:test";
import { allowedPlatforms, normalizeProfile, strategistCoverage, zonedScheduleIso, prioritizeActiveAccounts } from "../shared/strategist.mjs";

const facebook = { id: "brand-a", name: "Brand A", status: "connected", facebookPageId: "p1", instagramAccountId: "i1" };
const other = { id: "brand-b", name: "Brand B", status: "connected", facebookPageId: "p2", instagramAccountId: "i2" };
const setting = { enabled: true, platforms: ["facebook", "instagram"], weekdays: [1,2,3,4,5,6,7], timeLocal: "10:00", timezone: "Asia/Karachi", mode: "draft" };
const now = new Date("2026-10-22T02:00:00.000Z");

test("allow only actual platform destinations", () => {
  assert.deepEqual(allowedPlatforms({ ...facebook, instagramAccountId: null }), ["facebook"]);
  assert.deepEqual(normalizeProfile({ ...setting, platforms: ["linkedin", "facebook"] }, facebook).platforms, ["facebook"]);
});
test("7-day account-scoped gaps across platforms", () => {
  const a = strategistCoverage({ profile: setting, account: facebook, now });
  assert.equal(a.gaps.length, 14);
  const bItem = { id: "wrong-client", accountId: other.id, platform: "both", status: "scheduled", scheduledFor: a.gaps[0].scheduledFor };
  const b = strategistCoverage({ profile: setting, account: facebook, items: [bItem], now });
  assert.equal(b.gaps.length, 14, "Another client's queued content cannot fill a slot");
});
test("published and scheduled items cover their own destinations only", () => {
  const a = strategistCoverage({ profile: setting, account: facebook, now });
  const item = { id: "live", accountId: facebook.id, platform: "facebook", status: "scheduled", scheduledFor: a.gaps[0].scheduledFor };
  const b = strategistCoverage({ profile: setting, account: facebook, items: [item], now });
  assert.equal(b.gaps.length, 13);
  assert.equal(b.covered.length, 1);
});
test("AI drafts count as awaiting approval and cannot regenerate", () => {
  const a = strategistCoverage({ profile: setting, account: facebook, now });
  const reservation = { accountId: facebook.id, platform: "facebook", localDate: a.gaps[0].localDate, calendarItemId: "draft1" };
  const item = { id: "draft1", accountId: facebook.id, platform: "facebook", status: "draft" };
  const b = strategistCoverage({ profile: setting, account: facebook, items: [item], reservations: [reservation], now });
  assert.equal(b.pending.length, 1);
  assert.equal(b.gaps.length, 13);
});
test("time-zone schedule is an unambiguous UTC timestamp", () => {
  assert.equal(zonedScheduleIso("2026-10-22", "10:00", "Asia/Karachi"), "2026-10-22T05:00:00.000Z");
  assert.equal(zonedScheduleIso("2026-07-01", "10:00", "America/New_York"), "2026-07-01T14:00:00.000Z");
});
test("disabled account never generates tasks", () => {
  assert.equal(strategistCoverage({ profile: { ...setting, enabled: false }, account: facebook, now }).gaps.length, 0);
});

test("cloud-scheduled items fill coverage without generating duplicates", () => {
  const a = strategistCoverage({ profile: setting, account: facebook, now });
  const existing = { id: "cloud1", accountId: facebook.id, platform: "facebook",
    status: "cloud_scheduled", scheduledFor: a.gaps[0].scheduledFor };
  const b = strategistCoverage({ profile: setting, account: facebook, items: [existing], now });
  assert.equal(b.covered.length, 1);
  assert.equal(b.gaps.length, 13);
});

test("enabled accounts appear first without changing disabled order or mutating the source", () => {
  const items = [
    { account: { id: "disabled-1" }, config: { enabled: false } },
    { account: { id: "linkedin" }, config: { enabled: true } },
    { account: { id: "disabled-2" }, config: { enabled: false } },
    { account: { id: "instagram" }, config: { enabled: true } },
  ];
  const ordered = prioritizeActiveAccounts(items);
  assert.deepEqual(ordered.map((x) => x.account.id), ["linkedin", "instagram", "disabled-1", "disabled-2"]);
  assert.deepEqual(items.map((x) => x.account.id), ["disabled-1", "linkedin", "disabled-2", "instagram"]);
});

test("native Instagram Reels prevent duplicate feed slots, while Stories do not", () => {
  const a = strategistCoverage({ profile: setting, account: facebook, now });
  const spot = a.gaps.find((slot) => slot.platform === "instagram" && slot.localDate === "2026-10-23");
  assert.ok(spot);
  const reel = { id: "native-reel", accountId: facebook.id, platform: "instagram_reel", status: "cloud_scheduled", scheduledFor: spot.scheduledFor };
  const filled = strategistCoverage({ profile: setting, account: facebook, items: [reel], now });
  assert.equal(filled.covered.filter((x) => x.platform === "instagram").length, 1);
  assert.equal(filled.gaps.length, a.gaps.length - 1);
  const story = { ...reel, platform: "instagram_story", id: "story" };
  const stillOpen = strategistCoverage({ profile: setting, account: facebook, items: [story], now });
  assert.ok(stillOpen.gaps.find((x) => x.platform === "instagram" && x.localDate === "2026-10-23"));
});

test("rolling horizon is precisely seven days and advances with the local date", () => {
  const first = strategistCoverage({ profile: setting, account: facebook, now });
  assert.equal(first.gaps.length, 14);
  assert.equal(first.gaps[0].localDate, "2026-10-22");
  assert.equal(first.gaps.at(-1).localDate, "2026-10-28");
  const next = strategistCoverage({ profile: setting, account: facebook, now: new Date("2026-10-23T02:00:00.000Z") });
  assert.equal(next.gaps[0].localDate, "2026-10-23");
  assert.equal(next.gaps.at(-1).localDate, "2026-10-29");
});
