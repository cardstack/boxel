# Resolve room.gts auto-attach and the write-file / migrate-skill tools in identifier space

## Goal

Four host sites build a URL by passing a realm identifier to `new URL()`, each
under an `eslint-disable` of `@cardstack/boxel/no-url-from-realm-identifier`.
A realm identifier can be in prefix form (`@cardstack/catalog/`), and a
module reference can be too (`@cardstack/base/card-api`), so each site is
wrong for a prefix-mapped realm or module:

- `components/matrix/room.gts`: code-mode auto-attach joins a card's
  `adoptsFrom.module` onto the open file's URL. A prefix-form module comes
  out as `<realm>/<dir>/@cardstack/base/card-api.gts`.
- `tools/write-text-file.ts`, `tools/write-binary-file.ts`,
  `tools/migrate-skill.ts`: build the target with `new URL(path, realm)`,
  which throws when `realmOf` answers with a prefix-form realm.

## Approach

- **room.gts:** resolve the module through
  `virtualNetwork.resolveURL(moduleRef, openFile.url)`, which is
  `resolveRRI` + `toURL` (the approach `module-inspector.gts` uses) plus
  handling of a `/`-rooted reference. The attachment list holds fetchable
  source URLs, so resolving to a URL here is the network boundary.
- **The three tools:** build the target as an RRI with
  `new RealmPaths(realm).fileRRI(path)`. `getSource` and the
  non-conflicting-filename probe take the RRI directly; `saveSource` and the
  binary upload convert with `virtualNetwork.toURL()` immediately before the
  call. The tool results report the RRI, which is the same string as before
  for a URL-registered realm and the prefix form for a prefix-registered one.
- Without a `realm` input, the write tools still require `path` to be a
  complete identifier, and fail on one that resolves nowhere.
- All four eslint-disables removed.

## Out of scope

Retyping the card-service write APIs to accept RRIs.

## Tests

- `Acceptance | AI Assistant tests`: code mode on `index.json` (a CardsGrid
  adopting from `@cardstack/base/cards-grid`) auto-attaches the base realm's
  `cards-grid.gts`.
- `Integration | tools | write-text-file` and `write-binary-file`: each
  writes into the test realm registered under a temporary realm prefix, and
  reports the prefix-form identifier.
- migrate-skill has no prefix-realm test: its `store.search` over a realm the
  test knows only in prefix form fails before the write path runs, and
  covering it would mean mocking the store.

## Downstream of the write tools

The write tools report a prefix-form `fileIdentifier` for a realm registered
in prefix form, and show-file takes that identifier next, so show-file passes
it to `updateCodePath` as an RRI instead of parsing it with `new URL()`.
