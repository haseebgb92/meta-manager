use serde::Serialize;
use std::{io::{Read, Write}, net::TcpListener, thread};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{db, meta};

const REDIRECT_URI: &str = "https://127.0.0.1:38937/oauth/instagram/callback";
const APP_ID: &str = "2228119617760136";
const OAUTH_BROKER_URL: &str = "https://meta-manager-auth.vercel.app/api/exchange";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstagramStatus {
    pub app_id: Option<String>,
    pub secret_configured: bool,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstagramOAuthPlan {
    pub authorization_url: String,
    pub state: String,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstagramOAuthResult {
    pub message: String,
    pub account_id: String,
    pub instagram_account_id: String,
    pub username: String,
    pub name: String,
}

pub fn get_status(app: &AppHandle) -> Result<InstagramStatus, String> {
    Ok(InstagramStatus {
        app_id: Some(APP_ID.to_string()),
        secret_configured: true,
        redirect_uri: REDIRECT_URI.to_string(),
    })
}

pub fn save_config(app: &AppHandle, app_id: String, secret: Option<String>) -> Result<InstagramStatus, String> {
    let app_id = app_id.trim();
    if app_id.is_empty() { return Err("Instagram App ID is required".into()); }
    db::set_setting(app, "instagram_app_id", app_id)?;
    if let Some(secret) = secret {
        if !secret.trim().is_empty() {
            meta::save_secret(app, "instagram_app_secret", secret.trim())?;
        }
    }
    get_status(app)
}

pub fn prepare_oauth(app: &AppHandle) -> Result<InstagramOAuthPlan, String> {
    let app_id = APP_ID.to_string();
    meta::ensure_local_tls_material(app)?;

    let state = Uuid::new_v4().to_string();
    db::set_setting(app, "instagram_oauth_state", &state)?;
    let generation = crate::oauth::begin_attempt();
    std::thread::sleep(std::time::Duration::from_millis(180));
    start_callback_server(app.clone(), generation)?;

    let scopes = "instagram_business_basic,instagram_business_content_publish";
    let authorization_url = format!(
        "https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        urlencoding::encode(&app_id),
        urlencoding::encode(REDIRECT_URI),
        urlencoding::encode(scopes),
        urlencoding::encode(&state),
    );
    Ok(InstagramOAuthPlan { authorization_url, state, redirect_uri: REDIRECT_URI.into() })
}

fn start_callback_server(app: AppHandle, generation: u64) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:38937").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let config = meta::tls_config(&app)?;
    thread::spawn(move || {
        let started = std::time::Instant::now();
        loop {
            if !crate::oauth::is_current(generation) || started.elapsed() > std::time::Duration::from_secs(600) {
                if crate::oauth::is_current(generation) {
                    crate::oauth::cancel_attempt();
                    let _ = app.emit("instagram-oauth-error", "Instagram login expired. You can try again.".to_string());
                }
                break;
            }
            let (tcp, _) = match listener.accept() {
                Ok(pair) => pair,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(120));
                    continue;
                }
                Err(_) => break,
            };
            let conn = match rustls::ServerConnection::new(config.clone()) {
                Ok(conn) => conn,
                Err(error) => { let _ = app.emit("instagram-oauth-error", error.to_string()); break; }
            };
            let mut stream = rustls::StreamOwned::new(conn, tcp);
            let mut buffer = [0u8; 16384];
            let count = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..count]);
            let target = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
            let full = format!("https://127.0.0.1:38937{target}");
            let parsed = url::Url::parse(&full).ok();
            let code = parsed.as_ref().and_then(|u| u.query_pairs().find(|(k,_)| k=="code").map(|(_,v)| v.into_owned()));
            let state = parsed.as_ref().and_then(|u| u.query_pairs().find(|(k,_)| k=="state").map(|(_,v)| v.into_owned()));
            let oauth_error = parsed.as_ref().and_then(|u| u.query_pairs().find(|(k,_)| k=="error_description").map(|(_,v)| v.into_owned()));
            let result = if let Some(error)=oauth_error { Err(error) } else { complete_oauth(&app, code, state) };
            let (title, body) = match &result {
                Ok(output) => ("Instagram connected", format!("Connected @{}. You can close this browser tab.", output.username)),
                Err(error) => ("Instagram connection failed", format!("{error}. You can close this browser tab.")),
            };
            let html = format!("<!doctype html><html><head><meta charset='utf-8'><title>{title}</title><style>body{{font-family:system-ui;background:#f6f8fc;color:#17213b;display:grid;place-items:center;min-height:100vh;margin:0}}main{{background:white;border:1px solid #e7ebf3;border-radius:22px;padding:32px;max-width:560px;box-shadow:0 20px 60px #20305018}}p{{color:#6f7b91}}</style></head><body><main><h1>{title}</h1><p>{body}</p></main></body></html>");
            let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", html.len(), html);
            let _ = stream.write_all(response.as_bytes()); let _ = stream.flush();
            match result {
                Ok(output) => { let _ = app.emit("instagram-oauth-complete", output); }
                Err(error) => { let _ = app.emit("instagram-oauth-error", error); }
            }
            crate::oauth::cancel_attempt();
            break;
        }
    });
    Ok(())
}

