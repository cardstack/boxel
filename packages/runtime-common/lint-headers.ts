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

// The largest source, in UTF-8 bytes, that `_lint` runs the lint engines on.
// Lint cost grows with the file: ESLint, Prettier and ember-template-lint each
// parse the whole module, and a dense 900 KB card module needs over 600 MB of
// heap on top of the ~200 MB the loaded engines hold. Files at or under this
// size lint well inside the lint thread's heap limit. A larger source is passed
// through unchanged with a warning instead of being linted, so it still saves;
// the code editor reads this to tell the author before they ask for a format.
export const MAX_LINT_SOURCE_BYTES = 300 * 1024;

// The rule ids of the warning a `_lint` result carries when the engines did
// not run on the source: it was over the size limit, or linting it ran out of
// the lint thread's memory. Such a result passes, so a save still goes
// through; a caller that certifies lint (a submission gate) checks for these.
export const LINT_NOT_RUN_RULE_IDS = {
  tooLarge: 'lint-source/too-large',
  outOfMemory: 'lint-source/out-of-memory',
} as const;

export function isLintNotRunRuleId(ruleId: string | null | undefined): boolean {
  return (
    ruleId === LINT_NOT_RUN_RULE_IDS.tooLarge ||
    ruleId === LINT_NOT_RUN_RULE_IDS.outOfMemory
  );
}
