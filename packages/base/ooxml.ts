// The shared reader for Office Open XML files — the ZIP-of-XML container behind
// DOCX, PPTX, and XLSX. Every Office family reads the same way: unzip the parts
// it needs, pull the core/extended properties both share, then read the one part
// that carries its own structure (a document body, a slide, a sheet). This
// module owns the container and the shared properties; the per-format extractors
// own the structure.
//
// A ZIP entry is stored with either no compression or DEFLATE (RFC 1951 raw
// deflate, which `DecompressionStream('deflate-raw')` handles natively — unlike
// a font's Brotli-packed WOFF2 table, an Office part is always readable in the
// extract environment). Only the parts an extractor asks for are inflated, so a
// large spreadsheet's unread sheets never cost anything.

import { FileContentMismatchError } from './file-api';

// The Office core properties (`docProps/core.xml`) and extended properties
// (`docProps/app.xml`), the two blocks every Office document shares regardless
// of whether it is a document, a deck, or a workbook. A format extractor adds
// its own structural facts (page/slide/sheet counts, an outline) on top.
export interface OfficeCoreProperties {
  title?: string;
  creator?: string;
  subject?: string;
  keywords?: string;
  description?: string;
  lastModifiedBy?: string;
  // `dcterms:created` / `dcterms:modified`, normalized to ISO-8601 when they
  // parse (they are already W3CDTF, so this is usually a pass-through).
  created?: string;
  modified?: string;
  // Extended properties: the authoring application and, for a workbook, the
  // company the template carried.
  application?: string;
  company?: string;
  // Extended-property counts. Which ones are present depends on the format —
  // Word writes `Pages`/`Words`, PowerPoint writes `Slides` — so each is
  // optional and a format extractor promotes the ones that matter to it.
  pageCount?: number;
  wordCount?: number;
  slideCount?: number;
}

// The serialized metadata every Office family writes into its `officeMetadata`
// field: the shared properties, the one structural count that matters to the
// format, and a bounded structural preview. A format promotes only the counts
// it has — a document has pages, a deck has slides, a workbook has sheets — so
// each is optional.
export interface OfficeMetadata extends OfficeCoreProperties {
  kind: 'word' | 'presentation' | 'spreadsheet';
  sheetCount?: number;
  sheetNames?: string[];
  // The bounded structural preview (`DocumentPreview` | `DeckPreview` |
  // `GridPreview`), serialized so nothing queries an individual paragraph,
  // slide, or cell — the `WaveformMetadataField.barsJson` precedent — and the
  // stored payload stays small no matter how large the source is.
  previewJson?: string;
}

export interface OfficeTextBlock {
  // 'title' | 'heading' | 'body' — rendered as a title, a subhead, or prose.
  style: 'title' | 'heading' | 'body';
  // 1–9 for a heading, so the preview can indent by depth; absent otherwise.
  level?: number;
  text: string;
}

// A Word document's opening text flow.
export interface DocumentPreview {
  blocks: OfficeTextBlock[];
  // Whether the body ran past the block budget, so the preview can say "…".
  truncated: boolean;
}

// A slide's title and its bullet lines, in reading order.
export interface DeckSlide {
  index: number;
  title?: string;
  bullets: string[];
}

export interface DeckPreview {
  slides: DeckSlide[];
  truncated: boolean;
}

// A worksheet sampled to a bounded top-left window of cells.
export interface GridSheet {
  name: string;
  rows: string[][];
  // Whether the sheet had rows or columns past the sampled window.
  truncated: boolean;
}

export interface GridPreview {
  sheets: GridSheet[];
}

