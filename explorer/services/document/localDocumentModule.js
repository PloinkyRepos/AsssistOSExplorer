import createDocumentService, {
    createChapterMetadataDefaults,
    createDocumentMetadataDefaults,
    createEmptyChapter,
    createEmptyDocument,
    createEmptyParagraph,
    createParagraphMetadataDefaults,
    ensureDocumentStructure,
    generateId
} from './index.js';

const DEFAULT_STYLE_PREFERENCES = {
    "document-title-font-size": "large",
    "chapter-title-font-size": "medium",
    "document-font-size": "medium",
    "document-font-family": "arial",
    "document-indent-size": "medium",
    "infoText-font-size": "medium"
};

const DOCUMENT_TYPES = {
    DOCUMENT: 'document',
    SNAPSHOT: 'snapshot'
};

const decodeHtmlEntities = (value = '') => {
    if (typeof value !== 'string') {
        return value;
    }
    return value
        .replace(/&#13;/g, '\n')
        .replace(/&#10;/g, '\n')
        .replace(/&#9;/g, '\t')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&#x2F;/g, '/')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
};

const decodeValueDeep = (value) => {
    if (typeof value === 'string') {
        return decodeHtmlEntities(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => decodeValueDeep(item));
    }
    if (value && typeof value === 'object') {
        const result = {};
        Object.entries(value).forEach(([key, nestedValue]) => {
            result[key] = decodeValueDeep(nestedValue);
        });
        return result;
    }
    return value;
};

const decodeString = (value, fallback = '') => {
    if (value === undefined || value === null) {
        return fallback;
    }
    return typeof value === 'string' ? decodeHtmlEntities(value) : value;
};

const normalizeCommandString = (value, fallback = '') => {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.join('\n');
    }
    if (value === undefined || value === null) {
        return fallback ?? '';
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (_) {
            return fallback ?? '';
        }
    }
    return String(value);
};

const scriptCommandNames = new Set(['macro', 'jsdef', 'form', 'prompt']);

const encodeSOPCode = (str) => {
    if (typeof str !== 'string') {
        return '';
    }
    return str.replace(/[%'\n"\[\]$@~]/g, (char) => {
        const code = char.charCodeAt(0).toString(16).toUpperCase();
        return `%${code.length < 2 ? `0${code}` : code}`;
    });
};

const decodeSOPCode = (encodedStr) => {
    if (typeof encodedStr !== 'string') {
        return '';
    }
    return encodedStr.replace(/%([0-9A-Fa-f]{2})/g, (_match, hexDigits) => {
        const charCode = parseInt(hexDigits, 16);
        return String.fromCharCode(charCode);
    });
};

const extractMacroOrJSDefOnASingleLine = (input = '') => {
    if (typeof input !== 'string') {
        return '';
    }
    const lines = input.split('\n');
    const outputLines = [];
    let currentIndex = 0;

    const parseScriptBlock = (startIndex) => {
        if (startIndex >= lines.length) {
            return null;
        }
        const startLine = lines[startIndex].trim();
        const match = startLine.match(/^@(\S+)\s+(macro|jsdef|form|prompt)(?:\s+(.*))?$/i);
        if (!match) {
            return null;
        }
        const scriptName = match[1];
        const commandName = match[2].toLowerCase();
        const argsString = match[3] || '';
        const args = argsString.split(/\s+/).filter(Boolean);
        const bodyLines = [];
        let cursor = startIndex + 1;
        while (cursor < lines.length) {
            const currentLine = lines[cursor];
            const trimmed = currentLine.trim();
            if (trimmed.toLowerCase() === 'end') {
                const encodedArgs = args.join(',');
                const encodedBody = encodeSOPCode(bodyLines.join('\n'));
                return {
                    outputLine: `@${scriptName} ${commandName} '${encodedArgs}' '${encodedBody}'`,
                    nextIndex: cursor + 1
                };
            }
            bodyLines.push(currentLine.trim());
            cursor += 1;
        }
        console.warn(`macro variable '${scriptName}' starting on line ${startIndex + 1} was not closed with 'end'.`);
        return null;
    };

    while (currentIndex < lines.length) {
        const block = parseScriptBlock(currentIndex);
        if (block) {
            outputLines.push(block.outputLine);
            currentIndex = block.nextIndex;
        } else {
            outputLines.push(lines[currentIndex].trim());
            currentIndex += 1;
        }
    }
    return outputLines.join('\n');
};

const parseCommandsForUI = (commandsBlock = '', chapterId, paragraphId) => {
    if (typeof commandsBlock !== 'string' || !commandsBlock.trim()) {
        return [];
    }
    const normalized = extractMacroOrJSDefOnASingleLine(commandsBlock);
    const splitCommands = normalized.split('\n');
    const commands = [];
    for (const rawLine of splitCommands) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) {
            continue;
        }
        const parts = line.split(' ');
        if (!parts[0] || !parts[0].startsWith('@')) {
            continue;
        }
        const varToken = parts.shift();
        const varName = varToken.slice(1);
        if (!varName) {
            continue;
        }
        let commandToken = parts.shift() || '';
        const parsedCommand = {
            varName,
            command: '',
            expression: ''
        };
        if (commandToken.startsWith('?')) {
            parsedCommand.conditional = true;
            commandToken = commandToken.slice(1);
        }
        parsedCommand.command = commandToken;
        if (commandToken === 'new') {
            parsedCommand.customType = parts.shift() || '';
        }
        if (scriptCommandNames.has(commandToken)) {
            const paramsToken = parts.shift() || '';
            const expressionToken = parts.join(' ').trim();
            const paramsSection = paramsToken.startsWith("'") && paramsToken.endsWith("'")
                ? paramsToken.slice(1, -1)
                : paramsToken;
            parsedCommand.params = paramsSection ? paramsSection.split(',') : [];
            const encodedExpression = expressionToken.startsWith("'") && expressionToken.endsWith("'")
                ? expressionToken.slice(1, -1)
                : expressionToken;
            parsedCommand.expression = decodeSOPCode(encodedExpression);
        } else {
            parsedCommand.expression = parts.join(' ').trim();
        }
        if (chapterId) {
            parsedCommand.chapterId = chapterId;
        }
        if (paragraphId) {
            parsedCommand.paragraphId = paragraphId;
        }
        commands.push(parsedCommand);
    }
    return commands;
};

