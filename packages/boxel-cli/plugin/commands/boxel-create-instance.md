---
name: boxel-create-instance
description: Create a new JSON card instance or update an existing one.
boxel:
  kind: skill
---

# /boxel-create-instance

## Use When

- The user wants to seed example data, create a card from structured input, or update an existing instance's data.
- The CardDef already exists.

## Inputs

- Realm URL.
- The CardDef path (module URL + class name).
- The data to populate.

## Read

1. `skills/boxel/SKILL.md` (focus: `references/data-management.md`)
2. `skills/boxel-create-edit-cards/SKILL.md`
3. `skills/source-code-editing/SKILL.md` (if going via SEARCH/REPLACE)

## Procedure

1. Decide the tool: `write-text-file` (new instance, simple shape), `patch-fields` (existing instance, surgical), `patchCardInstance` (existing instance, full replace), or SEARCH/REPLACE (large or structural).
2. Compose the JSON. Use `"data"` envelope, `"type": "card"`, `"meta.adoptsFrom"`, `"attributes"`, `"relationships"`.
3. For empty `linksTo`/`linksToMany` use `"self": null`, NEVER `[]`.
4. Save to `<RealmURL>/<CardType>/<slug>.json`.

## Instance shape — JSON:API correctness rules

- **`adoptsFrom.module` is the URL of the .gts, NOT including the export name.** Use `"module": "https://cardstack.com/base/brand-guide"`, `"name": "default"` — never `"module": "https://cardstack.com/base/brand-guide/default"` (that treats the export name as a URL path and returns 404).
- **Every `links.self` MUST start with `./`, `../`, or `http`.** Bare paths like `"BrandGuide/foo"` are treated as npm-style package specifiers and fail with `Cannot resolve bare package specifier`. Use `"./BrandGuide/foo"` for root-level instances, `"../BrandGuide/foo"` for subfolder instances, or absolute URLs for cross-realm references. See `boxel/references/core-concept.md` "Relationship path resolution."
- **`linksToMany` uses INDEXED KEYS, not an array.** Each linked item is its own top-level relationship key:
  ```json
  "relationships": {
    "materials.0": { "links": { "self": "../Material/white-oak" } },
    "materials.1": { "links": { "self": "../Material/walnut" } }
  }
  ```
  NEVER `"materials": { "links": { "self": ["a", "b"] } }` — the host rejects the instance as "not a card resource document" and it never loads.
- **`containsMany` is an ARRAY in attributes.** `"attributes": { "cabinets": [ {...}, {...} ] }` — opposite of `linksToMany`. Easy to mix up.
- **Date fields match their schema type.** `DateField` ↔ `"YYYY-MM-DD"` (no `T`). `DateTimeField` ↔ `"YYYY-MM-DDTHH:MM:SS.sssZ"` (with `T` and `Z`). Mismatch passes lint, crashes at render with `RangeError: Invalid time value`.
- **Image URLs go in the paired `*URL` field, NEVER in a `linksTo` relationship's `links.self`.** Putting an external URL there bricks the realm (Postgres NULL-byte rejection rolls back the whole indexing batch). See Cardinal Rule in CLAUDE.md.

## Done Criteria (self-verify)

- [ ] `"data"` envelope at top level.
- [ ] `"meta.adoptsFrom"` has both `module` and `name`. Module URL does NOT include `/default` or any export-name suffix.
- [ ] Every `links.self` value starts with `./`, `../`, or `http`. No bare paths.
- [ ] `linksToMany` uses indexed-key shape (`"field.0"`, `"field.1"`), NOT array in `links.self`.
- [ ] `containsMany` is an array in `attributes.<field>`.
- [ ] Empty relationships use `"self": null`.
- [ ] `attributes` is an object, NEVER a JSON-string.
- [ ] `relationships` is a sibling of `attributes`, not nested inside it.
- [ ] Include `attributes.cardInfo` (the four-key object: `name`, `summary`, `cardThumbnailURL`, `notes`; nulls fine) UNLESS the CardDef has a meaningful computed `cardTheme` AND there's no name/summary the user might want to edit. When in doubt, include it — it's cheap and gives the user an edit surface.
- [ ] **Per-instance theme override.** If you want THIS instance to override whatever `cardTheme` would otherwise compute, set `relationships["cardInfo.theme"]` with the dotted key. For CardDefs that use the default `cardTheme` pass-through, this is also the only way to install a theme at all. For CardDefs that override `cardTheme` (e.g. Task inherits from Project), it's optional.
- [ ] Exception for Theme card instances themselves: they include `attributes.cardInfo` but OMIT `relationships["cardInfo.theme"]` entirely (no circular self-link).
- [ ] Date string formats match the schema's field type (DateField vs DateTimeField).
- [ ] Image URLs are in `attributes.<heroImageURL>`, NOT in `relationships.<heroImage>.links.self`.

## Verification after push

`npx boxel file lint` does NOT confirm the instance is indexed. Run:

```sh
npx boxel search --realm <url> \
  --query "{\"filter\":{\"type\":{\"module\":\"<absolute-module-url>\",\"name\":\"<ClassName>\"}}}" \
  --json | python3 -c "import json,sys;raw=sys.stdin.read();s=raw.find('[');e=raw.rfind(']')+1;print(len(json.loads(raw[s:e])))"
```

Count must match the number of `<ClassName>` instances you intended to push. If short, look for: bare `links.self` path, malformed `linksToMany` array, wrong `adoptsFrom.module` URL.

## Failure Recovery

- "Error: attributes is a string" → `attributes` must be an object literal, not a stringified JSON.
- "Error: relationships inside attributes" → move `relationships` to be a sibling at the top level of `data`.
- See `skills/boxel-environment/references/common-errors.md` for the full error catalogue.
