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

const normalizeCommandQuotes = (commandStr = '') => {
    const lines = String(commandStr || '').split('\n');
    const parsed = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('@')) return line;
        // Skip ffmpegImageToVideo to preserve quoted JSON arrays (they contain escaped quotes/backslashes).
        if (/ffmpegImageToVideo/.test(trimmed)) return line;
        if (!/attach/.test(trimmed)) return line;
        const tokens = trimmed.match(/"([^"]*)"|\S+/g) || [];
        const normalized = tokens.map((tok) => {
            const quoted = tok.startsWith('"') && tok.endsWith('"');
            if (quoted) {
                const inner = tok.slice(1, -1);
                if (!/\s/.test(inner)) {
                    return inner;
                }
            }
            return tok;
        });
        return normalized.join(' ');
    });
    return parsed.join('\n');
};

const scriptCommandNames = new Set(['macro', 'jsdef', 'form', 'prompt']);

const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const extractMediaIdFromPath = (path = '') => {
    if (typeof path !== 'string') {
        return '';
    }
    const trimmed = path.trim();
    const match = trimmed.match(/\/([^/]+?)(?:\.[^.\/]+)?$/);
    return match ? match[1] : '';
};

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
    } catch (_) {
        return value;
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

const createCommentDefaults = (comments = {}) => ({
    messages: [],
    status: null,
    plugin: '',
    pluginLastOpened: '',
    ...comments
});

const normalizePosition = (array, position) => {
    if (!Array.isArray(array) || array.length === 0) {
        return 0;
    }
    if (typeof position !== 'number' || Number.isNaN(position)) {
        return array.length;
    }
    return Math.min(Math.max(position, 0), array.length);
};

export {
    decodeHtmlEntities,
    decodeValueDeep,
    decodeString,
    normalizeCommandString,
    toFiniteNumber,
    extractMediaIdFromPath,
    parseCommandsForUI,
    encodeSOPCode,
    decodeSOPCode,
    decodeBase64,
    encodeBase64,
    clone,
    createCommentDefaults,
    normalizePosition,
    normalizeCommandQuotes
};
