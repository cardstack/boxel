---
description: List every `boxel_index` row in a realm whose latest indexing attempt failed (`has_error = TRUE`) OR rendered cleanly but holds broken `linksTo` / `linksToMany` targets. Use to answer "why is this realm broken", "what's failing to index", or "which cards have dead references" without reading the database directly.
---

# Realm indexing errors

`boxel realm indexing-errors` returns two classes of "indexing finding" for a realm:

1. **`indexing-error`** — `boxel_index` rows where `has_error = TRUE`. The render or file extract failed and the persisted `errorDoc` (a `SerializedError`: `message`, `status`, `title`, optional `stack`, optional `deps`) explains why.
2. **`broken-link`** — `boxel_index` rows where `has_error = FALSE` but the indexer's `render.meta` scan persisted a non-empty `diagnostics.brokenLinks` array. The card itself indexes fine; one or more `linksTo` / `linksToMany` targets are dead. Each entry exposes `attributes.brokenLinks: BrokenLinkSummary[]` — `{ fieldName, reference, kind: 'error' | 'not-found' }`.

Use this skill to triage realm health in one call, without reading the database directly or scraping per-card failures.

## When the user asks to...

| Ask | Run |
|---|---|
| "what's failing to index in <realm>?" | `boxel realm indexing-errors --realm <realm-url>` |
| "which cards have broken links in <realm>?" | `boxel realm indexing-errors --realm <realm-url> --json \| jq '.data[] \| select(.type == "broken-link")'` |
| "give me the full payload as JSON" | `boxel realm indexing-errors --realm <realm-url> --json` |
| "is anything broken in this realm right now?" | `boxel realm indexing-errors --realm <realm-url>` — exit 0 with "No indexing errors." is the all-clear |

## Typical sequencing

Default triage loop after a sync or a suspected break:

```bash
boxel realm wait-for-ready --realm https://app.boxel.ai/owner/realm/
boxel realm indexing-errors --realm https://app.boxel.ai/owner/realm/
# if findings appear, fetch the offender's source and dependencies:
boxel file read https://app.boxel.ai/owner/realm/ <path-from-url>
boxel realm indexing-errors --realm https://app.boxel.ai/owner/realm/ --json \
  | jq '.data[] | {type, url: .attributes.url, msg: (.attributes.errorDoc.message // (.attributes.brokenLinks | length | tostring + " broken"))}'
```

Each finding reflects that URL's **most recent** indexing attempt. The `boxel_index` primary key is `(url, realm_url, type)` — a successful re-index of the same `(url, type)` overwrites the row in place. A single URL can produce multiple findings if both its `instance` and `file` rows are affected; the JSON-API resource `id` is `${entryType}::${url}` so each finding is unique.

<!-- generated:commands:start -->

## Commands

_Generated from the boxel-cli Commander tree by_ `pnpm build:plugin`. _Edit prose outside the generated block — never inside it._

### `boxel realm indexing-errors`

List every card or module in a realm whose latest indexing attempt errored

**Options:**

- `--realm <realm-url>` — The realm URL to query
- `--json` — Output the full JSON-API document

<!-- generated:commands:end -->

## Output shape

Default (human-readable):

```
3 indexing findings for https://realm.example.com/:
[instance] https://realm.example.com/broken-card.json  Cannot find module './missing'
[file]     https://realm.example.com/recipes.gts        Unexpected token '<'
[instance] https://realm.example.com/clean-but-linked.json  2 broken: author→https://…, tags→https://…
```

Each line is `[<entryType>] <url>  <short summary>`. For `indexing-error` rows the summary is `errorDoc.title` (falling back to `errorDoc.message`). For `broken-link` rows it is `<N> broken: fieldName→reference, …` (up to three, then `+N more`).

`--json` emits a JSON-API document:

```json
{
  "data": [
    {
      "type": "indexing-error",
      "id": "instance::https://realm.example.com/broken-card.json",
      "attributes": {
        "url": "https://realm.example.com/broken-card.json",
        "entryType": "instance",
        "errorDoc": { "message": "...", "status": 500, "title": "..." },
        "diagnostics": { "invalidationId": "...", "renderMs": 42 }
      }
    },
    {
      "type": "broken-link",
      "id": "instance::https://realm.example.com/clean-but-linked.json",
      "attributes": {
        "url": "https://realm.example.com/clean-but-linked.json",
        "entryType": "instance",
        "diagnostics": {
          "brokenLinks": [
            { "fieldName": "author", "reference": "https://...", "kind": "not-found" }
          ]
        },
        "brokenLinks": [
          { "fieldName": "author", "reference": "https://...", "kind": "not-found" }
        ]
      }
    }
  ]
}
```

## Pitfalls

- `--realm` is required and must be the realm base URL (with the realm path, not just the server origin).
- The endpoint reports findings for **all** entry types (instances, modules, files) — not just card instances. A failing `.gts` shows up here even if it isn't published as a card.
- The default human-readable line truncates the error message to 100 characters and prefers `errorDoc.title` over `errorDoc.message`. Use `--json` for the full payload.
- `broken-link` findings have **no** `errorDoc` — `has_error` is `FALSE`. Branch on `data[].type` (or check `attributes.brokenLinks`) before reading `errorDoc`.
- JSON-API resource `id` is `${entryType}::${url}`, not bare `${url}`. To get the URL back, read `attributes.url`.
- On transport failure with `--json`, stdout receives `{"error":"..."}` (not the data envelope) and the process exits non-zero. Successful calls always emit `{ "data": [...] }`. A consumer reading only stdout can distinguish failure from "realm is healthy" by checking for the `error` key (or the exit code).
- The list does not include queue depth, running-job progress, or a "last finished at" timestamp. Those are separate concerns and may be folded into a future `indexing-status` command.
