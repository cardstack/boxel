// Turning a thrown thing into the fields a `client-error` telemetry event
// reports. Everything here is pure: given the same `error` / `unhandledrejection`
// event it always yields the same report, which is why it lives apart from the
// instrument — the instrument owns how many events to emit and when, this owns
// what a throw *is*.
//
// The two entry points are `reportFromErrorEvent` and `reportFromRejectionEvent`.
// Both return the same shape, including a `signature` the instrument coalesces
// repeats by.

// Bounds. The stack is the payload an error event exists to carry — a message
// says the app broke, the stack says where — so it gets the generous budget and
// the message is what yields: eight frames does not clear the framework frames
// between a throw and the app code that caused it.
const MAX_ERROR_MESSAGE_CHARS = 300;
// Shorter than the message: this one is read as a grouping key in a table cell.
const MAX_ERROR_MESSAGE_KEY_CHARS = 160;
// How much of a message the key's normalization reads. Collapsing ids scans for
// them, and message content is entirely data-controlled, so an unbounded scan is
// unbounded work inside an error handler. Past this, content is invisible to the
// key: two messages that differ only beyond it group together.
const MAX_ERROR_MESSAGE_KEY_SOURCE_CHARS = 4_000;
// Lines taken from the stack once the message above them is set aside.
const MAX_ERROR_STACK_LINES = 16;
const MAX_ERROR_STACK_CHARS = 2_000;
// No single line may spend the whole stack budget, or one long line starves every
// other. Both the message the engine opens with and any one frame are capped —
// the message is not always separable from the frames by inspection, so the cap
// is what guarantees a frame survives either way.
const MAX_ERROR_STACK_LINE_CHARS = 500;
// A frame's parts land in dashboard labels, so they are bounded too — generously,
// since a real url with a bundler prefix and escapes is long.
const MAX_ERROR_FRAME_FIELD_CHARS = 300;

export type ClientErrorKind = 'error' | 'unhandledrejection';

// The fields a client-error event reports about the throw itself, plus the
// identity repeats of it coalesce under.
export interface ErrorReport {
  kind: ClientErrorKind;
  message: string;
  message_key: string;
  stack: string;
  top_frame_function: string;
  source_url: string;
  line: number;
  col: number;
  signature: string;
}

// A `window` error event: an uncaught throw. Prefer the error object it carries,
// and fall back to the event's own message so a cross-origin `Script error.` —
// which carries no error at all — is still reported rather than dropped.
export function reportFromErrorEvent(event: Event): ErrorReport {
  let e = event as ErrorEvent;
  let error = asErrorLike(e.error);
  return buildReport({
    kind: 'error',
    message: error ? describeError(error) : stringifyReason(e.message),
    stack: error?.stack,
    sourceUrl: typeof e.filename === 'string' ? e.filename : '',
    line: Number.isFinite(e.lineno) ? e.lineno : 0,
    col: Number.isFinite(e.colno) ? e.colno : 0,
  });
}

// An unhandled rejection. `reason` is whatever was rejected with, and it carries
// no location of its own, so the stack's first frame is the only one available.
export function reportFromRejectionEvent(event: Event): ErrorReport {
  let { reason } = event as PromiseRejectionEvent;
  let error = asErrorLike(reason);
  return buildReport({
    kind: 'unhandledrejection',
    message: error ? describeError(error) : stringifyReason(reason),
    stack: error?.stack,
    sourceUrl: '',
    line: 0,
    col: 0,
  });
}

interface RawThrow {
  kind: ClientErrorKind;
  message: string;
  stack: string | undefined;
  sourceUrl: string;
  line: number;
  col: number;
}

function buildReport(raw: RawThrow): ErrorReport {
  // The frame is read from the stack as the engine gave it, not from the bounded
  // copy: where the throw happened is a fact about the error, and must not depend
  // on how much of the stack fit in the budget.
  let frame = topStackFrame(raw.stack ?? '');
  // The grouping key derives from the whole message, not the truncated one.
  // Keying off the truncation would merge two different failures whose messages
  // happen to share a long prefix — exactly the shape a message carrying a
  // serialized document has.
  let messageKey = errorMessageKey(raw.message);
  return {
    kind: raw.kind,
    message: truncate(raw.message, MAX_ERROR_MESSAGE_CHARS),
    message_key: messageKey,
    stack: boundStack(raw.stack),
    top_frame_function: frame.functionName,
    source_url: raw.sourceUrl || frame.url,
    line: raw.line || frame.line,
    col: raw.col || frame.col,
    signature: `${raw.kind} ${messageKey} ${frame.raw}`,
  };
}