const decodeBase64 = (value) => {
    if (!value) return '';
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
        try {
            return decodeURIComponent(escape(window.atob(value)));
        } catch (error) {
            return value;
        }
    }
    try {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(value, 'base64').toString('utf8');
        }
    } catch (error) {
        // ignore
    }
    return value;
};

const encodeBase64 = (value) => {
    if (!value) return '';
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
        return window.btoa(unescape(encodeURIComponent(value)));
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(value, 'utf8').toString('base64');
    }
    return value;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const deriveChapterBackgroundSound = (chapter = {}, metadata = {}) => {
    const variableSource = Array.isArray(chapter.variables)
        ? chapter.variables
        : Array.isArray(metadata.variables)
            ? metadata.variables
            : [];
    const audioVariable = variableSource.find((variable) => variable?.name === 'audio-attachment' && variable.value);
    if (!audioVariable) {
        return null;
    }
    const options = audioVariable.options || {};
    return {
        id: options.id ?? '',
        url: typeof audioVariable.value === 'string' ? audioVariable.value : '',
        volume: typeof options.volume === 'number' ? options.volume : 50,
        loop: Boolean(options.loop),
        duration: typeof options.duration === 'number' ? options.duration : 0,
        start: typeof options.start === 'number' ? options.start : 0,
        end: typeof options.end === 'number' ? options.end : (typeof options.duration === 'number' ? options.duration : 0)
    };
};

const createCommentDefaults = (comments = {}) => ({
    messages: [],
    status: null,
    plugin: '',
    pluginLastOpened: '',
    ...comments
});

class Chapter {
    constructor(payload = {}) {
        Object.assign(this, payload);
    }
}

const hydrateParagraphModel = (paragraph, chapterId) => {
    const metadata = createParagraphMetadataDefaults(paragraph.metadata ?? {});
    const comments = createCommentDefaults(metadata.comments);
    const commands = normalizeCommandString(paragraph.commands ?? metadata.commands ?? '');
    paragraph.commands = commands;
    metadata.commands = commands;

    return {
        id: metadata.id,
        chapterId,
        metadata,
        text: paragraph.text ?? '',
        leading: paragraph.leading ?? '',
        trailing: paragraph.trailing ?? '\n',
        type: metadata.type ?? 'markdown',
        commands,
        comments,
        pluginState: metadata.pluginState ?? {},
        references: metadata.references ?? [],
        attachments: metadata.attachments ?? [],
        snapshots: metadata.snapshots ?? [],
        tasks: metadata.tasks ?? [],
        variables: metadata.variables ?? []
    };
};

