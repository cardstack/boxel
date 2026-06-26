---
name: boxel-api
description: Use when calling Boxel realm-server APIs from code — primarily federated search across realms. Documents the boxel-cli programmatic surface (`BoxelCLIClient`) and the matching CLI commands. Read this whenever you need to query a realm's index.
---

# Boxel API

Canonical home for Boxel platform API knowledge.

**Architectural principle:** boxel-cli owns the entire Boxel API surface. Any code that talks to the realm server or Matrix lives in boxel-cli; consumers (the software-factory, custom scripts, hand-written tools) import `BoxelCLIClient` from `@cardstack/boxel-cli/api` and call its methods. Auth (tokens, refresh, retries) is fully internal — if you're holding a JWT or calling `fetch` against a realm URL directly, you're in the wrong layer.

```ts
import { BoxelCLIClient } from '@cardstack/boxel-cli/api';

let client = new BoxelCLIClient(); // reads the active Boxel profile
```

All examples below assume `client` is a `BoxelCLIClient` instance.

## Federated search

Search across one or more realms via `/_federated-search-v2`. Query syntax matches the Boxel realm search format.

### CLI

```
boxel search --realm <realm-url> [--realm <realm-url>...] --query '<json>'
```

`--realm` is repeatable. `--query` takes a JSON string. Append `--json` for raw output.

### Programmatic

```ts
let result = await client.search(realmUrl, query); // single realm
let result = await client.search([realmA, realmB], query); // federated
```

Returns `{ ok, status, data?, error? }`. `data` is an array of card resources.

### Query syntax

```json
{
  "filter": { ... },
  "sort": [ ... ],
  "page": { "size": 10 }
}
```

All top-level fields are optional. An empty query `{}` returns all cards in the targeted realms.

#### Filter by card type

```json
{
  "filter": {
    "type": {
      "module": "http://localhost:4201/software-factory/darkfactory",
      "name": "Project"
    }
  }
}
```

Returns all cards that adopt from (or extend) the specified type. Wildcards (`*`) in `module` or `name` are **not** supported — always use a specific CodeRef.

#### Filter by field value (`eq`)

`eq` requires an `on` to scope the field to a card type:

```json
{
  "filter": {
    "on": { "module": "...", "name": "Issue" },
    "eq": { "status": "in_progress" }
  }
}
```

Multiple fields in `eq` are ANDed. Use dot paths for nested fields (e.g. `"author.firstName": "Carl"`). Use `null` to match empty/missing fields.

#### Substring search (`contains`)

Case-insensitive substring match:

```json
{ "filter": { "contains": { "cardTitle": "sticky" } } }
```

Scoped form same as `eq` (`on` + `contains`).

#### Range filters

```json
{
  "filter": {
    "on": { "module": "...", "name": "Post" },
    "range": { "views": { "lte": 10, "gt": 5 } }
  }
}
```

Operators: `gt`, `gte`, `lt`, `lte`. Works on numeric, date, and string fields.

#### Boolean combinators

```json
// AND
{ "filter": { "on": {...}, "every": [ {...}, {...} ] } }

// OR
{ "filter": { "any": [ {...}, {...} ] } }

// NOT
{ "filter": { "on": {...}, "not": { "eq": { ... } } } }
```

#### Sort

```json
{
  "sort": [
    { "by": "author.lastName", "on": { "module": "...", "name": "Article" } }
  ],
  "filter": { "type": { "module": "...", "name": "Article" } }
}
```

Add `"direction": "desc"` for descending.

#### Pagination

```json
{ "filter": {...}, "page": { "size": 10 } }
```

#### CodeRef field matching

CodeRef fields (e.g. `ref` on a Spec card) are matched against the full `{ module, name }`:

```json
{
  "filter": {
    "on": { "module": "https://cardstack.com/base/spec", "name": "Spec" },
    "eq": {
      "ref": {
        "module": "http://localhost:4201/my-realm/sticky-note",
        "name": "StickyNote"
      }
    }
  }
}
```

### Common mistakes

- **Field names without `on`.** Fields like `title`, `status`, etc. are type-specific. The exceptions are `cardTitle` and `cardDescription` — those exist on the base `CardDef`.
- **Relative or bare module URLs.** Always use full absolute module URLs in CodeRefs.
- **Slash separators in dotted paths.** Use `author.firstName`, not `author/firstName`.
- **Searching relationships that aren't rendered in an embedded/fitted template.** The query engine indexes a linked field only if it appears in an embedded format. Otherwise the filter silently misses.

## When to use what

| Goal                                                     | Use                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Find cards in your local synced workspace                | Native `grep` / `find` — files are already on disk                 |
| Find cards by type / field across one or more realms     | `boxel search` / `client.search`                                   |
| Read a single card's source from a realm                 | `client.read(realmUrl, path)` / `boxel file read`                  |
| Read the transpiled (browser) version of a `.gts` module | `client.readTranspiled(...)` / `boxel read-transpiled`             |
| List files in a realm                                    | `client.listFiles(realmUrl)` / `boxel file list`                   |
| Push local changes to a realm                            | `client.sync(realmUrl, dir, { preferLocal: true })` / `boxel sync` |
| Pull a realm's state to a local dir                      | `client.pull(realmUrl, dir)` / `boxel pull`                        |
| Run a host command (prerendered)                         | See the `boxel-command` skill                                      |

## What this skill is **not** for

- **Card development patterns** (`.gts` field declarations, templates, `linksTo` vs `contains`) — that's `boxel-development`.
- **JSON:API document structure** for card instances — that's `boxel-file-structure`.
- **Sync / pull / track / watch CLI ergonomics** — those have their own per-command skills (`boxel-sync`, `boxel-track`, `boxel-watch`).
- **Host commands via the prerenderer** (`/_run-command`) — that's the `boxel-command` skill.
- **Realm provisioning** (`createRealm` / `boxel realm create`) and **readiness polling** (`client.waitForReady` / `/_readiness-check`) — orchestration concerns. The software-factory creates target realms in `factory-target-realm.ts` before the agent loop starts; consumers needing those APIs should read `boxel-cli/src/api.ts` directly or run `boxel realm create --help`.
