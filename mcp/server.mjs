import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import * as z from "zod/v4";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const PORT = Number(process.env.META_MANAGER_MCP_PORT || 38939);
const APP_DIR = process.platform === "win32"
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "com.advertpreneur.metamanager")
  : path.join(os.homedir(), ".local", "share", "com.advertpreneur.metamanager");
const DB_PATH = path.join(APP_DIR, "meta-manager.sqlite3");
const SECRET_DIR = path.join(APP_DIR, "secrets");
const GRAPH_VERSION = "v23.0";

function db() { return new DatabaseSync(DB_PATH); }
function readSecret(name) {
  const file = path.join(SECRET_DIR, `${name}.secret`);
  if (!fs.existsSync(file)) throw new Error(`Required local credential ${name} is unavailable`);
  return fs.readFileSync(file, "utf8").trim();
}
function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}
function rows(sql, params = []) {
  const database = db();
  try { return database.prepare(sql).all(...params); } finally { database.close(); }
}
function run(sql, params = []) {
  const database = db();
  try { return database.prepare(sql).run(...params); } finally { database.close(); }
}
function getAccount(accountId) {
  return rows("SELECT id,name,facebook_page_id AS facebookPageId,instagram_account_id AS instagramAccountId,status FROM accounts WHERE id=?", [accountId])[0] ?? null;
}
function listAccounts() {
  return rows("SELECT id,name,facebook_page_id AS facebookPageId,instagram_account_id AS instagramAccountId,status FROM accounts ORDER BY created_at ASC");
}
async function graphGet(objectPath, token, params = {}) {
  const query = new URLSearchParams({ ...params, access_token: token });
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${objectPath}?${query}`);
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.message ?? `Meta request failed: ${response.status}`);
  return body;
}
async function graphPost(objectPath, token, params = {}) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${objectPath}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error(json.error?.message ?? `Meta request failed: ${response.status}`);
  return json;
}

async function graphPaginated(objectPath, token, params = {}) {
  const collected = [];
  let url = `https://graph.facebook.com/${GRAPH_VERSION}/${objectPath}?${new URLSearchParams({ ...params, access_token: token })}`;
  const seen = new Set();
  while (url && !seen.has(url)) {
    seen.add(url);
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error?.message ?? `Meta request failed: ${response.status}`);
    collected.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
  }
  return collected;
}

function upsertWorkspace(page) {
  const existing = rows("SELECT id FROM accounts WHERE facebook_page_id=? LIMIT 1", [page.id])[0];
  const ig = page.instagram_business_account ?? null;
  const accountId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    run("UPDATE accounts SET name=?, instagram_account_id=?, status='connected', updated_at=CURRENT_TIMESTAMP WHERE id=?", [page.name ?? 'Facebook Page', ig?.id ?? null, accountId]);
  } else {
    run("INSERT INTO accounts (id,name,facebook_page_id,instagram_account_id,status,created_at,updated_at) VALUES (?,?,?,?, 'connected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", [accountId, page.name ?? 'Facebook Page', page.id, ig?.id ?? null]);
  }
  if (page.access_token) fs.writeFileSync(path.join(SECRET_DIR, `meta_page_token_${page.id}.secret`), page.access_token, { mode: 0o600 });
  return {
    id: accountId,
    name: page.name ?? 'Facebook Page',
    facebookPageId: page.id,
    instagramAccountId: ig?.id ?? null,
    instagramUsername: ig?.username ?? null,
  };
}

async function refreshAccountsFromMeta() {
  const token = readSecret('meta_user_access_token');
  const fields = 'id,name,access_token,instagram_business_account{id,username,name}';
  const found = new Map();

  for (const page of await graphPaginated('me/accounts', token, { fields, limit: '100' })) {
    if (page?.id) found.set(page.id, page);
  }

  let businessesChecked = 0;
  let businessDiscoveryError = null;
  try {
    const businesses = await graphPaginated('me/businesses', token, { fields: 'id,name', limit: '100' });
    businessesChecked = businesses.length;
    for (const business of businesses) {
      for (const edge of ['owned_pages', 'client_pages']) {
        try {
          const pages = await graphPaginated(`${business.id}/${edge}`, token, { fields, limit: '100' });
          for (const page of pages) if (page?.id) found.set(page.id, page);
        } catch {}
      }
    }
  } catch (error) {
    businessDiscoveryError = String(error);
  }

  const synced = [...found.values()].map(upsertWorkspace);
  return {
    count: synced.length,
    businessesChecked,
    businessDiscoveryAvailable: businessDiscoveryError === null,
    businessDiscoveryError,
    accounts: synced,
  };
}

