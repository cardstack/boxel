// Removes credentials from what comes back from an outside vendor, before
// anything on our side reads it.
//
// A caller registers every credential value that went into a request, and
// every transform of one (an HTTP Basic token is a credential too), then runs
// the response's headers and body through the scrubber. A registered value is
// found:
//
// - in full, at any length, ignoring ASCII case;
// - as any run at least `MIN_PARTIAL_LENGTH` bytes long of the part after a
//   listed vendor prefix (see `publicPrefix`), ignoring ASCII case;
// - percent-encoded (either hex case, mixed with literal characters), as JSON
//   `\uXXXX` and short escapes, and as HTML numeric and named entities: these
//   are decoded into a second view of the text and searched there too;
// - base64 and base64url encoded, at each of the three byte alignments it can
//   sit at inside a longer encoded run, in full or as a partial run of at least
//   `MIN_PARTIAL_LENGTH` characters. These runs are matched ignoring ASCII
//   case too, which lets one pass over the text find every form; a chance
//   match of that length in ordinary text is vanishingly unlikely.
//
// Each match is replaced by `REDACTED`. Text with no match passes through
// byte for byte, binary included: the scrubber works on bytes, never on a
// decoded string.
//
// The body is scrubbed as a stream. At a chunk boundary the scrubber holds
// back only a short tail, and only while that tail is made of bytes that
// could belong to a registered value or an escape sequence; it is never longer
// than `holdbackBytes`. A match split across chunks is still caught, and
// memory doesn't grow with the body. A stream that fails partway (for example
// one ended at the size cap) discards that held tail rather than delivering
// it, so everything delivered had already cleared the window.

export const REDACTED = '[REDACTED]';

// The shortest partial echo that counts as a credential. Shorter runs are too
// likely to occur by chance in ordinary text.
export const MIN_PARTIAL_LENGTH = 10;

// A base64 run shorter than this is too likely to occur by chance in an
// unrelated encoded payload to be worth removing.
const MIN_BASE64_RUN_LENGTH = 8;

// Fixed prefixes vendors put on every key they issue. Every key of that vendor
// shares one, and text about the vendor quotes it, so it identifies no one:
// partial echoes are matched only in what follows it. These are listed rather
// than recognized by shape, because a pattern can't tell a prefix from the
// start of a random tail that happens to contain a `-` or `_`.
const PUBLIC_PREFIXES = [
  'sk-or-v1-', // OpenRouter
  'sk-ant-api03-', // Anthropic
  'sk-ant-',
  'sk-proj-', // OpenAI
  'sk-svcacct-',
  'sk-',
  'github_pat_', // GitHub
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'ghr_',
  'glpat-', // GitLab
  'xoxb-', // Slack
  'xoxp-',
  'xapp-',
  'sk_live_', // Stripe
  'sk_test_',
  'rk_live_',
  'rk_test_',
  'AIza', // Google API keys
].sort((a, b) => b.length - a.length);

// The longest listed vendor prefix `value` starts with, or ''.
export function publicPrefix(value: string): string {
  return PUBLIC_PREFIXES.find((prefix) => value.startsWith(prefix)) ?? '';
}

// The longest escape sequence the decoded view understands, in bytes:
// `&#x` plus eight hex digits and `;`, or a `\uXXXX\uXXXX` surrogate pair.
const MAX_ESCAPE_LENGTH = 12;

const HASH_BASE = 0x01000193;

const PERCENT = 0x25;
const BACKSLASH = 0x5c;
const AMPERSAND = 0x26;
const HASH_SIGN = 0x23;
const SEMICOLON = 0x3b;

const JSON_SHORT_ESCAPES: Record<number, number> = {
  0x22: 0x22, // \"
  0x5c: 0x5c, // \\
  0x2f: 0x2f, // \/
  0x62: 0x08, // \b
  0x66: 0x0c, // \f
  0x6e: 0x0a, // \n
  0x72: 0x0d, // \r
  0x74: 0x09, // \t
};

const NAMED_ENTITIES: Record<string, number> = {
  amp: 0x26,
  lt: 0x3c,
  gt: 0x3e,
  quot: 0x22,
  apos: 0x27,
};

