// One normalized presentation projection over a FileDef, so the four shared
// format shells never read family fields directly and every family gets the
// same identity, facts, and budgets for free.
//
// The fitted budgets live here rather than in the fitted shell: a collection
// cell must never turn an unbounded payload into HTML, and enforcing that at
// projection time means a family preview component physically cannot receive
// more than a fitted cell can afford to render.

import {
  fileIconFor,
  formatClock,
  type FileIconComponent,
} from './file-presentation';
import {
  extensionOfFile,
  profileForFile,
  type FileFamily,
  type PreviewAdapter,
  type PreviewSource,
} from './file-type-profile';

export type FileFormat = 'atom' | 'fitted' | 'embedded' | 'isolated';

// Fitted cards receive a mechanical head snippet, never the complete source.
export const FITTED_TEXT_CHARACTER_BUDGET = 8_192;
export const FITTED_TEXT_LINE_BUDGET = 14;
// Collection formats project only what a bounded cell can turn into HTML.
export const FITTED_ARCHIVE_ENTRY_BUDGET = 4;
export const FITTED_SCHEMA_ROW_BUDGET = 4;
export const FITTED_CODE_SYMBOL_BUDGET = 4;
// Keep prerendered SVG bounded while still sampling the whole envelope.
export const FITTED_WAVEFORM_BAR_BUDGET = 64;
export const DETAILED_WAVEFORM_BAR_BUDGET = 256;

// The states a shell knows how to present. A family may set `fileState` itself
// when it knows more than the shared projection can infer.
export type FileState =
  | 'normal'
  | 'loading'
  | 'generating'
  | 'stale'
  | 'failed'
  | 'unsupported'
  | 'empty'
  | 'malformed';

// The FileDef fields the projection reads. Everything past the base FileDef
// schema is optional: a family declares the fields it actually extracts, and
// the shells degrade to identity-only for a family that declares none.
export interface FileModelLike {
  [key: string]: any;
  id?: string;
  url?: string;
  sourceUrl?: string;
  name?: string;
  contentType?: string;
  contentHash?: string;
  contentSize?: number;
}

// A FileDef subclass can pin any profile axis when its MIME type is ambiguous —
// `.ts` served as `text/plain`, for instance. These are read as statics off the
// class, so a family declares them once rather than per format.
export interface FileProfileSource {
  displayName?: string;
  // `static icon`, which every FileDef subclass already declares.
  icon?: FileIconComponent;
  fileKind?: string;
  fileFamily?: string;
  previewKind?: string;
  previewAdapter?: string;
  previewSource?: string;
}

// The class a view model should take its profile overrides from. Prefer the
// instance's own constructor over the declared field class, since a `linksTo`
// declared as `FileDef` is routinely populated with a subclass instance.
export function fileProfileSource(
  model: object | undefined | null,
  cardOrField?: unknown,
): FileProfileSource | undefined {
  return (model?.constructor ?? cardOrField) as FileProfileSource | undefined;
}

export interface FileViewModel {
  id?: string;
  source: FileModelLike;
  icon: FileIconComponent;
  name: string;
  baseName: string;
  extension: string;
  contentType?: string;
  contentSize?: number;
  contentHash?: string;
  url: string;
  resourceUrl: string;
  family: FileFamily | string;
  kind: string;
  fileState: FileState;
  previewKind: string;
  previewAdapter: PreviewAdapter | string;
  previewSource: PreviewSource | string;
  imageUrl?: string;
  posterUrl: string;
  thumbnailUrl: string;
  thumbnailStale: boolean;
  mediaUrl?: string;
  captionUrl?: string;
  waveformBars: number[];
  title?: string;
  titleOrigin: 'extracted' | 'missing';
  previewText: string;
  contentPreview: string;
  previewTruncated: boolean;
  durationSeconds?: number;
  lastModified?: string | Date;
  createdAt?: string | Date;
  realmPath?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  aspectLabel: string;
  heroFact: string;
  facts: string[];
  badges: string[];
  rowCount?: number;
  columnCount?: number;
  columns: string[];
  language?: string;
  lineCount?: number;
  exportCount?: number;
  hasDefaultExport?: boolean;
  imports: string[];
  exportedModules: string[];
  exportedFunctions: string[];
  codeSummaryMode: string;
  codeSummaryItems: string[];
  codeSummaryCount: number;
  schemaRows: any[];
  schemaRowCount: number;
  archiveEntries: string[];
  archiveEntryCount: number;
  railCount: number;
  exif?: any;
  capture?: any;
  location?: any;
  colorProfile?: any;
  encoding?: any;
  mediaTags?: any;
  waveform?: any;
  midi?: any;
  documentInfo?: any;
  model3d?: any;
  fontMetadata?: any;
  htmlMetadata?: any;
  posterMetadata?: any;
  thumbnailMetadata?: any;
}

