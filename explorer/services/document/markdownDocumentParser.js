const COMMENT_KEY_PREFIX = 'achiles-ide-';
const COMMENT_KEYS = {
    DOCUMENT: `${COMMENT_KEY_PREFIX}document`,
    CHAPTER: `${COMMENT_KEY_PREFIX}chapter`,
    PARAGRAPH: `${COMMENT_KEY_PREFIX}paragraph`,
    TOC: `${COMMENT_KEY_PREFIX}toc`,
    REFERENCES: `${COMMENT_KEY_PREFIX}references`
};
const ALLOWED_METADATA_FIELDS = {
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
const DEFAULT_HEADING_LEVEL = 2;
const TABLE_OF_CONTENTS_HEADING_RE = /^#{1,6}\s+Table of Contents$/i;
const REFERENCES_HEADING_RE = /^#{1,6}\s+References$/i;

const normalizeLineEndings = (value = '') => value.replace(/\r\n/g, '\n');

const decodeHtmlEntities = (value = '') => {
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

const decodeMetadataValue = (value) => {
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

const extractSpacing = (segment) => {
    const leadingMatch = segment.match(/^\s*/);
    const trailingMatch = segment.match(/\s*$/);
    const leading = leadingMatch ? leadingMatch[0] : '';
    const trailing = trailingMatch ? trailingMatch[0] : '';
    const core = segment.slice(leading.length, segment.length - trailing.length);

    return {
        leading,
        trailing,
        text: core
    };
};

const getMetadataComments = (text) => {
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

const stripMetadataCommentBlocks = (text) => {
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

const REFERENCES_MARKER_COMMENT_RE = /<!--\s*<achiles-ide-references>\s*-->/i;
const REFERENCES_ANCHOR_LINE_RE = /^<a\s+id="references-section"><\/a>\s*$/i;
const MARKDOWN_HEADING_RE = /^#{1,6}\s+/;
const NUMBERED_LIST_LINE_RE = /^\d+\.\s+/;
const BULLETED_LIST_LINE_RE = /^[*-]\s+/;
const FOOTNOTE_DEFINITION_RE = /^\[[^\]]+]:/;

const stripGeneratedReferencesFromLines = (lines = []) => {
    const filtered = [];
    let skippingReferences = false;
    let removed = false;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
            if (!skippingReferences) {
                filtered.push(line);
            } else {
                removed = true;
            }
            continue;
        }

        if (REFERENCES_MARKER_COMMENT_RE.test(trimmed)) {
            removed = true;
            continue;
        }

        if (REFERENCES_ANCHOR_LINE_RE.test(trimmed)) {
            removed = true;
            continue;
        }

        if (REFERENCES_HEADING_RE.test(trimmed)) {
            skippingReferences = true;
            removed = true;
            continue;
        }

        if (skippingReferences) {
            if (REFERENCES_HEADING_RE.test(trimmed)) {
                removed = true;
                continue;
            }
            if (MARKDOWN_HEADING_RE.test(trimmed)) {
                skippingReferences = false;
                filtered.push(line);
                continue;
            }
            if (
                NUMBERED_LIST_LINE_RE.test(trimmed)
                || BULLETED_LIST_LINE_RE.test(trimmed)
                || FOOTNOTE_DEFINITION_RE.test(trimmed)
                || trimmed.startsWith('<a ')
                || trimmed.startsWith('<!--')
            ) {
                removed = true;
                continue;
            }

            // Encountered non-reference content; stop skipping and keep the line.
            skippingReferences = false;
        }

        if (!skippingReferences) {
            filtered.push(line);
        }
    }

    // Trim trailing blank lines introduced after stripping references.
    while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') {
        filtered.pop();
        removed = true;
    }

    return {
        lines: filtered,
        removed
    };
};

const stripGeneratedReferencesFromText = (text, { trim = false } = {}) => {
    if (!text) {
        return {
            text: trim ? '' : text,
            removed: false
        };
    }
    const normalized = normalizeLineEndings(text);
    const lines = normalized.split('\n');
    const { lines: filteredLines, removed } = stripGeneratedReferencesFromLines(lines);
    let cleaned = filteredLines.join('\n');
    if (removed) {
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    }
    if (trim) {
        cleaned = cleaned.trim();
    }
    return {
        text: cleaned,
        removed
    };
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

const ensureMetadataId = (metadata, fallbackId) => {
    const result = { ...(metadata || {}) };
    if (!result.id && fallbackId) {
        result.id = fallbackId;
    }
    return result;
};

const filterMetadataFields = (key, metadata) => {
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

const createMetadataComment = (key, metadata) => {
    const filtered = filterMetadataFields(key, metadata);
    const pruned = pruneMetadata(filtered);
    if (!pruned) {
        return '';
    }
    const payload = {};
    payload[key] = pruned;
    return `<!-- ${JSON.stringify(payload)} -->\n`;
};

const parseParagraphBlocks = (content) => {
    const comments = getMetadataComments(content).filter((comment) => comment.key === COMMENT_KEYS.PARAGRAPH);
    if (comments.length === 0) {
        const spacing = extractSpacing(content);
        if (spacing.text.trim().length === 0) {
            return [];
        }
        return [{
            metadata: {},
            leading: decodeHtmlEntities(spacing.leading),
            text: decodeHtmlEntities(spacing.text),
            trailing: decodeHtmlEntities(spacing.trailing),
            hasMetadata: false,
            id: null
        }];
    }

    const paragraphs = [];
    comments.forEach((comment, index) => {
        const next = comments[index + 1];
        const segment = content.slice(comment.end, next ? next.start : content.length);
        const spacing = extractSpacing(segment);
        const rawMetadata = filterMetadataFields(COMMENT_KEYS.PARAGRAPH, { ...(comment.value ?? {}) });
        const paragraphId = rawMetadata.id ?? null;
        paragraphs.push({
            metadata: rawMetadata,
            leading: decodeHtmlEntities(spacing.leading),
            text: decodeHtmlEntities(spacing.text),
            trailing: decodeHtmlEntities(spacing.trailing),
            hasMetadata: true,
            id: paragraphId
        });
    });

    return paragraphs;
};

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

const stripLeadingBlankLines = (value = '') => {
    if (!value) {
        return '';
    }
    return value.replace(/^(?:[^\S\n]*\n)+/g, '');
};

const ensureParagraphTrailingBlankLine = (value = '') => {
    const normalized = value ?? '';
    if (!normalized) {
        return '\n\n';
    }
    const trimmedForCheck = normalized.replace(/[^\S\n]+$/g, '');
    if (/\n{2,}$/.test(trimmedForCheck)) {
        return normalized;
    }
    if (/\n$/.test(trimmedForCheck)) {
        return `${normalized}\n`;
    }
    return `${normalized}\n\n`;
};

const composeParagraph = (paragraph) => {
    const leading = stripLeadingBlankLines(decodeHtmlEntities(paragraph.leading ?? ''));
    const text = decodeHtmlEntities(paragraph.text ?? '');
    const trailing = ensureParagraphTrailingBlankLine(decodeHtmlEntities(paragraph.trailing ?? ''));
    const content = `${leading}${text}${trailing}`;
    return content.endsWith('\n') ? content : `${content}\n`;
};

const formatReferenceCitation = (reference = {}) => {
    const {
        type,
        authors,
        year,
        title,
        journal,
        volume,
        pages,
        publisher,
        location,
        website,
        access_date,
        url
    } = reference;

    if (!authors || !year || !title) {
        return title || '';
    }

    let citation = `${authors} (${year}). `;

    switch (type) {
        case 'journal':
            citation += `${title}. `;
            if (journal) {
                citation += `*${journal}*`;
                if (volume) citation += `, ${volume}`;
                if (pages) citation += `, ${pages}`;
                citation += '. ';
            }
            break;
        case 'book':
            citation += `*${title}*. `;
            if (publisher) {
                if (location) citation += `${location}: `;
                citation += `${publisher}. `;
            }
            break;
        case 'website':
            citation += `${title}. `;
            if (website) citation += `*${website}*. `;
            if (access_date) {
                const date = new Date(access_date);
                citation += `Retrieved ${date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}. `;
            }
            break;
        case 'report':
            citation += `*${title}*`;
            if (publisher) citation += ` (Report). ${publisher}`;
            citation += '. ';
            break;
        default:
            citation += `*${title}*. `;
    }

    if (url) {
        if (url.startsWith('doi:')) {
            citation += `https://doi.org/${url.substring(4)}`;
        } else {
            citation += url;
        }
    }

    return citation.trim();
};

const stripSectionByHeading = (text, headingRegex) => {
    if (!text) {
        return { remaining: '', section: [] };
    }
    const lines = text.split('\n');
    let startIndex = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (headingRegex.test(lines[i].trim())) {
            startIndex = i;
            break;
        }
    }
    if (startIndex === -1) {
        return { remaining: text, section: [] };
    }

    let endIndex = lines.length;
    for (let j = startIndex + 1; j < lines.length; j += 1) {
        if (/^#{1,6}\s+/.test(lines[j].trim())) {
            endIndex = j;
            break;
        }
    }

    const sectionLines = lines.slice(startIndex, endIndex);
    const remainingLines = [...lines.slice(0, startIndex), ...lines.slice(endIndex)];
    return {
        remaining: remainingLines.join('\n').trim(),
        section: sectionLines
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
