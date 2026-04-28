// Escape CommonMark + GFM metacharacters so user-supplied content can be
// safely interpolated into a markdown template (`static markdown`) without
// accidentally triggering formatting. The returned plain string is HTML-
// escaped by Glimmer in the DOM, then the prerender textContent-extraction
// step (see CS-10782) decodes those entities so the markdown parser sees
// the backslash escapes and renders the input as literal text.

// Characters that are always escaped. Includes:
//   \  `  *  _       — emphasis / inline code
//   [ ] ( )           — links / images
//   < >               — HTML / autolink / blockquote (line-start case handled
//                        incidentally by unconditional escape)
//   |                 — GFM table separator
//   ~                 — GFM strikethrough
//   !                 — image marker (before `[`)
//   #                 — ATX headings (line-start, but safe to escape anywhere)
//   + -               — unordered list markers (line-start, but safe to
//                        escape anywhere; `\+` and `\-` render as `+`/`-`)
const ESCAPE_CHARS = /[\\`*_[\]()<>|~!#+-]/g;

// Numeric list prefixes like `1.` or `42.` at the start of a (possibly
// indented) line. `)` is already covered by ESCAPE_CHARS, so `1)` becomes
// `1\)` via the always-escape pass.
const NUMERIC_LIST_PREFIX = /^(\s*\d+)\./gm;

export function markdownEscape(input: unknown): string {
  if (input == null) {
    return '';
  }
  let str = typeof input === 'string' ? input : String(input);
  let escaped = str.replace(ESCAPE_CHARS, (c) => `\\${c}`);
  escaped = escaped.replace(NUMERIC_LIST_PREFIX, '$1\\.');
  return escaped;
}

export default markdownEscape;