// Bytes that may appear inside an escape sequence the decoded view
// understands. A held tail may end in any of them.
const ESCAPE_SYNTAX = `%\\&#;"/0123456789abcdefABCDEFuUxXbfnrtlmpgqos`;

function fold(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

const FOLD = new Uint8Array(256).map((_, byte) => fold(byte));

function folded(bytes: Uint8Array): Uint8Array {
  let result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = FOLD[bytes[i]];
  }
  return result;
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  let lower = fold(byte);
  if (lower >= 0x61 && lower <= 0x66) return lower - 0x61 + 10;
  return -1;
}

function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  return Buffer.from(
    bytes.buffer,
    bytes.byteOffset + start,
    end - start,
  ).toString('latin1');
}

function utf8Bytes(codePoint: number): number[] {
  if (codePoint < 0x80) return [codePoint];
  if (codePoint < 0x800) {
    return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)];
  }
  if (codePoint < 0x10000) {
    return [
      0xe0 | (codePoint >> 12),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    ];
  }
  return [
    0xf0 | (codePoint >> 18),
    0x80 | ((codePoint >> 12) & 0x3f),
    0x80 | ((codePoint >> 6) & 0x3f),
    0x80 | (codePoint & 0x3f),
  ];
}

function isScalarValue(codePoint: number): boolean {
  return (
    codePoint >= 0 &&
    codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff)
  );
}

// --- Views ------------------------------------------------------------------

// A sequence of bytes to search, each mapped back to the span of the
// original text it came from. The raw view maps each byte to itself and so
// carries no spans.
interface View {
  folded: Uint8Array;
  starts?: Int32Array;
  ends?: Int32Array;
}

function rawView(bytes: Uint8Array): View {
  // A plain Uint8Array, never a Buffer, so the search loop sees one array
  // shape and stays optimized.
  let plain = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  return { folded: folded(plain) };
}

function readHex(
  bytes: Uint8Array,
  at: number,
  count: number,
): number | undefined {
  if (at + count > bytes.length) return undefined;
  let value = 0;
  for (let i = 0; i < count; i++) {
    let digit = hexValue(bytes[at + i]);
    if (digit < 0) return undefined;
    value = value * 16 + digit;
  }
  return value;
}

// Decodes one escape sequence at `at`, if there is one: the bytes it stands
// for and how many bytes of the original it spans.
function decodeEscape(
  bytes: Uint8Array,
  at: number,
): { decoded: number[]; length: number } | undefined {
  let byte = bytes[at];
  if (byte === PERCENT) {
    let value = readHex(bytes, at + 1, 2);
    return value === undefined ? undefined : { decoded: [value], length: 3 };
  }
  if (byte === BACKSLASH && at + 1 < bytes.length) {
    let next = bytes[at + 1];
    if (next === 0x75) {
      let unit = readHex(bytes, at + 2, 4);
      if (unit === undefined) return undefined;
      if (
        unit >= 0xd800 &&
        unit <= 0xdbff &&
        bytes[at + 6] === BACKSLASH &&
        bytes[at + 7] === 0x75
      ) {
        let low = readHex(bytes, at + 8, 4);
        if (low !== undefined && low >= 0xdc00 && low <= 0xdfff) {
          let codePoint = 0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00);
          return { decoded: utf8Bytes(codePoint), length: 12 };
        }
      }
      return isScalarValue(unit)
        ? { decoded: utf8Bytes(unit), length: 6 }
        : undefined;
    }
    let short = JSON_SHORT_ESCAPES[next];
    return short === undefined ? undefined : { decoded: [short], length: 2 };
  }
  if (byte === AMPERSAND) {
    if (bytes[at + 1] === HASH_SIGN) {
      let hex = fold(bytes[at + 2] ?? 0) === 0x78;
      let cursor = at + (hex ? 3 : 2);
      let codePoint = 0;
      let digits = 0;
      while (cursor < bytes.length && digits < 8) {
        let digit = hex
          ? hexValue(bytes[cursor])
          : bytes[cursor] >= 0x30 && bytes[cursor] <= 0x39
            ? bytes[cursor] - 0x30
            : -1;
        if (digit < 0) break;
        codePoint = codePoint * (hex ? 16 : 10) + digit;
        digits++;
        cursor++;
      }
      if (digits === 0 || !isScalarValue(codePoint)) return undefined;
      if (bytes[cursor] === SEMICOLON) cursor++;
      return { decoded: utf8Bytes(codePoint), length: cursor - at };
    }
    for (let [name, value] of Object.entries(NAMED_ENTITIES)) {
      let end = at + 1 + name.length;
      if (
        bytes[end] === SEMICOLON &&
        latin1(bytes, at + 1, Math.min(end, bytes.length)) === name
      ) {
        return { decoded: [value], length: name.length + 2 };
      }
    }
  }
  return undefined;
}

