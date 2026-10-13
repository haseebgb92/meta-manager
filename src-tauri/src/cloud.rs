use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle,Manager};

use crate::{db, hosting, meta};

const API_ROOT: &str = "https://hwhioqvsxazyxziyrhdg.supabase.co";
const FUNCTION: &str = "https://hwhioqvsxazyxziyrhdg.supabase.co/functions/v1/meta-manager-cloud";
const PUBLIC_KEY: &str = "sb_publishable_nukcv3u9TU4TGx24cilYIQ_wYJAQqjv";
const ACCESS: &str = "mm_cloud_access_token";
const REFRESH: &str = "mm_cloud_refresh_token";
const EMAIL: &str = "mm_cloud_email";

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CloudStatus { pub signed_in: bool, pub email: String }

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct CloudPost {
    pub id: String,
    #[serde(alias="source_id")]
    pub source_id: String,
    #[serde(alias="account_id")]
    pub account_id: String,
    pub provider: String,
    #[serde(default,alias="first_comment_status")]
    pub first_comment_status: Option<String>,
    #[serde(default,alias="first_comment_id")]
    pub first_comment_id: Option<String>,
    #[serde(default,alias="first_comment_error")]
    pub first_comment_error: Option<String>,
    pub title: String,
    pub caption: String,
    pub hashtags: Vec<String>,
    #[serde(alias="media_url")]
    pub media_url: Option<String>,
    #[serde(alias="link_url")]
    pub link_url: Option<String>,
    pub status: String,
    #[serde(alias="scheduled_for")]
    pub scheduled_for: String,
    pub attempts: i64,
    #[serde(alias="last_error")]
    pub last_error: Option<String>,
    #[serde(alias="published_remote_id")]
    pub published_remote_id: Option<String>,
    #[serde(alias="published_at")]
    pub published_at: Option<String>,
}

fn cloud_secret(app:&AppHandle,name:&str)->Result<String,String>{
    let mut file=app.path().app_data_dir().map_err(|e|e.to_string())?;
    file.push("secrets");file.push(format!("{name}.secret"));
    if let Ok(value)=std::fs::read_to_string(file){
        if !value.trim().is_empty(){return Ok(value.trim().to_string())}
    }
    meta::load_secret(app,name)
}

fn parse_response(response: Result<ureq::Response, ureq::Error>) -> Result<Value,String> {
    match response {
        Ok(reply) => reply.into_json::<Value>().map_err(|_| "Cloud returned an invalid response".into()),
        Err(ureq::Error::Status(403, _)) => Err("This one-time email link has expired or was already used. Click Connect Cloud to use your existing social account instead.".into()),
        Err(ureq::Error::Status(code, _)) => Err(format!("Cloud request failed (HTTP {code}). You may need to reconnect the selected social account.")),
        Err(e) => Err(format!("Could not reach cloud: {e}"))
    }
}
fn auth_post(url:&str, body: Value) -> Result<Value,String> {
    parse_response(ureq::post(url).timeout(std::time::Duration::from_secs(22))
        .set("apikey",PUBLIC_KEY)
        .set("Content-Type","application/json")
        .send_json(body))
}
pub fn status(app:&AppHandle)->CloudStatus {
    CloudStatus {
        signed_in:cloud_secret(app,ACCESS).is_ok_and(|token| token!="signed_out"),
        email:db::get_setting(app,"mm_cloud_identity_label").ok().flatten()
          .filter(|value|!value.is_empty())
          .or_else(||db::get_setting(app,EMAIL).ok().flatten())
          .unwrap_or_default()
    }
}
pub fn connect_existing(app:&AppHandle)->Result<CloudStatus,String>{
    // Preferred: the user's own LinkedIn profile (OIDC identity).
    // Fallback: an already authorized Instagram account, then Facebook Page.
    let mut selected:Option<(String,String,String,String,String)>=None;
    for member in db::list_linkedin_accounts(app)? {
        let secret=format!("linkedin_member_token_{}",member.member_id);
        if meta::has_secret(app,&secret) {
            selected=Some(("linkedin".into(),member.id,member.member_id,secret,member.name));
            break;
        }
    }
    if selected.is_none(){
        for account in db::list_accounts(app)? {
            if let Some(ig)=account.instagram_account_id.clone() {
                let secret=format!("instagram_direct_token_{ig}");
                if meta::has_secret(app,&secret) {
                    selected=Some(("instagram".into(),account.id,ig,secret,account.name));
                    break;
                }
            }
        }
    }
    let (provider,account_id,remote_id,secret,account_name)=selected
      .ok_or("Connect a LinkedIn profile or direct Instagram account first, or choose Email Sign-in below")?;
    let access=meta::load_secret(app,&secret)?;
    let data=parse_response(ureq::post(FUNCTION)
      .timeout(std::time::Duration::from_secs(30))
      .set("Content-Type","application/json")
      .send_json(json!({
        "action":"connect_social","provider":provider,
        "accountId":account_id,"remoteAccountId":remote_id,"token":access
      })))?;
    let session=data["session"].as_str().ok_or("Cloud did not return a valid session")?;
    if !session.starts_with("mmc_") || session.len()!=68 {
      return Err("Cloud returned an invalid account session".into());
    }
    meta::save_secret(app,ACCESS,session)?;
    meta::save_secret(app,REFRESH,"signed_out")?;
    db::set_setting(app,"mm_cloud_identity_label",&format!("{account_name} ({provider})"))?;
    Ok(status(app))
}

