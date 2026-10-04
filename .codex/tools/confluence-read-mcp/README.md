# confluence-read-mcp

Read-only MCP server that gets a Confluence Cloud page by `pageId`, returns an allowlisted representation, and applies best-effort PII masking before exposing the result.

## Tool

- `get_masked_page` — accepts `{ "pageId": "123456" }`.

## Configuration

Copy `.env.example` to `.env` and set `CONFLUENCE_URL`, `CONFLUENCE_EMAIL`, and `CONFLUENCE_API_TOKEN`. Keep `.env` local and never commit it.

## Run

From the project root:

```powershell
npm install --prefix .codex/tools
npm run build --prefix .codex/tools
npm run start:confluence --prefix .codex/tools
```

Masking is pattern-based and is not a guarantee of complete anonymization.

## Connect to Codex

Requires Node.js 22 or newer available on `PATH`. Install dependencies and build from the project root as shown above before connecting.

Add this section to the project's `.codex/config.toml`, preserving any existing settings:

```toml
[mcp_servers.confluence-read-mcp]
command = "node"
args = ["--env-file=.env", "dist/index.js"]
 cwd = ".codex/tools/confluence-read-mcp"
```

The relative `cwd` is resolved from the project root. Node resolves `.env` and `dist/index.js` from this working directory. This avoids machine-specific absolute paths. Do not copy this relative path unchanged into a user-level Codex configuration.

Codex loads project configuration only for trusted projects. Restart the MCP connection or Codex after changing the configuration. Codex starts the server itself over stdio; a separate `npm start` process is not required.

In Codex CLI, run `codex mcp list` to inspect configured servers; use `/mcp` in the interactive CLI to inspect active connections.

See the official OpenAI documentation for [project configuration and relative paths](https://learn.chatgpt.com/docs/config-file/config-advanced) and [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Version control

- Commit the project `.codex/config.toml` only if it contains no secrets or machine-specific settings.
- Commit source files, `package.json`, the workspace `package-lock.json`, and `.env.example` with placeholder values.
- Do not commit real `.env` files, `node_modules`, or generated `dist` directories. The parent workspace `.gitignore` excludes these.
- After cloning, each developer creates their own local `.env`, installs dependencies, and builds the workspace.