const hydrateChapterModel = (chapter, index) => {
    const metadata = createChapterMetadataDefaults(chapter.metadata ?? {});
    const comments = createCommentDefaults(metadata.comments);
    const headingLevel = chapter.heading?.level ?? 2;
    const headingText = chapter.heading?.text ?? metadata.title ?? `Chapter ${index + 1}`;
    const commands = normalizeCommandString(chapter.commands ?? metadata.commands ?? '');
    chapter.commands = commands;
    metadata.commands = commands;
    let paragraphs = (chapter.paragraphs ?? []).map((paragraph) => hydrateParagraphModel(paragraph, metadata.id));

    if (paragraphs.length === 0) {
        const emptyParagraphMetadata = createParagraphMetadataDefaults({});
        const defaultParagraph = hydrateParagraphModel({
            metadata: emptyParagraphMetadata,
            text: ''
        }, metadata.id);
        paragraphs = [defaultParagraph];
    }

    const backgroundSound = deriveChapterBackgroundSound(chapter, metadata);

    const chapterInstance = new Chapter({
        id: metadata.id,
        metadata,
        title: metadata.title ?? headingText,
        position: index,
        headingLevel,
        headingText,
        leading: chapter.leading ?? '',
        commands,
        comments,
        pluginState: metadata.pluginState ?? {},
        references: metadata.references ?? [],
        attachments: metadata.attachments ?? [],
        snapshots: metadata.snapshots ?? [],
        tasks: metadata.tasks ?? [],
        variables: metadata.variables ?? [],
        paragraphs
    });

    if (backgroundSound) {
        chapterInstance.backgroundSound = backgroundSound;
    }

    return chapterInstance;
};

const hydrateDocumentModel = (document, path) => {
    const metadata = createDocumentMetadataDefaults(document.metadata ?? {});
    const comments = createCommentDefaults(metadata.comments);
    const docId = metadata.id ?? generateId('doc');
    const encodedId = encodeBase64(path || docId);
    const fileName = path ? path.split('/').pop() : null;
    if (fileName) {
        const baseName = fileName.replace(/\.[^.]+$/, '');
        metadata.title = baseName;
    }

    let chapters = (document.chapters ?? []).map((chapter, index) => hydrateChapterModel(chapter, index));
    const commands = normalizeCommandString(document.commands ?? metadata.commands ?? '');
    document.commands = commands;
    metadata.commands = commands;

    if (chapters.length === 0) {
        const defaultChapterMetadata = createChapterMetadataDefaults({ title: 'Chapter 1' });
        const defaultChapter = hydrateChapterModel(createEmptyChapter({
            metadata: defaultChapterMetadata,
            heading: {
                level: 2,
                text: defaultChapterMetadata.title
            }
        }), 0);
        chapters = [defaultChapter];
    }

    return {
        id: encodedId,
        docId: encodedId,
        documentId: docId,
        path,
        metadata,
        title: metadata.title ?? 'Untitled Document',
        infoText: metadata.infoText ?? '',
        commands,
        comments,
        pluginState: metadata.pluginState ?? {},
        references: metadata.references ?? [],
        attachments: metadata.attachments ?? [],
        snapshots: metadata.snapshots ?? [],
        tasks: metadata.tasks ?? [],
        variables: metadata.variables ?? [],
        version: metadata.version ?? 1,
        updatedAt: metadata.updatedAt ?? new Date().toISOString(),
        type: DOCUMENT_TYPES.DOCUMENT,
        preface: document.preface ?? '',
        chapters
    };
};

const syncParagraphMetadata = (paragraph = {}) => {
    if (!paragraph) {
        return;
    }
    paragraph.comments = createCommentDefaults(paragraph.comments);
    const commands = normalizeCommandString(paragraph.commands ?? paragraph.metadata?.commands ?? '');
    paragraph.commands = commands;
    const overrides = {
        ...(paragraph.metadata ?? {}),
        id: paragraph.id,
        type: paragraph.type ?? paragraph.metadata?.type ?? 'markdown',
        commands,
        comments: paragraph.comments,
        pluginState: paragraph.pluginState ?? paragraph.metadata?.pluginState ?? {},
        references: paragraph.references ?? paragraph.metadata?.references ?? [],
        attachments: paragraph.attachments ?? paragraph.metadata?.attachments ?? [],
        snapshots: paragraph.snapshots ?? paragraph.metadata?.snapshots ?? [],
        tasks: paragraph.tasks ?? paragraph.metadata?.tasks ?? [],
        variables: paragraph.variables ?? paragraph.metadata?.variables ?? [],
        title: paragraph.metadata?.title
    };
    paragraph.metadata = createParagraphMetadataDefaults(overrides);
};

const syncChapterMetadata = (chapter = {}) => {
    if (!chapter) {
        return;
    }
    chapter.comments = createCommentDefaults(chapter.comments);
    const commands = normalizeCommandString(chapter.commands ?? chapter.metadata?.commands ?? '');
    chapter.commands = commands;
    const overrides = {
        ...(chapter.metadata ?? {}),
        id: chapter.id,
        title: chapter.title,
        commands,
        comments: chapter.comments,
        pluginState: chapter.pluginState ?? chapter.metadata?.pluginState ?? {},
        references: chapter.references ?? chapter.metadata?.references ?? [],
        attachments: chapter.attachments ?? chapter.metadata?.attachments ?? [],
        snapshots: chapter.snapshots ?? chapter.metadata?.snapshots ?? [],
        tasks: chapter.tasks ?? chapter.metadata?.tasks ?? [],
        variables: chapter.variables ?? chapter.metadata?.variables ?? []
    };
    chapter.metadata = createChapterMetadataDefaults(overrides);
    if (Array.isArray(chapter.paragraphs)) {
        chapter.paragraphs.forEach((paragraph) => syncParagraphMetadata(paragraph));
    }
};

