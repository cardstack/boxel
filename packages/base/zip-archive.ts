// A minimal, allocation-bounded reader for a ZIP archive's central directory —
// enough to list what a `.zip` holds without decompressing a single entry.
//
// A ZIP's table of contents (the central directory) lives at the *end* of the
// file, pointed to by the End Of Central Directory record that is the very last
// thing in the archive. So rather than buffer a whole archive to list it, the
// extractor streams the file while retaining only a bounded tail window, then
// parses the directory out of that. A directory larger than the window yields a
// truncated (but honest) listing rather than an unbounded read.
//
// Nothing here inflates a compressed entry: an entry's declared sizes and path
// come straight out of its central-directory header.

import type { ByteStream } from './file-api';

// Signatures, little-endian, as they appear in the byte stream.
const EOCD_SIGNATURE = 0x0605_4b50;
const EOCD_MIN_SIZE = 22;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x0201_4b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x0706_4b50;
const ZIP64_EOCD_LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIGNATURE = 0x0606_4b50;
// General-purpose bit 11: the path and comment are UTF-8 rather than CP437.
const UTF8_NAME_FLAG = 0x0800;
// A 16-/32-bit field set to all ones defers to the ZIP64 extra/record.
const U16_SENTINEL = 0xffff;
const U32_SENTINEL = 0xffff_ffff;
const ZIP64_EXTRA_ID = 0x0001;

// Four megabytes of tail covers the EOCD plus a central directory for many
// thousands of entries, while bounding worst-case memory at extract time.
export const ZIP_MAX_TAIL_BYTES = 4 * 1024 * 1024;

export interface ZipEntry {
  // The archived path, always with forward slashes, e.g. `src/index.ts`.
  path: string;
  // Sizes as the header declares them. Uncompressed is what the file expands to;
  // compressed is the room it takes inside the archive.
  uncompressedSize: number;
  compressedSize: number;
  isDirectory: boolean;
  // The DOS-encoded modification time, as an ISO-8601 string, when the header
  // carried a usable one.
  modifiedAt?: string;
}

export interface ZipListing {
  // File entries only — the explicit directory markers a ZIP may carry are
  // dropped here, since the folder structure is recoverable from the paths.
  entries: ZipEntry[];
  // Whether the central directory ran past the tail window we read, making
  // `entries` a prefix of the real listing rather than the whole of it.
  truncated: boolean;
  // Total uncompressed and compressed bytes across the file entries.
  uncompressedSize: number;
  compressedSize: number;
}

// Read a file's trailing `n` bytes without buffering more than that (plus one
// chunk) at a time, and report the file's full length so absolute offsets in
// the directory can be mapped back into the window.
export async function readTailBytes(
  stream: ByteStream,
  n: number,
): Promise<{ bytes: Uint8Array; totalLength: number }> {
  if (stream instanceof Uint8Array) {
    let start = Math.max(0, stream.length - n);
    return { bytes: stream.subarray(start), totalLength: stream.length };
  }

  let reader = stream.getReader();
  let buffered: Uint8Array[] = [];
  let bufferedLength = 0;
  let totalLength = 0;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.length === 0) {
        continue;
      }
      totalLength += value.length;
      buffered.push(value);
      bufferedLength += value.length;
      // Drop whole leading chunks while doing so still leaves at least `n`
      // bytes behind, so memory stays near the window rather than the file.
      while (buffered.length > 1 && bufferedLength - buffered[0]!.length >= n) {
        bufferedLength -= buffered.shift()!.length;
      }
    }
  } finally {
    reader.releaseLock();
  }

  let merged = new Uint8Array(bufferedLength);
  let offset = 0;
  for (let chunk of buffered) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  let bytes = merged.length > n ? merged.subarray(merged.length - n) : merged;
  return { bytes, totalLength };
}

// Stream `stream` and return its listing, or `undefined` when the bytes carry
// no recognizable End Of Central Directory record (an empty or non-ZIP file).
export async function extractZipListing(
  stream: ByteStream,
): Promise<ZipListing | undefined> {
  let { bytes, totalLength } = await readTailBytes(stream, ZIP_MAX_TAIL_BYTES);
  return parseZipListing(bytes, totalLength);
}

