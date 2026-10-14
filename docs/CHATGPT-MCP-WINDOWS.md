# Connect Meta Manager to ChatGPT on Windows

**Required:** Meta Manager v0.1.22+, MCP Bridge v0.2.9+, an OpenAI Secure MCP Tunnel ID, and a Runtime API key created in the user's own OpenAI Platform workspace.

1. Install Meta Manager on a Windows x64 computer and connect the social accounts you are authorized to manage.
2. Open Meta Manager > Settings and verify **MCP service: Online**. This service is local-only at `http://127.0.0.1:38939/mcp`.
3. Install MCP Bridge on the **same PC**, then open Connection Settings.
4. Paste an OpenAI Runtime API key and an unused **Meta Manager tunnel ID** (`tunnel_` followed by 32 hexadecimal characters). Use a different tunnel ID from Local Files or Web MCP.
5. Choose **Save settings** and **Start Meta**. The Bridge checks Meta Manager is running before starting the tunnel.
6. In ChatGPT, use the tunnel connection associated with that ID to access the Meta Manager MCP tools. No local HTTP port forwarding is needed.
7. Optionally enable **Start Meta Manager MCP automatically**, but ensure Meta Manager starts before Bridge so its local service is ready.

Do not paste Runtime API keys into chat or put them in installer files. The Bridge's built-in tunnel client and Node runtime run the schema-transparent Meta Manager proxy, which passes the latest MCP tools through the secure tunnel. Cloud-scheduled jobs run independently of the PC after cloud enrollment, but **ChatGPT's local MCP tools require Meta Manager and the Bridge to be running**.

The installer does **not** configure social accounts or issue OpenAI tunnel IDs automatically. Account permissions, tunnel creation and the actual ChatGPT connection require the user's authorization.
## Error reporting for Windows

Meta Manager v0.1.24+ writes categorized failures to `%APPDATA%\\com.advertpreneur.metamanager\\diagnostics.jsonl`. Each record contains only its origin, failure category, optional HTTP status and timestamp. It intentionally excludes OAuth codes, states, tokens, accounts, URLs and raw exception text.

MCP Bridge v0.2.11+ reads this local file alongside its own categorized tunnel failures from **Support diagnostics → Generate report**. Select **Open GitHub issue draft** only after reviewing the report. The issue is not submitted automatically and requires access to the private Meta Manager repository. If GitHub is unavailable, copy the sanitized report to a secure support channel instead.
## Windows repair and social-login updates (v0.1.25)

- If Bridge reports "Meta Manager local MCP: not reachable", open Meta Manager **Settings → Connect ChatGPT — MCP → Restart / repair local MCP**. Confirm **Online** before selecting **Start Meta** in MCP Bridge.
- The app now checks the HTTP health response from the actual Meta Manager server rather than assuming an arbitrary open port is healthy.
- The bundled service has fallback resource paths for alternate NSIS installations; if startup fails, Settings displays the failure from the local startup log.
- Facebook, Instagram and LinkedIn callback listeners now reject unrelated browser requests without consuming the authorization attempt.
- LinkedIn's authorization request includes the officially supported `enable_extended_login=true` parameter to request Google/Apple/passkey login choices in external browsers. LinkedIn decides which options it displays.
- Logs are still local by default; use MCP Bridge → Support diagnostics to review categorized failures and optionally open a private GitHub issue draft.
## Windows MCP startup unblock (v0.1.26)

Windows GitHub CI reproduced a launched desktop app with no running MCP listener or MCP startup log. The previous initialization sequence invoked Windows localhost-certificate import synchronously **before** launching MCP. v0.1.26 removes certificate operations from desktop startup: the MCP listener initializes independently; trust configuration is attempted only when starting Facebook or Instagram authorization, and any Windows certificate-import process has a bounded timeout. Windows CI verifies this by launching the packaged desktop executable and querying `/health`, not just running the standalone Node script.
## Windows Node argument-path correction (v0.1.27)

A stronger NSIS extracted-desktop integration test found that Windows Node startup failed with `EISDIR: lstat 'D:'` when the desktop app invoked a bundled MCP script via its absolute resource path. The service launcher now sets its working directory to the script resource directory and passes only the script filename as the Node argument. The Windows workflow requires the extracted desktop app to respond successfully at `http://127.0.0.1:38939/health` before publishing a release.
## Instagram authorization callback test (v0.1.28)

The Instagram Business Login consent page redirects the browser to the local HTTPS listener at `https://127.0.0.1:38937/oauth/instagram/callback`. If it displays "page might have moved" after **Allow**, the app may never receive the callback.

While the Instagram connection is still waiting, click **Test Instagram browser callback**. A separate browser tab opens `https://127.0.0.1:38937/health`, which must say **Meta Manager Instagram callback is reachable**. This test does not consume or cancel OAuth authorization. If the test fails, inspect the browser's general error code (for example, connection refused or certificate authority), and check Windows certificate trust and local security software. A browser restart may be necessary after certificate trust is first installed.

Meta Manager records a privacy-safe TLS failure category when HTTPS negotiation fails, and a network-connection category if the Instagram authorization never returns. Generate a report in MCP Bridge, but never paste or upload the final callback URL or its `code`/`state` parameters; they are sensitive and short-lived. Successful OAuth still uses the registered redirect URL.
