# BXL mutate endpoint prototype

Prototype a realm-server `POST /_mutate` that applies current Mutation BXL
to a stored card JSON file as an alternative to PATCH. No operations layer.

## Goal

Show that a BXL program can update one card instance without reprinting the
document: plan against the on-disk JSON, write the mutated source, then reuse
the existing PATCH write/index/response path.

## Assumptions

- Keep the current `@cardstack/bxl` mutation planner and card-source adapter
  unchanged.
- Schema comes from the instance `adoptsFrom` via `CachingDefinitionLookup`.
- After BXL produces the next source document, `fileSerialization` +
  `_batchWriteUnlocked` + index echo behave as they do for PATCH.

## Endpoint

```
POST /_mutate
Accept: application/vnd.card+json
```

```json
{
  "href": "/person-1",
  "source": ".firstName = \"Van Gogh\";",
  "syntax": "solidified"
}
```

`syntax` defaults to `readable`. `href` accepts a realm-relative path, URL, or
registered RRI.

## Flow

1. Take the realm write lock (same as PATCH).
2. Read `<href>.json` from disk.
3. Look up the card definition and derive a mutation schema.
4. Run `mutateBxlCardSource`.
5. Canonicalize with `fileSerialization` and write the file.
6. Return the indexed card document.

## Local Tessar harness

The extracted `sample-screens-chris-tessar-admin` zip is mounted from
`packages/screens-realm` at `https://localhost:4251/tessar-admin/` (see
`docs/bxl-mutate-tessar-notes.md`). Send programs with:

```
mise exec -- node packages/realm-server/scripts/tessar-mutate.ts /Staff/ms-green 'Name = "Ms. Greene";'
```

## Tests

`packages/realm-server/tests/realm-endpoints/mutate-test.ts`

- Scalar field write vs PATCH (indexed response + stored file).
- Reject invalid BXL with 400.
- 404 for a missing instance.
- `linksToMany` append via `append(.friends; card(id))`.
