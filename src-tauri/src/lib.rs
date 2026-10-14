mod db;
mod instagram;
mod hosting;
mod cloud;
mod linkedin;
mod meta;
mod oauth;

use db::{Account, CalendarItem, CalendarItemInput};
use std::{
    net::TcpStream,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, path::BaseDirectory};

struct McpProcess(Mutex<Option<Child>>);

impl Drop for McpProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn mcp_log_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("meta-manager-mcp.log"))
}

fn spawn_mcp_service(app: &tauri::AppHandle) -> Result<Option<Child>, String> {
    if TcpStream::connect("127.0.0.1:38939").is_ok() {
        return Ok(None);
    }
    let script = if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources").join("meta-manager-mcp.cjs")
    } else {
        app.path().resolve("resources/meta-manager-mcp.cjs", BaseDirectory::Resource)
            .map_err(|e| format!("Cannot locate bundled MCP script: {e}"))?
    };
    let node_program = if cfg!(target_os = "windows") && !cfg!(debug_assertions) {
        app.path().resolve("resources/windows/node.exe", BaseDirectory::Resource)
            .map_err(|e| format!("Cannot locate bundled Node runtime: {e}"))?
    } else {
        std::path::PathBuf::from("node")
    };
    if !script.exists() {
        return Err(format!("MCP script missing from installation: {}", script.display()));
    }
    if cfg!(target_os = "windows") && !cfg!(debug_assertions) && !node_program.exists() {
        return Err(format!("Bundled Node runtime missing: {}", node_program.display()));
    }
    let log_file = std::fs::File::create(mcp_log_path(app)?)
        .map_err(|e| format!("Cannot create MCP diagnostic log: {e}"))?;
    let err_file = log_file.try_clone().map_err(|e| e.to_string())?;
    Command::new(node_program)
        .arg("--no-warnings")
        .arg(script)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(err_file))
        .spawn()
        .map(Some)
        .map_err(|e| format!("Cannot start Meta Manager MCP service: {e}"))
}

#[tauri::command]
fn list_accounts(app: tauri::AppHandle) -> Result<Vec<Account>, String> {
    db::list_accounts(&app)
}

#[tauri::command]
fn add_account(app: tauri::AppHandle, name: String) -> Result<Account, String> {
    db::add_account(&app, name)
}

#[tauri::command]
fn list_calendar(
    app: tauri::AppHandle,
    account_id: Option<String>,
) -> Result<Vec<CalendarItem>, String> {
    db::list_calendar(&app, account_id)
}

#[tauri::command]
fn save_calendar_item(
    app: tauri::AppHandle,
    input: CalendarItemInput,
) -> Result<CalendarItem, String> {
    db::save_calendar_item(&app, input)
}

#[tauri::command]
fn get_linkedin_status(app: tauri::AppHandle) -> Result<linkedin::LinkedInStatus, String> {
    linkedin::get_status(&app)
}

#[tauri::command]
fn save_linkedin_personal_secret(app: tauri::AppHandle, secret: String) -> Result<(), String> {
    linkedin::save_personal_secret(&app, secret)
}

#[tauri::command]
fn prepare_linkedin_oauth(app: tauri::AppHandle) -> Result<linkedin::LinkedInOAuthPlan, String> {
    linkedin::prepare_personal_oauth(&app)
}

#[tauri::command]
fn get_instagram_status(app: tauri::AppHandle) -> Result<instagram::InstagramStatus, String> {
    instagram::get_status(&app)
}

#[tauri::command]
fn save_instagram_config(app: tauri::AppHandle, app_id: String, secret: Option<String>) -> Result<instagram::InstagramStatus, String> {
    instagram::save_config(&app, app_id, secret)
}

#[tauri::command]
fn prepare_instagram_oauth(app: tauri::AppHandle) -> Result<instagram::InstagramOAuthPlan, String> {
    instagram::prepare_oauth(&app)
}

#[tauri::command]
fn get_meta_config_status(app: tauri::AppHandle) -> Result<meta::MetaConfigStatus, String> {
    meta::get_config_status(&app)
}

#[tauri::command]
fn save_meta_config(
    app: tauri::AppHandle,
    app_id: String,
    api_version: Option<String>,
) -> Result<meta::MetaConfigStatus, String> {
    meta::save_config(&app, app_id, api_version)
}

#[tauri::command]
fn save_meta_app_secret(app: tauri::AppHandle, secret: String) -> Result<(), String> {
    meta::save_app_secret(&app, secret)
}

#[tauri::command]
fn prepare_meta_oauth(app: tauri::AppHandle, mode: Option<String>) -> Result<meta::MetaOAuthPlan, String> {
    meta::prepare_oauth(&app, mode)
}

#[tauri::command]
fn cancel_social_oauth() {
    oauth::cancel_attempt();
}

