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

1. `skills/boxel/SKILL.md` — cardinal rules 12-13 (external URLs in `links.self`, `linksToMany` indexed keys) plus `references/data-management.md` for the full JSON:API instance shapes (`containsMany` arrays, empty links, `adoptsFrom`).
2. `skills/boxel/references/card-references.md` — how every `links.self` resolves (`./` / `../` / absolute; bare paths throw). Also `references/core-concept.md` "Relationship path resolution" and "`adoptsFrom.module` — URL of the .gts, NOT including the export name".
3. `skills/boxel/references/base-field-catalog.md` — DateField vs DateTimeField value contract; the image URL/ImageDef pair pattern.
4. `skills/boxel-patterns/patterns/theme-first-workflow/README.md` — theme linking via `relationships["cardInfo.theme"]`, absolute URLs for nested folders, and why Theme cards omit the self-theme relationship.
5. `skills/boxel-create-edit-cards/SKILL.md` — choosing the host-command combination.
6. `skills/source-code-editing/SKILL.md` (if going via SEARCH/REPLACE).

## Procedure

1. Decide the tool: SEARCH/REPLACE with a `(new)` marker (new instance), `patch-fields` (existing instance, surgical), or `patchCardInstance` (existing instance, full replace).
2. Compose the JSON: `"data"` envelope, `"type": "card"`, `meta.adoptsFrom` (module + name), `attributes`, `relationships` — shapes per the Read list above.
3. Include `attributes.cardInfo` unless there's a specific reason not to (it's the user's edit surface); set `relationships["cardInfo.theme"]` when this instance should carry its own theme. Theme instances themselves omit that relationship.
4. Match date string formats to the schema's field type (DateField vs DateTimeField); put external image URLs in the paired `*URL` attribute, never in a relationship.
5. Save to `<RealmURL>/<CardType>/<slug>.json`.

## Done Criteria (self-verify)

- [ ] `"data"` envelope; `meta.adoptsFrom` has `module` (no export-name suffix) + `name`.
- [ ] Every `links.self` starts with `./`, `../`, or `http` (see `card-references.md`).
- [ ] `linksToMany` uses indexed keys, `containsMany` is an array in attributes, empty links use `"self": null` (cardinal rule 13 + `data-management.md`).
- [ ] `attributes` is an object (never a JSON string); `relationships` is its sibling, not nested inside it.
- [ ] `attributes.cardInfo` present; theme linkage decided per `theme-first-workflow`; no self-theme on Theme instances.
- [ ] Date values match field type; image URLs in the `*URL` attribute (cardinal rule 12 + `base-field-catalog.md`).

## Verification after push

`npx boxel file lint` does NOT confirm the instance is indexed. Run the typed-search count gate from `skills/boxel-environment/references/indexing-operations.md`: `npx boxel search` filtered on the CardDef's absolute module URL must return the number of instances you pushed. If short, look for: bare `links.self` path, malformed `linksToMany` array, wrong `adoptsFrom.module` URL.

## Failure Recovery

- "attributes is a string" / "relationships inside attributes" → see `skills/boxel-environment/references/common-errors.md` for the full error catalogue with fixes.
- Instance never loads ("not a card resource document") → `linksToMany` array shape; use indexed keys.
