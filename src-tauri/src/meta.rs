use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufReader, Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::Arc,
    thread,
};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;
use uuid::Uuid;

use crate::db;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaConfigStatus {
    pub app_id: Option<String>,
    pub api_version: String,
    pub configured: bool,
    pub secret_configured: bool,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaOAuthPlan {
    pub authorization_url: String,
    pub state: String,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredMetaAccount {
    pub name: String,
    pub facebook_page_id: String,
    pub instagram_account_id: Option<String>,
    pub instagram_username: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthResult {
    pub accounts: Vec<DiscoveredMetaAccount>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

const DEFAULT_API_VERSION: &str = "v23.0";
const DEFAULT_APP_ID: &str = "1079289208340048";
const DEFAULT_REDIRECT_URI: &str = "https://127.0.0.1:38937/oauth/meta/callback";
const OAUTH_BROKER_URL: &str = "https://meta-manager-auth.vercel.app/api/exchange";
const KEYRING_SERVICE: &str = "com.advertpreneur.metamanager";

fn secret_entry(name: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, name).map_err(|e| e.to_string())
}

fn secret_file_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let mut dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    dir.push("secrets");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    dir.push(format!("{name}.secret"));
    Ok(dir)
}

pub(crate) fn save_secret(app: &AppHandle, name: &str, value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Secret value cannot be empty".into());
    }

    // Best-effort keyring copy. We also persist an owner-only fallback file
    // because some Linux Secret Service implementations can accept a write
    // but fail to return it after the process restarts.
    if let Ok(entry) = secret_entry(name) {
        let _ = entry.set_password(value);
    }

    let path = secret_file_path(app, name)?;
    fs::write(&path, value.as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&path)
            .map_err(|e| e.to_string())?
            .permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(&path, permissions).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn load_secret(app: &AppHandle, name: &str) -> Result<String, String> {
    if let Ok(entry) = secret_entry(name) {
        if let Ok(value) = entry.get_password() {
            if !value.trim().is_empty() {
                return Ok(value);
            }
        }
    }

    let path = secret_file_path(app, name)?;
    let value = fs::read_to_string(path).map_err(|_| format!("Secret {name} is not stored yet"))?;
    if value.trim().is_empty() {
        return Err(format!("Secret {name} is empty"));
    }
    Ok(value.trim().to_string())
}

pub(crate) fn has_secret(app: &AppHandle, name: &str) -> bool {
    load_secret(app, name).is_ok()
}

pub fn save_app_secret(app: &AppHandle, secret: String) -> Result<(), String> {
    save_secret(app, "meta_app_secret", &secret)
}

fn get_app_secret(app: &AppHandle) -> Result<String, String> {
    load_secret(app, "meta_app_secret")
}

pub fn get_config_status(app: &AppHandle) -> Result<MetaConfigStatus, String> {
    let app_id = db::get_setting(app, "meta_app_id")?.or_else(|| Some(DEFAULT_APP_ID.to_string()));
    let api_version = db::get_setting(app, "meta_api_version")?
        .unwrap_or_else(|| DEFAULT_API_VERSION.to_string());
    let stored_redirect = db::get_setting(app, "meta_redirect_uri")?;
    let redirect_uri = match stored_redirect.as_deref() {
        Some(value) if value.starts_with("https://") => value.to_string(),
        _ => DEFAULT_REDIRECT_URI.to_string(),
    };

    Ok(MetaConfigStatus {
        configured: app_id
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty()),
        secret_configured: true,
        app_id,
        api_version,
        redirect_uri,
    })
}

pub fn save_config(
    app: &AppHandle,
    app_id: String,
    api_version: Option<String>,
) -> Result<MetaConfigStatus, String> {
    let app_id = app_id.trim();
    if app_id.is_empty() {
        return Err("Meta App ID is required".into());
    }
    if !app_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("Meta App ID should contain digits only".into());
    }

    db::set_setting(app, "meta_app_id", app_id)?;
    let version = api_version.unwrap_or_else(|| DEFAULT_API_VERSION.to_string());
    db::set_setting(app, "meta_api_version", version.trim())?;
    db::set_setting(app, "meta_redirect_uri", DEFAULT_REDIRECT_URI)?;
    get_config_status(app)
}

pub fn prepare_oauth(app: &AppHandle, mode: Option<String>) -> Result<MetaOAuthPlan, String> {
    let config = get_config_status(app)?;
    if !config.secret_configured {
        return Err("Store the Meta App Secret before connecting an account".into());
    }
    let app_id = config
        .app_id
        .ok_or_else(|| "Configure the Meta App ID first".to_string())?;

    let state = Uuid::new_v4().to_string();
    db::set_setting(app, "meta_oauth_state", &state)?;
    let mode = mode.unwrap_or_else(|| "all".to_string());
    let mode = match mode.as_str() { "facebook" | "instagram" => mode, _ => "all".to_string() };
    db::set_setting(app, "meta_oauth_mode", &mode)?;

    ensure_local_tls_material(app)?;
    let generation = crate::oauth::begin_attempt();
    std::thread::sleep(std::time::Duration::from_millis(180));
    start_callback_server(app.clone(), generation)?;

    let scopes = [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_metadata",
        "pages_manage_posts",
        "read_insights",
        "instagram_basic",
        "instagram_content_publish",
        "instagram_manage_insights",
        "business_management",
    ]
    .join(",");

    let authorization_url = format!(
        "https://www.facebook.com/{}/dialog/oauth?client_id={}&redirect_uri={}&state={}&response_type=code&scope={}",
        config.api_version,
        urlencoding::encode(&app_id),
        urlencoding::encode(&config.redirect_uri),
        urlencoding::encode(&state),
        urlencoding::encode(&scopes)
    );

    Ok(MetaOAuthPlan {
        authorization_url,
        state,
        redirect_uri: config.redirect_uri,
    })
}

