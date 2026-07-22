---
name: boxel-add-file-field
description: Add a file-backed field (image, document, CSV, markdown) using FileDef/ImageDef/MarkdownDef/CsvFileDef.
boxel:
  kind: skill
---

# /boxel-add-file-field

## Use When

- The user wants a card field that holds an image, document, audio, video, or other file asset.
- They mention "upload", "attach", "image", "file", "PDF", "CSV", "markdown file".

## Inputs

- Path to the `.gts` file.
- What kind of file (image / png / svg / markdown file / CSV / generic).
- Single or multiple (`linksTo` vs `linksToMany`).

## Read

1. `skills/boxel-file-def/SKILL.md`
2. `skills/boxel/SKILL.md`
3. `skills/boxel/references/lint-workflow.md`
4. `skills/boxel-file-def/references/no-inline-binary.md`
5. `skills/source-code-editing/SKILL.md`
6. If rendering the file (preview, gallery): `skills/boxel-ui-guidelines/SKILL.md`.

## Procedure

1. Choose the most specific FileDef subtype (`ImageDef`, `PngDef`, `SvgDef`, `MarkdownDef`, `CsvFileDef`, etc.) — fall back to `FileDef` only when the type is truly generic.
2. Import from the corresponding `https://cardstack.com/base/<name>-file-def` (or `image-file-def`, `file-api`).
3. Add `@field foo = linksTo(SomeFileDef)` (NEVER `contains` — FileDef has identity).
4. If the template renders the file, include the file's own format (e.g. `<@fields.thumbnail />` and let the FileDef render).

## Done Criteria (self-verify)

- [ ] The file field uses `linksTo` or `linksToMany`, never `contains`.
- [ ] The import is from `https://cardstack.com/base/<type>-file-def` (or `file-api`).
- [ ] `Base64ImageField` is NOT used (it crashes the AI context with embedded binary).
- [ ] No media bytes or `data:image/...;base64` strings are stored in `StringField`, `outputText`, JSON attributes, or notes.
- [ ] If the file appears in JSON, empty value is `"self": null`, not `[]`.
- [ ] Changed `.gts` files passed installed npm `boxel` lint (`npx boxel file lint ... --file <local-file>` before push and `npx boxel lint <path> --realm <url>` after push).

## Failure Recovery

- "Base64 too large" errors → confirm you're using a FileDef subtype, not Base64ImageField.
- Image renders blank → check the FileDef instance has a valid `url` and is indexed.
