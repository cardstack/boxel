/* Pure parser-adaptation helpers. Keeping these outside CardDefs lets every
   domain subtype reuse the same bounded, deterministic derivation rules. */

import { // Declarative profiles replace the growing MIME switch in this adapter
  contentTypeForFile,
  extensionOfFile,
  profileForFile,
} from 'https://cardstack.com/base/file-formats/file-type-profile';

export type ParsedFile = { // Small structural view over FileDef subtype output
  id?: string;
  name?: string;
  contentType?: string;
  contentHash?: string;
  contentSize?: number;
  url?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  title?: string;
  excerpt?: string;
  content?: string;
  columns?: string[];
  columnCount?: number;
  rowCount?: number;
};

export type LiveSourceSlots = { // Shared source priority contract
  sourceImage?: ParsedFile;
  sourceAudio?: ParsedFile; // Catalog-compatible typed AudioDef source
  sourceMarkdown?: ParsedFile;
  sourceCsv?: ParsedFile;
  sourceCode?: ParsedFile;
  sourceJson?: ParsedFile;
  sourceText?: ParsedFile;
  sourceFile?: ParsedFile;
  resourceUrl?: string; // Scalar HTTP-resource mirrors survive generic FileDef hydration gaps
  resourceName?: string;
  resourceContentType?: string;
  resourceContentSize?: number;
  resourceTextPreview?: string; // Bounded text only; never binary payloads
};

const CAPTION_BY_NAME: Record<string, string> = {
  'ep-114-systems.mp3': 'ep-114-systems.vtt',
  'master-take-3.m4a': 'master-take-3.vtt',
  'product-tour-v2.mp4': 'product-tour-v2.vtt',
};

export function extensionOf(file: ParsedFile): string { // Extension fallback for parser-less files
  return extensionOfFile(file); // Taxonomy owns extension routing
}

export function contentTypeOf(file: ParsedFile): string {
  return contentTypeForFile(file); // Registry includes binary and future-family fallbacks
}

export function kindOf(file: ParsedFile): string { // Human label shared by every domain card
  return profileForFile(file).kind; // One declarative profile drives the label
}

export function schemaRowsOf(source?: string): { fieldName: string; relationship: string; fieldType: string }[] {
  if (!source) {
    return [];
  }
  let rows: { fieldName: string; relationship: string; fieldType: string }[] = [];
  let pattern = /@field\s+([A-Za-z_$][\w$]*)\s*=\s*(containsMany|contains|linksToMany|linksTo)\s*\(\s*(?:\(\)\s*=>\s*)?([A-Za-z_$][\w$]*)/g;
  for (let match of source.matchAll(pattern)) {
    rows.push({ fieldName: match[1]!, relationship: match[2]!, fieldType: match[3]! });
  }
  return rows;
}

export function cardTypeOf(source?: string): string {
  return source?.match(/export\s+class\s+([A-Za-z_$][\w$]*)\s+extends\s+(?:CardDef|FieldDef)/)?.[1] ?? 'Card definition';
}

export function formatsOf(source?: string): string[] {
  return [...(source ?? '').matchAll(/static\s+(atom|fitted|embedded|isolated|edit)\s*=/g)].map((match) => match[1]!);
}

export function resolveSource(card: LiveSourceSlots): ParsedFile | undefined { // Typed sources win; generic FileDef remains fallback
  return card.sourceImage ??
    card.sourceAudio ??
    card.sourceMarkdown ??
    card.sourceCsv ??
    card.sourceCode ??
    card.sourceJson ??
    card.sourceText ??
    card.sourceFile;
}

export function parsed(card: LiveSourceSlots): ParsedFile {
  let source = resolveSource(card) ?? {};
  return { // Prefer parser output; use authored resource facts only when the generic relationship is unavailable
    ...source,
    id: source.id ?? card.resourceUrl,
    url: source.url ?? card.resourceUrl,
    name: source.name ?? card.resourceName,
    contentType: source.contentType ?? card.resourceContentType,
    contentSize: source.contentSize ?? card.resourceContentSize,
    content: source.content ?? card.resourceTextPreview,
  };
}

export function previewKindOf(file: ParsedFile): string { // Central routing table for domain previews
  return profileForFile(file).previewKind; // Preview kind is one profile axis
}

export function familyOf(file: ParsedFile): string { // Stable taxonomy independent of renderer
  return profileForFile(file).family;
}

export function previewAdapterOf(file: ParsedFile): string { // Component selection is composed, not inherited
  return profileForFile(file).previewAdapter;
}

export function previewSourceOf(file: ParsedFile): string { // Provenance is explicit per profile
  return profileForFile(file).previewSource;
}

export function capabilitiesOf(file: ParsedFile): string[] { // Future commands consume capability keys
  return [...profileForFile(file).capabilities];
}

export function isTextPreview(kind: string): boolean {
  return ['markdown', 'code', 'json', 'doc', 'schema'].includes(kind);
}

export function humanSize(bytes?: number): string {
  if (bytes == null || Number.isNaN(bytes)) {
    return '';
  }
  let units = ['bytes', 'KB', 'MB', 'GB'];
  let unitIndex = bytes === 0
    ? 0
    : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  let value = bytes / Math.pow(1024, unitIndex);
  return `${unitIndex === 0 ? value : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatClock(totalSeconds: number): string {
  let seconds = Math.max(0, Math.round(totalSeconds));
  let minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function quantityFact(quantity?: { value?: number; unit?: string }): string {
  return quantity?.value == null
    ? ''
    : `${quantity.value} ${quantity.unit ?? ''}`.trim();
}

export function codecFact(codec?: string): string {
  return codec
    ? codec.replace(/h264(?: \([^)]*\))?/i, 'H.264').replace(/pcm_s16le/i, 'PCM').toUpperCase()
    : '';
}

export function captionUrlOf(file: ParsedFile): string | undefined { // Caption lookup is media-domain data, not CardDef state
  let caption = file.name ? CAPTION_BY_NAME[file.name] : undefined;
  let source = file.url ?? file.id;
  return caption && source ? new URL(`../captions/${caption}`, source).href : undefined;
}

export const TABLE_PREVIEW_ROWS = 9; // Hard caps protect fitted/embedded rendering
export const TEXT_PREVIEW_LINES = 28;
