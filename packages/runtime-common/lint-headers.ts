// The file name a `_lint` caller is linting on behalf of. The realm only reads
// it to pick a parser (`extname`) and to reject path traversal, so the value is
// advisory — but it still has to survive the wire, and a header value is a
// ByteString. A name carrying anything outside Latin-1 — an emoji, a CJK
// character — cannot be written into one at all: `new Headers` rejects it with
// `Cannot convert argument to a ByteString`, so a file named `ai🎉app-card.gts`
// cannot be named in this header verbatim, and the failure lands in the caller
// before the request is sent. Percent-encoding is therefore part of this
// header's contract.
export const LINT_FILENAME_HEADER = 'X-Filename';

export function encodeLintFilename(filename: string): string {
  return encodeURIComponent(filename);
}

// Recovers the name from its percent-encoded form. Also used on the last
// segment of a `URL.pathname`, which carries a file name under the same
// encoding, to get back the name as it is on disk.
//
// A value that isn't encoded is tolerated rather than rejected, so a caller
// that sends the name verbatim still gets the parser it asked for. An ASCII
// name encodes to itself, which leaves only names holding a bare `%` for this
// to be lenient about — there `decodeURIComponent` throws instead of returning
// the name. Falling back to the raw string costs nothing: the name is advisory,
// and a `%` can't reach a realm file name anyway (`toSafeFileName` replaces
// it).
export function decodeLintFilename(
  raw: string | null | undefined,
): string | undefined {
  if (typeof raw !== 'string' || raw === '') {
    return undefined;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
