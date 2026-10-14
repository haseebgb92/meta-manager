import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

const port = 39091;
const host = "http://127.0.0.1:"+port;
const server = spawn(process.execPath, ["web/index.js"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
try {
  for(let i=0;i<70;i++){
    try { const r=await fetch(host+"/oauth/instagram/callback"); if(r.ok)break; } catch {}
    await sleep(80);
  }
  const help=await fetch(host+"/oauth/instagram/callback");
  assert.equal(help.status,200);
  assert.match(await help.text(),/callback is ready/i);
  const state="123e4567-e89b-42d3-a456-426614174000";
  const r=await fetch(host+"/oauth/instagram/callback?state="+state+"&code=TEST-CODE", { redirect: "manual" });
  assert.equal(r.status,302);
  const loc=new URL(r.headers.get("location"));
  assert.equal(loc.href, "http://127.0.0.1:38937/oauth/instagram/callback?state="+state+"&code=TEST-CODE");
  assert.equal(r.headers.get("referrer-policy"),"no-referrer");
  const evil=await fetch(host+"/oauth/instagram/callback?state=evil&code=test", { redirect: "manual" });
  assert.equal(evil.status,400);
  const redirect=await fetch(host+"/oauth/instagram/callback?state="+state+"&error=access_denied", { redirect: "manual" });
  assert.equal(redirect.status,302);
  assert.equal(new URL(redirect.headers.get("location")).searchParams.get("error"),"access_denied");
  console.log("Public Instagram HTTPS callback handoff tests passed");
} finally {
  server.kill();
}
