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
// Frames, not lines: the message above them is bounded separately.
const MAX_ERROR_STACK_FRAMES = 16;
const MAX_ERROR_STACK_CHARS = 2_000;
// The message the engine opens a stack with is not a frame and has to leave room
// for the frames below it.
const MAX_ERROR_STACK_HEADER_CHARS = 500;

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

// The stack as the engine gave it, bounded. Frames are taken from the top so the
// throw site always survives; the deep tail — the least informative end — is what
// gets dropped, first by frame count and then to fit the character budget.
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
  // Everything above the first frame is the message the engine opened the stack
  // with. It is not a frame, it is unbounded — an error carrying a response body
  // or a serialized document runs to thousands of characters — and it can span
  // lines. So it is bounded on its own rather than competing with the frames for
  // one allowance: otherwise it takes the whole budget, dropping deep frames
  // does not help, and every frame is discarded, losing what the stack is for.
  let firstFrame = lines.findIndex((line) => frameAt(line) !== undefined);
  let header = firstFrame === -1 ? lines : lines.slice(0, firstFrame);
  let frames =
    firstFrame === -1
      ? []
      : lines.slice(firstFrame, firstFrame + MAX_ERROR_STACK_FRAMES);
  let head = header.length
    ? truncate(header.join('\n'), MAX_ERROR_STACK_HEADER_CHARS)
    : '';
  let assemble = (count: number) =>
    (head ? [head, ...frames.slice(0, count)] : frames.slice(0, count)).join(
      '\n',
    );
  let kept = frames.length;
  let out = assemble(kept);
  // Then drop frames from the deep end — the least informative ones — to fit.
  while (out.length > MAX_ERROR_STACK_CHARS && kept > 1) {
    kept--;
    out = assemble(kept);
  }
  return truncate(out, MAX_ERROR_STACK_CHARS);
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
    raw: candidate,
    functionName: functionName.trim(),
    url,
    line: Number(line),
    col: Number(col),
  };
}

const V8_FRAME_PREFIX_RE = /^at\s+/;

// Every engine marks its frames: V8 prefixes each with `at`, SpiderMonkey and
// JSC join the function name to the location with `@` (and write a bare `@` for
// an anonymous one). V8 also opens the stack with the message, which carries no
// such marker — and a message can otherwise be shaped exactly like a frame, so
// the marker is what tells the two apart rather than position alone.
function isFrameLine(candidate: string): boolean {
  let trimmed = candidate.trim();
  return V8_FRAME_PREFIX_RE.test(trimmed) || trimmed.includes('@');
}

// One line read as a frame, or undefined if it isn't one. Both tests matter and
// neither is sufficient alone: the marker rejects a message that merely happens
// to be frame-shaped, and requiring a parseable `:line:col` rejects a message
// that merely mentions a scoped module (`@cardstack/…`) or a user id — which the
// marker alone accepts, since it looks for a bare `@`.
function frameAt(line: string): StackFrame | undefined {
  return isFrameLine(line) ? parseStackFrame(line) : undefined;
}

// The topmost frame that carries a location.
function topStackFrame(stack: string): StackFrame {
  let lines = stack.split('\n');
  for (let candidate of lines) {
    let frame = frameAt(candidate);
    if (frame) {
      return frame;
    }
  }
  return {
    raw: lines[0] ?? '',
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
