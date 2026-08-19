# Fresh-realm push integrity

A first deployment to a new or reset realm has an ordering hazard that ordinary sync output does not expose. The server serializes each instance against the schema available at write time. If an instance using a realm-defined `FieldDef` arrives before that definition is ready, nested `contains` / `containsMany` leaf values can be stored as `null` even though the upload succeeds and the card indexes.

## Recognize the symptom

- Card counts and array lengths are correct, but nested titles, bodies, colors, or metrics are blank.
- Local JSON still contains the values.
- Lint, parse, upload summaries, and type-search counts are clean.
- Reading the remotely stored JSON shows `null` nested leaves.

Treat this as a data-integrity problem before changing CSS or templates.

## Safe first-deployment order

1. Push all `.gts` definitions first.
2. Confirm every referenced CardDef and FieldDef is ready, for example with `get-card-type-schema` through `npx boxel run-command`.
3. Write `.json` instances only after their schemas resolve.
4. Read back representative instances containing nested realm-defined fields and compare their leaf values with the local files.
5. Run typed search and render validation after the content check.

Presence is not fidelity: `Uploaded`, a clean sync status, and the expected search count only prove that files exist.

## Repair

Once the schemas are ready, force a new `npx boxel file write` for every affected instance. A normal `realm sync` may not repair the server copy because the local file hash did not change, so the manifest can classify the corrupted remote file as already synchronized.

After rewriting, read the stored JSON again, verify nested leaf values, wait for indexing to settle, and only then publish.

## Scope

This primarily affects mixed first pushes containing both definitions and instances, especially instances with nested `contains` / `containsMany` values backed by realm-defined FieldDefs. Top-level base fields can survive, which makes partial corruption easy to mistake for a rendering bug.
