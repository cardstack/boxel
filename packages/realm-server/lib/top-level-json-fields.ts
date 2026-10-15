// Reads chosen members of a JSON document's top-level object from the
// document's bytes as they stream past, without holding the document.
//
// Only the bytes of a chosen member's value are kept, up to
// `maxValueBytes`; everything else is looked at once and dropped. A proxy uses
// this to take the billing fields (`id`, `usage`) out of a response body that
// can run to megabytes while forwarding it unchanged.
//
// The scan works on raw bytes. Every byte JSON gives structural meaning to
// (`{ } [ ] " \ , :` and whitespace) is ASCII, and no byte of a multi-byte
// UTF-8 sequence falls in the ASCII range, so no decoding is needed until a
// chosen value is complete.
//
// The scan checks structure, not grammar: brackets must balance, strings must
// close, and nothing but whitespace may follow the top-level value. A chosen
// value is handed to `JSON.parse` when it completes, so a malformed one is
// reported as missing rather than returned half-read. As with `JSON.parse`,
// when a member appears more than once the last one wins.

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;

// Longer than any member name worth looking for. A longer name is read past
// without being kept.
const MAX_KEY_BYTES = 256;

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

export class TopLevelJsonFieldScanner {
  #wanted: Set<string>;
  #maxValueBytes: number;
  #decoder = new TextDecoder();

  // Open containers, innermost last, as their opening byte.
  #stack: number[] = [];
  #started = false;
  #ended = false;
  #inString = false;
  #escaped = false;
  #error: string | undefined;

  // Member-name tracking, at the top level of an object only.
  #expectingKey = false;
  #readingKey = false;
  #keyParts: Uint8Array[] = [];
  #keyLength = 0;
  #lastKey: string | undefined;

  // The chosen member whose value is being kept, if any.
  #capturing:
    | { key: string; parts: Uint8Array[]; length: number; overflow: boolean }
    | undefined;
  #values = new Map<string, unknown>();

  constructor(wanted: string[], { maxValueBytes }: { maxValueBytes: number }) {
    this.#wanted = new Set(wanted);
    this.#maxValueBytes = maxValueBytes;
  }

  // Why the bytes so far cannot be a JSON document, if they cannot.
  get error(): string | undefined {
    return this.#error;
  }

  // Whether a complete top-level value has been read.
  get complete(): boolean {
    return this.#ended && !this.#error;
  }

  // The chosen members found so far, by name. A member whose value was
  // malformed or longer than `maxValueBytes` is absent.
  get values(): ReadonlyMap<string, unknown> {
    return this.#values;
  }

