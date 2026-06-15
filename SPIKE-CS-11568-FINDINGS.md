# Spike CS-11568 — FileDef nested polymorphic FieldDef round-trip

## Question

Can a `FileDef` subclass carry a nested polymorphic `FieldDef` value — a
`contains(SomeBaseField)` field whose concrete runtime instance is a SUBCLASS
(e.g. `SkillField`) holding a `containsMany(CommandField)` — and round-trip
cleanly through `extractAttributes()` → index write → rehydrate as the correct
subclass with the nested `commands` array intact?

## Verdict: **CONDITIONAL GO** — the platform _capability_ is fully present, but

the _indexing write path_ needs one targeted change to use it.

The serialize/deserialize machinery already supports FileDef nested polymorphism
identically to CardDef. The **only** gap is that the indexing pipeline hand-builds
the file resource and never emits the per-field `meta.fields.<name>.adoptsFrom`
marker. Close that one gap and the round-trip works; leave it and the polymorphic
field rehydrates as the **base** class (subclass identity lost, though the nested
data survives as loose attributes).

---

## Evidence (traced, file:line)

### Read half — WORKS (shared code path, already proven for CardDef)

- `createFromSerialized` → `_createFromSerialized` → `_updateFromSerialized` in
  `packages/base/card-api.gts` is **shared between CardDef and FileDef**. It is
  entered for FileDef because `isFileMetaResource(data)` is true for a
  `type: 'file-meta'` resource (`packages/base/card-api.gts:4065`).
- `_updateFromSerialized` applies per-field subclass overrides for BOTH
  `contains` and `containsMany` by reading `resource.meta.fields.<name>.adoptsFrom`:
  - `contains` branch: `packages/base/card-api.gts:4328-4335`
  - `containsMany` branch: `packages/base/card-api.gts:4292-4327`
  - override resolution: `setDeserializedFieldOverride`
    (`packages/base/card-api.gts:4216-4241`) → `loadCardDef(overrideMeta.adoptsFrom)`.
- The recursion that turns nested attributes into a subclass instance is
  `Contains.deserialize` (`packages/base/card-api.gts:1083-1118`), which builds a
  child resource `{ attributes: value, meta: makeMetaForField(fieldMeta, ...) }`
  and recurses — **not gated on CardDef vs FileDef**.
- `FileMetaResource.meta` is typed `Meta & {…}` and `Meta.fields?: CardFields`
  (`packages/runtime-common/resource-types.ts:53-56, 111-121, 142-155`), and the
  wire-format guard explicitly validates `meta.fields` via `isCardFields`
  (`packages/runtime-common/card-document-shape.ts:279`). So `meta.fields` is a
  first-class, supported part of the file-meta wire format.
- This is the **same machinery** as the passing CardDef test
  `packages/host/tests/integration/components/serialization-test.gts:3013`
  ("can deserialize a nested polymorphic contains field"). My POC mirrors it for
  FileDef.

### Serialize half — WORKS

- `serializeFileDef` (`packages/base/card-serialization.ts:316-374`) delegates to
  `serializeCardResource` — the **same serializer CardDef uses**. That serializer
  emits per-field `meta.fields.<name>.adoptsFrom` via `makeMetaForField`
  (`packages/base/card-serialization.ts:159-175`). So a _live_ FileDef subclass
  instance with the polymorphic field set serializes to the exact document the
  read half needs.

### Write/index half — THE GAP (precise location)

The indexing pipeline does **not** serialize a live instance. It hand-builds the
resource from the flat POJO returned by `extractAttributes`:

- `FileDef.extractAttributes` returns a flat `SerializedFile` POJO, no `meta`
  (`packages/base/card-api.gts:2997-3031`). `MarkdownDef.extractAttributes`
  likewise returns a flat object (`packages/base/markdown-file-def.gts:489-530`).
- The host extractor wraps that POJO with **`buildFileResource`**
  (`packages/host/app/utils/file-def-attributes-extractor.ts:399-428`), which:
  - sets `meta.adoptsFrom` to the **top-level FileDef class only**
    (`adoptsFrom = typeCodeRefs[0]`, line 201),
  - spreads `attributes` flat,
  - **never emits `meta.fields`**. ← **THIS IS THE GAP.**
- The indexer then writes `searchData` by spreading `searchDoc` flat
  (`packages/runtime-common/index-runner/file-indexer.ts:214-220`) and stores the
  `resource` from `buildFileResource` (line 213). So whatever `meta.fields` would
  have been needed never enters the index.

**Consequence:** on read-back, the polymorphic `frontmatter` field has no
`meta.fields.frontmatter.adoptsFrom`, so `setDeserializedFieldOverride` returns
false and the field deserializes as the **base** `FrontmatterField`. The nested
`commands` array data still rides along in `attributes.frontmatter`, but it is
not typed as a `SkillField` and `commands` would only materialize if the base
class declared it.

### Minimal platform change that closes the gap

`extractAttributes` must produce (and the indexer must preserve) the per-field
meta. The cleanest design, since all the machinery exists:

1. Have the polymorphic `FileDef.extractAttributes` build a **live** instance
   (set `frontmatter` to a `SkillField` instance) and return
   `serializeFileDef(instance)` (or its `data.attributes` + `data.meta`) instead
   of a hand-rolled flat POJO. `serializeFileDef` already emits the correct
   `meta.fields`.
