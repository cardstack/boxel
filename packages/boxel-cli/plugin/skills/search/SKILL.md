---
description: Federated search across one or more Boxel realms. Use when the user wants to find cards by type, field value, or full-text query, optionally constrained to specific realms.
---

# Federated search

Wraps `boxel search`, which sends a query to the realm-server's `_federated-search` endpoint and aggregates results across realms the active profile can read.

## When the user asks to...

| Ask                             | Run                                                                  |
| ------------------------------- | -------------------------------------------------------------------- |
| "what cards are in this realm?" | `boxel search --realm <url>` — **omit `--query`** to list everything |
| "find all BlogPosts"            | `boxel search` with a type filter (see below)                        |
| "search for X across my realms" | `boxel search` with a contains filter                                |
| "search just one realm"         | add `--realm <realm-url>` (repeatable)                               |
| "give me JSON I can pipe"       | add `--json`                                                         |

## Query shape

Queries are JSON, passed via `--query`. **Omit `--query` to list every card in the realm(s)** — the fastest way to discover what's there (and to find a card's module URL from its `meta.adoptsFrom`) before writing a typed filter. The shape mirrors the `_search` API:

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
- `--query <json>` — JSON query object (as a string)
- `--json` — Output raw JSON response

<!-- generated:commands:end -->

## Pitfalls

- **Discovery first.** Writing a `type` or `on` filter requires the card's full module URL. If you don't know it yet, **omit `--query`** to list every card and read its `meta.adoptsFrom.module` — don't guess the URL.
- **Field filters need an `on` scope.** `eq` / `contains` / `range` must be wrapped with `on: { module, name }` (see the field-filter example). A bare `{"filter":{"eq":{...}}}` is rejected with `cannot determine the type of filter`.
- **Don't pass an empty filter.** `{"filter":{}}` is invalid for the same reason; to match everything, omit `--query` entirely (the CLI also treats an explicit empty filter as list-all).
- `module` in a `type` filter must be the **full HTTPS URL** of the card definition (no relative paths). Compose it from the realm URL plus the kebab-case file name without `.gts`.
- Federated search only sees realms the active profile has read access to. If a realm is missing from results, check `boxel profile` and `boxel realm list`.
