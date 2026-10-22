#!/usr/bin/env python3
"""Idempotent read-only 7-day audit and on-demand process wake for Meta Manager.

Local 00:05 preflight DOES NOT generate AI content or create social posts.
ChatGPT Scheduled at 00:15 performs authoring only when the connected tools are available.
"""
import datetime as dt
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import time
import urllib.request
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('Asia/Karachi')
HOME = pathlib.Path.home()
STATE = HOME / '.local/state/meta-manager-ai'
STATE.mkdir(parents=True, exist_ok=True)
os.chmod(STATE, 0o700)
DB = HOME / '.local/share/com.advertpreneur.metamanager/meta-manager.sqlite3'
PORT = 'http://127.0.0.1:38939/health'
LOG = STATE / 'overnight.log'

def log(msg):
    now = dt.datetime.now(ZONE).strftime('%Y-%m-%d %H:%M:%S %Z')
    with LOG.open('a', encoding='utf-8') as f:
        f.write(f'{now} {msg}\n')
    os.chmod(LOG, 0o600)
    print(msg, flush=True)

def healthy():
    try:
        with urllib.request.urlopen(PORT, timeout=2.5) as response:
            return response.status == 200 and json.loads(response.read(1024).decode()).get('ok') is True
    except Exception:
        return False

def exists_process(exact):
    result = subprocess.run(['pgrep', '-f', exact], capture_output=True, text=True, timeout=3)
    return bool(result.stdout.strip())

def session_graphical():
    display = os.environ.get('DISPLAY') or ':0'
    return bool(os.environ.get('XDG_RUNTIME_DIR') and pathlib.Path('/tmp/.X11-unix/X' + display.split(':')[-1].split('.')[0]).exists())

def unit_active(name):
    result = subprocess.run(['systemctl', '--user', 'is-active', '--quiet', name], timeout=5)
    return result.returncode == 0

def start_unit(name):
    result = subprocess.run(['systemctl', '--user', 'start', name], capture_output=True, text=True, timeout=12)
    if result.returncode:
        log(f'Could not start {name}: {result.stderr.strip()[:180]}')
        return False
    log(f'Start requested: {name}')
    return True

def wake():
    actions = []
    if session_graphical():
        # GUI starts only when absent; never restart a working user session.
        if not exists_process(r'^/usr/bin/meta-manager$'):
            if start_unit('meta-manager-overnight-desktop.service'):
                actions.append('start_desktop')
        if not exists_process(r'^/opt/MCP Bridge/mcp-bridge$'):
            if start_unit('meta-manager-overnight-bridge.service'):
                actions.append('start_bridge')
    if not healthy():
        for _ in range(8):
            time.sleep(.6)
            if healthy(): break
    if not healthy() and start_unit('meta-manager-overnight-mcp.service'):
        actions.append('start_headless_mcp')
        for _ in range(12):
            time.sleep(.5)
            if healthy(): break
    return actions, healthy()

def audit():
    result = {'checked_at': dt.datetime.now(ZONE).isoformat(), 'time_zone':'Asia/Karachi',
              'days':7, 'accounts':[], 'warning':'This audit does not create content or guarantee that ChatGPT or Flow can run unattended.'}
    if not DB.exists():
        result['error']='Local Meta Manager database is missing'
        return result
    # Read-only connection, never changes existing scheduled or published posts.
    cx = sqlite3.connect(f'file:{DB}?mode=ro', uri=True, timeout=8)
    try:
        now = dt.datetime.now(ZONE)
        start = now.date()
        rows = cx.execute('SELECT a.id,a.name,a.status,p.config_json FROM accounts a JOIN strategist_profiles p ON p.account_id=a.id ORDER BY a.name').fetchall()
        for aid,name,status,raw in rows:
            try:
                config = json.loads(raw)
            except (TypeError, ValueError):
                log('WARNING: invalid saved strategy JSON')
                continue
            if not config.get('enabled'): continue
            platforms = list(config.get('platforms',[]))
            active_weekdays = {int(w) for w in config.get('weekdays',[]) if isinstance(w,int)}
            queue = cx.execute('SELECT platform,status,scheduled_for FROM calendar_items WHERE account_id=?', (aid,)).fetchall()
            dates=[]
            for offset in range(7):
                day = start+dt.timedelta(days=offset)
                if day.isoweekday() not in active_weekdays: continue
                # A date is covered only when a valid publishing record exists;
                # drafts and locally scheduled items do NOT guarantee cloud delivery.
                for platform in platforms:
                    covered=False
                    detail=None
                    for item_platform,item_status,when in queue:
                        if not when or item_status not in ('cloud_scheduled','cloud_published','published'):continue
                        match=(item_platform==platform or (platform=='instagram' and item_platform in ('instagram_reel','both')) or (platform=='facebook' and item_platform=='both'))
                        if not match:continue
                        try:
                            instant=dt.datetime.fromisoformat(when.replace('Z','+00:00'))
                            if instant.tzinfo is None: instant=instant.replace(tzinfo=dt.timezone.utc)
                            if instant.astimezone(ZONE).date()==day:
                                covered=True;detail=item_status;break
                        except (ValueError, OverflowError):continue
                    dates.append({'date':day.isoformat(),'platform':platform,'covered':covered,'status':detail or 'missing_confirmed_cloud_post'})
            result['accounts'].append({'name':name,'account_id':aid,'platforms':platforms,'enabled':True,
                'covered':sum(x['covered'] for x in dates),'missing':sum(not x['covered'] for x in dates),
                'dates':dates})
    finally:
        cx.close()
    return result

def main():
    log('Starting overnight seven-day preflight')
    actions, ok = wake()
    results = audit()
    results['mcp_healthy'] = ok
    results['startup_actions'] = actions
    # Atomic safe local state file, no credentials or provider secrets.
    file = STATE / 'last_status.json'
    tmp = STATE / 'last_status.json.tmp'
    tmp.write_text(json.dumps(results, indent=2), encoding='utf-8')
    os.chmod(tmp, 0o600)
    os.replace(tmp,file)
    for account in results['accounts']:
        log(f"Workspace {account['name']}: {account['covered']} confirmed / {account['missing']} missing during next seven days")
    log(f"Preflight finished: MCP healthy={ok}, startup_actions={actions}")
    if not ok:
        log('WARNING: MCP connection unavailable; ChatGPT task may be unable to operate')
        return 1
    return 0

if __name__=='__main__':
    sys.exit(main())
