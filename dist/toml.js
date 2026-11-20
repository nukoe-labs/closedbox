/** The error thrown when a line of the file does not follow the supported TOML subset. */
export class TomlError extends Error {
    /** Builds the error with the line number, so that the person can find the mistake. */
    constructor(lineNumber, reason) {
        super(`closedbox.toml, line ${lineNumber}: ${reason}`);
        this.name = "TomlError";
    }
}
const TABLE_HEADER = /^\[([A-Za-z0-9_."-]+)\]$/u;
const KEY_VALUE = /^([A-Za-z0-9_-]+|"[^"]+")\s*=\s*(.+)$/u;
const INTEGER = /^-?\d+$/u;
/** Removes a comment that starts with # outside of a quoted text. */
function removeComment(line) {
    let insideQuote = "";
    for (let index = 0; index < line.length; index += 1) {
        const character = line.charAt(index);
        if (insideQuote === "" && character === "#") {
            return line.slice(0, index);
        }
        insideQuote = updateQuoteState(insideQuote, character, line.charAt(index - 1));
    }
    return line;
}
/** Tells which quote is open after reading one character, given the quote open before it. */
function updateQuoteState(insideQuote, character, previousCharacter) {
    const isQuote = character === '"' || character === "'";
    if (!isQuote || previousCharacter === "\\") {
        return insideQuote;
    }
    if (insideQuote === "") {
        return character;
    }
    return insideQuote === character ? "" : insideQuote;
}
/** Reads a basic text between double quotes and resolves its escape sequences. */
function readBasicString(text, lineNumber) {
    try {
        return JSON.parse(text);
    }
    catch {
        throw new TomlError(lineNumber, `the text ${text} is not closed or has a wrong escape sequence.`);
    }
}
/** Splits the inside of a list on the commas that are outside of quotes. */
function splitListItems(inside) {
    const items = [];
    let current = "";
    let insideQuote = "";
    for (let index = 0; index < inside.length; index += 1) {
        const character = inside.charAt(index);
        if (insideQuote === "" && character === ",") {
            items.push(current);
            current = "";
            continue;
        }
        insideQuote = updateQuoteState(insideQuote, character, inside.charAt(index - 1));
        current += character;
    }
    items.push(current);
    return items.map(trimText).filter(isNotEmpty);
}
/** Removes the spaces around a text. */
function trimText(text) {
    return text.trim();
}
/** Tells whether a text is not empty. */
function isNotEmpty(text) {
    return text !== "";
}
/** Reads one value: a text, a boolean, a whole number or a list. */
export function readValue(text, lineNumber) {
    const value = text.trim();
    if (value.startsWith('"')) {
        return readBasicString(value, lineNumber);
    }
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
        return value.slice(1, -1);
    }
    if (value === "true" || value === "false") {
        return value === "true";
    }
    if (INTEGER.test(value)) {
        return Number(value);
    }
    if (value.startsWith("[") && value.endsWith("]")) {
        return readList(value, lineNumber);
    }
    throw new TomlError(lineNumber, `the value ${value} is not supported (use a quoted text, true, false, a number or a list).`);
}
/** Reads a list written on one line, such as ["a", "b"]. */
function readList(value, lineNumber) {
    const items = splitListItems(value.slice(1, -1));
    const values = [];
    for (const item of items) {
        values.push(readValue(item, lineNumber));
    }
    return values;
}
/** Returns the table at a dotted path, creating the missing tables on the way. */
function openTable(root, path, lineNumber) {
    let table = root;
    for (const rawPart of path.split(".")) {
        const part = rawPart.replaceAll('"', "");
        const existing = table[part] ?? {};
        if (typeof existing !== "object" || Array.isArray(existing)) {
            throw new TomlError(lineNumber, `"${part}" is already a value, it cannot become a table.`);
        }
        table[part] = existing;
        table = existing;
    }
    return table;
}
/** Joins the lines of a list written on several lines into one line. */
function joinListLines(lines) {
    const joined = [];
    let openList;
    for (const [index, rawLine] of lines.entries()) {
        const line = removeComment(rawLine).trim();
        if (openList !== undefined) {
            openList.text += ` ${line}`;
            openList = line.endsWith("]") ? undefined : openList;
            continue;
        }
        const entry = { text: line, lineNumber: index + 1 };
        joined.push(entry);
        openList = line.endsWith("[") || /=\s*\[[^\]]*$/u.test(line) ? entry : undefined;
    }
    return joined;
}
/** Reads one line of the file into the current table, and returns the table that the next lines fill. */
function readLine(root, current, text, lineNumber) {
    const header = TABLE_HEADER.exec(text);
    if (header !== null) {
        return openTable(root, header[1], lineNumber);
    }
    const keyValue = KEY_VALUE.exec(text);
    if (keyValue === null) {
        throw new TomlError(lineNumber, `"${text}" is neither a [table] nor a key = value line.`);
    }
    const key = keyValue[1].replaceAll('"', "");
    current[key] = readValue(keyValue[2], lineNumber);
    return current;
}
/**
 * Reads the subset of TOML used by closedbox.toml: tables, dotted tables, quoted texts, booleans,
 * whole numbers and lists, with comments.
 */
export function parseToml(text) {
    const root = {};
    let current = root;
    for (const { text: line, lineNumber } of joinListLines(text.split(/\r?\n/u))) {
        if (line === "") {
            continue;
        }
        current = readLine(root, current, line, lineNumber);
    }
    return root;
}
