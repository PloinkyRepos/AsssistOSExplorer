import { withRetry } from '../utils/retry.js';

export const DOCUMENT_MEDIA_URL_ROOT = 'document-multimedia';

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

export const resolveDocumentContext = (workspaceState) => {
    if (!workspaceState) {
        return null;
    }
    const metadataId = typeof workspaceState.currentDocumentMetadataId === 'string'
        ? workspaceState.currentDocumentMetadataId.trim()
        : '';
    const docId = typeof workspaceState.currentDocumentId === 'string'
        ? workspaceState.currentDocumentId.trim()
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

export function createDocumentMediaStorageResolver(callExplorerTool, { retries = 2 } = {}) {
    if (typeof callExplorerTool !== 'function') {
        throw new Error('callExplorerTool must be a function.');
    }

    let cachedRoot = null;
    let inflight = null;

    const resolveWorkspaceRoot = async () => {
        const response = await withRetry(
            () => callExplorerTool('list_allowed_directories', {}),
            { retries }
        );
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
        const response = await withRetry(
            () => callExplorerTool('search_files', { path: '/', pattern: DOCUMENT_MEDIA_URL_ROOT }),
            { retries }
        );
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
}