pub fn send_code(app:&AppHandle,email:String)->Result<(),String>{
    let email=email.trim().to_lowercase();
    if !email.contains('@') || email.len()>200 {return Err("Enter your email address".into());}
    auth_post(&format!("{API_ROOT}/auth/v1/otp"),json!({
        "email":email,"create_user":true
    }))?;
    db::set_setting(app,EMAIL,&email)?;
    Ok(())
}
pub fn verify_code(app:&AppHandle,email:String,code:String)->Result<CloudStatus,String>{
    let email=email.trim().to_lowercase();
    let code=code.trim();
    let payload=if code.chars().all(|x|x.is_ascii_digit()) && code.len()==6 {
        json!({"email":email,"token":code,"type":"email"})
    }else{
        let link=url::Url::parse(code).map_err(|_|"Enter a 6-digit code or paste the Supabase email sign-in link".to_string())?;
        if link.scheme()!="https" || link.host_str()!=Some("hwhioqvsxazyxziyrhdg.supabase.co") || link.path()!="/auth/v1/verify" {
            return Err("Sign-in link is not from your Meta Manager Cloud project".into());
        }
        let vars:std::collections::HashMap<_,_>=link.query_pairs().into_owned().collect();
        let token=vars.get("token_hash").or_else(||vars.get("token"))
          .ok_or("The sign-in link has no verification token")?;
        let kind=vars.get("type").map(String::as_str).unwrap_or("magiclink");
        if !matches!(kind,"magiclink"|"email"|"signup") {return Err("Unsupported sign-in link".into());}
        json!({"token_hash":token,"type":kind})
    };
    let result=auth_post(&format!("{API_ROOT}/auth/v1/verify"),payload)?;
    let access=result["access_token"].as_str().ok_or("Login did not return an access token")?;
    let refresh=result["refresh_token"].as_str().ok_or("Login did not return a refresh token")?;
    meta::save_secret(app,ACCESS,access)?;
    meta::save_secret(app,REFRESH,refresh)?;
    db::set_setting(app,EMAIL,&email)?;
    db::set_setting(app,"mm_cloud_identity_label","")?;
    Ok(status(app))
}
fn refresh_session(app:&AppHandle)->Result<String,String>{
    let token=cloud_secret(app,REFRESH)?;
    let result=auth_post(&format!("{API_ROOT}/auth/v1/token?grant_type=refresh_token"),
        json!({"refresh_token":token}))?;
    let access=result["access_token"].as_str().ok_or("Cloud session has expired; sign in again")?;
    let refresh=result["refresh_token"].as_str().ok_or("Cloud refresh token is missing")?;
    meta::save_secret(app,ACCESS,access)?;
    meta::save_secret(app,REFRESH,refresh)?;
    Ok(access.to_string())
}
fn signed_cloud_call(app:&AppHandle,body:Value)->Result<Value,String>{
    let token=cloud_secret(app,ACCESS)
        .map_err(|_|"Sign in to Meta Manager Cloud under Settings".to_string())?;
    let request=|token:&str|{
        ureq::post(FUNCTION).timeout(std::time::Duration::from_secs(45))
        .set("Content-Type","application/json")
        .set("Authorization",&format!("Bearer {token}"))
        .send_json(body.clone())
    };
    match request(&token){
        Err(ureq::Error::Status(401,_)) if token.starts_with("mmc_") =>
            Err("Cloud session expired. Connect Cloud again using your linked social account.".into()),
        Err(ureq::Error::Status(401,_))=>parse_response(request(&refresh_session(app)?)),
        other=>parse_response(other)
    }
}
pub fn status_remote(app:&AppHandle)->Result<Value,String>{
    signed_cloud_call(app,json!({"action":"status"}))
}
pub fn list_cloud_posts(app:&AppHandle)->Result<Vec<CloudPost>,String>{
    let data=signed_cloud_call(app,json!({"action":"list"}))?;
    serde_json::from_value(data["posts"].clone()).map_err(|_|"Unable to read cloud post list".into())
}
pub fn connect_account(app:&AppHandle,account_id:String,provider:String)->Result<(),String>{
    let account=db::get_account(app,&account_id)?.ok_or("Account not found")?;
    let token=match provider.as_str(){
        "facebook"=>{
            let page=account.facebook_page_id.ok_or("Facebook Page is not connected")?;
            meta::load_secret(app,&format!("meta_page_token_{page}"))?
        }
        "instagram"=>{
            let ig=account.instagram_account_id.ok_or("Instagram profile is not connected")?;
            if meta::has_secret(app,&format!("instagram_direct_token_{ig}")){
                meta::load_secret(app,&format!("instagram_direct_token_{ig}"))?
            }else{
                let page=account.facebook_page_id.ok_or("Instagram profile has no associated Page token")?;
                meta::load_secret(app,&format!("meta_page_token_{page}"))?
            }
        }
        "linkedin"=>{
            let member=db::get_linkedin_account(app,&account_id)?.ok_or("LinkedIn account is not connected")?;
            meta::load_secret(app,&format!("linkedin_member_token_{}",member.member_id))?
        }
        _=>return Err("Unsupported platform".into())
    };
    signed_cloud_call(app,json!({
      "action":"connection","accountId":account_id,"provider":provider,"token":token
    }))?;
    Ok(())
}
pub fn disconnect_account(app:&AppHandle,account_id:String,provider:String)->Result<(),String>{
    signed_cloud_call(app,json!({
      "action":"disconnect","accountId":account_id,"provider":provider
    }))?;
    Ok(())
}
fn schedule_one(app:&AppHandle,item:&db::CalendarItem,provider:&str)->Result<(),String>{
    let account=db::get_account(app,&item.account_id)?.ok_or("Account missing")?;
    let (remote,mode)=match provider {
       "facebook" => (account.facebook_page_id.ok_or("Facebook Page missing")?,"standard"),
       "instagram"=>{
            let ig=account.instagram_account_id.ok_or("Instagram account missing")?;
            let direct=meta::has_secret(app,&format!("instagram_direct_token_{ig}"));
            (ig,if direct{"instagram_direct"}else{"standard"})
       },
       "linkedin"=>{
            let member=db::get_linkedin_account(app,&item.account_id)?.ok_or("LinkedIn account missing")?;
            (member.member_id,"standard")
       },
       _=>return Err("Unknown platform".into())
    };
    signed_cloud_call(app,json!({
      "action":"schedule","accountId":item.account_id,"sourceId":item.id,
      "provider":provider,"providerMode":mode,"remoteAccountId":remote,
      "title":item.title,"caption":item.caption.clone().unwrap_or_default(),
      "hashtags":item.hashtags,"scheduledFor":item.scheduled_for,
      "mediaUrl":item.media_url,"linkUrl":item.link_url,
      "contentType":match item.platform.as_str(){"instagram_reel"=>"reel","instagram_story"=>"story",_=>"feed"}
    }))?;
    Ok(())
}
pub fn schedule_item(app:&AppHandle,item_id:String)->Result<(),String>{
    let item=db::get_calendar_item(app,&item_id)?.ok_or("Draft not found")?;
    if item.status!="draft" {return Err("Cloud scheduling requires an unpublished draft".into());}
    let date=item.scheduled_for.as_deref().ok_or("Set a schedule time")?;
    let when=chrono::DateTime::parse_from_rfc3339(date).map_err(|_|"Invalid time")?;
    if when.timestamp() <= chrono::Utc::now().timestamp()+65 {
        return Err("Schedule cloud posts at least two minutes in advance".into());
    }
    // Ensure all destination credentials are present before posting into the cloud queue.
    let networks:Vec<&str>=match item.platform.as_str(){
      "both"=>vec!["facebook","instagram"],
      "facebook"=>vec!["facebook"],
      "instagram"|"instagram_reel"|"instagram_story"=>vec!["instagram"],
      "linkedin"=>vec!["linkedin"],
      _=>return Err("Invalid platform".into())
    };
    for platform in &networks {
        let found=signed_cloud_call(app,json!({
          "action":"connection_status","accountId":item.account_id,"provider":platform
        }))?;
        if found["connected"]!=true {return Err(format!("First enable {platform} cloud publishing in Settings"));}
    }
    for platform in networks {
        if let Err(error)=schedule_one(app,&item,platform){
            // Avoid a partially queued Facebook + Instagram pair.
            let _=signed_cloud_call(app,json!({"action":"cancel_source","sourceId":item.id}));
            return Err(error);
        }
    }
    db::mark_calendar_cloud_scheduled(app,&item_id)?;
    Ok(())
}
pub fn upload_media(app:&AppHandle,base64_data:String)->Result<hosting::HostedMedia,String>{
    use base64::{engine::general_purpose::STANDARD,Engine as _};
    if base64_data.len()>15_000_000{return Err("Image exceeds size limit".into());}
    let bytes=STANDARD.decode(base64_data).map_err(|_|"Invalid image data")?;
    if bytes.len()>10*1024*1024 || bytes.len()<64 || !bytes.starts_with(&[255,216,255]){
        return Err("Cloud uploads require a JPEG image under 10 MB".into());
    }
    let prepared=signed_cloud_call(app,json!({"action":"prepare_media_upload"}))?;
    let signed=prepared["uploadUrl"].as_str().ok_or("Cloud did not provide a signed upload URL")?;
    let media=prepared["mediaUrl"].as_str().ok_or("Cloud did not provide a public media URL")?;
    let signed_url=url::Url::parse(signed).map_err(|_|"Invalid signed upload URL")?;
    let media_url=url::Url::parse(media).map_err(|_|"Invalid public media URL")?;
    let trusted_host=Some("hwhioqvsxazyxziyrhdg.supabase.co");
    if signed_url.scheme()!="https" || signed_url.host_str()!=trusted_host ||
       !signed_url.path().starts_with("/storage/v1/object/upload/sign/mm-public-media/") ||
       media_url.scheme()!="https" || media_url.host_str()!=trusted_host ||
       !media_url.path().starts_with("/storage/v1/object/public/mm-public-media/") {
        return Err("Cloud returned an untrusted media endpoint".into());
    }
    ureq::put(signed).timeout(std::time::Duration::from_secs(65))
      .set("Content-Type","image/jpeg")
      .set("x-upsert","false")
      .send_bytes(&bytes)
      .map_err(|_|"Cloud image upload failed. Retry once or select a smaller image.".to_string())?;
    Ok(hosting::HostedMedia {url:media.to_string(),media_id:None,verified_public:true,
      note:"JPEG uploaded to the free cloud media library.".into()})
}
pub fn upload_video(app:&AppHandle,base64_data:String)->Result<hosting::HostedMedia,String>{
 use base64::{engine::general_purpose::STANDARD,Engine as _};
 if base64_data.len()>140_000_000{return Err("Video exceeds 100 MB limit".into());}
 let bytes=STANDARD.decode(base64_data).map_err(|_|"Invalid video encoding")?;
 if bytes.len()>100*1024*1024||bytes.len()<128||&bytes[4..8]!=b"ftyp"{return Err("Only MP4 videos under 100 MB are supported".into());}
 let prepared=signed_cloud_call(app,json!({"action":"prepare_media_upload","mediaType":"video/mp4"}))?;
 let signed=prepared["uploadUrl"].as_str().ok_or("No signed video upload URL")?;
 let media=prepared["mediaUrl"].as_str().ok_or("No video media URL")?;
 let u=url::Url::parse(signed).map_err(|_|"Invalid upload URL")?;
 let v=url::Url::parse(media).map_err(|_|"Invalid media URL")?;
 if u.scheme()!="https"||v.scheme()!="https"||u.host_str()!=Some("hwhioqvsxazyxziyrhdg.supabase.co")||v.host_str()!=u.host_str()||!u.path().starts_with("/storage/v1/object/upload/sign/mm-public-media/")||!v.path().starts_with("/storage/v1/object/public/mm-public-media/"){return Err("Untrusted cloud video endpoint".into());}
 ureq::put(signed).timeout(std::time::Duration::from_secs(180)).set("Content-Type","video/mp4").set("x-upsert","false").send_bytes(&bytes).map_err(|_|"Cloud MP4 upload failed")?;
 Ok(hosting::HostedMedia{url:media.into(),media_id:None,verified_public:true,note:"MP4 uploaded to cloud media hosting".into()})
}
pub fn logout(app:&AppHandle)->Result<(),String>{
    // Replace stored credentials with revoked markers; never expose tokens.
    let _=signed_cloud_call(app,json!({"action":"sign_out"}));
    meta::save_secret(app,ACCESS,"signed_out")?;
    meta::save_secret(app,REFRESH,"signed_out")?;
    db::set_setting(app,EMAIL,"")?;
    db::set_setting(app,"mm_cloud_identity_label","")?;
    Ok(())
}
#[cfg(test)]
mod cloud_calendar_tests {
    use super::CloudPost;

    #[test]
    fn cloud_post_preserves_calendar_media_and_caption() {
        let result = serde_json::from_value::<CloudPost>(serde_json::json!({
            "id":"remote-123", "source_id":"local-1", "account_id":"account-1",
            "provider":"instagram", "title":"Scheduled in Cloud", "caption":"Cloud test caption",
            "hashtags":["webdev"], "media_url":"https://example.org/a.jpg", "link_url":null,
            "status":"scheduled", "scheduled_for":"2026-10-10T10:20:00+00:00",
            "attempts":0, "last_error":null, "published_remote_id":null, "published_at":null
        })).expect("cloud calendar must deserialize the full post payload");
        assert_eq!(result.caption, "Cloud test caption");
        assert_eq!(result.media_url.as_deref(), Some("https://example.org/a.jpg"));
        let frontend = serde_json::to_value(&result).unwrap();
        assert_eq!(frontend["accountId"], "account-1");
        assert_eq!(frontend["mediaUrl"], "https://example.org/a.jpg");
    }
}
