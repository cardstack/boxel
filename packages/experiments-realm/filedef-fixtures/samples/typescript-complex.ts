/* Declarative file taxonomy. CardDef inheritance expresses stable product
   families; this registry composes MIME/extension routing, renderer choice,
   provenance, and capabilities without creating one subclass per extension. */

export type FileFamily = // Stable user-facing families, not MIME superclasses
  | 'generic'
  | 'image'
  | 'audio'
  | 'music' // Symbolic performance data is not encoded audio
  | 'video'
  | 'document'
  | 'code'
  | 'data'
  | 'archive'
  | 'font'
  | 'model';

export type PreviewAdapter = // Components are composed independently of family
  | 'fallback'
  | 'media'
  | 'text'
  | 'schema'
  | 'data'
  | 'document'
  | 'archive'
  | 'font'
  | 'model'
  | 'midi'; // Tone.js + @tonejs/midi sequence adapter

export type PreviewSource = 'native' | 'extracted' | 'generated' | 'fallback';

export type FileCapability = // Capability keys are future command-provider seams
  | 'native-preview'
  | 'text-preview'
  | 'rich-text'
  | 'structured-data'
  | 'schema-summary'
  | 'dimensions'
  | 'duration'
  | 'playback'
  | 'synthesis' // MIDI becomes sound only through an instrument renderer
  | 'sequence'
  | 'timed-text'
  | 'animation'
  | 'pages'
  | 'generated-preview'
  | 'manifest'
  | 'font-specimen'
  | 'scene';

export interface FileTypeInput { // Minimal parser view keeps the registry framework-agnostic
  name?: string;
  contentType?: string;
}

export interface FileTypeProfile { // One profile composes the orthogonal taxonomy axes
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

const MIDI: FileTypeProfile = { // Keep MIDI distinct from sampled/encoded audio
  id: 'midi',
  family: 'music',
  kind: 'MIDI sequence',
  previewKind: 'midi',
  previewAdapter: 'midi',
  previewSource: 'native',
  capabilities: ['native-preview', 'sequence', 'synthesis', 'playback', 'duration'],
};

const profile = ( // Profiles reuse family defaults while retaining literal routing data
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

const PROFILE_BY_CONTENT_TYPE: Record<string, FileTypeProfile> = { // MIME is primary routing evidence
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
  'text/csv': profile(
    'csv',
    'data',
    'CSV data',
    'csv',
    'data',
    'extracted',
    ['text-preview', 'structured-data'],
  ),
  'application/pdf': profile(
    'pdf',
    'document',
    'PDF document',
    'pdf',
    'document',
    'native', // PDF.js now renders authenticated realm bytes directly
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
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': profile(
    'docx',
    'document',
    'Word document',
    'docx',
    'document',
    'generated',
    ['pages', 'generated-preview'],
  ),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': profile(
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
  'font/woff': profile(
    'woff',
    'font',
    'Web font',
    'font',
    'font',
    'native',
    ['native-preview', 'font-specimen'],
  ),
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
    'native', // Three.js renders self-contained GLB bytes in the model adapter
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
  'application/octet-stream': {
    ...GENERIC,
    id: 'binary',
    kind: 'Unknown binary',
  },
};

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = { // Extension fallback covers parser-less binary files
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
  bin: 'application/octet-stream',
};

const ADAPTER_BY_PREVIEW_KIND: Record<string, PreviewAdapter> = { // Synthetic FileTwin fixtures use the same adapter grammar
  photo: 'media',
  gif: 'media',
  svg: 'media',
  video: 'media',
  waveform: 'media',
  midi: 'midi',
  markdown: 'text',
  doc: 'text',
  code: 'text',
  schema: 'schema',
  json: 'data',
  jsoncard: 'data',
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

export function extensionOfFile(file: FileTypeInput): string {  let name = file.name ?? '';
  let dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function contentTypeForFile(file: FileTypeInput): string {  return file.contentType ?? CONTENT_TYPE_BY_EXTENSION[extensionOfFile(file)] ?? '';
}

export function profileForFile(file: FileTypeInput): FileTypeProfile {  let contentType = contentTypeForFile(file);
  let exact = PROFILE_BY_CONTENT_TYPE[contentType];
  if (exact) {
    return exact;
  }
  if (contentType.startsWith('image/')) {
    return IMAGE;
  }
  if (contentType.startsWith('audio/')) {
    return AUDIO;
  }
  if (contentType.startsWith('video/')) {
    return VIDEO;
  }
  let extension = extensionOfFile(file);
  return extension
    ? { ...GENERIC, id: extension, kind: `${extension.toUpperCase()} file` }
    : GENERIC;
}

export function previewAdapterForKind(previewKind?: string): PreviewAdapter {  return ADAPTER_BY_PREVIEW_KIND[previewKind ?? 'generic'] ?? 'fallback';
}
