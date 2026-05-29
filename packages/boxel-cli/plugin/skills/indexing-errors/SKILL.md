---
description: List every card or module in a realm whose latest indexing attempt errored. Use when the user asks "why is this realm broken", "what's failing to index", or to triage indexing errors before pushing a fix. Surfaces the URL, error document, and per-row timing diagnostics in one call.
---

# Realm indexing errors

`boxel realm indexing-errors` returns one entry for every row in a realm's `boxel_index` whose latest indexing attempt failed (`has_error = TRUE`, not deleted). Each entry includes the URL, the persisted `errorDoc` (a `SerializedError` — `message`, `status`, `title`, optional `stack`, optional `deps`), and the `timingDiagnostics` JSON blob attached to the row when the indexer ran.

Use this skill to answer "why is this realm broken" without reading the database directly or scraping per-card render failures.

## When the user asks to...

| Ask | Run |
|---|---|
| "what's failing to index in <realm>?" | `boxel realm indexing-errors --realm <realm-url>` |
| "give me the full error documents as JSON" | `boxel realm indexing-errors --realm <realm-url> --json` |
| "is anything broken in this realm right now?" | `boxel realm indexing-errors --realm <realm-url>` — exit 0 with "No indexing errors." is the all-clear |

## Typical sequencing

Default triage loop after a sync or a suspected break:

```bash
boxel realm wait-for-ready --realm https://app.boxel.ai/owner/realm/
boxel realm indexing-errors --realm https://app.boxel.ai/owner/realm/
# if errors appear, fetch the offender's source and dependencies:
boxel file read https://app.boxel.ai/owner/realm/ <path-from-url>
boxel realm indexing-errors --realm https://app.boxel.ai/owner/realm/ --json \
  | jq '.data[] | {id, msg: .attributes.errorDoc.message}'
```

The errors reported reflect each URL's **most recent** indexing attempt — the table's primary key is `(url, realm_url)`, so a successful re-index overwrites the error row in place. If a URL is in the output, it is failing right now.

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
3 indexing errors for https://realm.example.com/:
https://realm.example.com/broken-card.json  Cannot find module './missing'
https://realm.example.com/bad-pet.json      RenderError
https://realm.example.com/recipes.gts       Unexpected token '<'
```

`--json` emits a JSON-API document:

```json
{
  "data": [
    {
      "type": "indexing-error",
      "id": "https://realm.example.com/broken-card.json",
      "attributes": {
        "errorDoc": { "message": "...", "status": 500, "title": "...", "...": "..." },
        "timingDiagnostics": { "invalidationId": "...", "ms": 42 }
      }
    }
  ]
}
```

## Pitfalls

- `--realm` is required and must be the realm base URL (with the realm path, not just the server origin).
- The endpoint reports errors for **all** entry types (instances, modules, files) — not just card instances. A failing `.gts` shows up here even if it isn't published as a card.
- The default human-readable line truncates the error message to 100 characters and prefers `errorDoc.title` over `errorDoc.message`. Use `--json` for the full payload.
- On transport failure with `--json`, stdout receives `{"error":"..."}` (not the data envelope) and the process exits non-zero. Successful calls always emit `{ "data": [...] }`. A consumer reading only stdout can distinguish failure from "realm is healthy" by checking for the `error` key (or the exit code).
- The list does not include queue depth, running-job progress, or a "last finished at" timestamp. Those are separate concerns and may be folded into a future `indexing-status` command.
