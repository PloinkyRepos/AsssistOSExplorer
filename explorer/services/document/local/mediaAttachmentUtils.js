import { generateId } from '../index.js';
import { toFiniteNumber, extractMediaIdFromPath } from './utils.js';

const MEDIA_ATTACHMENT_TYPES = {
    audio: {
        kind: 'audio',
        stateKey: 'backgroundSound',
        collectionKey: 'audio',
        modelFactory: (payload) => ({
            id: payload.id ?? '',
            url: payload.url || payload.path || null,
            name: payload.name,
            volume: toFiniteNumber(payload.volume, 50),
            loop: Boolean(payload.loop),
            duration: toFiniteNumber(payload.duration, payload.end ?? 0),
            start: toFiniteNumber(payload.start, 0),
            end: toFiniteNumber(payload.end, payload.duration ?? 0)
        })
    },
    video: {
        kind: 'video',
        stateKey: 'backgroundVideo',
        collectionKey: 'video',
        modelFactory: (payload) => {
            const model = {
                id: payload.id ?? '',
                url: payload.url || payload.path || null,
                name: payload.name,
                loop: Boolean(payload.loop),
                duration: toFiniteNumber(payload.duration, payload.end ?? 0),
                start: toFiniteNumber(payload.start, 0),
                end: toFiniteNumber(payload.end, payload.duration ?? 0)
            };
            if (payload.volume !== undefined) {
                model.volume = toFiniteNumber(payload.volume, 100);
            }
            return model;
        }
    },
    image: {
        kind: 'image',
        stateKey: 'backgroundImage',
        collectionKey: 'image',
        modelFactory: (payload) => ({
            id: payload.id ?? '',
            url: payload.url || payload.path || null,
            loop: Boolean(payload.loop),
            duration: toFiniteNumber(payload.duration, payload.end ?? 0),
            start: toFiniteNumber(payload.start, 0),
            end: toFiniteNumber(payload.end, payload.duration ?? 0),
            width: toFiniteNumber(payload.width, 0),
            height: toFiniteNumber(payload.height, 0),
            size: toFiniteNumber(payload.size, 0),
            name: payload.name
        })
    }
};

const getAttachmentConfig = (type) => {
    if (!type) {
        return null;
    }
    const normalized = String(type).toLowerCase();
    return MEDIA_ATTACHMENT_TYPES[normalized] ?? null;
};

const collectMediaAttachments = (commandsBlock = '', type) => {
    const config = getAttachmentConfig(type);
    if (!config || typeof commandsBlock !== 'string' || !commandsBlock.trim()) {
        return [];
    }
    const attachments = [];
    const lines = commandsBlock.split('\n');
    for (const rawLine of lines) {
        const parsed = parseModernMediaCommand(rawLine);
        if (!parsed) {
            continue;
        }
        const derivedKind = typeof parsed.kind === 'string'
            ? parsed.kind.toLowerCase()
            : (typeof parsed.derivedKind === 'string' ? parsed.derivedKind : config.kind);
        const kind = derivedKind || config.kind;
        if (kind !== config.kind) {
            continue;
        }
        const normalized = normalizeAttachmentPayload({
            id: parsed.id,
            path: parsed.path ?? parsed.url,
            volume: parsed.volume,
            duration: parsed.duration,
            loop: parsed.loop,
            start: parsed.start,
            end: parsed.end,
            name: parsed.name || parsed.filename
        });
        if (!normalized) {
            continue;
        }
        const model = config.modelFactory(normalized);
        if (model) {
            model.identifier = parsed.identifier;
            model.kind = config.kind;
            model.path = normalized.path;
            if (normalized.name) {
                model.name = normalized.name;
            }
            attachments.push(model);
        }
    }
    return attachments;
};

