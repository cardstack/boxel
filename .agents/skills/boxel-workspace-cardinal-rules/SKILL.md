# Boxel cardinal rules — silent-failure traps

Rules discovered the hard way in a downstream Boxel workspace: each one passes lint and
often passes indexing too, then breaks silently — corrupting the realm's index,
crashing at render, or dropping data with no error. Check every card/field you write
against this list before finishing an issue.

## 1. DateField vs DateTimeField value format

`DateField` values are `YYYY-MM-DD` (no `T`). `DateTimeField` values are full ISO
datetimes (`2026-07-16T14:30:00.000Z`, with `T`). Putting a datetime string in a
`DateField` (or vice versa) passes lint and indexes fine, then **crashes at render**
with `RangeError: Invalid time value` when a user actually opens the card. Naming
convention to follow when picking the field type: a `*At` suffix (`createdAt`,
`publishedAt`) means `DateTimeField`; a `*Date`/`*On` suffix or bare `dob` means
`DateField`.

## 2. Never put an external URL in `relationships.<field>.links.self`

If a `linksTo`/`linksToMany` field's JSON `links.self` points at a URL the indexer
can't parse as a card (an external website, an image CDN URL, anything not a card
resource), **the failed parse poisons the JSONB write and rolls back the WHOLE
REALM's indexing transaction** — every other file in the same push silently fails to
index too, with no error pointing at the actual bad file. For an external image/URL,
use the pair pattern instead: `linksTo(ImageDef)` (or a similar file/media field) +
`contains(UrlField)` as two separate fields, never one relationship pointing straight
at an external URL.

## 3. `linksToMany` JSON uses indexed top-level keys, never an array

Correct:

```json
"relationships": {
  "items.0": { "links": { "self": "../foo" } },
  "items.1": { "links": { "self": "../bar" } }
}
```

Wrong (rejected outright — "instance ... is not a card resource document"):

```json
"relationships": {
  "items": { "links": { "self": ["../foo", "../bar"] } }
}
```

## 4. Never inline media or binary bytes in card JSON

No `data:` URIs, `blob:` URIs, base64, or raw media bytes in any JSON string field or
attribute. Store media as a realm file linked via `linksTo(FileDef)` (or a FileDef
subtype: `ImageDef`, `CsvFileDef`, etc.) instead — never embed the bytes directly in
the instance JSON.

## 5. Every query needs a realm scope, and don't start it before the realm is known

A card-owned query with a missing or empty `realm` argument silently falls back to
searching **every realm the server can see**, not just the current one. Always scope
queries to the current card's own realm, and don't kick off the query before that
realm URL is actually resolved. Cap general-purpose result sets (~100) rather than
pulling unbounded result sets.

## 6. Query-filter shape: `type` selects instances, `on` only scopes predicates

To select every instance of a type, filter on `{ type: <ref> }` directly — never wrap
it in `{ on: <ref> }` alone (`on` only scopes _other_ predicates like `eq`/`contains`;
a bare `{ on: ref }` with nothing else matches nothing). Build refs with a `codeRef()`
helper, not a manually-constructed object.

## 7. Don't push more than ~30 files through one atomic batch to a fresh realm

Large atomic pushes (30+ files via a single bulk-write endpoint) can report success
while silently dropping some files' indexing jobs. For bulk kit/asset installs, push
in smaller batches and verify each batch's expected file count actually shows up in a
realm search before pushing the next batch.

## 8. NEVER curl / HTTP-GET a `https://cardstack.com/base/*` module URL to inspect a base card

Base card module URLs (`https://cardstack.com/base/theme`, `.../base/card-api`,
`.../base/cards/structured-theme`, etc.) are **loader-resolved module references, not
fetchable HTTP resources.** `cardstack.com` is a marketing site — a direct GET or a
realm op (`_mtimes`, `boxel file read`) against `cardstack.com/base/...` returns a
generic Webflow **404 HTML page** (`data-wf-domain=... %%PUBLISH_URL_REPLACEMENT%%`),
NOT the card. Do not keep retrying it — that page will never become the schema. To
learn a base card's fields/shape, use the **`get_card_schema` tool** (it resolves
through the realm server), or read an existing instance of that card already in the
target realm. Same rule for any published `*.boxel.site` / `*.boxel.build` URL: those
are Webflow-published sites, not realms — never point realm operations at them.

Also: many base cards are **default exports**, so the schema ref is `name: "default"`,
NOT the class name. The base **Theme** card is the default export of
`https://cardstack.com/base/theme` (the module is `export default Theme`) — query it as
module `https://cardstack.com/base/theme`, name `default` (querying `#Theme` fails).
`StructuredTheme` is likewise the default export of `base/structured-theme`. When a
`get_card_schema` call fails with "named export is a CardDef", retry with `name:
"default"` before assuming the card is unreachable — do NOT fall back to curling the URL.
