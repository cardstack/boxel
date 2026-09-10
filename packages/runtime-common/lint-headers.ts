// The file name a `_lint` caller is linting on behalf of. The realm reads it to
// pick a parser (`extname`) and to reject a name that escapes the lint anchor,
// so the value is advisory — but it still has to survive the wire, and a header
// value is a ByteString. A name carrying anything outside Latin-1 — an emoji, a
// CJK character — cannot be written into one at all: `new Headers` rejects it
// with `Cannot convert argument to a ByteString`, so a file named
// `ai🎉app-card.gts` cannot be named in this header verbatim, and the failure
// lands in the caller before the request is sent. Senders therefore
// percent-encode the name; the realm decodes it back, and tolerates a value
// that arrives unencoded.
export const LINT_FILENAME_HEADER = 'X-Filename';

export function encodeLintFilename(filename: string): string {
  return encodeURIComponent(filename);
}

// Control characters are dropped rather than decoded through. A header can
// never carry a bare CR or LF, but a percent-encoded one decodes into a value
// that can, and the name reaches a log line before the lint task validates it.
// Nothing else about the name is filtered here: the traversal check runs on the
// decoded value, which is the point of decoding before it — `..%2F..%2Fetc` is
// a single innocuous-looking segment until it is decoded.
// The control characters in this range are the whole point of the pattern, so
// the lint that guards against writing one into a regex by accident does not
// apply.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

// Recovers the name from its percent-encoded form. Also used on the last
// segment of a `URL.pathname`, which carries a file name under the same
// encoding, to get back the name as it is on disk.
//
// A value that isn't encoded is tolerated rather than rejected, so a caller
// that sends the name verbatim still gets the parser it asked for. An ASCII
// name encodes to itself, which leaves only names holding a bare `%` for this
// to be lenient about — there `decodeURIComponent` throws instead of returning
// the name. Falling back to the raw string costs nothing: such a name cannot be
// a realm file in the first place, because `RealmPaths.local` recovers a path
// with `decodeURI`, which throws `URIError` on an escape that isn't valid hex.
export function decodeLintFilename(
  raw: string | null | undefined,
): string | undefined {
  if (typeof raw !== 'string' || raw === '') {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  let stripped = decoded.replace(CONTROL_CHARS, '');
  // A value that was nothing but control characters names no file, so it reads
  // the same as an absent header and lets the caller's own default stand.
  return stripped === '' ? undefined : stripped;
}
