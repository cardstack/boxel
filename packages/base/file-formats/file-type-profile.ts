// Declarative file taxonomy. FileDef inheritance expresses stable product
// families; this registry composes MIME/extension routing, renderer choice,
// provenance, and capabilities without needing one subclass per extension.
//
// A FileDef carries its own `name` and `contentType`, so the four shared format
// shells can resolve a profile from any FileDef instance — including a generic
// `FileDef` standing in for an extension that has no subclass yet.

export type FileFamily =
  // Stable user-facing families, not MIME superclasses.
  | 'generic'
  | 'image'
  | 'audio'
  // Symbolic performance data is not encoded audio.
  | 'music'
  | 'video'
  // Browser documents own DOM/interactivity metadata, not generic code or prose.
  | 'web'
  | 'document'
  | 'code'
  | 'data'
  | 'archive'
  | 'font'
  | 'model';

// Adapters name a domain renderer. The shells only ship `fallback`; each family
// registers its own renderer against one of these keys as it lands.
export type PreviewAdapter =
  | 'fallback'
  | 'media'
  | 'text'
  | 'schema'
  | 'data'
  | 'document'
  | 'archive'
  | 'font'
  | 'model'
  | 'midi'
  // Sandboxed iframe adapter, which consumes the FileDef as an HTTP resource.
  | 'html';

export type PreviewSource = 'native' | 'extracted' | 'generated' | 'fallback';

// Capability keys are the seam future tools dispatch on.
export type FileCapability =
  | 'native-preview'
  | 'text-preview'
  | 'rich-text'
  | 'structured-data'
  | 'schema-summary'
  | 'dimensions'
  | 'duration'
  | 'playback'
  // MIDI becomes sound only through an instrument renderer.
  | 'synthesis'
  | 'sequence'
  | 'timed-text'
  | 'animation'
  | 'pages'
  | 'generated-preview'
  | 'manifest'
  | 'font-specimen'
  | 'scene'
  | 'mesh-diagnostics'
  // Authored HTML behavior runs only inside the sandboxed document.
  | 'interactivity';

// The minimal view a profile needs, so the registry stays framework-agnostic
// and testable without constructing a FileDef.
export interface FileTypeInput {
  name?: string | null;
  contentType?: string | null;
}

export interface FileTypeProfile {
  id: string;
  family: FileFamily;
  kind: string;
  previewKind: string;
  previewAdapter: PreviewAdapter;
  previewSource: PreviewSource;
  capabilities: readonly FileCapability[];
}

const GENERIC: FileTypeProfile = {
  id: 'generic',
  family: 'generic',
  kind: 'File',
  previewKind: 'generic',
  previewAdapter: 'fallback',
  previewSource: 'fallback',
  capabilities: [],
};

const IMAGE: FileTypeProfile = {
  id: 'image',
  family: 'image',
  kind: 'Image',
  previewKind: 'photo',
  previewAdapter: 'media',
  previewSource: 'native',
  capabilities: ['native-preview', 'dimensions'],
};

const AUDIO: FileTypeProfile = {
  id: 'audio',
  family: 'audio',
  kind: 'Audio',
  previewKind: 'waveform',
  previewAdapter: 'media',
  previewSource: 'native',
  capabilities: ['native-preview', 'duration', 'playback', 'timed-text'],
};

const VIDEO: FileTypeProfile = {
  id: 'video',
  family: 'video',
  kind: 'Video',
  previewKind: 'video',
  previewAdapter: 'media',
  previewSource: 'native',
  capabilities: [
    'native-preview',
    'dimensions',
    'duration',
    'playback',
    'timed-text',
    'generated-preview',
  ],
};

// MIDI stays distinct from sampled/encoded audio: it is a note sequence that
// only becomes sound through a synthesizer.
const MIDI: FileTypeProfile = {
  id: 'midi',
  family: 'music',
  kind: 'MIDI sequence',
  previewKind: 'midi',
  previewAdapter: 'midi',
  previewSource: 'native',
  capabilities: [
    'native-preview',
    'sequence',
    'synthesis',
    'playback',
    'duration',
  ],
};

const profile = (
  id: string,
  family: FileFamily,
  kind: string,
  previewKind: string,
  previewAdapter: PreviewAdapter,
  previewSource: PreviewSource,
  capabilities: readonly FileCapability[],
): FileTypeProfile => ({
  id,
  family,
  kind,
  previewKind,
  previewAdapter,
  previewSource,
  capabilities,
});

