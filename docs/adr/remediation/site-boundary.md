# ADR site-boundary remediation

Places where the code does not meet
[ADR site-boundary](../site-boundary.md)
yet (ADR 001 §1.6). Each entry names a file by its path from the repository
root, in backticks, and the requirement it breaks.

`packages/realm-server/lib/site-boundary.ts`:

- `TEXT_TYPES` breaks §1.1: a card's source (`application/vnd.card+source`)
  passes through untranslated, so a visitor who asks for a source realm's
  module source sees its URLs.
- `siteBoundary` breaks §1.1 for a compressed body, which it passes through
  untranslated. The realm server doesn't compress today.

There is no host URL mapping yet. A site is a published copy of its realm,
which breaks §1.6 and §1.7 wherever it is made or served:

- `packages/realm-server/handlers/handle-publish-realm.ts` copies the realm
  into a second realm with its own Matrix user and index, rather than mapping
  a host URL to the realm itself. Breaks §1.7.
- `packages/realm-server/handlers/handle-publish-realm.ts`
  (`dropRealmPolicyPointer`) strips the policy pointer from the copy, so a
  site answers on its access list alone, not the realm's policy. Breaks §1.7.
- `packages/realm-server/handlers/handle-publish-realm.ts` writes
  `includePrerenderedDefaultRealmIndex` into the copy's `realm.json`. Breaks
  §1.6 (exposing writes nothing into the realm).
- `packages/realm-server/handlers/handle-publish-realm.ts` answers 202 and
  `packages/realm-server/handlers/handle-publish-progress.ts` serves the
  progress a client polls. Breaks §1.6 (a change takes effect when its request
  returns).
- `packages/realm-server/handlers/handle-unpublish-realm.ts` removes a copy,
  not a host URL. Breaks §1.6.
- `packages/realm-server/lib/host-routes.ts` (`siteMounts`) returns the
  request's own mount as the canonical one, since a realm has no canonical
  host URL yet. Breaks §1.6.
- `packages/host/app/routes/render/html.ts` reads
  `includePrerenderedDefaultRealmIndex` from `realm.json` to decide whether to
  prerender the default index card, rather than deciding per request. Breaks
  §1.6.
- `packages/realm-server/handlers/handle-unpublish-realm.ts` removes the copy
  but leaves its claimed site name in place, so the name isn't freed. Breaks
  §1.6.
