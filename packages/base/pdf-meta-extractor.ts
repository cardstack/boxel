import { FileContentMismatchError } from './file-api';

// The document facts the shells surface for a PDF: how long it is, what it calls
// itself, and who made it. Every field is optional — a PDF need not carry an
// Info dictionary, and an encrypted one hides its strings — so a family declares
// what it could read and the shells degrade to identity-only for the rest.
export interface DocumentInfo {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  // The authoring application (Info `/Creator`).
  creator?: string;
  // The library that wrote the PDF (Info `/Producer`).
  producer?: string;
  pageCount?: number;
  // The `%PDF-x.y` header version.
  pdfVersion?: string;
  // Info `/CreationDate`, normalized to an ISO-8601 string when it parses.
  created?: string;
  // Whether the document declares an `/Encrypt` dictionary. Its strings are then
  // ciphertext, so the name fields are left unread rather than filled with
  // garbage.
  encrypted?: boolean;
}

// A PDF's structural objects (the page tree and the Info dictionary) may sit in
// the file as plain text, or — in a modern cross-reference-stream PDF — packed
// inside FlateDecode-compressed object streams. Reading metadata therefore means
// searching the raw bytes *and* the inflated object streams. Content streams
// (the actual page drawing) are never inflated: they are large, and hold none of
// the facts here.
const OBJSTM_INFLATE_BUDGET = 16 * 1024 * 1024;

// Latin-1 maps every byte to the code point of the same value, so a decoded
// string indexes 1:1 with the byte offsets — which lets the stream scanner slice
// the original bytes by a position it found in the string.
function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

// Inflate a zlib stream (PDF FlateDecode is RFC 1950). Returns undefined when no
// decompressor is available or the bytes won't inflate, so one bad stream never
// fails the whole read.
async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof DecompressionStream === 'undefined') {
    return undefined;
  }
  try {
    let stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

// The searchable text of a PDF: its raw bytes as Latin-1, plus the inflated
// contents of every FlateDecode object stream, up to a budget. Cross-reference
// streams are skipped — they hold byte offsets, not the dictionaries this reads —
// and so are content streams, which are large and irrelevant here.
async function buildCorpus(bytes: Uint8Array): Promise<string> {
  let raw = latin1(bytes);
  let parts = [raw];
  let inflated = 0;
  let marker = /stream\r?\n|stream\r/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw)) && inflated < OBJSTM_INFLATE_BUDGET) {
    // `endstream` also ends in "stream"; skip those matches so the scanner keys
    // off real stream openings only.
    if (raw.slice(match.index - 3, match.index) === 'end') {
      continue;
    }
    let dictStart = raw.lastIndexOf('<<', match.index);
    if (dictStart < 0) {
      continue;
    }
    let dict = raw.slice(dictStart, match.index);
    // Only object streams carry the catalog/pages/Info objects; everything else
    // is either a cross-reference stream or page content.
    if (!dict.includes('/ObjStm') || !dict.includes('/FlateDecode')) {
      continue;
    }
    let start = match.index + match[0].length;
    let endstreamAt = raw.indexOf('endstream', start);
    if (endstreamAt < 0) {
      continue;
    }
    // Slice exactly the compressed bytes: `DecompressionStream` rejects the EOL
    // that sits between the data and `endstream` as trailing junk (unlike a
    // tolerant zlib inflate). A direct `/Length` gives the exact end; otherwise
    // trim the trailing CR/LF before `endstream`.
    let lengthMatch = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
    let end = lengthMatch
      ? Math.min(start + Number(lengthMatch[1]), endstreamAt)
      : endstreamAt;
    while (
      end > start &&
      (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)
    ) {
      end--;
    }
    let decoded = await inflateZlib(bytes.subarray(start, end));
    if (decoded) {
      inflated += decoded.byteLength;
      parts.push(latin1(decoded));
    }
  }
  return parts.join('\n');
}

