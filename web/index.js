import http from "node:http";

const redirects = {
  meta: "https://127.0.0.1:38937/oauth/meta/callback",
  instagram: "https://meta-manager-auth.vercel.app/oauth/instagram/callback",
  linkedin: "http://127.0.0.1:38937/oauth/linkedin/callback"
};

function json(res,status,body){res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(body));}
function html(res,status,body){res.writeHead(status,{"content-type":"text/html; charset=utf-8","cache-control":"public, max-age=300"});res.end(body);}
async function readJson(req){const chunks=[];for await(const c of req)chunks.push(c);return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");}
async function form(url,params){const r=await fetch(url,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params)});const t=await r.text();let d;try{d=JSON.parse(t)}catch{d={raw:t}}if(!r.ok)throw new Error(d.error_description||d.error?.message||d.error||t||("HTTP "+r.status));return d;}

const css = `
:root{--bg:#f6f8fc;--ink:#10213f;--muted:#67758f;--line:#e4e9f2;--brand:#4867f5;--brand2:#7b61ff;--card:#fff}
*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(180deg,#f7f9ff 0,#f6f8fc 38%,#fff 100%);color:var(--ink)}
a{color:inherit}.wrap{max-width:1180px;margin:auto;padding:0 28px}.nav{display:flex;align-items:center;justify-content:space-between;padding:24px 0}.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:18px}.mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,#38bdf8,#5b6df8 55%,#8b5cf6);display:grid;place-items:center;color:#fff;box-shadow:0 8px 22px #5b6df833}.navlinks{display:flex;gap:22px;color:#5f6d86;font-size:14px}.navlinks a{text-decoration:none}
.hero{padding:70px 0 42px;display:grid;grid-template-columns:1.05fr .95fr;gap:54px;align-items:center}.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid #dce4ff;background:#fff;border-radius:999px;color:#4d64c9;font-size:12px;font-weight:700}.hero h1{font-size:58px;line-height:1.02;letter-spacing:-.045em;margin:18px 0}.hero p{font-size:19px;line-height:1.7;color:var(--muted);max-width:680px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.btn{padding:13px 18px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;border:1px solid var(--line);background:#fff}.btn.primary{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;border:0}.shot{background:#fff;border:1px solid #dfe5f0;border-radius:20px;padding:10px;box-shadow:0 25px 70px #20305a1f;transform:rotate(1deg)}.shot img{width:100%;display:block;border-radius:12px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0 74px}.stat{padding:20px;border:1px solid var(--line);border-radius:16px;background:#fff}.stat b{display:block;font-size:18px}.stat span{color:var(--muted);font-size:13px}
section{padding:58px 0}.section-head{max-width:720px;margin-bottom:30px}.section-head h2{font-size:38px;letter-spacing:-.03em;margin:0 0 12px}.section-head p{color:var(--muted);line-height:1.7}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px}.card h3{margin:8px 0 8px}.card p{margin:0;color:var(--muted);line-height:1.65;font-size:14px}.icon{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:#eef2ff;color:#5267e9;font-weight:900}
.gallery{display:grid;grid-template-columns:1fr 1fr;gap:22px}.gallery figure{margin:0;background:#fff;border:1px solid var(--line);border-radius:18px;padding:10px;box-shadow:0 18px 50px #1c2b5412}.gallery figure:first-child{grid-column:1/-1}.gallery img{width:100%;display:block;border-radius:11px}.gallery figcaption{padding:10px 6px 5px;color:var(--muted);font-size:13px}
.security{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}.panel{background:#0f1830;color:#fff;border-radius:22px;padding:28px}.panel h3{margin-top:0}.flow{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;line-height:1.7;color:#cdd8ff;font-size:13px}.checklist{display:grid;gap:12px}.check{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}.check:last-child{border:0}.dot{width:22px;height:22px;border-radius:50%;background:#e9f8f0;color:#15995b;display:grid;place-items:center;font-size:12px;flex:0 0 auto}
.notice{margin-top:24px;padding:18px;border-radius:14px;background:#fff8e8;border:1px solid #f0dfaa;color:#765e1a;font-size:14px;line-height:1.6}
footer{border-top:1px solid var(--line);margin-top:58px;padding:28px 0 42px;color:var(--muted);font-size:13px}.foot{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}.foot a{color:#4f5f7d;text-decoration:none}
.legal{max-width:850px;margin:48px auto;padding:36px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 12px 40px #17213b12}.legal h1,.legal h2{line-height:1.2}.legal h2{margin-top:28px}.legal p,.legal li{line-height:1.7;color:#53617a}
@media(max-width:860px){.hero{grid-template-columns:1fr;padding-top:40px}.hero h1{font-size:44px}.stats,.grid{grid-template-columns:1fr 1fr}.security{grid-template-columns:1fr}.gallery{grid-template-columns:1fr}.gallery figure:first-child{grid-column:auto}.navlinks{display:none}}@media(max-width:560px){.wrap{padding:0 18px}.hero h1{font-size:38px}.stats,.grid{grid-template-columns:1fr}}
`;

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="Meta Manager — local-first desktop social publishing, scheduling and account management for Facebook, Instagram and LinkedIn."><style>${css}</style></head><body>${body}</body></html>`;

const landing = page("Meta Manager — Desktop Social Manager", `
<div class="wrap">
  <nav class="nav"><div class="brand"><div class="mark">M</div><span>Meta Manager</span></div><div class="navlinks"><a href="#features">Features</a><a href="#screenshots">Screenshots</a><a href="#security">Security</a><a href="/privacy">Privacy</a></div></nav>
  <main>
    <section class="hero">
      <div>
        <span class="eyebrow">Windows + Linux · v0.1.11</span>
        <h1>Social publishing without the tab chaos.</h1>
        <p>Connect Facebook Pages, Instagram Professional accounts and LinkedIn profiles, then manage publishing, scheduling, media and account workflows from one local-first desktop app.</p>
        <div class="actions"><a class="btn primary" href="mailto:hello@advertpreneur.com?subject=Meta%20Manager">Request access</a><a class="btn" href="#screenshots">See the app</a></div>
      </div>
      <div class="shot"><img src="/assets/overview.jpg" alt="Meta Manager overview"></div>
    </section>

    <div class="stats">
      <div class="stat"><b>3 networks</b><span>Facebook, Instagram, LinkedIn</span></div>
      <div class="stat"><b>2 desktop OSes</b><span>Linux and Windows</span></div>
      <div class="stat"><b>Local-first</b><span>SQLite + OS credential storage</span></div>
      <div class="stat"><b>No key setup</b><span>OAuth secrets stay on the backend</span></div>
    </div>

    <section id="features">
      <div class="section-head"><h2>One workspace for the publishing loop.</h2><p>Meta Manager is built for practical day-to-day social operations: connect accounts, prepare content, schedule it, publish it and keep the resulting history in one place.</p></div>
      <div class="grid">
        <article class="card"><div class="icon">↗</div><h3>Multi-account connections</h3><p>Add Facebook Pages, standalone Instagram Professional accounts and LinkedIn personal profiles without re-entering developer credentials on each computer.</p></article>
        <article class="card"><div class="icon">◫</div><h3>Content + calendar</h3><p>Create publishing items, schedule them and track local status across connected destinations from a single calendar-driven workflow.</p></article>
        <article class="card"><div class="icon">⌁</div><h3>Local automation</h3><p>A bundled MCP service exposes controlled local workflows for automation without turning the desktop app into a cloud-only dependency.</p></article>
        <article class="card"><div class="icon">◎</div><h3>Instagram Professional</h3><p>Direct Instagram Login for Business and Creator accounts, plus discovery of professional accounts linked to managed Facebook Pages.</p></article>
        <article class="card"><div class="icon">in</div><h3>LinkedIn personal posting</h3><p>OAuth-based personal profile connections with publishing support. Company Page support remains gated by LinkedIn Community Management approval.</p></article>
        <article class="card"><div class="icon">#</div><h3>Research workspace</h3><p>Designed for hashtag and public-content research. Instagram Public Content Access is currently under Meta App Review for production-wide access.</p></article>
      </div>
    </section>

    <section id="screenshots">
      <div class="section-head"><h2>Designed to stay out of the way.</h2><p>Lightweight navigation, account switching and a focused publishing workspace rather than another browser-sized dashboard.</p></div>
      <div class="gallery">
        <figure><img src="/assets/overview.jpg" alt="Meta Manager dashboard"><figcaption>Overview — account context and day-to-day social operations.</figcaption></figure>
        <figure><img src="/assets/content.jpg" alt="Meta Manager content workspace"><figcaption>Content — prepare and manage publishing items.</figcaption></figure>
        <figure><img src="/assets/calendar.jpg" alt="Meta Manager calendar"><figcaption>Calendar — schedule and track publishing work.</figcaption></figure>
      </div>
    </section>

    <section id="security">
      <div class="section-head"><h2>Install, connect, login. No developer keys.</h2><p>The desktop installer contains public client identifiers only. Provider App Secrets live in the secure OAuth broker environment and are never copied into each installation.</p></div>
      <div class="security">
        <div class="panel"><h3>OAuth flow</h3><div class="flow">Desktop app
  └─ opens provider authorization
      └─ receives localhost callback
          └─ sends authorization code
              └─ secure OAuth broker
                  └─ provider token exchange

