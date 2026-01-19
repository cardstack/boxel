# Card Field Rename: cardDef + cardInfo

This branch renames card fields:

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

## AI conversations

Existing AI conversations that reference the old card structure will not work after this change. Start new conversations to ensure prompts and payloads use `cardTitle`/`cardDescription`/`cardThumbnailURL` and updated `cardInfo` fields.
