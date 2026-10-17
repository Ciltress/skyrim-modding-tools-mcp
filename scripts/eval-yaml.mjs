/**
 * Reading the record files a run leaves, for eval-ollama.mjs's checks: a translated field's value
 * however it is written, and escapes a copy should have decoded. Line-based, no YAML library: the
 * files are Spriggit's, or a model's copies of them.
 */

/**
 * One YAML scalar's value, its first line and the lines that continue it: a block (`>-`, `|`), a
 * double- or single-quoted string, or a plain one. Whitespace is collapsed, so a text folded one way
 * and written back another reads the same — and a `\"` or `\n` left in by a copy does not.
 */
export function scalarValue(first, more) {
    let value;
    if (/^[>|]/.test(first)) {
        value = more.join('\n');
    } else if (first.startsWith('"')) {
        const joined = [first, ...more.map(l => l.trim())].join(' ');
        const end = joined.lastIndexOf('"');
        const quoted = joined.slice(0, end > 0 ? end + 1 : undefined);
        try {
            value = JSON.parse(quoted);
        } catch {
            value = quoted.slice(1, -1).replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
        }
    } else if (first.startsWith("'")) {
        const joined = [first, ...more.map(l => l.trim())].join(' ');
        value = joined.slice(1, joined.lastIndexOf("'")).replace(/''/g, "'");
    } else {
        value = [first, ...more.map(l => l.trim())].join(' ').replace(/\s+#.*$/, '');
    }
    return value.replace(/\s+/g, ' ').trim();
}

/**
 * A translated field's value (`Name`, `BookText`…) however it is written: nested with a `Value`
 * line, in flow style (`{ TargetLanguage: English, Value: … }`), or as a bare scalar.
 */
export function translatedValue(text, field) {
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex(line => line.startsWith(`${field}:`));
    if (at < 0) return undefined;
    const rest = lines[at].slice(field.length + 1).trim();
    const indent = line => /^\s*/.exec(line)[0].length;
    /** The lines after `from` that are blank or indented deeper than `depth`. */
    const continuing = (from, depth) => {
        const more = [];
        for (let i = from + 1; i < lines.length && (!lines[i].trim() || indent(lines[i]) > depth); i++) more.push(lines[i]);
        while (more.length && !more.at(-1).trim()) more.pop();
        return more;
    };
    if (!rest) {
        for (let i = at + 1; i < lines.length && (!lines[i].trim() || indent(lines[i]) > 0); i++) {
            const value = /^(\s+)Value:[ \t]*(.*)$/.exec(lines[i]);
            if (value) return scalarValue(value[2].trim(), continuing(i, value[1].length));
        }
        return undefined;
    }
    if (rest.startsWith('{')) {
        const value = /\bValue:\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,}]+)/.exec(rest)?.[1];
        return value === undefined ? undefined : scalarValue(value.trim(), []);
    }
    return scalarValue(rest, continuing(at, 0));
}

/**
 * The first line of a record file that holds an escape a copy should have decoded: a doubled backslash
 * or a `\"` outside a double-quoted string, or inside one once it is decoded. Copying a JSON string as
 * it reads leaves exactly these — `File: Weapons\\Iron\\Sword.nif` (rounds 12–13).
 */
export function leftEscape(text) {
    const escape = /\\\\|\\"/;
    for (const line of text.split(/\r?\n/)) {
        // Each double-quoted string on the line — a value, or one inside a flow mapping — is judged once
        // decoded; what is left of the line is judged as it stands.
        let outside = line;
        for (const quoted of line.match(/"(?:[^"\\]|\\.)*"/g) ?? []) {
            let decoded;
            try { decoded = JSON.parse(quoted); } catch { decoded = ''; /* a YAML escape JSON does not know */ }
            if (escape.test(decoded)) return line;
            outside = outside.replace(quoted, '""');
        }
        if (escape.test(outside)) return line;
    }
    return undefined;
}
