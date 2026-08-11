# FileDef format regression fixtures

A licensed corpus of 108 file fixtures (36 file types × simple/moderate/complex tiers) plus the review surfaces that render them, for auditing FileDef rendering quality across all four card formats.

## Layout

- `samples/<type>-<tier>.<extension>` — the fixture files themselves. The realm indexes each one as a FileDef instance (typed by extension where a subclass exists, generic `FileDef` otherwise), so the fixtures need no wrapper cards. Extensions may have several segments (`.sample.gts`, `.data.json`) where the natural extension would collide with realm module or card-document handling expectations. The `samples/` tree is exempt from repository formatting tools (`.prettierignore` + the lint-staged verbatim-tree skip) so fixture bytes stay exactly what the integrity manifest records.
- `format-preview.gts` + `FormatPreview/*.json` — the format regression harness. One instance per file type carries that type's three fixture tiers and renders the selection across atom, embedded, isolated, and the 16 canonical fitted envelopes; `FormatPreview/all-file-types.json` is the cross-type index of complex fixtures.
- `file-embedding-field-guide.gts` + `file-embedding-field-guide.json` + `embedded-file-field-guide.md` — the embedded field guide: one reviewable document that renders every leaf type's embedded format through live `::file` references.
- `SOURCES.md` — provenance, license, attribution, and the byte-length/SHA-256 integrity manifest for every fixture.
- `QUALITY-AUDIT.md` — the acceptance gates each fixture satisfies and what each complex sample exercises.

## Review workflow

Open `FormatPreview/all-file-types` for a cross-type sweep, a type's dedicated `FormatPreview/<type>` page to compare its three tiers and walk the fitted envelope matrix, and `file-embedding-field-guide` to read every family's embedded rendering in document flow.

## Fixture contract

Fixture bytes are committed and served directly from disk; any intentional fixture change must update the integrity manifest in `SOURCES.md` and satisfy the gates in `QUALITY-AUDIT.md`. Keep every fixture under the realm's 5 MiB file limit, and keep everything under `samples/` byte-exact — formatting tools are deliberately kept away from that tree.
