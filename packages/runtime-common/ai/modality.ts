// Maps MIME content types to OpenRouter input modality names.
// Used by both prompt construction (server-side) and the UI (client-side)
// to determine which modality a file requires.

// Only image formats broadly supported by OpenRouter providers (Anthropic, OpenAI, Google).
// Unsupported formats like AVIF, TIFF, BMP fall through to metadata-only.
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function isImageContentType(contentType?: string): boolean {
  return !!contentType && SUPPORTED_IMAGE_TYPES.has(contentType);
}

function isPdfContentType(contentType?: string): boolean {
  return !!contentType && contentType.includes('application/pdf');
}

function isAudioContentType(contentType?: string): boolean {
  return !!contentType && contentType.startsWith('audio/');
}

function isVideoContentType(contentType?: string): boolean {
  return !!contentType && contentType.startsWith('video/');
}

export type Modality = 'image' | 'file' | 'audio' | 'video';

export function requiredModality(contentType?: string): Modality | undefined {
  if (isImageContentType(contentType)) return 'image';
  if (isPdfContentType(contentType)) return 'file';
  if (isAudioContentType(contentType)) return 'audio';
  if (isVideoContentType(contentType)) return 'video';
  return undefined;
}

const MODALITY_LABELS: Record<Modality, string> = {
  image: 'image files',
  file: 'PDF files',
  audio: 'audio files',
  video: 'video files',
};

export function modalityLabel(modality: Modality): string {
  return MODALITY_LABELS[modality];
}

// Matches the server-side isTextBasedContentType in prompt.ts — files with
// these types get their full content downloaded and sent as text.
export function isTextBasedContentType(contentType?: string): boolean {
  return (
    !!contentType &&
    (contentType.includes('text/') ||
      contentType.includes('application/vnd.card+json'))
  );
}

export {
  isImageContentType,
  isPdfContentType,
  isAudioContentType,
  isVideoContentType,
};
