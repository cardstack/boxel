import { FileContentMismatchError } from './file-api';

// Facts read from a font file's own tables. Every field is optional: a family
// declares what it could parse, and the shells degrade to identity-only for a
// font whose tables couldn't be read (see FontMetadataField / file-view-model).
export interface FontMetadata {
  // Name-table identity. `familyName`/`subfamilyName` prefer the typographic
  // (WWS/preferred) names when present so a "Bold Italic" reads as one family
  // rather than four, falling back to the legacy family/style pair.
  familyName?: string;
  subfamilyName?: string;
  fullName?: string;
  postscriptName?: string;
  versionName?: string;
  // Name-table manufacturer (ID 8). The OS/2 vendor tag is the coarser
  // four-character fallback a consumer shows when this is absent.
  foundry?: string;
  vendorId?: string;
  // OS/2 usWeightClass (100–900) and a label derived from usWidthClass, the
  // latter only when it isn't the normal width.
  weightClass?: number;
  widthName?: string;
  // maxp numGlyphs.
  glyphCount?: number;
  // head unitsPerEm — the coordinate grid the outlines are drawn on.
  unitsPerEm?: number;
  // Which outline technology the file carries: 'TrueType' (`glyf`) or
  // 'PostScript/CFF' (`CFF `/`CFF2`).
  outlineType?: string;
  // Whether the face defines variation axes (`fvar`).
  isVariable?: boolean;
  isItalic?: boolean;
  isBold?: boolean;
  // Variation axes as short labels, e.g. `Weight (wght) 100–900`.
  axes?: string[];
}

// Container magic. sfnt covers bare TrueType/OpenType; WOFF and WOFF2 wrap an
// sfnt for the web. `ttcf` is a TrueType collection — several faces in one file
// — which this header pass reports as a font but does not walk into.
const SFNT_TRUETYPE = 0x00010000;
const SFNT_TRUE = 0x74727565; // 'true'
const SFNT_TYP1 = 0x74797031; // 'typ1'
const SFNT_OTTO = 0x4f54544f; // 'OTTO'
const SFNT_TTCF = 0x74746366; // 'ttcf'
const WOFF_SIGNATURE = 0x774f4646; // 'wOFF'
const WOFF2_SIGNATURE = 0x774f4632; // 'wOF2'

function asciiTag(view: DataView, offset: number): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

// Fixed-length name and tag fields (an OS/2 vendor tag, a padded name record)
// pad with trailing spaces or NULs. Trim both ends by code point rather than
// with a regex, so a legitimate trailing accented letter in a UTF-16 name
// survives while the C0 padding does not.
function trimPadding(value: string): string {
  let start = 0;
  let end = value.length;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) {
    end--;
  }
  while (start < end && value.charCodeAt(start) <= 0x20) {
    start++;
  }
  return value.slice(start, end);
}

// A face's tables, abstracted over the three containers so the metadata readers
// don't care whether the bytes arrived bare, deflate-wrapped (WOFF), or
// Brotli-wrapped (WOFF2). `flavor` is the sfnt version, which alone names the
// outline technology when no outline table is legible.
interface TableSource {
  flavor: number;
  container: 'sfnt' | 'woff' | 'woff2';
  hasTable(tag: string): boolean;
  // Resolves to the decompressed table bytes, or undefined when the table is
  // absent or its bytes can't be produced in this environment (a WOFF2 table,
  // which is Brotli-compressed with no browser-native decoder).
  getTable(tag: string): Promise<Uint8Array | undefined>;
}

interface SfntTableEntry {
  offset: number;
  compLength: number;
  origLength: number;
}

// Inflate a zlib stream (WOFF per-table compression is RFC 1950). Returns
// undefined when no decompressor is available rather than throwing, so a WOFF
// still yields whatever tables happened to be stored uncompressed.
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

function sfntTableSource(bytes: Uint8Array, headerOffset = 0): TableSource {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let flavor = view.getUint32(headerOffset);
  let numTables = view.getUint16(headerOffset + 4);
  let directory = headerOffset + 12;
  let tables = new Map<string, SfntTableEntry>();
  for (let i = 0; i < numTables; i++) {
    let record = directory + i * 16;
    if (record + 16 > bytes.byteLength) {
      break;
    }
    let tag = asciiTag(view, record);
    let offset = view.getUint32(record + 8);
    let length = view.getUint32(record + 12);
    tables.set(tag, { offset, compLength: length, origLength: length });
  }
  return {
    flavor,
    container: 'sfnt',
    hasTable: (tag) => tables.has(tag),
    getTable: async (tag) => {
      let entry = tables.get(tag);
      if (!entry) {
        return undefined;
      }
      let end = entry.offset + entry.origLength;
      if (entry.offset > bytes.byteLength || end > bytes.byteLength) {
        return undefined;
      }
      return bytes.subarray(entry.offset, end);
    },
  };
}