const syncDocumentMetadata = (document = {}) => {
    if (!document) {
        return;
    }
    document.comments = createCommentDefaults(document.comments);
    const metadataId = document.metadata?.id ?? document.documentId ?? document.docId ?? generateId('doc');
    const commands = normalizeCommandString(document.commands ?? document.metadata?.commands ?? '');
    document.commands = commands;
    const overrides = {
        ...(document.metadata ?? {}),
        id: metadataId,
        title: document.title,
        infoText: document.infoText ?? document.metadata?.infoText ?? '',
        commands,
        comments: document.comments,
        pluginState: document.pluginState ?? document.metadata?.pluginState ?? {},
        references: document.references ?? document.metadata?.references ?? [],
        attachments: document.attachments ?? document.metadata?.attachments ?? [],
        snapshots: document.snapshots ?? document.metadata?.snapshots ?? [],
        tasks: document.tasks ?? document.metadata?.tasks ?? [],
        variables: document.variables ?? document.metadata?.variables ?? [],
        version: document.version ?? document.metadata?.version ?? 1,
        updatedAt: new Date().toISOString()
    };
    document.metadata = createDocumentMetadataDefaults(overrides);
    document.version = document.metadata.version;
    document.updatedAt = document.metadata.updatedAt ?? document.updatedAt;
    if (Array.isArray(document.chapters)) {
        document.chapters.forEach((chapter) => syncChapterMetadata(chapter));
    }
};

const serializeParagraph = (paragraph) => ({
    id: paragraph.id,
    metadata: decodeValueDeep({
        ...paragraph.metadata,
        id: paragraph.id,
        type: paragraph.type,
        commands: paragraph.commands,
        comments: paragraph.comments,
        pluginState: paragraph.pluginState,
        references: paragraph.references,
        attachments: paragraph.attachments,
        snapshots: paragraph.snapshots,
        tasks: paragraph.tasks,
        variables: paragraph.variables,
        title: paragraph.metadata?.title
    }),
    leading: decodeString(paragraph.leading ?? ''),
    text: decodeString(paragraph.text ?? ''),
    trailing: decodeString(paragraph.trailing ?? '\n'),
    hasMetadata: true
});

const serializeChapter = (chapter) => ({
    id: chapter.id,
    metadata: decodeValueDeep({
        ...chapter.metadata,
        id: chapter.id,
        title: decodeString(chapter.title ?? chapter.metadata?.title ?? ''),
        commands: chapter.commands,
        comments: chapter.comments,
        pluginState: chapter.pluginState,
        references: chapter.references,
        attachments: chapter.attachments,
        snapshots: chapter.snapshots,
        tasks: chapter.tasks,
        variables: chapter.variables
    }),
    heading: {
        level: chapter.headingLevel ?? chapter.metadata.headingLevel ?? 2,
        text: decodeString(chapter.headingText ?? chapter.title)
    },
    leading: decodeString(chapter.leading ?? ''),
    paragraphs: chapter.paragraphs.map(serializeParagraph)
});

const serializeDocumentModel = (document) => ensureDocumentStructure({
    metadata: decodeValueDeep({
        ...document.metadata,
        id: document.metadata.id ?? generateId('doc'),
        title: decodeString(document.title ?? document.metadata.title),
        infoText: decodeString(document.infoText ?? document.metadata.infoText ?? ''),
        commands: decodeString(document.commands ?? document.metadata.commands ?? ''),
        comments: document.comments,
        pluginState: document.pluginState,
        references: document.references,
        attachments: document.attachments,
        snapshots: document.snapshots,
        tasks: document.tasks,
        variables: document.variables,
        version: document.version ?? document.metadata.version,
        updatedAt: document.metadata.updatedAt ?? document.updatedAt ?? new Date().toISOString()
    }),
    preface: decodeString(document.preface ?? ''),
    chapters: document.chapters.map(serializeChapter)
});

class DocumentStore {
    constructor(options = {}) {
        this.service = createDocumentService(options);
        this.documents = new Map(); // key: resolved path
        this.snapshots = new Map(); // key: resolved path -> array snapshot metadata
    }

    resolvePath(documentIdOrPath) {
        if (!documentIdOrPath) {
            throw new Error('Document identifier is required.');
        }
        if (documentIdOrPath.startsWith('/')) {
            return documentIdOrPath;
        }
        return decodeBase64(documentIdOrPath);
    }

