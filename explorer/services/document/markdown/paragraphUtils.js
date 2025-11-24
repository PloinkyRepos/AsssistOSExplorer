import {
    COMMENT_KEYS,
    decodeHtmlEntities,
    filterMetadataFields,
    getMetadataComments
} from './metadataUtils.js';

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

export const parseParagraphBlocks = (content) => {
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

export const stripLeadingBlankLines = (value = '') => {
    if (!value) {
        return '';
    }
    return value.replace(/^(?:[^\S\n]*\n)+/g, '');
};

export const ensureParagraphTrailingBlankLine = (value = '') => {
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

export const composeParagraph = (paragraph) => {
    const leading = stripLeadingBlankLines(decodeHtmlEntities(paragraph.leading ?? ''));
    const text = decodeHtmlEntities(paragraph.text ?? '');
    const trailing = ensureParagraphTrailingBlankLine(decodeHtmlEntities(paragraph.trailing ?? ''));
    const content = `${leading}${text}${trailing}`;
    return content.endsWith('\n') ? content : `${content}\n`;
};