async function workspaceSnapshot(account) {
  if (!account?.facebookPageId) return { ...account, status: "disconnected" };
  const token = readSecret(`meta_page_token_${account.facebookPageId}`);
  const page = await graphGet(account.facebookPageId, token, {
    fields: "id,name,followers_count,fan_count,picture{url},instagram_business_account{id,username,followers_count,media_count,profile_picture_url}",
  });
  const ig = page.instagram_business_account ?? null;
  return {
    accountId: account.id,
    name: page.name ?? account.name,
    facebookPageId: account.facebookPageId,
    facebookFollowers: Math.max(page.followers_count ?? 0, page.fan_count ?? 0),
    facebookPictureUrl: page.picture?.data?.url ?? null,
    instagramAccountId: ig?.id ?? account.instagramAccountId ?? null,
    instagramUsername: ig?.username ?? null,
    instagramFollowers: ig?.followers_count ?? 0,
    instagramMediaCount: ig?.media_count ?? 0,
    instagramPictureUrl: ig?.profile_picture_url ?? null,
    status: "connected",
  };
}
async function recentPostsForAccount(account, limit = 8) {
  if (!account?.facebookPageId) return [];
  const token = readSecret(`meta_page_token_${account.facebookPageId}`);
  const posts = [];
  try {
    const fb = await graphGet(`${account.facebookPageId}/posts`, token, {
      fields: "id,message,created_time,permalink_url,full_picture,comments.limit(0).summary(true),likes.limit(0).summary(true)",
      limit: String(limit),
    });
    for (const post of fb.data ?? []) posts.push({
      id: post.id, platform: "facebook", caption: post.message ?? "Facebook post", createdAt: post.created_time ?? "",
      mediaUrl: post.full_picture ?? null, permalinkUrl: post.permalink_url ?? null,
      likes: post.likes?.summary?.total_count ?? 0, comments: post.comments?.summary?.total_count ?? 0,
    });
  } catch {}
  if (account.instagramAccountId) {
    try {
      const ig = await graphGet(`${account.instagramAccountId}/media`, token, {
        fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
        limit: String(limit),
      });
      for (const post of ig.data ?? []) posts.push({
        id: post.id, platform: "instagram", caption: post.caption ?? "Instagram post", createdAt: post.timestamp ?? "",
        mediaUrl: post.thumbnail_url ?? post.media_url ?? null, permalinkUrl: post.permalink ?? null,
        likes: post.like_count ?? 0, comments: post.comments_count ?? 0,
      });
    } catch {}
  }
  return posts.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}
function buildCaption(item) {
  let caption = (item.caption ?? "").trim();
  const tags = JSON.parse(item.hashtags || "[]").filter(Boolean).map((tag)=>`#${String(tag).replace(/^#/,"")}`).join(" ");
  if (tags) caption += `${caption ? "\n\n" : ""}${tags}`;
  return caption;
}