#[tauri::command]
async fn get_live_dashboard(
    app: tauri::AppHandle,
    account_id: Option<String>,
) -> Result<meta::LiveDashboard, String> {
    tauri::async_runtime::spawn_blocking(move || meta::get_live_dashboard(&app, account_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_media_library(
    app: tauri::AppHandle,
    account_id: Option<String>,
    limit: Option<usize>,
) -> Result<meta::MediaLibrary, String> {
    tauri::async_runtime::spawn_blocking(move || meta::get_media_library(&app, account_id, limit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn research_public_meta(
    app: tauri::AppHandle,
    query: String,
    account_id: Option<String>,
) -> Result<meta::ResearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        meta::research_public_meta(&app, query, account_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_cloud_status(app: tauri::AppHandle) -> cloud::CloudStatus { cloud::status(&app) }
#[tauri::command]
async fn cloud_connect_existing(app: tauri::AppHandle)->Result<cloud::CloudStatus,String>{
 tauri::async_runtime::spawn_blocking(move||cloud::connect_existing(&app))
   .await.map_err(|e|e.to_string())?
}


#[tauri::command]
async fn cloud_send_code(app: tauri::AppHandle,email:String)->Result<(),String>{
 tauri::async_runtime::spawn_blocking(move ||cloud::send_code(&app,email)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn cloud_verify_code(app: tauri::AppHandle,email:String,code:String)->Result<cloud::CloudStatus,String>{
 tauri::async_runtime::spawn_blocking(move ||cloud::verify_code(&app,email,code)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn cloud_connect_account(app: tauri::AppHandle,account_id:String,provider:String)->Result<(),String>{
 tauri::async_runtime::spawn_blocking(move ||cloud::connect_account(&app,account_id,provider)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn cloud_disconnect_account(app: tauri::AppHandle,account_id:String,provider:String)->Result<(),String>{
 tauri::async_runtime::spawn_blocking(move ||cloud::disconnect_account(&app,account_id,provider)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn cloud_schedule_item(app: tauri::AppHandle,item_id:String)->Result<(),String>{
 tauri::async_runtime::spawn_blocking(move ||cloud::schedule_item(&app,item_id)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn cloud_list_posts(app: tauri::AppHandle)->Result<Vec<cloud::CloudPost>,String>{
 tauri::async_runtime::spawn_blocking(move ||cloud::list_cloud_posts(&app)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn cloud_upload_media(app: tauri::AppHandle,base64_data:String)->Result<hosting::HostedMedia,String>{
 tauri::async_runtime::spawn_blocking(move ||cloud::upload_media(&app,base64_data)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn cloud_upload_video(app:tauri::AppHandle,base64_data:String)->Result<hosting::HostedMedia,String>{
 tauri::async_runtime::spawn_blocking(move ||cloud::upload_video(&app,base64_data)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn cloud_logout(app: tauri::AppHandle)->Result<(),String>{cloud::logout(&app)}

#[tauri::command]
fn get_media_host_status(app: tauri::AppHandle) -> Result<hosting::MediaHostStatus, String> {
    hosting::status(&app)
}

#[tauri::command]
fn configure_media_host(
    app: tauri::AppHandle,
    site_url: String,
    username: String,
    application_password: Option<String>,
) -> Result<hosting::MediaHostStatus, String> {
    hosting::configure(&app, site_url, username, application_password)
}

#[tauri::command]
async fn upload_hosted_media(
    app: tauri::AppHandle,
    base64_data: String,
    filename: String,
) -> Result<hosting::HostedMedia, String> {
    tauri::async_runtime::spawn_blocking(move || hosting::upload_image(&app, base64_data, filename))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn publish_calendar_item(
    app: tauri::AppHandle,
    item_id: String,
) -> Result<meta::PublishResult, String> {
    tauri::async_runtime::spawn_blocking(move || meta::publish_calendar_item(&app, &item_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_live_insights(
    app: tauri::AppHandle,
    account_id: Option<String>,
    days: Option<i64>,
) -> Result<meta::LiveInsights, String> {
    tauri::async_runtime::spawn_blocking(move || meta::get_live_insights(&app, account_id, days))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct McpStatus {
    online: bool,
    endpoint: String,
    diagnostic: String,
}

#[tauri::command]
fn get_mcp_status(app: tauri::AppHandle) -> McpStatus {
    let online = TcpStream::connect("127.0.0.1:38939").is_ok();
    let diagnostic = if online {
        "Local MCP listener is responding on port 38939".into()
    } else {
        mcp_log_path(&app)
            .ok()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|content| content.lines().rev().find(|line| !line.trim().is_empty()).map(str::to_owned))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "MCP service is offline. Check the installed Node runtime and local firewall.".into())
    };
    McpStatus {
        online,
        endpoint: "http://127.0.0.1:38939/mcp".into(),
        diagnostic: diagnostic.chars().take(500).collect(),
    }
}

#[tauri::command]
async fn refresh_meta_accounts(app: tauri::AppHandle) -> Result<meta::OAuthResult, String> {
    tauri::async_runtime::spawn_blocking(move || meta::refresh_accounts(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            db::init(app.handle()).map_err(std::io::Error::other)?;
            let _ = meta::ensure_local_tls_material(app.handle());
            meta::start_scheduler(app.handle().clone());
            let mcp_child = match spawn_mcp_service(app.handle()) {
                Ok(child) => child,
                Err(error) => {
                    if let Ok(path) = mcp_log_path(app.handle()) {
                        let _ = std::fs::write(path, format!("{error}\n"));
                    }
                    None
                }
            };
            app.manage(McpProcess(Mutex::new(mcp_child)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            add_account,
            list_calendar,
            save_calendar_item,
            get_meta_config_status,
            get_linkedin_status,
            save_linkedin_personal_secret,
            prepare_linkedin_oauth,
            get_instagram_status,
            save_instagram_config,
            prepare_instagram_oauth,
            save_meta_config,
            save_meta_app_secret,
            prepare_meta_oauth,
            cancel_social_oauth,
            get_live_dashboard,
            get_media_library,
            research_public_meta,
            publish_calendar_item,
            get_media_host_status,
            configure_media_host,
            upload_hosted_media,
            get_cloud_status,
            cloud_connect_existing,
            cloud_send_code,
            cloud_verify_code,
            cloud_connect_account,
            cloud_disconnect_account,
            cloud_schedule_item,
            cloud_list_posts,
            cloud_upload_media,
            cloud_upload_video,
            cloud_logout,
            get_live_insights,
            get_mcp_status,
            refresh_meta_accounts
        ])
        .run(tauri::generate_context!())
        .expect("error while building Meta Manager");
}