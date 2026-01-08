import { lookup as lookupMimeType } from 'mime-types';

const DEFAULT_FILE_CONTENT_TYPE = 'application/octet-stream';
const CONTENT_TYPE_OVERRIDES: Record<string, string> = {
  '.gts': 'text/typescript+glimmer',
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