// MIME type is the primary routing evidence.
const PROFILE_BY_CONTENT_TYPE: Record<string, FileTypeProfile> = {
  'image/jpeg': { ...IMAGE, id: 'jpeg', kind: 'JPEG image' },
  'image/png': { ...IMAGE, id: 'png', kind: 'PNG image' },
  'image/gif': {
    ...IMAGE,
    id: 'gif',
    kind: 'GIF image',
    previewKind: 'gif',
    capabilities: [...IMAGE.capabilities, 'animation'],
  },
  'image/webp': { ...IMAGE, id: 'webp', kind: 'WebP image' },
  'image/avif': { ...IMAGE, id: 'avif', kind: 'AVIF image' },
  'image/svg+xml': {
    ...IMAGE,
    id: 'svg',
    kind: 'SVG vector',
    previewKind: 'svg',
  },
  'audio/mpeg': { ...AUDIO, id: 'mp3', kind: 'MP3 audio' },
  'audio/wav': { ...AUDIO, id: 'wav', kind: 'WAV audio' },
  'audio/x-wav': { ...AUDIO, id: 'wav', kind: 'WAV audio' },
  'audio/mp4': { ...AUDIO, id: 'm4a', kind: 'M4A audio' },
  'audio/ogg': { ...AUDIO, id: 'ogg', kind: 'Ogg audio' },
  'audio/flac': { ...AUDIO, id: 'flac', kind: 'FLAC audio' },
  'audio/midi': MIDI,
  'audio/mid': MIDI,
  'audio/x-midi': MIDI,
  'application/x-midi': MIDI,
  'video/mp4': { ...VIDEO, id: 'mp4', kind: 'MP4 video' },
  'video/webm': { ...VIDEO, id: 'webm', kind: 'WebM video' },
  'video/quicktime': { ...VIDEO, id: 'mov', kind: 'QuickTime video' },
  // HTML is both inspectable source and a browser-native document.
  'text/html': profile(
    'html',
    'web',
    'HTML document',
    'html',
    'html',
    'native',
    ['native-preview', 'text-preview', 'interactivity'],
  ),
  'text/markdown': profile(
    'markdown',
    'document',
    'Markdown',
    'markdown',
    'text',
    'extracted',
    ['text-preview', 'rich-text'],
  ),
  'text/plain': profile(
    'text',
    'document',
    'Plain text',
    'doc',
    'text',
    'extracted',
    ['text-preview'],
  ),
  'text/typescript': profile(
    'typescript',
    'code',
    'TypeScript',
    'code',
    'text',
    'extracted',
    ['text-preview'],
  ),
  'text/typescript+glimmer': profile(
    'gts',
    'code',
    'Glimmer TS',
    'schema',
    'schema',
    'extracted',
    ['text-preview', 'schema-summary'],
  ),
  'application/json': profile(
    'json',
    'data',
    'JSON',
    'json',
    'data',
    'extracted',
    ['text-preview', 'structured-data'],
  ),
  'text/csv': profile('csv', 'data', 'CSV data', 'csv', 'data', 'extracted', [
    'text-preview',
    'structured-data',
  ]),
  'application/pdf': profile(
    'pdf',
    'document',
    'PDF document',
    'pdf',
    'document',
    'native',
    ['native-preview', 'pages'],
  ),
  'application/zip': profile(
    'zip',
    'archive',
    'ZIP archive',
    'archive',
    'archive',
    'extracted',
    ['manifest'],
  ),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    profile(
      'docx',
      'document',
      'Word document',
      'docx',
      'document',
      'generated',
      ['pages', 'generated-preview'],
    ),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    profile(
      'pptx',
      'document',
      'Presentation',
      'slide',
      'document',
      'generated',
      ['pages', 'generated-preview'],
    ),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': profile(
    'xlsx',
    'data',
    'Workbook',
    'sheet',
    'data',
    'generated',
    ['structured-data', 'generated-preview'],
  ),
  'font/woff2': profile(
    'woff2',
    'font',
    'Variable font',
    'font',
    'font',
    'native',
    ['native-preview', 'font-specimen'],
  ),
  'font/woff': profile('woff', 'font', 'Web font', 'font', 'font', 'native', [
    'native-preview',
    'font-specimen',
  ]),
  'font/ttf': profile(
    'ttf',
    'font',
    'TrueType font',
    'font',
    'font',
    'native',
    ['native-preview', 'font-specimen'],
  ),
  'font/otf': profile(
    'otf',
    'font',
    'OpenType font',
    'font',
    'font',
    'native',
    ['native-preview', 'font-specimen'],
  ),
  'model/gltf-binary': profile(
    'glb',
    'model',
    'glTF binary',
    'model',
    'model',
    'native',
    ['native-preview', 'scene'],
  ),
  'model/gltf+json': profile(
    'gltf',
    'model',
    'glTF model',
    'model',
    'model',
    'native',
    ['native-preview', 'scene'],
  ),
  // IANA-registered 3MF media type.
  'model/3mf': profile(
    '3mf',
    'model',
    '3MF manufacturing model',
    'model',
    'model',
    'extracted',
    ['native-preview', 'scene', 'manifest'],
  ),
  // Legacy server MIME for the same format.
  'application/vnd.ms-3mfdocument': profile(
    '3mf',
    'model',
    '3MF manufacturing model',
    'model',
    'model',
    'extracted',
    ['native-preview', 'scene', 'manifest'],
  ),
  // The IANA STL type covers both ASCII and binary triangle meshes.
  'model/stl': profile(
    'stl',
    'model',
    'STL triangle mesh',
    'model',
    'model',
    'native',
    ['native-preview', 'scene', 'mesh-diagnostics'],
  ),
  'application/octet-stream': {
    ...GENERIC,
    id: 'binary',
    kind: 'Unknown binary',
  },
};

