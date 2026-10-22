// The JSON:API extension the operations envelope is defined by. It names the
// `invoke` verb and the `boxel:`-prefixed members the envelope carries, which
// is what a plain `application/vnd.api+json` body does not have — so the media
// type below carries it as the `ext` parameter, and the router matches a media
// type by its type and the extensions its `ext` names.
export const BOXEL_OPERATIONS_EXT = 'https://boxel.ai/ext/operations';

// A `const` object (rather than a TS `enum`) so the declaration is
// erasable and runs under Node's native `--experimental-strip-types`.
// The merged type below keeps `SupportedMimeType` usable as both a value
// (e.g. `SupportedMimeType.CardJson`) and a type. Several members share
// the same wire value intentionally (the `application/vnd.api+json` group).
export const SupportedMimeType = {
  CardJson: 'application/vnd.card+json',
  // The single-instance card+html GET: one `entry` sourced by URL (the
  // single-instance counterpart to `_search`), carrying the card's selected
  // rendering (`html`) plus its `item` serialization. `.file-meta` is the file
  // counterpart — a file rendering + its `file-meta` serialization.
  CardHtml: 'application/vnd.card+html',
  FileMetaHtml: 'application/vnd.card.file-meta+html',
  CardSource: 'application/vnd.card+source',
  FileMeta: 'application/vnd.card.file-meta+json',
  DirectoryListing: 'application/vnd.api+json',
  RealmInfo: 'application/vnd.api+json',
  Mtimes: 'application/vnd.api+json',
  Permissions: 'application/vnd.api+json',
  Session: 'application/json',
  EventStream: 'text/event-stream',
  HTML: 'text/html',
  Markdown: 'text/markdown',
  JSONAPI: 'application/vnd.api+json',
  // The operations envelope: a JSON:API document extended with the `invoke`
  // verb and the `boxel:operations` member. Spelled from the extension URI
  // above so the media type and the parameter a handler validates cannot drift
  // apart.
  BoxelOperations:
    `application/vnd.api+json;ext="${BOXEL_OPERATIONS_EXT}"` as const,
  JSON: 'application/json',
  CardDependencies: 'application/json',
  CardTypeSummary: 'application/json',
  OctetStream: 'application/octet-stream',
  All: '*/*',
} as const;
export type SupportedMimeType =
  (typeof SupportedMimeType)[keyof typeof SupportedMimeType];

// True for `application/json` or any `+json` structured-suffix type
// (e.g. `application/vnd.api+json`). Used to gate `response.json()` when
// following a relationship's `links.self`, so a link to a binary resource
// fails cleanly instead of feeding raw bytes to JSON.parse.
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