fn complete_oauth(app: &AppHandle, code: Option<String>, state: Option<String>) -> Result<InstagramOAuthResult, String> {
    let code = code.ok_or_else(|| "Instagram did not return an authorization code".to_string())?;
    let state = state.ok_or_else(|| "Instagram did not return OAuth state".to_string())?;
    let expected = db::get_setting(app, "instagram_oauth_state")?.ok_or_else(|| "Instagram OAuth state was not initialized".to_string())?;
    if state != expected { return Err("Instagram OAuth state mismatch".into()); }
    let long: serde_json::Value = ureq::post(OAUTH_BROKER_URL)
        .timeout(std::time::Duration::from_secs(15))
        .send_json(ureq::json!({
            "provider": "instagram",
            "code": code,
            "redirectUri": REDIRECT_URI
        }))
        .map_err(|e| crate::oauth::broker_failure("Instagram", e))?
        .into_json().map_err(|e| format!("Instagram broker returned an invalid token response: {e}"))?;
    let access_token = long.get("access_token").and_then(|v| v.as_str()).ok_or_else(|| format!("Instagram broker response missing access token: {long}"))?.to_string();
    let expires_in = long.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(0);

    let profile_url = format!("https://graph.instagram.com/me?fields=id,user_id,username,name,profile_picture_url,followers_count,media_count&access_token={}", urlencoding::encode(&access_token));
    let profile: serde_json::Value = ureq::get(&profile_url).call().map_err(|e| e.to_string())?.into_json().map_err(|e| e.to_string())?;
    let ig_id = profile.get("user_id").or_else(|| profile.get("id")).and_then(|v| v.as_str()).ok_or_else(|| format!("Instagram profile response missing user id: {profile}"))?.to_string();
    let username = profile.get("username").and_then(|v| v.as_str()).unwrap_or("instagram").to_string();
    let name = profile.get("name").and_then(|v| v.as_str()).filter(|v| !v.is_empty()).unwrap_or(&username).to_string();

    meta::save_secret(app, &format!("instagram_direct_token_{ig_id}"), &access_token)?;
    db::set_setting(app, &format!("instagram_direct_username_{ig_id}"), &username)?;
    if expires_in > 0 {
        let expiry = chrono::Utc::now() + chrono::Duration::seconds(expires_in);
        db::set_setting(app, &format!("instagram_direct_expiry_{ig_id}"), &expiry.to_rfc3339())?;
    }
    let account = db::upsert_meta_account(app, &name, None, Some(&ig_id))?;
    Ok(InstagramOAuthResult {
        message: format!("Connected Instagram @{}", username),
        account_id: account.id,
        instagram_account_id: ig_id,
        username,
        name,
    })
}