const httpsUrl = value => { try { return new URL(value).protocol === "https:"; } catch { return false; } };
async function postForm(url, token, data) {
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({...data,access_token:token}),signal:AbortSignal.timeout(30000)});
  const j=await r.json();
  if(!r.ok||j.error) throw new Error(j.error?.message||("Social API failed: "+r.status));
  return j;
}
async function publishLinkedin(item, account) {
  const a=rows("SELECT member_id FROM linkedin_accounts WHERE id=? AND status='connected'",[account.id])[0];
  if(!a) throw new Error("Connected LinkedIn member not found");
  const token=readSecret("linkedin_member_token_"+a.member_id);
  const owner="urn:li:person:"+a.member_id;
  const link=(item.link_url||"").trim(), media=(item.media_url||"").trim();
  let commentary=buildCaption(item);
  if(media&&link&&!commentary.includes(link)) commentary += "\n\n"+link;
  if(!commentary&&!link&&!media) throw new Error("LinkedIn post needs text, link or image");
  const body={author:owner,commentary,visibility:"PUBLIC",distribution:{feedDistribution:"MAIN_FEED",targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:"PUBLISHED",isReshareDisabledByAuthor:false};
  const headers={"Authorization":"Bearer "+token,"LinkedIn-Version":"202606","X-Restli-Protocol-Version":"2.0.0"};
  if(media) {
    if(!httpsUrl(media)) throw new Error("LinkedIn image must be a public HTTPS URL");
    const response=await fetch(media,{signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw new Error("Could not download image: "+response.status);
    const mime=(response.headers.get("content-type")||"image/jpeg").split(";")[0];
    if(!["image/jpeg","image/png","image/gif"].includes(mime)) throw new Error("Unsupported image MIME: "+mime);
    const bytes=await response.arrayBuffer();
    if(!bytes.byteLength||bytes.byteLength>12000000) throw new Error("LinkedIn image must be less than 12 MB");
    const init=await fetch("https://api.linkedin.com/rest/images?action=initializeUpload",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({initializeUploadRequest:{owner}}),signal:AbortSignal.timeout(30000)});
    const data=await init.json();
    if(!init.ok||!data.value?.image||!data.value?.uploadUrl) throw new Error("LinkedIn image initialization failed: "+init.status);
    const uploaded=await fetch(data.value.uploadUrl,{method:"PUT",headers:{"Authorization":"Bearer "+token,"content-type":mime},body:bytes,signal:AbortSignal.timeout(60000)});
    if(!uploaded.ok) throw new Error("LinkedIn image upload failed: "+uploaded.status);
    body.content={media:{id:data.value.image,altText:item.title}};
  } else if(link) {
    if(!/^https?:\/\//i.test(link)) throw new Error("LinkedIn article URL must start with HTTP(S)");
    body.content={article:{source:link,title:item.title,description:commentary.slice(0,240)}};
  }
  const r=await fetch("https://api.linkedin.com/rest/posts",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  if(!r.ok) throw new Error("LinkedIn publish failed: "+r.status+" "+String(await r.text()).slice(0,250));
  const id=r.headers.get("x-restli-id");
  if(!id) throw new Error("LinkedIn may have published without returning a post ID; verify profile before retry");
  return id;
}
async function publishInstagram(item, account) {
  if(!account.instagramAccountId) throw new Error("No Instagram account");
  if(!httpsUrl(item.media_url)) throw new Error("Instagram requires a public HTTPS image URL");
  const id=account.instagramAccountId;
  const direct=fs.existsSync(path.join(SECRET_DIR,"instagram_direct_token_"+id+".secret"));
  if(!direct&&!account.facebookPageId) throw new Error("Instagram needs a direct token or connected Facebook Page");
  const token=direct?readSecret("instagram_direct_token_"+id):readSecret("meta_page_token_"+account.facebookPageId);
  const base=direct?"https://graph.instagram.com":"https://graph.facebook.com/"+GRAPH_VERSION;
  const created=await postForm(base+"/"+id+"/media",token,{image_url:item.media_url,caption:buildCaption(item)});
  if(!created.id) throw new Error("Instagram did not return a creation ID");
  let ready=false;
  for(let i=0;i<20;i++) {
    const status=await fetch(base+"/"+created.id+"?"+new URLSearchParams({fields:"status_code,status",access_token:token}),{signal:AbortSignal.timeout(15000)});
    const value=await status.json();
    if(!status.ok||value.error) throw new Error(value.error?.message||"Instagram image processing failed");
    if(value.status_code==="FINISHED") {ready=true;break;}
    if(["ERROR","EXPIRED"].includes(value.status_code)) throw new Error("Instagram image processing error: "+(value.status||value.status_code));
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(!ready) throw new Error("Instagram image not ready after 40 seconds");
  const published=await postForm(base+"/"+id+"/media_publish",token,{creation_id:created.id});
  if(!published.id) throw new Error("Instagram did not return a published ID");
  return published.id;
}
async function publishItem(itemId) {
  const item=rows("SELECT * FROM calendar_items WHERE id=?",[itemId])[0];
  if(!item) throw new Error("Calendar item not found");
  if(!["draft","scheduled","failed"].includes(item.status)) throw new Error("Item not publishable: "+item.status);
  const account=getAccount(item.account_id);
  if(!account) throw new Error("Workspace not found");
  const li=item.platform==="linkedin", fb=["facebook","both"].includes(item.platform), ig=["instagram","both"].includes(item.platform);
  if(!li&&!fb&&!ig) throw new Error("Invalid publishing platform");
  if(li&&account.status!=="linkedin_connected") throw new Error("Please select a LinkedIn workspace");
  if(fb&&!account.facebookPageId) throw new Error("Facebook Page not connected");
  if(ig&&!account.instagramAccountId) throw new Error("Instagram account not connected");
  if(ig&&!httpsUrl(item.media_url)) throw new Error("Instagram requires a public HTTPS image URL");
  const done=String(item.published_post_id||"").split(";");
  let lid=done.find(x=>x.startsWith("linkedin:"))?.slice(9)||null;
  let fid=done.find(x=>x.startsWith("facebook:"))?.slice(9)||null;
  let iid=done.find(x=>x.startsWith("instagram:"))?.slice(10)||null;
  const checkpoint=()=>run("UPDATE calendar_items SET published_post_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [[lid?"linkedin:"+lid:null,fid?"facebook:"+fid:null,iid?"instagram:"+iid:null].filter(Boolean).join(";"),itemId]);
  const claim=run("UPDATE calendar_items SET status='publishing',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('draft','scheduled','failed')",[itemId]);
  if(claim.changes!==1) throw new Error("Post has already been claimed for publishing");
  try {
    if(li&&!lid) {lid=await publishLinkedin(item,account);checkpoint();}
    if(fb&&!fid) {
      const token=readSecret("meta_page_token_"+account.facebookPageId);
      const image=(item.media_url||"").trim();
      const fbpost=image?await graphPost(account.facebookPageId+"/photos",token,{url:image,caption:buildCaption(item)}):
        await graphPost(account.facebookPageId+"/feed",token,{message:buildCaption(item),...(item.link_url?{link:item.link_url}:{})});
      fid=fbpost.post_id||fbpost.id;
      if(!fid) throw new Error("Facebook did not return a post ID");
      checkpoint();
    }
    if(ig&&!iid) {iid=await publishInstagram(item,account);checkpoint();}
    run("UPDATE calendar_items SET status='published',published_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",[itemId]);
    return {itemId,linkedinPostId:lid,facebookPostId:fid,instagramPostId:iid,status:"published"};
  } catch(err) {
    run("UPDATE calendar_items SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[String(err),itemId]);
    throw err;
  }
}

function getServer() {
  const server = new McpServer({ name: "meta-manager", version: "0.1.12" });
  server.registerTool("list_accounts", { description: "List Meta Manager workspaces and linked Facebook/Instagram IDs without exposing tokens.", inputSchema: {} }, async()=>textResult(listAccounts()));
  server.registerTool("get_account_dashboard", { description: "Get live audience data and recent posts for one workspace or all connected workspaces.", inputSchema: { account_id: z.string().optional() } }, async({account_id})=>{
    const accounts = account_id ? [getAccount(account_id)].filter(Boolean) : listAccounts().filter((a)=>a.status==="connected");
    const workspaces=[], recentPosts=[];
    for (const account of accounts) {
      try { workspaces.push(await workspaceSnapshot(account)); recentPosts.push(...await recentPostsForAccount(account,8)); }
      catch(error){ workspaces.push({accountId:account.id,name:account.name,status:"error",error:String(error)}); }
    }
    recentPosts.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    return textResult({workspaces,recentPosts:recentPosts.slice(0,20)});
  });
  server.registerTool("research_content", { description: "Analyze synced recent content for recurring topics and top posts by likes/comments.", inputSchema: { account_id:z.string().optional(), query:z.string().optional() } }, async({account_id,query})=>{
    const accounts=account_id?[getAccount(account_id)].filter(Boolean):listAccounts().filter((a)=>a.status==="connected");
    const posts=[]; for(const account of accounts) posts.push(...await recentPostsForAccount(account,12));
    const filtered=query?posts.filter((p)=>p.caption.toLowerCase().includes(query.toLowerCase())):posts;
    const stop=new Set(["this","that","with","from","have","your","about","there","their","they","what","when","where","will","just","more","some","into","than","then","been","were","them","also","facebook","instagram"]);
    const counts=new Map();
    for(const post of filtered) for(const word of post.caption.toLowerCase().match(/[a-z][a-z0-9]{3,}/g)??[]) if(!stop.has(word)) counts.set(word,(counts.get(word)??0)+1);
    const topics=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([word,count])=>({word,count}));
    const topPosts=[...filtered].sort((a,b)=>(b.likes+b.comments)-(a.likes+a.comments)).slice(0,10);
    return textResult({analyzedPosts:filtered.length,topics,topPosts});
  });
  server.registerTool("list_calendar", { description: "List local calendar items.", inputSchema: { account_id:z.string().optional(), status:z.string().optional() } }, async({account_id,status})=>{
    let sql="SELECT id,account_id AS accountId,title,platform,status,caption,hashtags,media_url AS mediaUrl,link_url AS linkUrl,scheduled_for AS scheduledFor,published_post_id AS publishedPostId,published_at AS publishedAt,last_error AS lastError FROM calendar_items WHERE 1=1"; const params=[];
    if(account_id){sql+=" AND account_id=?";params.push(account_id);} if(status){sql+=" AND status=?";params.push(status);} sql+=" ORDER BY COALESCE(scheduled_for,created_at) ASC";
    return textResult(rows(sql,params).map((item)=>({...item,hashtags:JSON.parse(item.hashtags||"[]")})));
  });
  server.registerTool("create_post", { description: "Create a local Facebook, Instagram or LinkedIn draft or scheduled post with media URL and link URL. Instagram requires publicly hosted HTTPS image. Does not publish immediately.", inputSchema: { account_id:z.string(), title:z.string().min(1), platform:z.enum(["facebook","instagram","both","linkedin"]), caption:z.string().optional(), hashtags:z.array(z.string()).optional(), media_url:z.string().url().optional(), link_url:z.string().url().optional(), scheduled_for:z.string().optional() } }, async({account_id,title,platform,caption,hashtags=[],media_url,link_url,scheduled_for})=>{
    const account=getAccount(account_id);
    if(!account) throw new Error("Workspace not found");
    if(platform==="linkedin" && (account.status!=="linkedin_connected"||!rows("SELECT id FROM linkedin_accounts WHERE id=?",[account_id]).length)) throw new Error("Select a connected LinkedIn workspace");
    if(platform!=="linkedin" && account.status==="linkedin_connected") throw new Error("Select a Meta workspace");
    if(["facebook","both"].includes(platform)&&!account.facebookPageId) throw new Error("Workspace has no Facebook Page");
    if(["instagram","both"].includes(platform)&&!account.instagramAccountId) throw new Error("Workspace has no Instagram account");
    if(media_url&&!httpsUrl(media_url)) throw new Error("Image URL must be public HTTPS");
    if(["instagram","both"].includes(platform)&&!media_url) throw new Error("Instagram requires public HTTPS image URL");
    if(link_url&&!/^https?:\/\//i.test(link_url)) throw new Error("Link URL must start with HTTP(S)");
    const date=scheduled_for?new Date(scheduled_for):null;
    if(date&&(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())) throw new Error("Schedule must be a future date");
    const id=crypto.randomUUID(), status=date?"scheduled":"draft";
    run("INSERT INTO calendar_items (id,account_id,title,platform,status,caption,hashtags,media_url,link_url,scheduled_for,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
      [id,account_id,title,platform,status,caption??null,JSON.stringify(hashtags),media_url??null,link_url??null,date?.toISOString()??null]);
    return textResult({id,accountId:account_id,title,platform,status,mediaUrl:media_url??null,linkUrl:link_url??null,scheduledFor:date?.toISOString()??null});
  });
  server.registerTool("publish_post", { description: "Publish an existing calendar item immediately. External write action; confirm must be true.", inputSchema: { item_id:z.string(), confirm:z.boolean() } }, async({item_id,confirm})=>{ if(!confirm) throw new Error("Publishing requires confirm=true"); return textResult(await publishItem(item_id)); });
  return server;
}

const app=createMcpExpressApp();
app.get("/health",(_req,res)=>res.json({ok:true,service:"meta-manager-mcp",version:"0.1.12"}));
app.post("/refresh",async(_req,res)=>{ try { res.json(await refreshAccountsFromMeta()); } catch(error) { res.status(500).json({ok:false,error:String(error)}); } });

app.post("/mcp",async(req,res)=>{ const server=getServer(); const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined}); try{ await server.connect(transport); await transport.handleRequest(req,res,req.body); } catch(error){ if(!res.headersSent) res.status(500).json({jsonrpc:"2.0",error:{code:-32603,message:String(error)},id:null}); } finally { res.on("close",()=>{transport.close();server.close();}); } });
app.get("/mcp",(_req,res)=>res.status(405).json({error:"Use POST /mcp"}));
app.delete("/mcp",(_req,res)=>res.status(405).json({error:"Stateless MCP server"}));
app.listen(PORT,"127.0.0.1",()=>console.log(`Meta Manager MCP listening on http://127.0.0.1:${PORT}/mcp`));