pub(crate) fn ensure_local_tls_material(app: &AppHandle) -> Result<(), String> {
    use std::process::Command;
    let mut cert_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    cert_dir.push("certs");
    fs::create_dir_all(&cert_dir).map_err(|e| e.to_string())?;

    // Windows uses a fresh v2 CA/leaf chain instead of the older self-signed leaf.
    let suffix = if cfg!(windows) { "-v2" } else { "" };
    let ca_key = cert_dir.join("ca.key");
    let ca_crt = cert_dir.join(format!("ca{suffix}.crt"));
    let server_key = cert_dir.join(format!("localhost{suffix}.key"));
    let server_crt = cert_dir.join(format!("localhost{suffix}.crt"));
    let csr = cert_dir.join("localhost.csr");
    let config = cert_dir.join("localhost.cnf");

    #[cfg(windows)]
    if !(ca_crt.exists() && server_key.exists() && server_crt.exists()) {
        let certs = crate::tls_cert::generate_local_cert_bundle()?;
        // CA signing key remains only in memory; never write it to disk.
        fs::write(&ca_crt, certs.ca_pem).map_err(|e| format!("Cannot save OAuth local CA: {e}"))?;
        fs::write(&server_crt, certs.server_pem).map_err(|e| format!("Cannot save OAuth server certificate: {e}"))?;
        fs::write(&server_key, certs.server_key_pem).map_err(|e| format!("Cannot save OAuth server key: {e}"))?;
    }

    #[cfg(not(windows))]
    if !(ca_key.exists() && ca_crt.exists() && server_key.exists() && server_crt.exists()) {
        fs::write(
            &config,
            "[req]\ndistinguished_name=req_dn\nreq_extensions=req_ext\nprompt=no\n[req_dn]\nCN=localhost\n[req_ext]\nsubjectAltName=@alt_names\n[alt_names]\nDNS.1=localhost\nIP.1=127.0.0.1\n",
        )
        .map_err(|e| e.to_string())?;

        let run = |args: &[&str]| -> Result<(), String> {
            let status = Command::new("openssl")
                .args(args)
                .status()
                .map_err(|e| format!("Unable to run openssl: {e}"))?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("openssl failed with status {status}"))
            }
        };

        run(&["genrsa", "-out", ca_key.to_str().unwrap(), "2048"])?;
        run(&[
            "req",
            "-x509",
            "-new",
            "-nodes",
            "-key",
            ca_key.to_str().unwrap(),
            "-sha256",
            "-days",
            "3650",
            "-subj",
            "/CN=Meta Manager Local CA",
            "-out",
            ca_crt.to_str().unwrap(),
        ])?;
        run(&["genrsa", "-out", server_key.to_str().unwrap(), "2048"])?;
        run(&[
            "req",
            "-new",
            "-key",
            server_key.to_str().unwrap(),
            "-out",
            csr.to_str().unwrap(),
            "-config",
            config.to_str().unwrap(),
        ])?;
        run(&[
            "x509",
            "-req",
            "-in",
            csr.to_str().unwrap(),
            "-CA",
            ca_crt.to_str().unwrap(),
            "-CAkey",
            ca_key.to_str().unwrap(),
            "-CAcreateserial",
            "-out",
            server_crt.to_str().unwrap(),
            "-days",
            "825",
            "-sha256",
            "-extensions",
            "req_ext",
            "-extfile",
            config.to_str().unwrap(),
        ])?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for key in [&ca_key, &server_key] {
                let mut permissions = fs::metadata(key).map_err(|e| e.to_string())?.permissions();
                permissions.set_mode(0o600);
                fs::set_permissions(key, permissions).map_err(|e| e.to_string())?;
            }
        }
    }

    #[cfg(windows)]
    {
        // Chrome/Edge use the Windows certificate store. CurrentUser avoids an admin requirement.
        let mut cert_process = Command::new("certutil")
            .args(["-user", "-addstore", "-f", "Root", ca_crt.to_str().unwrap_or_default()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Windows local OAuth certificate trust could not be configured: {e}"))?;
        let started = std::time::Instant::now();
        let status = loop {
            match cert_process.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if started.elapsed() < std::time::Duration::from_secs(15) => {
                    std::thread::sleep(std::time::Duration::from_millis(120));
                }
                Ok(None) => {
                    let _ = cert_process.kill();
                    let _ = cert_process.wait();
                    return Err("Windows localhost certificate approval timed out. Check for a Windows Security confirmation dialog and retry the Facebook/Instagram login.".into());
                }
                Err(error) => return Err(format!("Unable to check Windows certificate import: {error}")),
            }
        };
        if !status.success() {
            return Err(format!(
                "Windows could not trust the Meta Manager localhost certificate (certutil exit: {status}). Check Windows certificate policies before connecting Facebook or Instagram."
            ));
        }
    }

    #[cfg(not(windows))]
    // Best-effort trust for Chromium/Chrome NSS store. Failure here should not stop the app.
    if let Some(home) = std::env::var_os("HOME") {
        let nss = std::path::PathBuf::from(home).join(".pki").join("nssdb");
        let _ = fs::create_dir_all(&nss);
        if !nss.join("cert9.db").exists() && !nss.join("key4.db").exists() {
            let _ = Command::new("certutil")
                .args([
                    "-N",
                    "-d",
                    &format!("sql:{}", nss.display()),
                    "--empty-password",
                ])
                .status();
        }
        let _ = Command::new("certutil")
            .args([
                "-D",
                "-d",
                &format!("sql:{}", nss.display()),
                "-n",
                "Meta Manager Local CA",
            ])
            .status();
        let _ = Command::new("certutil")
            .args([
                "-A",
                "-d",
                &format!("sql:{}", nss.display()),
                "-n",
                "Meta Manager Local CA",
                "-t",
                "C,,",
                "-i",
                ca_crt.to_str().unwrap_or_default(),
            ])
            .status();
    }

    Ok(())
}

