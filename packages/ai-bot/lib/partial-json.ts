// Parse the JSON prefix a provider has streamed so far for a tool call's
// arguments. The result holds every complete value, plus the string value
// being written at the end (so a long `code` argument grows as it arrives).
// An incomplete key, number or literal is left out. Returns undefined when
// the prefix holds no object or array yet.
//
// This is for previews only: a partial value must never be executed.

type Frame = {
  kind: 'object' | 'array';
  // object: key -> colon -> value -> comma-or-end; array: value -> comma-or-end
  expect: 'key' | 'colon' | 'value' | 'commaOrEnd';
};

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const LITERALS = new Set(['true', 'false', 'null']);

export function parsePartialJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Incomplete; recover the longest valid prefix below.
  }

  let stack: Frame[] = [];
  // The longest prefix that becomes valid JSON by appending closers.
  let safe: { end: number; closers: string } | undefined;
  let closers = () =>
    stack
      .map((frame) => (frame.kind === 'object' ? '}' : ']'))
      .reverse()
      .join('');
  let markSafe = (end: number) => (safe = { end, closers: closers() });
  let valueDone = (end: number) => {
    let top = stack[stack.length - 1];
    if (top) {
      top.expect = 'commaOrEnd';
    }
    markSafe(end);
  };

  let i = 0;
  while (i < text.length) {
    let ch = text[i];
    let top = stack[stack.length - 1];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let isKey = top?.kind === 'object' && top.expect === 'key';
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) {
        if (isKey || !top) {
          break;
        }
        // A value string still being written: close it where it stops,
        // dropping an escape sequence cut in half.
        let partial = text
          .slice(i, text.length)
          .replace(/\\(u[0-9a-fA-F]{0,3})?$/, '');
        try {
          return JSON.parse(
            text.slice(0, i) + partial + '"' + closers(),
          ) as unknown;
        } catch {
          break;
        }
      }
      i = j + 1;
      if (isKey) {
        top!.expect = 'colon';
      } else {
        valueDone(i);
      }
      continue;
    }
    if (ch === '{' || ch === '[') {
      if (top) {
        top.expect = 'commaOrEnd';
      }
      stack.push({
        kind: ch === '{' ? 'object' : 'array',
        expect: ch === '{' ? 'key' : 'value',
      });
      i++;
      markSafe(i);
      continue;
    }
    if (ch === '}' || ch === ']') {
      stack.pop();
      i++;
      valueDone(i);
      if (stack.length === 0) {
        break;
      }
      continue;
    }
    if (ch === ':') {
      if (top) {
        top.expect = 'value';
      }
      i++;
      continue;
    }
    if (ch === ',') {
      if (top) {
        top.expect = top.kind === 'object' ? 'key' : 'value';
      }
      i++;
      continue;
    }
    // A number or literal: complete only once a delimiter follows it.
    let j = i;
    while (j < text.length && !/[\s,:{}[\]"]/.test(text[j])) {
      j++;
    }
    let token = text.slice(i, j);
    if (j === text.length || !(NUMBER.test(token) || LITERALS.has(token))) {
      break;
    }
    i = j;
    valueDone(i);
  }

  if (!safe) {
    return undefined;
  }
  try {
    return JSON.parse(text.slice(0, safe.end) + safe.closers) as unknown;
  } catch {
    return undefined;
  }
}
