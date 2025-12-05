# Explorer Agent – Comprehensive Guide

This guide consolidates all Explorer documentation (architecture, document model, plugins, MCP tools, SOPLang integration, build pipeline, and development setup) in one place.

---

## 1) What Explorer Is

- **Containerized UI + FS MCP server**: Runs `filesystem-http-server.mjs` (Node 20-alpine) serving the WebSkel UI and filesystem MCP tools. Allowed roots come from `ASSISTOS_FS_ROOT`/`MCP_FS_ROOT` or CLI args.
- **Plugin host**: Discovers `IDE-plugins/*/config.json` across enabled repos; tools are exposed to the UI grouped by `location`.
- **Document manager**: Markdown is parsed into chapters/paragraphs with metadata and SOPLang commands.
- **No HTTP blob endpoint in current server**: UI helpers expect `/blobs/<agent>`, but `filesystem-http-server.mjs` only exposes MCP on `/mcp` and a `/health` check.
- **Auto-enabled deps**: Explorer manifest enables `soplang` and `multimedia` (same repo); avoid enabling duplicates manually.
- **Separate SOPLang agent**: `soplangAgent` (repo `SOPLangBuilder`) provides `soplang-tool` and `SoplangBuilder.buildFromMarkdown`; it runs in its own container sharing the workspace.

---

## 2) Runtime & Routing

- **Manifest**: `explorer/manifest.json` – `container: node:20-alpine`, `agent: node /code/filesystem-http-server.mjs`, `env: ["ASSISTOS_FS_ROOT"]`, `enable: ["soplang","multimedia"]`.
- **Global mode**: `p-cli enable agent fileExplorer/explorer global` runs in the current workspace folder. First `p-cli start explorer <port>` also pins the router/static port.
- **Router**: Ploinky router serves static UI and proxies MCP on the chosen port (e.g., 8080 → `/explorer/index.html`).
- **Allowed directories**: Derived from `ASSISTOS_FS_ROOT`/`MCP_FS_ROOT` (comma-separated). If missing, falls back to `process.cwd()`. Multiple roots → first is workspace root.
- **Containers & workspace**: Explorer and soplangAgent containers mount the same host workspace volume; each has its own MCP endpoints.

---

## 3) Architecture (textual)

- **Browser (WebSkel UI)** → **Ploinky Router** (static/proxy) → **Explorer container** (MCP filesystem tools) → **Workspace FS (allowed roots)**.
- **MCP clients** (UI/other agents) call Explorer MCP directly for filesystem tools.
- **soplangAgent container** (node:20-alpine, `soplang-tool`) receives MCP calls separately; it reads files directly from the mounted workspace.
- Both containers run independently; there is no hop Explorer → soplangAgent.

---

## 4) Document Model & Editing

- **View/Edit modes**: Any file can be opened; Markdown gets structured document features, other text/code files use the general editor (with syntax highlighting, no document DOM).
- **Hydration**: `DocumentStore.hydrateDocumentModel` parses Markdown plus comment markers into a hierarchy (document → chapters → paragraphs).
  - Example comment markers:
    - `<!--{"achiles-ide-document": {"id": "guide", "title": "My Guide"}}-->`
    - `<!--{"achiles-ide-chapter": {"title": "Intro"}}-->`
    - `<!--{"achiles-ide-paragraph": {"text": "Hello", "commands": "@media_image_123 attach id \"blob-id\" name \"hero.png\""}}-->`
- **Persistence via SOPLang commands**: Commands are embedded inline and preserved on save.
  - Example: `@media_image_123 attach id "blob-id" name "hero.png"` stays in the Markdown; UI renders the image using parsed data.
- **Document info**: Title and Info Text are stored in metadata (e.g., Title “Release Notes”, Info “Changelog for v1.2”).
- **Table of Contents**: Built from chapters; selecting an entry scrolls to that chapter.
- **Comments**: Stored per document/chapter/paragraph (e.g., “Clarify API version” attached to a paragraph).
- **References**: Stored in `references` array (e.g., title “RFC 9110”, URL set in references table).
- **Snapshots/Tasks/Variables**: Version snapshots, to-dos, and variables (e.g., `releaseVersion=1.2.0`) are part of the model; dialogs manage them.
- **Other files**: Open `config/app.json` or `src/main.js` with the general editor; no chapter/paragraph structure, only text + syntax highlight.

---

## 5) SOPLang Usage in Documents

