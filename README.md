# AssistOS Explorer Agent

AssistOS Explorer is a lightweight, MCP-capable agent that serves as the primary file management and user interface hub within a Ploinky workspace. It provides an explorer-style web interface for browsing the filesystem, a powerful plugin architecture for extending its functionality, and specialized features for interacting with Markdown (`.md`) documents.

The UI is built on the **WebSkel** framework, and all filesystem operations are exposed securely via the Model Context Protocol (MCP).

---

## Key Features

-   **Web-Based File Explorer**: A clean and intuitive UI for browsing and managing files in your workspace.
-   **Extensible Plugin System**: Dynamically load custom plugins to add new features. Plugins can be triggered from the document, chapter, or paragraph level, allowing for highly contextual actions.
-   **Rich Document Handling**: Treats `.md` files not just as text, but as structured documents. This allows for advanced editing, interaction, and data persistence through embedded `soplang` commands.
-   **Blob Storage Service**: A content-addressable storage system for handling file uploads, accessible to other agents in the workspace.
-   **Secure MCP Tools**: Exposes a sandboxed set of filesystem tools (read, write, list, etc.) over MCP for other agents to use.

---

## Full Documentation

For a complete guide to the agent's architecture, plugin development, and advanced features, please see the **[Explorer Agent – Detailed Guide](./docs/index.html)**.

---

## Running with Ploinky

**Prerequisites:**
- Node.js 20+
- A running Ploinky workspace.

**Steps:**

1.  Enable the repository and the agent in **global** mode from your Ploinky workspace root. This ensures the UI loads assets directly from your checkout.
    ```bash
    p-cli enable repo fileExplorer
    p-cli enable agent fileExplorer/explorer global
    ```

2.  Start the workspace. The first run will install dependencies inside the container.
    ```bash
    p-cli start explorer 8080
    ```

3.  Access the Explorer UI via the router (the default port is 8080):
    -   `http://127.0.0.1:8080/explorer/index.html`

---

## MCP Endpoints

All filesystem features are exposed through MCP tools on the `/mcps/explorer/mcp` endpoint.

**Example: List root directory**
```bash
curl -s -X POST http://127.0.0.1:8080/mcps/explorer/mcp \
  -H 'Content-Type: application/json' \
  -d '{ "tool": "list_directory", "path": "/" }'
```
