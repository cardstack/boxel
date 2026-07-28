import { lookup as lookupMimeType } from 'mime-types';

const DEFAULT_FILE_CONTENT_TYPE = 'application/octet-stream';
const CONTENT_TYPE_OVERRIDES: Record<string, string> = {
  '.gts': 'text/typescript+glimmer',
  '.ts': 'text/typescript',
  // 3MF (3D printing) — IANA-registered `model/3mf`; mime-db has no entry.
  '.3mf': 'model/3mf',
};

export function inferContentType(filename: string): string {
  let extensionIndex = filename.lastIndexOf('.');
  if (extensionIndex === -1) {
    return DEFAULT_FILE_CONTENT_TYPE;
  }
  let extension = filename.slice(extensionIndex).toLowerCase();
  let overrideContentType = CONTENT_TYPE_OVERRIDES[extension];
  if (overrideContentType) {
    return overrideContentType;
  }
  let mimeType = lookupMimeType(filename);
  return mimeType ? mimeType : DEFAULT_FILE_CONTENT_TYPE;
}

export function isBinaryFilename(filename: string): boolean {
  let mimeType = inferContentType(filename);
  // SVG is image/* but is XML-based text
  if (mimeType === 'image/svg+xml') return false;
  return (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('font/') ||
    mimeType.startsWith('audio/') ||
    mimeType === 'application/pdf' ||
    mimeType === 'application/vnd.ms-fontobject' || // .eot legacy font
    mimeType === 'model/3mf' // 3MF is a binary ZIP container
  );
}
