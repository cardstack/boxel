import { baseFileRef, baseRRI } from './constants.ts';
import { canonicalModuleKey } from './code-ref.ts';
import type { CodeRef, ResolvedCodeRef } from './code-ref.ts';
import { lastSegmentOfIdentifier } from './realm-identifiers.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import { resolveRRIReference } from './url.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// Base modules are spelled in the `@cardstack/base/` prefix form, the form
// `baseFileRef` and `identifyCard` use, so a stamped ref never depends on
// which URL the base realm is served from.
export const FILEDEF_CODE_REF_BY_EXTENSION: Readonly<
  Record<string, ResolvedCodeRef>
> = {
  '.markdown': { module: baseRRI('markdown-file-def'), name: 'MarkdownDef' },
  '.md': { module: baseRRI('markdown-file-def'), name: 'MarkdownDef' },
  '.html': { module: baseRRI('html-file-def'), name: 'HtmlDef' },
  '.htm': { module: baseRRI('html-file-def'), name: 'HtmlDef' },
  '.png': { module: baseRRI('png-image-def'), name: 'PngDef' },
  '.jpg': { module: baseRRI('jpg-image-def'), name: 'JpgDef' },
  '.jpeg': { module: baseRRI('jpg-image-def'), name: 'JpgDef' },
  '.svg': { module: baseRRI('svg-image-def'), name: 'SvgDef' },
  '.gif': { module: baseRRI('gif-image-def'), name: 'GifDef' },
  '.webp': { module: baseRRI('webp-image-def'), name: 'WebpDef' },
  '.avif': { module: baseRRI('avif-image-def'), name: 'AvifDef' },
  '.ts': { module: baseRRI('ts-file-def'), name: 'TsFileDef' },
  '.gts': { module: baseRRI('gts-file-def'), name: 'GtsFileDef' },
  '.txt': { module: baseRRI('text-file-def'), name: 'TextFileDef' },
  '.text': { module: baseRRI('text-file-def'), name: 'TextFileDef' },
  '.log': { module: baseRRI('log-file-def'), name: 'LogFile' },
  '.json': { module: baseRRI('json-file-def'), name: 'JsonFileDef' },
  '.jsonl': { module: baseRRI('jsonl-file-def'), name: 'JSONLFile' },
  '.csv': { module: baseRRI('csv-file-def'), name: 'CsvFileDef' },
  '.pdf': { module: baseRRI('pdf-file-def'), name: 'PdfDef' },
  '.docx': { module: baseRRI('docx-file-def'), name: 'DocxDef' },
  '.pptx': { module: baseRRI('pptx-file-def'), name: 'PptxDef' },
  '.xlsx': { module: baseRRI('xlsx-file-def'), name: 'XlsxDef' },
  '.mp3': { module: baseRRI('mp3-audio-def'), name: 'Mp3Def' },
  '.wav': { module: baseRRI('wav-audio-def'), name: 'WavDef' },
  '.ogg': { module: baseRRI('ogg-audio-def'), name: 'OggDef' },
  '.oga': { module: baseRRI('ogg-audio-def'), name: 'OggDef' },
  '.opus': { module: baseRRI('ogg-audio-def'), name: 'OggDef' },
  '.m4a': { module: baseRRI('m4a-audio-def'), name: 'M4aDef' },
  '.flac': { module: baseRRI('flac-audio-def'), name: 'FlacDef' },
  // Symbolic performance data rather than sampled audio, so `MidiDef` extends
  // FileDef directly instead of AudioDef.
  '.mid': { module: baseRRI('midi-audio-def'), name: 'MidiDef' },
  '.midi': { module: baseRRI('midi-audio-def'), name: 'MidiDef' },
  // MP4 and MOV are the same ISO BMFF container as .m4a; the extension is what
  // says whether to expect a picture track, so they route to distinct classes.
  '.mp4': { module: baseRRI('mp4-video-def'), name: 'Mp4Def' },
  '.m4v': { module: baseRRI('mp4-video-def'), name: 'Mp4Def' },
  '.mov': { module: baseRRI('mov-video-def'), name: 'MovDef' },
  '.webm': { module: baseRRI('webm-video-def'), name: 'WebmDef' },
  // 3D model formats. STL is raw triangle geometry; 3MF is a zipped OPC
  // package; GLB/glTF are the binary and JSON forms of the same scene format.
  // All extend ThreeDModelDef, which renders a live client-side WebGL viewer.
  '.stl': { module: baseRRI('stl-model-def'), name: 'StlDef' },
  '.3mf': { module: baseRRI('three-mf-def'), name: 'ThreeMfDef' },
  '.glb': { module: baseRRI('gltf-model-def'), name: 'GlbDef' },
  '.gltf': { module: baseRRI('gltf-model-def'), name: 'GltfDef' },
  '.zip': { module: baseRRI('zip-file-def'), name: 'ZipDef' },
  '.woff2': { module: baseRRI('woff2-font-def'), name: 'Woff2Def' },
  '.woff': { module: baseRRI('woff-font-def'), name: 'WoffDef' },
  '.ttf': { module: baseRRI('ttf-font-def'), name: 'TtfDef' },
  '.otf': { module: baseRRI('otf-font-def'), name: 'OtfDef' },
  '.mismatch': {
    module: './filedef-mismatch' as RealmResourceIdentifier,
    name: 'FileDef',
  },
};

