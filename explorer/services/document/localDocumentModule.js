import DocumentStore, {
    hydrateDocumentModel,
    hydrateChapterModel,
    hydrateParagraphModel,
    serializeDocumentModel,
    syncDocumentMetadata,
    Chapter
} from './local/documentStore.js';
import {
    createChapterMetadataDefaults,
    createEmptyChapter,
    createParagraphMetadataDefaults
} from './index.js';
import {
    decodeHtmlEntities,
    decodeValueDeep,
    decodeString,
    normalizeCommandString,
    normalizeCommandQuotes,
    parseCommandsForUI,
    decodeBase64,
    encodeBase64,
    clone,
    createCommentDefaults,
    normalizePosition
} from './local/utils.js';
import { createMediaAttachmentApi } from './local/mediaAttachmentUtils.js';
import { generateId } from './index.js';

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

const {
    setChapterMediaAttachment,
    setParagraphMediaAttachment,
    deleteChapterMediaAttachment,
    deleteParagraphMediaAttachment
} = createMediaAttachmentApi({ getDocumentModel, persistDocument });

const documentModule = {
    documentTypes: DOCUMENT_TYPES,
    Chapter,
    async loadDocument(documentIdOrPath) {
        const path = documentStore.resolvePath(documentIdOrPath);
        return documentStore.load(path);
    },
    async getDocuments() {
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
    async getDocument(documentIdOrPath, queryParams = {}) {
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
    async updateDocument(documentIdOrPath, title, docId, infoText, commands, comments) {
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
        document.commands = normalizeCommandQuotes(document.commands);
        document.comments = createCommentDefaults(comments ?? document.comments);
        document.metadata = {
            ...document.metadata,
            title: document.title,
            infoText: document.infoText,
            commands: normalizeCommandQuotes(document.commands),
            comments: document.comments
        };
        await persistDocument(documentIdOrPath);
        return document;
    },
    async createDocument(documentData) {
        const path = documentData?.path;
        if (!path) {
            throw new Error('createDocument requires a path in documentData.');
        }
        return documentStore.create(path, documentData);
    },
    async deleteDocument(documentIdOrPath) {
        const path = documentStore.resolvePath(documentIdOrPath);
        await documentStore.service.fs.writeRaw(path, '');
        documentStore.remove(path);
        return true;
    },
    async addChapter(documentIdOrPath, title, commands, comments, position) {
        const document = await getDocumentModel(documentIdOrPath);
        const chapterMetadata = createChapterMetadataDefaults({
            title: title ?? 'New Chapter',
            commands: normalizeCommandQuotes(normalizeCommandString(commands ?? '', '')),
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
    async deleteChapter(documentIdOrPath, chapterId) {
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
    async changeChapterOrder(documentIdOrPath, chapterId, position) {
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
    async getChapter(documentIdOrPathOrChapterId, maybeChapterId) {
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
    async updateChapter(documentIdOrPathOrChapterId, maybeChapterId, titleArg, commandsArg, commentsArg) {
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
        chapter.commands = normalizeCommandQuotes(commands !== undefined ? normalizeCommandString(commands, currentChapterCommands) : currentChapterCommands);
        chapter.metadata.commands = chapter.commands;
        if (comments) {
            chapter.comments = createCommentDefaults(comments);
            chapter.metadata.comments = chapter.comments;
        }
        await persistDocument(documentPath ?? documentReference.path ?? documentIdOrPathOrChapterId);
        return chapter;
    },
    async setChapterVarValue(documentIdOrPath, chapterId, varName, value, options = undefined) {
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
    async setChapterAudioAttachment(documentIdOrPath, chapterId, payload) {
        return setChapterMediaAttachment('audio', documentIdOrPath, chapterId, payload);
    },
    async setChapterImageAttachment(documentIdOrPath, chapterId, payload) {
        return setChapterMediaAttachment('image', documentIdOrPath, chapterId, payload);
    },
    async setChapterVideoAttachment(documentIdOrPath, chapterId, payload) {
        return setChapterMediaAttachment('video', documentIdOrPath, chapterId, payload);
    },
    async setParagraphAudioAttachment(documentIdOrPath, chapterId, paragraphId, payload) {
        return setParagraphMediaAttachment('audio', documentIdOrPath, chapterId, paragraphId, payload);
    },
    async setParagraphImageAttachment(documentIdOrPath, chapterId, paragraphId, payload) {
        return setParagraphMediaAttachment('image', documentIdOrPath, chapterId, paragraphId, payload);
    },
    async setParagraphVideoAttachment(documentIdOrPath, chapterId, paragraphId, payload) {
        return setParagraphMediaAttachment('video', documentIdOrPath, chapterId, paragraphId, payload);
    },
    async deleteChapterAudioAttachment(documentIdOrPath, chapterId, identifier) {
        return deleteChapterMediaAttachment('audio', documentIdOrPath, chapterId, identifier);
    },
    async deleteParagraphAudioAttachment(documentIdOrPath, chapterId, paragraphId, identifier) {
        return deleteParagraphMediaAttachment('audio', documentIdOrPath, chapterId, paragraphId, identifier);
    },
    async deleteParagraphImageAttachment(documentIdOrPath, chapterId, paragraphId, identifier) {
        return deleteParagraphMediaAttachment('image', documentIdOrPath, chapterId, paragraphId, identifier);
    },
    async deleteParagraphVideoAttachment(documentIdOrPath, chapterId, paragraphId, identifier) {
        return deleteParagraphMediaAttachment('video', documentIdOrPath, chapterId, paragraphId, identifier);
    },
    async deleteChapterImageAttachment(documentIdOrPath, chapterId, identifier) {
        return deleteChapterMediaAttachment('image', documentIdOrPath, chapterId, identifier);
    },
    async deleteChapterVideoAttachment(documentIdOrPath, chapterId, identifier) {
        return deleteChapterMediaAttachment('video', documentIdOrPath, chapterId, identifier);
    },
    async addParagraph(chapterId, paragraphText = '', metadata = null, paragraphType = 'markdown', position = null) {
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
    async deleteParagraph(chapterId, paragraphId) {
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
    async changeParagraphOrder(chapterId, paragraphId, position) {
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
    async getParagraph(paragraphId) {
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
    async updateParagraph(chapterId, paragraphId, text, commands, comments) {
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
        const currentParagraphCommands = normalizeCommandQuotes(normalizeCommandString(paragraphReference.commands ?? '', ''));
        paragraphReference.commands = currentParagraphCommands;
        if (commands !== undefined) {
            paragraphReference.commands = normalizeCommandQuotes(normalizeCommandString(commands, currentParagraphCommands));
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
    async getDocCommandsParsed(documentIdOrPath) {
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
    async getDocumentSnapshots(documentIdOrPath) {
        const path = documentStore.resolvePath(documentIdOrPath);
        return documentStore.snapshots.get(path) ?? [];
    },
    async addDocumentSnapshot(documentIdOrPath, snapshotData) {
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
    async deleteDocumentSnapshot(documentIdOrPath, snapshotId) {
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
    async restoreDocumentSnapshot(documentIdOrPath, snapshotId) {
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
    async getDocumentTasks(documentIdOrPath) {
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
    async setVarValue(documentIdOrPath, varName, value) {
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
    async updateChapterCommands(documentIdOrPath, chapterId, commands) {
        const document = await getDocumentModel(documentIdOrPath);
        const chapter = document.chapters.find((item) => item.id === chapterId);
        if (!chapter) {
            throw new Error(`Chapter ${chapterId} not found.`);
        }
        const currentCommands = normalizeCommandString(chapter.commands ?? '', '');
        chapter.commands = normalizeCommandQuotes(normalizeCommandString(commands, currentCommands));
        chapter.metadata.commands = chapter.commands;
        await persistDocument(documentIdOrPath);
        return chapter.commands;
    },
    async updateParagraphCommands(chapterId, paragraphId, commands) {
        const paragraph = await this.getParagraph(null, paragraphId);
        const currentCommands = normalizeCommandString(paragraph.commands ?? '', '');
        paragraph.commands = normalizeCommandQuotes(normalizeCommandString(commands, currentCommands));
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
    async selectDocumentItem(_documentId, itemId, data = {}) {
        return {
            itemId,
            data
        };
    },
    async deselectDocumentItem() {
        return true;
    },
    async updateDocId(documentIdOrPath, newDocId) {
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