    toDocumentId(path) {
        return encodeBase64(path);
    }

    getCached(path) {
        return this.documents.get(path) ?? null;
    }

    setCached(path, document) {
        this.documents.set(path, document);
    }

    async load(path) {
        const result = await this.service.load(path);
        const model = hydrateDocumentModel(result.document, path);
        this.setCached(path, model);
        return model;
    }

    async get(path) {
        const cached = this.getCached(path);
        if (cached) {
            return cached;
        }
        return this.load(path);
    }

    async save(path) {
        const document = await this.get(path);
        syncDocumentMetadata(document);
        const serializable = serializeDocumentModel(document);
        await this.service.save(path, serializable);
        document.updatedAt = document.metadata?.updatedAt ?? document.updatedAt ?? new Date().toISOString();
        return document;
    }

    async create(path, overrides = {}) {
        const doc = createEmptyDocument(overrides);
        const model = hydrateDocumentModel(doc, path);
        this.setCached(path, model);
        await this.save(path);
        return model;
    }

    remove(path) {
        this.documents.delete(path);
        this.snapshots.delete(path);
    }
}

const documentStore = new DocumentStore();

const findDocumentByChapterId = (chapterId) => {
    if (!chapterId) {
        return null;
    }
    for (const [path, document] of documentStore.documents.entries()) {
        const chapter = document.chapters.find((item) => item.id === chapterId);
        if (chapter) {
            return { document, path, chapter };
        }
    }
    return null;
};

const getDocumentModel = async (documentIdOrPath) => {
    const path = documentStore.resolvePath(documentIdOrPath);
    return documentStore.get(path);
};

const persistDocument = async (documentIdOrPath) => {
    const path = documentStore.resolvePath(documentIdOrPath);
    return documentStore.save(path);
};

const normalizePosition = (array, position) => {
    if (!Array.isArray(array) || array.length === 0) {
        return 0;
    }
    if (typeof position !== 'number' || Number.isNaN(position)) {
        return array.length;
    }
    return Math.min(Math.max(position, 0), array.length);
};