interface ErrorLike {
  name?: string;
  message: string;
  stack?: string;
}

// A rejection reason is whatever was rejected with — an Error, a plain object,
// a string, anything. Treat a `message` string as error-like so a
// non-Error-but-error-shaped reason still reports a message and a stack.
function asErrorLike(value: unknown): ErrorLike | undefined {
  if (value instanceof Error) {
    return value;
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { message?: unknown }).message === 'string'
  ) {
    return value as ErrorLike;
  }
  return undefined;
}

// `TypeError: ...` rather than the bare message: the class is the first thing a
// reader wants and `message` never carries it. Only a real Error contributes its
// name — on a merely error-shaped object (a card instance rejected as a reason)
// `name` is an ordinary field, and prefixing the message with a field value
// would read as a class that does not exist.
function describeError(error: ErrorLike): string {
  let name =
    error instanceof Error && typeof error.name === 'string' ? error.name : '';
  return name ? `${name}: ${error.message}` : error.message;
}

// A reason with no message of its own. String conversion can itself throw (a
// symbol, a proxy), and this runs while reporting an error, so it cannot.
function stringifyReason(reason: unknown): string {
  if (typeof reason === 'string') {
    return reason;
  }
  try {
    return String(reason);
  } catch {
    return '';
  }
}

// Cut to a budget, marking the cut so a truncated value doesn't read as the
// whole one. The marker is counted, so the result never exceeds the budget.
function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// The stack as the engine gave it, bounded. Lines are taken from the top so the
// throw site survives; the deep tail — the least informative end — is what gets
// dropped, first by line count and then to fit the character budget. The count
// bounds lines rather than parsed frames: a real stack carries lines no parse
// claims (`at new Promise (<anonymous>)`), and they occupy slots like any other.
function boundStack(stack: string | undefined): string {
  if (typeof stack !== 'string' || stack.length === 0) {
    return '';
  }
  let lines = stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return '';
  }
  // The message the engine opened with is unbounded — an error carrying a response
  // body or a serialized document runs to thousands of characters, across as many
  // lines as it likes — so it is bounded separately rather than competing with the
  // frames for one allowance.
  let { header, frames: all } = splitStack(lines);
  let frames = all
    .slice(0, MAX_ERROR_STACK_LINES)
    .map((frame) => truncate(frame, MAX_ERROR_STACK_LINE_CHARS));
  let dropped = all.length - frames.length;
  let head = header.length
    ? truncate(header.join('\n'), MAX_ERROR_STACK_LINE_CHARS)
    : '';
  let assemble = (count: number) => {
    let kept = [...(head ? [head] : []), ...frames.slice(0, count)];
    // Say when the tail was cut, so a short stack cannot be misread as a whole
    // one — whether it ran out of lines or out of characters.
    if (dropped > 0 || count < frames.length) {
      kept.push('…');
    }
    return kept.join('\n');
  };
  // Keep two lines even when one would fit: a message shaped exactly like a frame
  // lands among them, and then the throw site is the line below it.
  let floor = Math.min(frames.length, head ? 1 : 2);
  let kept = frames.length;
  let out = assemble(kept);
  // Then drop from the deep end — the least informative lines — to fit.
  while (out.length > MAX_ERROR_STACK_CHARS && kept > floor) {
    kept--;
    out = assemble(kept);
  }
  return truncate(out, MAX_ERROR_STACK_CHARS);
}

// Which lines are frames is a property of the whole stack, not of each line on its
// own. V8 opens with the message and marks every frame with `at`; Gecko and JSC
// mark none and include no message line at all, so their stacks begin at frame 0.
//
// Deciding per line instead forces a test that separates a frame from prose, and
// there isn't one: a `name@location` frame carries whatever `Function.name` holds,
// and that routinely includes spaces — `bound compute`, `get title`, and JSC's own
// `global code` / `module code` / `eval code`. Any per-line rule strict enough to
// reject a prose message also rejects those, which loses the throw site: it lands
// in the header, where it is the message's budget that decides whether it survives
// at all.
function splitStack(lines: string[]): { header: string[]; frames: string[] } {
  let firstV8Frame = lines.findIndex((line) => V8_FRAME_PREFIX_RE.test(line));
  if (firstV8Frame !== -1) {
    return {
      header: lines.slice(0, firstV8Frame),
      frames: lines.slice(firstV8Frame),
    };
  }
  return { header: [], frames: lines };
}

interface StackFrame {
  raw: string;
  functionName: string;
  url: string;
  line: number;
  col: number;
}

