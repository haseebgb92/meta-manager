import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { publish } from "./publish.ts";

const url=Deno.env.get("SUPABASE_URL")||"";
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
if(!url||!serviceKey)throw new Error("Supabase credentials missing");
const admin=createClient(url,serviceKey,{auth:{persistSession:false}});
const response=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),
 {status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const fail=(error:string,status=400)=>response({error},status);
const validId=(v:any)=>typeof v==="string"&&/^[a-z0-9_.:-]{1,180}$/i.test(v);
const isHttps=(v:any)=>{
 if(typeof v!=="string"||v.length>2048)return false;
 try{const x=new URL(v);return x.protocol==="https:"&&!x.username&&!x.password&&!!x.host}
 catch{return false}
};
const providerNames=["facebook","instagram","linkedin"];
async function getUser(req:Request){
 const header=req.headers.get("authorization")||"";
 const token=header.startsWith("Bearer ")?header.slice(7):"";
 if(token.length<30||token.length>4096)return null;
 const {data,error}=await admin.auth.getUser(token);
 return error?null:data.user;
}
async function worker(req:Request){
 const key=req.headers.get("x-mm-worker-token")||"";
 if(!/^[a-f0-9]{64}$/.test(key))return fail("Unauthorized",401);
 const {data:authorized,error:authError}=await admin.rpc("mm_authorize_worker",{p_key:key});
 if(authError||authorized!==true)return fail("Unauthorized",401);
 await admin.rpc("mm_expire_leases");
 const {data:posts,error}=await admin.rpc("mm_claim_posts",{p_limit:3});
 if(error)return fail("Cloud job queue unavailable",503);
 const results=[];
 for(const post of posts||[]){
  try{
   const {data:token,error:tokenError}=await admin.rpc("mm_get_credential",{
     p_owner:post.owner_id,p_account:post.account_id,p_provider:post.provider
   });
   if(tokenError||!token)throw new Error("Account cloud connection missing or revoked");
   const remote=await publish(post,token);
   const {error:saveError}=await admin.from("mm_cloud_posts").update({
    status:"published",published_remote_id:remote,published_at:new Date().toISOString(),
    lease_until:null,last_error:null,updated_at:new Date().toISOString()
   }).eq("id",post.id).eq("status","publishing");
   if(saveError)throw new Error("Post published but recording the result failed; manual verification required");
   results.push({id:post.id,status:"published"});
  }catch(e){
   // Publishing outcome may be ambiguous. Never retry automatically and double-post.
   await admin.from("mm_cloud_posts").update({
    status:"needs_review",last_error:(e instanceof Error?e.message:"Publication outcome unknown").slice(0,220),
    lease_until:null,updated_at:new Date().toISOString()
   }).eq("id",post.id).eq("status","publishing");
   results.push({id:post.id,status:"needs_review"});
  }
 }
 return response({processed:results.length,results});
}
Deno.serve(async(req:Request)=>{
 try{
  if(req.method==="GET")return response({service:"meta-manager-cloud",plan:"free",status:"ready",enabled:"opt-in"});
  if(req.method!=="POST")return fail("Method not allowed",405);
  if(Number(req.headers.get("content-length")||"0")>20000)return fail("Request too large",413);
  const body=await req.json();
  if(!body||typeof body!=="object")return fail("Invalid payload");
  if(body.action==="tick")return worker(req);
  const user=await getUser(req);
  if(!user)return fail("Sign in to Meta Manager Cloud",401);
  const owner=user.id;
  if(body.action==="status")return response({authenticated:true,userId:owner});
  if(body.action==="connection"){
   if(!validId(body.accountId)||!providerNames.includes(body.provider)||
    typeof body.token!=="string"||body.token.length<10||body.token.length>4096)return fail("Invalid cloud connection");
   const {error}=await admin.rpc("mm_store_credential",{
    p_owner:owner,p_account:body.accountId,p_provider:body.provider,p_token:body.token
   });
   return error?fail("Unable to save encrypted credential",500):response({connected:true});
  }
  if(body.action==="connection_status"){
   if(!validId(body.accountId)||!providerNames.includes(body.provider))return fail("Invalid cloud account");
   const {data,error}=await admin.rpc("mm_has_credential",{
    p_owner:owner,p_account:body.accountId,p_provider:body.provider
   });
   return error?fail("Connection status unavailable",500):response({connected:data===true});
  }
  if(body.action==="disconnect"){
   if(!validId(body.accountId)||!providerNames.includes(body.provider))return fail("Invalid provider");
   const {error}=await admin.rpc("mm_delete_credential",{
    p_owner:owner,p_account:body.accountId,p_provider:body.provider
   });
   return error?fail("Unable to revoke connection",500):response({revoked:true});
  }
  if(body.action==="list"){
   const {data,error}=await admin.from("mm_cloud_posts")
    .select("id,source_id,account_id,provider,title,status,scheduled_for,attempts,last_error,published_remote_id,published_at")
    .eq("owner_id",owner).order("created_at",{ascending:false}).limit(150);
   return error?fail("Cloud calendar unavailable",500):response({posts:data});
  }
  if(body.action==="cancel_source"){
   if(!validId(body.sourceId))return fail("Invalid source post");
   const {data,error}=await admin.from("mm_cloud_posts")
    .update({status:"cancelled",updated_at:new Date().toISOString()})
    .eq("source_id",body.sourceId).eq("owner_id",owner).eq("status","scheduled").select("id");
   return error?fail("Unable to cancel partial cloud schedule",500):response({cancelled:(data||[]).length});
  }
  if(body.action==="cancel"){
   if(typeof body.id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.id))return fail("Invalid ID");
   const {data,error}=await admin.from("mm_cloud_posts")
    .update({status:"cancelled",updated_at:new Date().toISOString()})
    .eq("id",body.id).eq("owner_id",owner).eq("status","scheduled").select("id");
   return error?fail("Cancellation failed",500):response({cancelled:(data||[]).length===1});
  }
  if(body.action==="schedule"){
   if(!validId(body.accountId)||!validId(body.sourceId)||!validId(body.remoteAccountId)
    ||!providerNames.includes(body.provider)||typeof body.title!=="string"
    ||!body.title.trim()||body.title.length>200||typeof body.caption!=="string"
    ||body.caption.length>4000||(body.mediaUrl!=null&&!isHttps(body.mediaUrl))
    ||(body.linkUrl!=null&&!isHttps(body.linkUrl))
    ||(body.provider==="instagram"&&!body.mediaUrl)
    ||(body.providerMode!=null&&!["standard","instagram_direct"].includes(body.providerMode))){
    return fail("Invalid scheduled post");
   }
   const when=new Date(body.scheduledFor);
   if(!Number.isFinite(when.getTime())||when.getTime()<Date.now()+60000||
    when.getTime()>Date.now()+90*86400000)return fail("Time must be 1 minute to 90 days in the future");
   const {data:existing}=await admin.from("mm_cloud_posts")
    .select("id").eq("owner_id",owner).eq("source_id",body.sourceId)
    .eq("provider",body.provider).maybeSingle();
   if(existing)return fail("This post is already scheduled in the cloud",409);
   const {data:credential,error:credentialError}=await admin.rpc("mm_get_credential",{
    p_owner:owner,p_account:body.accountId,p_provider:body.provider
   });
   if(credentialError||!credential)return fail("Connect this account to Cloud first",403);
   const {count}=await admin.from("mm_cloud_posts")
    .select("*",{count:"exact",head:true}).eq("owner_id",owner).eq("status","scheduled");
   if((count||0)>=200)return fail("Free limit: maximum 200 pending posts",429);
   const hashtags=Array.isArray(body.hashtags)?
    body.hashtags.filter((x:any)=>typeof x==="string").slice(0,25):[];
   const {data,error}=await admin.from("mm_cloud_posts").insert({
    owner_id:owner,source_id:body.sourceId,account_id:body.accountId,
    provider:body.provider,provider_mode:body.providerMode||"standard",
    remote_account_id:body.remoteAccountId,title:body.title.trim(),
    caption:body.caption,hashtags,media_url:body.mediaUrl||null,link_url:body.linkUrl||null,
    scheduled_for:when.toISOString()
   }).select("id,scheduled_for,status").single();
   return error?fail("Unable to add post to cloud queue",500):response({post:data},201);
  }
  return fail("Unknown action",400);
 }catch{
  return fail("Cloud request failed",500);
 }
});