  // Marks the document as ended. Reports an error if the bytes stopped short
  // of a complete value.
  finish(): void {
    if (!this.#error && !this.#ended) {
      this.#fail(
        this.#started ? 'the document ends inside a value' : 'empty document',
      );
    }
  }

  feed(chunk: Uint8Array): void {
    let i = 0;
    let length = chunk.length;
    // Where the kept value's bytes start in this chunk, while one is kept.
    let captureFrom = this.#capturing ? 0 : -1;
    let keyFrom = this.#readingKey ? 0 : -1;

    while (i < length && !this.#error) {
      if (this.#inString) {
        if (this.#escaped) {
          this.#escaped = false;
          i++;
          continue;
        }
        let quote = chunk.indexOf(QUOTE, i);
        if (quote === -1) {
          this.#escaped = trailingBackslashes(chunk, i, length) % 2 === 1;
          i = length;
          break;
        }
        if (trailingBackslashes(chunk, i, quote) % 2 === 1) {
          // An escaped quote: still inside the string.
          i = quote + 1;
          continue;
        }
        this.#inString = false;
        if (this.#readingKey) {
          this.#appendKey(chunk.subarray(keyFrom, quote));
          this.#readingKey = false;
          keyFrom = -1;
          this.#lastKey =
            this.#keyLength <= MAX_KEY_BYTES
              ? this.#decoder.decode(concat(this.#keyParts, this.#keyLength))
              : undefined;
          this.#keyParts = [];
          this.#keyLength = 0;
        }
        i = quote + 1;
        continue;
      }

      let byte = chunk[i];
      if (isWhitespace(byte)) {
        i++;
        continue;
      }
      if (this.#ended) {
        this.#fail('content after the end of the document');
        break;
      }
      let depth = this.#stack.length;
      let inTopObject = depth === 1 && this.#stack[0] === OPEN_BRACE;

      switch (byte) {
        case QUOTE:
          this.#inString = true;
          if (inTopObject && this.#expectingKey) {
            this.#readingKey = true;
            this.#expectingKey = false;
            keyFrom = i + 1;
          }
          this.#started = true;
          break;
        case OPEN_BRACE:
        case OPEN_BRACKET:
          this.#stack.push(byte);
          if (depth === 0) {
            this.#started = true;
            this.#expectingKey = byte === OPEN_BRACE;
          }
          break;
        case CLOSE_BRACE:
        case CLOSE_BRACKET: {
          let open = this.#stack[depth - 1];
          let matches =
            (byte === CLOSE_BRACE && open === OPEN_BRACE) ||
            (byte === CLOSE_BRACKET && open === OPEN_BRACKET);
          if (!matches) {
            this.#fail('a closing bracket does not match its opening one');
            break;
          }
          if (inTopObject && captureFrom !== -1) {
            this.#endCapture(chunk.subarray(captureFrom, i));
            captureFrom = -1;
          }
          this.#stack.pop();
          if (this.#stack.length === 0) {
            this.#ended = true;
          }
          break;
        }
        case COLON:
          if (inTopObject && this.#lastKey !== undefined) {
            if (this.#wanted.has(this.#lastKey)) {
              this.#capturing = {
                key: this.#lastKey,
                parts: [],
                length: 0,
                overflow: false,
              };
              captureFrom = i + 1;
            }
            this.#lastKey = undefined;
          }
          break;
        case COMMA:
          if (inTopObject) {
            if (captureFrom !== -1) {
              this.#endCapture(chunk.subarray(captureFrom, i));
              captureFrom = -1;
            }
            this.#expectingKey = true;
          }
          break;
        default:
          if (depth === 0) {
            // A bare literal or number at the top level carries no members,
            // and is not what a proxy reads billing fields from.
            this.#fail('the document is not an object or array');
          }
      }
      i++;
    }

    if (this.#error) {
      this.#capturing = undefined;
      return;
    }
    if (captureFrom !== -1 && this.#capturing) {
      this.#appendCapture(chunk.subarray(captureFrom, length));
    }
    if (keyFrom !== -1 && this.#readingKey) {
      this.#appendKey(chunk.subarray(keyFrom, length));
    }
  }

  #fail(reason: string) {
    this.#error = reason;
  }

  #appendKey(bytes: Uint8Array) {
    this.#keyLength += bytes.length;
    if (this.#keyLength <= MAX_KEY_BYTES && bytes.length > 0) {
      this.#keyParts.push(bytes.slice());
    }
  }

  #appendCapture(bytes: Uint8Array) {
    let capture = this.#capturing!;
    if (capture.overflow) {
      return;
    }
    capture.length += bytes.length;
    if (capture.length > this.#maxValueBytes) {
      capture.overflow = true;
      capture.parts = [];
      return;
    }
    if (bytes.length > 0) {
      // Copied, since the chunk it came from is handed on and may be reused.
      capture.parts.push(bytes.slice());
    }
  }

  #endCapture(bytes: Uint8Array) {
    this.#appendCapture(bytes);
    let capture = this.#capturing!;
    this.#capturing = undefined;
    if (capture.overflow) {
      this.#values.delete(capture.key);
      return;
    }
    try {
      this.#values.set(
        capture.key,
        JSON.parse(this.#decoder.decode(concat(capture.parts, capture.length))),
      );
    } catch {
      this.#values.delete(capture.key);
    }
  }
}

// How many backslashes immediately precede `end`, counting back no further
// than `start`.
function trailingBackslashes(
  chunk: Uint8Array,
  start: number,
  end: number,
): number {
  let count = 0;
  for (let j = end - 1; j >= start && chunk[j] === BACKSLASH; j--) {
    count++;
  }
  return count;
}

function concat(parts: Uint8Array[], length: number): Uint8Array {
  if (parts.length === 1) {
    return parts[0];
  }
  let out = new Uint8Array(length);
  let offset = 0;
  for (let part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
