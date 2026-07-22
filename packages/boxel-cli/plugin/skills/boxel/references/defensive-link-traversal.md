# Defensive Link Traversal

Reading a `linksTo` or `linksToMany` field is **not** the same as reading a `contains` field. A linked card is loaded lazily and can be broken. Until it resolves — and forever, if the link is broken — the slot reads as `undefined`. Card authors must guard every traversal of a linked field, or the card throws.

## The per-slot contract

| Field | What a read gives you | When it is `undefined` |
| --- | --- | --- |
| `linksTo` (singular) | `Card \| undefined` | not yet loaded, not-found (404), or errored |
| `linksToMany` (per element `arr[i]`) | `Card \| undefined` | that element is not yet loaded, not-found, or errored |

Key facts:

- **The slot accessor never exposes a sentinel.** A broken or pending link reads as plain `undefined` — there is no special placeholder object to detect in JavaScript.
- **`linksToMany` keeps the slot.** `arr.length` and iteration count are unchanged; broken/pending elements are `undefined` *holes*, not removed entries. So `arr[2]` may be `undefined` while `arr[3]` is a real card.
- **`undefined` is ambiguous on its own.** It means "no renderable card right now" — could be still-loading, could be terminally broken. When you must tell those apart, use `getRelationship` (below).

## Why you must guard *every* traversal

The trap is not just genuinely broken links. **Every prerender hits the lazy-load window**: the first time a card renders, its links are not yet loaded, so they read as `undefined` even when the data is perfectly fine. Unguarded traversal throws *during normal rendering*, not only in the rare broken case.

```ts
@field friendsOfFriend = linksToMany(() => Person, {
  computeVia(this: Person) {
    return this.friends[0].friends; // this.friends[0] is undefined while loading → THROWS
  },
});
```

```ts
return this.friends[0]?.friends ?? []; // guarded — yields [] until loaded, then the real list
```

A thrown computed turns the whole card into an error card. The guarded form degrades gracefully: it renders empty during the load window, then re-renders with real data once the link resolves (the field is tracked, so the recompute is automatic).

## Singular `linksTo` in a computed

```ts
// ❌ UNSAFE — throws while `manager` is loading or if the link is broken
@field managerName = contains(StringField, {
  computeVia(this: Employee) {
    return this.manager.name;
  },
});

// ✅ SAFE — optional chaining + fallback
@field managerName = contains(StringField, {
  computeVia(this: Employee) {
    return this.manager?.name ?? 'Unassigned';
  },
});
```

Chain the `?.` through every hop — each link in the chain can independently be `undefined`:

```ts
// ❌ this.manager is undefined → throws; even if present, .department can be undefined
return this.manager.department.name;

// ✅ every hop guarded
return this.manager?.department?.name ?? 'Unknown';
```

## `linksToMany` in a computed

Every element can be `undefined`, so never assume `arr[i]` is a renderable card.

```ts
// ❌ UNSAFE — `c.name` throws on the first undefined (unloaded/broken) slot
@field memberNames = containsMany(StringField, {
  computeVia(this: Team) {
    return this.members.map((c) => c.name);
  },
});

// ✅ SAFE — `?.` in the map, then drop the empties
@field memberNames = containsMany(StringField, {
  computeVia(this: Team) {
    return this.members.map((c) => c?.name).filter(Boolean);
  },
});
```

```ts
// ❌ UNSAFE — indexing assumes a card is there
return this.members[0].role;

// ✅ SAFE
return this.members[0]?.role ?? 'TBD';
```

Iterating with a `== null` skip is the explicit form when you need a loop:

```ts
@field totalSalary = contains(NumberField, {
  computeVia(this: Team) {
    let total = 0;
    for (let m of this.members) {
      if (m == null) continue; // skip unloaded / broken slots
      total += m.salary ?? 0;
    }
    return total;
  },
});
```

Filter to renderable cards before deriving a count or building a list:

```ts
// ❌ counts undefined holes too
@field loadedCount = contains(NumberField, {
  computeVia(this: Team) {
    return this.members.length;
  },
});

// ✅ counts only present cards
@field loadedCount = contains(NumberField, {
  computeVia(this: Team) {
    return this.members.filter(Boolean).length;
  },
});
```

A computed `linksToMany` that derives from another link must guard the upstream traversal too:

```ts
// ✅ guard the upstream singular link before spreading its plural link
@field teammates = linksToMany(() => Person, {
  computeVia(this: Person) {
    return this.manager?.reports ?? [];
  },
});
```

## In templates and helpers

The same rule applies wherever a card author touches a link — templates, getters, and helper inputs:

```hbs
{{! ❌ throws while loading / on a broken link }}
<h2>{{@model.manager.name}}</h2>

{{! ✅ guard with #if, or optional chaining in a getter }}
{{#if @model.manager}}
  <h2>{{@model.manager.name}}</h2>
{{/if}}

{{! ✅ filter to renderable cards before #each }}
{{#each this.loadedMembers as |member|}}
  <li>{{member.name}}</li>
{{/each}}
```

```ts
// getter feeding the template above
get loadedMembers() {
  return (this.args.model?.members ?? []).filter(Boolean);
}
```

Never feed a possibly-`undefined` slot straight into a helper that dereferences it (`{{capitalize @model.manager.name}}`) — guard in a getter first.

## Reading structured failure state — `getRelationship`

Plain reads collapse every non-present state to `undefined`. When you genuinely need to distinguish *still loading* from *not-found* from *errored* — e.g. to show a tailored message — use `getRelationship` from `@cardstack/runtime-common` / card-api. It is a pure read (it never re-triggers the loader) and reports each slot's true state:

```ts
import { getRelationship } from 'https://cardstack.com/base/card-api';

// singular linksTo → one RelationshipState
let state = getRelationship(this, 'manager');

// linksToMany → one RelationshipState per element (broken slots included)
let states = getRelationship(this, 'members');
```

Each `RelationshipState` carries:

| Field | Meaning |
| --- | --- |
| `kind` | `'present'` \| `'not-loaded'` \| `'error'` \| `'not-found'` \| `'not-set'` |
| `isLoaded` | `true` only for `'present'` |
| `isError` | `true` for `'error'` and `'not-found'` |
| `value` | the `Card` when `'present'`, else `undefined` |
| `reference` | the target URL/id (absent for `'not-set'`) |
| `errorDoc` | the upstream error, present on `'error'` / `'not-found'` |

Use it to branch on intent rather than guessing from `undefined`:

```ts
let s = getRelationship(this, 'manager');
if (s.kind === 'not-loaded') return 'Loading…';
if (s.isError) return 'Manager link is broken';
return s.value?.name ?? 'Unassigned';
```

For **fixing** a broken link (recognising the DOM placeholder, following the URL to the linked instance, remediating), see [`diagnosing-broken-links.md`](../../boxel-environment/references/diagnosing-broken-links.md) — that is the consumer/operator side; this is the card-author side.

## Key principles

- A `linksTo` / `linksToMany` slot is `Card | undefined` — treat `undefined` as the default, present as the exception.
- Guard during the lazy-load window, not just for "broken data": **every prerender** reads links as `undefined` first.
- Optional-chain every hop (`a?.b?.c`), provide a fallback (`?? default`), `?.` inside `.map`, `== null` skip in loops, `.filter(Boolean)` before counting or rendering.
- Never assume `arr[i]` is renderable, and never assume `arr.length` equals the number of present cards.
- Reach for `getRelationship` only when you must distinguish loading vs not-found vs error; for the common case, optional chaining is enough.
