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
            let reason = response.into_json::<serde_json::Value>().ok()
                .and_then(|body| {
                    body.get("error_description")
                        .or_else(|| body.get("error"))
                        .or_else(|| body.get("message"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "The authorization server rejected this code".to_string());
            // Do not expose authorization codes, URL query strings or bearer tokens.
            let safe = reason.replace(['\r','\n'], " ");
            format!("{provider} authorization failed (HTTP {status}): {}",
                safe.chars().take(220).collect::<String>())
        }
        ureq::Error::Transport(error) => {
            format!("{provider} authorization server could not be reached: {error}")
        }
    }
}
