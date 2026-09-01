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

## Local clinical harness

The synthetic BXL Clinical Access sample is cloned into
`packages/bxl-clinical-mutation-realm` and mounted at
`https://localhost:4251/bxl-clinical-mutation/` (see
`docs/bxl-mutate-clinical-notes.md`). Send programs with:

```
mise exec -- node packages/realm-server/scripts/clinical-mutate.ts /PatientDashboard/pt-1001 '.vitals.heartRate = 112;' --syntax solidified
```

## Tests

`packages/realm-server/tests/realm-endpoints/mutate-test.ts`

- Scalar field write vs PATCH (indexed response + stored file).
- Reject invalid BXL with 400.
- 404 for a missing instance.
- `linksToMany` append via `append(.friends; card(id))`.
