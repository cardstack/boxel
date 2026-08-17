// Resolution of an HTTP `Range` request header (RFC 9110 §14) against a body
// whose total byte size is known. Only single `bytes=` ranges resolve to a
// slice: a server is permitted to ignore any Range it chooses not to satisfy
// by answering with the full 200 representation, and multi-range responses
// (multipart/byteranges) buy browsers nothing — media elements only ever ask
// for one range — so everything except a well-formed single range resolves to
// `full`.
export type RangeResolution =
  // Serve the complete representation as a 200: no Range header, a malformed
  // one, a non-bytes unit, or a multi-range request.
  | { kind: 'full' }
  // Serve a 206 with these inclusive byte offsets.
  | { kind: 'range'; start: number; end: number }
  // Serve a 416: the range is syntactically valid but selects no bytes of
  // this representation (start at or past the end, or a zero-length suffix).
  | { kind: 'unsatisfiable' };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

export function resolveRangeHeader(
  header: string | null | undefined,
  totalSize: number,
): RangeResolution {
  if (!header) {
    return { kind: 'full' };
  }
  let match = SINGLE_RANGE.exec(header.trim());
  if (!match) {
    return { kind: 'full' };
  }
  let [, startDigits, endDigits] = match;
  if (startDigits === '' && endDigits === '') {
    // "bytes=-" carries no offsets at all.
    return { kind: 'full' };
  }
  if (startDigits === '') {
    // Suffix range "bytes=-N": the final N bytes. A zero-length suffix
    // selects nothing, which the spec defines as unsatisfiable.
    let suffixLength = parseInt(endDigits, 10);
    if (suffixLength === 0 || totalSize === 0) {
      return { kind: 'unsatisfiable' };
    }
    return {
      kind: 'range',
      start: Math.max(0, totalSize - suffixLength),
      end: totalSize - 1,
    };
  }
  let start = parseInt(startDigits, 10);
  if (start >= totalSize) {
    return { kind: 'unsatisfiable' };
  }
  if (endDigits === '') {
    // Open-ended "bytes=N-": from N through the final byte.
    return { kind: 'range', start, end: totalSize - 1 };
  }
  let end = parseInt(endDigits, 10);
  if (end < start) {
    return { kind: 'full' };
  }
  // A last-byte position past the end of the representation is valid; it
  // means "through the final byte".
  return { kind: 'range', start, end: Math.min(end, totalSize - 1) };
}