// WOFF header is 44 bytes; the table directory is 20-byte records. A table whose
// compressed length equals its original length is stored raw; otherwise it is
// zlib-compressed and inflated on demand.
function woffTableSource(bytes: Uint8Array): TableSource {
  // The 44-byte header carries the fields read below (flavor at 4, numTables at
  // 12); a stream that starts `wOFF` but is shorter is truncated, and reading
  // past its end would throw a RangeError that fails the whole extract. Reject
  // it as a content mismatch instead, which degrades to the plain FileDef.
  if (bytes.byteLength < 44) {
    throw new FileContentMismatchError('WOFF header is truncated');
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let flavor = view.getUint32(4);
  let numTables = view.getUint16(12);
  let directory = 44;
  let tables = new Map<string, SfntTableEntry>();
  for (let i = 0; i < numTables; i++) {
    let record = directory + i * 20;
    if (record + 20 > bytes.byteLength) {
      break;
    }
    let tag = asciiTag(view, record);
    tables.set(tag, {
      offset: view.getUint32(record + 4),
      compLength: view.getUint32(record + 8),
      origLength: view.getUint32(record + 12),
    });
  }
  return {
    flavor,
    container: 'woff',
    hasTable: (tag) => tables.has(tag),
    getTable: async (tag) => {
      let entry = tables.get(tag);
      if (!entry) {
        return undefined;
      }
      let end = entry.offset + entry.compLength;
      if (entry.offset > bytes.byteLength || end > bytes.byteLength) {
        return undefined;
      }
      let slice = bytes.subarray(entry.offset, end);
      if (entry.compLength >= entry.origLength) {
        return slice;
      }
      return inflateZlib(slice);
    },
  };
}

// WOFF2 stores every table as one Brotli stream, which no browser exposes a
// decoder for, so the table directory is unreadable here. Only the header's
// flavor is legible — enough to name the outline technology and confirm the
// file is a font. Everything the name/OS-2/maxp readers want lives inside the
// compressed block and comes back undefined.
function woff2TableSource(bytes: Uint8Array): TableSource {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let flavor = view.getUint32(4);
  return {
    flavor,
    container: 'woff2',
    hasTable: () => false,
    getTable: async () => undefined,
  };
}

// A TrueType Collection packs several faces behind a `ttcf` header, which is not
// an sfnt table directory — its bytes after the tag are a version and a face
// count, not `numTables` and table records. As the container comment says, this
// pass reports a collection as a font (the flavor names it) but does not walk
// into a face, so it exposes no tables rather than misreading the TTC header as
// one.
function collectionTableSource(bytes: Uint8Array): TableSource {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    flavor: view.getUint32(0),
    container: 'sfnt',
    hasTable: () => false,
    getTable: async () => undefined,
  };
}