- **Embed code**: Use fenced ` ```soplang ` blocks for scripts.
- **Achilles comments**: `achiles-ide-document/chapter/paragraph` markers map Markdown to the model and keep commands in sync.
- **Variables & media**: Commands like `@set doc_owner "alice@company.com"` or `@media_image_123 attach id "abcd" name "diagram.png"` live in the Markdown and are parsed on hydration.
- **Execution**: UI actions can run SOPLang blocks via soplangAgent; outputs/variable updates flow back into the model. Reload to re-hydrate after edits.
- **Flow fit**: Documents + SOPLang commands define structure; the build pipeline (below) persists them via soplangAgent.

---

## 6) Plugin System

- **Discovery**: MCP tool `collect_ide_plugins` calls `aggregateIdePlugins`, scanning enabled repos for `IDE-plugins/*/config.json` on each invocation (e.g., UI load). Results are grouped by `location`.
- **Manifest example**:
  ```json
  {
    "component": "video-creator",
    "presenter": "VideoCreator",
    "type": "modal",
    "location": ["document"],
    "tooltip": "Create a video from a script",
    "icon": "./assets/icons/video.svg"
  }
  ```
- **Example plugin (Uppercase paragraph)**: Folder `IDE-plugins/uppercase/` with `config.json`, `uppercase-plugin.html`, and presenter implementing `beforeRender/afterRender`, calling `documentModule.updateParagraphText` then showing a toast and closing the modal.
- **UI-only scaffold**: Plugins can be simple UI bundles with `manifest.json` and static assets (see “Plugins guide” in the site for full steps).

---

## 7) MCP Tools (Explorer)

Key tools exposed by `filesystem-http-server.mjs` (all enforce allowed directories): `read_text_file`, `read_media_file`, `read_multiple_files`, `write_file`, `write_binary_file`, `edit_file`, `create_directory`, `delete_file`, `delete_directory`, `list_directory`, `list_directory_with_sizes`, `list_directory_detailed`, `directory_tree`, `move_file`, `copy_file`, `search_files`, `get_file_info`, `collect_ide_plugins`, `list_allowed_directories`.

Endpoints: `/mcp` (MCP), `/health`. No `/blobs` HTTP upload/download in current code.

---

## 8) SOPLang Build (Markdown → Documents)

`SoplangBuilder.buildFromMarkdown` runs inside **soplangAgent** (repo `SOPLangBuilder`).

**Setup (from workspace root):**
- `p-cli enable repo SOPLangBuilder`
- `p-cli enable agent SOPLangBuilder/soplangAgent global`
- Start the agent (e.g., `p-cli start soplangAgent` if not running).

**Invoke:**
- MCP tool: `soplang-tool` (`soplangAgent/mcp-config.json`).
- Payload: `pluginName: "SoplangBuilder"`, `methodName: "buildFromMarkdown"`, optional `params: []`.
- Logs: `SOPLangBuilder/last-tool.log`; storage paths set in `soplangAgent/soplang-tool.sh` (`/persistoStorage`, `/persistoLogs`, `/persistoAudit`).

**Workflow (code-level):**
1. `pickRoot()` selects workspace root (`SOPLANG_WORKSPACE_ROOT` or cwd parents).
2. `walkMarkdown(root)` recursively finds `.md`, skipping common build/dev dirs.
3. `parseDocsFromMarkdown(content, filePath)` reads `achiles-ide-*` comments to build doc/chapter/paragraph templates.
4. For each doc: fetch/create via `Documents` plugin; clear chapters/paragraphs if existing; update metadata; `applyTemplate` to sync content.
5. `workspace.forceSave()` then `workspace.buildAll()` finalize persistence. Result includes counts, warnings, duration, errors.

---

## 9) Development & Setup

- **Prereqs**: Node 20+, npm, active Ploinky workspace.
- **Global run**: `p-cli enable repo fileExplorer` then `p-cli enable agent fileExplorer/explorer global`; start with `p-cli start explorer 8080` (router/UI on that port).
- **Filesystem root**: Set `ASSISTOS_FS_ROOT` (or `MCP_FS_ROOT`) to the workspace path(s); fallback is cwd. First root is workspace root.
- **Auto-enabled agents**: `soplang`, `multimedia` (from Explorer manifest).
- **Dependencies**: `npm install` at repo root (and `explorer/` if needed).
- **Hot reload**: UI refresh picks up most changes; plugin `config.json` or new plugins require Explorer restart to rescan. SOPLang comment edits are re-hydrated on reload; rerun `buildFromMarkdown` to persist into the SOPLang store.
- **Repo layout (Explorer)**:
  ```
  explorer/
  ├─ filesystem-http-server.mjs   # MCP, plugin discovery
  ├─ index.html / main.js         # SPA entry
  ├─ webskel.json                 # UI components
  ├─ web-components/              # UI implementations
  ├─ IDE-plugins/                 # Plugin location
  ├─ services/                    # Document parsing/services
  └─ utils/                       # Shared utilities
  ```

---

## 10) SOPLang Agent (overview)

- **Manifest**: `soplangAgent/manifest.json` – `container: node:20-alpine`, `postinstall: apk add ffmpeg`.
- **MCP tool**: `soplang-tool` (`soplangAgent/mcp-config.json`) with `pluginName`, `methodName`, `params`.
- **Plugins loaded**: SOPLang core plugins plus `plugins/SoplangBuilder.js` if present; log captured in `last-tool.log`.
- **Workspace access**: Reads markdown directly from mounted workspace; not dependent on Explorer backend.

---

## 11) General Notes

- Blob uploads: UI utilities target `/blobs/<agent>`, but the current Explorer server does not implement this HTTP endpoint. Plan workflows accordingly (or add server support if needed).
- MCP isolation: Call Explorer and soplangAgent independently; do not route soplang-tool through Explorer.
- View vs. edit: All files support both; structured features apply only to Markdown. Syntax highlighting is presentation only for code/text files.
