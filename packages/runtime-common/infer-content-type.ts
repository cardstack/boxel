import { lookup as lookupMimeType } from 'mime-types';

const DEFAULT_FILE_CONTENT_TYPE = 'application/octet-stream';
const CONTENT_TYPE_OVERRIDES: Record<string, string> = {
  '.gts': 'text/typescript+glimmer',
  '.gjs': 'text/javascript+glimmer',
  '.ts': 'text/typescript',
  // mime-db has no entry for JSON Lines, and an unknown extension resolves to
  // binary content — which a line-oriented format is not.
  '.jsonl': 'application/jsonl',
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
// +json / +xml structured-syntax suffix. Some formats are spelled differently
// across mime-db releases (.sql is application/x-sql in mime-db 1.52 and the
// IANA-registered application/sql in 1.54), so both spellings are listed:
// a lookup that resolves to either must land on the same side.
const TEXTUAL_APPLICATION_TYPES = new Set([
  'application/json',
  'application/jsonl',
  'application/javascript', // .js, .mjs
  'application/ecmascript',
  'application/node', // .cjs
  'application/xml',
  'application/x-sh',
  'application/sql',
  'application/x-sql',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
]);

const TEXTUAL_SUFFIXES = ['+json', '+xml', '+html', '+source'];

// A content type is binary unless it is known to be textual. Anything
// unrecognized resolves to application/octet-stream and therefore lands on the
// binary side, which is the byte-preserving default: binary handling moves
// bytes verbatim, while text handling UTF-8-decodes content and replaces
// invalid sequences with U+FFFD. Misclassifying text as binary keeps the
// bytes intact; misclassifying binary as text corrupts them.
export function isBinaryContentType(contentType: string): boolean {
  let mimeType = bareType(contentType);
  if (mimeType.startsWith('text/')) {
    return false;
  }
  // Structured-syntax suffixes mark text-based formats that happen to live
  // under other top-level types: image/svg+xml is XML, and the platform's own
  // vendor types (application/vnd.card+source, application/vnd.card+html)
  // carry card source and rendered markup.
  if (TEXTUAL_SUFFIXES.some((suffix) => mimeType.endsWith(suffix))) {
    return false;
  }
  return !TEXTUAL_APPLICATION_TYPES.has(mimeType);
}

// Whether a content type carries a JSON document: the JSON media type itself,
// and the structured-syntax suffix every type that is JSON underneath ends
// with. Both are textual, so this is a narrower question than
// `isBinaryContentType` asks — what it answers for is a caller whose change to
// the content has to leave a JSON document behind, which appending to the end
// of one does not.
export function isJSONContentType(contentType: string): boolean {
  let mimeType = bareType(contentType);
  return mimeType === 'application/json' || mimeType.endsWith('+json');
}

// A media type without its parameters (e.g. `text/plain; charset=utf-8`), so a
// header value classifies the same as the bare type.
function bareType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

// Classify by filename. Callers holding a response should prefer
// `isBinaryContentType` with the served content type: the realm resolves
// extension fallbacks (a card id like `Cards/my-card` is served from
// `Cards/my-card.json`), so the served type describes the bytes that actually
// arrived while the requested name may carry no extension at all.
export function isBinaryFilename(filename: string): boolean {
  return isBinaryContentType(inferContentType(filename));
}