// `tail` is the last `tail.length` bytes of a file whose full length is
// `totalLength`. Locate the central directory within that window and read out
// every entry header that fits.
export function parseZipListing(
  tail: Uint8Array,
  totalLength: number = tail.length,
): ZipListing | undefined {
  if (tail.length < EOCD_MIN_SIZE) {
    return undefined;
  }
  let view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let tailStart = totalLength - tail.length;

  let eocd = findEndOfCentralDirectory(view, tail.length);
  if (eocd === undefined) {
    return undefined;
  }

  let totalEntries = view.getUint16(eocd + 10, true);
  let centralDirectoryOffset = view.getUint32(eocd + 16, true);
  let usesZip64 =
    totalEntries === U16_SENTINEL ||
    centralDirectoryOffset === U32_SENTINEL ||
    view.getUint32(eocd + 12, true) === U32_SENTINEL;
  if (usesZip64) {
    let zip64 = readZip64Directory(view, eocd, tailStart);
    if (zip64) {
      totalEntries = zip64.totalEntries;
      centralDirectoryOffset = zip64.centralDirectoryOffset;
    }
  }

  // Where the directory begins relative to the window. A negative value means it
  // started before the bytes we retained, so we can only recover the tail of it.
  let directoryStartInTail = centralDirectoryOffset - tailStart;
  let truncated = false;
  let pos: number;
  if (directoryStartInTail >= 0 && directoryStartInTail <= tail.length) {
    pos = directoryStartInTail;
  } else {
    // Fall back to the first central-file-header signature in the window.
    let scanned = scanForCentralDirectory(view, tail.length);
    if (scanned === undefined) {
      return undefined;
    }
    pos = scanned;
    truncated = true;
  }

  let entries: ZipEntry[] = [];
  let uncompressedTotal = 0;
  let compressedTotal = 0;
  while (
    pos + 46 <= tail.length &&
    view.getUint32(pos, true) === CENTRAL_FILE_HEADER_SIGNATURE
  ) {
    let flags = view.getUint16(pos + 8, true);
    let modTime = view.getUint16(pos + 12, true);
    let modDate = view.getUint16(pos + 14, true);
    let compressedSize = view.getUint32(pos + 20, true);
    let uncompressedSize = view.getUint32(pos + 24, true);
    let nameLength = view.getUint16(pos + 28, true);
    let extraLength = view.getUint16(pos + 30, true);
    let commentLength = view.getUint16(pos + 32, true);

    let nameStart = pos + 46;
    let nameEnd = nameStart + nameLength;
    if (nameEnd > tail.length) {
      // The name spills past the window — stop rather than read a partial path.
      truncated = true;
      break;
    }
    let path = decodePath(
      tail.subarray(nameStart, nameEnd),
      (flags & UTF8_NAME_FLAG) !== 0,
    );

    let extraStart = nameEnd;
    let extraEnd = extraStart + extraLength;
    if (compressedSize === U32_SENTINEL || uncompressedSize === U32_SENTINEL) {
      let zip64 = readZip64ExtraSizes(
        view,
        extraStart,
        Math.min(extraEnd, tail.length),
        uncompressedSize === U32_SENTINEL,
        compressedSize === U32_SENTINEL,
      );
      if (zip64.uncompressedSize !== undefined) {
        uncompressedSize = zip64.uncompressedSize;
      }
      if (zip64.compressedSize !== undefined) {
        compressedSize = zip64.compressedSize;
      }
    }

    let isDirectory = path.endsWith('/');
    if (!isDirectory && path) {
      entries.push({
        path,
        uncompressedSize,
        compressedSize,
        isDirectory,
        ...(dosDateTimeToISO(modDate, modTime) ?? {}),
      });
      uncompressedTotal += uncompressedSize;
      compressedTotal += compressedSize;
    }

    pos = extraEnd + commentLength;
  }

  if (totalEntries !== U16_SENTINEL && entries.length < totalEntries) {
    // We read fewer records than the archive declared, either because the
    // directory outran the window or a header was clipped. Mark it, but only
    // when the shortfall isn't just the dropped directory markers.
    let seenAll =
      pos + 4 <= tail.length &&
      view.getUint32(pos, true) !== CENTRAL_FILE_HEADER_SIGNATURE;
    if (!seenAll) {
      truncated = true;
    }
  }

  return {
    entries,
    truncated,
    uncompressedSize: uncompressedTotal,
    compressedSize: compressedTotal,
  };
}

