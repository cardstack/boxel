import { computeContentHash } from './content-hash.ts';
import { inferContentType } from './infer-content-type.ts';

// Shared trusted extraction bodies. These operate on bytes/data and never
// import a card definition or require a browser. Byte acquisition belongs to
// the caller, and is skipped when its content metadata is complete.
export async function baseFileData(
  url: string,
  getBytes: () => Promise<Uint8Array>,
  options: { contentHash?: string; contentSize?: number } = {},
) {
  let parsed = new URL(url);
  let name = decodeURIComponent(
    parsed.pathname.split('/').pop() ?? parsed.pathname,
  );
  let contentType = inferContentType(name);
  let { contentHash, contentSize } = options;
  if (!contentHash || contentSize === undefined) {
    let bytes = await getBytes();
    if (!contentHash) contentHash = computeContentHash(bytes);
    if (contentSize === undefined) contentSize = bytes.byteLength;
  }
  return {
    sourceUrl: url,
    url,
    name,
    contentType,
    contentHash,
    contentSize,
  };
}

export function jsonValueKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function jsonFileData(text: string, name: string) {
  let dot = name.lastIndexOf('.');
  let slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  let title = dot === -1 || dot < slash ? name : name.slice(0, dot);
  let trimmed = text.trim();
  let excerpt =
    trimmed.length <= 500 ? trimmed : `${trimmed.slice(0, 497).trimEnd()}...`;
  let rootType = '';
  let keyCount = 0;
  try {
    let parsed = JSON.parse(text);
    rootType = jsonValueKind(parsed);
    if (rootType === 'array') keyCount = parsed.length;
    else if (rootType === 'object') keyCount = Object.keys(parsed).length;
  } catch {
    // Invalid JSON retains its source and has no structural summary.
  }
  return {
    title: title || 'Untitled JSON',
    excerpt,
    content: text,
    rootType,
    keyCount,
    lineCount: text
      ? text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length
      : 0,
  };
}

// Shared by the trusted TS/GTS FileDefs and the native file producer.
export function codeFileData(source: string, name: string) {
  const compact = source.replace(/\s+/g, ' ').trim();
  return {
    title: name.replace(/\.[^/.]+$/, ''),
    excerpt:
      compact.length <= 500 ? compact : `${compact.slice(0, 497).trimEnd()}...`,
    content: source,
    lineCount: source
      ? source.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length
      : 0,
  };
}
