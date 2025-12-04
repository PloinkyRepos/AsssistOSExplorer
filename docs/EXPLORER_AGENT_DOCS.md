# Explorer Agent – Detailed Guide

This document explains how the **Explorer** agent works end‑to‑end: its runtime environment, backend and frontend architecture, MCP tools, blob storage, and the plugin system. It provides a comprehensive overview for developers looking to understand, extend, or interact with the Explorer agent.

---

## 1. What the Explorer Is

The Explorer is a multi-faceted agent that serves as the primary user interface and file management hub within the Ploinky workspace.

-   **A Containerised Agent**: It runs as a containerized Node.js application that serves a web-based UI and exposes a set of secure filesystem MCP (Model Context Protocol) tools.
-   **A Plugin Host**: It features a powerful plugin system. Any `IDE-plugins` directory found in enabled repositories is scanned at startup. The discovered plugins are then made available contextually (at the document, chapter, or paragraph level) within the UI.
-   **A Blob Service**: It includes a blob storage service for handling file uploads. The service is available at the `/blobs/:agentId` endpoint, storing files in a `blobs/` directory using content-addressable IDs for efficient storage and retrieval.
-   **A Document Manager**: It has specialized functionality for parsing and interacting with Markdown (`.md`) files, treating them as structured documents composed of chapters and paragraphs.

**High-Level Flow:**

```
User Browser (Web UI built on WebSkel)
    |
    | HTTP (Served by the Explorer container)
    v
Explorer Backend (filesystem-http-server.mjs)
    - Serves the static UI (HTML, JS, CSS)
    - Exposes MCP filesystem tools for other agents
    - Handles file uploads via the /blobs endpoint
    - Discovers plugins and serves their manifests to the UI
    |
    v
Workspace Filesystem (Mounted into the container)
```

---

## 2. Runtime and Routing

-   **Runtime**: The Explorer agent's container configuration is defined in `manifest.json`. This file specifies how the container runs, including mounting the workspace and the agent library.
-   **Routing**: The main Ploinky router (configured in `.ploinky/routing.json`) maps the `explorer` agent to a specific port on the host machine (e.g., 8082). The UI is accessed through this port.
-   **Inter-Agent Communication**: Other agents running in the same environment can communicate with the Explorer agent using its service name and the router port. For blob access, the URL format is typically `http://host.docker.internal:${PLOINKY_ROUTER_PORT || 8080}/blobs/explorer/<blobId>`.

---

## 3. Backend (`filesystem-http-server.mjs`)

The backend is a Node.js server with several key responsibilities:

-   **Static File Server**: Serves all static assets for the frontend application, including `index.html`, JavaScript files, CSS, and plugin assets.
-   **MCP Tool Provider**: Exposes a suite of MCP tools for filesystem operations (e.g., `read_text_file`, `write_file`, `list_directory`). These tools are the primary way other agents interact with the workspace filesystem.
-   **Security Layer**: Enforces a strict path-whitelisting policy (`allowedDirectories`) to prevent unauthorized file access and block path traversal attacks. Any request for a path outside the defined workspace is rejected.
-   **Plugin Discovery**: On startup, the server recursively scans all enabled repositories for `IDE-plugins/*/config.json` manifests. It aggregates these configurations into a single plugin catalog that is then sent to the frontend.
-   **Blob Storage Endpoint**: Manages file uploads via a `POST` endpoint at `/blobs/:agentId`. It calculates a content-based hash for each file, stores it in the `blobs/` directory, and returns a JSON object with the file's metadata (`id`, `filename`, `localPath`, `downloadUrl`, `mime`, `size`).

---

## 4. Frontend (WebSkel SPA)

The frontend is a Single-Page Application (SPA) located in the `explorer/` directory.