Account token returns to the desktop app.</div></div>
        <div class="checklist">
          <div class="check"><div class="dot">✓</div><div><b>Provider secrets stay server-side</b><br><span style="color:var(--muted)">No App Secret setup on Windows or Linux installations.</span></div></div>
          <div class="check"><div class="dot">✓</div><div><b>Local application data</b><br><span style="color:var(--muted)">SQLite and account state stay in the operating system's application-data location.</span></div></div>
          <div class="check"><div class="dot">✓</div><div><b>Cross-platform packaging</b><br><span style="color:var(--muted)">NSIS installer for Windows and a native .deb package for Linux.</span></div></div>
          <div class="check"><div class="dot">✓</div><div><b>Dedicated privacy controls</b><br><span style="color:var(--muted)">Published privacy and data-deletion instructions for connected social accounts.</span></div></div>
        </div>
      </div>
      <div class="notice"><b>Current review status:</b> Instagram Public Content Access, pages_show_list, pages_read_engagement and instagram_basic have been submitted to Meta App Review. Core account connection and publishing flows are separate from the public-content review.</div>
    </section>
  </main>
  <footer><div class="foot"><span>Built by Advertpreneur · Commerce. Growth. Technology.</span><span><a href="/privacy">Privacy Policy</a> · <a href="/data-deletion">Data Deletion</a> · <a href="mailto:hello@advertpreneur.com">Contact</a></span></div></footer>
