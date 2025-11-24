import { DOCUMENT_MEDIA_URL_ROOT } from '../storage/documentMediaStorageResolver.js';
import { withRetry } from '../utils/retry.js';

export const AUDIO_FILE_EXTENSION = '.mp3';
export const VIDEO_FILE_EXTENSION = '.mp4';

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

const buildMediaPath = (context, mediaId, extension) => {
    if (!context) {
        return `/${mediaId}`;
    }
    const mediaPath = `${DOCUMENT_MEDIA_URL_ROOT}/${context.folder}/${mediaId}${extension}`;
    return `/${mediaPath}`;
};

/**
 * @typedef {Object} MediaClient
 * @property {(imageId: string) => Promise<string>} getImageURL
 * @property {(audioId: string) => Promise<string>} getAudioURL
 * @property {(payload: Uint8Array) => Promise<string>} putAudio
 * @property {(videoId: string) => Promise<string>} getVideoURL
 * @property {(payload: Uint8Array) => Promise<string>} putVideo
 * @property {(payload: Uint8Array) => Promise<string>} putImage
 */

/**
 * @param {Object} deps
 * @param {(toolName: string, args?: Record<string, unknown>) => Promise<any>} deps.callExplorerTool
 * @param {() => { folder: string } | null} deps.getDocumentContext
 * @param {() => Promise<string>} deps.getDocumentMediaStorageRoot
 * @param {number} [deps.retries]
 * @returns {MediaClient}
 */
export function createMediaClient({
    callExplorerTool,
    getDocumentContext,
    getDocumentMediaStorageRoot,
    retries = 2
}) {
    if (typeof callExplorerTool !== 'function') {
        throw new Error('callExplorerTool must be provided.');
    }
    if (typeof getDocumentMediaStorageRoot !== 'function') {
        throw new Error('getDocumentMediaStorageRoot must be provided.');
    }

    const ensureDirectory = async (directoryPath) => {
        await withRetry(() => callExplorerTool('create_directory', { path: directoryPath }), { retries });
    };

    const writeBinaryFile = async (relativePath, data) => {
        await withRetry(() => callExplorerTool('write_binary_file', {
            path: relativePath,
            content: toBase64(data),
            encoding: 'base64'
        }), { retries });
    };

    const putBinaryMedia = async (kind, extension, payload) => {
        if (!(payload instanceof Uint8Array)) {
            throw new Error(`${kind} payload must be a Uint8Array.`);
        }
        const context = getDocumentContext();
        if (!context) {
            throw new Error(`No active document context. Open a document before uploading ${kind}.`);
        }
        const mediaId = generateRandomId(kind);
        const mediaStorageRoot = await getDocumentMediaStorageRoot();
        const directory = `${mediaStorageRoot}/${context.folder}`;
        await ensureDirectory(directory);
        const relativePath = `${directory}/${mediaId}${extension}`;
        await writeBinaryFile(relativePath, payload);
        return mediaId;
    };

    return {
        async getImageURL(imageId) {
            return imageId ? `/${imageId}` : '';
        },
        async getAudioURL(audioId) {
            if (!audioId) {
                return '';
            }
            const context = getDocumentContext();
            return buildMediaPath(context, audioId, AUDIO_FILE_EXTENSION);
        },
        async putAudio(uint8Array) {
            return putBinaryMedia('audio', AUDIO_FILE_EXTENSION, uint8Array);
        },
        async getVideoURL(videoId) {
            if (!videoId) {
                return '';
            }
            const context = getDocumentContext();
            return buildMediaPath(context, videoId, VIDEO_FILE_EXTENSION);
        },
        async putVideo(uint8Array) {
            return putBinaryMedia('video', VIDEO_FILE_EXTENSION, uint8Array);
        },
        async putImage() {
            return 'image-placeholder';
        }
    };
}
