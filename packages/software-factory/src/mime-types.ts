/**
 * MIME type constants matching SupportedMimeType from @cardstack/runtime-common.
 *
 * Playwright's TypeScript loader cannot handle decorators in the
 * @cardstack/runtime-common barrel export. Files that are transitively
 * imported by Playwright spec files must use this module instead.
 *
 * ts-node contexts (scripts/, CLI entry points) can import directly from
 * @cardstack/runtime-common — only Playwright worker code needs this.
 */
export const SupportedMimeType = {
  CardJson: 'application/vnd.card+json' as const,
  CardSource: 'application/vnd.card+source' as const,
  FileMeta: 'application/vnd.card.file-meta+json' as const,
  DirectoryListing: 'application/vnd.api+json' as const,
  RealmInfo: 'application/vnd.api+json' as const,
  Mtimes: 'application/vnd.api+json' as const,
  Permissions: 'application/vnd.api+json' as const,
  Session: 'application/json' as const,
  EventStream: 'text/event-stream' as const,
  HTML: 'text/html' as const,
  JSONAPI: 'application/vnd.api+json' as const,
  JSON: 'application/json' as const,
  CardDependencies: 'application/json' as const,
  CardTypeSummary: 'application/json' as const,
  OctetStream: 'application/octet-stream' as const,
  All: '*/*' as const,
};
