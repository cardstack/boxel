/**
 * Excel's wildcards, matched without a regular expression.
 *
 * `*` stands for any run of characters, `?` for exactly one, and `~` escapes
 * any of the three. Compiling those to a regex is the obvious implementation
 * and the wrong one: `*` becomes `.*`, and a pattern carrying several of them
 * makes a backtracking engine explore exponentially many splits, so
 * `SEARCH("*a*a*a*a*b", <a long field>)` stops being a search and becomes a
 * hang — in an indexing worker, or on the browser's main thread.
 *
 * A pattern is instead split on `*` into segments that must appear in order.
 * Each segment is matched where it first can, which is optimal because the
 * runs between segments are unconstrained, so the whole match is decided in
 * one forward pass over the text.
 */

/** One run between stars: a literal character, or `null` for any one character. */
type WildcardSegment = (string | null)[];

function parseWildcardPattern(pattern: string): WildcardSegment[] {
  const segments: WildcardSegment[] = [[]];
  let escaped = false;
  for (const char of pattern) {
    const segment = segments[segments.length - 1];
    if (escaped) {
      segment.push(char);
      escaped = false;
    } else if (char === '~') {
      escaped = true;
    } else if (char === '*') {
      segments.push([]);
    } else if (char === '?') {
      segment.push(null);
    } else {
      segment.push(char);
    }
  }
  return segments;
}

/**
 * Case-insensitively, per character: folding whole strings would be wrong here,
 * since a character whose lower case is longer than itself would shift every
 * index after it.
 */
function sameCharacter(expected: string, actual: string) {
  return expected === actual || expected.toLowerCase() === actual.toLowerCase();
}

function segmentMatchesAt(
  segment: WildcardSegment,
  text: string,
  at: number,
): boolean {
  if (at < 0 || at + segment.length > text.length) return false;
  for (let index = 0; index < segment.length; index++) {
    const expected = segment[index];
    if (expected !== null && !sameCharacter(expected, text[at + index])) {
      return false;
    }
  }
  return true;
}

function findSegment(
  segment: WildcardSegment,
  text: string,
  from: number,
): number {
  for (let at = from; at + segment.length <= text.length; at++) {
    if (segmentMatchesAt(segment, text, at)) return at;
  }
  return -1;
}

/**
 * Where the pattern first matches inside `text`, or -1. The match is anchored
 * at neither end, which is what `SEARCH` and `FIND` report a position for.
 */
export function excelWildcardSearch(pattern: string, text: string): number {
  const segments = parseWildcardPattern(pattern);
  const [first] = segments;
  const start = findSegment(first, text, 0);
  if (start === -1) return -1;

  // Only the earliest start needs trying: a later one leaves every following
  // segment strictly less room, so if the chain fails from here it fails from
  // there too.
  let cursor = start + first.length;
  for (let index = 1; index < segments.length; index++) {
    const at = findSegment(segments[index], text, cursor);
    if (at === -1) return -1;
    cursor = at + segments[index].length;
  }
  return start;
}

/** Whether the pattern matches the whole of `text`, as a criteria match does. */
export function excelWildcardMatchesWhole(
  pattern: string,
  text: string,
): boolean {
  const segments = parseWildcardPattern(pattern);
  const first = segments[0];
  if (segments.length === 1) {
    return first.length === text.length && segmentMatchesAt(first, text, 0);
  }

  // With stars present, the ends are pinned and the middle segments float.
  const last = segments[segments.length - 1];
  const lastStart = text.length - last.length;
  if (
    !segmentMatchesAt(first, text, 0) ||
    lastStart < first.length ||
    !segmentMatchesAt(last, text, lastStart)
  ) {
    return false;
  }

  let cursor = first.length;
  for (let index = 1; index < segments.length - 1; index++) {
    const segment = segments[index];
    const at = findSegment(segment, text, cursor);
    if (at === -1 || at + segment.length > lastStart) return false;
    cursor = at + segment.length;
  }
  return true;
}