-   **Framework**: It is built using **WebSkel**, a lightweight, component-based framework. For more details, refer to the [WebSkel README](https://github.com/OutfinityResearch/WebSkel/blob/master/README.md).
-   **Component Structure**: UI components are defined in `explorer/webskel.json` and organized into `pages`, `components`, and `modals` within the `explorer/web-components/` directory.
-   **Presenters**: Each component is driven by a JavaScript presenter class. The presenter's constructor receives the component's `element` and an `invalidate` function. Calling `invalidate()` triggers a re-render of the component, making the UI reactive. Presenters must also implement `beforeRender()` and `afterRender()` lifecycle hooks.
-   **Plugin Integration**: The frontend is responsible for dynamically rendering plugin icons in the UI based on their specified `location` and for loading and instantiating the plugin's web component when a user interacts with it.

---

## 5. Managing and Editing `.md` Documents

A core feature of the Explorer agent is its specialized handling of Markdown (`.md`) files. Instead of treating them as plain text, Explorer parses them into a structured **Document Object Model**.

### 5.1. Structural Parsing
The primary goal is to transform static Markdown files into interactive, extensible documents. To achieve this, Explorer parses the `.md` file into a tree of **Chapters** (typically denoted by H1 or H2 headings) and **Paragraphs**. This hierarchical structure allows plugins to be highly context-aware. A plugin with `"location": ["paragraph"]` will appear on every paragraph, enabling actions on specific blocks of text.

### 5.2. Data Persistence via Soplang Commands
A key architectural concept is that **`.md` files are not just for storing human-readable text; they are also a persistence layer for structured data.** This is achieved by embedding `soplang` commands directly within the text.

-   **Syntax**: These commands follow a simple `@command` syntax. For example: `@command arg1 "value 1" arg2 "value 2"`.
-   **Use Case: Media Attachments**: The most common use case is for attaching media. When a user uploads an image, the following happens:
    1.  The file is sent to the **Blob Service**, which returns a unique, content-based `blobId`.
    2.  The plugin then uses the `documentModule` to insert a `soplang` command into the active paragraph. The command looks like this:
        ```
        @media_image_123 attach id "z2x...blobId...y9a" name "my-cat.png"
        ```
    3.  This entire line is saved as part of the `.md` file's content. It is both machine-readable and provides a hint to human readers.
-   **Parsing**: When Explorer loads a document, its parsing service (e.g., `mediaAttachmentUtils.js`) scans the text for these commands. It extracts the command and its arguments and makes them available to the frontend UI.
-   **Rendering**: The frontend uses this parsed data to render rich components. For instance, instead of displaying the raw `@media_image...` text, it will render an `<img>` tag pointing to the blob's URL.

This mechanism allows the `.md` file to be a self-contained, rich document that holds both formatted text and the structured data needed for interactive features.

### 5.3. Editing and State Management
When a user or plugin modifies a document, Explorer uses its Document Object Model to make targeted changes. Whether updating a paragraph's text or adding a `soplang` command, the `documentModule` ensures that the `.md` file is rewritten correctly, preserving both the text and the embedded commands.

---

## 6. The Plugin System

### Discovery
-   At server startup, Explorer scans all enabled repos for `IDE-plugins/*/config.json`.
-   These manifests are merged into a single plugin catalog sent to the client.

### Manifest (`config.json`)
```json
{
  "component": "my-plugin-component",
  "presenter": "MyPluginPresenter",
  "type": "modal",
  "location": ["chapter", "paragraph"],
  "tooltip": "A helpful tooltip for the icon",
  "icon": "./icon.svg"
}
```

### Plugin Folder Layout
```
IDE-plugins/
  my-plugin/
    config.json        # Manifest (required)
    my-plugin.js       # Presenter class
    my-plugin.html     # HTML template
    my-plugin.css      # Styles
    icon.svg           # Toolbar icon
```

---

## 7. Example: "Uppercase Paragraph" Plugin

This example demonstrates the correct structure of a WebSkel presenter, including the mandatory `beforeRender` and `afterRender` lifecycle methods.

1.  **Create Folder**: `IDE-plugins/uppercase/`
2.  **`config.json`**:
    ```json
    {
      "component": "uppercase-plugin",
      "presenter": "UppercasePlugin",
      "type": "modal",
      "location": ["paragraph"],
      "tooltip": "Uppercase paragraph",
      "icon": "./icon.svg"
    }
    ```
3.  **`uppercase-plugin.html`**:
    ```html
    <div class="modal-header">
      <div>Uppercase Paragraph</div>
      <div class="close" data-local-action="closeModal">&times;</div>
    </div>
    <div class="modal-body">
      <p>This will convert the paragraph with text: "<strong>${this.paragraph.text}</strong>" to uppercase.</p>
      <button class="general-button" data-local-action="apply">Apply</button>
    </div>
    ```
4.  **`uppercase-plugin.js`**:
    ```javascript
    import { getContextualElement } from "../utils/pluginUtils.js";
    const documentModule = assistOS.loadModule("document");

    export class UppercasePlugin {
      constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        // The invalidate call is crucial and should be done in the constructor.
        this.invalidate();
      }

      beforeRender() {
        // This method is called before the component's HTML is rendered.
        // We use it to get the contextual data (chapter and paragraph).
        const { chapter, paragraph } = getContextualElement(this.element);
        this.chapter = chapter;
        this.paragraph = paragraph;
      }

      afterRender() {
        // This method is called after the component's HTML has been rendered and inserted into the DOM.
        // It's the ideal place to add event listeners.
        const button = this.element.querySelector('[data-local-action="apply"]');
        button.addEventListener("click", this.apply.bind(this));
      }

      async apply() {
        const text = this.paragraph?.text || "";
        await documentModule.updateParagraphText(this.chapter.id, this.paragraph.id, text.toUpperCase());
        assistOS.UI.showToast("Paragraph updated successfully!", "success");
        this.closeModal();
      }

      closeModal() {
        assistOS.UI.closeModal(this.element);
      }
    }
    ```
5.  **Add `icon.svg`** and restart Explorer to see the plugin.

---

## 8. MCP Tools Exposed by Explorer

The Explorer agent exposes a secure API for file manipulation via MCP tools. Other agents should use these tools instead of attempting direct filesystem access.

-   **Common Tools**: `read_text_file`, `write_file`, `list_directory`, `stat`, `make_directory`, `delete_path`. (Check `filesystem-http-server.mjs` for the exact exported names).
-   **Security**: All tools are sandboxed and enforce the `allowedDirectories` configuration, ensuring that operations are confined to the intended workspace.

---

## 9. Development Tips

-   **Restart on Change**: You must restart the Explorer agent after adding, removing, or modifying a plugin's `config.json` to force the server to rebuild its plugin catalog.
-   **Use Blob IDs**: Store blob IDs, not full URLs, in document commands or plugin state. URLs can change and should be constructed on-demand using helpers like `blobUrl.buildBlobUrl`.
-   **Use the Document Module**: When modifying document content from a plugin, always use the `assistOS.loadModule("document")` functions to ensure data consistency and proper UI updates.
-   **Media Formats**: For plugins involving media processing (e.g., with ffmpeg), prefer standard formats like PNG, JPG, MP4, and MP3. SVG is often not supported in these pipelines.

---

## 10. Visual Cheatsheet (Repo Layout)

```
.../fileExplorer/explorer/
├─ filesystem-http-server.mjs   # Backend: MCP, Blob Service, Plugin Discovery
├─ index.html / main.js         # SPA entry point
├─ webskel.json                 # Defines the core UI components
├─ web-components/              # Implementation of core UI components
├─ IDE-plugins/                 # Location for plugins (discovered recursively)
│   └─ <plugin>/config.json
├─ services/                    # Frontend services, including document parsing
└─ utils/                       # Shared utilities for the frontend
```
