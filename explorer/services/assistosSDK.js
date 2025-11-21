import { createAgentClient } from '/MCPBrowserClient.js';
import documentModule from './document/localDocumentModule.js';

const DEFAULT_EMAIL = 'local@example.com';
const DEFAULT_AGENT_IMAGE = './assets/icons/person.svg';
const DEFAULT_COMMANDS = [
    'assign',
    'new',
    'macro',
    'jsdef',
    'append',
    'replace',
    'remove'
];
const DEFAULT_CUSTOM_TYPES = [
    'text',
    'number',
    'date',
    'list'
];
const EXPLORER_AGENT_ID = 'explorer';
const DOCUMENT_MEDIA_URL_ROOT = 'document-multimedia';
const AUDIO_FILE_EXTENSION = '.mp3';
const VIDEO_FILE_EXTENSION = '.mp4';

const normalizeFsPath = (value) => (typeof value === 'string' ? value.replace(/\\/g, '/').trim() : '');
const trimSlashes = (value, { leading = true, trailing = true } = {}) => {
    if (typeof value !== 'string') {
        return '';
    }
    let result = value;
    if (trailing) {
        result = result.replace(/\/+$/, '');
    }
    if (leading) {
        result = result.replace(/^\/+/, '');
    }
    return result;
};
const splitLines = (value) => (typeof value === 'string'
    ? value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : []);

const getConfiguredDocumentStorageRoot = () => {
    const providers = [
        () => (typeof globalThis !== 'undefined' ? globalThis.DOCUMENT_STORAGE_ROOT : undefined),
        () => (typeof globalThis !== 'undefined' ? globalThis.AssistOS?.config?.DOCUMENT_STORAGE_ROOT : undefined),
        () => (typeof globalThis !== 'undefined' ? globalThis.assistOS?.config?.DOCUMENT_STORAGE_ROOT : undefined),
        () => {
            if (typeof document === 'undefined') {
                return undefined;
            }
            return document.querySelector?.('meta[name="document-storage-root"]')?.content;
        },
        () => (typeof process !== 'undefined' ? process.env?.DOCUMENT_STORAGE_ROOT : undefined)
    ];

    for (const getValue of providers) {
        try {
            const value = getValue();
            if (typeof value === 'string' && value.trim()) {
                return trimSlashes(value.trim(), { trailing: true, leading: false });
            }
        } catch (error) {
            console.warn('[assistOS] Failed to evaluate DOCUMENT_STORAGE_ROOT provider:', error);
        }
    }
    return null;
};

const createDocumentMediaStorageResolver = (callExplorerTool) => {
    let cachedRoot = null;
    let inflight = null;

    const resolveWorkspaceRoot = async () => {
        const response = await callExplorerTool('list_allowed_directories', {});
        const lines = splitLines(response?.text ?? '');
        for (const line of lines) {
            if (/^allowed directories:?$/i.test(line)) {
                continue;
            }
            if (line) {
                return line;
            }
        }
        return null;
    };

    const locateMediaDirectory = async (workspaceRoot) => {
        const response = await callExplorerTool('search_files', { path: '/', pattern: DOCUMENT_MEDIA_URL_ROOT });
        const normalizedWorkspace = trimSlashes(normalizeFsPath(workspaceRoot), { leading: false, trailing: true });
        const lines = splitLines(response?.text ?? '');
        for (const candidate of lines) {
            const normalizedCandidate = normalizeFsPath(candidate);
            if (!normalizedCandidate.toLowerCase().endsWith(`/${DOCUMENT_MEDIA_URL_ROOT}`)) {
                continue;
            }
            if (!normalizedCandidate.startsWith(normalizedWorkspace)) {
                continue;
            }
            const relative = trimSlashes(normalizedCandidate.slice(normalizedWorkspace.length), { leading: true, trailing: true });
            if (relative) {
                return relative;
            }
        }
        return null;
    };

    return async () => {
        if (cachedRoot) {
            return cachedRoot;
        }
        if (inflight) {
            return inflight;
        }

        inflight = (async () => {
            const configuredRoot = getConfiguredDocumentStorageRoot();
            if (configuredRoot) {
                return `${configuredRoot}/${DOCUMENT_MEDIA_URL_ROOT}`;
            }
            const workspaceRoot = await resolveWorkspaceRoot();
            if (!workspaceRoot) {
                throw new Error('Unable to determine workspace root. Set DOCUMENT_STORAGE_ROOT to override.');
            }
            const detectedMediaDirectory = await locateMediaDirectory(workspaceRoot);
            if (!detectedMediaDirectory) {
                throw new Error(`Unable to locate "${DOCUMENT_MEDIA_URL_ROOT}" directory. Create it or set DOCUMENT_STORAGE_ROOT.`);
            }
            return detectedMediaDirectory;
        })();

        try {
            cachedRoot = await inflight;
            return cachedRoot;
        } finally {
            inflight = null;
        }
    };
};