2. Make `buildFileResource` (or the extractor) **pass through** a `meta.fields`
   supplied by extraction rather than discarding it — i.e. merge
   `searchDoc`-supplied field meta into the resource `meta`. Today it only sets
   `adoptsFrom` (file-def-attributes-extractor.ts:418-426).

Both are localized to `file-def-attributes-extractor.ts` + the FileDef subclass's
`extractAttributes`; no change to the deserialize side. (`search_doc` itself
stays flat — that's fine; the typed reconstruction reads from
`resource.attributes` + `resource.meta.fields`, not from `search_doc`.)

---

## Contingency: store rich data FLAT in `search_doc` + reconstruct via computed getter

**Viable, low cost, and recommended as the immediate path** if you don't want to
touch the index write path yet:

- Write flat primitives (`kind`, `name`, `description`) AND a JSON blob of the
  command list into `search_doc` from `extractAttributes` (top-level keys are
  preserved verbatim by `buildFileResource`, confirmed in POC test 4).
- Reconstruct the `frontmatter` field as a **computed `contains(FrontmatterField)`**
  getter that reads those flat attributes and instantiates the right subclass at
  runtime based on `kind`. Cost: the computed getter must do the kind→subclass
  dispatch itself (it can't rely on `meta.fields`), and the field is read-only /
  derived. This sidesteps the write-path gap entirely.
- Trade-off vs. the platform fix: the contingency keeps the polymorphism in
  userland (getter logic) instead of the wire format; it's robust and ships
  today, but every consumer reads a computed value rather than a truly persisted
  polymorphic field.

## Confirmed: the low-risk half (flat filterable `kind`) works

A flat `kind` written to `search_doc` is filterable. `searchFiles`
(`packages/runtime-common/index-query-engine.ts:807`) supports the full
eq/in/matches/range algebra over `search_doc`. `buildFileResource` preserves
flat top-level keys verbatim (POC test 4 asserts `resource.attributes.kind ===
'skill'`), and the indexer spreads them into `searchData`
(file-indexer.ts:214-220) → `search_doc`. So
`searchFiles({ filter: { eq: { kind: 'skill' } } })` is sound.

---

## POC

Location:
`packages/host/tests/integration/components/spike-cs-11568-filedef-poly-test.gts`

Four tests:

1. **READ HALF** — `createFromSerialized` of a `file-meta` doc carrying
   `meta.fields.frontmatter.adoptsFrom: SkillField` rehydrates `frontmatter` as
   `SkillField` with `commands.length === 2`.
2. **SERIALIZE HALF** — `serializeFileDef` of a live FileDef subclass instance
   emits `meta.fields.frontmatter.adoptsFrom === SkillField` and the nested
   commands in attributes.
3. **WRITE-PATH GAP** — `buildFileResource` (the indexing path) emits
   `meta.adoptsFrom` but `meta.fields === undefined` (gap pinned); nested data
   survives only as untyped attributes.
4. **CONTINGENCY / low-risk half** — flat `kind` is preserved verbatim in
   `resource.attributes` (filterable via `searchFiles`).

### How to run

The POC is a `@cardstack/host` integration test. Run via the host test harness:

```
cd packages/host
pnpm test:ember   # vite build --mode development && ember test --path dist
# filter to just this module once the test server is up:
#   ?filter=spike%20CS-11568
```

This requires the host test-services stack (base realm server, prerender, test
Postgres) to be running. See "Environment blocker" below — it was NOT runnable
in this worktree.

### Validation performed

- **Type-check PASS**: `cd packages/host && pnpm lint:types` reports **zero
  errors in the POC file**, both before and after building boxel-ui. (All other
  type errors in the run are pre-existing `@cardstack/boxel-ui`/`boxel-icons`
  module-resolution noise and pre-existing `CssVariableFieldEntry` errors in
  base theme files — none in spike code.)
- The POC's read-half assertion is the **same code path** as the already-passing
  `serialization-test.gts:3013` CardDef test, applied to a `file-meta` resource.

## Environment blocker (why no empirical test run)

Running host integration tests locally is documented-broken in project memory
("Host test harness window.require boot failure" — `ember test --path dist`
aborts ALL host tests at boot locally; use the full `test-services:host` stack or
CI). The worktree had no `node_modules`/`dist` initially; I ran `pnpm install`
(ok) and built boxel-ui (`build:js` succeeded; `build:types` failed only on
unbuilt `@cardstack/boxel-icons`). Standing up the full test-services stack
(Postgres + prerender + realm servers) for a single integration test is
disproportionate and fragile per documented experience, so per the spike's
fallback instruction I relied on **type-check + a complete shared-code-path
trace**. The determination is strong because the read half is literally the same
function the passing CardDef polymorphism test exercises.

## Bottom line for CS-11545

- **GO** on the design: `MarkdownDef` _can_ gain a polymorphic
  `contains(FrontmatterField)` that rehydrates as `SkillField`-with-`commands`.
- **Required platform work**: make `FileDef.extractAttributes` emit field meta
  (via `serializeFileDef` on a live instance) and make `buildFileResource` pass
  `meta.fields` through instead of discarding it. Localized, no deserialize-side
  change.
- **Ship-today alternative**: flat `search_doc` (`kind`/`name`/`description` +
  command JSON) + a computed `frontmatter` getter that dispatches on `kind`.
- **Already safe**: flat `kind` filtering via `searchFiles` works with no change.