function tableSourceFor(bytes: Uint8Array): TableSource {
  if (bytes.byteLength < 12) {
    throw new FileContentMismatchError('File is too small to be a font');
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let signature = view.getUint32(0);
  switch (signature) {
    case WOFF_SIGNATURE:
      return woffTableSource(bytes);
    case WOFF2_SIGNATURE:
      return woff2TableSource(bytes);
    case SFNT_TTCF:
      return collectionTableSource(bytes);
    case SFNT_TRUETYPE:
    case SFNT_TRUE:
    case SFNT_TYP1:
    case SFNT_OTTO:
      return sfntTableSource(bytes);
    default:
      throw new FileContentMismatchError(
        'File does not have a recognized font signature',
      );
  }
}

// Name IDs the specimen surfaces. The typographic pair (16/17) supersedes the
// legacy family/style pair (1/2) when a face declares it.
const NAME_FAMILY = 1;
const NAME_SUBFAMILY = 2;
const NAME_FULL = 4;
const NAME_VERSION = 5;
const NAME_POSTSCRIPT = 6;
const NAME_MANUFACTURER = 8;
const NAME_TYPO_FAMILY = 16;
const NAME_TYPO_SUBFAMILY = 17;

// How well a name record's platform/language matches what we want to display.
// Higher wins. Windows-English is the canonical specimen string; a Windows
// record in another language beats a Mac one; anything legible beats nothing.
function nameRecordScore(platformID: number, languageID: number): number {
  if (platformID === 3) {
    return languageID === 0x0409 ? 4 : 3;
  }
  if (platformID === 1) {
    return languageID === 0 ? 2 : 1;
  }
  return 0;
}

function decodeNameString(
  bytes: Uint8Array,
  platformID: number,
  encodingID: number,
): string {
  // Windows (3) and Unicode (0) records are UTF-16BE. Mac (1) Roman is ASCII
  // for the names that matter here, so Latin-1 decodes it without a Mac-Roman
  // table.
  let utf16 =
    platformID === 0 ||
    platformID === 3 ||
    (platformID === 1 && encodingID !== 0);
  try {
    return trimPadding(
      new TextDecoder(utf16 ? 'utf-16be' : 'latin1').decode(bytes),
    );
  } catch {
    return '';
  }
}

interface NameEntry {
  score: number;
  value: string;
}

// Read the name table into best-scoring strings per name ID.
function parseNameTable(table: Uint8Array): Map<number, string> {
  let out = new Map<number, string>();
  if (table.byteLength < 6) {
    return out;
  }
  let view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let count = view.getUint16(2);
  let storageOffset = view.getUint16(4);
  let best = new Map<number, NameEntry>();
  for (let i = 0; i < count; i++) {
    let record = 6 + i * 12;
    if (record + 12 > table.byteLength) {
      break;
    }
    let platformID = view.getUint16(record);
    let encodingID = view.getUint16(record + 2);
    let languageID = view.getUint16(record + 4);
    let nameID = view.getUint16(record + 6);
    let length = view.getUint16(record + 8);
    let offset = view.getUint16(record + 10);
    let start = storageOffset + offset;
    if (start + length > table.byteLength) {
      continue;
    }
    let score = nameRecordScore(platformID, languageID);
    let current = best.get(nameID);
    if (current && current.score >= score) {
      continue;
    }
    let value = decodeNameString(
      table.subarray(start, start + length),
      platformID,
      encodingID,
    );
    if (value) {
      best.set(nameID, { score, value });
    }
  }
  for (let [nameID, entry] of best) {
    out.set(nameID, entry.value);
  }
  return out;
}

// usWidthClass 1–9. 5 is normal and adds nothing worth a row, so it's omitted.
const WIDTH_NAMES: Record<number, string> = {
  1: 'Ultra-condensed',
  2: 'Extra-condensed',
  3: 'Condensed',
  4: 'Semi-condensed',
  6: 'Semi-expanded',
  7: 'Expanded',
  8: 'Extra-expanded',
  9: 'Ultra-expanded',
};

// OS/2 field offsets. achVendID and fsSelection sit past the fixed-size PANOSE
// and Unicode-range block, so their positions are the same across every table
// version this reads.
function parseOs2Table(table: Uint8Array): {
  weightClass?: number;
  widthName?: string;
  vendorId?: string;
  fsSelection?: number;
} {
  if (table.byteLength < 64) {
    return {};
  }
  let view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let weightClass = view.getUint16(4);
  let widthClass = view.getUint16(6);
  let vendorId = trimPadding(asciiTag(view, 58));
  let fsSelection = view.getUint16(62);
  return {
    weightClass: weightClass > 0 ? weightClass : undefined,
    widthName: WIDTH_NAMES[widthClass],
    vendorId: vendorId || undefined,
    fsSelection,
  };
}

const AXIS_LABELS: Record<string, string> = {
  wght: 'Weight',
  wdth: 'Width',
  ital: 'Italic',
  slnt: 'Slant',
  opsz: 'Optical size',
};

// A Fixed (16.16) coordinate, rounded — axis ranges are whole numbers in
// practice and the fractional noise only clutters the label.
function fixedToNumber(view: DataView, offset: number): number {
  return Math.round(view.getInt32(offset) / 65536);
}

// fvar variation axes as display labels. Absent for a static font (no `fvar`).
function parseFvarAxes(table: Uint8Array): string[] {
  if (table.byteLength < 16) {
    return [];
  }
  let view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let axesOffset = view.getUint16(4);
  let axisCount = view.getUint16(8);
  let axisSize = view.getUint16(10);
  let axes: string[] = [];
  for (let i = 0; i < axisCount; i++) {
    let record = axesOffset + i * axisSize;
    if (record + 20 > table.byteLength) {
      break;
    }
    let tag = asciiTag(view, record);
    let min = fixedToNumber(view, record + 4);
    let max = fixedToNumber(view, record + 12);
    let label = AXIS_LABELS[tag] ?? tag;
    axes.push(`${label} (${tag}) ${min}–${max}`);
  }
  return axes;
}

// glyf/CFF presence names the outline technology outright; the sfnt flavor is
// the fallback when neither table is legible (e.g. a WOFF2, or a truncated
// header read).
function outlineTypeFor(source: TableSource): string | undefined {
  if (source.hasTable('CFF ') || source.hasTable('CFF2')) {
    return 'PostScript/CFF';
  }
  if (source.hasTable('glyf')) {
    return 'TrueType';
  }
  if (source.flavor === SFNT_OTTO) {
    return 'PostScript/CFF';
  }
  if (
    source.flavor === SFNT_TRUETYPE ||
    source.flavor === SFNT_TRUE ||
    source.flavor === SFNT_TTCF
  ) {
    return 'TrueType';
  }
  return undefined;
}

function pruneUndefined(metadata: FontMetadata): FontMetadata {
  let out: FontMetadata = {};
  for (let [key, value] of Object.entries(metadata)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

// Read whatever font identity the container makes legible. Throws
// `FileContentMismatchError` only when the bytes aren't a font at all; a font
// whose individual tables are missing or (for WOFF2) compressed away yields a
// partial result rather than an error, because the live specimen still renders
// from the same bytes regardless of what the tables said.
export async function extractFontMetadata(
  bytes: Uint8Array,
): Promise<FontMetadata> {
  let source = tableSourceFor(bytes);

  let [nameTable, os2Table, headTable, maxpTable, fvarTable] =
    await Promise.all([
      source.getTable('name'),
      source.getTable('OS/2'),
      source.getTable('head'),
      source.getTable('maxp'),
      source.getTable('fvar'),
    ]);

  let names = nameTable ? parseNameTable(nameTable) : new Map<number, string>();
  let os2 = os2Table ? parseOs2Table(os2Table) : {};

  let glyphCount: number | undefined;
  if (maxpTable && maxpTable.byteLength >= 6) {
    let maxpView = new DataView(
      maxpTable.buffer,
      maxpTable.byteOffset,
      maxpTable.byteLength,
    );
    glyphCount = maxpView.getUint16(4);
  }

  let unitsPerEm: number | undefined;
  let macStyle: number | undefined;
  if (headTable && headTable.byteLength >= 46) {
    let headView = new DataView(
      headTable.buffer,
      headTable.byteOffset,
      headTable.byteLength,
    );
    unitsPerEm = headView.getUint16(18);
    macStyle = headView.getUint16(44);
  }

  // Prefer OS/2 fsSelection (italic bit 0, bold bit 5); fall back to head
  // macStyle (bold bit 0, italic bit 1) when OS/2 is absent.
  let isItalic: boolean | undefined;
  let isBold: boolean | undefined;
  if (os2.fsSelection !== undefined) {
    isItalic = (os2.fsSelection & 0x01) !== 0;
    isBold = (os2.fsSelection & 0x20) !== 0;
  } else if (macStyle !== undefined) {
    isBold = (macStyle & 0x01) !== 0;
    isItalic = (macStyle & 0x02) !== 0;
  }

  let axes = fvarTable ? parseFvarAxes(fvarTable) : [];

  return pruneUndefined({
    familyName: names.get(NAME_TYPO_FAMILY) ?? names.get(NAME_FAMILY),
    subfamilyName: names.get(NAME_TYPO_SUBFAMILY) ?? names.get(NAME_SUBFAMILY),
    fullName: names.get(NAME_FULL),
    postscriptName: names.get(NAME_POSTSCRIPT),
    versionName: names.get(NAME_VERSION),
    foundry: names.get(NAME_MANUFACTURER),
    vendorId: os2.vendorId,
    weightClass: os2.weightClass,
    widthName: os2.widthName,
    glyphCount,
    unitsPerEm,
    outlineType: outlineTypeFor(source),
    isVariable: source.hasTable('fvar') ? true : undefined,
    isItalic,
    isBold,
    axes,
  });
}
