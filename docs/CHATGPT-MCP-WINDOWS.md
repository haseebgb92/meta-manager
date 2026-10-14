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
