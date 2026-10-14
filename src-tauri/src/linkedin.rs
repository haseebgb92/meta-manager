use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{db, meta};

const PERSONAL_APP_ID: &str = "264964327";
const PERSONAL_CLIENT_ID: &str = "77drthb7h6mp7m";
const PERSONAL_REDIRECT_URI: &str = "http://127.0.0.1:38937/oauth/linkedin/callback";
const OAUTH_BROKER_URL: &str = "https://meta-manager-auth.vercel.app/api/exchange";
const COMPANY_APP_ID: &str = "264974290";
const COMPANY_CLIENT_ID: &str = "77uxxsydc367ll";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkedInStatus {
    pub personal_app_id: String,
    pub personal_client_id: String,
    pub personal_redirect_uri: String,
    pub personal_secret_configured: bool,
    pub accounts: Vec<db::LinkedInAccount>,
    pub company_app_id: String,
    pub company_client_id: String,
    pub company_page: String,
    pub company_status: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkedInOAuthPlan {
    pub authorization_url: String,
    pub state: String,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkedInOAuthResult {
    pub message: String,
    pub account: db::LinkedInAccount,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<i64>,
}

pub fn save_personal_secret(app: &AppHandle, secret: String) -> Result<(), String> {
    meta::save_secret(app, "linkedin_personal_client_secret", &secret)
}

pub fn get_status(app: &AppHandle) -> Result<LinkedInStatus, String> {
    Ok(LinkedInStatus {
        personal_app_id: PERSONAL_APP_ID.into(),
        personal_client_id: PERSONAL_CLIENT_ID.into(),
        personal_redirect_uri: PERSONAL_REDIRECT_URI.into(),
        personal_secret_configured: true,
        accounts: db::list_linkedin_accounts(app)?,
        company_app_id: COMPANY_APP_ID.into(),
        company_client_id: COMPANY_CLIENT_ID.into(),
        company_page: "advertpreneur".into(),
        company_status: "awaiting_community_management_approval".into(),
    })
}

pub fn prepare_personal_oauth(app: &AppHandle) -> Result<LinkedInOAuthPlan, String> {
    let state = Uuid::new_v4().to_string();
    db::set_setting(app, "linkedin_oauth_state", &state)?;
    let generation = crate::oauth::begin_attempt();
    std::thread::sleep(std::time::Duration::from_millis(180));
    start_callback_server(app.clone(), generation)?;
    let scopes = "openid profile email w_member_social";
    let authorization_url = format!(
        "https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id={}&redirect_uri={}&state={}&scope={}",
        urlencoding::encode(PERSONAL_CLIENT_ID),
        urlencoding::encode(PERSONAL_REDIRECT_URI),
        urlencoding::encode(&state),
        urlencoding::encode(scopes),
    );
    Ok(LinkedInOAuthPlan {
        authorization_url,
        state,
        redirect_uri: PERSONAL_REDIRECT_URI.into(),
    })
}

fn start_callback_server(app: AppHandle, generation: u64) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:38937").map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            "OAuth callback port 38937 is already in use. Finish or close the other social login and retry.".to_string()
        } else {
            e.to_string()
        }
    })?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    thread::spawn(move || {
        let started = std::time::Instant::now();
        loop {
            if !crate::oauth::is_current(generation) || started.elapsed() > std::time::Duration::from_secs(600) {
                if crate::oauth::is_current(generation) {
                    crate::oauth::cancel_attempt();
                    let _ = app.emit("linkedin-oauth-error", "LinkedIn login expired. You can try again.".to_string());
                }
                break;
            }
            let accepted = listener.accept();
            let (mut stream, _) = match accepted {
                Ok(pair) => pair,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(120));
                    continue;
                }
                Err(_) => break,
            };
            let mut buffer = [0u8; 16384];
            let count = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..count]);
            let target = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("/");
            let full = format!("http://127.0.0.1:38937{target}");
            let parsed = url::Url::parse(&full).ok();
            let code = parsed.as_ref().and_then(|url| {
                url.query_pairs()
                    .find(|(k, _)| k == "code")
                    .map(|(_, v)| v.into_owned())
            });
            let state = parsed.as_ref().and_then(|url| {
                url.query_pairs()
                    .find(|(k, _)| k == "state")
                    .map(|(_, v)| v.into_owned())
            });
            let oauth_error = parsed.as_ref().and_then(|url| {
                url.query_pairs()
                    .find(|(k, _)| k == "error_description")
                    .map(|(_, v)| v.into_owned())
            });

            let result = if let Some(error) = oauth_error {
                Err(error)
            } else {
                complete_oauth(&app, code, state)
            };
            let (title, body) = match &result {
                Ok(output) => (
                    "LinkedIn connected",
                    format!("{} You can close this browser tab.", output.message),
                ),
                Err(error) => (
                    "LinkedIn connection failed",
                    format!("{error}. You can close this browser tab."),
                ),
            };
            let html = format!(
                "<!doctype html><html><head><meta charset='utf-8'><title>{title}</title><style>body{{font-family:system-ui;background:#f6f8fc;color:#17213b;display:grid;place-items:center;min-height:100vh;margin:0}}main{{background:white;border:1px solid #e7ebf3;border-radius:22px;padding:32px;max-width:560px;box-shadow:0 20px 60px #20305018}}h1{{margin-top:0}}p{{line-height:1.55;color:#6f7b91}}</style></head><body><main><h1>{title}</h1><p>{body}</p></main></body></html>"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(),
                html
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            match result {
                Ok(output) => {
                    let _ = app.emit("linkedin-oauth-complete", output);
                }
                Err(error) => {
                    let _ = app.emit("linkedin-oauth-error", error);
                }
            }
            crate::oauth::cancel_attempt();
            break;
        }
    });
    Ok(())
}

