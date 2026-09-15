import { rri } from '../realm-identifiers.ts';
import type { CodeRef } from '../code-ref.ts';
import type { SpliceEdit } from '../spliced-content.ts';

// ============================================================================
// Finding where in a stored card's JSON an append writes.
//
// A card instance is one JSON file, and appending to a `containsMany` field
// changes three small places in it: the end of the field's array under
// `data.attributes`, the end of `data.relationships`, and — for an item whose
// concrete type differs from the declared one — the end of a sidecar under
// `data.meta.fields`. Everything else in the file is unchanged.
//
// The file is never parsed and never re-serialized. It is scanned once as a
// byte stream for the offsets of those places, and the change is described
// against them as a `SplicedSource` (see `spliced-content.ts`), so the cost of
// adding one item is the cost of one item whatever the array already holds.
//
// The bytes this produces are the bytes a load-modify-`JSON.stringify(…, 2)`
// round trip would have produced, which is what lets the general-purpose write
// path and this one write the same file. That rests on reusing the file's own
// whitespace rather than assuming any: the indentation an insertion writes is
// the indentation found next to the members it goes beside.
// ============================================================================

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

// A JSON container found in the scanned bytes, with the offsets an insertion
// into it needs.
export interface StoredContainer {
  kind: 'object' | 'array';
  // The offset of the opening `{` / `[`, and of the matching closer.
  openAt: number;
  closeAt: number;
  // How many members the container holds.
  count: number;
  // The offset just past the last member's last byte, absent when the
  // container is empty. This is where a comma and a new member go.
  lastMemberEnd?: number;
  // The whitespace separating the opening bracket from the first member, and
  // the last member from the closing bracket. Reused verbatim so an insertion
  // is indented the way the file already indents this container's members;
  // absent when the container is empty and has neither.
  memberIndent?: string;
  closeIndent?: string;
  // How deeply the container itself is nested, with the document's outermost
  // value at zero. What an empty container's indentation is synthesized from,
  // since it carries none of its own.
  depth: number;
}

// Where in a stored card's JSON an append writes.
//
// Every member is optional because a stored card need not carry it: a card
// with no links has no `relationships`, a card whose items are all of their
// declared type has no `meta.fields`, and a field that has never held a value
// may have no array. An insertion that finds one absent creates it.
export interface CardSourceLayout {
  data?: StoredContainer;
  attributes?: StoredContainer;
  relationships?: StoredContainer;
  meta?: StoredContainer;
  metaFields?: StoredContainer;
  // `data.attributes.<field>` for each field the scan was asked about, when
  // the stored value is an array.
  arrays: Map<string, StoredContainer>;
  // `data.meta.fields.<field>` for each of those fields, when the stored
  // sidecar is an array — the spelling a composite `containsMany` records its
  // items' types under.
  sidecars: Map<string, StoredContainer>;
  // The member names `data.attributes` and `data.meta.fields` carry. A field
  // whose name is here but whose container is not above holds something other
  // than an array, which is the one case an insertion has to tell apart from
  // the field being absent — creating the member a second time would leave the
  // file carrying the name twice.
  attributeKeys: Set<string>;
  metaFieldKeys: Set<string>;
  // The type the card adopts, read out of `data.meta.adoptsFrom` as the scan
  // passes it. A card names its type in its own bytes, and an append needs the
  // type's definition to know which of an item's members are links — so the
  // two string members of that ref are collected here rather than the file
  // being parsed for them. Absent when the stored card spells its type some
  // other way, which is a card this behavior cannot split an item for.
  adoptsFrom?: CodeRef;
}

