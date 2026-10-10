use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub facebook_page_id: Option<String>,
    pub instagram_account_id: Option<String>,
    pub status: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkedInAccount {
    pub id: String,
    pub member_id: String,
    pub name: String,
    pub email: Option<String>,
    pub picture_url: Option<String>,
    pub status: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarItem {
    pub id: String,
    pub account_id: String,
    pub title: String,
    pub platform: String,
    pub status: String,
    pub caption: Option<String>,
    pub hashtags: Vec<String>,
    pub media_url: Option<String>,
    pub link_url: Option<String>,
    pub published_post_id: Option<String>,
    pub scheduled_for: Option<String>,
    pub published_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarItemInput {
    pub id: Option<String>,
    pub account_id: String,
    pub title: String,
    pub platform: String,
    pub status: Option<String>,
    pub caption: Option<String>,
    pub hashtags: Option<Vec<String>>,
    pub media_url: Option<String>,
    pub link_url: Option<String>,
    pub scheduled_for: Option<String>,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("meta-manager.sqlite3"))
}

fn conn(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let connection = Connection::open(path).map_err(|e| e.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS accounts (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               facebook_page_id TEXT,
               instagram_account_id TEXT,
               status TEXT NOT NULL DEFAULT 'disconnected',
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS calendar_items (
               id TEXT PRIMARY KEY,
               account_id TEXT NOT NULL,
               title TEXT NOT NULL,
               platform TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'draft',
               caption TEXT,
               hashtags TEXT NOT NULL DEFAULT '[]',
               media_url TEXT,
               link_url TEXT,
               published_post_id TEXT,
               scheduled_for TEXT,
               published_at TEXT,
               last_error TEXT,
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS settings (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS linkedin_accounts (
               id TEXT PRIMARY KEY,
               member_id TEXT NOT NULL UNIQUE,
               name TEXT NOT NULL,
               email TEXT,
               picture_url TEXT,
               status TEXT NOT NULL DEFAULT 'connected',
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             INSERT OR IGNORE INTO accounts (id,name,facebook_page_id,instagram_account_id,status)
               SELECT id,name,NULL,NULL,'linkedin_connected' FROM linkedin_accounts;
             UPDATE accounts
               SET status='linkedin_connected', updated_at=CURRENT_TIMESTAMP
               WHERE id IN (SELECT id FROM linkedin_accounts)
                 AND facebook_page_id IS NULL
                 AND instagram_account_id IS NULL;",
        )
        .map_err(|e| e.to_string())?;

    for column in [
        "caption TEXT",
        "hashtags TEXT NOT NULL DEFAULT '[]'",
        "media_url TEXT",
        "link_url TEXT",
        "published_post_id TEXT",
        "published_at TEXT",
        "last_error TEXT",
    ] {
        let sql = format!("ALTER TABLE calendar_items ADD COLUMN {column}");
        let _ = connection.execute(&sql, []);
    }

    Ok(connection)
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let _ = conn(app)?;
    Ok(())
}

pub fn list_accounts(app: &AppHandle) -> Result<Vec<Account>, String> {
    let connection = conn(app)?;
    let mut stmt = connection
        .prepare(
            "SELECT id,name,facebook_page_id,instagram_account_id,status
             FROM accounts ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                facebook_page_id: row.get(2)?,
                instagram_account_id: row.get(3)?,
                status: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn list_linkedin_accounts(app: &AppHandle) -> Result<Vec<LinkedInAccount>, String> {
    let connection = conn(app)?;
    let mut stmt = connection
        .prepare("SELECT id,member_id,name,email,picture_url,status FROM linkedin_accounts ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LinkedInAccount {
                id: row.get(0)?,
                member_id: row.get(1)?,
                name: row.get(2)?,
                email: row.get(3)?,
                picture_url: row.get(4)?,
                status: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn upsert_linkedin_account(
    app: &AppHandle,
    member_id: &str,
    name: &str,
    email: Option<&str>,
    picture_url: Option<&str>,
) -> Result<LinkedInAccount, String> {
    let connection = conn(app)?;
    let existing: Option<String> = connection
        .query_row(
            "SELECT id FROM linkedin_accounts WHERE member_id=?1 LIMIT 1",
            [member_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
    connection.execute(
        "INSERT INTO linkedin_accounts (id,member_id,name,email,picture_url,status) VALUES (?1,?2,?3,?4,?5,'connected')\n         ON CONFLICT(member_id) DO UPDATE SET name=excluded.name,email=excluded.email,picture_url=excluded.picture_url,status='connected',updated_at=CURRENT_TIMESTAMP",
        params![id, member_id, name, email, picture_url],
    ).map_err(|e| e.to_string())?;

    // Mirror LinkedIn members into the common account table so the existing
    // calendar/scheduler can target them without a second queue model.
    connection.execute(
        "INSERT INTO accounts (id,name,facebook_page_id,instagram_account_id,status) VALUES (?1,?2,NULL,NULL,'linkedin_connected')\n         ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='linkedin_connected',updated_at=CURRENT_TIMESTAMP",
        params![id, name],
    ).map_err(|e| e.to_string())?;

    Ok(LinkedInAccount {
        id,
        member_id: member_id.to_string(),
        name: name.to_string(),
        email: email.map(str::to_string),
        picture_url: picture_url.map(str::to_string),
        status: "connected".into(),
    })
}

pub fn get_linkedin_account(app: &AppHandle, id: &str) -> Result<Option<LinkedInAccount>, String> {
    let connection = conn(app)?;
    connection
        .query_row(
            "SELECT id,member_id,name,email,picture_url,status FROM linkedin_accounts WHERE id=?1",
            [id],
            |row| {
                Ok(LinkedInAccount {
                    id: row.get(0)?,
                    member_id: row.get(1)?,
                    name: row.get(2)?,
                    email: row.get(3)?,
                    picture_url: row.get(4)?,
                    status: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

pub fn add_account(app: &AppHandle, name: String) -> Result<Account, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Account name is required".into());
    }

    let id = Uuid::new_v4().to_string();
    let connection = conn(app)?;
    connection
        .execute(
            "INSERT INTO accounts (id,name,status) VALUES (?1,?2,'disconnected')",
            params![id, trimmed],
        )
        .map_err(|e| e.to_string())?;

    Ok(Account {
        id,
        name: trimmed.to_string(),
        facebook_page_id: None,
        instagram_account_id: None,
        status: "disconnected".into(),
    })
}

fn calendar_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CalendarItem> {
    let hashtags_json: String = row.get(6)?;
    let hashtags = serde_json::from_str::<Vec<String>>(&hashtags_json).unwrap_or_default();

    Ok(CalendarItem {
        id: row.get(0)?,
        account_id: row.get(1)?,
        title: row.get(2)?,
        platform: row.get(3)?,
        status: row.get(4)?,
        caption: row.get(5)?,
        hashtags,
        media_url: row.get(7)?,
        link_url: row.get(8)?,
        published_post_id: row.get(9)?,
        scheduled_for: row.get(10)?,
        published_at: row.get(11)?,
        last_error: row.get(12)?,
    })
}

pub fn list_calendar(
    app: &AppHandle,
    account_id: Option<String>,
) -> Result<Vec<CalendarItem>, String> {
    let connection = conn(app)?;
    let base = "SELECT id,account_id,title,platform,status,caption,hashtags,media_url,link_url,
                       published_post_id,scheduled_for,published_at,last_error
                FROM calendar_items";
    let sql = if account_id.is_some() {
        format!("{base} WHERE account_id=?1 ORDER BY COALESCE(scheduled_for, created_at) ASC")
    } else {
        format!("{base} ORDER BY COALESCE(scheduled_for, created_at) ASC")
    };

    let mut stmt = connection.prepare(&sql).map_err(|e| e.to_string())?;
    let mut out = Vec::new();

    if let Some(id) = account_id {
        let rows = stmt
            .query_map([id], calendar_from_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let rows = stmt
            .query_map([], calendar_from_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    }

    Ok(out)
}

pub fn save_calendar_item(
    app: &AppHandle,
    input: CalendarItemInput,
) -> Result<CalendarItem, String> {
    let account_id = input.account_id.trim();
    let title = input.title.trim();
    if account_id.is_empty() {
        return Err("Account is required".into());
    }
    if title.is_empty() {
        return Err("Post title is required".into());
    }

    let platform = match input.platform.as_str() {
        "facebook" | "instagram" | "both" | "linkedin" => input.platform,
        _ => return Err("Platform must be facebook, instagram, both, or linkedin".into()),
    };

    let status = input.status.unwrap_or_else(|| "draft".into());
    if !matches!(status.as_str(), "draft" | "scheduled") { return Err("Post status must be draft or scheduled".into()); }
    let account = get_account(app, account_id.to_string().as_str())?.ok_or("Workspace not found")?;
    if platform == "linkedin" && account.status != "linkedin_connected" { return Err("Select a connected LinkedIn workspace".into()); }
    if platform != "linkedin" && account.status == "linkedin_connected" { return Err("Select a Facebook/Instagram workspace".into()); }
    if status == "scheduled" {
        let time = input.scheduled_for.as_deref().ok_or("Scheduled posts need a date")?;
        let when = chrono::DateTime::parse_from_rfc3339(time).map_err(|_| "Invalid scheduled date")?;
        if when.with_timezone(&chrono::Utc) <= chrono::Utc::now() { return Err("Scheduled date must be in the future".into()); }
        if matches!(platform.as_str(), "facebook"|"both") && account.facebook_page_id.is_none() { return Err("Facebook Page not connected".into()); }
        if matches!(platform.as_str(), "instagram"|"both") {
            if account.instagram_account_id.is_none() { return Err("Instagram account not connected".into()); }
            let image = input.media_url.as_deref().unwrap_or("");
            let valid = url::Url::parse(image).is_ok_and(|u| u.scheme() == "https");
            if !valid { return Err("Instagram requires public HTTPS image media before scheduling".into()); }
        }
    }
    let hashtags =
        serde_json::to_string(&input.hashtags.unwrap_or_default()).map_err(|e| e.to_string())?;
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let connection = conn(app)?;
    connection
        .execute(
            "INSERT INTO calendar_items (
                id,account_id,title,platform,status,caption,hashtags,media_url,link_url,scheduled_for,updated_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET
                account_id=excluded.account_id,
                title=excluded.title,
                platform=excluded.platform,
                status=excluded.status,
                caption=excluded.caption,
                hashtags=excluded.hashtags,
                media_url=excluded.media_url,
                link_url=excluded.link_url,
                scheduled_for=excluded.scheduled_for,
                updated_at=CURRENT_TIMESTAMP",
            params![
                id,
                account_id,
                title,
                platform,
                status,
                input.caption,
                hashtags,
                input.media_url,
                input.link_url,
                input.scheduled_for
            ],
        )
        .map_err(|e| e.to_string())?;

    get_calendar_item(app, &id)?
        .ok_or_else(|| "Saved calendar item could not be reloaded".to_string())
}

pub fn get_calendar_item(app: &AppHandle, id: &str) -> Result<Option<CalendarItem>, String> {
    let connection = conn(app)?;
    connection
        .query_row(
            "SELECT id,account_id,title,platform,status,caption,hashtags,media_url,link_url,
                    published_post_id,scheduled_for,published_at,last_error
             FROM calendar_items WHERE id=?1",
            [id],
            calendar_from_row,
        )
        .optional()
        .map_err(|e| e.to_string())
}

pub fn mark_calendar_partial(app: &AppHandle, id: &str, published_post_id: &str) -> Result<(), String> {
    let connection = conn(app)?;
    connection.execute("UPDATE calendar_items SET published_post_id=?2, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
       params![id, published_post_id]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn mark_calendar_published(
    app: &AppHandle,
    id: &str,
    published_post_id: &str,
) -> Result<(), String> {
    let connection = conn(app)?;
    connection
        .execute(
            "UPDATE calendar_items
             SET status='published', published_post_id=?2, published_at=CURRENT_TIMESTAMP,
                 last_error=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE id=?1",
            params![id, published_post_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn mark_calendar_failed(app: &AppHandle, id: &str, error: &str) -> Result<(), String> {
    let connection = conn(app)?;
    connection
        .execute(
            "UPDATE calendar_items
             SET status='failed', last_error=?2, updated_at=CURRENT_TIMESTAMP
             WHERE id=?1",
            params![id, error],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn due_calendar_items(app: &AppHandle) -> Result<Vec<CalendarItem>, String> {
    let connection = conn(app)?;
    let mut stmt = connection
        .prepare(
            "SELECT id,account_id,title,platform,status,caption,hashtags,media_url,link_url,
                    published_post_id,scheduled_for,published_at,last_error
             FROM calendar_items
             WHERE status='scheduled'
               AND scheduled_for IS NOT NULL
               AND datetime(scheduled_for) <= datetime('now')
             ORDER BY scheduled_for ASC LIMIT 20",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], calendar_from_row)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn get_setting(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let connection = conn(app)?;
    let mut stmt = connection
        .prepare("SELECT value FROM settings WHERE key=?1")
        .map_err(|e| e.to_string())?;
    match stmt.query_row([key], |row| row.get::<_, String>(0)) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn set_setting(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let connection = conn(app)?;
    connection
        .execute(
            "INSERT INTO settings (key,value,updated_at) VALUES (?1,?2,CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn upsert_meta_account(
    app: &AppHandle,
    name: &str,
    facebook_page_id: Option<&str>,
    instagram_account_id: Option<&str>,
) -> Result<Account, String> {
    let connection = conn(app)?;

    let mut existing: Option<Account> = None;
    if let Some(page_id) = facebook_page_id {
        existing = connection
            .query_row(
                "SELECT id,name,facebook_page_id,instagram_account_id,status
                 FROM accounts WHERE facebook_page_id=?1 LIMIT 1",
                [page_id],
                |row| {
                    Ok(Account {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        facebook_page_id: row.get(2)?,
                        instagram_account_id: row.get(3)?,
                        status: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
    }
    if existing.is_none() {
        if let Some(ig_id) = instagram_account_id {
            existing = connection
                .query_row(
                    "SELECT id,name,facebook_page_id,instagram_account_id,status
                     FROM accounts WHERE instagram_account_id=?1 LIMIT 1",
                    [ig_id],
                    |row| {
                        Ok(Account {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            facebook_page_id: row.get(2)?,
                            instagram_account_id: row.get(3)?,
                            status: row.get(4)?,
                        })
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?;
        }
    }

    if let Some(mut account) = existing {
        connection
            .execute(
                "UPDATE accounts
                 SET name=?2,
                     facebook_page_id=COALESCE(?3, facebook_page_id),
                     instagram_account_id=COALESCE(?4, instagram_account_id),
                     status='connected', updated_at=CURRENT_TIMESTAMP
                 WHERE id=?1",
                params![account.id, name, facebook_page_id, instagram_account_id],
            )
            .map_err(|e| e.to_string())?;
        account.name = name.to_string();
        if let Some(page) = facebook_page_id { account.facebook_page_id = Some(page.to_string()); }
        if let Some(ig) = instagram_account_id { account.instagram_account_id = Some(ig.to_string()); }
        account.status = "connected".into();
        return Ok(account);
    }

    let id = Uuid::new_v4().to_string();
    connection
        .execute(
            "INSERT INTO accounts (
                id,name,facebook_page_id,instagram_account_id,status
             ) VALUES (?1,?2,?3,?4,'connected')",
            params![id, name, facebook_page_id, instagram_account_id],
        )
        .map_err(|e| e.to_string())?;

    Ok(Account {
        id,
        name: name.to_string(),
        facebook_page_id: facebook_page_id.map(str::to_string),
        instagram_account_id: instagram_account_id.map(str::to_string),
        status: "connected".into(),
    })
}

pub fn get_account(app: &AppHandle, id: &str) -> Result<Option<Account>, String> {
    let connection = conn(app)?;
    connection
        .query_row(
            "SELECT id,name,facebook_page_id,instagram_account_id,status FROM accounts WHERE id=?1",
            [id],
            |row| {
                Ok(Account {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    facebook_page_id: row.get(2)?,
                    instagram_account_id: row.get(3)?,
                    status: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

pub fn mark_calendar_publishing(app: &AppHandle, id: &str) -> Result<(), String> {
    let connection = conn(app)?;
    let changed = connection.execute(
        "UPDATE calendar_items SET status='publishing', last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status IN ('draft','scheduled','failed')",
        [id],
    ).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Post is not available for publishing".into());
    }
    Ok(())
}