// A location's trailing `:line:col`, with everything before it taken as the url.
// The url part is matched greedily rather than by excluding delimiters: a real
// url can contain colons, parens, and percent-escapes, and dropping the last two
// numeric groups is what actually identifies the line and column.
const STACK_LOCATION_RE = /^(.*):(\d+):(\d+)$/;

// Split one frame into a function name and a location. Frames are engine-specific
// in shape but not in structure: V8 writes `at fn (location)` or a bare
// `at location`, SpiderMonkey and JSC write `fn@location` (with an empty name for
// an anonymous frame, so the `@` leads). Splitting on the *first* delimiter keeps
// the function name intact when the location itself contains parens — an eval
// frame, a bundler url with escapes — since a function name can contain none.
//
// Which delimiter applies is decided by the engine that wrote the frame, not by
// which character appears first: a `@` inside a V8 location is part of the url
// (`@cardstack/…`, `@ember/…` are ordinary path segments here), and treating it
// as a delimiter would split the url in half.
function parseStackFrame(candidate: string): StackFrame | undefined {
  let trimmed = candidate.trim();
  let isV8Frame = V8_FRAME_PREFIX_RE.test(trimmed);
  let rest = trimmed.replace(V8_FRAME_PREFIX_RE, '');
  let functionName = '';
  let location = rest;
  let open = rest.indexOf(' (');
  if (open !== -1 && rest.endsWith(')')) {
    functionName = rest.slice(0, open);
    location = rest.slice(open + 2, -1);
  } else if (!isV8Frame) {
    let at = rest.indexOf('@');
    if (at !== -1) {
      functionName = rest.slice(0, at);
      location = rest.slice(at + 1);
    }
  }
  let match = STACK_LOCATION_RE.exec(location);
  if (!match) {
    return undefined;
  }
  let [, url, line, col] = match;
  return {
    raw: truncate(candidate, MAX_ERROR_FRAME_FIELD_CHARS),
    functionName: truncate(functionName.trim(), MAX_ERROR_FRAME_FIELD_CHARS),
    url: truncate(url, MAX_ERROR_FRAME_FIELD_CHARS),
    line: Number(line),
    col: Number(col),
  };
}

const V8_FRAME_PREFIX_RE = /^at\s+/;

// The topmost frame that carries a location — read from the stack's frame region,
// so the throw site and the retained stack can never disagree about which lines
// were frames.
function topStackFrame(stack: string): StackFrame {
  let { frames } = splitStack(
    stack
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  for (let candidate of frames) {
    let frame = parseStackFrame(candidate);
    if (frame) {
      return frame;
    }
  }
  return {
    // Deliberately empty rather than the first line: `raw` identifies the throw
    // site for coalescing, and a stack with no frame identifies none. Feeding the
    // message in here instead would defeat the normalization `message_key` does,
    // since the raw text carries the very ids that key collapses.
    raw: '',
    functionName: '',
    url: '',
    line: 0,
    col: 0,
  };
}

// Collapse the parts of a message that vary per occurrence so the same failure
// against a different card groups as one row rather than one row per card. The
// rule is narrow on purpose: a token of four or more word characters that
// contains a digit becomes a placeholder. That covers uuids, content hashes,
// timestamps, and the generated ids most instance urls carry, and it leaves the
// short numbers that carry meaning (an HTTP status, a small count) intact. It
// does not collapse a short or digit-free id — `…/Person/abc` stays distinct
// from `…/Person/xyz` — because nothing distinguishes those from a meaningful
// word, so this is a grouping key, not a guarantee of one row per failure.
//
// Newlines and runs of whitespace collapse to a single space: the key is read in
// a dashboard table cell, where a multi-line value breaks the row.
function errorMessageKey(message: string): string {
  let normalized = message
    .slice(0, MAX_ERROR_MESSAGE_KEY_SOURCE_CHARS)
    .replace(/\b(?=[\w-]{4,}\b)[\w-]*\d[\w-]*\b/g, '*')
    .replace(/\*(?:[\s/.:_-]*\*)+/g, '*')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= MAX_ERROR_MESSAGE_KEY_CHARS) {
    return normalized;
  }
  // A message past the key budget is usually one carrying a payload, and two of
  // those tend to share a long prefix and diverge only near the end. Cutting to
  // the budget would give them one key, merging two different failures and
  // reporting only whichever arrived first — so the tail rides along as a short
  // digest instead. Same message, same key; different message, different key;
  // bounded either way.
  let digest = keyDigest(normalized);
  return `${normalized.slice(0, MAX_ERROR_MESSAGE_KEY_CHARS - digest.length - 2)}…#${digest}`;
}

// FNV-1a, 32 bits. Not a security hash and not required to be: it only has to
// keep two different messages on two different grouping keys.
function keyDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
