type CloudPost = {
 id:string;owner_id:string;account_id:string;provider:string;provider_mode:string;
 remote_account_id:string;content_type?:string;title:string;caption:string;hashtags:string[];media_url:string|null;link_url:string|null;
};
const sleep=(n:number)=>new Promise(ok=>setTimeout(ok,n));
const id=(v:string)=>encodeURIComponent(v);
async function request(url:string,token:string,init:RequestInit={}){
 const response=await fetch(url,{...init,headers:{Authorization:"Bearer "+token,...(init.headers||{})},signal:AbortSignal.timeout(25000)});
 const body=await response.text();
 let data:any={};try{data=JSON.parse(body)}catch{}
 if(!response.ok)throw new Error("Provider HTTP "+response.status+(data.error?.code?" ("+data.error.code+")":""));
 return {data,headers:response.headers};
}
function captionWithLink(p:CloudPost){
 const base=text(p);
 const link=(p.link_url||"").trim();
 return link && p.content_type!=="story" && !base.includes(link) ? (base+"\n\n"+link).trim() : base;
}
function text(p:CloudPost){
 const tags=Array.isArray(p.hashtags)?p.hashtags.filter(x=>typeof x==="string").slice(0,25).map(x=>"#"+x.replace(/^#/,"").replace(/[^A-Za-z0-9_]/g,"")).filter(x=>x!=="#"):[];
 return [p.caption||"",tags.join(" ")].filter(Boolean).join("\n\n").slice(0,4000);
}
async function facebook(p:CloudPost,token:string){
 const base="https://graph.facebook.com/v23.0/"+id(p.remote_account_id);
 const form=new URLSearchParams();
 if(p.media_url){
  form.set("url",p.media_url);
  form.set("caption",captionWithLink(p));
 }else{
  form.set("message",captionWithLink(p));if(p.link_url)form.set("link",p.link_url);
 }
 const result=await request(base+(p.media_url?"/photos":"/feed"),token,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
 const remote=result.data.post_id||result.data.id;
 if(!remote)throw new Error("Provider did not return a Facebook post ID");
 return String(remote);
}
async function instagram(p:CloudPost,token:string){
 if(!p.media_url)throw new Error("Instagram media URL is required");
 const base=p.provider_mode==="instagram_direct"?"https://graph.instagram.com/":"https://graph.facebook.com/v23.0/";
 const acct=id(p.remote_account_id);
 const created=await request(base+acct+"/media",token,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams(p.content_type==="reel" ? {media_type:"REELS",video_url:p.media_url,caption:captionWithLink(p)} :
    p.content_type==="story" ? (/\.(mp4|mov)(?:\?|$)/i.test(p.media_url)?{media_type:"STORIES",video_url:p.media_url}:{media_type:"STORIES",image_url:p.media_url}) :
    {image_url:p.media_url,caption:captionWithLink(p)})});
 const container=created.data.id;
 if(!container)throw new Error("Instagram container could not be created");
 let ready=false;
 for(let i=0;i<40;i++){
  await sleep(2000);
  const result=await request(base+id(container)+"?fields=status_code",token);
  if(result.data.status_code==="FINISHED"){ready=true;break}
  if(["EXPIRED","ERROR"].includes(result.data.status_code))throw new Error("Instagram media processing failed");
 }
 if(!ready)throw new Error("Instagram processing did not complete in time");
 const result=await request(base+acct+"/media_publish",token,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({creation_id:String(container)})});
 if(!result.data.id)throw new Error("Instagram did not return a post ID");
 return String(result.data.id);
}
async function linkedin(p:CloudPost,token:string){
 const author="urn:li:person:"+p.remote_account_id;
 let content:any=undefined;
 const headers={"Content-Type":"application/json","LinkedIn-Version":"202506","X-Restli-Protocol-Version":"2.0.0"};
 if(p.media_url){
  const setup=await request("https://api.linkedin.com/rest/images?action=initializeUpload",token,{method:"POST",headers,body:JSON.stringify({initializeUploadRequest:{owner:author}})});
  const value=setup.data.value;
  if(!value?.uploadUrl||!value.image||!/^https:\/\//.test(value.uploadUrl))throw new Error("LinkedIn upload setup failed");
  const remote=await fetch(p.media_url,{signal:AbortSignal.timeout(18000)});
  if(!remote.ok)throw new Error("LinkedIn source image unavailable");
  const bytes=new Uint8Array(await remote.arrayBuffer());
  if(bytes.length>10*1024*1024||bytes.length<64||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)
   throw new Error("LinkedIn image must be JPEG under 10 MB");
  const uploaded=await fetch(value.uploadUrl,{method:"PUT",headers:{"Content-Type":"image/jpeg"},body:bytes,signal:AbortSignal.timeout(25000)});
  if(!uploaded.ok)throw new Error("LinkedIn image upload failed");
  content={media:{id:value.image,altText:p.title.slice(0,120)}};
 }else if(p.link_url){content={article:{source:p.link_url,title:p.title}}}
 const post:any={author,commentary:text(p)+(p.media_url&&p.link_url?"\n\n"+p.link_url:""),
  visibility:"PUBLIC",distribution:{feedDistribution:"MAIN_FEED",targetEntities:[],thirdPartyDistributionChannels:[]},
  lifecycleState:"PUBLISHED",isReshareDisabledByAuthor:false};
 if(content)post.content=content;
 const result=await request("https://api.linkedin.com/rest/posts",token,{method:"POST",headers,body:JSON.stringify(post)});
 const remote=result.headers.get("x-restli-id")||result.data.id;
 if(!remote)throw new Error("LinkedIn did not return a post ID");
 return String(remote);
}
export async function publish(p:CloudPost,token:string){
 if(p.provider==="facebook")return facebook(p,token);
 if(p.provider==="instagram")return instagram(p,token);
 if(p.provider==="linkedin")return linkedin(p,token);
 throw new Error("Unsupported network");
}

export async function firstLinkComment(p:CloudPost,token:string,remote:string):Promise<string|null>{
 const link=(p.link_url||"").trim();
 if(!link || p.content_type==="story" || !["facebook","instagram"].includes(p.provider))return null;
 if(!/^https:\/\//i.test(link))throw new Error("First-comment link must use HTTPS");
 const base=p.provider==="instagram" && p.provider_mode==="instagram_direct" ? "https://graph.instagram.com/" : "https://graph.facebook.com/v23.0/";
 const result=await request(base+id(remote)+"/comments",token,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({message:link})});
 if(!result.data.id)throw new Error("Provider did not confirm first comment");
 return String(result.data.id);
}
