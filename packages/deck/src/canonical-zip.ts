import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

// canonical-zip-v1: the deterministic zip form every faithful pack uses.
// Constants (ruled 2026-08-07): entries sorted by path in UTF-8 byte order
// with the packlist first; UTF-8 names, forward slashes; all timestamps at
// the zip epoch (1980-01-01); external attributes zeroed; deflate level 9
// via Node's bundled zlib (the pinned reference deflate for v1); no zip64.
// A constants change is a NEW spec version (canonical-zip-v2 falls back to
// STORE if cross-implementation deflate determinism ever proves fragile) —
// the spec name travels in the packlist and in derived-artifact build keys.
//
// The writer emits ONLY this form. The reader accepts general zips (store +
// deflate, data descriptors tolerated, central directory is the truth) so
// legacy v0.2 cardpacks and foreign zips can still be opened — but
// byte-identical repack (round-trip law 2) is promised only for canonical
// input.

export const CANONICAL_ZIP_SPEC = 'canonical-zip-v1';

// Safety caps (normative; the esm.sh extraction checklist): reject rather
// than truncate.
export const MAX_ENTRIES = 10_000;
export const MAX_FILE_SIZE = 64 * 1024 * 1024; // per uncompressed file
export const MAX_TOTAL_SIZE = 512 * 1024 * 1024; // sum of uncompressed sizes

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION = 20; // 2.0 — deflate
const UTF8_FLAG = 0x0800;
// DOS date for 1980-01-01, time 00:00:00.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export interface ZipEntryInput {
  path: string; // validated by callers against tree-path rules
  bytes: Buffer;
}

export interface ZipEntry {
  path: string;
  bytes: Buffer;
}

function crc(buffer: Buffer): number {
  // node:zlib crc32 returns an unsigned 32-bit number
  return crc32(buffer) >>> 0;
}

// Entries are written in the order given — callers establish canonical
// order (packlist first, then tree paths in UTF-8 byte order).
export function writeCanonicalZip(entries: readonly ZipEntryInput[]): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`too many entries: ${entries.length} > ${MAX_ENTRIES}`);
  }
  let localParts: Buffer[] = [];
  let centralParts: Buffer[] = [];
  let offset = 0;
  let totalSize = 0;
  for (let { path, bytes } of entries) {
    if (bytes.length > MAX_FILE_SIZE) {
      throw new Error(`file too large: ${path} (${bytes.length} bytes)`);
    }
    totalSize += bytes.length;
    if (totalSize > MAX_TOTAL_SIZE) {
      throw new Error(`pack too large: exceeds ${MAX_TOTAL_SIZE} bytes`);
    }
    let name = Buffer.from(path, 'utf8');
    let checksum = crc(bytes);
    let compressed = deflateRawSync(bytes, { level: 9 });
    let local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, name, compressed);

    let central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(VERSION, 4); // version made by (DOS host)
    central.writeUInt16LE(VERSION, 6); // version needed
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs (zeroed by spec)
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }
  let centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  if (offset + centralSize + 22 > 0xffffffff) {
    throw new Error('pack exceeds zip32 limits');
  }
  let eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // no comment
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

interface CentralRecord {
  path: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localOffset: number;
}

function readCentralDirectory(zip: Buffer): CentralRecord[] {
  // Find EOCD: scan back from the end (tolerate up to 64KB of comment).
  let scanFloor = Math.max(0, zip.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let i = zip.length - 22; i >= scanFloor; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('not a zip: no end-of-central-directory record');
  }
  let count = zip.readUInt16LE(eocdOffset + 10);
  let centralOffset = zip.readUInt32LE(eocdOffset + 16);
  if (count > MAX_ENTRIES) {
    throw new Error(`too many entries: ${count} > ${MAX_ENTRIES}`);
  }
  let records: CentralRecord[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== CENTRAL_SIG) {
      throw new Error('corrupt central directory');
    }
    let method = zip.readUInt16LE(cursor + 10);
    let crcValue = zip.readUInt32LE(cursor + 16);
    let compressedSize = zip.readUInt32LE(cursor + 20);
    let uncompressedSize = zip.readUInt32LE(cursor + 24);
    let nameLength = zip.readUInt16LE(cursor + 28);
    let extraLength = zip.readUInt16LE(cursor + 30);
    let commentLength = zip.readUInt16LE(cursor + 32);
    let localOffset = zip.readUInt32LE(cursor + 42);
    let path = zip
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8');
    records.push({
      path,
      method,
      compressedSize,
      uncompressedSize,
      crc32: crcValue,
      localOffset,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return records;
}

function readEntryBytes(zip: Buffer, record: CentralRecord): Buffer {
  let { localOffset } = record;
  if (
    localOffset + 30 > zip.length ||
    zip.readUInt32LE(localOffset) !== LOCAL_SIG
  ) {
    throw new Error(`corrupt local header for ${record.path}`);
  }
  // Local name/extra lengths can differ from central — trust local for the
  // data offset, central for sizes (data-descriptor zips zero local sizes).
  let nameLength = zip.readUInt16LE(localOffset + 26);
  let extraLength = zip.readUInt16LE(localOffset + 28);
  let dataStart = localOffset + 30 + nameLength + extraLength;
  let data = zip.subarray(dataStart, dataStart + record.compressedSize);
  let bytes: Buffer;
  if (record.method === 0) {
    bytes = Buffer.from(data);
  } else if (record.method === 8) {
    bytes = inflateRawSync(data, { maxOutputLength: MAX_FILE_SIZE });
  } else {
    throw new Error(
      `unsupported compression method ${record.method} for ${record.path}`,
    );
  }
  if (bytes.length !== record.uncompressedSize) {
    throw new Error(`size mismatch for ${record.path}`);
  }
  if (crc(bytes) !== record.crc32 >>> 0) {
    throw new Error(`crc mismatch for ${record.path}`);
  }
  return bytes;
}

// Reads every file entry, in central-directory order. Directory entries
// (trailing '/') are skipped. Total-size cap enforced.
export function readZip(zip: Buffer): ZipEntry[] {
  let records = readCentralDirectory(zip);
  let entries: ZipEntry[] = [];
  let total = 0;
  for (let record of records) {
    if (record.path.endsWith('/')) {
      continue; // directory entry
    }
    if (record.uncompressedSize > MAX_FILE_SIZE) {
      throw new Error(`file too large: ${record.path}`);
    }
    total += record.uncompressedSize;
    if (total > MAX_TOTAL_SIZE) {
      throw new Error(`archive too large: exceeds ${MAX_TOTAL_SIZE} bytes`);
    }
    entries.push({ path: record.path, bytes: readEntryBytes(zip, record) });
  }
  return entries;
}

// Random access without reading every entry: returns one file's bytes, or
// undefined. This is the primitive `!/` mount serving builds on.
export function readZipEntry(zip: Buffer, path: string): Buffer | undefined {
  let records = readCentralDirectory(zip);
  let record = records.find((r) => r.path === path);
  if (!record || record.path.endsWith('/')) {
    return undefined;
  }
  if (record.uncompressedSize > MAX_FILE_SIZE) {
    throw new Error(`file too large: ${record.path}`);
  }
  return readEntryBytes(zip, record);
}

export function listZipPaths(zip: Buffer): string[] {
  return readCentralDirectory(zip)
    .filter((r) => !r.path.endsWith('/'))
    .map((r) => r.path);
}