const createFontMap = () => ({
    tiny: '12px',
    small: '14px',
    medium: '16px',
    large: '20px',
    'x-large': '24px'
});

const createFontFamilyMap = () => ({
    arial: 'Arial, sans-serif',
    georgia: 'Georgia, serif',
    courier: '"Courier New", monospace',
    roboto: '"Roboto", sans-serif'
});

const createTextIndentMap = () => ({
    none: '0',
    small: '12px',
    medium: '24px',
    large: '36px'
});

const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const unescapeHtml = (value = '') => {
    if (typeof window === 'undefined') {
        return value;
    }
    const div = document.createElement('textarea');
    div.innerHTML = value;
    return div.value;
};

const reverseQuerySelector = (element, selector, boundarySelector) => {
    let current = element;
    while (current) {
        if (current.matches && current.matches(selector)) {
            return current;
        }
        if (boundarySelector && current.matches && current.matches(boundarySelector)) {
            break;
        }
        current = current.parentElement;
    }
    return null;
};

const normalizeSpaces = (value) => {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value !== 'string') {
        return value;
    }
    return value
        .replace(/\u00A0/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const customTrim = (value) => {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value !== 'string') {
        return value;
    }
    return value.replace(/^[\u00A0\s]+|[\u00A0\s]+$/g, '').trim();
};

const generateRandomId = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const toBase64 = (uint8Array) => {
    if (typeof Buffer !== 'undefined' && Buffer.from) {
        return Buffer.from(uint8Array).toString('base64');
    }
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    if (typeof btoa === 'function') {
        return btoa(binary);
    }
    throw new Error('Base64 encoding is not supported in this environment.');
};