function mayContainEscapes(bytes: Uint8Array): boolean {
  return (
    bytes.includes(PERCENT) ||
    bytes.includes(BACKSLASH) ||
    bytes.includes(AMPERSAND)
  );
}

// The text with every escape sequence decoded, or undefined when it holds
// none and so reads the same as the raw view. No escape decodes to more
// bytes than it spans, so the decoded text is never longer than the original.
function decodedView(bytes: Uint8Array): View | undefined {
  let decoded = new Uint8Array(bytes.length);
  let starts = new Int32Array(bytes.length);
  let ends = new Int32Array(bytes.length);
  let length = 0;
  let escapes = 0;
  let at = 0;
  while (at < bytes.length) {
    let byte = bytes[at];
    let escape =
      byte === PERCENT || byte === BACKSLASH || byte === AMPERSAND
        ? decodeEscape(bytes, at)
        : undefined;
    if (escape) {
      escapes++;
      for (let value of escape.decoded) {
        decoded[length] = value;
        starts[length] = at;
        ends[length] = at + escape.length;
        length++;
      }
      at += escape.length;
    } else {
      decoded[length] = byte;
      starts[length] = at;
      ends[length] = at + 1;
      length++;
      at++;
    }
  }
  if (escapes === 0) {
    return undefined;
  }
  return {
    folded: folded(decoded.subarray(0, length)),
    starts: starts.subarray(0, length),
    ends: ends.subarray(0, length),
  };
}

// --- Needles ----------------------------------------------------------------

// The run of a value's base64 encoding that is the same wherever the value
// sits in a longer encoded stream, at the alignment where it starts `offset`
// bytes into a three-byte group. The characters before it mix in the bytes
// that precede the value, and the one after it the bytes that follow.
function base64Core(value: Buffer, offset: number): string {
  let encoded = Buffer.concat([Buffer.alloc(offset), value]).toString('base64');
  let from = Math.ceil((offset * 8) / 6);
  let to = Math.floor(((offset + value.length) * 8) / 6);
  return encoded.slice(from, to);
}

function hashOf(bytes: Uint8Array, start: number, length: number): number {
  let hash = 0;
  for (let i = start; i < start + length; i++) {
    hash = (Math.imul(hash, HASH_BASE) + bytes[i]) | 0;
  }
  return hash;
}

const FILTER_BITS = 20;
const FILTER_MASK = (1 << FILTER_BITS) - 1;

// The grams of one length that a match is made of: a bitmap over their
// hashes for the fast pass, and the grams themselves to confirm a hit.
interface Grams {
  length: number;
  filter: Uint8Array;
  strings: Set<string>;
  // HASH_BASE ** (length - 1), for rolling the hash forward.
  leadingPower: number;
}

// Matched ignoring ASCII case: needles and text are both folded to lower
// case before they are compared.
class NeedleSet {
  private byLength = new Map<number, Grams>();

  // A partial needle matches any run of it `MIN_PARTIAL_LENGTH` long; a whole
  // one only in full.
  add(needle: string, partial: boolean): void {
    let bytes = folded(Buffer.from(needle, 'latin1'));
    let length = partial
      ? Math.min(MIN_PARTIAL_LENGTH, bytes.length)
      : bytes.length;
    if (length === 0) {
      return;
    }
    let grams = this.byLength.get(length);
    if (!grams) {
      let leadingPower = 1;
      for (let i = 1; i < length; i++) {
        leadingPower = Math.imul(leadingPower, HASH_BASE);
      }
      grams = {
        length,
        filter: new Uint8Array((FILTER_MASK + 1) >> 3),
        strings: new Set(),
        leadingPower,
      };
      this.byLength.set(length, grams);
    }
    for (let start = 0; start + length <= bytes.length; start++) {
      grams.strings.add(latin1(bytes, start, start + length));
      let bit = hashOf(bytes, start, length) & FILTER_MASK;
      grams.filter[bit >> 3] |= 1 << (bit & 7);
    }
  }

