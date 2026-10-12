# CS-13671: describe copy-card's `localDir` as the target folder

## Goal

A model calling `copy-card` should know where the copy will land without
searching for it afterward. In the catalog-reuse eval, a model passed
`localDir: "Incident/2407-dashboard-sso"` as a file path. The copy landed at
`Incident/2407-dashboard-sso/Incident/<uuid>.json`, and the model spent five
`run-realm-code` turns finding it.

## How the path is built today

- `CopyCardToRealmTool.run` (`packages/host/app/tools/copy-card.ts`) calls
  `store.create(doc, { realm, localDir })`.
- `resolveDocUrl` (`packages/host/app/services/store.ts`) sends the `POST` to
  `<realm>/<localDir>/`, or to the realm root when `localDir` is unset.
- `#createCard` (`packages/runtime-common/realm.ts`) names a directory for the
  card's type beneath that, and generates the file name inside it. The copy
  ends up at `<localDir>/<CardTypeName>/<generated-id>.json`.

So `localDir` is a parent folder. The realm adds the type folder itself. If the
description only said "folder", a model wanting `Incident/` would pass
`Incident` and get `Incident/Incident/<id>.json`. The description has to name
both layers.

## Changes

The contract stays as it is. The descriptions spell out how the inputs combine
into the copy's path:

```
<targetRealm><localDir>/<CardTypeName>/<generated-id>.json
```

1. `packages/base/command.gts`, `CopyCardToRealmInput`: add a `description` to
   both `targetRealm` and `localDir`, following the `skipIndexWait` pattern.
   Drafts:
   - `targetRealm`:
     > URL of the realm to copy the card into, e.g.
     > `https://app.boxel.ai/me/my-realm/`. The copy is written to
     > `<targetRealm><localDir>/<CardTypeName>/<generated-id>.json`; see
     > `localDir`.
   - `localDir`:
     > Optional folder inside `targetRealm` to put the copy under. Not a file
     > path: the realm always adds a folder named after the card's type and
     > generates the file name, and neither can be chosen. Copying an
     > `Incident` card with `localDir: "projects/acme"` writes
     > `projects/acme/Incident/<generated-id>.json`. Unset writes
     > `Incident/<generated-id>.json` at the realm root. Passing `"Incident"`
     > writes `Incident/Incident/<generated-id>.json`.
2. `CopyCardToStackInput.localDir`: same description, adapted (no
   `targetRealm`; the realm is the stack's). `CopyCardToStackTool` also has to
   pass `localDir` on to `CopyCardToRealmTool`; it currently drops it, so the
   copy always lands at the realm root.
3. `packages/host/app/tools/copy-card.ts`: change the tool `description` from
   `'Copy a card to a realm'` to one that says the result's `newCardId` is the
   new card's URL. This covers the optional acceptance item without a schema
   change. The result card already carries `newCardId`, and the prompt
   serializes the result card into the tool message (`prompt.ts`
   "with result card: …").

### Not in this change

- No exact-path contract. A `targetPath` naming the exact file, with
  `targetRealm`/`localDir` hidden from the model's schema via
  `ignoreInputFields`, would work without breaking code callers (create via an
  atomic `add` at the chosen href). The descriptions are the chosen fix: the
  contract stays, and the model is told what it produces.
- No new result field such as a realm-relative path. `newCardId` is already
  returned, and the tool description now points at it.
- CS-13476 (`realm.fs.copy`) may make `copy-card` unnecessary for copies within
  one realm. Cross-realm copies, such as catalog reuse, still use `copy-card`.

## Tests

- `packages/host/tests/integration/tools/schema-generation-test.gts` (or the
  existing `copy-card-test.gts`): assert that the generated input schema for
  `copy-card` gives `localDir` a description stating the folder semantics.
- `copy-card-test.gts`: if no existing test covers it, add one that copies with
  `localDir: 'some/dir'` and asserts `newCardId` falls under
  `<realm>/some/dir/<TypeName>/`. This pins down the behavior the description
  promises.
- Run: `pnpm exec ember test --path dist --filter "copy-card"` (and the
  schema-generation module), with output saved to a file.
- `pnpm lint` in `packages/base` and `packages/host`.