const updateChapterMediaState = (chapter) => {
    if (!chapter) {
        return;
    }
    const audioAttachments = collectMediaAttachments(chapter.commands ?? '', 'audio');
    const videoAttachments = collectMediaAttachments(chapter.commands ?? '', 'video');
    const imageAttachments = collectMediaAttachments(chapter.commands ?? '', 'image');
    chapter.mediaAttachments = {
        audio: audioAttachments,
        video: videoAttachments,
        image: imageAttachments
    };
    chapter.backgroundSound = audioAttachments[0] ?? null;
    chapter.backgroundVideo = videoAttachments[0] ?? null;
    chapter.backgroundImage = imageAttachments[0] ?? null;
};

const updateParagraphMediaState = (paragraph) => {
    if (!paragraph) {
        return;
    }
    const audioAttachments = collectMediaAttachments(paragraph.commands ?? '', 'audio');
    const videoAttachments = collectMediaAttachments(paragraph.commands ?? '', 'video');
    const imageAttachments = collectMediaAttachments(paragraph.commands ?? '', 'image');
    paragraph.mediaAttachments = {
        audio: audioAttachments,
        video: videoAttachments,
        image: imageAttachments
    };
};

const generateMediaCommandIdentifier = (type = '') => {
    const raw = generateId('media');
    const suffix = raw.slice(-6);
    const normalizedType = String(type || 'misc').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'misc';
    return `@media_${normalizedType}_${suffix}`;
};

const tokenizeKeyValuePairs = (text = '') => {
    const tokens = [];
    text.replace(/"([^"]*)"|(\S+)/g, (_match, quoted, bare) => {
        tokens.push(typeof quoted === 'string' ? quoted : bare);
        return '';
    });
    return tokens;
};

const parseModernMediaCommand = (line = '') => {
    const trimmed = line.trim();
    if (!trimmed.toLowerCase().startsWith('@media')) {
        return null;
    }
    const firstSpace = trimmed.indexOf(' ');
    const identifier = firstSpace !== -1 ? trimmed.slice(0, firstSpace) : trimmed;
    let derivedKind = null;
    const kindMatch = identifier.match(/^@media_([^_]+)_/i);
    if (kindMatch && kindMatch[1]) {
        derivedKind = kindMatch[1].toLowerCase();
    }
    const remainder = firstSpace !== -1 ? trimmed.slice(firstSpace).trim() : '';
    if (!remainder.toLowerCase().startsWith('attach')) {
        return null;
    }
    const payloadSection = remainder.slice('attach'.length).trim();
    if (!payloadSection) {
        return null;
    }
    const tokens = tokenizeKeyValuePairs(payloadSection);
    const map = {};
    for (let i = 0; i < tokens.length - 1; i += 2) {
        const key = tokens[i];
        const value = tokens[i + 1];
        if (!key) {
            continue;
        }
        const normalizedKey = key.replace(/^"+|"+$/g, '').toLowerCase();
        let normalizedValue = value;
        if (typeof value === 'string') {
            const cleaned = value.replace(/^"+|"+$/g, '');
            if (cleaned.toLowerCase() === 'true' || cleaned.toLowerCase() === 'false') {
                normalizedValue = cleaned.toLowerCase() === 'true';
            } else if (!Number.isNaN(Number(cleaned)) && cleaned.trim() !== '') {
                normalizedValue = Number(cleaned);
            } else {
                normalizedValue = cleaned;
            }
        }
        map[normalizedKey] = normalizedValue;
    }
    return {
        identifier,
        derivedKind,
        ...map
    };
};

const findAttachmentPayloadInCommands = (commandsBlock = '', type) => {
    const config = getAttachmentConfig(type);
    if (!config || typeof commandsBlock !== 'string' || !commandsBlock.trim()) {
        return null;
    }
    const lines = commandsBlock.split('\n');
    for (const rawLine of lines) {
        const parsed = parseModernMediaCommand(rawLine);
        if (!parsed) {
            continue;
        }
        const derivedKind = typeof parsed.kind === 'string'
            ? parsed.kind.toLowerCase()
            : (typeof parsed.derivedKind === 'string' ? parsed.derivedKind : config.kind);
        const kind = derivedKind || config.kind;
        if (kind === config.kind) {
            return {
                id: parsed.id ?? parsed.identifier ?? null,
                path: parsed.path ?? parsed.url ?? null,
                volume: parsed.volume,
                duration: parsed.duration,
                loop: parsed.loop,
                start: parsed.start,
                end: parsed.end
            };
        }
    }
    return null;
};