export class MalformedCardSourceError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} (at byte ${offset})`);
    this.name = 'MalformedCardSourceError';
    this.offset = offset;
  }
}

// The containers whose members the layout names. A child's path is built only
// under one of these, so a card with a hundred thousand relationship keys
// costs no string per key — and neither does the array those keys belong to,
// whose members have no key at all.
const TRACKED_PARENTS = new Set([
  '',
  'data',
  'data.attributes',
  'data.meta',
  'data.meta.fields',
  'data.meta.adoptsFrom',
]);

// The string values the scan keeps, by path. Everything else's bytes pass
// through uncollected, which is what keeps a hundred-thousand-item array as
// cheap to scan as any other span of the file.
const CAPTURED_STRINGS = new Set([
  'data.meta.adoptsFrom.module',
  'data.meta.adoptsFrom.name',
]);

// A whitespace run longer than this is not indentation, so it is not reused as
// any. The synthesized two-space indentation takes over, which changes how the
// insertion looks and nothing about what it means.
const MAX_REUSED_INDENT_BYTES = 1024;

// The offsets an append needs, read out of a byte stream in one pass.
//
// Deliberately not a JSON parser: it recognizes structure — strings, numbers,
// literals, and the two containers — well enough to know where every value
// begins and ends, and it keeps only what the layout above records. A value's
// bytes are never collected, so the array this is called to find the end of
// costs the same as any other span of the file.
//
// Keys are decoded, since finding `attributes` means reading the key next to
// it, but only under the containers the layout reaches. Anywhere else a key is
// skipped like any other string.
export async function scanCardSource(
  chunks: AsyncIterable<Uint8Array>,
  fields: readonly string[],
): Promise<CardSourceLayout> {
  let watched = new Set(fields);
  let layout: CardSourceLayout = {
    arrays: new Map(),
    sidecars: new Map(),
    attributeKeys: new Set(),
    metaFieldKeys: new Set(),
  };

  interface Frame {
    kind: 'object' | 'array';
    openAt: number;
    depth: number;
    count: number;
    lastMemberEnd?: number;
    memberIndent?: string;
    closeIndent?: string;
    // The dotted path this container sits at, when it is one the layout could
    // name or could hold something the layout names.
    path?: string;
  }

  let stack: Frame[] = [];
  // Frames come from here and go back when their container closes. An array of
  // a hundred thousand items opens and closes a frame per member, so minting
  // one each time would leave a frame per item behind for the collector; the
  // pool holds at most one per level of nesting.
  let pool: Frame[] = [];
  let offset = 0;
  // Bytes seen since the last structural byte, kept only while they are all
  // whitespace and short enough to be indentation.
  let whitespace: number[] = [];
  let whitespaceOverflowed = false;
  // Whether the string being read is an object key rather than a value, and
  // its bytes when the key is one worth decoding.
  let inKey = false;
  let keyBytes: number[] | undefined;
  // The container the key being read belongs to, for the two whose member
  // names the layout reports.
  let keyOwner: string | undefined;
  let pendingKey: string | undefined;
  // The path the string value being read sits at, when it is one the layout
  // keeps, and the bytes collected for it.
  let capturePath: string | undefined;
  let captureBytes: number[] | undefined;
  let captured = new Map<string, string>();
  // Whether the next string at this level is a key.
  let expectKey = false;
  // Whether the document's outermost value has closed, which is how a file
  // that ends mid-document is told from one that ends.
  let rootClosed = false;

  type Mode =
    | 'value'
    | 'string'
    | 'string-escape'
    | 'string-unicode'
    | 'number'
    | 'literal';
  let mode: Mode = 'value';
  let unicodeRemaining = 0;

  let top = () => stack[stack.length - 1];

  // An empty run is not an absent one: a file written without whitespace
  // separates its members with nothing, and an insertion into it has to do the
  // same. Only a run too long to be indentation is reported as unknown.
  let takeWhitespace = (): string | undefined =>
    whitespaceOverflowed
      ? undefined
      : decoder.decode(new Uint8Array(whitespace));

  // Emptied in place rather than replaced. This runs at every structural byte
  // of the document, so allocating here would put one short-lived array per
  // byte between a large card and the garbage collector.
  let resetWhitespace = () => {
    whitespace.length = 0;
    whitespaceOverflowed = false;
  };

  // Only for a container the layout will report. Decoding a whitespace run
  // allocates, and a container the layout does not name has its indentation
  // discarded — so an array of a hundred thousand items would otherwise decode
  // one run per item to throw each away.
  let noteMemberIndent = () => {
    let parent = top();
    if (
      parent &&
      parent.path !== undefined &&
      parent.count === 0 &&
      parent.memberIndent === undefined
    ) {
      parent.memberIndent = takeWhitespace();
    }
  };

  // A value ended at `end`: tell its parent where, and how many it now holds.
  let closeValue = (end: number) => {
    let parent = top();
    if (parent) {
      parent.count++;
      parent.lastMemberEnd = end;
      return;
    }
    rootClosed = true;
  };

  let childPath = (
    parent: Frame | undefined,
    key: string,
  ): string | undefined =>
    parent?.path !== undefined && TRACKED_PARENTS.has(parent.path)
      ? parent.path === ''
        ? key
        : `${parent.path}.${key}`
      : undefined;

  let record = (frame: Frame, closeAt: number) => {
    if (frame.path === undefined || frame.path === '') {
      return;
    }
    let container: StoredContainer = {
      kind: frame.kind,
      openAt: frame.openAt,
      closeAt,
      count: frame.count,
      depth: frame.depth,
      ...(frame.lastMemberEnd === undefined
        ? {}
        : { lastMemberEnd: frame.lastMemberEnd }),
      ...(frame.memberIndent === undefined
        ? {}
        : { memberIndent: frame.memberIndent }),
      ...(frame.closeIndent === undefined
        ? {}
        : { closeIndent: frame.closeIndent }),
    };
    switch (frame.path) {
      case 'data':
        layout.data = container;
        return;
      case 'data.attributes':
        layout.attributes = container;
        return;
      case 'data.relationships':
        layout.relationships = container;
        return;
      case 'data.meta':
        layout.meta = container;
        return;
      case 'data.meta.fields':
        layout.metaFields = container;
        return;
      default:
        break;
    }
    if (frame.kind !== 'array') {
      return;
    }
    let field = suffixUnder(frame.path, 'data.attributes.');
    if (field !== undefined && watched.has(field)) {
      layout.arrays.set(field, container);
      return;
    }
    field = suffixUnder(frame.path, 'data.meta.fields.');
    if (field !== undefined && watched.has(field)) {
      layout.sidecars.set(field, container);
    }
  };

  for await (let chunk of chunks) {
    for (let i = 0; i < chunk.length; i++, offset++) {
      let byte = chunk[i];
      switch (mode) {
        case 'string':
          if (byte === 0x5c /* \ */) {
            keyBytes?.push(byte);
            captureBytes?.push(byte);
            mode = 'string-escape';
            continue;
          }
          if (byte === 0x22 /* " */) {
            mode = 'value';
            if (inKey) {
              if (keyBytes) {
                pendingKey = decodeJsonString(keyBytes, offset);
                keyBytes = undefined;
                if (keyOwner === 'data.attributes') {
                  layout.attributeKeys.add(pendingKey);
                } else if (keyOwner === 'data.meta.fields') {
                  layout.metaFieldKeys.add(pendingKey);
                }
              }
              inKey = false;
            } else {
              if (captureBytes && capturePath !== undefined) {
                captured.set(
                  capturePath,
                  decodeJsonString(captureBytes, offset),
                );
              }
              captureBytes = undefined;
              capturePath = undefined;
              closeValue(offset + 1);
            }
            continue;
          }
          keyBytes?.push(byte);
          captureBytes?.push(byte);
          continue;
        case 'string-escape':
          keyBytes?.push(byte);
          captureBytes?.push(byte);
          mode = byte === 0x75 /* u */ ? 'string-unicode' : 'string';
          unicodeRemaining = 4;
          continue;
        case 'string-unicode':
          keyBytes?.push(byte);
          captureBytes?.push(byte);
          if (--unicodeRemaining === 0) {
            mode = 'string';
          }
          continue;
        case 'number':
        case 'literal':
          if (continuesUnquotedValue(byte, mode)) {
            continue;
          }
          mode = 'value';
          closeValue(offset);
          break;
        case 'value':
          break;
      }

      if (isWhitespace(byte)) {
        if (whitespace.length >= MAX_REUSED_INDENT_BYTES) {
          whitespaceOverflowed = true;
        } else {
          whitespace.push(byte);
        }
        continue;
      }

      switch (byte) {
        case 0x7b /* { */:
        case 0x5b /* [ */: {
          let kind: 'object' | 'array' = byte === 0x7b ? 'object' : 'array';
          let parent = top();
          noteMemberIndent();
          let frame = pool.pop() ?? ({} as Frame);
          frame.kind = kind;
          frame.openAt = offset;
          frame.depth = stack.length;
          frame.count = 0;
          frame.lastMemberEnd = undefined;
          frame.memberIndent = undefined;
          frame.closeIndent = undefined;
          frame.path =
            parent === undefined
              ? ''
              : pendingKey === undefined
                ? undefined
                : childPath(parent, pendingKey);
          stack.push(frame);
          pendingKey = undefined;
          expectKey = kind === 'object';
          resetWhitespace();
          continue;
        }
        case 0x7d /* } */:
        case 0x5d /* ] */: {
          let frame = stack.pop();
          if (!frame) {
            throw new MalformedCardSourceError(
              `a closing bracket with nothing open`,
              offset,
            );
          }
          if (frame.path !== undefined && frame.count > 0) {
            frame.closeIndent = takeWhitespace();
          }
          record(frame, offset);
          pool.push(frame);
          resetWhitespace();
          closeValue(offset + 1);
          expectKey = top()?.kind === 'object';
          continue;
        }
        case 0x22 /* " */: {
          let parent = top();
          if (expectKey && parent?.kind === 'object') {
            noteMemberIndent();
            inKey = true;
            // Decoded only under a container the layout names, so a card with
            // a hundred thousand relationship keys decodes none of them.
            keyBytes =
              parent.path !== undefined && TRACKED_PARENTS.has(parent.path)
                ? []
                : undefined;
            keyOwner = parent.path;
            pendingKey = undefined;
          } else {
            noteMemberIndent();
            let path =
              pendingKey === undefined
                ? undefined
                : childPath(parent, pendingKey);
            if (path !== undefined && CAPTURED_STRINGS.has(path)) {
              capturePath = path;
              captureBytes = [];
            }
          }
          mode = 'string';
          resetWhitespace();
          continue;
        }
        case 0x3a /* : */:
          expectKey = false;
          resetWhitespace();
          continue;
        case 0x2c /* , */:
          expectKey = top()?.kind === 'object';
          pendingKey = undefined;
          resetWhitespace();
          continue;
        default:
          break;
      }

      noteMemberIndent();
      mode = isNumberStart(byte) ? 'number' : 'literal';
      resetWhitespace();
    }
  }
  if (mode === 'number' || mode === 'literal') {
    closeValue(offset);
    mode = 'value';
  }
  if (stack.length > 0) {
    throw new MalformedCardSourceError(
      `the document ends with ${stack.length} container(s) still open`,
      offset,
    );
  }
  if (mode !== 'value' || inKey || !rootClosed) {
    throw new MalformedCardSourceError(`the document ends mid-value`, offset);
  }
  let module = captured.get('data.meta.adoptsFrom.module');
  let name = captured.get('data.meta.adoptsFrom.name');
  if (module !== undefined && name !== undefined) {
    layout.adoptsFrom = { module: rri(module), name };
  }
  return layout;
}

function suffixUnder(path: string, prefix: string): string | undefined {
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function isNumberStart(byte: number): boolean {
  return byte === 0x2d /* - */ || (byte >= 0x30 && byte <= 0x39);
}

// Whether a byte continues the unquoted value being read. Neither alphabet
// overlaps anything a JSON document may put after such a value — whitespace, a
// comma, or a closing bracket — so the first byte outside it ends the value.
function continuesUnquotedValue(
  byte: number,
  mode: 'number' | 'literal',
): boolean {
  if (mode === 'literal') {
    return byte >= 0x61 /* a */ && byte <= 0x7a /* z */;
  }
  return (
    (byte >= 0x30 && byte <= 0x39) ||
    byte === 0x2b /* + */ ||
    byte === 0x2d /* - */ ||
    byte === 0x2e /* . */ ||
    byte === 0x65 /* e */ ||
    byte === 0x45 /* E */
  );
}

// A JSON string's own text, from the bytes between its quotes. Only the
// escapes JSON defines; anything else in an escape position is a malformed
// document, which is the realm's own file to answer for.
function decodeJsonString(bytes: number[], offset: number): string {
  let out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x5c /* \ */) {
      out.push(bytes[i]);
      continue;
    }
    i++;
    switch (bytes[i]) {
      case 0x22:
        out.push(0x22);
        break;
      case 0x5c:
        out.push(0x5c);
        break;
      case 0x2f:
        out.push(0x2f);
        break;
      case 0x62:
        out.push(0x08);
        break;
      case 0x66:
        out.push(0x0c);
        break;
      case 0x6e:
        out.push(0x0a);
        break;
      case 0x72:
        out.push(0x0d);
        break;
      case 0x74:
        out.push(0x09);
        break;
      case 0x75: {
        let code = hexEscapeAt(bytes, i + 1, offset);
        i += 4;
        // A character outside the basic plane is spelled as two escapes, and
        // each half is meaningless alone — encoding them separately yields two
        // replacement characters rather than the character they name. So a
        // high surrogate takes its partner with it.
        if (
          code >= 0xd800 &&
          code <= 0xdbff &&
          bytes[i + 1] === 0x5c /* \ */ &&
          bytes[i + 2] === 0x75 /* u */
        ) {
          let low = hexEscapeAt(bytes, i + 3, offset);
          if (low >= 0xdc00 && low <= 0xdfff) {
            pushUtf8(out, String.fromCharCode(code, low));
            i += 6;
            break;
          }
        }
        pushUtf8(out, String.fromCharCode(code));
        break;
      }
      default:
        throw new MalformedCardSourceError(
          `a key carries an escape JSON does not define`,
          offset,
        );
    }
  }
  return decoder.decode(new Uint8Array(out));
}

function hexEscapeAt(bytes: number[], at: number, offset: number): number {
  let digits = String.fromCharCode(...bytes.slice(at, at + 4));
  if (!/^[0-9a-fA-F]{4}$/.test(digits)) {
    throw new MalformedCardSourceError(
      `a key carries an invalid \\u escape`,
      offset,
    );
  }
  return parseInt(digits, 16);
}

function pushUtf8(out: number[], text: string): void {
  for (let byte of encoder.encode(text)) {
    out.push(byte);
  }
}

// ---------------------------------------------------------------------------
// Describing an insertion
// ---------------------------------------------------------------------------

// How a file separates one member of a container from the next: the line break
// between them, and how much deeper each level of nesting is indented than the
// one above it. A file written without whitespace reports both as empty, which
// is what makes an insertion into such a file compact rather than pretty.
export interface IndentStyle {
  newline: string;
  unit: string;
}

// The two-space indentation `JSON.stringify(…, null, 2)` writes, which is what
// the realm's own card writes produce.
const DEFAULT_INDENT_STYLE: IndentStyle = { newline: '\n', unit: '  ' };

// The style a stored file is written in, read off its outermost container.
//
// `data` is the reference because every card document has it and it always
// holds members, so it carries both of the runs the style is derived from: the
// indentation of its members and the indentation of its closing brace differ
// by exactly one level, which is the unit. A container nested anywhere under it
// can then be indented correctly whether or not it holds anything of its own.
export function indentStyleOf(layout: CardSourceLayout): IndentStyle {
  let { memberIndent, closeIndent } = layout.data ?? {};
  if (memberIndent === undefined || closeIndent === undefined) {
    return DEFAULT_INDENT_STYLE;
  }
  if (memberIndent === '' && closeIndent === '') {
    return { newline: '', unit: '' };
  }
  return {
    newline: '\n',
    unit: memberIndent.startsWith(closeIndent)
      ? memberIndent.slice(closeIndent.length)
      : DEFAULT_INDENT_STYLE.unit,
  };
}

// The indentation an insertion into a container is written with: where its
// members sit, where its closing bracket sits, and how much deeper one nesting
// level is than the last.
//
// All three are read off the container where it has them, so an insertion is
// indented the way the file already indents — including inside a new member,
// whose own nested lines step by the file's unit rather than by an assumed
// one. A container holding nothing carries none of this, so it is indented
// from its depth and the document's own style instead.
export function indentsFor(
  container: StoredContainer,
  style: IndentStyle = DEFAULT_INDENT_STYLE,
): {
  member: string;
  close: string;
  unit: string;
} {
  let member =
    container.memberIndent ??
    `${style.newline}${style.unit.repeat(container.depth + 1)}`;
  let close =
    container.closeIndent ??
    `${style.newline}${style.unit.repeat(container.depth)}`;
  return {
    member,
    close,
    unit:
      member.length > close.length && member.startsWith(close)
        ? member.slice(close.length)
        : style.unit,
  };
}

// Add members to a container that is already in the file, as one insertion.
//
// A container that holds something is extended after its last member, so the
// text begins with the comma joining it to what is there. An empty one is
// filled instead: the text spans from just inside the opening bracket to just
// before the closing one. Either way it is a single edit at a single offset
// rather than a pair that have to be reasoned about together.
export function appendMembers(
  container: StoredContainer,
  members: string[],
  style?: IndentStyle,
): SpliceEdit | undefined {
  if (members.length === 0) {
    return undefined;
  }
  let { member: memberIndent, close: closeIndent } = indentsFor(
    container,
    style,
  );
  let joined = members.join(`,${memberIndent}`);
  return container.count > 0
    ? { at: container.lastMemberEnd!, text: `,${memberIndent}${joined}` }
    : { at: container.closeAt, text: `${memberIndent}${joined}${closeIndent}` };
}

// A JSON value as `JSON.stringify` would write it, sitting at `indent` and
// stepping by `unit` for each level inside it. Only the value handed in is
// serialized; nothing read from the stored file passes through here.
export function renderValue(
  value: unknown,
  { member, unit }: { member: string; unit: string },
): string {
  let text = JSON.stringify(value, null, unit) ?? 'null';
  return text.split('\n').join(member);
}

// An object member — `"key": value` — written the same way.
//
// The space after the colon goes with the rest of the whitespace: a file
// written without any separates a key from its value with nothing, and
// `JSON.stringify` does the same when given no indentation. So the separator
// follows the unit rather than being fixed.
export function renderMember(
  key: string,
  value: unknown,
  indents: { member: string; unit: string },
): string {
  let separator = indents.unit === '' ? ':' : ': ';
  return `${JSON.stringify(key)}${separator}${renderValue(value, indents)}`;
}
