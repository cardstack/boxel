// How much of a text file's bytes a file type keeps as its `content`.
//
// `content` travels in the file's index row twice over: in the search doc
// and in the file meta every reader of the file loads, and it is re-written
// on every edit. The verbatim file is always served from the realm, so a
// type keeps at most this many bytes: the file's first whole lines that fit.
// 1 MiB holds every real source and document file well past its size (the
// largest in the monorepo are under 300 KB) while bounding a generated or
// pasted giant; past it, a filter on `content` (an `eq`, a `contains`) reads
// only those first lines. Full-text `matches` reads a file's rendered text,
// which is built from `content` and was already capped at 400,000 characters
// (`markdown_search_text`), so the cap changes nothing it finds.
// See docs/search.md ("What a file's `content` holds") for the numbers.
export const FILE_CONTENT_MAX_BYTES = 1024 * 1024;

const NEWLINE = 0x0a;

// The text of `bytes`, cut to its first whole lines within `maxBytes`. A cut
// at a line break never splits a UTF-8 character; a first line longer than
// the cap (minified source) is cut at the last character boundary instead.
export function headOfText(
  bytes: Uint8Array,
  maxBytes: number | undefined = FILE_CONTENT_MAX_BYTES,
): { text: string; truncated: boolean } {
  if (maxBytes === undefined || bytes.byteLength <= maxBytes) {
    return { text: new TextDecoder().decode(bytes), truncated: false };
  }
  let end = bytes.lastIndexOf(NEWLINE, maxBytes - 1);
  if (end >= 0) {
    end += 1;
  } else {
    // No line break within the cap: back off over UTF-8 continuation bytes
    // (10xxxxxx) to the start of the character the cap falls in.
    end = maxBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }
  }
  return {
    text: new TextDecoder().decode(bytes.subarray(0, end)),
    truncated: true,
  };
}

// The first `maxRows` data rows of a CSV after its header, as whole lines,
// and never more than `maxBytes`. A quoted value may hold a line break, so
// rows are counted outside quotes. A CSV keeps only its head as `content`:
// the table is read from the file, and the head is what a preview shows.
export function headOfCsv(
  bytes: Uint8Array,
  maxRows: number,
  maxBytes: number | undefined = FILE_CONTENT_MAX_BYTES,
): { text: string; truncated: boolean } {
  let limit = Math.min(bytes.byteLength, maxBytes ?? Infinity);
  let rows = -1; // the header is not a data row
  let quoted = false;
  for (let i = 0; i < limit; i++) {
    let b = bytes[i];
    if (b === 0x22) {
      quoted = !quoted;
    } else if (b === NEWLINE && !quoted) {
      rows++;
      if (rows === maxRows) {
        let end = i + 1;
        return {
          text: new TextDecoder().decode(bytes.subarray(0, end)),
          truncated: end < bytes.byteLength,
        };
      }
    }
  }
  if (maxBytes === undefined || bytes.byteLength <= maxBytes) {
    return { text: new TextDecoder().decode(bytes), truncated: false };
  }
  return headOfText(bytes, maxBytes);
}