const normalizeAttachmentPayload = (payload = {}) => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    const normalized = {};
    if (typeof payload.id === 'string' && payload.id.trim()) {
        normalized.id = payload.id.trim();
    }
    const path = typeof payload.path === 'string' && payload.path.trim()
        ? payload.path.trim()
        : (typeof payload.url === 'string' ? payload.url.trim() : '');
    if (path) {
        normalized.path = path;
        if (!normalized.id) {
            const derivedId = extractMediaIdFromPath(path);
            if (derivedId) {
                normalized.id = derivedId;
            }
        }
    }
    if (!normalized.id) {
        return null;
    }
    if (typeof payload.name === 'string' && payload.name.trim()) {
        normalized.name = payload.name.trim();
    }
    if (payload.volume !== undefined) {
        normalized.volume = toFiniteNumber(payload.volume, 0);
    }
    if (payload.duration !== undefined) {
        normalized.duration = toFiniteNumber(payload.duration, 0);
    }
    if (payload.loop !== undefined) {
        normalized.loop = Boolean(payload.loop);
    }
    if (payload.start !== undefined) {
        normalized.start = toFiniteNumber(payload.start, 0);
    }
    if (payload.end !== undefined) {
        normalized.end = toFiniteNumber(payload.end, normalized.duration ?? 0);
    }
    if (payload.width !== undefined) {
        normalized.width = toFiniteNumber(payload.width, 0);
    }
    if (payload.height !== undefined) {
        normalized.height = toFiniteNumber(payload.height, 0);
    }
    if (payload.size !== undefined) {
        normalized.size = toFiniteNumber(payload.size, 0);
    }
    if (typeof payload.name === 'string' && payload.name.trim()) {
        normalized.name = payload.name.trim();
    }
    return normalized;
};

const stripAttachmentCommand = (commandsBlock = '', type, identifier = null) => {
    const config = getAttachmentConfig(type);
    if (!config || typeof commandsBlock !== 'string') {
        return commandsBlock || '';
    }
    const lines = commandsBlock.split('\n');
    const filtered = lines.filter((line) => {
        const parsed = parseModernMediaCommand(line);
        if (!parsed) {
            return true;
        }
        const derivedKind = typeof parsed.kind === 'string'
            ? parsed.kind.toLowerCase()
            : (typeof parsed.derivedKind === 'string' ? parsed.derivedKind : config.kind);
        const kind = derivedKind || config.kind;
        if (kind !== config.kind) {
            return true;
        }
        if (identifier && parsed.identifier === identifier) {
            return false;
        }
        if (!identifier) {
            return false;
        }
        return true;
    });
    return filtered.join('\n');
};

const ensureTrailingNewline = (value = '') => {
    if (!value) {
        return '';
    }
    return value.endsWith('\n') ? value : `${value}\n`;
};