function fittedTextSnippet(text: string): string {
  return text
    .slice(0, FITTED_TEXT_CHARACTER_BUDGET)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .slice(0, FITTED_TEXT_LINE_BUDGET)
    .join('\n');
}

function aspectLabel(width?: number, height?: number): string {
  if (!width || !height) {
    return '';
  }
  let gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let divisor = gcd(width, height);
  let w = width / divisor;
  let h = height / divisor;
  return w <= 32 && h <= 32 ? `${w}:${h}` : `${(width / height).toFixed(2)}:1`;
}

// Resampling is format-aware so a fitted waveform's SVG size never scales with
// the extractor's resolution.
function waveformBarsFor(model: FileModelLike, format: FileFormat): number[] {
  let raw = model.waveform?.barsJson ?? model.waveformData;
  let values: unknown = raw;
  if (typeof raw === 'string') {
    try {
      values = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(values)) {
    return [];
  }
  let normalized = values
    .filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    )
    .map((value) => Math.max(0, Math.min(100, value)));
  let budget =
    format === 'fitted'
      ? FITTED_WAVEFORM_BAR_BUDGET
      : DETAILED_WAVEFORM_BAR_BUDGET;
  if (normalized.length <= budget) {
    return normalized;
  }
  // Sample evenly so the whole waveform's shape survives, rather than
  // returning only its opening seconds.
  return Array.from(
    { length: budget },
    (_, index) =>
      normalized[Math.round((index * (normalized.length - 1)) / (budget - 1))]!,
  );
}

function durationOf(model: FileModelLike): number | undefined {
  let value = model.durationSeconds ?? model.duration;
  return value == null || !Number.isFinite(Number(value))
    ? undefined
    : Number(value);
}

// The single most identifying fact about the file, shown even in a strip only
// tall enough for one line beneath the name.
function heroFactFor(
  model: FileModelLike,
  kind: string,
  width?: number,
  height?: number,
): string {
  if (width && height) {
    return `${width}×${height}`;
  }
  if (model.rowCount != null) {
    return `${model.rowCount.toLocaleString()} rows`;
  }
  if (kind === 'schema') {
    // A GTS file may be a utility, one CardDef, or a multi-export module.
    let modules = Array.from(model.exportedModules ?? []).filter(Boolean);
    let functions = Array.from(model.exportedFunctions ?? []).filter(Boolean);
    if (modules.length > 1) {
      return `${modules.length} modules`;
    }
    if (modules.length === 1) {
      return String(modules[0]);
    }
    if (functions.length) {
      return `${functions.length} function${functions.length === 1 ? '' : 's'}`;
    }
    return `${(model.schemaFields ?? []).length} fields`;
  }
  if (['waveform', 'video', 'midi'].includes(kind)) {
    let clock = formatClock(durationOf(model));
    if (clock) {
      return clock;
    }
    // A MIDI file timed in SMPTE has no seconds to clock; its structure is the
    // next most identifying fact.
    if (kind === 'midi' && model.midi?.trackCount) {
      return `${model.midi.trackCount} tracks`;
    }
    if (kind === 'midi' && model.midi?.noteCount) {
      return `${model.midi.noteCount.toLocaleString()} notes`;
    }
  }
  if (model.documentInfo?.pageCount) {
    return `${model.documentInfo.pageCount} pages`;
  }
  if (kind === 'archive' && model.archiveContents?.length) {
    return `${model.archiveContents.length} entries`;
  }
  if (kind === 'model' && model.model3d?.triangles) {
    return `${model.model3d.triangles.toLocaleString()} tris`;
  }
  if (kind === 'font') {
    // Font identity is more useful than a generic byte fact.
    return model.fontMetadata?.fullName ?? model.fontMetadata?.familyName ?? '';
  }
  if (kind === 'html') {
    return (
      model.htmlMetadata?.documentTitle ??
      (model.htmlMetadata?.elementCount != null
        ? `${model.htmlMetadata.elementCount} elements`
        : '')
    );
  }
  if (kind === 'markdown' && model.content) {
    let words = String(model.content).split(/\s+/).filter(Boolean).length;
    return `${words.toLocaleString()} words`;
  }
  if (['code', 'json', 'doc'].includes(kind) && model.lineCount != null) {
    return `${model.lineCount.toLocaleString()} lines`;
  }
  if (model.contentSize === 0) {
    return '0 bytes';
  }
  return '';
}

function linkedFileURL(value: any): string {
  if (!value) {
    return '';
  }
  return String(value.url ?? value.sourceUrl ?? value.id ?? '');
}

