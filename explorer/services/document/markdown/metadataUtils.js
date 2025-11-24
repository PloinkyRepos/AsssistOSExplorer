export const COMMENT_KEY_PREFIX = 'achiles-ide-';

export const COMMENT_KEYS = {
    DOCUMENT: `${COMMENT_KEY_PREFIX}document`,
    CHAPTER: `${COMMENT_KEY_PREFIX}chapter`,
    PARAGRAPH: `${COMMENT_KEY_PREFIX}paragraph`,
    TOC: `${COMMENT_KEY_PREFIX}toc`,
    REFERENCES: `${COMMENT_KEY_PREFIX}references`
};

export const ALLOWED_METADATA_FIELDS = {
    [COMMENT_KEYS.DOCUMENT]: [
        'id',
        'title',
        'infoText',
        'commands',
        'comments',
        'variables',
        'pluginState',
        'references',
        'attachments',
        'snapshots',
        'tasks',
        'version',
        'updatedAt'
    ],
    [COMMENT_KEYS.CHAPTER]: [
        'id',
        'title',
        'commands',
        'comments',
        'pluginState',
        'references',
        'attachments',
        'snapshots',
        'tasks',
        'variables',
        'anchorId'
    ],
    [COMMENT_KEYS.PARAGRAPH]: [
        'id',
        'type',
        'commands',
        'comments',
        'pluginState',
        'references',
        'attachments',
        'snapshots',
        'tasks',
        'variables',
        'title'
    ],
    [COMMENT_KEYS.TOC]: [
        'collapsed'
    ],
    [COMMENT_KEYS.REFERENCES]: [
        'collapsed',
        'references'
    ]
};

export const normalizeLineEndings = (value = '') => value.replace(/\r\n/g, '\n');

export const decodeHtmlEntities = (value = '') => {
    if (typeof value !== 'string' || value.length === 0) {
        return value;
    }
    return value
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
};

export const decodeMetadataValue = (value) => {
    if (typeof value === 'string') {
        return decodeHtmlEntities(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => decodeMetadataValue(item));
    }
    if (value && typeof value === 'object') {
        const result = {};
        Object.entries(value).forEach(([key, nestedValue]) => {
            result[key] = decodeMetadataValue(nestedValue);
        });
        return result;
    }
    return value;
};

export const getMetadataComments = (text) => {
    if (!text) {
        return [];
    }
    const results = [];
    let searchIndex = 0;
    while (searchIndex < text.length) {
        const start = text.indexOf('<!--', searchIndex);
        if (start === -1) {
            break;
        }
        const end = text.indexOf('-->', start + 4);
        if (end === -1) {
            break;
        }
        const raw = text.slice(start + 4, end);
        const trimmed = raw.trim();
        let parsed = null;
        if (trimmed.length > 0) {
            try {
                parsed = JSON.parse(trimmed);
            } catch (error) {
                parsed = null;
            }
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const keys = Object.keys(parsed).filter((key) => typeof key === 'string' && key.startsWith(COMMENT_KEY_PREFIX));
            if (keys.length === 1) {
                const key = keys[0];
                results.push({
                    key,
                    value: parsed[key],
                    start,
                    end: end + 3
                });
            }
        }
        searchIndex = end + 3;
    }
    return results;
};

export const stripMetadataCommentBlocks = (text) => {
    if (!text) {
        return '';
    }
    const comments = getMetadataComments(text);
    if (comments.length === 0) {
        return text;
    }
    let result = '';
    let cursor = 0;
    comments.forEach(({ start, end }) => {
        result += text.slice(cursor, start);
        cursor = end;
    });
    result += text.slice(cursor);
    return result;
};

const pruneMetadataValue = (value) => {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === 'string') {
        return value.trim().length === 0 ? undefined : value;
    }
    if (Array.isArray(value)) {
        const prunedArray = value
            .map((item) => pruneMetadataValue(item))
            .filter((item) => item !== undefined);
        return prunedArray.length > 0 ? prunedArray : undefined;
    }
    if (typeof value === 'object') {
        const result = {};
        Object.entries(value).forEach(([key, nestedValue]) => {
            if (key === 'id') {
                if (nestedValue !== undefined && nestedValue !== null && String(nestedValue).trim() !== '') {
                    result[key] = nestedValue;
                }
                return;
            }
            const pruned = pruneMetadataValue(nestedValue);
            if (pruned !== undefined) {
                result[key] = pruned;
            }
        });
        return Object.keys(result).length > 0 ? result : undefined;
    }
    return value;
};

const pruneMetadata = (metadata) => {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }
    const result = {};
    Object.entries(metadata).forEach(([key, value]) => {
        if (key === 'id') {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                result[key] = value;
            }
            return;
        }
        const pruned = pruneMetadataValue(value);
        if (pruned !== undefined) {
            result[key] = pruned;
        }
    });
    if (!result.id && metadata.id && String(metadata.id).trim() !== '') {
        result.id = metadata.id;
    }
    return result.id ? result : null;
};

export const ensureMetadataId = (metadata, fallbackId) => {
    const result = { ...(metadata || {}) };
    if (!result.id && fallbackId) {
        result.id = fallbackId;
    }
    return result;
};

export const filterMetadataFields = (key, metadata) => {
    if (!metadata || typeof metadata !== 'object') {
        return metadata;
    }
    const allowed = ALLOWED_METADATA_FIELDS[key];
    if (!allowed || allowed.length === 0) {
        return metadata;
    }
    const filtered = {};
    allowed.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(metadata, field)) {
            filtered[field] = decodeMetadataValue(metadata[field]);
        }
    });
    return filtered;
};

export const createMetadataComment = (key, metadata) => {
    const filtered = filterMetadataFields(key, metadata);
    const pruned = pruneMetadata(filtered);
    if (!pruned) {
        return '';
    }
    const payload = {};
    payload[key] = pruned;
    return `<!-- ${JSON.stringify(payload)} -->\n`;
};