const appendAttachmentCommand = (commandsBlock = '', type, payload = null, options = {}) => {
    const config = getAttachmentConfig(type);
    const identifierHint = options.identifier || payload?.identifier;
    const baseBlock = typeof commandsBlock === 'string' ? commandsBlock : '';
    const targetIdentifier = identifierHint ? String(identifierHint).trim() : '';
    const insertionIndex = targetIdentifier ? findAttachmentLineIndex(baseBlock, targetIdentifier) : null;
    const cleaned = targetIdentifier
        ? stripAttachmentCommand(baseBlock, type, targetIdentifier).trimEnd()
        : baseBlock.trimEnd();
    if (!config) {
        return ensureTrailingNewline(cleaned);
    }
    if (!payload) {
        return ensureTrailingNewline(cleaned);
    }
    const normalized = normalizeAttachmentPayload(payload);
    if (!normalized) {
        return ensureTrailingNewline(cleaned);
    }
    const identifier = identifierHint && identifierHint.startsWith('@media')
        ? identifierHint
        : generateMediaCommandIdentifier(config.kind);
    const pairs = [
        ['id', normalized.id ?? extractMediaIdFromPath(normalized.path)]
    ];
    if (normalized.name !== undefined) pairs.push(['name', normalized.name]);
    if (normalized.volume !== undefined) pairs.push(['volume', normalized.volume]);
    if (normalized.duration !== undefined) pairs.push(['duration', normalized.duration]);
    if (normalized.loop !== undefined) pairs.push(['loop', normalized.loop]);
    if (normalized.start !== undefined) pairs.push(['start', normalized.start]);
    if (normalized.end !== undefined) pairs.push(['end', normalized.end]);
    if (normalized.width !== undefined) pairs.push(['width', normalized.width]);
    if (normalized.height !== undefined) pairs.push(['height', normalized.height]);
    if (normalized.size !== undefined) pairs.push(['size', normalized.size]);

    const formatValue = (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }
        const str = String(value ?? '');
        return `"${str.replace(/"/g, '\\"')}"`;
    };

    const commandLine = `${identifier} attach ${pairs
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `"${key}" ${formatValue(value)}`)
        .join(' ')}`;

    if (insertionIndex !== null) {
        const cleanedLines = cleaned ? cleaned.split('\n') : [];
        const boundedIndex = Math.max(0, Math.min(insertionIndex, cleanedLines.length));
        cleanedLines.splice(boundedIndex, 0, commandLine);
        return ensureTrailingNewline(cleanedLines.join('\n'));
    }
    const base = cleaned ? ensureTrailingNewline(cleaned) : '';
    return ensureTrailingNewline(`${base}${commandLine}`);
};

const findAttachmentLineIndex = (commandsBlock, identifier) => {
    if (!identifier || typeof commandsBlock !== 'string') {
        return null;
    }
    const lines = commandsBlock.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const parsed = parseModernMediaCommand(lines[index]);
        if (parsed?.identifier === identifier) {
            return index;
        }
    }
    return null;
};