const documentModule = {
    documentTypes: DOCUMENT_TYPES,
    Chapter,
    async loadDocument(_spaceId, documentIdOrPath) {
        const path = documentStore.resolvePath(documentIdOrPath);
        return documentStore.load(path);
    },
    async getDocuments(_spaceId) {
        // Local implementation returns cached documents metadata
        return Array.from(documentStore.documents.values()).map((document) => ({
            id: document.id,
            docId: document.docId,
            title: document.title,
            infoText: document.infoText,
            updatedAt: document.updatedAt,
            type: document.type ?? DOCUMENT_TYPES.DOCUMENT,
            path: document.path
        }));
    },
    async getDocument(_spaceId, documentIdOrPath, queryParams = {}) {
        const document = await getDocumentModel(documentIdOrPath);
        if (!queryParams || Object.keys(queryParams).length === 0) {
            return document;
        }

        if (queryParams.fields) {
            if (Array.isArray(queryParams.fields)) {
                return queryParams.fields.reduce((acc, field) => {
                    acc[field] = clone(document[field]);
                    return acc;
                }, {});
            }
            return clone(document[queryParams.fields]);
        }

        return document;
    },
    async updateDocument(_spaceId, documentIdOrPath, title, docId, infoText, commands, comments) {
        const document = await getDocumentModel(documentIdOrPath);
        if (typeof title === 'string') {
            document.title = title;
        }
        if (typeof docId === 'string' && docId !== document.docId) {
            document.docId = docId;
        }
        document.infoText = infoText ?? '';
        const currentCommands = normalizeCommandString(document.commands ?? '', '');
        document.commands = currentCommands;
        if (commands !== undefined) {
            document.commands = normalizeCommandString(commands, currentCommands);
        }
        document.comments = createCommentDefaults(comments ?? document.comments);
        document.metadata = {
            ...document.metadata,
            title: document.title,
            infoText: document.infoText,
            commands: document.commands,
            comments: document.comments
        };
        await persistDocument(documentIdOrPath);
        return document;
    },
    async createDocument(_spaceId, documentData) {
        const path = documentData?.path;
        if (!path) {
            throw new Error('createDocument requires a path in documentData.');
        }
        return documentStore.create(path, documentData);
    },
    async deleteDocument(_spaceId, documentIdOrPath) {
        const path = documentStore.resolvePath(documentIdOrPath);
        await documentStore.service.fs.writeRaw(path, '');
        documentStore.remove(path);
        return true;
    },
    async addChapter(_spaceId, documentIdOrPath, title, commands, comments, position) {
        const document = await getDocumentModel(documentIdOrPath);
        const chapterMetadata = createChapterMetadataDefaults({
            title: title ?? 'New Chapter',
            commands: normalizeCommandString(commands ?? '', ''),
            comments: comments ?? { messages: [] }
        });
        const chapter = hydrateChapterModel(createEmptyChapter({
            metadata: chapterMetadata,
            heading: {
                level: 2,
                text: chapterMetadata.title
            }
        }), document.chapters.length);

        const insertPosition = normalizePosition(document.chapters, position);
        document.chapters.splice(insertPosition, 0, chapter);
        document.chapters.forEach((item, index) => {
            item.position = index;
        });

        await persistDocument(documentIdOrPath);
        return chapter;
    },
    async deleteChapter(_spaceId, documentIdOrPath, chapterId) {
        const document = await getDocumentModel(documentIdOrPath);
        const index = document.chapters.findIndex((chapter) => chapter.id === chapterId);
        if (index === -1) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        const [removed] = document.chapters.splice(index, 1);
        document.chapters.forEach((chapter, idx) => {
            chapter.position = idx;
        });
        await persistDocument(documentIdOrPath);
        return removed;
    },
    async changeChapterOrder(_spaceId, documentIdOrPath, chapterId, position) {
        const document = await getDocumentModel(documentIdOrPath);
        const chapters = document.chapters;
        const currentIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
        if (currentIndex === -1) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        const targetIndex = normalizePosition(chapters, position);
        const [chapter] = chapters.splice(currentIndex, 1);
        chapters.splice(targetIndex, 0, chapter);
        chapters.forEach((item, index) => {
            item.position = index;
        });
        await persistDocument(documentIdOrPath);
        return chapter;
    },
    async getChapter(_spaceId, documentIdOrPathOrChapterId, maybeChapterId) {
        if (typeof maybeChapterId === 'undefined') {
            const chapterId = documentIdOrPathOrChapterId;
            const located = findDocumentByChapterId(chapterId);
            if (!located) {
                throw new Error(`Chapter ${chapterId} not found.`);
            }
            return located.chapter;
        }
        const document = await getDocumentModel(documentIdOrPathOrChapterId);
        const chapterId = maybeChapterId;
        const chapter = document.chapters.find((item) => item.id === chapterId);
        if (!chapter) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        return chapter;
    },
    async updateChapter(_spaceId, documentIdOrPathOrChapterId, maybeChapterId, titleArg, commandsArg, commentsArg) {
        let chapterId;
        let title;
        let commands;
        let comments;
        let documentReference;
        let documentPath;

        if (typeof maybeChapterId === 'string' && arguments.length >= 6) {
            chapterId = maybeChapterId;
            title = titleArg;
            commands = commandsArg;
            comments = commentsArg;
            documentReference = await getDocumentModel(documentIdOrPathOrChapterId);
            documentPath = documentReference.path;
        } else {
            chapterId = documentIdOrPathOrChapterId;
            title = maybeChapterId;
            commands = titleArg;
            comments = commandsArg;
            const located = findDocumentByChapterId(chapterId);
            if (!located) {
                throw new Error(`Chapter ${chapterId} not found.`);
            }
            documentReference = located.document;
            documentPath = located.path;
        }

        const chapter = documentReference.chapters.find((item) => item.id === chapterId);
        if (!chapter) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        if (typeof title === 'string') {
            chapter.title = title;
            chapter.headingText = title;
            chapter.metadata.title = title;
        }
        const currentChapterCommands = normalizeCommandString(chapter.commands ?? '', '');
        chapter.commands = currentChapterCommands;
        if (commands !== undefined) {
            chapter.commands = normalizeCommandString(commands, currentChapterCommands);
        }
        chapter.metadata.commands = chapter.commands;
        if (comments) {
            chapter.comments = createCommentDefaults(comments);
            chapter.metadata.comments = chapter.comments;
        }
        await persistDocument(documentPath ?? documentReference.path ?? documentIdOrPathOrChapterId);
        return chapter;
    },
    async setChapterVarValue(_spaceId, documentIdOrPath, chapterId, varName, value, options = undefined) {
        const document = await getDocumentModel(documentIdOrPath);
        const chapter = document.chapters.find((item) => item.id === chapterId);
        if (!chapter) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        if (!Array.isArray(chapter.variables)) {
            chapter.variables = [];
        }
        let variable = chapter.variables.find((item) => item.name === varName);
        if (!variable) {
            variable = { name: varName, value: null };
            chapter.variables.push(variable);
        }
        variable.value = value;
        if (options !== undefined) {
            if (options === null) {
                delete variable.options;
            } else {
                variable.options = options;
            }
        }
        chapter.metadata.variables = chapter.variables;
        await persistDocument(documentIdOrPath);
        return variable;
    },
    async addParagraph(_spaceId, chapterId, paragraphText = '', metadata = null, paragraphType = 'markdown', position = null) {
        let documentReference;
        let chapterReference;
        for (const document of documentStore.documents.values()) {
            const chapter = document.chapters.find((item) => item.id === chapterId);
            if (chapter) {
                documentReference = document;
                chapterReference = chapter;
                break;
            }
        }

        if (!chapterReference) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }

        const paragraphMetadata = createParagraphMetadataDefaults({
            ...(metadata ?? {}),
            type: paragraphType
        });
        const paragraph = hydrateParagraphModel({
            metadata: paragraphMetadata,
            text: paragraphText
        }, chapterReference.id);

        const insertPosition = normalizePosition(chapterReference.paragraphs, position);
        chapterReference.paragraphs.splice(insertPosition, 0, paragraph);
        if (!documentReference?.path) {
            throw new Error('Unable to resolve document path for addParagraph operation.');
        }
        await persistDocument(documentReference.path);
        return paragraph;
    },
    async deleteParagraph(_spaceId, chapterId, paragraphId) {
        let documentReference;
        let chapterReference;
        for (const document of documentStore.documents.values()) {
            const chapter = document.chapters.find((item) => item.id === chapterId);
            if (chapter) {
                chapterReference = chapter;
                documentReference = document;
                break;
            }
        }
        if (!chapterReference) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        const index = chapterReference.paragraphs.findIndex((paragraph) => paragraph.id === paragraphId);
        if (index === -1) {
            throw new Error(`Paragraph ${paragraphId} not found.`);
        }
        const [removed] = chapterReference.paragraphs.splice(index, 1);
        if (!documentReference?.path) {
            throw new Error('Unable to resolve document path for deleteParagraph operation.');
        }
        await persistDocument(documentReference.path);
        return removed;
    },
    async changeParagraphOrder(_spaceId, chapterId, paragraphId, position) {
        let documentReference;
        let chapterReference;
        for (const document of documentStore.documents.values()) {
            const chapter = document.chapters.find((item) => item.id === chapterId);
            if (chapter) {
                chapterReference = chapter;
                documentReference = document;
                break;
            }
        }
        if (!chapterReference) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        const paragraphs = chapterReference.paragraphs;
        const currentIndex = paragraphs.findIndex((paragraph) => paragraph.id === paragraphId);
        if (currentIndex === -1) {
            throw new Error(`Paragraph ${paragraphId} not found.`);
        }
        const targetIndex = normalizePosition(paragraphs, position);
        const [paragraph] = paragraphs.splice(currentIndex, 1);
        paragraphs.splice(targetIndex, 0, paragraph);
        if (!documentReference?.path) {
            throw new Error('Unable to resolve document path for changeParagraphOrder operation.');
        }
        await persistDocument(documentReference.path);
        return paragraph;
    },
    async getParagraph(_spaceId, paragraphId) {
        for (const document of documentStore.documents.values()) {
            for (const chapter of document.chapters) {
                const paragraph = chapter.paragraphs.find((item) => item.id === paragraphId);
                if (paragraph) {
                    return paragraph;
                }
            }
        }
        throw new Error(`Paragraph ${paragraphId} not found.`);
    },
    async updateParagraph(_spaceId, chapterId, paragraphId, text, commands, comments) {
        let documentReference;
        let paragraphReference;
        for (const document of documentStore.documents.values()) {
            for (const chapter of document.chapters) {
                if (chapter.id !== chapterId) continue;
                const paragraph = chapter.paragraphs.find((item) => item.id === paragraphId);
                if (paragraph) {
                    paragraphReference = paragraph;
                    documentReference = document;
                    break;
                }
            }
        }
        if (!paragraphReference) {
            throw new Error(`Paragraph ${paragraphId} not found.`);
        }

        if (typeof text === 'string') {
            paragraphReference.text = text;
        }
        const currentParagraphCommands = normalizeCommandString(paragraphReference.commands ?? '', '');
        paragraphReference.commands = currentParagraphCommands;
        if (commands !== undefined) {
            paragraphReference.commands = normalizeCommandString(commands, currentParagraphCommands);
        }
        paragraphReference.metadata.commands = paragraphReference.commands;
        if (comments) {
            paragraphReference.comments = createCommentDefaults(comments);
            paragraphReference.metadata.comments = paragraphReference.comments;
        }
        if (!documentReference?.path) {
            throw new Error('Unable to resolve document path for updateParagraph operation.');
        }
        await persistDocument(documentReference.path);
        return paragraphReference;
    },
    async getDocCommandsParsed(_spaceId, documentIdOrPath) {
        const document = await getDocumentModel(documentIdOrPath);
        const commands = [];
        const appendCommands = (commandBlock, chapterId, paragraphId) => {
            if (typeof commandBlock !== 'string' || !commandBlock.trim()) {
                return;
            }
            const parsed = parseCommandsForUI(commandBlock, chapterId, paragraphId);
            if (parsed.length) {
                commands.push(...parsed);
            }
        };
        appendCommands(document.commands, undefined, undefined);
        document.chapters.forEach((chapter) => {
            appendCommands(chapter.commands, chapter.id, undefined);
            chapter.paragraphs.forEach((paragraph) => {
                appendCommands(paragraph.commands, chapter.id, paragraph.id);
            });
        });
        return commands;
    },
    async getDocumentSnapshots(_spaceId, documentIdOrPath) {
        const path = documentStore.resolvePath(documentIdOrPath);
        return documentStore.snapshots.get(path) ?? [];
    },
    async addDocumentSnapshot(_spaceId, documentIdOrPath, snapshotData) {
        const path = documentStore.resolvePath(documentIdOrPath);
        const document = await getDocumentModel(documentIdOrPath);
        const snapshots = documentStore.snapshots.get(path) ?? [];
        const snapshotId = generateId('snapshot');
        const snapshotRecord = {
            id: snapshotId,
            createdAt: new Date().toISOString(),
            documentId: document.docId,
            title: snapshotData?.title ?? `${document.title} snapshot`,
            data: clone(document)
        };
        snapshots.push(snapshotRecord);
        documentStore.snapshots.set(path, snapshots);
        return snapshotRecord;
    },
    async deleteDocumentSnapshot(_spaceId, documentIdOrPath, snapshotId) {
        const path = documentStore.resolvePath(documentIdOrPath);
        const snapshots = documentStore.snapshots.get(path) ?? [];
        const index = snapshots.findIndex((snapshot) => snapshot.id === snapshotId);
        if (index === -1) {
            throw new Error(`Snapshot ${snapshotId} not found.`);
        }
        snapshots.splice(index, 1);
        documentStore.snapshots.set(path, snapshots);
        return true;
    },
    async restoreDocumentSnapshot(_spaceId, documentIdOrPath, snapshotId) {
        const path = documentStore.resolvePath(documentIdOrPath);
        const snapshots = documentStore.snapshots.get(path) ?? [];
        const snapshot = snapshots.find((item) => item.id === snapshotId);
        if (!snapshot) {
            throw new Error(`Snapshot ${snapshotId} not found.`);
        }
        const restored = hydrateDocumentModel(serializeDocumentModel(snapshot.data), path);
        documentStore.setCached(path, restored);
        await persistDocument(documentIdOrPath);
        return restored;
    },
    async getDocumentTasks(_spaceId, documentIdOrPath) {
        const document = await getDocumentModel(documentIdOrPath);
        const tasks = [];
        document.chapters.forEach((chapter) => {
            chapter.tasks?.forEach((task) => tasks.push(task));
            chapter.paragraphs.forEach((paragraph) => {
                paragraph.tasks?.forEach((task) => tasks.push(task));
            });
        });
        return tasks;
    },
    async setVarValue(_spaceId, documentIdOrPath, varName, value) {
        const document = await getDocumentModel(documentIdOrPath);
        let variable = document.variables.find((item) => item.name === varName);
        if (!variable) {
            variable = { name: varName, value: null };
            document.variables.push(variable);
        }
        variable.value = value;
        await persistDocument(documentIdOrPath);
        return variable;
    },
    async updateParagraphCommands(_spaceId, chapterId, paragraphId, commands) {
        const paragraph = await this.getParagraph(null, paragraphId);
        const currentCommands = normalizeCommandString(paragraph.commands ?? '', '');
        paragraph.commands = normalizeCommandString(commands, currentCommands);
        paragraph.metadata.commands = paragraph.commands;
        for (const document of documentStore.documents.values()) {
            if (document.chapters.some((chapter) => chapter.id === chapterId)) {
                await persistDocument(document.path);
                break;
            }
        }
        return paragraph;
    },
    async exportDocument() {
        throw new Error('Exporting documents is not supported in the local document module.');
    },
    async importDocument() {
        throw new Error('Importing documents is not supported in the local document module.');
    },
    async convertDocument() {
        throw new Error('convertDocument is not supported in the local document module.');
    },
    async documentToVideo() {
        throw new Error('documentToVideo is not supported in the local document module.');
    },
    async undoOperation() {
        return false;
    },
    async redoOperation() {
        return false;
    },
    async selectDocumentItem(_spaceId, _documentId, itemId, data = {}) {
        return {
            itemId,
            data
        };
    },
    async deselectDocumentItem() {
        return true;
    },
    async updateDocId(_spaceId, documentIdOrPath, newDocId) {
        const document = await getDocumentModel(documentIdOrPath);
        document.docId = newDocId;
        document.metadata.id = newDocId;
        await persistDocument(documentIdOrPath);
        return document;
    },
    async getStylePreferences() {
        return clone(DEFAULT_STYLE_PREFERENCES);
    }
};

export default documentModule;
