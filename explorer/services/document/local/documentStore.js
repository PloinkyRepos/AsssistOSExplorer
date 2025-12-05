import createDocumentService, {
    createChapterMetadataDefaults,
    createDocumentMetadataDefaults,
    createEmptyChapter,
    createEmptyDocument,
    createEmptyParagraph,
    createParagraphMetadataDefaults,
    ensureDocumentStructure,
    generateId
} from '../index.js';
import {
    decodeHtmlEntities,
    decodeValueDeep,
    decodeString,
    normalizeCommandString,
    normalizeCommandQuotes,
    decodeBase64,
    encodeBase64,
    clone,
    createCommentDefaults
} from './utils.js';
import {
    collectMediaAttachments,
    updateChapterMediaState,
    updateParagraphMediaState
} from './mediaAttachmentUtils.js';

class Chapter {
    constructor(payload = {}) {
        Object.assign(this, payload);
    }
}

const deriveChapterBackgroundSound = (chapter = {}) => {
    const list = collectMediaAttachments(chapter.commands ?? '', 'audio');
    if (list.length > 0) {
        return list[0];
    }
    return null;
};

const deriveChapterBackgroundVideo = (chapter = {}) => {
    const list = collectMediaAttachments(chapter.commands ?? '', 'video');
    if (list.length > 0) {
        return list[0];
    }
    return null;
};

const hydrateParagraphModel = (paragraph, chapterId) => {
    const metadata = createParagraphMetadataDefaults(paragraph.metadata ?? {});
    const comments = createCommentDefaults(metadata.comments);
    const commands = normalizeCommandQuotes(normalizeCommandString(paragraph.commands ?? metadata.commands ?? ''));
    paragraph.commands = commands;
    metadata.commands = commands;

    const paragraphInstance = {
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
    updateParagraphMediaState(paragraphInstance);
    return paragraphInstance;
};

const hydrateChapterModel = (chapter, index) => {
    const metadata = createChapterMetadataDefaults(chapter.metadata ?? {});
    const comments = createCommentDefaults(metadata.comments);
    const headingLevel = chapter.heading?.level ?? 2;
    const headingText = chapter.heading?.text ?? metadata.title ?? `Chapter ${index + 1}`;
    const commands = normalizeCommandQuotes(normalizeCommandString(chapter.commands ?? metadata.commands ?? ''));
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
    const backgroundVideo = deriveChapterBackgroundVideo(chapter, metadata);

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
    if (backgroundVideo) {
        chapterInstance.backgroundVideo = backgroundVideo;
    }
    updateChapterMediaState(chapterInstance);
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
    const commands = normalizeCommandQuotes(normalizeCommandString(document.commands ?? metadata.commands ?? ''));
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
        type: 'document',
        preface: document.preface ?? '',
        chapters
    };
};

const syncParagraphMetadata = (paragraph = {}) => {
    if (!paragraph) {
        return;
    }
    paragraph.comments = createCommentDefaults(paragraph.comments);
    const commands = normalizeCommandQuotes(normalizeCommandString(paragraph.commands ?? paragraph.metadata?.commands ?? ''));
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
    const commands = normalizeCommandQuotes(normalizeCommandString(chapter.commands ?? chapter.metadata?.commands ?? ''));
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
    const commands = normalizeCommandQuotes(normalizeCommandString(document.commands ?? document.metadata?.commands ?? ''));
    document.commands = commands;
    const overrides = {
        ...(document.metadata ?? {}),
        id: document.docId ?? document.metadata?.id ?? generateId('doc'),
        title: document.title,
        infoText: document.infoText,
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
        this.documents = new Map();
        this.snapshots = new Map();
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

export {
    DocumentStore as default,
    hydrateDocumentModel,
    hydrateChapterModel,
    hydrateParagraphModel,
    serializeDocumentModel,
    syncDocumentMetadata,
    createCommentDefaults,
    Chapter
};
