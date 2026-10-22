import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as z from "zod/v4";
import { registerStrategistTools } from "../mcp/strategist-tools.mjs";

function harness() {
  const folder = mkdtempSync(path.join(os.tmpdir(), "meta-strategist-"));
  const databasePath = path.join(folder, "test.sqlite3");
  const db = () => new DatabaseSync(databasePath);
  const sql = db();
  sql.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,status TEXT,facebook_page_id TEXT,instagram_account_id TEXT)");
  sql.exec("CREATE TABLE calendar_items(id TEXT PRIMARY KEY,account_id TEXT,title TEXT,platform TEXT,status TEXT,caption TEXT,hashtags TEXT,media_url TEXT,link_url TEXT,scheduled_for TEXT,created_at TEXT,updated_at TEXT)");
  sql.prepare("INSERT INTO accounts VALUES(?,?,?,?,?)").run("a","Bakery A","connected","fb-a","ig-a");
  sql.prepare("INSERT INTO accounts VALUES(?,?,?,?,?)").run("b","Law Firm B","connected","fb-b",null);
  sql.close();
  const account = (id) => {
    const c=db();
    try {
      return c.prepare("SELECT id,name,status,facebook_page_id AS facebookPageId,instagram_account_id AS instagramAccountId FROM accounts WHERE id=?").get(id);
    } finally {c.close();}
  };
  const listAccounts=()=>["a","b"].map(account);
  const calls = {};
  registerStrategistTools({ registerTool(name, _schema, cb) { calls[name] = cb; } }, {
    db, getAccount: account, listAccounts, z,
    httpsUrl: (u) => { try { return new URL(u).protocol === "https:"; } catch { return false; } },
    textResult: (v) => v,
  });
  const configure=(id,config)=>{
    // Initializes tables, without any network or vendor APIs.
    const c=db();
    try {
      c.exec("CREATE TABLE IF NOT EXISTS strategist_profiles(account_id TEXT PRIMARY KEY,config_json TEXT)");
      c.prepare("INSERT OR REPLACE INTO strategist_profiles VALUES(?,?)").run(id,JSON.stringify(config));
    } finally { c.close(); }
  };
  const close=()=>rmSync(folder,{recursive:true,force:true});
  return {calls,configure,db,close};
}

const base={ enabled:true, platforms:["facebook"],weekdays:[1,2,3,4,5,6,7],
  timeLocal:"10:00",timezone:"Asia/Karachi",mode:"draft",website:"",
  description:"A fictional brand selling delicious products.",audience:"Local residents",
  tone:"Warm",pillars:"Information",avoid:"Do not invent offers" };

test("disabled and disconnected destinations cannot be queued", async () => {
  const h=harness();
  try {
    const empty=await h.calls.get_strategist_brief({});
    assert.equal(empty.accounts.length,0);
    await assert.rejects(h.calls.strategist_queue_post({
      account_id:"a",platform:"facebook",local_date:"2099-01-01",title:"Post",caption:"New copy",
    }),/disabled/);
    h.configure("b",{...base,platforms:["instagram"]});
    await assert.rejects(h.calls.strategist_queue_post({
      account_id:"b",platform:"instagram",local_date:"2099-01-01",title:"Post",caption:"New copy",media_url:"https://example.com/image.jpg",
    }),/Destination not enabled/);
  } finally {h.close();}
});

test("AI queue uses only selected brand and reserves same slot against repeat writes", async () => {
  const h=harness();
  try {
    h.configure("a",base);
    h.configure("b",{...base,mode:"schedule",platforms:["facebook"]});
    const brief=await h.calls.get_strategist_brief({});
    assert.equal(brief.accounts.length,2);
    const a=brief.accounts.find((b)=>b.accountId==="a");
    const b=brief.accounts.find((b)=>b.accountId==="b");
    const gapA=a.coverage.gaps[0], gapB=b.coverage.gaps[0];
    const input={account_id:"a",platform:"facebook",local_date:gapA.localDate,
      title:"A bakery post",caption:"Only bakery facts"};
    const first=await h.calls.strategist_queue_post(input);
    assert.equal(first.accountId,"a");
    assert.equal(first.status,"draft");
    assert.equal(first.scheduledFor,null);
    await assert.rejects(h.calls.strategist_queue_post(input),/No eligible empty slot/);
    const queuedB=await h.calls.strategist_queue_post({
      ...input, account_id:"b",local_date:gapB.localDate,title:"A law office post",caption:"Only law office facts",
    });
    assert.equal(queuedB.status,"scheduled");
    const c=h.db();
    try {
      const items=c.prepare("SELECT account_id,title,platform,status,scheduled_for FROM calendar_items ORDER BY account_id").all();
      assert.equal(items.length,2);
      assert.equal(items[0].account_id,"a");
      assert.equal(items[0].title,"A bakery post");
      assert.equal(items[1].account_id,"b");
      assert.equal(items[1].title,"A law office post");
      assert.ok(items[1].scheduled_for);
    } finally { c.close(); }
    const after=await h.calls.get_strategist_brief({account_id:"a"});
    assert.equal(after.accounts[0].coverage.pending.length,1);
    assert.equal(after.accounts[0].coverage.gaps.length,a.coverage.gaps.length-1);
  } finally {h.close();}
});

test("existing manual schedule prevents duplicate AI slot", async () => {
  const h=harness();
  try {
    h.configure("a",base);
    const brief=await h.calls.get_strategist_brief({account_id:"a"});
    const gap=brief.accounts[0].coverage.gaps[0];
    const c=h.db();
    try {
      c.prepare("INSERT INTO calendar_items(id,account_id,title,platform,status,scheduled_for) VALUES(?,?,?,?,?,?)")
        .run("manual","a","Already there","facebook","scheduled",gap.scheduledFor);
    } finally { c.close(); }
    await assert.rejects(h.calls.strategist_queue_post({
      account_id:"a",platform:"facebook",local_date:gap.localDate,title:"Duplicate",caption:"No thanks",
    }),/No eligible empty slot/);
  } finally { h.close(); }
});
