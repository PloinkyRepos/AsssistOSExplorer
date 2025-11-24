export const createFontMap = () => ({
    tiny: '12px',
    small: '14px',
    medium: '16px',
    large: '20px',
    'x-large': '24px'
});

export const createFontFamilyMap = () => ({
    arial: 'Arial, sans-serif',
    georgia: 'Georgia, serif',
    courier: '"Courier New", monospace',
    roboto: '"Roboto", sans-serif'
});

export const createTextIndentMap = () => ({
    none: '0',
    small: '12px',
    medium: '24px',
    large: '36px'
});

export const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const unescapeHtml = (value = '') => {
    if (typeof window === 'undefined') {
        return value;
    }
    const div = document.createElement('textarea');
    div.innerHTML = value;
    return div.value;
};

export const reverseQuerySelector = (element, selector, boundarySelector) => {
    let current = element;
    while (current) {
        if (current.matches && current.matches(selector)) {
            return current;
        }
        if (boundarySelector && current.matches && current.matches(boundarySelector)) {
            break;
        }
        current = current.parentElement;
    }
    return null;
};

export const normalizeSpaces = (value) => {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value !== 'string') {
        return value;
    }
    return value
        .replace(/\u00A0/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

export const customTrim = (value) => {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value !== 'string') {
        return value;
    }
    return value.replace(/^[\u00A0\s]+|[\u00A0\s]+$/g, '').trim();
};