// A parsed ZIP directory: entry name → the bytes needed to inflate it on
// demand. Central-directory offsets are resolved up front so an extractor can
// pull any part by name without rescanning.
interface ZipEntry {
  method: number; // 0 = stored, 8 = deflate
  offset: number; // offset of the local file header
  compressedSize: number;
  uncompressedSize: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

// An Office file over this size is not unzipped for a preview: the parts a
// preview reads (properties, the first sheet, a slide's text) are small, but a
// large workbook's bytes are mostly cell data a bounded preview never shows.
// The file still downloads and identifies; only the extracted facts are skipped.
export const OOXML_MAX_BYTES = 32 * 1024 * 1024;

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at]! |
      (bytes[at + 1]! << 8) |
      (bytes[at + 2]! << 16) |
      (bytes[at + 3]! << 24)) >>>
    0
  );
}

const utf8 = new TextDecoder('utf-8');

// Read the ZIP central directory into a name→entry map. Reading the central
// directory (rather than scanning local headers) is what lets an extractor
// address a part by name and skip every part it doesn't need. Returns undefined
// when the bytes have no End Of Central Directory record, i.e. aren't a ZIP.
function readCentralDirectory(
  bytes: Uint8Array,
): Map<string, ZipEntry> | undefined {
  // The EOCD sits at the end, after an optional comment; scan back for its
  // signature over the maximum comment length.
  let eocd = -1;
  let scanFrom = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= scanFrom; i--) {
    if (u32(bytes, i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return undefined;
  }
  let count = u16(bytes, eocd + 10);
  let dirOffset = u32(bytes, eocd + 16);
  let entries = new Map<string, ZipEntry>();
  let p = dirOffset;
  for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
    if (u32(bytes, p) !== SIG_CENTRAL) {
      break;
    }
    let method = u16(bytes, p + 10);
    let compressedSize = u32(bytes, p + 20);
    let uncompressedSize = u32(bytes, p + 24);
    let nameLen = u16(bytes, p + 28);
    let extraLen = u16(bytes, p + 30);
    let commentLen = u16(bytes, p + 32);
    let localOffset = u32(bytes, p + 42);
    let name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      method,
      offset: localOffset,
      compressedSize,
      uncompressedSize,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof DecompressionStream === 'undefined') {
    return undefined;
  }
  try {
    let stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

// An opened OOXML container: its ZIP directory plus the raw bytes, so any part
// can be inflated by name on demand.
export class OoxmlPackage {
  private bytes: Uint8Array;
  private entries: Map<string, ZipEntry>;

  private constructor(bytes: Uint8Array, entries: Map<string, ZipEntry>) {
    this.bytes = bytes;
    this.entries = entries;
  }

  // Open the container, or throw `FileContentMismatchError` when the bytes
  // aren't a ZIP (every OOXML file is one) or don't carry the OOXML content-type
  // map. The mismatch propagates so the extract framework falls back to a plain
  // FileDef rather than indexing a broken document.
  static async open(bytes: Uint8Array): Promise<OoxmlPackage> {
    // Local file header magic `PK\x03\x04`. A ZIP always opens with it, so a
    // cheap front-of-file check rejects a mislabeled `.docx` before the scan.
    if (bytes.length < 4 || u32(bytes, 0) !== SIG_LOCAL) {
      throw new FileContentMismatchError('File is not a ZIP/OOXML container');
    }
    let entries = readCentralDirectory(bytes);
    if (!entries || !entries.has('[Content_Types].xml')) {
      throw new FileContentMismatchError('File is not an OOXML package');
    }
    return new OoxmlPackage(bytes, entries);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  // Every part name in the package, so an extractor can count `ppt/slides/slideN`
  // parts or discover `xl/worksheets/*` without knowing them in advance.
  names(): string[] {
    return [...this.entries.keys()];
  }

  // Inflate one part to text. Returns undefined when the part is absent or won't
  // inflate, so one unreadable part never fails the whole read.
  async readText(name: string): Promise<string | undefined> {
    let entry = this.entries.get(name);
    if (!entry) {
      return undefined;
    }
    // The local header repeats the name/extra length; the compressed data
    // starts past them. Read those two 16-bit fields from the local header
    // rather than trusting the central directory's copy.
    let h = entry.offset;
    if (u32(this.bytes, h) !== SIG_LOCAL) {
      return undefined;
    }
    let nameLen = u16(this.bytes, h + 26);
    let extraLen = u16(this.bytes, h + 28);
    let dataStart = h + 30 + nameLen + extraLen;
    let raw = this.bytes.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) {
      return utf8.decode(raw.subarray(0, entry.uncompressedSize));
    }
    if (entry.method === 8) {
      let inflated = await inflateRaw(raw);
      return inflated ? utf8.decode(inflated) : undefined;
    }
    return undefined;
  }
}

// Decode the five XML predefined entities (plus numeric references). Office
// parts are UTF-8 XML, so text runs and property values arrive entity-escaped.
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      let code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    let named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    };
    return named[body] ?? whole;
  });
}