// `model` is typed loosely because a FileDef subclass instance is a class
// instance, which TypeScript won't assign to an index-signature type. Reading
// it as a permissive record is the whole point of a projection: the fields past
// the base schema are whatever the family declared.
export function fileViewModel(
  model: object | undefined | null,
  format: FileFormat = 'isolated',
  profileSource?: FileProfileSource,
): FileViewModel {
  let file = (model ?? {}) as FileModelLike;
  let url = String(file.url ?? file.sourceUrl ?? file.id ?? '');
  let name = String(file.name ?? url.split('/').pop() ?? '');
  let contentType = file.contentType;
  let profile = profileForFile({ name, contentType });

  // Share the registry's rule so the pill and the routing can't describe the
  // same file differently. It yields '' for a name with no dot (`LICENSE`) and
  // for a dotfile, whose leading dot starts the name rather than an extension.
  let extension = String(
    file.fileExtension ?? extensionOfFile({ name }),
  ).toUpperCase();
  // Strip only a trailing extension the name actually ends with, so `README`
  // and `.gitignore` each keep their whole name.
  let suffix =
    extension && name.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
      ? extension.length + 1
      : 0;
  let baseName = suffix ? name.slice(0, -suffix) : name;

  let family = profileSource?.fileFamily ?? profile.family;
  let previewKind = profileSource?.previewKind ?? profile.previewKind;
  let previewAdapter = profileSource?.previewAdapter ?? profile.previewAdapter;
  let previewSource = profileSource?.previewSource ?? profile.previewSource;
  // A profile that recognized the format names it better than a base class's
  // `displayName` does: a generic `FileDef` pointed at a PDF should read "PDF
  // document" rather than "File", and an unrecognized extension is still more
  // specific as "QQQ file". Only when the registry has nothing at all to go on
  // — no known type and no extension — does the class's own name win. A
  // subclass that wants to override a recognized format sets `fileKind`.
  let kind =
    profileSource?.fileKind ??
    (profile.id === 'generic'
      ? (profileSource?.displayName ?? profile.kind)
      : profile.kind);

  // A generated poster (video) and a generated thumbnail (everything
  // expensive) are separate linked FileDefs, never bytes in card JSON.
  let posterUrl = linkedFileURL(file.posterImage);
  let thumbnailUrl = linkedFileURL(file.thumbnailImage);

  let width = file.width;
  let height = file.height;

  let completeContent = String(file.content ?? '');
  let content =
    format === 'fitted' ? fittedTextSnippet(completeContent) : completeContent;

  let completeSchemaRows: any[] = Array.from(file.schemaFields ?? []);
  let schemaRows =
    format === 'fitted'
      ? completeSchemaRows.slice(0, FITTED_SCHEMA_ROW_BUDGET)
      : completeSchemaRows;

  let completeArchiveEntries: string[] = Array.from(
    file.archiveContents ?? [],
  ).map((entry: any) => String(entry?.path ?? entry));
  let archiveEntries =
    format === 'fitted'
      ? completeArchiveEntries.slice(0, FITTED_ARCHIVE_ENTRY_BUDGET)
      : completeArchiveEntries;

  // containsMany values are prototype-backed, so they need explicit projection
  // into plain arrays before a preview component can iterate them.
  let exportedModules = Array.from(file.exportedModules ?? []).map(String);
  let exportedFunctions = Array.from(file.exportedFunctions ?? []).map(String);
  let codeSummaryMode =
    exportedModules.length > 1
      ? 'modules'
      : exportedFunctions.length
        ? 'functions'
        : exportedModules.length === 1
          ? 'module'
          : completeSchemaRows.length
            ? 'schema'
            : 'exports';
  let completeCodeSummaryItems =
    codeSummaryMode === 'modules' || codeSummaryMode === 'module'
      ? exportedModules
      : codeSummaryMode === 'functions'
        ? exportedFunctions
        : completeSchemaRows
            .map((row: any) => String(row?.fieldName ?? ''))
            .filter(Boolean);
  let codeSummaryItems =
    format === 'fitted'
      ? completeCodeSummaryItems.slice(0, FITTED_CODE_SYMBOL_BUDGET)
      : completeCodeSummaryItems;

  let fontMetadata = file.fontMetadata;
  let htmlMetadata = file.htmlMetadata;
  let facts = [
    file.language,
    file.encoding?.videoCodec ??
      file.encoding?.audioCodec ??
      file.encoding?.container,
    // A real field instance computes `label` from the code; a plain wire-shape
    // object hasn't, so the bare code is the honest fallback.
    file.colorProfile?.colorSpace?.label ?? file.colorProfile?.colorSpace?.code,
    file.colorProfile?.bitDepth
      ? `${file.colorProfile.bitDepth}-bit`
      : undefined,
    file.sheetCount ? `${file.sheetCount} sheets` : undefined,
    fontMetadata?.subfamilyName && fontMetadata?.weightClass
      ? `${fontMetadata.subfamilyName} · ${fontMetadata.weightClass}`
      : fontMetadata?.subfamilyName,
    // The OS/2 vendor ID is the honest fallback when the name table omits a
    // foundry.
    fontMetadata?.foundry ??
      (fontMetadata?.vendorId ? `Vendor ${fontMetadata.vendorId}` : undefined),
    fontMetadata?.glyphCount
      ? `${fontMetadata.glyphCount.toLocaleString()} glyphs`
      : undefined,
    htmlMetadata?.isInteractive
      ? 'Interactive'
      : htmlMetadata
        ? 'Static HTML'
        : undefined,
    htmlMetadata?.scriptCount
      ? `${htmlMetadata.scriptCount} scripts`
      : undefined,
    htmlMetadata?.elementCount
      ? `${htmlMetadata.elementCount.toLocaleString()} elements`
      : undefined,
  ]
    .filter(Boolean)
    .map(String);

  let title = file.title ?? htmlMetadata?.documentTitle;

  return {
    id: file.id,
    // The FileDef itself, so a family preview or the isolated inspector can
    // reach a field this shared projection doesn't know about.
    source: file,
    icon: fileIconFor(profileSource),
    name,
    baseName,
    extension,
    contentType,
    contentSize: file.contentSize,
    contentHash: file.contentHash,
    url,
    resourceUrl: url,
    family,
    kind,
    fileState: (file.fileState ??
      (file.contentSize === 0
        ? 'empty'
        : url || content
          ? 'normal'
          : 'empty')) as FileState,
    previewKind,
    previewAdapter,
    previewSource,
    // One presentation slot covers both a native image and a video's poster.
    imageUrl:
      family === 'image' ? url : family === 'video' ? posterUrl : undefined,
    posterUrl,
    thumbnailUrl,
    // A source-hash mismatch stays visible rather than silently presenting
    // pixels rendered from bytes the file no longer has.
    thumbnailStale: Boolean(
      thumbnailUrl &&
      file.thumbnailMetadata?.sourceHash &&
      file.contentHash &&
      file.thumbnailMetadata.sourceHash !== file.contentHash,
    ),
    mediaUrl: ['audio', 'video', 'music'].includes(family) ? url : undefined,
    captionUrl: file.captionUrl,
    waveformBars: waveformBarsFor(file, format),
    title,
    titleOrigin: title ? 'extracted' : 'missing',
    previewText: content,
    contentPreview: content,
    // One signal covers byte-, row-, and entry-budgeted fitted projections.
    previewTruncated:
      format === 'fitted' &&
      (content.length < completeContent.length ||
        schemaRows.length < completeSchemaRows.length ||
        archiveEntries.length < completeArchiveEntries.length),
    durationSeconds: durationOf(file),
    lastModified: file.lastModified,
    createdAt: file.createdAt,
    realmPath: file.realmPath,
    width,
    height,
    aspectRatio:
      width && height ? Math.round((width / height) * 1000) / 1000 : undefined,
    aspectLabel: aspectLabel(width, height),
    heroFact: heroFactFor(file, previewKind, width, height),
    facts,
    badges: [file.complexity].filter(Boolean).map(String),
    rowCount: file.rowCount,
    columnCount: file.columnCount,
    columns: Array.from(file.columns ?? []).map(String),
    language: file.language,
    lineCount: file.lineCount,
    exportCount: file.exportCount,
    hasDefaultExport: file.hasDefaultExport,
    imports: Array.from(file.imports ?? []).map(String),
    exportedModules,
    exportedFunctions,
    codeSummaryMode,
    codeSummaryItems,
    codeSummaryCount: completeCodeSummaryItems.length,
    schemaRows,
    // Detailed consumers and fitted disclosure both need the canonical total.
    schemaRowCount: completeSchemaRows.length,
    archiveEntries,
    archiveEntryCount: completeArchiveEntries.length,
    railCount: Math.min(file.documentInfo?.pageCount ?? 0, 6),
    exif: file.exif,
    capture: file.exif?.capture,
    location: file.exif?.location,
    // A sibling of `exif`, not a member: the container header is the color
    // authority, with the EXIF tag already folded in at extract time.
    colorProfile: file.colorProfile,
    encoding: file.encoding,
    // The isolated shell renders this group via `<@fields.tags />`, so the
    // projection must come from the same `tags` field the shell reaches for.
    mediaTags: file.tags,
    waveform: file.waveform,
    midi: file.midi,
    documentInfo: file.documentInfo,
    model3d: file.model3d,
    fontMetadata,
    htmlMetadata,
    posterMetadata: file.posterMetadata,
    thumbnailMetadata: file.thumbnailMetadata,
  };
}
