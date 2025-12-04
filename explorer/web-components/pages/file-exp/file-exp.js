import { unescapeHtmlEntities } from "../../../imports.js";
import { stripAchilesComments as stripDocumentComments } from "../../../services/document/markdownDocumentParser.js";

export class FileExp {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;

        this.boundPreviewAnchorHandler = this.handlePreviewAnchorClick.bind(this);

        this.state = {
            path: '/',
            includeHidden: this.loadHiddenPreference(),
            entries: [],
            selectedPath: null,
            fileContent: "",
            previewContent: "",
            selectedIsMarkdown: false,
            markdownTextView: false,
            documentId: null,
            isEditing: false,
            isResizing: false,
            clipboard: null,
            openMenuPath: null
        };
        this.pendingMenuFocusPath = null;

        this.boundLoadStateFromURL = this.loadStateFromURL.bind(this);
        window.addEventListener('popstate', this.boundLoadStateFromURL);
        this.invalidate(this.boundLoadStateFromURL);

        this.boundOutsideMenuClick = this.handleOutsideMenuClick.bind(this);
        this.boundMenuKeydown = this.handleMenuKeydown.bind(this);
        this.outsideMenuListenerAttached = false;
        this.menuKeydownListenerAttached = false;
    }

    async withLoader(fn) {
        const webSkel = window.webSkel;
        const hasLoader = Boolean(webSkel?.showLoading) && Boolean(webSkel?.hideLoading);
        const loaderId = hasLoader ? webSkel.showLoading() : null;
        try {
            return await fn();
        } finally {
            if (hasLoader) {
                webSkel.hideLoading(loaderId);
            }
        }
    }

    beforeUnload() {
        window.removeEventListener('popstate', this.boundLoadStateFromURL);
        this.detachPreviewAnchorHandler();
        if (this.outsideMenuListenerAttached) {
            document.removeEventListener('click', this.boundOutsideMenuClick);
            this.outsideMenuListenerAttached = false;
        }
        if (this.menuKeydownListenerAttached) {
            document.removeEventListener('keydown', this.boundMenuKeydown);
            this.menuKeydownListenerAttached = false;
        }
    }

    async loadStateFromURL() {
        const path = window.location.hash.split('#file-exp')[1] || '/';

        if (path === '/') {
            await this.loadDirectory('/');
            return;
        }

        if (this.state.isEditing) {
            await this.cancelEdit();
        }

        try {
            const contentResult = await window.webSkel.appServices.callTool('explorer', 'read_text_file', {path: path});

            if (contentResult.text.startsWith('Error:')) {
                throw new Error(contentResult.text);
            }

            const parentDir = this.parentPath(path) || '/';
            this.state.path = parentDir;
            this.state.entries = await this.loadDirectoryContent(parentDir);
            this.state.selectedPath = path;
            this.state.isEditing = false;
            await this.openFile(path);
        } catch (e) {
            // If it fails, it's a directory
            await this.loadDirectory(path);
        }
    }

    beforeRender() {
        const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-folder-fill" viewBox="0 0 16 16">
  <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.95 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
</svg>`;
        const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-file-earmark-fill" viewBox="0 0 16 16">
  <path d="M4 0h5.5v1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h1V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z"/>
  <path d="M9.5 3.5 14 8V3.5A1.5 1.5 0 0 0 12.5 2H9.5v1.5z"/>
</svg>`;

        this.entriesHTML = "";
        const filtered = this.state.entries.filter(entry => this.state.includeHidden || !entry.name.startsWith('.'));
        if (filtered.length === 0) {
            this.entriesHTML = `<tr><td colspan="5">Empty directory.</td></tr>`;
        } else {
            const clipboard = this.state.clipboard;
            filtered.forEach((entry, index) => {
                const entryPath = this.joinPath(this.state.path, entry.name);
                const icon = entry.type === 'directory' ? folderIcon : fileIcon;
                const entryAttributes = `data-entry-path="${entryPath}" data-type="${entry.type}"`;
                const isClipboardSource = clipboard?.path === entryPath;
                const clipboardAttr = isClipboardSource ? ` data-clipboard="${clipboard.mode}"` : '';
                const rowClasses = [];
                if (this.state.selectedPath === entryPath) {
                    rowClasses.push('active');
                }
                const classAttr = rowClasses.length ? ` class="${rowClasses.join(' ')}"` : '';
                const isMenuOpen = this.state.openMenuPath === entryPath;
                const actionMenuClass = `action-menu-container${isMenuOpen ? ' open' : ''}`;
                const menuId = `action-menu-${index}`;
                const canPasteInto = Boolean(clipboard) && entry.type === 'directory';
                const pasteMenuItem = entry.type === 'directory' ? `
                                    <button type="button" class="action-menu-item${canPasteInto ? '' : ' disabled'}" data-local-action="pasteClipboard" ${entryAttributes}
                                            data-target-path="${entryPath}" role="menuitem" ${canPasteInto ? '' : 'disabled'}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="action-menu-item-icon" viewBox="0 0 16 16" aria-hidden="true">
                                            <path d="M4 1.5A1.5 1.5 0 0 1 5.5 0h5A1.5 1.5 0 0 1 12 1.5V3h1.5A1.5 1.5 0 0 1 15 4.5v9A1.5 1.5 0 0 1 13.5 15h-7A1.5 1.5 0 0 1 5 13.5V12h3.5A1.5 1.5 0 0 0 10 10.5v-7A1.5 1.5 0 0 0 8.5 2H7V1.5A.5.5 0 0 0 6.5 1h-1a.5.5 0 0 0-.5.5V2H4v-.5z"/>
                                            <path d="M6.5 13a.5.5 0 0 1-.5-.5V5A1.5 1.5 0 0 1 7.5 3.5h1A1.5 1.5 0 0 1 10 5v5.5a.5.5 0 0 1-.5.5H6v1a.5.5 0 0 1-.5.5z"/>
                                        </svg>
                                        <span class="action-menu-item-label">Paste into</span>
                                    </button>
                ` : '';
                this.entriesHTML += `
                    <tr${classAttr}${clipboardAttr} data-entry-path="${entryPath}" data-type="${entry.type}">
                        <td ${entryAttributes} data-local-action="selectEntry"><span class="icon">${icon}</span> ${entry.name}</td>
                        <td ${entryAttributes} data-local-action="selectEntry">${entry.type}</td>
                        <td ${entryAttributes} data-local-action="selectEntry">${entry.type === 'directory' ? '—' : this.formatBytes(entry.size)}</td>
                        <td ${entryAttributes} data-local-action="selectEntry">${entry.modified ? this.formatDate(entry.modified) : '—'}</td>
                        <td class="actions-cell">
                            <div class="${actionMenuClass}" data-action-menu="true" data-entry-path="${entryPath}">
                                <button type="button" class="secondary action-menu-trigger" data-local-action="toggleActionMenu" ${entryAttributes}
                                        aria-haspopup="true" aria-expanded="${isMenuOpen ? 'true' : 'false'}" aria-controls="${menuId}" title="More actions">
                                    <img class="action-menu-trigger-icon" loading="lazy" src="./assets/icons/action-dots.svg" alt="More actions">
                                </button>
                                <div class="action-menu-dropdown" id="${menuId}" role="menu">
                                    <button type="button" class="action-menu-item" data-local-action="renameEntry" ${entryAttributes} role="menuitem">
                                        <img class="action-menu-item-icon" loading="lazy" src="./assets/icons/edit.svg" alt="">
                                        <span class="action-menu-item-label">Rename</span>
                                    </button>
                                    <button type="button" class="action-menu-item" data-local-action="copyEntry" ${entryAttributes} role="menuitem">
                                        <img class="action-menu-item-icon" loading="lazy" src="./assets/icons/copy.svg" alt="">
                                        <span class="action-menu-item-label">Copy</span>
                                    </button>
                                    <button type="button" class="action-menu-item" data-local-action="cutEntry" ${entryAttributes} role="menuitem">
                                        <img class="action-menu-item-icon" loading="lazy" src="./assets/icons/cut.svg" alt="">
                                        <span class="action-menu-item-label">Cut</span>
                                    </button>
                                    ${pasteMenuItem}
                                    <button type="button" class="action-menu-item destructive" data-local-action="deleteEntry" ${entryAttributes} role="menuitem">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="action-menu-item-icon" viewBox="0 0 16 16" aria-hidden="true">
                                            <path d="M5.5 5.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 .5-.5zm2.5.5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0v-6zm3-.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 .5-.5z"/>
                                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1h-1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-1a1 1 0 0 1 0-2h4.5l1-1h3l1 1H14a1 1 0 0 1 1 1zm-3 1H4v9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4z"/>
                                        </svg>
                                        <span class="action-menu-item-label">Delete</span>
                                    </button>
                                </div>
                            </div>
                        </td>
                    </tr>`;
            });
        }
    }

    async afterRender() {
        this.renderBreadcrumbs();
        if (this.state.selectedPath) {
            const row = this.element.querySelector(`[data-entry-path="${this.state.selectedPath}"]`);
            if (row) {
                row.classList.add('active');
            }
        }

        const hiddenToggle = this.element.querySelector('#hiddenToggle');
        if (hiddenToggle) {
            hiddenToggle.checked = this.state.includeHidden;
        }

        const editorActions = this.element.querySelector("#editorActions");
        const editingActions = this.element.querySelector("#editingActions");

        if (this.state.isEditing) {
            editorActions.classList.add('hidden');
            editingActions.classList.remove('hidden');
        } else {
            editingActions.classList.add('hidden');
            if (this.state.selectedPath) {
                editorActions.classList.remove('hidden');
            } else {
                editorActions.classList.add('hidden');
            }
        }

        const previewContent = this.element.querySelector('.preview-content');
        if (this.state.isEditing) {
            this.detachPreviewAnchorHandler();
            if (this.state.selectedIsMarkdown && this.state.documentId) {
                previewContent.innerHTML = `<document-view-page data-presenter="document-view-page" data-path="${this.state.selectedPath}" documentId="${this.state.documentId}"></document-view-page>`;
            } else {
                previewContent.innerHTML = `<file-editor data-presenter="file-editor" data-path="${this.state.selectedPath}"></file-editor>`;
            }
        } else if (this.state.selectedIsMarkdown) {
            if (this.state.markdownTextView) {
                previewContent.innerHTML = `<pre id="filePreview" class="markdown-raw-view"></pre>`;
                const filePreview = this.element.querySelector("#filePreview");
                if (this.state.selectedPath) {
                    filePreview.textContent = this.state.fileContent;
                } else {
                    filePreview.textContent = "Select a file to see its contents.";
                }
                this.detachPreviewAnchorHandler();
            } else {
                previewContent.innerHTML = `<div id="filePreview" class="markdown-preview"></div>`;
                const filePreview = this.element.querySelector("#filePreview");
                if (this.state.selectedPath) {
                    filePreview.innerHTML = this.state.previewContent;
                } else {
                    filePreview.textContent = "Select a file to see its contents.";
                }
                this.attachPreviewAnchorHandler();
            }
        } else {
            previewContent.innerHTML = `<pre id="filePreview"></pre>`;
            const filePreview = this.element.querySelector("#filePreview");
            if (this.state.selectedPath) {
                filePreview.textContent = this.state.previewContent;
            } else {
                filePreview.textContent = "Select a file to see its contents.";
            }
            this.detachPreviewAnchorHandler();
        }

        const toggleListButton = this.element.querySelector('#toggleListButton');
        const listPanel = this.element.querySelector('.list');

        const updateToggleState = () => {
            const collapsed = listPanel.classList.contains('collapsed');
            toggleListButton.setAttribute('aria-expanded', String(!collapsed));
            toggleListButton.setAttribute('title', collapsed ? 'Expand directory panel' : 'Collapse directory panel');
            toggleListButton.setAttribute('aria-label', collapsed ? 'Expand directory panel' : 'Collapse directory panel');
        };

        if (!toggleListButton.dataset.bound) {
            toggleListButton.addEventListener('click', () => {
                listPanel.classList.toggle('collapsed');
                updateToggleState();
            });
            toggleListButton.dataset.bound = 'true';
        }
        updateToggleState();

        const resizer = this.element.querySelector('#resizer');
        let startX = 0;
        let startWidth = 0;

        const handleMouseMove = (e) => {
            if (!this.state.isResizing) return;
            const newWidth = startWidth + (e.clientX - startX);
            if (newWidth > 200) {
                listPanel.style.width = `${newWidth}px`;
            }
        };

        const handleMouseUp = () => {
            this.state.isResizing = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        const handleMouseDown = (e) => {
            e.preventDefault();
            startX = e.clientX;
            startWidth = listPanel.offsetWidth;
            this.state.isResizing = true;
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        };

        if (resizer && !resizer.dataset.bound) {
            resizer.addEventListener('mousedown', handleMouseDown);
            resizer.dataset.bound = 'true';
        }

        const saveButton = this.element.querySelector('#saveButton');
        if (saveButton) {
            if (this.state.selectedIsMarkdown) {
                saveButton.classList.add('hidden');
            } else {
                saveButton.classList.remove('hidden');
            }
        }

        const cancelButton = this.element.querySelector('#cancelButton');
        if (cancelButton) {
            cancelButton.textContent = this.state.selectedIsMarkdown ? 'Close' : 'Cancel';
        }

        const markdownViewActions = this.element.querySelector('#markdownViewActions');
        const toggleMarkdownViewButton = this.element.querySelector('#toggleMarkdownViewButton');
        if (markdownViewActions && toggleMarkdownViewButton) {
            if (!this.state.isEditing && this.state.selectedIsMarkdown && this.state.selectedPath) {
                markdownViewActions.classList.remove('hidden');
                toggleMarkdownViewButton.textContent = this.state.markdownTextView ? 'View as preview' : 'View as text';
            } else {
                markdownViewActions.classList.add('hidden');
            }
        }

        const fileNameLabel = this.element.querySelector('#editorFileName');
        if (fileNameLabel) {
            const fallbackName = this.state.selectedPath ? this.state.selectedPath.split('/').pop() : '';
            fileNameLabel.textContent = fallbackName;
        }

        const clipboard = this.state.clipboard;
        const clearClipboardButton = this.element.querySelector('#clearClipboardButton');
        if (clearClipboardButton) {
            if (clipboard) {
                clearClipboardButton.removeAttribute('disabled');
            } else {
                clearClipboardButton.setAttribute('disabled', 'true');
            }
        }

        const clipboardGroup = this.element.querySelector('.clipboard-group');
        const clipboardInfo = this.element.querySelector('#clipboardInfo');
        if (clipboardInfo && clipboardGroup) {
            if (clipboard) {
                clipboardInfo.textContent = `${clipboard.mode === 'cut' ? 'Cut' : 'Copy'}: ${clipboard.name}`;
                clipboardInfo.classList.add('visible');
                clipboardGroup.classList.add('visible');
            } else {
                clipboardInfo.textContent = '';
                clipboardInfo.classList.remove('visible');
                clipboardGroup.classList.remove('visible');
            }
        }

        if (clipboard?.path) {
            const clipboardRow = this.element.querySelector(`tr[data-entry-path="${clipboard.path}"]`);
            if (clipboardRow) {
                clipboardRow.classList.add('clipboard-row');
                clipboardRow.classList.toggle('clipboard-cut', clipboard.mode === 'cut');
                clipboardRow.classList.toggle('clipboard-copy', clipboard.mode === 'copy');
            }
        }

        if (this.state.openMenuPath) {
            if (!this.outsideMenuListenerAttached) {
                document.addEventListener('click', this.boundOutsideMenuClick);
                this.outsideMenuListenerAttached = true;
            }
            if (!this.menuKeydownListenerAttached) {
                document.addEventListener('keydown', this.boundMenuKeydown);
                this.menuKeydownListenerAttached = true;
            }
        } else {
            if (this.outsideMenuListenerAttached) {
                document.removeEventListener('click', this.boundOutsideMenuClick);
                this.outsideMenuListenerAttached = false;
            }
            if (this.menuKeydownListenerAttached) {
                document.removeEventListener('keydown', this.boundMenuKeydown);
                this.menuKeydownListenerAttached = false;
            }
        }

        if (this.pendingMenuFocusPath && this.state.openMenuPath === this.pendingMenuFocusPath) {
            const menuContainer = this.element.querySelector(`[data-action-menu="true"][data-entry-path="${this.state.openMenuPath}"]`);
            const firstItem = menuContainer?.querySelector('.action-menu-item');
            if (firstItem) {
                firstItem.focus();
            }
            this.pendingMenuFocusPath = null;
        } else if (!this.state.openMenuPath) {
            this.pendingMenuFocusPath = null;
        }
    }

    async loadDirectoryContent(path) {
        try {
            const result = await window.webSkel.appServices.callTool('explorer', 'list_directory_detailed', {path});
            const entries = this.parseDetailedDirectoryListing(result.text);
            return entries.map(entry => ({
                ...entry,
                path: this.joinPath(path, entry.name)
            }));
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to load directory.', true);
            return [];
        }
    }

    async loadDirectory(path = this.state.path) {
        await this.withLoader(async () => {
            if (this.state.isEditing) {
                await this.cancelEdit();
            }
            this.state.path = this.normalizePath(path);
            this.state.selectedPath = null;
            this.state.fileContent = "";
            this.state.previewContent = "";
            this.state.selectedIsMarkdown = false;
            this.state.markdownTextView = false;
            this.state.documentId = null;
            this.state.isEditing = false;
            this.state.openMenuPath = null;
            this.pendingMenuFocusPath = null;
            this.state.entries = await this.loadDirectoryContent(this.state.path);
            this.invalidate();
        });
    }

    async selectEntry(element) {
        const path = element.dataset.entryPath;
        const type = element.dataset.type;

        if (this.state.openMenuPath) {
            this.state.openMenuPath = null;
            this.pendingMenuFocusPath = null;
        }

        if (this.state.isEditing) {
            if (!confirm("You have unsaved changes. Are you sure you want to navigate away?")) {
                return;
            }
            await this.cancelEdit();
        }

        const newUrl = `#file-exp${path}`;
        history.pushState(null, '', newUrl);

        if (type === 'directory') {
            await this.loadDirectory(path);
        } else if (type === 'file') {
            this.state.selectedPath = path;
            await this.openFile(path);
        }
    }

    async openFile(filePath) {
        try {
            const contentResult = await window.webSkel.appServices.callTool('explorer', 'read_text_file', {path: filePath});
            this.state.fileContent = contentResult.text;
            this.state.selectedIsMarkdown = this.isMarkdownFile(filePath);
            this.state.markdownTextView = false;
            this.state.documentId = null;
            if (this.state.selectedIsMarkdown) {
                const previewSource = this.prepareMarkdownPreviewContent(this.state.fileContent);
                this.state.previewContent = this.renderMarkdownPreview(previewSource);
                this.state.markdownTextView = false;
                try {
                    const documentModule = window.assistOS?.loadModule?.('document');
                    if (documentModule) {
                        const doc = await documentModule.loadDocument(filePath);
                        this.state.documentId = doc?.id ?? null;
                        if (doc?.id) {
                            window.assistOS.workspace.currentDocumentId = doc.id;
                            window.assistOS.workspace.currentDocumentPath = filePath;
                        }
                    }
                } catch (docError) {
                    console.warn('Failed to load document module for', filePath, docError);
                    this.state.documentId = null;
                }
            } else {
                this.state.previewContent = this.state.fileContent;
                this.state.markdownTextView = false;
            }
            this.invalidate();
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to read file.', true);
        }
    }

    async editFile() {
        if (!this.state.selectedPath) return;
        if (this.state.selectedIsMarkdown && !this.state.documentId) {
            try {
                const documentModule = window.assistOS?.loadModule?.('document');
                if (documentModule) {
                    const doc = await documentModule.loadDocument(this.state.selectedPath);
                    this.state.documentId = doc?.id ?? null;
                }
            } catch (error) {
                console.warn('Failed to prepare document editor', error);
            }
        }
        this.state.markdownTextView = false;
        this.state.isEditing = true;
        this.invalidate();
    }

    async saveFile() {
        this.textarea = this.element.querySelector('.code-input');
        if (!this.textarea) {
            return;
        }

        const newContent = this.textarea.value;
        try {
            await window.webSkel.appServices.callTool('explorer', 'write_file', {path: this.state.selectedPath, content: newContent});
            this.showStatus(`Successfully saved ${this.state.selectedPath}`, false);
            this.state.fileContent = newContent;

            if (this.state.selectedIsMarkdown) {
                const previewSource = this.prepareMarkdownPreviewContent(newContent);
                this.state.previewContent = this.renderMarkdownPreview(previewSource);
                this.state.markdownTextView = false;
                try {
                    const documentModule = window.assistOS?.loadModule?.('document');
                    if (documentModule) {
                        const doc = await documentModule.loadDocument(this.state.selectedPath);
                        this.state.documentId = doc?.id ?? null;
                        if (doc?.id) {
                            window.assistOS.workspace.currentDocumentId = doc.id;
                            window.assistOS.workspace.currentDocumentPath = this.state.selectedPath;
                        }
                    }
                } catch (docError) {
                    console.warn('Failed to refresh document after save', docError);
                }
            } else {
                this.state.previewContent = newContent;
            }

            this.state.isEditing = false;
            this.editorPresenter = null;
            this.invalidate();
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to save file.', true);
        }
    }

    async cancelEdit() {
        this.state.isEditing = false;
        this.state.markdownTextView = false;
        this.editorPresenter = null;
        if (this.state.selectedIsMarkdown && this.state.selectedPath) {
            await this.openFile(this.state.selectedPath);
            return;
        }
        this.invalidate();
    }

    async deleteEntry(element) {
        const path = element.dataset.entryPath;
        const type = element.dataset.type;

        this.closeActionMenu();

        if (!confirm(`Are you sure you want to delete ${path}?`)) {
            return;
        }

        try {
            await this.withLoader(async () => {
                const tool = type === 'directory' ? 'delete_directory' : 'delete_file';
                await window.webSkel.appServices.callTool('explorer', tool, {path: path});
                this.showStatus(`Successfully deleted ${path}`);

                if (this.state.selectedPath === path) {
                    this.state.selectedPath = null;
                    this.state.fileContent = "";
                }
                if (this.state.clipboard?.path === path) {
                    this.state.clipboard = null;
                }

                await this.loadDirectory(this.state.path);
            });
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to delete.', true);
        }
    }

    async renameEntry(element) {
        const source = element?.dataset?.entryPath;
        if (!source) {
            return;
        }
        this.closeActionMenu();
        const itemType = element.dataset.type;
        const currentName = source.split('/').pop();
        const input = prompt(`Enter a new name for "${currentName}":`, currentName);
        if (input === null) {
            return;
        }
        const newName = this.sanitizeEntryName(input);
        if (!newName) {
            this.showStatus('Please enter a valid name.', true);
            return;
        }
        if (newName === currentName) {
            return;
        }
        const parent = this.parentPath(source) || '/';
        const destination = this.joinPath(parent, newName);
        if (destination === source) {
            return;
        }
        try {
            await this.withLoader(async () => {
                await window.webSkel.appServices.callTool('explorer', 'move_file', { source, destination });
                const wasSelected = this.state.selectedPath === source;
                if (this.state.clipboard?.path === source) {
                    this.state.clipboard = { ...this.state.clipboard, path: destination, name: newName };
                }
                this.state.entries = await this.loadDirectoryContent(this.state.path);
                this.showStatus(`Renamed "${currentName}" to "${newName}".`);
                if (wasSelected) {
                    this.state.selectedPath = destination;
                    history.replaceState(null, '', `#file-exp${destination}`);
                    if (itemType === 'file') {
                        await this.openFile(destination);
                        return;
                    }
                }
                this.invalidate();
            });
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to rename entry.', true);
        }
    }

    copyEntry(element) {
        const path = element?.dataset?.entryPath;
        if (!path) {
            return;
        }
        this.closeActionMenu(false);
        const name = path.split('/').pop();
        this.state.clipboard = {
            mode: 'copy',
            path,
            name,
            type: element.dataset.type
        };
        this.showStatus(`Copied "${name}" to clipboard.`);
        this.invalidate();
    }

    cutEntry(element) {
        const path = element?.dataset?.entryPath;
        if (!path) {
            return;
        }
        this.closeActionMenu(false);
        const name = path.split('/').pop();
        this.state.clipboard = {
            mode: 'cut',
            path,
            name,
            type: element.dataset.type
        };
        this.showStatus(`Ready to move "${name}".`);
        this.invalidate();
    }

    toggleActionMenu(element, maybeEvent) {
        if (maybeEvent?.stopPropagation) {
            maybeEvent.stopPropagation();
        }
        if (maybeEvent?.preventDefault) {
            maybeEvent.preventDefault();
        }
        const path = element?.dataset?.entryPath;
        if (!path) {
            return;
        }
        const previous = this.state.openMenuPath;
        const next = previous === path ? null : path;
        this.state.openMenuPath = next;
        this.pendingMenuFocusPath = next;
        this.invalidate();
    }

    handleOutsideMenuClick(event) {
        if (!this.state.openMenuPath) {
            return;
        }
        const target = event?.target;
        if (target && this.element.contains(target)) {
            const menu = target.closest('[data-action-menu="true"]');
            if (menu && menu.dataset.entryPath === this.state.openMenuPath) {
                return;
            }
        }
        this.closeActionMenu();
    }

    handleMenuKeydown(event) {
        if (event?.key === 'Escape' && this.state.openMenuPath) {
            this.closeActionMenu();
        }
    }

    closeActionMenu(shouldInvalidate = true) {
        if (!this.state.openMenuPath) {
            return false;
        }
        this.pendingMenuFocusPath = null;
        this.state.openMenuPath = null;
        if (shouldInvalidate) {
            this.invalidate();
        }
        return true;
    }

    clearClipboard() {
        if (!this.state.clipboard) {
            return;
        }
        const previous = this.state.clipboard.name;
        this.state.clipboard = null;
        this.showStatus(previous ? `Cleared clipboard (was "${previous}").` : 'Clipboard cleared.');
        this.invalidate();
    }

    async pasteClipboard(element) {
        const clipboard = this.state.clipboard;
        if (!clipboard) {
            this.showStatus('Clipboard is empty.', true);
            return;
        }

        const targetPathRaw = element?.dataset?.targetPath || this.state.path;
        const targetDir = this.normalizePath(targetPathRaw);
        const targetIsCurrentDirectory = targetDir === this.state.path;
        const sourceParent = this.parentPath(clipboard.path) || '/';

        this.closeActionMenu(false);

        let targetEntries = [];
        if (targetIsCurrentDirectory) {
            targetEntries = this.state.entries;
        } else {
            targetEntries = await this.loadDirectoryContent(targetDir);
        }
        const existingNames = new Set(targetEntries.map((entry) => entry.name));

        const defaultName = clipboard.mode === 'copy'
            ? this.generateCopyName(clipboard.name, existingNames)
            : clipboard.name;
        const promptLabel = clipboard.mode === 'copy'
            ? `Enter a name for the copied ${clipboard.type === 'directory' ? 'folder' : 'file'}:`
            : `Enter a name for the moved ${clipboard.type === 'directory' ? 'folder' : 'file'}:`;
        const input = prompt(promptLabel, defaultName);
        if (input === null) {
            return;
        }
        const desiredName = this.sanitizeEntryName(input);
        if (!desiredName) {
            this.showStatus('Please enter a valid name.', true);
            return;
        }

        const destination = this.joinPath(targetDir, desiredName);
        const wasSelectedFile = this.state.selectedPath === clipboard.path && clipboard.type === 'file';
        const existsInTarget = existingNames.has(desiredName);
        const normalizedSource = this.normalizePath(clipboard.path);
        const normalizedDestination = this.normalizePath(destination);

        if (normalizedDestination === normalizedSource) {
            this.showStatus('Destination matches the source.', true);
            return;
        }

        if (clipboard.type === 'directory' && normalizedDestination.startsWith(`${normalizedSource}/`)) {
            this.showStatus('Cannot paste a folder into itself or one of its subfolders.', true);
            return;
        }

        if (clipboard.mode === 'cut' && existsInTarget) {
            this.showStatus(`"${desiredName}" already exists in the target directory.`, true);
            return;
        }

        try {
            await this.withLoader(async () => {
                if (clipboard.mode === 'cut') {
                    await window.webSkel.appServices.callTool('explorer', 'move_file', {
                        source: clipboard.path,
                        destination
                    });
                    this.state.clipboard = null;
                    this.showStatus(`Moved to ${destination}.`);
                } else {
                    let overwrite = false;
                    if (existsInTarget) {
                        const shouldOverwrite = confirm(`"${desiredName}" already exists here. Overwrite it?`);
                        if (!shouldOverwrite) {
                            return;
                        }
                        overwrite = true;
                    }
                    await window.webSkel.appServices.callTool('explorer', 'copy_file', {
                        source: clipboard.path,
                        destination,
                        overwrite
                    });
                    this.showStatus(`Copied to ${destination}${overwrite ? ' (overwritten)' : ''}.`);
                }

                const targetMatchesCurrentView = targetIsCurrentDirectory;
                const sourceMatchesCurrentView = sourceParent === this.state.path;

                if (targetMatchesCurrentView || sourceMatchesCurrentView) {
                    this.state.entries = await this.loadDirectoryContent(this.state.path);
                }

                if (wasSelectedFile) {
                    this.state.selectedPath = destination;
                    const historyMethod = clipboard.mode === 'cut' ? 'replaceState' : 'pushState';
                    history[historyMethod](null, '', `#file-exp${destination}`);
                    await this.openFile(destination);
                    return;
                }

                this.invalidate();
            });
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to paste item.', true);
        }
    }

    sanitizeEntryName(value) {
        if (typeof value !== 'string') {
            return null;
        }
        const trimmed = value.trim();
        if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/]/.test(trimmed)) {
            return null;
        }
        return trimmed;
    }

    splitFileName(fileName) {
        if (!fileName || typeof fileName !== 'string') {
            return { stem: '', ext: '' };
        }
        const lastDot = fileName.lastIndexOf('.');
        if (lastDot <= 0) {
            return { stem: fileName, ext: '' };
        }
        return {
            stem: fileName.slice(0, lastDot),
            ext: fileName.slice(lastDot)
        };
    }

    generateCopyName(baseName, existingNames = null) {
        const safeBase = this.sanitizeEntryName(baseName) ?? baseName;
        const names = existingNames instanceof Set
            ? new Set(existingNames)
            : new Set(this.state.entries.map(entry => entry.name));
        if (!names.has(safeBase)) {
            return safeBase;
        }
        const { stem, ext } = this.splitFileName(safeBase);
        let index = 1;
        let candidate = '';
        do {
            const suffix = index === 1 ? ' copy' : ` copy ${index}`;
            candidate = `${stem}${suffix}${ext}`;
            index += 1;
        } while (names.has(candidate));
        return candidate;
    }


    // Utility and helper functions from old app.js
    normalizePath(pathStr) {
        if (!pathStr) return '/';
        const parts = pathStr.split('/').filter(Boolean);
        return '/' + parts.join('/');
    }

    joinPath(base, name) {
        const cleanedBase = this.normalizePath(base);
        const target = cleanedBase === '/' ? name : `${cleanedBase}/${name}`;
        const segments = target.split('/').filter(Boolean);
        return '/' + segments.join('/');
    }

    parentPath(p) {
        const normalized = this.normalizePath(p);
        if (normalized === '/') return null;
        const segments = normalized.split('/').filter(Boolean);
        segments.pop();
        return segments.length ? `/${segments.join('/')}` : '/';
    }

    formatBytes(value) {
        if (!Number.isFinite(value) || value < 0) return '—';
        if (value === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
        const sized = value / Math.pow(1024, exponent);
        return `${sized.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
    }

    formatDate(value) {
        if (!value) return '—';
        try {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return value;
            return date.toLocaleString();
        } catch (_) {
            return value;
        }
    }

    parseDirectoryListing(text) {
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const entries = lines.map(line => {
            const match = line.match(/^(?:<pre>)?\s*\[(DIR|FILE)\]\s+(.*)$/);
            if (!match) {
                return {name: line, type: 'unknown'};
            }
            return {
                name: match[2].trim(),
                type: match[1] === 'DIR' ? 'directory' : 'file'
            };
        });
        entries.sort((a, b) => {
            const order = {directory: 0, file: 1, unknown: 2};
            const diff = (order[a.type] || 3) - (order[b.type] || 3);
            if (diff !== 0) return diff;
            return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'});
        });
        return entries;
    }

    parseDetailedDirectoryListing(text) {
        if (!text) return [];
        try {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter(entry => entry && typeof entry.name === 'string')
                .map(entry => ({
                    name: entry.name,
                    type: entry.type === 'directory' || entry.type === 'file' ? entry.type : 'other',
                    size: Number.isFinite(entry.size) ? entry.size : null,
                    modified: typeof entry.modified === 'string' ? entry.modified : null
                }));
        } catch (error) {
            console.warn('Falling back to plain directory listing parsing.', error);
            return this.parseDirectoryListing(text);
        }
    }

    renderBreadcrumbs() {
        const breadcrumbsEl = this.element.querySelector('#breadcrumbs');
        breadcrumbsEl.innerHTML = '';
        const rootButton = document.createElement('button');
        rootButton.textContent = '/';
        rootButton.addEventListener('click', () => this.loadDirectory('/'));
        breadcrumbsEl.appendChild(rootButton);

        if (!this.state.path || this.state.path === '/') return;

        const segments = this.state.path.split('/').filter(Boolean);
        let current = '';
        segments.forEach(segment => {
            current += `/${segment}`;
          //  breadcrumbsEl.appendChild(document.createTextNode('/'));
            const btn = document.createElement('button');
            btn.textContent = `${segment} \/`;
            const path = current;
            btn.addEventListener('click', () => this.loadDirectory(path));
            breadcrumbsEl.appendChild(btn);
        });
    }

    showStatus(message, isError = false) {
        const statusBanner = this.element.querySelector('#statusBanner');
        if (!message) {
            statusBanner.classList.remove('visible', 'error');
            statusBanner.textContent = '';
            return;
        }
        statusBanner.textContent = message;
        statusBanner.classList.add('visible');
        statusBanner.classList.toggle('error', Boolean(isError));
        setTimeout(() => this.showStatus(null), 3000);
    }

    async newFile() {
        const fileName = prompt('Enter name for the new file:');
        if (!fileName || !fileName.trim()) {
            return;
        }
        const newFilePath = this.joinPath(this.state.path, fileName.trim());
        try {
            await this.withLoader(async () => {
                await window.webSkel.appServices.callTool('explorer', 'write_file', {path: newFilePath, content: ''});
                this.showStatus(`Successfully created file.`);
                await this.loadDirectory(this.state.path);
            });
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to create file.', true);
        }
    }

    async goUp() {
        const parent = this.parentPath(this.state.path);
        if (parent !== null) {
            const newUrl = `#file-exp${parent}`;
            history.pushState(null, '', newUrl);
            await this.loadDirectory(parent);
        }
    }

    async refresh() {
        await this.loadDirectory(this.state.path);
    }

    async newDirectory() {
        const dirName = prompt('Enter name for the new directory:');
        if (!dirName || !dirName.trim()) {
            return;
        }
        const newDirPath = this.joinPath(this.state.path, dirName.trim());
        try {
            await this.withLoader(async () => {
                await window.webSkel.appServices.callTool('explorer', 'create_directory', {path: newDirPath});
                this.showStatus(`Successfully created directory.`);
                await this.loadDirectory(this.state.path);
            });
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to create directory.', true);
        }
    }

    isMarkdownFile(path) {
        return typeof path === 'string' && /\.md$/i.test(path);
    }

    stripAchilesComments(text) {
        return stripDocumentComments(text);
    }

    prepareMarkdownPreviewContent(rawText) {
        if (!rawText) {
            return '';
        }
        const unescaped = unescapeHtmlEntities(rawText);
        const cleaned = this.stripAchilesComments(unescaped);
        return cleaned.replace(/\u00A0/g, ' ');
    }

    renderMarkdownPreview(markdown) {
        if (!markdown) {
            return '';
        }

        const escapeHtml = (value) => value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const renderInline = (value) => {
            let result = value;
            result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            result = result.replace(/(\*|_)([^*_]+?)\1/g, '<em>$2</em>');
            result = result.replace(/`([^`]+?)`/g, '<code>$1</code>');
            result = result.replace(/\[([^\]]+)]\(([^)]+)\)/g, (match, text, href) => {
                const isInternal = /^#/.test(href);
                const safeHref = escapeHtml(href);
                const safeText = escapeHtml(text);
                return isInternal
                    ? `<a href="${safeHref}">${safeText}</a>`
                    : `<a href="${safeHref}" target="_blank" rel="noopener">${safeText}</a>`;
            });
            return result;
        };

        const lines = markdown.replace(/\r\n/g, '\n').split('\n');
        const html = [];
        let activeList = null;
        let inCodeBlock = false;
        let codeLanguage = '';
        let paragraphBuffer = [];

        const flushParagraph = () => {
            if (paragraphBuffer.length === 0) return;
            const text = paragraphBuffer.join(' ');
            html.push(`<p>${renderInline(text)}</p>`);
            paragraphBuffer = [];
        };

        const closeActiveList = () => {
            if (!activeList) {
                return;
            }
            html.push(activeList.type === 'ol' ? '</ol>' : '</ul>');
            activeList = null;
        };

        const ensureList = (type, startNumber = 1) => {
            if (activeList?.type === type) {
                return;
            }
            closeActiveList();
            if (type === 'ol') {
                const startAttr = startNumber > 1 ? ` start="${startNumber}"` : '';
                html.push(`<ol${startAttr}>`);
            } else {
                html.push('<ul>');
            }
            activeList = { type };
        };

        lines.forEach((rawLine) => {
            const line = rawLine.trimEnd();

            if (line.trim().startsWith('```')) {
                if (inCodeBlock) {
                    html.push('</code></pre>');
                    inCodeBlock = false;
                    codeLanguage = '';
                } else {
                    flushParagraph();
                    closeActiveList();
                    inCodeBlock = true;
                    codeLanguage = line.trim().slice(3).trim();
                    const langClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : '';
                    html.push(`<pre><code${langClass}>`);
                }
                return;
            }

            if (inCodeBlock) {
                html.push(`${escapeHtml(rawLine)}\n`);
                return;
            }

            if (/^\s*$/.test(line)) {
                flushParagraph();
                closeActiveList();
                return;
            }

            const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
            if (headingMatch) {
                flushParagraph();
                closeActiveList();
                const level = headingMatch[1].length;
                let headingContent = headingMatch[2].trim();
                const anchorMatch = headingContent.match(/\{#([^}]+)\}\s*$/);
                const anchorId = anchorMatch ? anchorMatch[1] : null;
                if (anchorMatch) {
                    headingContent = headingContent.replace(/\s*\{#[^}]+\}\s*$/, '').trim();
                }
                const rendered = renderInline(escapeHtml(headingContent));
                const anchorHtml = anchorId ? `<a id="${escapeHtml(anchorId)}"></a>` : '';
                html.push(`${anchorHtml}<h${level}>${rendered}</h${level}>`);
                return;
            }

            const listMatch = line.match(/^[-*+]\s+(.*)$/);
            if (listMatch) {
                flushParagraph();
                ensureList('ul');
                html.push(`<li>${renderInline(escapeHtml(listMatch[1]))}</li>`);
                return;
            }

            const orderedMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
            if (orderedMatch) {
                flushParagraph();
                const startNumber = parseInt(orderedMatch[1], 10) || 1;
                ensureList('ol', startNumber);
                html.push(`<li>${renderInline(escapeHtml(orderedMatch[2]))}</li>`);
                return;
            }

            paragraphBuffer.push(escapeHtml(line.trim()));
        });

        if (inCodeBlock) {
            html.push('</code></pre>');
        }
        closeActiveList();
        flushParagraph();

        return html.join('\n');
    }

    toggleHiddenFiles(element) {
        this.state.includeHidden = element.checked;
        this.saveHiddenPreference(this.state.includeHidden);
        this.invalidate();
    }

    loadHiddenPreference() {
        try {
            const stored = window.localStorage.getItem('assistosExplorerShowHidden');
            return stored === null ? false : stored === 'true';
        } catch (_) {
            return false;
        }
    }

    saveHiddenPreference(value) {
        try {
            window.localStorage.setItem('assistosExplorerShowHidden', value ? 'true' : 'false');
        } catch (_) {
            // ignore
        }
    }

    toggleMarkdownView() {
        if (!this.state.selectedIsMarkdown || this.state.isEditing) {
            return;
        }
        this.state.markdownTextView = !this.state.markdownTextView;
        this.invalidate();
    }

    escapeCssId(value) {
        if (!value) {
            return '';
        }
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(value);
        }
        return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
    }

    attachPreviewAnchorHandler() {
        const previewRoot = this.element.querySelector('#filePreview');
        if (!previewRoot) {
            return;
        }
        previewRoot.removeEventListener('click', this.boundPreviewAnchorHandler);
        previewRoot.addEventListener('click', this.boundPreviewAnchorHandler);
    }

    detachPreviewAnchorHandler() {
        const previewRoot = this.element.querySelector('#filePreview');
        if (!previewRoot) {
            return;
        }
        previewRoot.removeEventListener('click', this.boundPreviewAnchorHandler);
    }

    handlePreviewAnchorClick(event) {
        const anchor = event.target?.closest?.('a[href^="#"]');
        if (!anchor) {
            return;
        }
        const href = anchor.getAttribute('href');
        if (!href || href.length <= 1) {
            return;
        }
        const targetId = href.slice(1);
        if (!targetId) {
            return;
        }
        const previewRoot = this.element.querySelector('#filePreview');
        if (!previewRoot) {
            return;
        }
        const selector = this.escapeCssId(targetId);
        const target = selector ? previewRoot.querySelector(`#${selector}`) : null;
        if (!target) {
            return;
        }
        event.preventDefault();
        if (typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            const container = previewRoot.parentElement || previewRoot;
            const offset = target.getBoundingClientRect().top - previewRoot.getBoundingClientRect().top;
            container.scrollTop += offset;
        }
    }


}
