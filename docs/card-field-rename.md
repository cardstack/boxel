# Card Field Rename: cardDef + cardInfo

[#3800 PR](https://github.com/cardstack/boxel/pull/3800) renames card fields:

- `title` -> `cardTitle`
- `description` -> `cardDescription`
- `thumbnailURL` -> `cardThumbnailURL`

And inside `cardInfo`:

- `title` -> `name`
- `description` -> `summary`
- `thumbnailURL` -> `cardThumbnailURL`

## What to do after merging upstream

Run the migration script against your local realm data (or any JSON exports that store cardDefs/cardInfo):

```sh
node scripts/rename-card-fields.js <path-to-data-root> dry-run yes
```

If the output looks right, apply the changes:

```sh
node scripts/rename-card-fields.js <path-to-data-root> apply yes
```

Notes:

- The script scans for `.json` files recursively.
- It writes a `.bak` file next to each updated JSON file when backups are enabled (`yes`).
- Use `no` as the third argument if you do not want backups.

## Rename fields in card definitions (.gts)

Run the GTS codemod against card definition sources (including templates):

1) Pick a root directory that contains `.gts` card definitions.
   - Common choices:
     - `packages/` (host + base + other packages)
     - `packages/catalog-realm/`
     - `packages/experiments-realm/`
     - Repo root to cover all of the above

2) Dry-run to preview the list of files that would change:

```sh
node scripts/rename-card-fields-gts.js <path-to-gts-root> dry-run yes
```

3) If the output looks right, apply the changes:

```sh
node scripts/rename-card-fields-gts.js <path-to-gts-root> apply yes
```

Notes:

- The script scans for `.gts` files recursively.
- It writes a `.bak` file next to each updated file when backups are enabled (`yes`).
- Use `no` as the third argument if you do not want backups.
- It does not touch `data-test-field="cardInfo-*"` attributes.

### Dependencies

The GTS codemod relies on dependencies already pinned in the repo:

- `@glimmer/syntax` (template parsing/printing)
- `@babel/parser` and `@babel/traverse` (script AST edits)

Install them via the repo's toolchain:

```sh
pnpm install
```

Notes:

- This project uses Volta for Node + pnpm versions (see `package.json`).

## AI conversations

Existing AI conversations that reference the old card structure will not work after this change. Start new conversations to ensure prompts and payloads use `cardTitle`/`cardDescription`/`cardThumbnailURL` and updated `cardInfo` fields.
