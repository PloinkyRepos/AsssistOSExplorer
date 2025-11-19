import DocumentFsService from './documentFsService.js';
import {
    parseMarkdownDocument,
    serializeMarkdownDocument,
    stripAchilesComments
} from './markdownDocumentParser.js';
import { generateId } from './idUtils.js';

const toCommandString = (value) => {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.join('\n');
    }
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (_) {
            return '';
        }
    }
    return String(value);
};

const createDocumentMetadataDefaults = (overrides = {}) => {
    const now = new Date().toISOString();
    return {
        id: overrides.id ?? generateId('doc'),
        title: overrides.title ?? 'Untitled Document',
        infoText: overrides.infoText ?? '',
        commands: toCommandString(overrides.commands),
        comments: overrides.comments ?? { messages: [] },
        variables: overrides.variables ?? [],
        pluginState: overrides.pluginState ?? {},
        references: overrides.references ?? [],
        attachments: overrides.attachments ?? [],
        snapshots: overrides.snapshots ?? [],
        tasks: overrides.tasks ?? [],
        version: overrides.version ?? 1,
        updatedAt: overrides.updatedAt ?? now,
        ...overrides
    };
};

const createChapterMetadataDefaults = (overrides = {}) => ({
    id: overrides.id ?? generateId('chapter'),
    title: overrides.title ?? 'New Chapter',
    commands: toCommandString(overrides.commands),
    comments: overrides.comments ?? { messages: [] },
    pluginState: overrides.pluginState ?? {},
    references: overrides.references ?? [],
    attachments: overrides.attachments ?? [],
    snapshots: overrides.snapshots ?? [],
    tasks: overrides.tasks ?? [],
    variables: overrides.variables ?? [],
    ...overrides
});

const createParagraphMetadataDefaults = (overrides = {}) => ({
    id: overrides.id ?? generateId('paragraph'),
    type: overrides.type ?? 'markdown',
    commands: toCommandString(overrides.commands),
    comments: overrides.comments ?? { messages: [] },
    pluginState: overrides.pluginState ?? {},
    references: overrides.references ?? [],
    attachments: overrides.attachments ?? [],
    snapshots: overrides.snapshots ?? [],
    tasks: overrides.tasks ?? [],
    variables: overrides.variables ?? [],
    ...overrides
});

const ensureDocumentStructure = (document) => {
    const normalized = {
        ...document
    };

    normalized.metadata = createDocumentMetadataDefaults(document?.metadata ?? {});
    normalized.documentId = normalized.metadata.id;

    normalized.chapters = (document?.chapters ?? []).map((chapter, index) => {
        const metadata = createChapterMetadataDefaults({
            title: chapter?.heading?.text ?? chapter?.metadata?.title ?? `Chapter ${index + 1}`,
            ...(chapter?.metadata ?? {})
        });

        const paragraphs = (chapter?.paragraphs ?? []).map((paragraph, paragraphIndex) => {
            const paragraphMetadata = createParagraphMetadataDefaults({
                ...paragraph?.metadata,
                title: paragraph?.metadata?.title ?? `Paragraph ${paragraphIndex + 1}`
            });

            return {
                ...paragraph,
                id: paragraphMetadata.id,
                metadata: paragraphMetadata
            };
        });

        return {
            ...chapter,
            id: metadata.id,
            metadata,
            paragraphs
        };
    });

    return normalized;
};

const createEmptyParagraph = (overrides = {}) => ({
    metadata: createParagraphMetadataDefaults(overrides),
    leading: '',
    text: '',
    trailing: '\n',
    hasMetadata: true
});

const createEmptyChapter = (overrides = {}) => ({
    metadata: createChapterMetadataDefaults(overrides),
    heading: {
        level: overrides.heading?.level ?? 2,
        text: overrides.heading?.text ?? overrides.title ?? overrides.metadata?.title ?? 'New Chapter'
    },
    leading: '',
    paragraphs: [createEmptyParagraph()]
});

const createEmptyDocument = (overrides = {}) => ({
    metadata: createDocumentMetadataDefaults(overrides),
    preface: overrides.preface ?? '',
    chapters: [createEmptyChapter()]
});

export const createDocumentService = (options = {}) => {
    const fsService = new DocumentFsService(options.appServices);

    return {
        parse: parseMarkdownDocument,
        serialize: serializeMarkdownDocument,
        stripComments: stripAchilesComments,
        fs: fsService,
        createEmptyDocument,
        createEmptyChapter,
        createEmptyParagraph,
        ensureDocumentStructure,
        async load(path) {
            const { document, raw } = await fsService.readDocument(path);
            return {
                path,
                raw,
                document: ensureDocumentStructure(document)
            };
        },
        async save(path, document) {
            const normalized = ensureDocumentStructure(document);
            const content = serializeMarkdownDocument(normalized);
            await fsService.writeRaw(path, content);
            return content;
        },
        async loadRaw(path) {
            return fsService.readRaw(path);
        },
        async saveRaw(path, content) {
            await fsService.writeRaw(path, content);
        }
    };
};

export {
    DocumentFsService,
    parseMarkdownDocument,
    serializeMarkdownDocument,
    stripAchilesComments,
    generateId,
    createDocumentMetadataDefaults,
    createChapterMetadataDefaults,
    createParagraphMetadataDefaults,
    ensureDocumentStructure,
    createEmptyDocument,
    createEmptyChapter,
    createEmptyParagraph
};

export default createDocumentService;