// Extension fallback covers files served without a useful content type.
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mid: 'audio/midi',
  midi: 'audio/midi',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  html: 'text/html',
  htm: 'text/html',
  pdf: 'application/pdf',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  '3mf': 'model/3mf',
  stl: 'model/stl',
  bin: 'application/octet-stream',
};

const ADAPTER_BY_PREVIEW_KIND: Record<string, PreviewAdapter> = {
  photo: 'media',
  gif: 'media',
  svg: 'media',
  video: 'media',
  waveform: 'media',
  midi: 'midi',
  html: 'html',
  markdown: 'text',
  doc: 'text',
  code: 'text',
  schema: 'schema',
  json: 'data',
  csv: 'data',
  sheet: 'data',
  pdf: 'document',
  docx: 'document',
  slide: 'document',
  archive: 'archive',
  font: 'font',
  model: 'model',
  generic: 'fallback',
};

export function extensionOfFile(file: FileTypeInput): string {
  let name = file.name ?? '';
  let dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// What a server sends for anything it declined to identify. It carries no
// routing information, so it must not out-rank the file's own extension.
const UNINFORMATIVE_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
]);

// A `charset` parameter is common on text responses and would defeat an
// exact-match lookup.
function declaredContentType(file: FileTypeInput): string {
  return (file.contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

export function contentTypeForFile(file: FileTypeInput): string {
  let declared = declaredContentType(file);
  let byExtension = CONTENT_TYPE_BY_EXTENSION[extensionOfFile(file)];
  if (!declared || UNINFORMATIVE_CONTENT_TYPES.has(declared)) {
    return byExtension ?? declared;
  }
  return declared;
}

export function profileForFile(file: FileTypeInput): FileTypeProfile {
  let declared = declaredContentType(file);
  let extension = extensionOfFile(file);
  let byExtension = CONTENT_TYPE_BY_EXTENSION[extension];
  // The declared type is the better evidence, except when it's the "I don't
  // know" answer — then the extension gets first look and octet-stream is only
  // consulted as the fallback that names the file an unknown binary.
  let candidates = UNINFORMATIVE_CONTENT_TYPES.has(declared)
    ? [byExtension, declared]
    : [declared, byExtension];
  for (let candidate of candidates) {
    let profile = candidate ? PROFILE_BY_CONTENT_TYPE[candidate] : undefined;
    if (profile) {
      return profile;
    }
  }
  // An unregistered type in a known family still routes to that family.
  if (declared.startsWith('image/')) {
    return IMAGE;
  }
  if (declared.startsWith('audio/')) {
    return AUDIO;
  }
  if (declared.startsWith('video/')) {
    return VIDEO;
  }
  return extension
    ? { ...GENERIC, id: extension, kind: `${extension.toUpperCase()} file` }
    : GENERIC;
}

export function previewAdapterForKind(previewKind?: string): PreviewAdapter {
  return ADAPTER_BY_PREVIEW_KIND[previewKind ?? 'generic'] ?? 'fallback';
}