  get maxGramLength(): number {
    let max = 0;
    for (let length of this.byLength.keys()) {
      max = Math.max(max, length);
    }
    return max;
  }

  // Adds to `ranges` the span of the original text behind every gram of
  // `view` that is one of ours.
  findIn(view: View, ranges: [number, number][]): void {
    let { folded: bytes, starts, ends } = view;
    for (let {
      length,
      filter,
      strings,
      leadingPower,
    } of this.byLength.values()) {
      if (bytes.length < length) continue;
      let hash = hashOf(bytes, 0, length);
      for (let start = 0; ; start++) {
        let bit = hash & FILTER_MASK;
        if (
          (filter[bit >> 3] & (1 << (bit & 7))) !== 0 &&
          strings.has(latin1(bytes, start, start + length))
        ) {
          let last = start + length - 1;
          ranges.push(
            starts && ends ? [starts[start], ends[last]] : [start, last + 1],
          );
        }
        if (start + length >= bytes.length) break;
        hash =
          (Math.imul(
            (hash - Math.imul(bytes[start], leadingPower)) | 0,
            HASH_BASE,
          ) +
            bytes[start + length]) |
          0;
      }
    }
  }
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  ranges.sort((a, b) => a[0] - b[0]);
  let merged: [number, number][] = [];
  for (let [start, end] of ranges) {
    let last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

// --- The scrubber -----------------------------------------------------------

const REDACTED_BYTES = Buffer.from(REDACTED, 'latin1');

export class CredentialScrubber {
  private needles = new NeedleSet();
  private heldBytes = new Set<number>();
  private registered = new Set<string>();

  constructor() {
    for (let byte of Buffer.from(ESCAPE_SYNTAX, 'latin1')) {
      this.heldBytes.add(byte);
    }
  }

  // Registers a credential value, or a transform of one, that went into the
  // request. Everything scrubbed afterwards has it removed in every form.
  //
  // Register the credential itself, not text wrapped around it such as
  // `Bearer <value>`: partial runs of the wrapper would match that text where
  // no credential is present.
  register(value: string): void {
    if (!value || this.registered.has(value)) {
      return;
    }
    this.registered.add(value);
    // The whole value, at any length, so a full echo is removed in full.
    this.addForms(value, false);
    let secret = value.slice(publicPrefix(value).length);
    if (secret.length >= MIN_PARTIAL_LENGTH) {
      // And every run of the secret part long enough to identify it.
      this.addForms(secret, true);
    }
  }

  private addForms(value: string, partial: boolean) {
    let bytes = Buffer.from(value, 'utf8');
    let text = bytes.toString('latin1');
    this.addNeedle(text, partial);
    if (text.includes(' ')) {
      // Form encoding writes a space as `+`.
      this.addNeedle(text.replace(/ /g, '+'), partial);
    }
    for (let offset = 0; offset < 3; offset++) {
      let core = base64Core(bytes, offset);
      if (core.length < MIN_BASE64_RUN_LENGTH) continue;
      this.addNeedle(core, partial);
      this.addNeedle(core.replace(/\+/g, '-').replace(/\//g, '_'), partial);
    }
  }

  get isEmpty(): boolean {
    return this.registered.size === 0;
  }

  // The most bytes a stream ever holds back at a chunk boundary.
  get holdbackBytes(): number {
    return (this.needles.maxGramLength + 1) * MAX_ESCAPE_LENGTH;
  }

  private addNeedle(text: string, partial: boolean) {
    this.needles.add(text, partial);
    for (let byte of Buffer.from(text, 'latin1')) {
      this.heldBytes.add(byte);
      this.heldBytes.add(fold(byte));
      if (byte >= 0x61 && byte <= 0x7a) this.heldBytes.add(byte - 0x20);
    }
  }

  private findRanges(bytes: Uint8Array): [number, number][] {
    let ranges: [number, number][] = [];
    let views = [rawView(bytes)];
    let decoded = mayContainEscapes(bytes) ? decodedView(bytes) : undefined;
    if (decoded) {
      views.push(decoded);
    }
    for (let view of views) {
      this.needles.findIn(view, ranges);
    }
    return mergeRanges(ranges);
  }

  // `bytes[from, to)` with every match replaced, as a list of slices.
  private redact(
    bytes: Uint8Array,
    ranges: [number, number][],
    from: number,
    to: number,
  ): Uint8Array[] {
    let parts: Uint8Array[] = [];
    let cursor = from;
    for (let [start, end] of ranges) {
      let clippedStart = Math.max(start, from);
      let clippedEnd = Math.min(end, to);
      if (clippedStart >= clippedEnd) continue;
      if (clippedStart > cursor)
        parts.push(bytes.subarray(cursor, clippedStart));
      // A match that began in what was already delivered continues the
      // marker delivered for it, so a split match reads as one.
      if (start >= from) {
        parts.push(REDACTED_BYTES);
      }
      cursor = clippedEnd;
    }
    if (cursor < to) parts.push(bytes.subarray(cursor, to));
    return parts;
  }

  scrubBytes(bytes: Uint8Array): Uint8Array {
    if (this.isEmpty) return bytes;
    let ranges = this.findRanges(bytes);
    if (ranges.length === 0) return bytes;
    return Buffer.concat(this.redact(bytes, ranges, 0, bytes.length));
  }

  scrubText(text: string): string {
    if (this.isEmpty) return text;
    let bytes = Buffer.from(text, 'utf8');
    let scrubbed = this.scrubBytes(bytes);
    return scrubbed === bytes ? text : Buffer.from(scrubbed).toString('utf8');
  }

  // A copy of `headers` with every value scrubbed.
  scrubHeaders(headers: Headers): Headers {
    let result = new Headers();
    for (let [name, value] of headers) {
      result.append(name, this.scrubText(value));
    }
    return result;
  }

  // Where a stream may release up to, given everything it holds: just past
  // the last byte that can't belong to a match, and never more than
  // `holdbackBytes` short of the end.
  private releasePoint(bytes: Uint8Array): number {
    let floor = Math.max(0, bytes.length - this.holdbackBytes);
    let point = bytes.length;
    while (point > floor && this.heldBytes.has(bytes[point - 1])) {
      point--;
    }
    return point;
  }

  scrubStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    if (this.isEmpty) return source;
    let reader = source.getReader();
    // Already delivered, kept so a match that began in it is still recognized
    // in what follows.
    let context: Uint8Array = new Uint8Array(0);
    // Read but not yet delivered.
    let pending: Uint8Array = new Uint8Array(0);
    let lookbehind = this.holdbackBytes;

    let release = (
      controller: ReadableStreamDefaultController<Uint8Array>,
      chunk: Uint8Array,
      final: boolean,
    ) => {
      let bytes = Buffer.concat([context, pending, chunk]);
      let base = context.length;
      let point = final
        ? bytes.length
        : Math.max(base, this.releasePoint(bytes));
      if (point > base) {
        let ranges = this.findRanges(bytes);
        let parts = this.redact(bytes, ranges, base, point);
        let out = parts.length === 1 ? parts[0] : Buffer.concat(parts);
        if (out.byteLength > 0) controller.enqueue(new Uint8Array(out));
      }
      context = bytes.subarray(Math.max(0, point - lookbehind), point);
      pending = bytes.subarray(point);
    };

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        // Keep reading until something can be delivered, so a consumer
        // waiting on `read()` never sees an empty pull.
        for (;;) {
          let result: ReadableStreamReadResult<Uint8Array>;
          try {
            result = await reader.read();
          } catch (error) {
            // Whatever is held is dropped, never flushed.
            pending = new Uint8Array(0);
            controller.error(error);
            return;
          }
          if (result.done) {
            release(controller, new Uint8Array(0), true);
            controller.close();
            return;
          }
          let before = controller.desiredSize;
          release(controller, result.value, false);
          if (controller.desiredSize !== before) {
            return;
          }
        }
      },
      async cancel(reason) {
        pending = new Uint8Array(0);
        await reader.cancel(reason);
      },
    });
  }
}
