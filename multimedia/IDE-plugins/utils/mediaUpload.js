import { uploadBlobFile } from './blobUpload.js';

export const MEDIA_UPLOAD_ERROR_CODES = Object.freeze({
    NO_FILE: 'no-file',
    TOO_LARGE: 'too-large',
    METADATA: 'metadata-error'
});

const createError = (code, message) => {
    const error = new Error(message);
    error.code = code;
    return error;
};

const metadataError = (message) => createError(MEDIA_UPLOAD_ERROR_CODES.METADATA, message);

const createMediaElementReader = ({ createElement, loadEvent, extractMetadata, errorMessage, unsupportedMessage }) => {
    return (file) => new Promise((resolve, reject) => {
        let element;
        try {
            element = createElement();
        } catch (_) {
            reject(metadataError(unsupportedMessage || errorMessage || 'Unable to prepare media element.'));
            return;
        }
        const objectUrl = URL.createObjectURL(file);
        const cleanUp = () => {
            try {
                element.removeAttribute('src');
                if (typeof element.load === 'function') {
                    element.load();
                }
            } catch (_) {
                // noop
            }
            try {
                URL.revokeObjectURL(objectUrl);
            } catch (_) {
                // noop
            }
        };
        const handleSuccess = () => {
            try {
                resolve(extractMetadata(element));
            } catch (error) {
                error.code = error.code || MEDIA_UPLOAD_ERROR_CODES.METADATA;
                reject(error);
            } finally {
                cleanUp();
            }
        };
        const handleError = () => {
            cleanUp();
            reject(metadataError(errorMessage || 'Unable to read media metadata.'));
        };
        element.addEventListener(loadEvent, handleSuccess, { once: true });
        element.addEventListener('error', handleError, { once: true });
        element.src = objectUrl;
    });
};

export const readImageMetadata = createMediaElementReader({
    createElement: () => new Image(),
    loadEvent: 'load',
    extractMetadata: (image) => ({
        width: image.naturalWidth || 0,
        height: image.naturalHeight || 0
    }),
    errorMessage: 'Unable to read image metadata.'
});

export const readAudioMetadata = createMediaElementReader({
    createElement: () => new Audio(),
    loadEvent: 'loadedmetadata',
    extractMetadata: (audio) => ({
        duration: Number.isFinite(audio.duration) ? audio.duration : 0
    }),
    errorMessage: 'Unable to read audio metadata.'
});

export const readVideoMetadata = createMediaElementReader({
    createElement: () => {
        if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
            const video = document.createElement('video');
            video.preload = 'metadata';
            return video;
        }
        throw new Error('Video metadata extraction requires a DOM environment.');
    },
    loadEvent: 'loadedmetadata',
    extractMetadata: (video) => ({
        duration: Number.isFinite(video.duration) ? video.duration : 0
    }),
    errorMessage: 'Unable to read video metadata.',
    unsupportedMessage: 'Video metadata extraction requires a DOM environment.'
});

export async function processMediaUpload({ file, maxFileSize, metadataReader }) {
    if (!file) {
        throw createError(MEDIA_UPLOAD_ERROR_CODES.NO_FILE, 'No file selected.');
    }
    if (Number.isFinite(maxFileSize) && Number.isFinite(file.size) && file.size > maxFileSize) {
        throw createError(MEDIA_UPLOAD_ERROR_CODES.TOO_LARGE, 'File exceeds the allowed size.');
    }
    const uploadPromise = uploadBlobFile(file);
    const metadata = typeof metadataReader === 'function' ? await metadataReader(file) : null;
    const uploadResult = await uploadPromise;
    return { uploadResult, metadata };
}
