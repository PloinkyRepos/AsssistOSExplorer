import { createAgentClient } from '/MCPBrowserClient.js';
import documentModule from './document/localDocumentModule.js';
import {
    createDocumentMediaStorageResolver,
    resolveDocumentContext
} from './storage/documentMediaStorageResolver.js';
import {
    createFontFamilyMap,
    createFontMap,
    createTextIndentMap,
    customTrim,
    escapeHtml,
    normalizeSpaces,
    reverseQuerySelector,
    unescapeHtml
} from './document/documentFormatting.js';
import { createMediaClient } from './media/mediaClient.js';

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
    publish() {},
    subscribeToWorkspace() {
        console.warn('[assistOS] Workspace notifications are not implemented in the local shim.');
    },
    unsubscribeFromWorkspace() {}
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

const buildWorkspaceModule = (workspaceState) => {
    const callExplorerTool = async (toolName, args = {}) => {
        return assistosSDK.callTool(EXPLORER_AGENT_ID, toolName, args);
    };

    const getDocumentContext = () => resolveDocumentContext(workspaceState);
    const getDocumentMediaStorageRoot = createDocumentMediaStorageResolver(callExplorerTool);
    const mediaClient = createMediaClient({
        callExplorerTool,
        getDocumentContext,
        getDocumentMediaStorageRoot
    });

    return {
        async getWorkspaceStatus() {
            return {
                status: 'active',
                plugins: workspaceState.plugins
            };
        },
        async getCommands() {
            return [...DEFAULT_COMMANDS];
        },
        async getCustomTypes() {
            return [...DEFAULT_CUSTOM_TYPES];
        },
        async getImageURL(imageId) {
            return mediaClient.getImageURL(imageId);
        },
        async getAudioURL(audioId) {
            return mediaClient.getAudioURL(audioId);
        },
        async putAudio(uint8Array) {
            return mediaClient.putAudio(uint8Array);
        },
        async getVideoURL(videoId) {
            return mediaClient.getVideoURL(videoId);
        },
        async putVideo(uint8Array) {
            return mediaClient.putVideo(uint8Array);
        },
        async putImage(_arrayBuffer) {
            return mediaClient.putImage(_arrayBuffer);
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
        async getApplicationManifest(applicationId) {
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
        async getApplicationComponent(applicationId, appComponentsDirPath, component) {
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
        async getApplicationFile(filePath) {
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
    const workspaceState = {
        plugins: JSON.parse(JSON.stringify(runtimePlugins || {})),
        currentDocumentId: null,
        currentDocumentMetadataId: null,
        currentDocumentPath: null,
        currentChapterId: null,
        currentParagraphId: null,
        loadingDocuments: []
    };

    const workspaceModule = buildWorkspaceModule(workspaceState);
    const modules = new Map([
        ['document', documentModule],
        ['agent', buildAgentModule()],
        ['workspace', workspaceModule],
        ['space', workspaceModule],
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

    const assistOSInstance = {
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
        workspace: workspaceState,
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

    Object.defineProperty(assistOSInstance, 'space', {
        get() {
            console.warn('[assistOS] assistOS.space is deprecated. Use assistOS.workspace instead.');
            return workspaceState;
        },
        set() {
            console.warn('[assistOS] assistOS.space is deprecated and cannot be reassigned. Use assistOS.workspace instead.');
        }
    });

    return assistOSInstance;
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
