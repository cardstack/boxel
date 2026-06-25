---
description: Federated search across one or more Boxel realms. Use when the user wants to find cards by type, field value, or full-text query, optionally constrained to specific realms.
---

# Federated search

Wraps `boxel search`, which sends a query to the realm-server's `_federated-search-v2` endpoint and aggregates results across realms the active profile can read.

## When the user asks to...

| Ask                             | Run                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------- |
| "what's in this realm?"         | `boxel file list --realm <url>` — cheap; lists every file (see Discovery below) |
| "find all BlogPosts"            | `boxel search` with a type filter (see below)                                   |
| "search for X across my realms" | `boxel search` with a contains filter                                           |
| "search just one realm"         | add `--realm <realm-url>` (repeatable)                                          |
| "give me JSON I can pipe"       | add `--json`                                                                    |

## Discovery: list first, then search

To see what a realm holds — or to find the module URL a `type`/`on` filter needs — use **`boxel file list --realm <url>`**, not `search`. It's a flat file listing (the realm's `_mtimes`), far cheaper than a query, and it gives you exactly what discovery needs:

- The **`.gts` paths are the card definitions** — each one is a card type. Its module URL for a `type` filter is just `<realm-url><path-without-.gts>`.
- The `.json` paths are the instances.

`boxel search` is for **querying** card data once you know the type/field you want — not for "list everything." Reach for it after `boxel file list` has told you the module URL.

## Query shape

Queries are JSON, passed via `--query`. The shape mirrors the `_search` API:

```json
{
  "filter": {
    "type": {
      "module": "https://app.boxel.ai/owner/realm/blog-post",
      "name": "BlogPost"
    }
  }
}
```

With a field filter:

```json
{
  "filter": {
    "on": {
      "module": "https://app.boxel.ai/owner/realm/product",
      "name": "Product"
    },
    "contains": { "name": "laptop" }
  }
}
```

Operations: `eq`, `contains`, `range`, `not`, `type`, `every` (AND), `any` (OR).

<!-- generated:commands:start -->

## Commands

_Generated from the boxel-cli Commander tree by_ `pnpm build:plugin`. _Edit prose outside the generated block — never inside it._

### `boxel search`

Federated search across realms using a JSON query

**Options:**

- `--realm <realm-url>` — Realm URL to search (repeatable)
- `--query <json>` — JSON query object (as a string). Omit to list every card in the realm(s).
- `--json` — Output raw JSON response

<!-- generated:commands:end -->

## Pitfalls

- **Discovery first.** Writing a `type` or `on` filter requires the card's full module URL. If you don't know it yet, run **`boxel file list`** to see the realm's `.gts` modules — don't guess the URL, and don't use `search` to enumerate.
- **Field filters need an `on` scope.** `eq` / `contains` / `range` must be wrapped with `on: { module, name }` (see the field-filter example) — a bare `{"filter":{"eq":{...}}}` has no card type to resolve the field against.
- `module` in a `type` filter must be the **full HTTPS URL** of the card definition (no relative paths). Compose it from the realm URL plus the kebab-case file name without `.gts`.
- Federated search only sees realms the active profile has read access to. If a realm is missing from results, check `boxel profile` and `boxel realm list`.
