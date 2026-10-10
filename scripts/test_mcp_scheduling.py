"""Offline MCP scheduling smoke test. Uses temporary SQLite and no social API calls."""
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOME = Path(tempfile.mkdtemp(prefix="meta-manager-fixture-"))
DATA = HOME / ".local/share/com.advertpreneur.metamanager"
DATA.mkdir(parents=True)
PORT = "39048"

def call(name, args):
    body = json.dumps({"jsonrpc":"2.0", "id":1, "method":"tools/call",
                       "params":{"name":name, "arguments":args}}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/mcp", body,
        headers={"Content-Type":"application/json", "Accept":"application/json, text/event-stream"})
    with urllib.request.urlopen(req, timeout=6) as response:
        text = response.read().decode()
    payload = json.loads(next(x.removeprefix("data: ") for x in text.splitlines() if x.startswith("data: ")))
    return payload.get("result", {})

db = sqlite3.connect(DATA / "meta-manager.sqlite3")
db.executescript("""
CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,facebook_page_id TEXT,instagram_account_id TEXT,status TEXT,created_at TEXT);
CREATE TABLE linkedin_accounts(id TEXT PRIMARY KEY,member_id TEXT,status TEXT);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE calendar_items(id TEXT PRIMARY KEY,account_id TEXT,title TEXT,platform TEXT,status TEXT,caption TEXT,hashtags TEXT,media_url TEXT,link_url TEXT,scheduled_for TEXT,created_at TEXT,updated_at TEXT,published_post_id TEXT,published_at TEXT,last_error TEXT);
INSERT INTO accounts VALUES('linkedin-demo','LinkedIn Demo',NULL,NULL,'linkedin_connected',CURRENT_TIMESTAMP);
INSERT INTO linkedin_accounts VALUES('linkedin-demo','test-member','connected');
INSERT INTO accounts VALUES('instagram-demo','Instagram Demo',NULL,'ig-test','connected',CURRENT_TIMESTAMP);
""")
db.commit()
env = os.environ.copy()
env.update(HOME=str(HOME), META_MANAGER_MCP_PORT=PORT)
process = subprocess.Popen(["node", "mcp/server.mjs"], cwd=ROOT, env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
try:
    for _ in range(45):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=.7):
                break
        except Exception:
            time.sleep(.1)
    else:
        raise AssertionError("MCP test server did not start")
    cloud = call("cloud_status", {})
    assert "signedIn" in str(cloud), cloud
    blocked = call("schedule_cloud_post", {"item_id":"invalid", "confirm":False})
    assert blocked.get("isError"), "Unconfirmed cloud write must be blocked"
    li = call("create_post", {"account_id":"linkedin-demo", "title":"LinkedIn image/link test",
        "platform":"linkedin", "caption":"Test", "media_url":"https://example.org/image.jpg",
        "link_url":"https://example.org/article", "scheduled_for":"2026-11-20T15:00:00Z"})
    assert not li.get("isError"), li
    ig = call("create_post", {"account_id":"instagram-demo", "title":"Instagram image test",
        "platform":"instagram", "caption":"Test", "media_url":"https://example.org/image.jpg",
        "scheduled_for":"2026-11-20T15:00:00Z"})
    assert not ig.get("isError"), ig
    denied = call("create_post", {"account_id":"instagram-demo", "title":"No image",
        "platform":"instagram", "scheduled_for":"2026-11-20T15:00:00Z"})
    assert denied.get("isError"), "Instagram without image should be rejected"
    rows = db.execute("SELECT platform, status, link_url FROM calendar_items ORDER BY platform").fetchall()
    assert rows == [('instagram','scheduled',None),
                    ('linkedin','scheduled','https://example.org/article')], rows
    print("PASS: LinkedIn media+link and Instagram image schedules; invalid media rejected")
finally:
    process.terminate()
    process.wait(timeout=5)
    db.close()
    shutil.rmtree(HOME)