fn complete_oauth(
    app: &AppHandle,
    code: Option<String>,
    state: Option<String>,
) -> Result<LinkedInOAuthResult, String> {
    let code = code.ok_or_else(|| "LinkedIn did not return an authorization code".to_string())?;
    let state = state.ok_or_else(|| "LinkedIn did not return OAuth state".to_string())?;
    let expected = db::get_setting(app, "linkedin_oauth_state")?
        .ok_or_else(|| "LinkedIn OAuth state was not initialized".to_string())?;
    if state != expected {
        return Err("LinkedIn OAuth state mismatch".into());
    }
    let token: TokenResponse = ureq::post(OAUTH_BROKER_URL)
        .timeout(std::time::Duration::from_secs(15))
        .send_json(ureq::json!({
            "provider": "linkedin",
            "code": code,
            "redirectUri": PERSONAL_REDIRECT_URI
        }))
        .map_err(|e| crate::oauth::broker_failure("LinkedIn", e))?
        .into_json()
        .map_err(|_| "LinkedIn broker returned an invalid token response".to_string())?;

    let user: serde_json::Value = ureq::get("https://api.linkedin.com/v2/userinfo")
        .timeout(std::time::Duration::from_secs(10))
        .set("Authorization", &format!("Bearer {}", token.access_token))
        .call()
        .map_err(|_| "LinkedIn profile request failed".to_string())?
        .into_json()
        .map_err(|_| "LinkedIn returned invalid profile data".to_string())?;
    let member_id = user
        .get("sub")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "LinkedIn profile did not include a member ID".to_string())?;
    let name = user
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("LinkedIn member");
    let email = user.get("email").and_then(|v| v.as_str());
    let picture = user.get("picture").and_then(|v| v.as_str());
    meta::save_secret(
        app,
        &format!("linkedin_member_token_{member_id}"),
        &token.access_token,
    )?;
    if let Some(expires) = token.expires_in {
        let expiry = chrono::Utc::now() + chrono::Duration::seconds(expires);
        db::set_setting(
            app,
            &format!("linkedin_token_expiry_{member_id}"),
            &expiry.to_rfc3339(),
        )?;
    }
    let account = db::upsert_linkedin_account(app, member_id, name, email, picture)?;
    Ok(LinkedInOAuthResult {
        message: format!("Connected LinkedIn member {name}."),
        account,
    })
}

fn build_post_text(item: &db::CalendarItem) -> String {
    let mut text = item.caption.clone().unwrap_or_default().trim().to_string();
    if !item.hashtags.is_empty() {
        let tags = item
            .hashtags
            .iter()
            .filter(|tag| !tag.trim().is_empty())
            .map(|tag| format!("#{}", tag.trim().trim_start_matches('#')))
            .collect::<Vec<_>>()
            .join(" ");
        if !tags.is_empty() {
            if !text.is_empty() {
                text.push_str("\n\n");
            }
            text.push_str(&tags);
        }
    }
    text
}