const sanitizePathSegment = (value = '') => {
    if (typeof value !== 'string') {
        return '';
    }
    return value
        .replace(/^\.+/, '')
        .replace(/[\\]/g, '_')
        .replace(/\//g, '_')
        .replace(/[<>:"|?*]/g, '_')
        .trim() || 'document';
};

const resolveDocumentContext = (spaceState) => {
    if (!spaceState) {
        return null;
    }
    const metadataId = typeof spaceState.currentDocumentMetadataId === 'string'
        ? spaceState.currentDocumentMetadataId.trim()
        : '';
    const docId = typeof spaceState.currentDocumentId === 'string'
        ? spaceState.currentDocumentId.trim()
        : '';
    const raw = metadataId || docId;
    if (!raw) {
        return null;
    }
    return {
        raw,
        folder: sanitizePathSegment(raw)
    };
};

const buildUIHelpers = () => {
    const configs = { components: [] };

    const normalizeParent = (parent) => {
        if (!parent) {
            return null;
        }
        if (typeof parent === 'string') {
            return document.querySelector(parent);
        }
        return parent;
    };

    return {
        configs,
        sanitize: escapeHtml,
        unsanitize: unescapeHtml,
        normalizeSpaces,
        customTrim,
        reverseQuerySelector,
        async showModal(name, payload = {}, expectResult = false) {
            switch (name) {
                case 'confirm-action-modal': {
                    const message = payload?.message ?? 'Are you sure?';
                    const confirmed = typeof window !== 'undefined'
                        ? window.confirm(message)
                        : true;
                    return expectResult ? confirmed : undefined;
                }
                case 'add-comment': {
                    if (typeof window === 'undefined') {
                        return expectResult ? '' : undefined;
                    }
                    const result = window.prompt('Enter comment', '');
                    return expectResult ? result : undefined;
                }
                default:
                    console.warn(`[assistOS] Modal "${name}" is not implemented in the local shim.`);
                    return expectResult ? null : undefined;
            }
        },
        closeModal() {
            // Intentionally left blank for local shim
        },
        async changeToDynamicPage(_pageName, url) {
            if (typeof url === 'string' && typeof window !== 'undefined') {
                window.location.hash = `#${url}`;
            }
        },
        createElement(tagName, parent = null, properties = {}, dataset = {}, _observe = false) {
            if (typeof document === 'undefined') {
                return null;
            }
            const element = document.createElement(tagName);
            Object.assign(element, properties);
            if (dataset && typeof dataset === 'object') {
                Object.entries(dataset).forEach(([key, value]) => {
                    element.setAttribute(key, value);
                });
            }
            const parentNode = normalizeParent(parent);
            if (parentNode) {
                parentNode.appendChild(element);
            }
            return element;
        },
        async showActionBox() {
            console.warn('[assistOS] showActionBox is not implemented in the local shim.');
            return null;
        },
        async showToast(message, type = 'info', timeout = 1500) {
            if (typeof document === 'undefined') {
                console.log(`[${type}] ${message}`);
                return;
            }
            const containerSelector = '.toast-container';
            let container = document.querySelector(containerSelector);
            if (!container) {
                container = document.createElement('div');
                container.classList.add('toast-container');
                document.body.appendChild(container);
            }

            const toast = document.createElement('div');
            toast.classList.add('timeout-toast', type);
            toast.innerHTML = `
                <div class="toast-left">
                    <span class="message-type">${type.charAt(0).toUpperCase() + type.slice(1)}:</span>
                    <span class="toast-message">${message}</span>
                </div>
                <button class="close" aria-label="Close">&times;</button>
            `;

            const removeToast = () => {
                toast.remove();
            };
            const closeButton = toast.querySelector('.close');
            closeButton.addEventListener('click', removeToast);
            container.appendChild(toast);
            setTimeout(removeToast, timeout);
        },
        extractFormInformation(target) {
            if (!target) {
                return {};
            }
            const form = target.closest('form');
            if (!form) {
                return {};
            }

            const data = {
                data: {},
                elements: {},
                isValid: false
            };

            if (typeof form.checkValidity === 'function') {
                data.isValid = form.checkValidity();
            }

            const inputs = Array.from(form.querySelectorAll('[name]:not([type=hidden])'));

            for (const input of inputs) {
                if (input.disabled) {
                    continue;
                }

                let value;
                if (input.multiple && input.tagName === 'SELECT') {
                    value = Array.from(input.selectedOptions).map(option => option.value);
                } else if (input.tagName === 'INPUT' && input.type === 'checkbox') {
                    value = input.checked;
                } else if (input.tagName === 'INPUT' && input.type === 'file') {
                    value = input.files;
                } else {
                    value = input.value;
                }

                data.data[input.name] = value;
                data.elements[input.name] = {
                    element: input,
                    isValid: typeof input.checkValidity === 'function' ? input.checkValidity() : true
                };
            }

            if (typeof form.checkValidity === 'function') {
                data.isValid = form.checkValidity();
            }

            return data;
        }
    };
};

const buildNotificationRouter = () => ({
    subscribe() {
        console.warn('[assistOS] Notifications not implemented in local shim.');
    },
    unsubscribe() {},
    publish() {}
});

const buildAgentModule = () => ({
    async getDefaultAgent() {
        return {
            id: 'local-agent',
            name: 'Local Agent',
            image: DEFAULT_AGENT_IMAGE,
            commands: DEFAULT_COMMANDS,
            customTypes: DEFAULT_CUSTOM_TYPES
        };
    },
    async getAgents() {
        return [await this.getDefaultAgent()];
    }
});

const buildSpaceModule = (spaceState) => {
    const callExplorerTool = async (toolName, args = {}) => {
        return assistosSDK.callTool(EXPLORER_AGENT_ID, toolName, args);
    };

    const getDocumentContext = () => resolveDocumentContext(spaceState);
    const getDocumentMediaStorageRoot = createDocumentMediaStorageResolver(callExplorerTool);

    const ensureDirectory = async (directoryPath) => {
        await callExplorerTool('create_directory', { path: directoryPath });
    };

    const writeBinaryFile = async (relativePath, data) => {
        await callExplorerTool('write_binary_file', {
            path: relativePath,
            content: toBase64(data),
            encoding: 'base64'
        });
    };

    return {
        async getSpaceStatus() {
            return {
                spaceGlobalId: spaceState.id,
                status: 'active',
                plugins: spaceState.plugins
            };
        },
        async getCommands() {
            return [...DEFAULT_COMMANDS];
        },
        async getCustomTypes() {
            return [...DEFAULT_CUSTOM_TYPES];
        },
        async getImageURL(imageId) {
            return imageId ? `/${imageId}` : '';
        },
        async getAudioURL(audioId) {
            if (!audioId) {
                return '';
            }
            const context = getDocumentContext();
            if (!context) {
                return `/${audioId}`;
            }
            const mediaPath = `${DOCUMENT_MEDIA_URL_ROOT}/${context.folder}/${audioId}${AUDIO_FILE_EXTENSION}`;
            return `/${mediaPath}`;
        },
        async putAudio(uint8Array) {
            if (!(uint8Array instanceof Uint8Array)) {
                throw new Error('Audio payload must be a Uint8Array.');
            }
            const context = getDocumentContext();
            if (!context) {
                throw new Error('No active document context. Open a document before uploading audio.');
            }
            const mediaId = generateRandomId('audio');
            const mediaStorageRoot = await getDocumentMediaStorageRoot();
            const directory = `${mediaStorageRoot}/${context.folder}`;
            await ensureDirectory(directory);
            const relativePath = `${directory}/${mediaId}${AUDIO_FILE_EXTENSION}`;
            await writeBinaryFile(relativePath, uint8Array);
            return mediaId;
        },
        async getVideoURL(videoId) {
            if (!videoId) {
                return '';
            }
            const context = getDocumentContext();
            if (!context) {
                return `/${videoId}`;
            }
            const mediaPath = `${DOCUMENT_MEDIA_URL_ROOT}/${context.folder}/${videoId}${VIDEO_FILE_EXTENSION}`;
            return `/${mediaPath}`;
        },
        async putVideo(uint8Array) {
            if (!(uint8Array instanceof Uint8Array)) {
                throw new Error('Video payload must be a Uint8Array.');
            }
            const context = getDocumentContext();
            if (!context) {
                throw new Error('No active document context. Open a document before uploading video.');
            }
            const mediaId = generateRandomId('video');
            const mediaStorageRoot = await getDocumentMediaStorageRoot();
            const directory = `${mediaStorageRoot}/${context.folder}`;
            await ensureDirectory(directory);
            const relativePath = `${directory}/${mediaId}${VIDEO_FILE_EXTENSION}`;
            await writeBinaryFile(relativePath, uint8Array);
            return mediaId;
        },
        async putImage(_arrayBuffer) {
            return 'image-placeholder';
        }
    };
};

const buildGalleryModule = () => ({
    async getGalleries() {
        return [];
    }
});

const buildUtilModule = () => ({
    generateId(prefix = 'id') {
        return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
    }
});

const buildApplicationModule = (ui) => {
    const manifestCache = new Map();
    const componentsConfig = ui.configs.components;
    const defaultEntryPoint = 'document-view-page';
    const componentsDirPath = './web-components';

    const fetchText = async (path) => {
        try {
            const response = await fetch(path, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`Failed to fetch ${path} (${response.status})`);
            }
            return await response.text();
        } catch (error) {
            console.error(`[assistOS] Failed to fetch resource ${path}:`, error);
            return '';
        }
    };

    return {
        async getApplicationManifest(_spaceId, applicationId) {
            if (!manifestCache.has(applicationId)) {
                manifestCache.set(applicationId, {
                    id: applicationId,
                    applicationId,
                    entryPoint: defaultEntryPoint,
                    componentsDirPath,
                    components: componentsConfig,
                    systemApp: false
                });
            }
            return manifestCache.get(applicationId);
        },
        async getApplicationComponent(_spaceId, applicationId, appComponentsDirPath, component) {
            const baseDir = (appComponentsDirPath || componentsDirPath).replace(/\/+$/, '');
            const componentDir = `${component.name}/${component.name}`;

            const htmlPath = `${baseDir}/${componentDir}.html`;
            const cssPath = `${baseDir}/${componentDir}.css`;
            const presenterPath = component.presenterClassName ? `${baseDir}/${componentDir}.js` : null;

            const [loadedTemplate, cssContent, presenterModule] = await Promise.all([
                fetchText(htmlPath),
                fetchText(cssPath),
                presenterPath ? fetchText(presenterPath) : Promise.resolve('')
            ]);

            return {
                loadedTemplate,
                loadedCSSs: [cssContent],
                presenterModule
            };
        },
        async getApplicationFile(_spaceId, _applicationId, filePath) {
            return fetchText(filePath);
        }
    };
};

const buildLlmModule = () => ({
    async lipsync() {
        console.warn('[assistOS] lipsync is not supported in the local shim.');
        return null;
    }
});

const createAssistOS = (options = {}) => {
    const { ui: providedUI, modules: moduleOverrides, runtimePlugins } = options;
    const ui = providedUI ?? buildUIHelpers();
    const spaceState = {
        id: 'local-space',
        plugins: JSON.parse(JSON.stringify(runtimePlugins)),
        currentChapterId: null,
        currentParagraphId: null,
        loadingDocuments: []
    };

    const modules = new Map([
        ['document', documentModule],
        ['agent', buildAgentModule()],
        ['space', buildSpaceModule(spaceState)],
        ['gallery', buildGalleryModule()],
        ['util', buildUtilModule()],
        ['application', buildApplicationModule(ui)],
        ['llm', buildLlmModule()]
    ]);

    if (moduleOverrides && typeof moduleOverrides === 'object') {
        for (const [name, module] of Object.entries(moduleOverrides)) {
            modules.set(name, module);
        }
    }

    const loadModule = (name) => {
        if (!modules.has(name)) {
            console.warn(`[assistOS] Module "${name}" is not implemented in the local shim.`);
            return {};
        }
        return modules.get(name);
    };

    return {
        loadModule,
        UI: ui,
        showToast: (...args) => {
            if (typeof ui.showToast === 'function') {
                return ui.showToast(...args);
            }
            const [message, type = 'info'] = args;
            console.log(`[${type}] ${message}`);
            return undefined;
        },
        space: spaceState,
        user: {
            email: DEFAULT_EMAIL
        },
        initialisedApplications: {},
        constants: {
            fontSizeMap: createFontMap(),
            fontFamilyMap: createFontFamilyMap(),
            textIndentMap: createTextIndentMap(),
            DOCUMENT_CATEGORIES: {
                GENERAL: 'general',
                BUSINESS: 'business',
                TECHNICAL: 'technical',
                OTHER: 'other'
            }
        },
        NotificationRouter: buildNotificationRouter(),
        loadifyComponent: async (_element, callback) => {
            if (typeof callback === 'function') {
                return callback();
            }
            return undefined;
        }
    };
};

export const initialiseAssistOS = (options = {}) => {
    const assistOS = createAssistOS(options);
    if (typeof window !== 'undefined') {
        window.assistOS = assistOS;
        window.AssistOS = assistOS;
    }
    return assistOS;
};

class AssistosSDK {
    constructor() {
        this.clients = new Map();
    }

    getClient(agentId) {
        if (!agentId || typeof agentId !== 'string') {
            throw new Error('Agent id must be a non-empty string.');
        }
        if (!this.clients.has(agentId)) {
            const baseUrl = `/mcps/${agentId}/mcp`;
            this.clients.set(agentId, createAgentClient(baseUrl));
        }
        return this.clients.get(agentId);
    }

    async callTool(agentId, tool, args = {}) {
        const client = this.getClient(agentId);
        try {
            const result = await client.callTool(tool, args);
            const blocks = Array.isArray(result?.content) ? result.content : [];
            const firstText = blocks.find(block => block?.type === 'text' && typeof block.text === 'string');
            const firstJson = blocks.find(block => block?.type === 'json' && block.json !== undefined);
            const text = firstText ? firstText.text : JSON.stringify(result, null, 2);
            let json = firstJson ? firstJson.json : undefined;
            if (!json && typeof firstText?.text === 'string') {
                try {
                    json = JSON.parse(firstText.text);
                } catch (parseError) {
                    // ignore parse errors; caller can use raw text
                }
            }
            return { text, json, blocks, raw: result };
        } catch (error) {
            console.error(`Agent call failed (${agentId}:${tool})`, error);
            throw error;
        }
    }

    async fetchRuntimePlugins(agentId = 'explorer', toolName = 'collect_ide_plugins') {
        try {
            const result = await this.callTool(agentId, toolName);
            if (result?.json && typeof result.json === 'object') {
                return result.json;
            }
            if (typeof result?.text === 'string') {
                try {
                    return JSON.parse(result.text);
                } catch (parseError) {
                    console.error('[runtime-plugins] Failed to parse plugin manifest JSON:', parseError);
                }
            }
        } catch (error) {
            console.error('[runtime-plugins] Failed to collect IDE plugins:', error);
        }
        return null;
    }
}

const assistosSDK = new AssistosSDK();

export default assistosSDK;
