// The search/replace markers are reproduced verbatim by the model on every code
// patch it writes, so recognizing a patch means matching text an LLM typed from
// memory. A bare run of ═ is the part it gets wrong: the separator comes back
// with a different number of ═ often enough to matter, while the SEARCH and
// REPLACE markers, whose runs are anchored either side of a word, do not drift.
// Match the runs by shape rather than by length — a miscounted rule still
// describes an unambiguous patch, and treating it as prose silently discards a
// diff the user asked for.
//
// The constants remain the canonical form to *emit* (skill instructions, tool
// descriptions); these patterns are the tolerant form to *recognize*.

export const SEARCH_MARKER_PATTERN = /╔═+ SEARCH ═+╗/;
export const SEPARATOR_MARKER_PATTERN = /╠═+╣/;
export const REPLACE_MARKER_PATTERN = /╚═+ REPLACE ═+╝/;

export interface MarkerMatch {
  index: number; // offset of the marker's first character
  end: number; // offset just past the marker's last character
  text: string; // the marker as it was actually written
}

function findMarker(
  pattern: RegExp,
  input: string,
  fromIndex = 0,
): MarkerMatch | null {
  let match = pattern.exec(input.slice(fromIndex));
  if (!match) {
    return null;
  }
  let index = fromIndex + match.index;
  return { index, end: index + match[0].length, text: match[0] };
}

export function findSearchMarker(input: string, fromIndex = 0) {
  return findMarker(SEARCH_MARKER_PATTERN, input, fromIndex);
}

export function findSeparatorMarker(input: string, fromIndex = 0) {
  return findMarker(SEPARATOR_MARKER_PATTERN, input, fromIndex);
}

export function findReplaceMarker(input: string, fromIndex = 0) {
  return findMarker(REPLACE_MARKER_PATTERN, input, fromIndex);
}

export interface SearchReplaceBlockMatch {
  start: number; // offset of the SEARCH marker
  end: number; // offset just past the REPLACE marker
  search: MarkerMatch;
  separator: MarkerMatch;
  replace: MarkerMatch;
}

// A block only counts when the three markers appear in order, so a stray
// separator inside replacement content can't be mistaken for the real one.
export function findSearchReplaceBlock(
  input: string,
  fromIndex = 0,
): SearchReplaceBlockMatch | null {
  let search = findSearchMarker(input, fromIndex);
  if (!search) {
    return null;
  }
  let separator = findSeparatorMarker(input, search.end);
  if (!separator) {
    return null;
  }
  let replace = findReplaceMarker(input, separator.end);
  if (!replace) {
    return null;
  }
  return { start: search.index, end: replace.end, search, separator, replace };
}

export function isCompleteSearchReplaceBlock(
  input?: string | null,
): input is string {
  return !!input && findSearchReplaceBlock(input) !== null;
}

// True for a line that has begun a SEARCH marker but may not have finished it,
// which is how a patch looks while it is still streaming in.
export function startsSearchMarker(line: string): boolean {
  return /^╔═/.test(line);
}

// A well-formed block carries a single separator between its search and replace
// halves. A model occasionally emits a stray extra separator right before the
// REPLACE marker; left in, it lands in the replace content and gets written into
// the file as a line of box-drawing characters. Drop any trailing separator
// (with surrounding whitespace) so the slip self-heals into the intended
// content. The marker is distinctive enough that real code/JSON never
// legitimately ends with it.
export function stripTrailingSeparatorMarker(content: string): string {
  return content.replace(/(?:\s*╠═+╣)+\s*$/, '');
}
