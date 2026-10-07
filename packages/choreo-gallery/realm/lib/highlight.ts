import { htmlSafe } from '@ember/template';

const KEYWORDS = new Set([
  'as',
  'const',
  'each',
  'else',
  'false',
  'get',
  'if',
  'let',
  'null',
  'return',
  'this',
  'true',
  'undefined',
]);

const HELPERS = new Set([
  'animate',
  'array',
  'beacon',
  'eq',
  'ease',
  'fn',
  'hash',
  'inertia',
  'motion',
  'motionValue',
  'on',
  'scrollProgress',
  'spring',
  'stagger',
  'to',
  'transformValue',
  'tween',
  'animateView',
  'viewTransition',
  'view-transition-group',
]);

/** an empty card field reaches here as null, and highlights as nothing */
export function highlightSample(source: string | null | undefined) {
  return htmlSafe(colorize(source ?? ''));
}

function colorize(source: string): string {
  let i = 0;
  let out = '';
  const n = source.length;

  while (i < n) {
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      const next = end === -1 ? n : end;
      out += wrap('comment', source.slice(i, next));
      i = next;
      continue;
    }

    const quote = source[i];
    if (quote === "'" || quote === '"') {
      const end = closeQuote(source, i, quote);
      if (end !== -1) {
        out += wrap('string', source.slice(i, end));
        i = end;
        continue;
      }
      /* an apostrophe in prose: fall through, take it as an atom */
    }

    // a handlebars comment is prose, not an expression: without this the
    // words inside it get tokenised as helpers and keywords
    if (source.startsWith('{{!', i)) {
      const end = commentEnd(source, i);
      out += wrap('comment', source.slice(i, end));
      i = end;
      continue;
    }

    if (source.startsWith('{{', i)) {
      const end = closeMustache(source, i);
      out += colorizeMustache(source.slice(i, end));
      i = end;
      continue;
    }

    if (source[i] === '<' && /[A-Za-z/:]/.test(source[i + 1] ?? '')) {
      const end = closeTag(source, i);
      out += colorizeTag(source.slice(i, end));
      i = end;
      continue;
    }

    const taken = takeAtom(source, i);
    out += taken.html;
    i = taken.next;
  }

  return out;
}

/** `{{!-- … --}}` closes on its own marker; `{{! … }}` closes like a mustache */
function commentEnd(source: string, start: number): number {
  if (source.startsWith('{{!--', start)) {
    const close = source.indexOf('--}}', start);
    return close === -1 ? source.length : close + 4;
  }
  return closeMustache(source, start);
}

function colorizeMustache(block: string): string {
  const open = block.match(/^\{\{[/#]?/)?.[0] ?? '{{';
  const closed = block.endsWith('}}');
  const inner = block.slice(open.length, closed ? -2 : undefined);
  return `${wrap('mustache', open)}${colorizeExpr(inner, 'attr')}${closed ? wrap('mustache', '}}') : ''}`;
}

function colorizeTag(tag: string): string {
  let i = 0;
  let out = '';
  const n = tag.length;
  const name = tag.match(/^<\/?[A-Za-z][\w:.-]*/)?.[0];
  if (name) {
    out += wrap('tag', name);
    i = name.length;
  }

  while (i < n) {
    if (tag.startsWith('{{!', i)) {
      const end = commentEnd(tag, i);
      out += wrap('comment', tag.slice(i, end));
      i = end;
      continue;
    }

    if (tag.startsWith('{{', i)) {
      const end = closeMustache(tag, i);
      out += colorizeMustache(tag.slice(i, end));
      i = end;
      continue;
    }

    if (tag.startsWith('/>', i) || tag[i] === '>') {
      const len = tag.startsWith('/>', i) ? 2 : 1;
      out += wrap('tag', tag.slice(i, i + len));
      i += len;
      continue;
    }

    const quote = tag[i];
    if (quote === "'" || quote === '"') {
      const end = closeQuote(tag, i, quote);
      if (end !== -1) {
        out += wrap('string', tag.slice(i, end));
        i = end;
        continue;
      }
      /* an apostrophe in prose: fall through, take it as an atom */
    }

    if (tag[i] === '@') {
      const arg = tag.slice(i).match(/^@[A-Za-z]\w*/)?.[0];
      if (arg) {
        out += wrap('arg', arg);
        i += arg.length;
        continue;
      }
    }

    const taken = takeAtom(tag, i, 'attr');
    out += taken.html;
    i = taken.next;
  }

  return out;
}

function colorizeExpr(
  source: string,
  word: 'plain' | 'attr' = 'plain',
): string {
  let i = 0;
  let out = '';
  const n = source.length;
  while (i < n) {
    const quote = source[i];
    if (quote === "'" || quote === '"') {
      const end = closeQuote(source, i, quote);
      if (end !== -1) {
        out += wrap('string', source.slice(i, end));
        i = end;
        continue;
      }
      /* an apostrophe in prose: fall through, take it as an atom */
    }
    const taken = takeAtom(source, i, word);
    out += taken.html;
    i = taken.next;
  }
  return out;
}

function takeAtom(
  source: string,
  i: number,
  ident: 'plain' | 'attr' = 'plain',
): { html: string; next: number } {
  const ch = source[i] ?? '';
  if (!ch) {
    return { html: '', next: i };
  }

  if (/\s/.test(ch)) {
    return { html: escape(ch), next: i + 1 };
  }

  if (source[i] === '@') {
    const arg = source.slice(i).match(/^@[A-Za-z]\w*/)?.[0];
    if (arg) {
      return { html: wrap('arg', arg), next: i + arg.length };
    }
  }

  const num = source.slice(i).match(/^\d+\.?\d*/);
  if (num) {
    return { html: wrap('number', num[0]), next: i + num[0].length };
  }

  const word = source.slice(i).match(/^[A-Za-z_$][\w$]*/);
  if (word) {
    const name = word[0];
    const kind = KEYWORDS.has(name)
      ? 'keyword'
      : HELPERS.has(name)
        ? 'helper'
        : ident;
    return { html: wrap(kind, name), next: i + name.length };
  }

  return { html: wrap('punct', ch), next: i + 1 };
}

/**
 * A STRING DOES NOT CROSS A LINE, and an apostrophe is not a quote.
 *
 * The naive rule — open at the first `'`, close at the next one — reads
 * "the film's own type" as the start of a string and paints everything
 * up to the next apostrophe anywhere in the sample, which in a sample
 * with prose in it is most of the sample. Neither language quoted here
 * lets a single- or double-quoted string span a newline, so a quote
 * with no partner on its own line is not a delimiter: it is
 * punctuation, and the caller takes it as an ordinary atom.
 *
 * Returns -1 when the quote does not close on its line.
 */
function closeQuote(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\n') {
      return -1;
    }
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) {
      return i + 1;
    }
    i += 1;
  }
  return -1;
}

function closeMustache(source: string, start: number): number {
  const end = source.indexOf('}}', start + 2);
  return end === -1 ? source.length : end + 2;
}

function closeTag(source: string, start: number): number {
  let i = start + 1;
  let quote: string | undefined;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
      }
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      i += 1;
      continue;
    }
    if (source.startsWith('{{', i)) {
      i = closeMustache(source, i);
      continue;
    }
    if (ch === '>') {
      return i + 1;
    }
    i += 1;
  }
  return source.length;
}

function wrap(kind: string, text: string): string {
  return `<span class="syn-${kind}">${escape(text)}</span>`;
}

function escape(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