</div>`);

const privacy = page("Meta Manager Privacy Policy", `<div class="legal"><h1>Meta Manager Privacy Policy</h1><p>Meta Manager is a social publishing application operated by Advertpreneur. It lets users connect accounts they control on Facebook, Instagram, and LinkedIn and publish or schedule content to those accounts.</p><h2>Information we process</h2><p>When you connect a social account, the relevant platform may provide identifiers, account or Page names, profile information, permissions, access tokens, and publishing-related information needed to provide the features you request.</p><h2>How information is used</h2><p>We use this information only to authenticate connected accounts, display connected destinations, publish or schedule content at the user's direction, refresh permitted account information, and maintain the connection.</p><h2>Storage and security</h2><p>Provider app secrets are stored only in secured backend environment variables. By default, user access tokens and scheduling data remain on the local device. When the user explicitly enables optional Cloud Publishing for a social account, an encrypted copy of that account publishing token and its scheduled posts are stored in our existing Supabase project, and uploaded media files are publicly accessible over HTTPS. The user may revoke each cloud connection from the desktop app; publishing metadata may be retained for history and fraud prevention. We do not sell social account data or use it for advertising profiles.</p><h2>Sharing</h2><p>Information is transmitted to Meta, Instagram, LinkedIn, and hosting providers only as necessary to perform authentication, token exchange, publishing, and operation of the service. We do not sell personal information.</p><h2>Retention</h2><p>Connection data is retained while an account remains connected or as needed to provide the requested functionality. Users may disconnect an account or request deletion of app-related data.</p><h2>Data deletion</h2><p>To request deletion of Meta Manager data, follow the instructions on our <a href="/data-deletion">Data Deletion page</a>. You may also revoke Meta Manager directly from the connected social platform's Apps and Websites settings.</p><h2>Contact</h2><p>For privacy questions or deletion requests, contact <a href="mailto:hello@advertpreneur.com">hello@advertpreneur.com</a>.</p><p><small>Last updated: October 10, 2026</small></p></div>`);

const deletion = page("Meta Manager Data Deletion", `<div class="legal"><h1>Meta Manager Data Deletion Instructions</h1><p>You can remove Meta Manager's access at any time from the connected platform's Apps and Websites or authorized applications settings.</p><h2>Request deletion</h2><p>Email <a href="mailto:hello@advertpreneur.com?subject=Meta%20Manager%20Data%20Deletion%20Request">hello@advertpreneur.com</a> with the subject <strong>Meta Manager Data Deletion Request</strong>. Include the platform (Facebook, Instagram, or LinkedIn) and the account or Page name you connected. Do not send passwords or access tokens.</p><p>We will remove app-controlled stored connection data associated with the request after verifying enough information to identify the connection. Revoking the app at the platform also invalidates future access from Meta Manager.</p><p><a href="/privacy">View Privacy Policy</a></p><p><small>Last updated: October 6, 2026</small></p></div>`);

const server=http.createServer(async(req,res)=>{try{
  const path=new URL(req.url,"http://localhost").pathname;
  if(req.method==="GET"&&path==="/") return html(res,200,landing);
  if(req.method==="GET"&&path==="/privacy") return html(res,200,privacy);
  if(req.method==="GET"&&path==="/data-deletion") return html(res,200,deletion);
  if(req.method==="GET"&&path==="/api/config") return json(res,200,{metaAppId:"1079289208340048",instagramAppId:"2228119617760136",linkedinClientId:"77drthb7h6mp7m"});
  if(req.method==="GET"&&path==="/oauth/instagram/callback"){
    // The public HTTPS Instagram redirect hands off to the desktop's loopback
    // HTTP listener, eliminating self-signed TLS certificates on Windows.
    // Never redirect to a caller-selected host or persist authorization codes.
    const url=new URL(req.url,"https://meta-manager-auth.vercel.app");
    const code=url.searchParams.get("code");
    const state=url.searchParams.get("state");
    const error=url.searchParams.get("error");
    const errorDescription=url.searchParams.get("error_description");
    if(!code&&!error&&!errorDescription)return html(res,200,"<!doctype html><title>Instagram callback ready</title><h2>Meta Manager Instagram callback is ready</h2><p>Start login from the Meta Manager desktop app.</p>");
    if(!state||! /^[0-9a-f-]{36}$/i.test(state)||code?.length>4096||error?.length>300||errorDescription?.length>300){
      return html(res,400,"<!doctype html><title>Invalid Instagram return</title><p>The Instagram authorization link is invalid. Restart login from the desktop app.</p>");
    }
    const local=new URL("http://127.0.0.1:38937/oauth/instagram/callback");
    local.searchParams.set("state",state);
    if(code)local.searchParams.set("code",code);
    else{
      if(error)local.searchParams.set("error",error);
      if(errorDescription)local.searchParams.set("error_description",errorDescription);
    }
    res.writeHead(302,{"location":local.toString(),"cache-control":"no-store","pragma":"no-cache","referrer-policy":"no-referrer","x-content-type-options":"nosniff"});
    return res.end();
  }

  if(req.method!=="POST"||path!=="/api/exchange") return json(res,404,{error:"Not found"});
  const {provider,code,redirectUri}=await readJson(req);
  if(!provider||!code||!redirectUri)return json(res,400,{error:"missing fields"});
  if(redirects[provider]!==redirectUri && !(provider==="instagram" && redirectUri==="https://127.0.0.1:38937/oauth/instagram/callback"))return json(res,400,{error:"redirect not allowed"});

  if(provider==="linkedin"){
    if(!process.env.LINKEDIN_CLIENT_SECRET)return json(res,503,{error:"LinkedIn backend credential not configured"});
    const data=await form("https://www.linkedin.com/oauth/v2/accessToken",{grant_type:"authorization_code",code,redirect_uri:redirectUri,client_id:"77drthb7h6mp7m",client_secret:process.env.LINKEDIN_CLIENT_SECRET});
    return json(res,200,data);
  }

  if(provider==="instagram"){
    if(!process.env.INSTAGRAM_APP_SECRET)return json(res,503,{error:"Instagram backend credential not configured"});
    const short=await form("https://api.instagram.com/oauth/access_token",{client_id:"2228119617760136",client_secret:process.env.INSTAGRAM_APP_SECRET,grant_type:"authorization_code",redirect_uri:redirectUri,code});
    const r=await fetch("https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret="+encodeURIComponent(process.env.INSTAGRAM_APP_SECRET)+"&access_token="+encodeURIComponent(short.access_token));
    const t=await r.text();let d;try{d=JSON.parse(t)}catch{d={raw:t}}if(!r.ok)throw new Error(d.error?.message||t);
    return json(res,200,d);
  }

  if(provider==="meta"){
    if(!process.env.META_APP_SECRET)return json(res,503,{error:"Meta backend credential not configured"});
    const r1=await fetch("https://graph.facebook.com/v23.0/oauth/access_token?client_id=1079289208340048&redirect_uri="+encodeURIComponent(redirectUri)+"&client_secret="+encodeURIComponent(process.env.META_APP_SECRET)+"&code="+encodeURIComponent(code));
    const t1=await r1.text();let s;try{s=JSON.parse(t1)}catch{s={raw:t1}}if(!r1.ok)throw new Error(s.error?.message||t1);
    const r2=await fetch("https://graph.facebook.com/v23.0/oauth/access_token?grant_type=fb_exchange_token&client_id=1079289208340048&client_secret="+encodeURIComponent(process.env.META_APP_SECRET)+"&fb_exchange_token="+encodeURIComponent(s.access_token));
    const t2=await r2.text();let d;try{d=JSON.parse(t2)}catch{d={raw:t2}}if(!r2.ok)throw new Error(d.error?.message||t2);
    return json(res,200,d);
  }

  return json(res,400,{error:"unsupported provider"});
}catch(e){return json(res,502,{error:String(e?.message||e)});}});

server.listen(process.env.PORT||3000);