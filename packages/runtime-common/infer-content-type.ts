import { lookup as lookupMimeType } from 'mime-types';

const DEFAULT_FILE_CONTENT_TYPE = 'application/octet-stream';
const CONTENT_TYPE_OVERRIDES: Record<string, string> = {
  '.gts': 'text/typescript+glimmer',
  '.ts': 'text/typescript',
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

// Textual application/* MIME types that carry neither a text/ prefix nor a
// +json / +xml structured-syntax suffix.
const TEXTUAL_APPLICATION_TYPES = new Set([
  'application/json',
  'application/javascript', // .js, .mjs
  'application/ecmascript',
  'application/node', // .cjs
  'application/xml',
  'application/x-sh',
  'application/x-sql',
  'application/toml',
]);

// A filename is binary unless its MIME type is known to be textual. Unknown
// extensions resolve to application/octet-stream and therefore land on the
// binary side, which is the byte-preserving default: binary handling moves
// bytes verbatim, while text handling UTF-8-decodes content and replaces
// invalid sequences with U+FFFD. Misclassifying text as binary keeps the
// bytes intact; misclassifying binary as text corrupts them.
export function isBinaryFilename(filename: string): boolean {
  let mimeType = inferContentType(filename);
  if (mimeType.startsWith('text/')) {
    return false;
  }
  // Structured-syntax suffixes mark XML/JSON-based formats that happen to
  // live under other top-level types, e.g. image/svg+xml.
  if (mimeType.endsWith('+json') || mimeType.endsWith('+xml')) {
    return false;
  }
  return !TEXTUAL_APPLICATION_TYPES.has(mimeType);
}