// Scan back from the end for the EOCD signature, preferring the record whose
// declared comment length lands its end exactly at the file's end — a ZIP
// comment can itself contain the signature bytes, and that check disambiguates.
function findEndOfCentralDirectory(
  view: DataView,
  length: number,
): number | undefined {
  let fallback: number | undefined;
  for (let i = length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) !== EOCD_SIGNATURE) {
      continue;
    }
    let commentLength = view.getUint16(i + 20, true);
    if (i + EOCD_MIN_SIZE + commentLength === length) {
      return i;
    }
    fallback ??= i;
  }
  return fallback;
}

function scanForCentralDirectory(
  view: DataView,
  length: number,
): number | undefined {
  for (let i = 0; i + 4 <= length; i++) {
    if (view.getUint32(i, true) === CENTRAL_FILE_HEADER_SIGNATURE) {
      return i;
    }
  }
  return undefined;
}

// Read the ZIP64 End Of Central Directory record when the EOCD's fields were
// the all-ones sentinel. Returns undefined when its locator or record fell
// outside the retained window.
function readZip64Directory(
  view: DataView,
  eocd: number,
  tailStart: number,
): { totalEntries: number; centralDirectoryOffset: number } | undefined {
  let locator = eocd - ZIP64_EOCD_LOCATOR_SIZE;
  if (
    locator < 0 ||
    view.getUint32(locator, true) !== ZIP64_EOCD_LOCATOR_SIGNATURE
  ) {
    return undefined;
  }
  let recordOffset = readUint64(view, locator + 8);
  let recordInTail = recordOffset - tailStart;
  if (
    recordInTail < 0 ||
    recordInTail + 56 > view.byteLength ||
    view.getUint32(recordInTail, true) !== ZIP64_EOCD_SIGNATURE
  ) {
    return undefined;
  }
  return {
    totalEntries: readUint64(view, recordInTail + 32),
    centralDirectoryOffset: readUint64(view, recordInTail + 48),
  };
}

// Pull the 64-bit sizes out of an entry's ZIP64 extra field. The extra block is
// a sequence of (id, size, payload) records; the payload for id 0x0001 carries
// the uncompressed size first, then the compressed size, each present only when
// its 32-bit field was the sentinel.
function readZip64ExtraSizes(
  view: DataView,
  start: number,
  end: number,
  wantUncompressed: boolean,
  wantCompressed: boolean,
): { uncompressedSize?: number; compressedSize?: number } {
  let pos = start;
  while (pos + 4 <= end) {
    let id = view.getUint16(pos, true);
    let size = view.getUint16(pos + 2, true);
    let payload = pos + 4;
    if (id === ZIP64_EXTRA_ID && payload + size <= end) {
      let cursor = payload;
      let result: { uncompressedSize?: number; compressedSize?: number } = {};
      if (wantUncompressed && cursor + 8 <= payload + size) {
        result.uncompressedSize = readUint64(view, cursor);
        cursor += 8;
      }
      if (wantCompressed && cursor + 8 <= payload + size) {
        result.compressedSize = readUint64(view, cursor);
      }
      return result;
    }
    pos = payload + size;
  }
  return {};
}

// JavaScript numbers hold integers exactly to 2^53, well past any real archive.
function readUint64(view: DataView, offset: number): number {
  let low = view.getUint32(offset, true);
  let high = view.getUint32(offset + 4, true);
  return high * 0x1_0000_0000 + low;
}

// One decoder reused across every entry: a large archive's central directory
// can hold thousands of headers, and allocating a `TextDecoder` per name is
// measurable overhead for no benefit.
const PATH_DECODER = new TextDecoder('utf-8');

function decodePath(bytes: Uint8Array, _isUtf8: boolean): string {
  // A non-fatal UTF-8 decode handles the common (and flagged-UTF-8) case and
  // degrades legacy CP437 names to replacement characters rather than throwing.
  return PATH_DECODER.decode(bytes);
}

function dosDateTimeToISO(
  date: number,
  time: number,
): { modifiedAt: string } | undefined {
  if (date === 0) {
    return undefined;
  }
  let day = date & 0x1f;
  let month = (date >> 5) & 0x0f;
  let year = ((date >> 9) & 0x7f) + 1980;
  let second = (time & 0x1f) * 2;
  let minute = (time >> 5) & 0x3f;
  let hour = (time >> 11) & 0x1f;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  // DOS timestamps are local time with no zone; anchor to UTC so the same
  // archive reads identically wherever it is indexed.
  let ms = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(ms)) {
    return undefined;
  }
  return { modifiedAt: new Date(ms).toISOString() };
}