pub(crate) fn tls_config(app: &AppHandle) -> Result<Arc<rustls::ServerConfig>, String> {
    let mut cert_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    cert_dir.push("certs");
    let suffix = if cfg!(windows) { "-v2" } else { "" };
    let cert_path = cert_dir.join(format!("localhost{suffix}.crt"));
    let key_path = cert_dir.join(format!("localhost{suffix}.key"));

    let cert_file =
        fs::File::open(cert_path).map_err(|e| format!("Local TLS certificate missing: {e}"))?;
    let mut cert_reader = BufReader::new(cert_file);
    let certs = rustls_pemfile::certs(&mut cert_reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let key_file = fs::File::open(key_path).map_err(|e| format!("Local TLS key missing: {e}"))?;
    let mut key_reader = BufReader::new(key_file);
    let key = rustls_pemfile::private_key(&mut key_reader)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Local TLS private key could not be read".to_string())?;

    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| e.to_string())?;
    Ok(Arc::new(config))
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn start_callback_server(app: AppHandle, generation: u64) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:38937").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let config = tls_config(&app)?;

    thread::spawn(move || {
        let started = std::time::Instant::now();
        loop {
            if !crate::oauth::is_current(generation) || started.elapsed() > std::time::Duration::from_secs(600) {
                if crate::oauth::is_current(generation) {
                    crate::oauth::cancel_attempt();
                    let _ = app.emit("meta-oauth-error", "Meta login expired. You can try again.".to_string());
                }
                break;
            }
            let accepted = listener.accept();
            let (tcp, _) = match accepted {
                Ok(pair) => pair,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(120));
                    continue;
                }
                Err(_) => break,
            };
            let _ = tcp.set_read_timeout(Some(std::time::Duration::from_secs(6)));
            let conn = match rustls::ServerConnection::new(config.clone()) {
                Ok(conn) => conn,
                Err(error) => {
                    let _ = app.emit("meta-oauth-error", error.to_string());
                    continue;
                }
            };
            let mut stream = rustls::StreamOwned::new(conn, tcp);
            let mut request_bytes = [0u8; 16384];
            let read = match stream.read(&mut request_bytes) {
                Ok(read) => read,
                Err(error) => {
                    let _ = app.emit("meta-oauth-error", error.to_string());
                    continue;
                }
            };
            let request_text = String::from_utf8_lossy(&request_bytes[..read]);
            let request_target = request_text
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("/");
            if read == 0 { continue; }
            let request_url = format!("https://127.0.0.1:38937{request_target}");
            let parsed = Url::parse(&request_url);
            if parsed.as_ref().map_or(true, |url| !crate::oauth::is_callback_path(url, "/oauth/meta/callback")) {
                let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(response.as_bytes());
                continue;
            }

            let result = match parsed {
                Ok(url) => {
                    let code = url
                        .query_pairs()
                        .find(|(key, _)| key == "code")
                        .map(|(_, value)| value.into_owned());
                    let state = url
                        .query_pairs()
                        .find(|(key, _)| key == "state")
                        .map(|(_, value)| value.into_owned());
                    let error = url
                        .query_pairs()
                        .find(|(key, _)| key == "error_description" || key == "error")
                        .map(|(_, value)| value.into_owned());
                    if let Some(error) = error {
                        Err(error)
                    } else {
                        complete_oauth(&app, code, state)
                    }
                }
                Err(error) => Err(error.to_string()),
            };

            let (title, body) = match &result {
                Ok(output) => (
                    "Meta Manager connected",
                    format!(
                        "Connected {} social workspace(s). You can close this browser tab.",
                        output.accounts.len()
                    ),
                ),
                Err(error) => (
                    "Meta Manager connection failed",
                    format!(
                        "Connection failed: {}. You can close this browser tab and return to Meta Manager.",
                        html_escape(error)
                    ),
                ),
            };

            let html = format!(
                "<!doctype html><html><head><meta charset='utf-8'><title>{title}</title><style>body{{font-family:system-ui;background:#f6f8fc;color:#17213b;display:grid;place-items:center;min-height:100vh;margin:0}}main{{background:white;border:1px solid #e7ebf3;border-radius:22px;padding:32px;max-width:560px;box-shadow:0 20px 60px #20305018}}h1{{margin-top:0}}p{{line-height:1.55;color:#6f7b91}}</style></head><body><main><h1>{title}</h1><p>{body}</p></main></body></html>"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.as_bytes().len(),
                html
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();

            match result {
                Ok(output) => {
                    let _ = app.emit("meta-oauth-complete", output);
                }
                Err(error) => {
                    crate::oauth::record_failure(&app, "facebook", &error);
                    let _ = app.emit("meta-oauth-error", error);
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
) -> Result<OAuthResult, String> {
    let code = code.ok_or_else(|| "Meta did not return an authorization code".to_string())?;
    let state = state.ok_or_else(|| "Meta did not return OAuth state".to_string())?;
    let expected_state = db::get_setting(app, "meta_oauth_state")?
        .ok_or_else(|| "OAuth state was not initialized".to_string())?;

    if state != expected_state {
        return Err("OAuth state mismatch".into());
    }

    let config = get_config_status(app)?;
    let app_id = config
        .app_id
        .ok_or_else(|| "Missing Meta App ID".to_string())?;
    let token: TokenResponse = ureq::post(OAUTH_BROKER_URL)
        .timeout(std::time::Duration::from_secs(15))
        .send_json(ureq::json!({
            "provider": "meta",
            "code": code,
            "redirectUri": config.redirect_uri
        }))
        .map_err(|e| crate::oauth::broker_failure("Facebook", e))?
        .into_json()
        .map_err(|e| format!("Meta broker returned an invalid token response: {e}"))?;

    save_secret(app, "meta_user_access_token", &token.access_token)?;

    let mode = db::get_setting(app, "meta_oauth_mode")?.unwrap_or_else(|| "all".to_string());
    discover_accounts(app, &config.api_version, &token.access_token, &mode)
}

fn fetch_paginated_data(initial_url: &str) -> Result<Vec<serde_json::Value>, String> {
    let mut rows = Vec::new();
    let mut next = Some(initial_url.to_string());
    let mut seen_urls = std::collections::HashSet::new();

    while let Some(url) = next.take() {
        if !seen_urls.insert(url.clone()) {
            break;
        }
        let json: serde_json::Value = ureq::get(&url)
            .call()
            .map_err(|_| "Meta request failed".to_string())?
            .into_json()
            .map_err(|e| e.to_string())?;

        if let Some(data) = json.get("data").and_then(|value| value.as_array()) {
            rows.extend(data.iter().cloned());
        }
        next = json
            .get("paging")
            .and_then(|value| value.get("next"))
            .and_then(|value| value.as_str())
            .map(str::to_string);
    }
    Ok(rows)
}

fn hydrate_page(api_version: &str, user_token: &str, row: &serde_json::Value) -> serde_json::Value {
    if row.get("access_token").and_then(|v| v.as_str()).is_some() {
        return row.clone();
    }
    let Some(page_id) = row.get("id").and_then(|v| v.as_str()) else {
        return row.clone();
    };
    let fields = "id,name,access_token,instagram_business_account{id,username,name}";
    let url = format!(
        "https://graph.facebook.com/{}/{page_id}?fields={}&access_token={}",
        api_version,
        urlencoding::encode(fields),
        urlencoding::encode(user_token)
    );
    fetch_json(&url).unwrap_or_else(|_| row.clone())
}

fn add_discovered_page(
    app: &AppHandle,
    api_version: &str,
    user_token: &str,
    row: &serde_json::Value,
    seen_pages: &mut std::collections::HashSet<String>,
    accounts: &mut Vec<DiscoveredMetaAccount>,
    mode: &str,
) -> Result<(), String> {
    let row = hydrate_page(api_version, user_token, row);
    let page_id = row
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    if page_id.is_empty() || !seen_pages.insert(page_id.clone()) {
        return Ok(());
    }

    let name = row
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("Facebook Page")
        .to_string();
    let page_token = row
        .get("access_token")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    if !page_token.is_empty() {
        save_secret(app, &format!("meta_page_token_{page_id}"), &page_token)?;
    }

    let ig = row.get("instagram_business_account");
    let instagram_account_id = ig
        .and_then(|value| value.get("id"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let instagram_username = ig
        .and_then(|value| value.get("username"))
        .and_then(|value| value.as_str())
        .map(str::to_string);

    if mode == "instagram" && instagram_account_id.is_none() {
        return Ok(());
    }
    let stored_ig = if mode == "facebook" { None } else { instagram_account_id.as_deref() };
    db::upsert_meta_account(app, &name, Some(&page_id), stored_ig)?;
    accounts.push(DiscoveredMetaAccount {
        name,
        facebook_page_id: page_id,
        instagram_account_id: if mode == "facebook" { None } else { instagram_account_id },
        instagram_username: if mode == "facebook" { None } else { instagram_username },
    });
    Ok(())
}

fn discover_accounts(
    app: &AppHandle,
    api_version: &str,
    user_token: &str,
    mode: &str,
) -> Result<OAuthResult, String> {
    let fields = "id,name,access_token,instagram_business_account{id,username,name}";
    let accounts_url = format!(
        "https://graph.facebook.com/{}/me/accounts?fields={}&limit=100&access_token={}",
        api_version,
        urlencoding::encode(fields),
        urlencoding::encode(user_token)
    );

    let mut accounts = Vec::new();
    let mut seen_pages = std::collections::HashSet::new();

    // Direct Page access, including every pagination page.
    for row in fetch_paginated_data(&accounts_url)? {
        add_discovered_page(
            app,
            api_version,
            user_token,
            &row,
            &mut seen_pages,
            &mut accounts,
            mode,
        )?;
    }

    // Business Portfolio assets are a second discovery path. This is best-effort:
    // tokens without business_management still keep the direct Page results above.
    let businesses_url = format!(
        "https://graph.facebook.com/{}/me/businesses?fields=id,name&limit=100&access_token={}",
        api_version,
        urlencoding::encode(user_token)
    );
    let mut business_status = String::from("not-checked");
    match fetch_paginated_data(&businesses_url) {
        Ok(businesses) => {
            business_status = format!("ok:{}", businesses.len());
            for business in businesses {
                let Some(business_id) = business.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                for edge in ["owned_pages", "client_pages"] {
                    let url = format!(
                        "https://graph.facebook.com/{}/{business_id}/{edge}?fields={}&limit=100&access_token={}",
                        api_version,
                        urlencoding::encode(fields),
                        urlencoding::encode(user_token)
                    );
                    if let Ok(rows) = fetch_paginated_data(&url) {
                        for row in rows {
                            add_discovered_page(
                                app,
                                api_version,
                                user_token,
                                &row,
                                &mut seen_pages,
                                &mut accounts,
                                mode,
                            )?;
                        }
                    }
                }
            }
        }
        Err(error) => {
            business_status = format!("error:{error}");
        }
    }
    db::set_setting(app, "meta_business_discovery_status", &business_status)?;
    db::set_setting(
        app,
        "meta_discovered_account_count",
        &accounts.len().to_string(),
    )?;

    let permissions_url = format!(
        "https://graph.facebook.com/{}/me/permissions?access_token={}",
        api_version,
        urlencoding::encode(user_token)
    );
    if let Ok(json) = fetch_json(&permissions_url) {
        if let Some(rows) = json.get("data").and_then(|v| v.as_array()) {
            let granted = rows
                .iter()
                .filter(|row| row.get("status").and_then(|v| v.as_str()) == Some("granted"))
                .filter_map(|row| row.get("permission").and_then(|v| v.as_str()))
                .collect::<Vec<_>>()
                .join(",");
            db::set_setting(app, "meta_granted_permissions", &granted)?;
        }
    }

    db::set_setting(
        app,
        "meta_last_connected_at",
        &chrono::Utc::now().to_rfc3339(),
    )?;

    Ok(OAuthResult {
        message: format!("Connected {} {} account(s)", accounts.len(), if mode == "instagram" { "Instagram" } else if mode == "facebook" { "Facebook" } else { "Meta" }),
        accounts,
    })
}

pub fn refresh_accounts(app: &AppHandle) -> Result<OAuthResult, String> {
    let config = get_config_status(app)?;
    let user_token = load_secret(app, "meta_user_access_token")?;
    discover_accounts(app, &config.api_version, &user_token, "all")
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LivePost {
    pub id: String,
    pub platform: String,
    pub caption: String,
    pub created_at: String,
    pub media_url: Option<String>,
    pub permalink_url: Option<String>,
    pub likes: i64,
    pub comments: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveWorkspace {
    pub account_id: String,
    pub name: String,
    pub facebook_page_id: Option<String>,
    pub facebook_followers: i64,
    pub facebook_picture_url: Option<String>,
    pub instagram_account_id: Option<String>,
    pub instagram_username: Option<String>,
    pub instagram_followers: i64,
    pub instagram_media_count: i64,
    pub instagram_picture_url: Option<String>,
    pub recent_posts: Vec<LivePost>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveDashboard {
    pub connected_pages: usize,
    pub connected_instagram: usize,
    pub facebook_followers: i64,
    pub instagram_followers: i64,
    pub recent_posts: Vec<LivePost>,
    pub workspaces: Vec<LiveWorkspace>,
}

fn get_i64(value: Option<&serde_json::Value>) -> i64 {
    value.and_then(|v| v.as_i64()).unwrap_or(0)
}

fn summary_total(value: Option<&serde_json::Value>) -> i64 {
    value
        .and_then(|v| v.get("summary"))
        .and_then(|v| v.get("total_count"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
}

fn fetch_json(url: &str) -> Result<serde_json::Value, String> {
    let response = ureq::get(url)
        .timeout(std::time::Duration::from_secs(6))
        .call()
        .map_err(|e| e.to_string())?;
    response.into_json().map_err(|e| e.to_string())
}

// Direct Instagram Login uses graph.instagram.com and does not have a
// Facebook Page token. Do not report these independently connected accounts
// as "disconnected" just because facebook_page_id is None.
fn fetch_json_bearer(url: &str, token: &str) -> Result<serde_json::Value, String> {
    let response = ureq::get(url)
        .timeout(std::time::Duration::from_secs(12))
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|error| format!("Instagram API request failed: {}", match error {
            ureq::Error::Status(code, _) => format!("HTTP {code}"),
            _ => "network unavailable".into(),
        }))?;
    response.into_json().map_err(|_| "Instagram returned invalid JSON".into())
}

fn instagram_post(row: &serde_json::Value) -> LivePost {
    LivePost {
        id: row.get("id").and_then(|v| v.as_str()).unwrap_or("").into(),
        platform: "instagram".into(),
        caption: row.get("caption").and_then(|v| v.as_str()).unwrap_or("Instagram post").into(),
        created_at: row.get("timestamp").and_then(|v| v.as_str()).unwrap_or("").into(),
        media_url: row.get("thumbnail_url").and_then(|v| v.as_str())
            .or_else(|| row.get("media_url").and_then(|v| v.as_str())).map(str::to_string),
        permalink_url: row.get("permalink").and_then(|v| v.as_str()).map(str::to_string),
        likes: get_i64(row.get("like_count")),
        comments: get_i64(row.get("comments_count")),
    }
}

fn fetch_direct_instagram_posts(token: &str, max_posts: usize) -> Result<Vec<LivePost>, String> {
    let fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
    let mut url = Some(format!(
        "https://graph.instagram.com/me/media?fields={}&limit={}",
        urlencoding::encode(fields), max_posts.clamp(1, 100)
    ));
    let mut results = Vec::new();
    let mut pages = 0;
    while let Some(next) = url.take() {
        if results.len() >= max_posts || pages >= 8 { break; }
        let parsed = url::Url::parse(&next).map_err(|_| "Invalid Instagram pagination".to_string())?;
        if parsed.scheme() != "https" || parsed.host_str() != Some("graph.instagram.com") {
            return Err("Instagram pagination returned an unexpected endpoint".into());
        }
        let data = fetch_json_bearer(&next, token)?;
        if let Some(rows) = data.get("data").and_then(|v| v.as_array()) {
            for row in rows {
                results.push(instagram_post(row));
                if results.len() >= max_posts { break; }
            }
        }
        url = data.get("paging").and_then(|v| v.get("next"))
            .and_then(|v| v.as_str()).map(str::to_string);
        pages += 1;
    }
    Ok(results)
}

fn load_direct_instagram_workspace(app: &AppHandle, account: &crate::db::Account, ig_id: &str) -> LiveWorkspace {
    let mut workspace = LiveWorkspace {
        account_id: account.id.clone(),
        name: account.name.clone(),
        facebook_page_id: None,
        facebook_followers: 0,
        facebook_picture_url: None,
        instagram_account_id: Some(ig_id.into()),
        instagram_username: None,
        instagram_followers: 0,
        instagram_media_count: 0,
        instagram_picture_url: None,
        recent_posts: vec![],
        status: "connected".into(),
        error: None,
    };
    let token = match load_secret(app, &format!("instagram_direct_token_{ig_id}")) {
        Ok(token) => token,
        Err(_) => {
            workspace.status = "token_error".into();
            workspace.error = Some("Instagram login expired. Reconnect Instagram to refresh access.".into());
            return workspace;
        }
    };
    match fetch_json_bearer(
        "https://graph.instagram.com/me?fields=id,username,name,followers_count,media_count,profile_picture_url",
        &token
    ) {
        Ok(profile) => {
            workspace.instagram_username = profile.get("username").and_then(|v| v.as_str()).map(str::to_string);
            workspace.instagram_followers = get_i64(profile.get("followers_count"));
            workspace.instagram_media_count = get_i64(profile.get("media_count"));
            workspace.instagram_picture_url = profile.get("profile_picture_url").and_then(|v| v.as_str()).map(str::to_string);
        }
        Err(error) => {
            workspace.status = "sync_error".into();
            workspace.error = Some(error);
            return workspace;
        }
    };
    match fetch_direct_instagram_posts(&token, 12) {
        Ok(posts) => workspace.recent_posts = posts,
        Err(error) => workspace.error = Some(format!("Profile connected, but recent media could not be loaded: {error}")),
    }
    workspace
}

fn load_live_workspace(
    app: &AppHandle,
    api_version: &str,
    account: &crate::db::Account,
) -> LiveWorkspace {
    let mut workspace = LiveWorkspace {
        account_id: account.id.clone(),
        name: account.name.clone(),
        facebook_page_id: account.facebook_page_id.clone(),
        facebook_followers: 0,
        facebook_picture_url: None,
        instagram_account_id: account.instagram_account_id.clone(),
        instagram_username: None,
        instagram_followers: 0,
        instagram_media_count: 0,
        instagram_picture_url: None,
        recent_posts: Vec::new(),
        status: "connected".into(),
        error: None,
    };

    let Some(page_id) = account.facebook_page_id.as_deref() else {
        if let Some(ig_id) = account.instagram_account_id.as_deref() {
            return load_direct_instagram_workspace(app, account, ig_id);
        }
        workspace.status = "disconnected".into();
        workspace.error = Some("No connected Facebook Page or Instagram login for this workspace".into());
        return workspace;
    };

    let token = match load_secret(app, &format!("meta_page_token_{page_id}")) {
        Ok(token) => token,
        Err(error) => {
            workspace.status = "token_error".into();
            workspace.error = Some(error);
            return workspace;
        }
    };

    let page_fields = "id,name,followers_count,fan_count,picture{url},instagram_business_account{id,username,followers_count,media_count,profile_picture_url}";
    let page_url = format!(
        "https://graph.facebook.com/{}/{page_id}?fields={}&access_token={}",
        api_version,
        urlencoding::encode(page_fields),
        urlencoding::encode(&token)
    );

    match fetch_json(&page_url) {
        Ok(page) => {
            workspace.name = page
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&workspace.name)
                .to_string();
            workspace.facebook_followers =
                get_i64(page.get("followers_count")).max(get_i64(page.get("fan_count")));
            workspace.facebook_picture_url = page
                .get("picture")
                .and_then(|v| v.get("data"))
                .and_then(|v| v.get("url"))
                .and_then(|v| v.as_str())
                .map(str::to_string);

            if let Some(ig) = page.get("instagram_business_account") {
                workspace.instagram_account_id = ig
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .or_else(|| workspace.instagram_account_id.clone());
                workspace.instagram_username = ig
                    .get("username")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                workspace.instagram_followers = get_i64(ig.get("followers_count"));
                workspace.instagram_media_count = get_i64(ig.get("media_count"));
                workspace.instagram_picture_url = ig
                    .get("profile_picture_url")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            }
        }
        Err(error) => {
            workspace.status = "sync_error".into();
            workspace.error = Some(error);
        }
    }

    let fb_fields = "id,message,created_time,permalink_url,full_picture,shares,comments.limit(0).summary(true),likes.limit(0).summary(true)";
    let fb_url = format!(
        "https://graph.facebook.com/{}/{page_id}/posts?fields={}&limit=6&access_token={}",
        api_version,
        urlencoding::encode(fb_fields),
        urlencoding::encode(&token)
    );

    if let Ok(feed) = fetch_json(&fb_url) {
        if let Some(rows) = feed.get("data").and_then(|v| v.as_array()) {
            for row in rows {
                workspace.recent_posts.push(LivePost {
                    id: row
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    platform: "facebook".into(),
                    caption: row
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Facebook post")
                        .to_string(),
                    created_at: row
                        .get("created_time")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    media_url: row
                        .get("full_picture")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    permalink_url: row
                        .get("permalink_url")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    likes: summary_total(row.get("likes")),
                    comments: summary_total(row.get("comments")),
                });
            }
        }
    }

    if let Some(ig_id) = workspace.instagram_account_id.as_deref() {
        let ig_fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
        let ig_url = format!(
            "https://graph.facebook.com/{}/{ig_id}/media?fields={}&limit=6&access_token={}",
            api_version,
            urlencoding::encode(ig_fields),
            urlencoding::encode(&token)
        );

        if let Ok(media) = fetch_json(&ig_url) {
            if let Some(rows) = media.get("data").and_then(|v| v.as_array()) {
                for row in rows {
                    let media_url = row
                        .get("thumbnail_url")
                        .and_then(|v| v.as_str())
                        .or_else(|| row.get("media_url").and_then(|v| v.as_str()))
                        .map(str::to_string);

                    workspace.recent_posts.push(LivePost {
                        id: row
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        platform: "instagram".into(),
                        caption: row
                            .get("caption")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Instagram post")
                            .to_string(),
                        created_at: row
                            .get("timestamp")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        media_url,
                        permalink_url: row
                            .get("permalink")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                        likes: get_i64(row.get("like_count")),
                        comments: get_i64(row.get("comments_count")),
                    });
                }
            }
        }
    }

    workspace
        .recent_posts
        .sort_by(|a, b| b.created_at.cmp(&a.created_at));
    workspace.recent_posts.truncate(8);
    workspace
}

pub fn get_live_dashboard(
    app: &AppHandle,
    account_id: Option<String>,
) -> Result<LiveDashboard, String> {
    let config = get_config_status(app)?;
    let accounts = crate::db::list_accounts(app)?;

    let selected: Vec<_> = accounts
        .into_iter()
        .filter(|account| {
            account.status == "connected"
                && account_id
                    .as_deref()
                    .map(|id| account.id == id)
                    .unwrap_or(true)
        })
        .collect();

    let shared = std::sync::Arc::new(std::sync::Mutex::new(Vec::<LiveWorkspace>::new()));
    let app_owned = app.clone();
    let version = config.api_version.clone();
    std::thread::scope(|scope| {
        for chunk in selected.chunks(3) {
            let chunk = chunk.to_vec();
            let shared = shared.clone();
            let app = app_owned.clone();
            let version = version.clone();
            scope.spawn(move || {
                let local: Vec<LiveWorkspace> = chunk
                    .iter()
                    .map(|account| load_live_workspace(&app, &version, account))
                    .collect();
                if let Ok(mut guard) = shared.lock() {
                    guard.extend(local);
                }
            });
        }
    });
    let mut workspaces = shared
        .lock()
        .map_err(|_| "Workspace sync lock failed".to_string())?
        .clone();
    workspaces.sort_by(|a, b| a.name.cmp(&b.name));

    let connected_pages = workspaces
        .iter()
        .filter(|workspace| workspace.facebook_page_id.is_some())
        .count();
    let connected_instagram = workspaces
        .iter()
        .filter(|workspace| workspace.instagram_account_id.is_some())
        .count();
    let facebook_followers = workspaces
        .iter()
        .map(|workspace| workspace.facebook_followers)
        .sum();
    let instagram_followers = workspaces
        .iter()
        .map(|workspace| workspace.instagram_followers)
        .sum();

    let mut recent_posts: Vec<LivePost> = workspaces
        .iter()
        .flat_map(|workspace| workspace.recent_posts.clone())
        .collect();
    recent_posts.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    recent_posts.truncate(12);

    Ok(LiveDashboard {
        connected_pages,
        connected_instagram,
        facebook_followers,
        instagram_followers,
        recent_posts,
        workspaces,
    })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaLibrary {
    pub items: Vec<LivePost>,
    pub total: usize,
    pub requested_limit: usize,
}

fn fetch_paginated_limited(
    initial_url: &str,
    max_items: usize,
) -> Result<Vec<serde_json::Value>, String> {
    let mut rows = Vec::new();
    let mut next = Some(initial_url.to_string());
    let mut seen = std::collections::HashSet::new();
    while let Some(url) = next.take() {
        if rows.len() >= max_items || !seen.insert(url.clone()) {
            break;
        }
        let json = fetch_json(&url)?;
        if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
            for row in data {
                rows.push(row.clone());
                if rows.len() >= max_items {
                    break;
                }
            }
        }
        next = json
            .get("paging")
            .and_then(|v| v.get("next"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
    }
    Ok(rows)
}

fn media_for_account(
    app: &AppHandle,
    api_version: &str,
    account: &crate::db::Account,
    per_account: usize,
    include_uploaded_photos: bool,
) -> Vec<LivePost> {
    let mut items = Vec::new();
    let Some(page_id) = account.facebook_page_id.as_deref() else {
        if let Some(ig_id) = account.instagram_account_id.as_deref() {
            if let Ok(token) = load_secret(app, &format!("instagram_direct_token_{ig_id}")) {
                return fetch_direct_instagram_posts(&token, per_account).unwrap_or_default()
                    .into_iter().filter(|post| post.media_url.is_some()).collect();
            }
        }
        return items;
    };
    let Ok(token) = load_secret(app, &format!("meta_page_token_{page_id}")) else {
        return items;
    };

    let fb_fields = "id,message,created_time,permalink_url,full_picture,comments.limit(0).summary(true),likes.limit(0).summary(true)";
    let fb_url = format!(
        "https://graph.facebook.com/{}/{page_id}/posts?fields={}&limit=25&access_token={}",
        api_version,
        urlencoding::encode(fb_fields),
        urlencoding::encode(&token)
    );
    if let Ok(rows) = fetch_paginated_limited(&fb_url, per_account) {
        for row in rows {
            let media_url = row
                .get("full_picture")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if media_url.is_none() {
                continue;
            }
            items.push(LivePost {
                id: row
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                platform: "facebook".into(),
                caption: row
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Facebook media")
                    .to_string(),
                created_at: row
                    .get("created_time")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                media_url,
                permalink_url: row
                    .get("permalink_url")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                likes: summary_total(row.get("likes")),
                comments: summary_total(row.get("comments")),
            });
        }
    }

    if include_uploaded_photos {
        // Uploaded Page photos catch media that may not be represented by the small posts sample.
        let photo_fields = "id,name,created_time,link,images";
        let photo_url = format!(
            "https://graph.facebook.com/{}/{page_id}/photos?type=uploaded&fields={}&limit=25&access_token={}",
            api_version,
            urlencoding::encode(photo_fields),
            urlencoding::encode(&token)
        );
        if let Ok(rows) = fetch_paginated_limited(&photo_url, per_account) {
            for row in rows {
                let media_url = row
                    .get("images")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                    .and_then(|v| v.get("source"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                if media_url.is_none() {
                    continue;
                }
                items.push(LivePost {
                    id: row
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    platform: "facebook".into(),
                    caption: row
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Facebook photo")
                        .to_string(),
                    created_at: row
                        .get("created_time")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    media_url,
                    permalink_url: row.get("link").and_then(|v| v.as_str()).map(str::to_string),
                    likes: 0,
                    comments: 0,
                });
            }
        }
    }

    if let Some(ig_id) = account.instagram_account_id.as_deref() {
        let ig_fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
        let ig_url = format!(
            "https://graph.facebook.com/{}/{ig_id}/media?fields={}&limit=25&access_token={}",
            api_version,
            urlencoding::encode(ig_fields),
            urlencoding::encode(&token)
        );
        if let Ok(rows) = fetch_paginated_limited(&ig_url, per_account.saturating_mul(2)) {
            for row in rows {
                let media_url = row
                    .get("thumbnail_url")
                    .and_then(|v| v.as_str())
                    .or_else(|| row.get("media_url").and_then(|v| v.as_str()))
                    .map(str::to_string);
                if media_url.is_none() {
                    continue;
                }
                items.push(LivePost {
                    id: row
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    platform: "instagram".into(),
                    caption: row
                        .get("caption")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Instagram media")
                        .to_string(),
                    created_at: row
                        .get("timestamp")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    media_url,
                    permalink_url: row
                        .get("permalink")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    likes: get_i64(row.get("like_count")),
                    comments: get_i64(row.get("comments_count")),
                });
            }
        }
    }
    items
}

pub fn get_media_library(
    app: &AppHandle,
    account_id: Option<String>,
    limit: Option<usize>,
) -> Result<MediaLibrary, String> {
    let limit = limit.unwrap_or(80).clamp(12, 200);
    let config = get_config_status(app)?;
    let accounts = crate::db::list_accounts(app)?;
    let selected: Vec<_> = accounts
        .into_iter()
        .filter(|account| {
            account.status == "connected"
                && account_id
                    .as_deref()
                    .map(|id| account.id == id)
                    .unwrap_or(true)
        })
        .collect();
    let per_account = ((limit + selected.len().saturating_sub(1)) / selected.len().max(1)).max(3);
    let shared = std::sync::Arc::new(std::sync::Mutex::new(Vec::<LivePost>::new()));
    let app_owned = app.clone();
    let version = config.api_version.clone();

    let include_uploaded_photos = account_id.is_some();
    std::thread::scope(|scope| {
        for account in selected {
            let shared = shared.clone();
            let app = app_owned.clone();
            let version = version.clone();
            scope.spawn(move || {
                let local = media_for_account(
                    &app,
                    &version,
                    &account,
                    per_account,
                    include_uploaded_photos,
                );
                if let Ok(mut guard) = shared.lock() {
                    guard.extend(local);
                }
            });
        }
    });

    let mut items = shared
        .lock()
        .map_err(|_| "Media sync lock failed".to_string())?
        .clone();
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let mut seen = std::collections::HashSet::new();
    items.retain(|item| {
        item.media_url
            .as_ref()
            .map(|url| seen.insert(url.clone()))
            .unwrap_or(false)
    });
    items.truncate(limit);
    let total = items.len();
    Ok(MediaLibrary {
        items,
        total,
        requested_limit: limit,
    })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResearchResult {
    pub query: String,
    pub normalized_hashtag: String,
    pub source_account_name: String,
    pub top_media: Vec<LivePost>,
    pub recent_media: Vec<LivePost>,
    pub related_hashtags: Vec<(String, usize)>,
    pub related_keywords: Vec<(String, usize)>,
    pub note: String,
}

fn public_media_from_rows(rows: Vec<serde_json::Value>) -> Vec<LivePost> {
    rows.into_iter()
        .map(|row| LivePost {
            id: row
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            platform: "instagram".into(),
            caption: row
                .get("caption")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            created_at: row
                .get("timestamp")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            media_url: row
                .get("thumbnail_url")
                .and_then(|v| v.as_str())
                .or_else(|| row.get("media_url").and_then(|v| v.as_str()))
                .map(str::to_string),
            permalink_url: row
                .get("permalink")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            likes: get_i64(row.get("like_count")),
            comments: get_i64(row.get("comments_count")),
        })
        .collect()
}

pub fn research_public_meta(
    app: &AppHandle,
    query: String,
    account_id: Option<String>,
) -> Result<ResearchResult, String> {
    let cleaned = query.trim().trim_start_matches('#');
    if cleaned.is_empty() {
        return Err("Enter a keyword or hashtag".into());
    }
    let normalized = cleaned
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_')
        .collect::<String>()
        .to_lowercase();
    if normalized.is_empty() {
        return Err("That search cannot be converted to an Instagram hashtag".into());
    }
    let config = get_config_status(app)?;
    let accounts = crate::db::list_accounts(app)?;
    let source = accounts
        .into_iter()
        .find(|a| {
            a.status == "connected"
                && a.instagram_account_id.is_some()
                && account_id.as_deref().map(|id| a.id == id).unwrap_or(true)
        })
        .ok_or_else(|| {
            "Select or connect a workspace with an Instagram professional account".to_string()
        })?;
    let page_id = source
        .facebook_page_id
        .as_deref()
        .ok_or_else(|| "Workspace has no Facebook Page token".to_string())?;
    let ig_id = source.instagram_account_id.as_deref().unwrap();
    let token = load_secret(app, &format!("meta_page_token_{page_id}"))?;

    let search_url = format!(
        "https://graph.facebook.com/{}/ig_hashtag_search?user_id={}&q={}&access_token={}",
        config.api_version,
        urlencoding::encode(ig_id),
        urlencoding::encode(&normalized),
        urlencoding::encode(&token)
    );
    let search = fetch_json(&search_url).map_err(|_| "Meta hashtag search is unavailable for this app/account. Instagram Public Content Access may require App Review.".to_string())?;
    let hashtag_id = search
        .get("data")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("No public Instagram hashtag found for #{normalized}"))?;
    let fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
    let top_url = format!(
        "https://graph.facebook.com/{}/{hashtag_id}/top_media?user_id={}&fields={}&limit=25&access_token={}",
        config.api_version,
        urlencoding::encode(ig_id),
        urlencoding::encode(fields),
        urlencoding::encode(&token)
    );
    let recent_url = format!(
        "https://graph.facebook.com/{}/{hashtag_id}/recent_media?user_id={}&fields={}&limit=25&access_token={}",
        config.api_version,
        urlencoding::encode(ig_id),
        urlencoding::encode(fields),
        urlencoding::encode(&token)
    );
    let top_media =
        public_media_from_rows(fetch_paginated_limited(&top_url, 25).unwrap_or_default());
    let recent_media =
        public_media_from_rows(fetch_paginated_limited(&recent_url, 25).unwrap_or_default());

    let mut hashtag_counts = std::collections::HashMap::<String, usize>::new();
    let mut keyword_counts = std::collections::HashMap::<String, usize>::new();
    let stop = [
        "this",
        "that",
        "with",
        "from",
        "have",
        "your",
        "about",
        "there",
        "their",
        "they",
        "what",
        "when",
        "where",
        "will",
        "just",
        "more",
        "some",
        "into",
        "than",
        "then",
        "been",
        "were",
        "them",
        "also",
        "https",
        "instagram",
    ]
    .into_iter()
    .collect::<std::collections::HashSet<_>>();
    for post in top_media.iter().chain(recent_media.iter()) {
        for token in post.caption.split_whitespace() {
            let bare = token
                .trim_matches(|c: char| !c.is_alphanumeric() && c != '#' && c != '_')
                .to_lowercase();
            if let Some(tag) = bare.strip_prefix('#') {
                if tag.len() > 1 && tag != normalized {
                    *hashtag_counts.entry(tag.to_string()).or_insert(0) += 1;
                }
            } else if bare.len() >= 4 && !stop.contains(bare.as_str()) {
                *keyword_counts.entry(bare).or_insert(0) += 1;
            }
        }
    }
    let mut related_hashtags: Vec<_> = hashtag_counts.into_iter().collect();
    related_hashtags.sort_by(|a, b| b.1.cmp(&a.1));
    related_hashtags.truncate(18);
    let mut related_keywords: Vec<_> = keyword_counts.into_iter().collect();
    related_keywords.sort_by(|a, b| b.1.cmp(&a.1));
    related_keywords.truncate(18);

    Ok(ResearchResult {
        query: cleaned.to_string(), normalized_hashtag: normalized, source_account_name: source.name,
        top_media, recent_media, related_hashtags, related_keywords,
        note: "Public Instagram hashtag discovery. Meta limits unique hashtag searches and may require Instagram Public Content Access approval.".into(),
    })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub calendar_item_id: String,
    pub facebook_post_id: Option<String>,
    pub instagram_post_id: Option<String>,
    pub linkedin_post_id: Option<String>,
    pub message: String,
}

fn graph_post_form(url: &str, pairs: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    let response = ureq::post(url)
        .send_form(pairs)
        .map_err(|e| e.to_string())?;
    response.into_json().map_err(|e| e.to_string())
}

fn build_publish_caption(item: &crate::db::CalendarItem) -> String {
    let mut caption = item.caption.clone().unwrap_or_default().trim().to_string();
    if !item.hashtags.is_empty() {
        let tags = item
            .hashtags
            .iter()
            .filter(|tag| !tag.trim().is_empty())
            .map(|tag| format!("#{}", tag.trim().trim_start_matches('#')))
            .collect::<Vec<_>>()
            .join(" ");
        if !tags.is_empty() {
            if !caption.is_empty() {
                caption.push_str("\n\n");
            }
            caption.push_str(&tags);
        }
    }
    caption
}

pub fn publish_calendar_item(app: &AppHandle, item_id: &str) -> Result<PublishResult, String> {
    let item = crate::db::get_calendar_item(app, item_id)?
        .ok_or_else(|| "Calendar item was not found".to_string())?;

    if item.platform == "linkedin" {
        return crate::linkedin::publish_calendar_item(app, item_id);
    }

    let account = crate::db::get_account(app, &item.account_id)?
        .ok_or_else(|| "Workspace was not found".to_string())?;

    let wants_facebook = matches!(item.platform.as_str(), "facebook" | "both");
    let wants_instagram = matches!(item.platform.as_str(), "instagram" | "both");

    if wants_instagram
        && item
            .media_url
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
    {
        return Err(
            "Instagram publishing requires a public HTTPS image URL. Add media before publishing."
                .into(),
        );
    }

    let page_id = account.facebook_page_id.as_deref();
    if wants_facebook && page_id.is_none() {
        return Err("This workspace does not have a Facebook Page ID".to_string());
    }
    let page_token = if let Some(page_id) = page_id {
        Some(load_secret(app, &format!("meta_page_token_{page_id}"))?)
    } else {
        None
    };
    let config = get_config_status(app)?;
    let caption = build_publish_caption(&item);

    crate::db::mark_calendar_publishing(app, item_id)?;

    let result = (|| -> Result<PublishResult, String> {
        // Keep successful destination IDs so retrying a failed multi-platform post
        // does not publish twice to a destination that already succeeded.
        let parts: Vec<&str> = item.published_post_id.as_deref().unwrap_or("").split(';').collect();
        let mut facebook_post_id = parts.iter().find_map(|v| v.strip_prefix("facebook:")).map(str::to_string);
        let mut instagram_post_id = parts.iter().find_map(|v| v.strip_prefix("instagram:")).map(str::to_string);

        // Validate Instagram prerequisites before any platform is published.
        if wants_instagram && account.instagram_account_id.is_none() {
            return Err("This workspace has no linked Instagram professional account".into());
        }

        if wants_facebook && facebook_post_id.is_none() {
            let image = item.media_url.as_deref().map(str::trim).filter(|s| !s.is_empty());
            let url = format!(
                "https://graph.facebook.com/{}/{}/{}",
                config.api_version, page_id.unwrap(), if image.is_some() {"photos"} else {"feed"}
            );
            let mut pairs = vec![
                ("access_token", page_token.as_deref().unwrap()),
            ];
            if let Some(image) = image {
                pairs.push(("url", image));
                pairs.push(("caption", caption.as_str()));
            } else {
                pairs.push(("message", caption.as_str()));
                if let Some(link) = item.link_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    pairs.push(("link", link));
                }
            }
            let response = graph_post_form(&url, &pairs)?;
            facebook_post_id = response
                .get("id")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if facebook_post_id.is_none() {
                return Err(format!("Facebook did not return a post ID: {response}"));
            }
            crate::db::mark_calendar_partial(app, item_id, &format!("facebook:{}", facebook_post_id.as_deref().unwrap()))?;
        }

        if wants_instagram && instagram_post_id.is_none() {
            let ig_id = account.instagram_account_id.as_deref().unwrap();
            let image_url = item.media_url.as_deref().unwrap().trim();
            let direct_secret = format!("instagram_direct_token_{ig_id}");
            let has_direct = has_secret(app, &direct_secret);
            let (create_url, publish_url, ig_token) = if has_direct {
                (
                    format!("https://graph.instagram.com/{ig_id}/media"),
                    format!("https://graph.instagram.com/{ig_id}/media_publish"),
                    load_secret(app, &direct_secret)?,
                )
            } else {
                let page_token = page_token.clone().ok_or_else(|| "This Instagram account has no direct Instagram token and no Facebook Page token. Reconnect Instagram or its linked Facebook Page.".to_string())?;
                (
                    format!("https://graph.facebook.com/{}/{ig_id}/media", config.api_version),
                    format!("https://graph.facebook.com/{}/{ig_id}/media_publish", config.api_version),
                    page_token,
                )
            };
            let created = graph_post_form(
                &create_url,
                &[
                    ("image_url", image_url),
                    ("caption", caption.as_str()),
                    ("access_token", ig_token.as_str()),
                ],
            )?;
            let creation_id = created
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("Instagram did not return a creation ID: {created}"))?;

            // Instagram media creation is asynchronous. Wait until the container is FINISHED.
            let status_endpoint = if has_direct {
                format!("https://graph.instagram.com/{creation_id}")
            } else {
                format!("https://graph.facebook.com/{}/{creation_id}", config.api_version)
            };
            let mut ready = false;
            for _ in 0..20 {
                let status_url = format!(
                    "{status_endpoint}?fields=status_code,status&access_token={}",
                    urlencoding::encode(&ig_token)
                );
                let current: serde_json::Value = ureq::get(&status_url)
                    .timeout(std::time::Duration::from_secs(10))
                    .call()
                    .map_err(|e| format!("Instagram container status failed: {e}"))?
                    .into_json()
                    .map_err(|e| e.to_string())?;
                let code = current["status_code"].as_str().unwrap_or("");
                if code == "FINISHED" { ready = true; break; }
                if code == "ERROR" || code == "EXPIRED" {
                    return Err(format!("Instagram could not process the media: {}", current["status"].as_str().unwrap_or(code)));
                }
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
            if !ready { return Err("Instagram media was not ready after 40 seconds. Check image URL and retry.".into()); }
            let published = graph_post_form(
                &publish_url,
                &[
                    ("creation_id", creation_id),
                    ("access_token", ig_token.as_str()),
                ],
            )?;
            instagram_post_id = published
                .get("id")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if instagram_post_id.is_none() {
                return Err(format!("Instagram did not return a published media ID: {published}"));
            }
            let partial = [facebook_post_id.as_ref().map(|v| format!("facebook:{v}")), instagram_post_id.as_ref().map(|v| format!("instagram:{v}"))]
                .into_iter().flatten().collect::<Vec<_>>().join(";");
            crate::db::mark_calendar_partial(app, item_id, &partial)?;
        }

        let stored_id = match (&facebook_post_id, &instagram_post_id) {
            (Some(fb), Some(ig)) => format!("facebook:{fb};instagram:{ig}"),
            (Some(fb), None) => format!("facebook:{fb}"),
            (None, Some(ig)) => format!("instagram:{ig}"),
            (None, None) => return Err("No platform was selected for publishing".into()),
        };
        crate::db::mark_calendar_published(app, item_id, &stored_id)?;

        Ok(PublishResult {
            calendar_item_id: item_id.to_string(),
            facebook_post_id,
            instagram_post_id,
            linkedin_post_id: None,
            message: "Published successfully".into(),
        })
    })();

    if let Err(error) = &result {
        let _ = crate::db::mark_calendar_failed(app, item_id, error);
    }
    result
}

pub fn start_scheduler(app: AppHandle) {
    thread::spawn(move || {
        loop {
            thread::sleep(std::time::Duration::from_secs(30));
            let due = match crate::db::due_calendar_items(&app) {
                Ok(items) => items,
                Err(_) => continue,
            };
            for item in due {
                let _ = publish_calendar_item(&app, &item.id);
            }
        }
    });
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InsightPoint {
    pub date: String,
    pub value: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InsightSeries {
    pub key: String,
    pub label: String,
    pub platform: String,
    pub total: f64,
    pub points: Vec<InsightPoint>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveInsights {
    pub days: i64,
    pub series: Vec<InsightSeries>,
}

fn fetch_metric_series(
    api_version: &str,
    object_id: &str,
    token: &str,
    metric: &str,
    since: i64,
    until: i64,
) -> Option<Vec<InsightPoint>> {
    let url = format!(
        "https://graph.facebook.com/{}/{object_id}/insights?metric={}&period=day&since={since}&until={until}&access_token={}",
        api_version,
        urlencoding::encode(metric),
        urlencoding::encode(token)
    );
    let json = fetch_json(&url).ok()?;
    let values = json
        .get("data")?
        .as_array()?
        .first()?
        .get("values")?
        .as_array()?;

    let mut points = Vec::new();
    for value in values {
        let number = value
            .get("value")
            .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|n| n as f64)))
            .unwrap_or(0.0);
        let date = value
            .get("end_time")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .chars()
            .take(10)
            .collect::<String>();
        if !date.is_empty() {
            points.push(InsightPoint {
                date,
                value: number,
            });
        }
    }
    Some(points)
}

fn fetch_total_value_metric(
    api_version: &str,
    object_id: &str,
    token: &str,
    metric: &str,
    since: i64,
    until: i64,
) -> Option<Vec<InsightPoint>> {
    let url = format!(
        "https://graph.facebook.com/{}/{object_id}/insights?metric={}&metric_type=total_value&since={since}&until={until}&access_token={}",
        api_version,
        urlencoding::encode(metric),
        urlencoding::encode(token)
    );
    let json = fetch_json(&url).ok()?;
    let value = json
        .get("data")?
        .as_array()?
        .first()?
        .get("total_value")?
        .get("value")?
        .as_f64()
        .or_else(|| {
            json.get("data")?
                .as_array()?
                .first()?
                .get("total_value")?
                .get("value")?
                .as_i64()
                .map(|number| number as f64)
        })?;
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    Some(vec![InsightPoint { date, value }])
}

fn merge_points(target: &mut std::collections::BTreeMap<String, f64>, source: Vec<InsightPoint>) {
    for point in source {
        *target.entry(point.date).or_insert(0.0) += point.value;
    }
}

pub fn get_live_insights(
    app: &AppHandle,
    account_id: Option<String>,
    days: Option<i64>,
) -> Result<LiveInsights, String> {
    let days = days.unwrap_or(28).clamp(1, 90);
    let config = get_config_status(app)?;
    let accounts = crate::db::list_accounts(app)?;
    let selected: Vec<_> = accounts
        .into_iter()
        .filter(|account| {
            account.status == "connected"
                && account_id
                    .as_deref()
                    .map(|id| account.id == id)
                    .unwrap_or(true)
        })
        .collect();

    let until = chrono::Utc::now().timestamp();
    let since = (chrono::Utc::now() - chrono::Duration::days(days)).timestamp();

    let mut fb_reach = std::collections::BTreeMap::new();
    let mut fb_engagement = std::collections::BTreeMap::new();
    let mut ig_reach = std::collections::BTreeMap::new();
    let mut ig_interactions = std::collections::BTreeMap::new();

    for account in selected {
        let Some(page_id) = account.facebook_page_id.as_deref() else {
            continue;
        };
        let Ok(token) = load_secret(app, &format!("meta_page_token_{page_id}")) else {
            continue;
        };

        if let Some(points) = fetch_metric_series(
            &config.api_version,
            page_id,
            &token,
            "page_views_total",
            since,
            until,
        ) {
            merge_points(&mut fb_reach, points);
        }
        if let Some(points) = fetch_metric_series(
            &config.api_version,
            page_id,
            &token,
            "page_post_engagements",
            since,
            until,
        ) {
            merge_points(&mut fb_engagement, points);
        }

        if let Some(ig_id) = account.instagram_account_id.as_deref() {
            if let Some(points) =
                fetch_metric_series(&config.api_version, ig_id, &token, "reach", since, until)
            {
                merge_points(&mut ig_reach, points);
            }
            if let Some(points) = fetch_total_value_metric(
                &config.api_version,
                ig_id,
                &token,
                "total_interactions",
                since,
                until,
            ) {
                merge_points(&mut ig_interactions, points);
            }
        }
    }

    let make_series =
        |key: &str, label: &str, platform: &str, map: std::collections::BTreeMap<String, f64>| {
            let points: Vec<InsightPoint> = map
                .into_iter()
                .map(|(date, value)| InsightPoint { date, value })
                .collect();
            let total = points.iter().map(|point| point.value).sum();
            InsightSeries {
                key: key.into(),
                label: label.into(),
                platform: platform.into(),
                total,
                points,
            }
        };

    let series = vec![
        make_series("facebook_views", "Facebook Views", "facebook", fb_reach),
        make_series(
            "facebook_engagement",
            "Facebook Engagement",
            "facebook",
            fb_engagement,
        ),
        make_series("instagram_reach", "Instagram Reach", "instagram", ig_reach),
        make_series(
            "instagram_interactions",
            "Instagram Interactions",
            "instagram",
            ig_interactions,
        ),
    ]
    .into_iter()
    .filter(|series| !series.points.is_empty())
    .collect();

    Ok(LiveInsights { days, series })
}

#[cfg(test)]
mod direct_instagram_tests {
    use super::instagram_post;

    #[test]
    fn direct_instagram_media_maps_to_dashboard_post() {
        let post = instagram_post(&serde_json::json!({
            "id":"ig-123", "caption":"Test post", "timestamp":"2026-10-10T13:00:00Z",
            "media_type":"IMAGE", "media_url":"https://example.org/image.jpg",
            "permalink":"https://www.instagram.com/p/example", "like_count":5, "comments_count":2
        }));
        assert_eq!(post.platform, "instagram");
        assert_eq!(post.caption, "Test post");
        assert_eq!(post.media_url.as_deref(), Some("https://example.org/image.jpg"));
        assert_eq!(post.likes, 5);
    }
}