/// Upload a public image to the LinkedIn Images API before referencing it in a post.
fn upload_image(token: &str, owner: &str, url: &str) -> Result<String, String> {
    let parsed = url::Url::parse(url).map_err(|_| "Image URL is invalid")?;
    if parsed.scheme() != "https" {
        return Err("LinkedIn images need a public HTTPS image URL".into());
    }
    let response = ureq::get(url)
        .timeout(std::time::Duration::from_secs(25))
        .call()
        .map_err(|e| format!("Could not download LinkedIn image: {e}"))?;
    let content_type = response.header("content-type").unwrap_or("image/jpeg").split(';').next().unwrap_or("image/jpeg").to_owned();
    if !["image/jpeg","image/png","image/gif"].contains(&content_type.as_str()) {
        return Err(format!("LinkedIn supports JPEG, PNG or GIF; image source returned {content_type}"));
    }
    let mut bytes = Vec::new();
    response.into_reader().take(12_000_001).read_to_end(&mut bytes)
        .map_err(|e| format!("Image download failed: {e}"))?;
    if bytes.is_empty() || bytes.len() > 12_000_000 {
        return Err("LinkedIn image must be nonempty and at most 12 MB".into());
    }
    let setup: serde_json::Value = ureq::post("https://api.linkedin.com/rest/images?action=initializeUpload")
        .timeout(std::time::Duration::from_secs(20))
        .set("Authorization", &format!("Bearer {token}"))
        .set("X-Restli-Protocol-Version", "2.0.0")
        .set("LinkedIn-Version", "202606")
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({"initializeUploadRequest": {"owner": owner}}))
        .map_err(|e| format!("LinkedIn image initialization failed: {e}"))?
        .into_json().map_err(|e| e.to_string())?;
    let upload_url = setup.pointer("/value/uploadUrl").and_then(|v| v.as_str())
        .ok_or("LinkedIn did not return image upload URL")?;
    let image_id = setup.pointer("/value/image").and_then(|v| v.as_str())
        .ok_or("LinkedIn did not return image URN")?.to_string();
    ureq::put(upload_url)
        .timeout(std::time::Duration::from_secs(40))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", &content_type)
        .send_bytes(&bytes)
        .map_err(|e| format!("LinkedIn image upload failed: {e}"))?;
    Ok(image_id)
}
pub fn publish_calendar_item(
    app: &AppHandle,
    item_id: &str,
) -> Result<crate::meta::PublishResult, String> {
    let item = db::get_calendar_item(app, item_id)?
        .ok_or_else(|| "Calendar item was not found".to_string())?;
    if item.platform != "linkedin" {
        return Err("Calendar item is not a LinkedIn post".into());
    }

    let account = db::get_linkedin_account(app, &item.account_id)?
        .ok_or_else(|| "LinkedIn account was not found".to_string())?;
    if account.status != "connected" {
        return Err("LinkedIn account is not connected".into());
    }

    if let Some(expiry) =
        db::get_setting(app, &format!("linkedin_token_expiry_{}", account.member_id))?
    {
        if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(&expiry) {
            if expiry.with_timezone(&chrono::Utc) <= chrono::Utc::now() {
                return Err(
                    "LinkedIn access token has expired. Reconnect this member in Settings.".into(),
                );
            }
        }
    }

    let image_url = item.media_url.as_deref().map(str::trim).filter(|v| !v.is_empty());
    let link_url = item.link_url.as_deref().map(str::trim).filter(|v| !v.is_empty());
    if let Some(link) = link_url {
        let u = url::Url::parse(link).map_err(|_| "LinkedIn link URL is invalid")?;
        if !["https", "http"].contains(&u.scheme()) {
            return Err("LinkedIn links must use HTTP or HTTPS".into());
        }
    }
    let mut commentary = build_post_text(&item);
    if image_url.is_some() {
        if let Some(link) = link_url {
            if !commentary.contains(link) { commentary.push_str(&format!("\n\n{link}")); }
        }
    }
    if commentary.trim().is_empty() && image_url.is_none() && link_url.is_none() {
        return Err("LinkedIn posts need a caption, image, or link".into());
    }

    let token = meta::load_secret(app, &format!("linkedin_member_token_{}", account.member_id))?;
    let owner = format!("urn:li:person:{}", account.member_id);
    db::mark_calendar_publishing(app, item_id)?;

    let result = (|| -> Result<crate::meta::PublishResult, String> {
        let mut body = serde_json::json!({
            "author": owner,
            "commentary": commentary,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": []
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": false
        });
        if let Some(image_url) = image_url {
            let image_id = upload_image(&token, &owner, image_url)?;
            body["content"] = serde_json::json!({"media": {"id": image_id, "altText": item.title}});
        } else if let Some(link) = link_url {
            body["content"] = serde_json::json!({"article": {"source": link, "title": item.title, "description": ""}});
        }
        let response = ureq::post("https://api.linkedin.com/rest/posts")
            .timeout(std::time::Duration::from_secs(20))
            .set("Authorization", &format!("Bearer {token}"))
            .set("X-Restli-Protocol-Version", "2.0.0")
            .set("LinkedIn-Version", "202606")
            .set("Content-Type", "application/json")
            .send_json(body)
            .map_err(|error| format!("LinkedIn publish failed: {error}"))?;

        let post_id = response
            .header("x-restli-id")
            .or_else(|| response.header("X-RestLi-Id"))
            .map(str::to_string)
            .ok_or_else(|| {
                "LinkedIn published the request but did not return x-restli-id".to_string()
            })?;

        db::mark_calendar_published(app, item_id, &format!("linkedin:{post_id}"))?;

        Ok(crate::meta::PublishResult {
            calendar_item_id: item_id.to_string(),
            facebook_post_id: None,
            instagram_post_id: None,
            linkedin_post_id: Some(post_id),
            message: "Published to LinkedIn successfully".into(),
        })
    })();

    if let Err(error) = &result {
        let _ = db::mark_calendar_failed(app, item_id, error);
    }
    result
}