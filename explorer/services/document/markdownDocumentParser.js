import {
    COMMENT_KEY_PREFIX,
    COMMENT_KEYS,
    normalizeLineEndings,
    decodeHtmlEntities,
    getMetadataComments,
    stripMetadataCommentBlocks,
    ensureMetadataId,
    filterMetadataFields,
    createMetadataComment
} from './markdown/metadataUtils.js';
import { parseParagraphBlocks, composeParagraph } from './markdown/paragraphUtils.js';
import {
    TABLE_OF_CONTENTS_HEADING_RE,
    REFERENCES_HEADING_RE,
    stripGeneratedReferencesFromText,
    stripSectionByHeading,
    formatReferenceCitation
} from './markdown/referenceUtils.js';

const DEFAULT_HEADING_LEVEL = 2;

const parseChapterBlock = (chapterComment, block, { hasStructuredReferences = false } = {}) => {
    const metadata = filterMetadataFields(COMMENT_KEYS.CHAPTER, { ...(chapterComment.value ?? {}) });
    const chapterId = metadata.id ?? null;
    const chapter = {
        id: chapterId,
        metadata,
        heading: {
            level: DEFAULT_HEADING_LEVEL,
            text: '',
            raw: ''
        },
        leading: '',
        paragraphs: []
    };

    if (!block || block.trim().length === 0) {
        return chapter;
    }

    const normalized = normalizeLineEndings(block);
    const rawLines = normalized.split('\n');
    const lines = [];
    let anchorId = metadata.anchorId ?? null;

    rawLines.forEach((line) => {
        const trimmed = line.trim();
        const anchorMatch = trimmed.match(/^<a\s+id="([^"']+)"><\/a>$/i);
        if (anchorMatch) {
            anchorId = anchorMatch[1];
            return;
        }
        lines.push(line);
    });

    if (anchorId) {
        metadata.anchorId = anchorId;
    }

    let headingLineIndex = -1;
    for (let idx = 0; idx < lines.length; idx += 1) {
        const trimmed = lines[idx].trim();
        if (!trimmed) {
            continue;
        }
        if (/^#{1,6}\s+/.test(trimmed)) {
            headingLineIndex = idx;
            const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
            if (headingMatch) {
                chapter.heading.level = headingMatch[1].length;
                let headingContent = headingMatch[2].trim();
                const anchorMatchInHeading = headingContent.match(/\{#([^}]+)\}\s*$/);
                if (anchorMatchInHeading) {
                    metadata.anchorId = metadata.anchorId ?? anchorMatchInHeading[1];
                    headingContent = headingContent.replace(/\s*\{#[^}]+\}\s*$/, '').trim();
                }
                chapter.heading.text = decodeHtmlEntities(headingContent);
                chapter.heading.raw = lines[idx];
                if (!chapter.metadata.title) {
                    chapter.metadata.title = chapter.heading.text;
                }
            }
            break;
        }
    }

    if (headingLineIndex === -1) {
        chapter.paragraphs = parseParagraphBlocks(lines.join('\n'));
        if (!chapter.heading.text) {
            chapter.heading.text = 'Chapter';
        }
        if (chapter.heading.text && !chapter.metadata.title) {
            chapter.metadata.title = chapter.heading.text;
        }
        return chapter;
    }

    const leadingLines = lines.slice(0, headingLineIndex);
    chapter.leading = decodeHtmlEntities(leadingLines.join('\n'));

    const remainderLines = lines.slice(headingLineIndex + 1);
    let remainder = remainderLines.join('\n');
    if (hasStructuredReferences) {
        const { text: cleanedRemainder } = stripGeneratedReferencesFromText(remainder);
        remainder = cleanedRemainder;
    }
    chapter.paragraphs = parseParagraphBlocks(remainder);

    if (!chapter.heading.text) {
        chapter.heading.text = 'Chapter';
    }
    if (chapter.heading.text && !chapter.metadata.title) {
        chapter.metadata.title = chapter.heading.text;
    } else if (chapter.metadata?.title) {
        chapter.metadata.title = chapter.metadata.title.replace(/\s*\{#[^}]+\}\s*$/, '').trim();
    }

    return chapter;
};

const parseMarkdownDocument = (markdown) => {
    const text = normalizeLineEndings(markdown ?? '');
    const metadataComments = getMetadataComments(text);

    const documentComment = metadataComments.find((comment) => comment.key === COMMENT_KEYS.DOCUMENT);
    const tocComment = metadataComments.find((comment) => comment.key === COMMENT_KEYS.TOC);
    const referencesComment = metadataComments.find((comment) => comment.key === COMMENT_KEYS.REFERENCES);
    const chapterComments = metadataComments.filter((comment) => comment.key === COMMENT_KEYS.CHAPTER);

    const documentMetadata = documentComment ? filterMetadataFields(COMMENT_KEYS.DOCUMENT, { ...(documentComment.value ?? {}) }) : {};
    const documentId = documentMetadata.id ?? null;

    if (tocComment) {
        documentMetadata.comments = documentMetadata.comments ?? {};
        documentMetadata.comments.toc = filterMetadataFields(COMMENT_KEYS.TOC, tocComment.value ?? {});
    }
    if (referencesComment) {
        documentMetadata.comments = documentMetadata.comments ?? {};
        documentMetadata.comments.tor = filterMetadataFields(COMMENT_KEYS.REFERENCES, referencesComment.value ?? {});
    }

    const prefaceStart = documentComment ? documentComment.end : 0;
    const firstChapterStart = chapterComments[0]?.start ?? text.length;
    const prefaceSegment = text.slice(prefaceStart, firstChapterStart);
    let preface = decodeHtmlEntities(stripMetadataCommentBlocks(prefaceSegment));

    if (documentMetadata.comments?.toc) {
        const { remaining } = stripSectionByHeading(preface, TABLE_OF_CONTENTS_HEADING_RE);
        preface = remaining;
    }
    if (documentMetadata.comments?.tor) {
        const { text: sanitizedPreface } = stripGeneratedReferencesFromText(preface);
        preface = sanitizedPreface;
    }
    preface = preface.trim();

    const hasStructuredReferences = Boolean(
        documentMetadata.comments?.tor
        && Array.isArray(documentMetadata.comments.tor.references)
        && documentMetadata.comments.tor.references.length > 0
    );

    const chapters = chapterComments.map((chapterComment, index) => {
        const nextChapterStart = chapterComments[index + 1]?.start ?? text.length;
        const chapterBlock = text.slice(chapterComment.end, nextChapterStart);
        return parseChapterBlock(chapterComment, chapterBlock, { hasStructuredReferences });
    });

    return {
        metadata: documentMetadata,
        preface,
        chapters,
        raw: text,
        documentId
    };
};


const serializeMarkdownDocument = (document) => {
    if (!document) {
        return '';
    }

    const parts = [];

    const documentMetadata = ensureMetadataId(
        filterMetadataFields(COMMENT_KEYS.DOCUMENT, document.metadata ?? {}),
        document.metadata?.id
    );
    const documentComment = createMetadataComment(COMMENT_KEYS.DOCUMENT, documentMetadata);
    if (documentComment) {
        parts.push(documentComment);
    }

    if (document.preface) {
        const decodedPreface = decodeHtmlEntities(document.preface).trim();
        if (decodedPreface) {
            parts.push(`${decodedPreface}\n\n`);
        }
    }

    const documentComments = document.metadata?.comments ?? document.comments ?? {};

    if (documentComments.toc) {
        const tocMetadata = filterMetadataFields(COMMENT_KEYS.TOC, documentComments.toc);
        const tocComment = createMetadataComment(COMMENT_KEYS.TOC, tocMetadata);
        if (tocComment) {
            parts.push(tocComment);
        }
        parts.push('## Table of Contents\n');
        const tocLines = (document.chapters ?? []).map((chapter, index) => {
            const headingTextRaw = decodeHtmlEntities(chapter.heading?.text ?? chapter.metadata?.title ?? `Chapter ${index + 1}`);
            const headingText = headingTextRaw.replace(/\s*\{#[^}]+\}\s*$/, '');
            const anchorId = chapter.id ? `chapter-${chapter.id}` : `chapter-${index + 1}`;
            return `- [Chapter ${index + 1}: ${headingText}](#${anchorId})`;
        });
        if (tocLines.length > 0) {
            parts.push(`${tocLines.join('\n')}\n\n`);
        } else {
            parts.push('- No chapters available\n\n');
        }
    }

    let referencesParts = [];
    if (documentComments.tor && Array.isArray(documentComments.tor.references) && documentComments.tor.references.length > 0) {
        const referencesMetadata = filterMetadataFields(COMMENT_KEYS.REFERENCES, documentComments.tor);
        const referencesComment = createMetadataComment(COMMENT_KEYS.REFERENCES, referencesMetadata);
        if (referencesComment) {
            referencesParts.push(referencesComment);
        }
        referencesParts.push('<!-- <achiles-ide-references> -->\n');
        referencesParts.push('<a id="references-section"></a>\n');
        referencesParts.push('## References\n');
        documentComments.tor.references.forEach((reference, index) => {
            referencesParts.push(`${index + 1}. ${formatReferenceCitation(reference)}\n`);
        });
        referencesParts.push('\n');
    }

    (document.chapters ?? []).forEach((chapter, index) => {
        if (index > 0) {
            parts.push('\n');
        }

        const chapterMetadata = ensureMetadataId(
            filterMetadataFields(COMMENT_KEYS.CHAPTER, chapter.metadata ?? {}),
            chapter.id
        );
        const anchorId = chapterMetadata.anchorId
            || (chapter.id ? `chapter-${chapter.id}` : `chapter-${index + 1}`);
        chapterMetadata.anchorId = anchorId;
        const chapterComment = createMetadataComment(COMMENT_KEYS.CHAPTER, chapterMetadata);
        if (chapterComment) {
            parts.push(chapterComment);
        }

        const headingLevel = Math.max(1, Math.min(6, chapter.heading?.level ?? DEFAULT_HEADING_LEVEL));
        const headingTextRaw = decodeHtmlEntities(chapter.heading?.text ?? chapter.metadata?.title ?? `Chapter ${index + 1}`);
        const headingText = headingTextRaw.replace(/\s*\{#[^}]+\}\s*$/, '');
        if (anchorId) {
            parts.push(`<a id="${anchorId}"></a>\n`);
        }
        parts.push(`${'#'.repeat(headingLevel)} ${headingText}\n`);

        const leadingTrimmed = decodeHtmlEntities(chapter.leading ?? '').trim();
        if (leadingTrimmed) {
            parts.push(`${leadingTrimmed}\n`);
        }

        (chapter.paragraphs ?? []).forEach((paragraph) => {
            const paragraphMetadata = ensureMetadataId(
                filterMetadataFields(COMMENT_KEYS.PARAGRAPH, paragraph.metadata ?? {}),
                paragraph.id
            );
            const paragraphComment = createMetadataComment(COMMENT_KEYS.PARAGRAPH, paragraphMetadata);
            if (paragraphComment) {
                parts.push(paragraphComment);
            }
            parts.push(composeParagraph(paragraph));
        });
    });

    if (referencesParts.length > 0) {
        if (parts.length > 0) {
            const lastIndex = parts.length - 1;
            if (!/\n$/.test(parts[lastIndex])) {
                parts[lastIndex] = `${parts[lastIndex]}\n`;
            }
            parts.push('\n');
        }
        parts.push(...referencesParts);
    }

    return parts.join('').replace(/\n{4,}/g, '\n\n\n');
};

const stripAchilesComments = (text) => {
    if (!text) {
        return '';
    }

    const normalized = normalizeLineEndings(text);
    const lines = normalized.split('\n');
    const sanitized = [];
    let pendingAnchorId = null;

    const parseMetadataComment = (raw) => {
        if (!raw) {
            return null;
        }
        const payload = raw.replace(/^<!--\s*/, '').replace(/\s*-->$/, '').trim();
        if (!payload) {
            return null;
        }
        try {
            const parsed = JSON.parse(payload);
            const keys = Object.keys(parsed).filter(
                (key) => typeof key === 'string' && key.startsWith(COMMENT_KEY_PREFIX)
            );
            if (keys.length === 1) {
                return {
                    key: keys[0],
                    metadata: parsed[keys[0]] ?? {}
                };
            }
        } catch (_) {
            return null;
        }
        return null;
    };

    for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const trimmed = line.trim();

        if (trimmed.startsWith('<!--')) {
            let commentText = trimmed;
            while (!commentText.includes('-->') && idx < lines.length - 1) {
                idx += 1;
                commentText += `\n${lines[idx].trim()}`;
            }
            const parsedComment = parseMetadataComment(commentText);
            if (parsedComment?.key === COMMENT_KEYS.CHAPTER) {
                const anchorFromMetadata = parsedComment.metadata?.anchorId;
                if (typeof anchorFromMetadata === 'string' && anchorFromMetadata.trim().length > 0) {
                    pendingAnchorId = anchorFromMetadata.trim();
                }
            }
            continue;
        }

        const anchorTagMatch = trimmed.match(/^<a\s+id="([^"']+)"><\/a>$/i);
        if (anchorTagMatch) {
            pendingAnchorId = anchorTagMatch[1].trim();
            continue;
        }

        const headingMatch = line.match(/^(\s*)(#{1,6})(\s+)(.*)$/);
        if (headingMatch) {
            const leading = headingMatch[1] ?? '';
            const hashes = headingMatch[2];
            const spacer = headingMatch[3];
            let headingContent = headingMatch[4];

            const inlineAnchorMatch = headingContent.match(/\s*\{#([^}]+)\}\s*$/);
            if (inlineAnchorMatch) {
                const inlineAnchorId = inlineAnchorMatch[1].trim();
                if (!pendingAnchorId && inlineAnchorId) {
                    pendingAnchorId = inlineAnchorId;
                }
                headingContent = headingContent.replace(/\s*\{#[^}]+\}\s*$/, '').trimEnd();
            }

            const finalAnchorId = pendingAnchorId;
            pendingAnchorId = null;
            const cleanedHeading = headingContent.trimEnd();
            const rebuilt = finalAnchorId
                ? `${leading}${hashes}${spacer}${cleanedHeading} {#${finalAnchorId}}`
                : `${leading}${hashes}${spacer}${cleanedHeading}`;
            sanitized.push(rebuilt);
            continue;
        }

        sanitized.push(line);
    }

    return decodeHtmlEntities(sanitized.join('\n')).trim();
};

export default {
    parseMarkdownDocument,
    serializeMarkdownDocument,
    stripAchilesComments
};

export {
    parseMarkdownDocument,
    serializeMarkdownDocument,
    stripAchilesComments
};