// The page count is the number of leaf page objects (`/Type /Page`, not
// `/Pages`). When none are legible — an unusual structure, or object streams we
// couldn't inflate — fall back to the largest `/Count`, which on the page-tree
// root is the whole-document total.
function readPageCount(corpus: string): number | undefined {
  let leaves = corpus.match(/\/Type\s*\/Page(?![A-Za-z])/g);
  if (leaves && leaves.length > 0) {
    return leaves.length;
  }
  let counts = [...corpus.matchAll(/\/Count\s+(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  return counts.length > 0 ? Math.max(...counts) : undefined;
}

// Decode a UTF-16BE byte run (the encoding a PDF text string uses when it opens
// with a BE byte-order mark).
function decodeUtf16be(bytes: number[]): string {
  let buffer = new Uint8Array(bytes);
  try {
    return new TextDecoder('utf-16be').decode(buffer);
  } catch {
    return '';
  }
}

// Turn a run of Latin-1 code units into the string it encodes: UTF-16BE when it
// opens with a 0xFE 0xFF mark, otherwise PDFDocEncoding, which Latin-1 already
// approximates for the characters that appear in names and titles.
function decodePdfString(codeUnits: number[]): string {
  if (codeUnits[0] === 0xfe && codeUnits[1] === 0xff) {
    return decodeUtf16be(codeUnits.slice(2));
  }
  return codeUnits.map((c) => String.fromCharCode(c)).join('');
}

// Read the value of a named entry (`/Title …`) as either a literal `(...)`
// string — honoring escapes and balanced parens — or a hex `<...>` string.
// Returns undefined when the key is absent or isn't followed by a string.
function readNamedString(corpus: string, key: string): string | undefined {
  let at = corpus.indexOf(`/${key}`);
  if (at < 0) {
    return undefined;
  }
  let i = at + key.length + 1;
  while (i < corpus.length && /\s/.test(corpus[i]!)) {
    i++;
  }
  if (corpus[i] === '(') {
    let depth = 1;
    let units: number[] = [];
    i++;
    for (; i < corpus.length; i++) {
      let ch = corpus[i]!;
      if (ch === '\\') {
        let next = corpus[i + 1]!;
        let octal = corpus.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
        if (octal) {
          units.push(parseInt(octal[0], 8) & 0xff);
          i += octal[0].length;
          continue;
        }
        let escapes: Record<string, number> = {
          n: 0x0a,
          r: 0x0d,
          t: 0x09,
          b: 0x08,
          f: 0x0c,
        };
        units.push(escapes[next] ?? next.charCodeAt(0));
        i++;
        continue;
      }
      if (ch === '(') {
        depth++;
        units.push(0x28);
        continue;
      }
      if (ch === ')') {
        depth--;
        if (depth === 0) {
          break;
        }
        units.push(0x29);
        continue;
      }
      units.push(ch.charCodeAt(0) & 0xff);
    }
    let value = decodePdfString(units).trim();
    return value || undefined;
  }
  if (corpus[i] === '<' && corpus[i + 1] !== '<') {
    let close = corpus.indexOf('>', i);
    if (close < 0) {
      return undefined;
    }
    let hex = corpus.slice(i + 1, close).replace(/\s+/g, '');
    if (hex.length % 2 === 1) {
      hex += '0';
    }
    let units: number[] = [];
    for (let h = 0; h < hex.length; h += 2) {
      units.push(parseInt(hex.slice(h, h + 2), 16));
    }
    let value = decodePdfString(units).trim();
    return value || undefined;
  }
  return undefined;
}

// A PDF date is `D:YYYYMMDDHHmmSS` followed by an optional timezone
// (`Z`, or `+HH'mm'`). Normalize to ISO-8601 when the year is legible; leave the
// raw string otherwise, since a half-parsed date is worse than the original.
function parsePdfDate(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  let match = raw.match(
    /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([+-Z])?(\d{2})?'?(\d{2})?/,
  );
  if (!match) {
    return raw;
  }
  let [, year, month, day, hour, minute, second, tzSign, tzHour, tzMinute] =
    match;
  let date = `${year}-${month ?? '01'}-${day ?? '01'}`;
  let time = `${hour ?? '00'}:${minute ?? '00'}:${second ?? '00'}`;
  let zone =
    tzSign === 'Z' || !tzSign
      ? 'Z'
      : `${tzSign}${tzHour ?? '00'}:${tzMinute ?? '00'}`;
  return `${date}T${time}${zone}`;
}

function pruneUndefined(info: DocumentInfo): DocumentInfo {
  let out: DocumentInfo = {};
  for (let [key, value] of Object.entries(info)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

// Read whatever document identity a PDF makes legible. Throws
// `FileContentMismatchError` only when the bytes aren't a PDF; a PDF with no Info
// dictionary, or an encrypted one, yields a partial result rather than an error,
// because the page viewer renders from the same bytes regardless.
export async function extractPdfMetadata(
  bytes: Uint8Array,
): Promise<DocumentInfo> {
  // The PDF header sits within the first 1024 bytes. Require `%PDF-` followed by
  // a version digit so a text file that merely mentions the string isn't taken
  // for a PDF; the minor version is optional (a minimal PDF may write `%PDF-1.`).
  let head = latin1(bytes.subarray(0, 1024));
  if (!/%PDF-\d/.test(head)) {
    throw new FileContentMismatchError('File does not have a PDF header');
  }
  let versionMatch = head.match(/%PDF-(\d+(?:\.\d+)?)/);

  let corpus = await buildCorpus(bytes);
  let encrypted = /\/Encrypt\b/.test(corpus);

  // An encrypted document's strings are ciphertext, so read only the facts that
  // don't come from the (encrypted) Info dictionary.
  let names = encrypted
    ? {}
    : {
        title: readNamedString(corpus, 'Title'),
        author: readNamedString(corpus, 'Author'),
        subject: readNamedString(corpus, 'Subject'),
        keywords: readNamedString(corpus, 'Keywords'),
        creator: readNamedString(corpus, 'Creator'),
        producer: readNamedString(corpus, 'Producer'),
        created: parsePdfDate(readNamedString(corpus, 'CreationDate')),
      };

  return pruneUndefined({
    ...names,
    pageCount: readPageCount(corpus),
    pdfVersion: versionMatch?.[1],
    encrypted: encrypted ? true : undefined,
  });
}
