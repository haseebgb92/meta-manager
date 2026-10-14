use std::sync::atomic::{AtomicU64, Ordering};

static OAUTH_GENERATION: AtomicU64 = AtomicU64::new(1);

pub fn begin_attempt() -> u64 {
    OAUTH_GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

pub fn cancel_attempt() {
    OAUTH_GENERATION.fetch_add(1, Ordering::SeqCst);
}

pub fn is_current(generation: u64) -> bool {
    OAUTH_GENERATION.load(Ordering::SeqCst) == generation
}
pub fn broker_failure(provider: &str, error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(status, response) => {
            let body = response.into_json::<serde_json::Value>().unwrap_or_default();
            // These two fields are server-defined categories, not arbitrary error text.
            let stage = match body.get("stage").and_then(|v| v.as_str()) {
                Some("instagram_code_exchange") => "instagram_code_exchange",
                Some("instagram_long_token_exchange") => "instagram_long_token_exchange",
                Some("instagram_configuration") => "instagram_configuration",
                _ => "",
            };
            let reason_code = match body.get("reason").and_then(|v| v.as_str()) {
                Some("instagram_code_invalid") => "instagram_code_invalid",
                Some("instagram_code_expired_or_used") => "instagram_code_expired_or_used",
                Some("instagram_redirect_mismatch") => "instagram_redirect_mismatch",
                Some("instagram_client_configuration") => "instagram_client_configuration",
                Some("instagram_permission_denied") => "instagram_permission_denied",
                Some("instagram_rate_limited") => "instagram_rate_limited",
                Some("instagram_network_error") => "instagram_network_error",
                Some("instagram_short_token_missing") => "instagram_short_token_missing",
                Some("instagram_upstream_rejected") => "instagram_upstream_rejected",
                _ => "",
            };
            let reason = body.get("error_description").or_else(|| body.get("error"))
                .or_else(|| body.get("message"))
                .and_then(|v| v.as_str()).unwrap_or("The authorization server rejected this code");
            let safe = reason.replace(['\r', '\n'], " ");
            let marker = if !stage.is_empty() && !reason_code.is_empty() {
                format!(" [{stage}/{reason_code}]")
            } else { String::new() };
            format!("{provider} authorization failed (HTTP {status}): {}{marker}",
                safe.chars().take(220).collect::<String>())
        }
        ureq::Error::Transport(error) => {
            format!("{provider} authorization server could not be reached: {error}")
        }
    }
}

// Only structured, non-identifying failure categories are persisted for optional GitHub reports.
// Never save the OAuth code, state, bearer token, user profile, full URL, or exception text.
pub fn record_failure(app: &tauri::AppHandle, component: &str, error: &str) {
    use std::io::Write;
    use tauri::Manager;

    let description = error.to_ascii_lowercase();
    let kind = if description.contains("instagram_code_invalid") { "oauth_instagram_code_invalid" }
    else if description.contains("instagram_code_expired_or_used") { "oauth_instagram_code_expired_or_used" }
    else if description.contains("instagram_redirect_mismatch") { "oauth_instagram_redirect_mismatch" }
    else if description.contains("instagram_client_configuration") { "oauth_instagram_client_configuration" }
    else if description.contains("instagram_permission_denied") { "oauth_instagram_permission_denied" }
    else if description.contains("instagram_rate_limited") { "oauth_instagram_rate_limited" }
    else if description.contains("instagram_network_error") { "oauth_instagram_network_error" }
    else if description.contains("instagram_short_token_missing") { "oauth_instagram_short_token_missing" }
    else if description.contains("instagram_upstream_rejected") { "oauth_instagram_upstream_rejected" }
    else if description.contains("oauth redirect unreachable") { "network_connection" } else if description.contains("38937") || description.contains("address already in use") {
        "oauth_callback_port"
    } else if description.contains("certificate") || description.contains("certutil") || description.contains("tls") {
        "oauth_local_certificate"
    } else if description.contains("state mismatch") || description.contains("oauth state") {
        "oauth_state"
    } else if description.contains("authorization code") {
        "oauth_authorization_code"
    } else if description.contains("expired") || description.contains("timed out") {
        "oauth_timeout_or_expired"
    } else if description.contains("token exchange") || description.contains("authorization failed") || description.contains("broker") {
        "oauth_token_exchange"
    } else if description.contains("profile") || description.contains("userinfo") {
        "social_profile_fetch"
    } else if description.contains("network") || description.contains("connection") || description.contains("reached") {
        "network_connection"
    } else {
        "unclassified_error"
    };
    let http_status = error.split("HTTP ").skip(1).find_map(|chunk| {
        let digits: String = chunk.chars().take_while(|c| c.is_ascii_digit()).take(3).collect();
        if digits.len() == 3 { digits.parse::<u16>().ok() } else { None }
    });
    let stage = if description.contains("instagram_long_token_exchange") {
        Some("instagram_long_token_exchange")
    } else if description.contains("instagram_code_exchange") {
        Some("instagram_code_exchange")
    } else { None };
    let component = match component {
        "facebook" => "facebook",
        "instagram" => "instagram",
        "linkedin" => "linkedin",
        "mcp" => "mcp",
        "cloud" => "cloud",
        _ => "app",
    };
    let Ok(dir) = app.path().app_data_dir() else { return };
    if std::fs::create_dir_all(&dir).is_err() { return; }
    let file_path = dir.join("diagnostics.jsonl");
    // Bound local history; the log contains only category names and HTTP status numbers.
    if std::fs::metadata(&file_path).map(|v| v.len() > 64 * 1024).unwrap_or(false) {
        let _ = std::fs::write(&file_path, "");
    }
    let item = serde_json::json!({
        "source": "meta-manager",
        "component": component,
        "kind": kind,
        "stage": stage,
        "httpStatus": http_status,
        "at": chrono::Utc::now().to_rfc3339(),
    });
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&file_path) {
        let _ = writeln!(file, "{item}");
    }
}
pub fn is_callback_path(url: &url::Url, expected: &str) -> bool {
    url.path() == expected
}

#[cfg(test)]
mod callback_tests {
    use super::is_callback_path;

    #[test]
    fn ignores_browser_probes_and_only_accepts_expected_oauth_callback() {
        let valid = url::Url::parse("https://127.0.0.1:38937/oauth/instagram/callback?code=test&state=sample").unwrap();
        let favicon = url::Url::parse("https://127.0.0.1:38937/favicon.ico").unwrap();
        let root = url::Url::parse("https://127.0.0.1:38937/").unwrap();
        let wrong_provider = url::Url::parse("http://127.0.0.1:38937/oauth/linkedin/callback?code=test").unwrap();
        assert!(is_callback_path(&valid, "/oauth/instagram/callback"));
        assert!(!is_callback_path(&favicon, "/oauth/instagram/callback"));
        assert!(!is_callback_path(&root, "/oauth/instagram/callback"));
        assert!(!is_callback_path(&wrong_provider, "/oauth/instagram/callback"));
    }
}