// Whether a code ref targets a file-meta (FileDef) type: the base FileDef ref
// or one of the known extension-specific subtypes. Used to dispatch a search to
// the file-meta candidate pool from the query alone — without depending on the
// server having returned a row to sniff — so an empty-but-complete file-meta
// search still reconciles locally hydrated FileDefs.
//
// A query may spell a module in URL form or prefix form, so the module strings
// are compared by their canonical key rather than verbatim — otherwise a
// URL-form subtype ref (`MarkdownDef`, `PngDef`, …) would miss and the
// file-meta search would skip local reconciliation.
export function isFileDefCodeRef(
  ref: CodeRef | undefined,
  virtualNetwork: VirtualNetwork,
): boolean {
  if (
    !ref ||
    !('module' in ref) ||
    typeof ref.module !== 'string' ||
    typeof ref.name !== 'string'
  ) {
    return false;
  }
  let refKey = canonicalModuleKey(ref.module, virtualNetwork);
  let matchesModule = (candidate: string) =>
    refKey === canonicalModuleKey(candidate, virtualNetwork);
  if (matchesModule(baseFileRef.module) && ref.name === baseFileRef.name) {
    return true;
  }
  for (let subtype of Object.values(FILEDEF_CODE_REF_BY_EXTENSION)) {
    if (matchesModule(subtype.module) && ref.name === subtype.name) {
      return true;
    }
  }
  return false;
}

// The extension of a file's last path segment as the tables here key on it:
// lowercase with the leading dot, or '' for none. A leading dot alone
// (`.gitignore`) names a file, not an extension.
export function extensionOfName(name: string): string {
  let dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

// A file name without the extension `extensionOfName` reads from it.
export function nameWithoutExtension(name: string): string {
  let dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

// The extension of an identifier's last path segment, in either form, as
// `extensionOfName` spells it. An identifier that ends in a slash names a
// directory, so it has no extension.
export function extensionOfIdentifier(identifier: string): string {
  let path = identifier.split(/[?#]/, 1)[0];
  return path.endsWith('/')
    ? ''
    : extensionOfName(lastSegmentOfIdentifier(path));
}

function extensionOf(url: URL): string {
  return extensionOfIdentifier(url.href);
}

// Whether a URL names a file rather than a card, judged by a known FileDef
// extension on the last path segment. Card ids never end in one (an
// instance's `.json` is stripped from its id) — but a bare "has a dot"
// check would misfire on card ids that legitimately contain dots (e.g. a
// `ModelConfiguration/claude-sonnet-4.6` instance), so only registered
// file extensions count.
export function urlNamesFile(url: URL): boolean {
  return extensionOf(url) in FILEDEF_CODE_REF_BY_EXTENSION;
}

// Last-path-segment form of `urlNamesFile`, for callers that already hold the
// segment as a string — the index runner's per-dep classifier stays off URL
// construction entirely.
export function segmentNamesFile(name: string): boolean {
  return extensionOfName(name) in FILEDEF_CODE_REF_BY_EXTENSION;
}

// Whether a reference names a file rather than a card instance. String form of
// `urlNamesFile`, for a reference that may not parse as a URL (a registered
// prefix id such as `@cardstack/skills/some-skill`). Judged the same way, by a
// registered extension on the last path segment: a dot alone proves nothing,
// because a card id can carry one, and reading such a dot as an extension is
// what turns `<realm>/ModelConfiguration/claude-sonnet-4.6` into a reference to
// a file that does not exist.
export function referenceNamesFile(reference: string): boolean {
  return extensionOfIdentifier(reference) in FILEDEF_CODE_REF_BY_EXTENSION;
}

// An absolute module (URL or prefix form) is returned as written; a relative
// one is joined against the file it describes.
export function resolveFileDefCodeRef(fileURL: URL): ResolvedCodeRef {
  let extension = extensionOf(fileURL);
  let mapping = extension
    ? FILEDEF_CODE_REF_BY_EXTENSION[extension]
    : undefined;
  if (!mapping) {
    return baseFileRef;
  }
  return {
    ...mapping,
    module: resolveRRIReference(
      mapping.module,
      fileURL,
    ) as RealmResourceIdentifier,
  };
}
