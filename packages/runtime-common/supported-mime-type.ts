/* eslint-disable @typescript-eslint/no-duplicate-enum-values */
export enum SupportedMimeType {
  CardJson = 'application/vnd.card+json',
  CardSource = 'application/vnd.card+source',
  FileMeta = 'application/vnd.card.file-meta+json',
  DirectoryListing = 'application/vnd.api+json',
  RealmInfo = 'application/vnd.api+json',
  Mtimes = 'application/vnd.api+json',
  Permissions = 'application/vnd.api+json',
  Session = 'application/json',
  EventStream = 'text/event-stream',
  HTML = 'text/html',
  Markdown = 'text/markdown',
  JSONAPI = 'application/vnd.api+json',
  JSON = 'application/json',
  CardDependencies = 'application/json',
  CardTypeSummary = 'application/json',
  OctetStream = 'application/octet-stream',
  All = '*/*',
}
/* eslint-enable @typescript-eslint/no-duplicate-enum-values */

// True when a `Content-Type` header denotes a JSON-family media type —
// `application/json` or any structured-suffix variant (`+json`, e.g.
// `application/vnd.api+json`, `application/vnd.card+json`). Used to gate
// `response.json()` on paths that follow a relationship's `links.self`,
// so a link that points at a binary resource (an image URL, a PDF) is
// rejected with a clean error instead of feeding raw bytes to JSON.parse.
export function isJsonContentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) {
    return false;
  }
  // Strip parameters (e.g. `; charset=utf-8`) and normalize case.
  let mediaType = contentType.split(';')[0].trim().toLowerCase();
  return (
    mediaType === 'application/json' ||
    mediaType === 'text/json' ||
    mediaType.endsWith('+json')
  );
}
