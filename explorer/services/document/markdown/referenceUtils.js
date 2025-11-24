import { normalizeLineEndings } from './metadataUtils.js';

export const TABLE_OF_CONTENTS_HEADING_RE = /^#{1,6}\s+Table of Contents$/i;
export const REFERENCES_HEADING_RE = /^#{1,6}\s+References$/i;

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

            skippingReferences = false;
        }

        if (!skippingReferences) {
            filtered.push(line);
        }
    }

    while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') {
        filtered.pop();
        removed = true;
    }

    return {
        lines: filtered,
        removed
    };
};

export const stripGeneratedReferencesFromText = (text, { trim = false } = {}) => {
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

export const formatReferenceCitation = (reference = {}) => {
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

export const stripSectionByHeading = (text, headingRegex) => {
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