const createMediaAttachmentApi = ({ getDocumentModel, persistDocument }) => {
    const setChapterMediaAttachment = async (type, documentIdOrPath, chapterId, payload) => {
        const config = getAttachmentConfig(type);
        if (!config) {
            throw new Error(`Unsupported attachment type "${type}".`);
        }
        const document = await getDocumentModel(documentIdOrPath);
        const chapter = document.chapters.find((item) => item.id === chapterId);
        if (!chapter) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        const normalizedPayload = payload ? normalizeAttachmentPayload(payload) : null;
        if (payload && !normalizedPayload) {
            throw new Error(`Invalid ${type} payload supplied. Expected at least a path/url field.`);
        }
        if (!normalizedPayload) {
            const updatedCommands = stripAttachmentCommand(chapter.commands ?? '', type, payload?.identifier || null);
            chapter.commands = updatedCommands;
            if (chapter.metadata) {
                chapter.metadata.commands = updatedCommands;
            }
            updateChapterMediaState(chapter);
            await persistDocument(documentIdOrPath);
            return null;
        }
        const options = {};
        if (payload?.identifier) {
            options.identifier = payload.identifier;
        }
        const updatedCommands = appendAttachmentCommand(chapter.commands ?? '', type, normalizedPayload, options);
        chapter.commands = updatedCommands;
        if (chapter.metadata) {
            chapter.metadata.commands = updatedCommands;
        }
        updateChapterMediaState(chapter);
        const attachments = chapter.mediaAttachments?.[config.collectionKey] ?? [];
        let result = null;
        if (normalizedPayload) {
            const targetId = options.identifier || attachments[attachments.length - 1]?.identifier;
            result = attachments.find((item) => item.identifier === targetId) ?? attachments[attachments.length - 1] ?? null;
        }
        await persistDocument(documentIdOrPath);
        return result;
    };

    const setParagraphMediaAttachment = async (type, documentIdOrPath, chapterId, paragraphId, payload) => {
        const config = getAttachmentConfig(type);
        if (!config) {
            throw new Error(`Unsupported attachment type "${type}".`);
        }
        const document = await getDocumentModel(documentIdOrPath);
        const chapter = document.chapters.find((item) => item.id === chapterId);
        if (!chapter) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        const paragraph = chapter.paragraphs.find((item) => item.id === paragraphId);
        if (!paragraph) {
            throw new Error(`Paragraph ${paragraphId} not found.`);
        }
        const normalizedPayload = payload ? normalizeAttachmentPayload(payload) : null;
        if (payload && !normalizedPayload) {
            throw new Error(`Invalid ${type} payload supplied. Expected at least a path/url field.`);
        }
        if (!normalizedPayload) {
            const updatedCommands = stripAttachmentCommand(paragraph.commands ?? '', type, payload?.identifier || null);
            paragraph.commands = updatedCommands;
            if (paragraph.metadata) {
                paragraph.metadata.commands = updatedCommands;
            }
            updateParagraphMediaState(paragraph);
            await persistDocument(documentIdOrPath);
            return null;
        }
        const options = {};
        if (payload?.identifier) {
            options.identifier = payload.identifier;
        }
        const updatedCommands = appendAttachmentCommand(paragraph.commands ?? '', type, normalizedPayload, options);
        paragraph.commands = updatedCommands;
        if (paragraph.metadata) {
            paragraph.metadata.commands = updatedCommands;
        }
        updateParagraphMediaState(paragraph);
        const attachments = paragraph.mediaAttachments?.[config.collectionKey] ?? [];
        let result = null;
        if (attachments.length) {
            const targetId = options.identifier || attachments[attachments.length - 1]?.identifier;
            result = attachments.find((item) => item.identifier === targetId) ?? attachments[attachments.length - 1] ?? null;
        }
        await persistDocument(documentIdOrPath);
        return result;
    };

    const deleteChapterMediaAttachment = async (type, documentIdOrPath, chapterId, identifier = null) => {
        const config = getAttachmentConfig(type);
        if (!config) {
            throw new Error(`Unsupported attachment type "${type}".`);
        }
        const document = await getDocumentModel(documentIdOrPath);
        const chapter = document.chapters.find((item) => item.id === chapterId);
        if (!chapter) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        const updatedCommands = stripAttachmentCommand(chapter.commands ?? '', type, identifier || null);
        chapter.commands = updatedCommands;
        if (chapter.metadata) {
            chapter.metadata.commands = updatedCommands;
        }
        updateChapterMediaState(chapter);
        await persistDocument(documentIdOrPath);
        return true;
    };

    const deleteParagraphMediaAttachment = async (type, documentIdOrPath, chapterId, paragraphId, identifier = null) => {
        const config = getAttachmentConfig(type);
        if (!config) {
            throw new Error(`Unsupported attachment type "${type}".`);
        }
        const document = await getDocumentModel(documentIdOrPath);
        const chapter = document.chapters.find((item) => item.id === chapterId);
        if (!chapter) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        const paragraph = chapter.paragraphs.find((item) => item.id === paragraphId);
        if (!paragraph) {
            throw new Error(`Paragraph ${paragraphId} not found.`);
        }
        const updatedCommands = stripAttachmentCommand(paragraph.commands ?? '', type, identifier || null);
        paragraph.commands = updatedCommands;
        if (paragraph.metadata) {
            paragraph.metadata.commands = updatedCommands;
        }
        updateParagraphMediaState(paragraph);
        await persistDocument(documentIdOrPath);
        return true;
    };

    return {
        setChapterMediaAttachment,
        setParagraphMediaAttachment,
        deleteChapterMediaAttachment,
        deleteParagraphMediaAttachment
    };
};

export {
    collectMediaAttachments,
    updateChapterMediaState,
    updateParagraphMediaState,
    normalizeAttachmentPayload,
    parseModernMediaCommand,
    findAttachmentPayloadInCommands,
    createMediaAttachmentApi
};
