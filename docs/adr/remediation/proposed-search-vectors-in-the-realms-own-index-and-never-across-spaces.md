# ADR search-vectors-in-the-realms-own-index-and-never-across-spaces remediation

Places where the code does not meet [ADR search-vectors-in-the-realms-own-index-and-never-across-spaces](../proposed-search-vectors-in-the-realms-own-index-and-never-across-spaces.md)
yet (ADR 001 §1.6).

`packages/runtime-common/vector-query.ts`:

- `#recordedSpaceOf` breaks §1.1. For a definition stored before
  `vectorSpace` was recorded, it reads the space from the cards that record
  the field. Remove it once every realm's definitions have been reindexed.
- `declaredSpaceOf` breaks §1.4 for cards stored before spaces were
  recorded. It answers `vector <dims>`, so such vectors compare by size
  alone. Remove it with `#recordedSpaceOf`.