// The text content of the first element with the given (namespace-suffixed) tag
// name — e.g. `dc:title`. Office uses namespace prefixes, so the tag is matched
// on its literal prefixed name. Returns undefined when the tag is absent, and
// '' when it is present but empty (a distinction the extractors preserve: an
// empty `<dc:title/>` means "no title", not "unread").
export function tagText(xml: string, tag: string): string | undefined {
  let open = xml.indexOf(`<${tag}`);
  if (open < 0) {
    return undefined;
  }
  // Self-closing (`<dc:title/>`) is an explicit empty value.
  let close = xml.indexOf('>', open);
  if (close < 0) {
    return undefined;
  }
  if (xml[close - 1] === '/') {
    return '';
  }
  let end = xml.indexOf(`</${tag}>`, close);
  if (end < 0) {
    return undefined;
  }
  return decodeXmlEntities(xml.slice(close + 1, end)).trim();
}

// A W3CDTF/ISO date as an Office property carries it, normalized to a UTC
// ISO-8601 string. A value with an explicit offset (`Z` or `±hh:mm`) is
// converted to the instant it names; an offset-less value is treated as UTC.
// An unparseable value is left out rather than guessed at.
export function isoDate(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  let match = raw.match(
    /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?/,
  );
  if (!match) {
    return undefined;
  }
  let [, date, time, offset] = match;
  let parsed = new Date(`${date}T${time ?? '00:00:00'}${offset ?? 'Z'}`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function numberOr(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  let n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// Read the core and extended properties both `docProps/core.xml` and
// `docProps/app.xml` carry. A document with neither (a bare package) returns an
// empty object rather than failing — the structural extractor still has its own
// part to read.
export async function readCoreProperties(
  pkg: OoxmlPackage,
): Promise<OfficeCoreProperties> {
  let core = (await pkg.readText('docProps/core.xml')) ?? '';
  let app = (await pkg.readText('docProps/app.xml')) ?? '';

  let props: OfficeCoreProperties = {
    title: nonEmpty(tagText(core, 'dc:title')),
    creator: nonEmpty(tagText(core, 'dc:creator')),
    subject: nonEmpty(tagText(core, 'dc:subject')),
    keywords: nonEmpty(tagText(core, 'cp:keywords')),
    description: nonEmpty(tagText(core, 'dc:description')),
    lastModifiedBy: nonEmpty(tagText(core, 'cp:lastModifiedBy')),
    created: isoDate(tagText(core, 'dcterms:created')),
    modified: isoDate(tagText(core, 'dcterms:modified')),
    application: nonEmpty(tagText(app, 'Application')),
    company: nonEmpty(tagText(app, 'Company')),
    pageCount: numberOr(tagText(app, 'Pages')),
    wordCount: numberOr(tagText(app, 'Words')),
    slideCount: numberOr(tagText(app, 'Slides')),
  };
  return props;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

// Drop the keys an extractor never learned, so a serialized result carries only
// facts the file actually stated.
export function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  let out = {} as Record<string, unknown>;
  for (let [key, v] of Object.entries(value)) {
    if (v !== undefined && v !== null && v !== '') {
      out[key] = v;
    }
  }
  return out as T;
}
