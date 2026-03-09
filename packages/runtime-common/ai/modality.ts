// Maps MIME content types to OpenRouter input modality names.
// Used by both prompt construction (server-side) and the UI (client-side)
// to determine which modality a file requires.

function isImageContentType(contentType?: string): boolean {
  return !!contentType && contentType.startsWith('image/');
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

export {
  isImageContentType,
  isPdfContentType,
  isAudioContentType,
  isVideoContentType,
};
