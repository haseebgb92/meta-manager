use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::AppHandle;
use url::Url;

use crate::{db, meta};

const SITE_KEY: &str = "media_host_wp_site";
const USER_KEY: &str = "media_host_wp_username";
const PASSWORD_KEY: &str = "media_host_wp_password";
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaHostStatus {
    pub site_url: String,
    pub username: String,
    pub configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedMedia {
    pub url: String,
    pub media_id: Option<i64>,
    pub verified_public: bool,
    pub note: String,
}

pub fn status(app: &AppHandle) -> Result<MediaHostStatus, String> {
    let site_url = db::get_setting(app, SITE_KEY)?.unwrap_or_default();
    let username = db::get_setting(app, USER_KEY)?.unwrap_or_default();
    Ok(MediaHostStatus {
        configured: !site_url.is_empty()
            && !username.is_empty()
            && meta::has_secret(app, PASSWORD_KEY),
        site_url,
        username,
    })
}

fn validate_base_url(value: &str) -> Result<String, String> {
    let url = Url::parse(value.trim()).map_err(|_| "Enter a valid HTTPS WordPress site URL")?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err("Media hosting requires an HTTPS WordPress website".into());
    }
    if url.username() != "" || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("Enter a website URL without credentials or query parameters".into());
    }
    let mut normalized = url;
    let cleaned_path = normalized.path().trim_end_matches('/').to_string();
    normalized.set_path(&cleaned_path);
    Ok(normalized.as_str().trim_end_matches('/').to_string())
}

pub fn configure(
    app: &AppHandle,
    site_url: String,
    username: String,
    application_password: Option<String>,
) -> Result<MediaHostStatus, String> {
    let site_url = validate_base_url(&site_url)?;
    let username = username.trim();
    if username.is_empty() { return Err("WordPress username is required".into()); }
    let changed = status(app).is_ok_and(|old| old.configured && (old.site_url != site_url || old.username != username));
    if changed && application_password.as_ref().is_none_or(|v| v.trim().is_empty()) {
        return Err("Enter a new Application Password when changing the WordPress site or username".into());
    }
    if let Some(password) = application_password.filter(|p| !p.trim().is_empty()) {
        meta::save_secret(app, PASSWORD_KEY, &password)?;
    }
    if !meta::has_secret(app, PASSWORD_KEY) {
        return Err("Create a WordPress Application Password, then enter it here".into());
    }
    db::set_setting(app, SITE_KEY, &site_url)?;
    db::set_setting(app, USER_KEY, username)?;
    status(app)
}

fn mime_type(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) { return Ok("image/jpeg"); }
    if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) { return Ok("image/png"); }
    Err("Only JPEG or PNG images may be uploaded. The composer converts other formats to JPEG.".into())
}

pub fn upload_image(
    app: &AppHandle,
    base64_data: String,
    filename: String,
) -> Result<HostedMedia, String> {
    let config = status(app)?;
    if !config.configured {
        return Err("Configure WordPress Media Hosting in Settings before selecting an image.".into());
    }
    if base64_data.len() > 15_000_000 {
        return Err("Image is too large; maximum size is 10 MB".into());
    }
    let bytes = STANDARD.decode(&base64_data).map_err(|_| "Invalid image data")?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image must be between 1 byte and 10 MB".into());
    }
    let mime = mime_type(&bytes)?;
    let extension = if mime == "image/jpeg" { "jpg" } else { "png" };
    let basename = filename
        .split('.').next().unwrap_or("social-media")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(45)
        .collect::<String>();
    let safe = if basename.is_empty() { "social-media" } else { basename.as_str() };
    let upload_name = format!("social-{safe}-{}.{}", uuid::Uuid::new_v4().simple(), extension);
    let password = meta::load_secret(app, PASSWORD_KEY)?;
    let encoded_auth = STANDARD.encode(format!("{}:{password}", config.username));
    let endpoint = format!("{}/wp-json/wp/v2/media", config.site_url);
    let response = ureq::post(&endpoint)
        .timeout(std::time::Duration::from_secs(60))
        .set("Authorization", &format!("Basic {encoded_auth}"))
        .set("Content-Type", mime)
        .set("Content-Disposition", &format!("attachment; filename=\"{upload_name}\""))
        .send_bytes(&bytes);
    let response = match response {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let body: serde_json::Value = r.into_json().unwrap_or_default();
            let message = body.get("message").and_then(|v| v.as_str()).unwrap_or("WordPress rejected the upload");
            return Err(format!("WordPress media upload returned {code}: {message}"));
        }
        Err(e) => return Err(format!("Could not upload image to WordPress: {e}")),
    };
    let result: serde_json::Value = response.into_json()
        .map_err(|_| "WordPress media API returned an invalid response")?;
    let url = result.get("source_url").and_then(|v| v.as_str())
        .ok_or("WordPress upload succeeded but no source_url was provided")?;
    let remote = Url::parse(url).map_err(|_| "WordPress returned an invalid media URL")?;
    if remote.scheme() != "https" {
        return Err("WordPress returned an insecure image URL. Enable HTTPS on your site.".into());
    }
    let verified_public = ureq::head(url)
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map(|r| r.status() == 200)
        .unwrap_or(false);
    Ok(HostedMedia {
        url: url.to_string(),
        media_id: result.get("id").and_then(|v| v.as_i64()),
        verified_public,
        note: if verified_public {
            "Image uploaded; public URL verified.".into()
        } else {
            "Image uploaded; public HEAD verification was inconclusive. Confirm URL is publicly accessible before scheduling.".into()
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{mime_type, validate_base_url};

    #[test]
    fn website_must_be_https() {
        assert!(validate_base_url("https://example.com").is_ok());
        assert!(validate_base_url("http://example.com").is_err());
        assert!(validate_base_url("https://admin:secret@example.com").is_err());
    }

    #[test]
    fn image_must_have_valid_magic_bytes() {
        assert_eq!(mime_type(&[255, 216, 255, 224]).unwrap(), "image/jpeg");
        assert_eq!(mime_type(&[137, 80, 78, 71, 13, 10, 26, 10]).unwrap(), "image/png");
        assert!(mime_type(b"not-an-image").is_err());
    }
}
