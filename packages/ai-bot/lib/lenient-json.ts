// Parse a tool call's complete arguments, repairing the two mistakes models
// make that leave no doubt about what was meant: raw control characters in
// strings, and extra closers after the value.

// Some models, streaming a long tool call in small pieces, write raw newlines
// and tabs inside JSON strings. That is not valid JSON, but what was meant is
// unambiguous: escape any control character that sits inside a string, and
// leave everything else as it is.
export function escapeControlCharactersInStrings(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      } else if (ch < ' ') {
        out +=
          ch === '\n'
            ? '\\n'
            : ch === '\r'
              ? '\\r'
              : ch === '\t'
                ? '\\t'
                : `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
        continue;
      }
    } else if (ch === '"') {
      inString = true;
    }
    out += ch;
  }
  return out;
}

// Some models, closing a long tool call, write one closing brace too many
// (`..."}}}` for an object that needs `"}}`). Everything before the extra
// closers is a complete value, so drop closers from the end, one at a time,
// until the text parses. Text that is cut off never parses this way, and
// any other trailing text is left as an error.
function parseWithoutExtraClosers(text: string): unknown {
  let end = text.trimEnd().length;
  while (end > 0 && (text[end - 1] === '}' || text[end - 1] === ']')) {
    end = text.slice(0, end - 1).trimEnd().length;
    try {
      return JSON.parse(text.slice(0, end));
    } catch {
      // Still not a complete value; try one closer fewer.
    }
  }
  throw new Error('no complete value before the trailing closers');
}

// JSON.parse, and on failure the same text with raw control characters in
// strings escaped and extra trailing closers dropped. Throws the original
// error when none of these parses.
export function parseLenientJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    let repaired = escapeControlCharactersInStrings(text);
    if (repaired !== text) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Fall through to the trailing-closer repair.
      }
    }
    try {
      return parseWithoutExtraClosers(repaired);
    } catch {
      throw error;
    }
  }
}
