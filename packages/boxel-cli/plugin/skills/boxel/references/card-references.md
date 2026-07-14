# Card References in JSON instances — relative paths, `$REALM`, prefix mappings

How `links.self` (and any other card reference string) resolves when a realm reads JSON. **Get the leading dot wrong and the entire card silently fails to deserialize** — relationships drop, type-filtered search returns nothing, and the host throws `Cannot resolve bare package specifier`.

## The cardinal rule

Every `links.self` in a JSON instance MUST start with one of:

- `./` — same-realm sibling reference (root-instance form), e.g. `./Theme/atlas-launch`
- `../` — same-realm relative reference (nested-instance form), e.g. `../LaunchOwner/maya-chen`
- `http://` or `https://` — absolute URL to a card in any realm
- A registered prefix (e.g. `@cardstack/base/...`) that the host's `VirtualNetwork` knows about

A bare `Foo/bar` (no leading `./`) gets interpreted as a **bare package specifier** and throws.

## What happens when you skip the dot

```json
{
  "relationships": {
    "cardInfo.theme": {
      "links": { "self": "Theme/atlas-launch" }
    }
  }
}
```

This throws at deserialize time:

```
Cannot resolve bare package specifier "Theme/atlas-launch" — no matching prefix mapping registered
```

The card never indexes; relationships disappear; type-filtered search returns zero rows. The error surfaces in the realm-server log but **isn't visible from the UI** — looks like the card simply doesn't exist.

## The correct shapes

```json
{
  "relationships": {
    "cardInfo.theme": {
      "links": { "self": "./Theme/atlas-launch" }
    },
    "owner": {
      "links": { "self": "../LaunchOwner/maya-chen" }
    },
    "externalLanding": {
      "links": { "self": "https://example-realm.test/Landing/index" }
    }
  }
}
```

From a card at `<realm>/index.json`, `./Theme/atlas-launch` resolves to `<realm>/Theme/atlas-launch`. From a card at `<realm>/LaunchProduct/atlas-neural-search.json`, the equivalent is `../Theme/atlas-launch` (one level up, then into `Theme/`).

## File-typed relationships need the file extension

When linking to a FileDef subclass (`MarkdownDef`, `PngDef`, `CsvFileDef`, etc.) the relationship path is the **actual filename**, including extension:

```json
"sourceBrief": {
  "links": { "self": "../launch-evidence-brief.md" }
}
```

Card-instance links can omit `.json` because card IDs are extensionless; file links cannot.

Symptom of dropping the extension: the file exists in the realm and indexes correctly as `MarkdownDef`, but the _parent card_ doesn't appear in type-filtered search because the relationship fails to resolve.

## Where these rules come from (source map)

- **`resolveCardReference()` in `packages/runtime-common/card-reference-resolver.ts`** is the resolver used by `LinksTo.deserialize()` and the realm-index relationship resolver. It only treats refs as URL-like when they start with `.`, `/`, `http://`, `https://`, or match a registered prefix. A bare `Foo/bar` falls through to the bare-package-specifier branch and throws.
- **`packages/base/card-serialization.ts` `maybeRelativeURL()`** is the serializer that writes relationships out. It computes portable same-realm links with explicit relative syntax. This is why reading an _indexed_ card via the API can surface an absolute URL while the source `.json` should still prefer `./...` or `../...` for portability.
- **`packages/realm-server/tests/card-endpoints-test.ts`** uses `linksTo(MarkdownDef)` fixtures with `self: '../instructions.md'`; file-meta tests confirm markdown files are indexed by extension-backed filename.

## Don't confuse `resolveRRI()` rules

`resolveRRI()` has _newer_ and _broader_ rules. It accepts bare relative names when a `relativeTo` is supplied; it supports `$REALM/...` tokens; it supports registered-prefix forms like `@cardstack/<package>/<path>`.

**Those rules don't apply to `links.self` in card JSON.** Relationship deserialization calls `resolveCardReference()`, not `resolveRRI()`. Don't generalize from RRI-test expectations to card-instance JSON.

## `$REALM`, `$thisRealm`, and what they're NOT for

- **`$REALM`** is the modern realm-token form, defined as `THIS_REALM_TOKEN = '$REALM'` in `packages/runtime-common/query-field-utils.ts`. Use it in **query realm tokens** (e.g. inside a `realms` array of a Query) and the platform contexts that explicitly support it.
- **`$thisRealm`** is the deprecated predecessor; the monorepo carries a migration script that rewrites `$thisRealm` → `$REALM`. Don't author new uses.
- **Neither token replaces a relative `links.self`**. Inside relationship JSON, the canonical portable form is still `./Foo/bar` or `../Foo/bar`.

## `@cardstack/...` isn't magic for arbitrary files

`VirtualNetwork.addRealmMapping()` registers scoped realm prefixes so `@cardstack/base/...` can resolve through prefix mappings; package/import-map handling can resolve **module imports** the same way. A local realm path like `Theme/atlas-launch` doesn't become a prefix-mapped specifier unless a prefix was explicitly registered for it.

If you see code that does `import X from '@cardstack/<something>/...'`, that's a module import — different resolver, different rules. Relationship `links.self` does not get the same treatment.

## Quick reference

| Form                    | What it means                       | Where it works                                                               |
| ----------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `./Foo/bar`             | Same-realm sibling reference        | `links.self` (root-instance origin)                                          |
| `../Foo/bar`            | Same-realm reference one level up   | `links.self` (nested-instance origin)                                        |
| `https://realm/Foo/bar` | Absolute URL                        | `links.self`, any context                                                    |
| `Foo/bar`               | **Bare package specifier — throws** | Never use in `links.self`                                                    |
| `$REALM/...`            | Realm-token expansion               | Query realm tokens, RRI helpers                                              |
| `@cardstack/<pkg>/...`  | Registered VirtualNetwork prefix    | Module imports + registered prefix mappings; not for arbitrary relationships |

## Failure-mode checklist

If a card "isn't showing up" in queries despite being in the realm:

1. Open the `.json` source. Every `links.self` should start with `./`, `../`, `http://`, `https://`, or a known prefix.
2. For file-typed relationships (`linksTo(MarkdownDef)` etc.), confirm the path includes the file extension.
3. Check the realm-server log for `Cannot resolve bare package specifier "..."` — that's the cardinal symptom.
4. If the card was migrated/copied from another realm, re-write each `links.self` with the appropriate relative form for the new realm's directory shape.

## See also

- `data-management.md` — JSON-instance file organization + relationship value patterns.
- `query-systems.md` — silent zero-rows traps; type filter, sort `on`, `codeRef`, `realmURL` Symbol.
- `boxel-file-def/references/using-filedef-in-cards.md` — file-typed relationships specifically.
