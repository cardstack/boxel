---
validated: source-proven
---

# automate-linked-to-me-lookup — `getCards()` from a CardDef constructor for inbound references

**What this gives you:** A `Student` card that, when isolated, automatically loads all `TeacherLog` cards that point back to it via a `studentLink` field — without you wiring up a query in the consumer. The "find children who point to me" idiom, done idiomatically.

**When to use:** A card has reverse-direction relationships you want to materialize on display: a Project showing its Tasks, a Person showing their PullRequests, a Student showing their Observations. Any "show me the things linked to this one" view.

**Two ways to do this — usually schema-level is what you want:**

### Option A — Schema-level query-backed `linksToMany` (preferred for most "show my children" cases)

Declare the relationship directly on the CardDef with a `query:` option. The runtime executes the search at index time and populates the field. No component code needed.

```gts
@field tasks = linksToMany(Task, {
  query: {
    filter: {
      on: { module: new URL('./task', import.meta.url).href, name: 'Task' },
      eq: { 'project.id': '$this.id' },
    },
  },
});

// Now anything that walks tasks works as normal:
@field taskCount = contains(NumberField, {
  computeVia: function() { return (this.tasks ?? []).length; },
});

@field progressPct = contains(NumberField, {
  computeVia: function() {
    const total = (this.tasks ?? []).length;
    if (!total) return 0;
    const done = this.tasks.filter(t => t.status === 'done').length;
    return Math.round((done / total) * 100);
  },
});

// In the template: render via @fields for proper chrome
<@fields.tasks @format='embedded' />
```

`$this.id` is the host card's id at query time. `$this.fieldName` and `$REALM` are also available as placeholders. This is the same pattern as the `query-field-playground` example in the experiments realm — query-backed `linksToMany` is a first-class feature, not a workaround.

Use this form when:
- You want the relationship reflected in the schema (visible in code-mode, queryable from outside)
- You want index-time reactivity (the relationship updates automatically when source cards change)
- You want `computeVia` aggregates (counts, percentages, sums) on top of the relationship
- You don't need live updates while the user is staring at the card

### Option B — Component-level via `this.args.context?.getCards(...)`

When you need the list to refresh as the realm changes mid-session, or when the filter depends on tracked UI state, query from the component using the host-injected `getCards`.

**🔴 Critical — `getCards` is NOT a free function from card-api.** The card-api module exports it only as a `type`. Importing `{ getCards }` as a value compiles cleanly (TS resolves the type-only export) and then crashes at runtime with `getCards is not a function`. Verified against `~/Projects/boxel/packages/base/card-api.gts:72` (type re-export, no value export) and against the live host bundle (Apr 2026 staging).

**The only working call signature** is the context-injected one:

```ts
import { Component } from 'https://cardstack.com/base/card-api';

import { codeRef, realmURL } from '@cardstack/runtime-common';

static isolated = class extends Component<typeof MyCard> {
  // context.getCards returns a SearchResource — a live-tracked object
  // whose .instances array updates reactively as the realm changes.
  logsQuery = this.args.context?.getCards(
    this,                              // parent (component owning the resource)
    () => {
      const model = this.args.model;
      if (!model?.id) return undefined; // returning undefined skips the query
      const teacherLogRef = codeRef(import.meta.url, './teacher-log', 'TeacherLog');
      return {
        filter: {
          on: teacherLogRef,
          eq: { 'studentLink.id': model.id },
        },
      };
    },
    () => {
      const model = this.args.model;
      // realmURL is a Symbol exported from @cardstack/runtime-common.
      // The host injects the actual Symbol onto the card; matching its
      // identity is what makes `card[realmURL]` resolve. DO NOT use
      // `Symbol.for('realmURL')` — that produces a *different* Symbol
      // (Symbol.for has its own global registry separate from the host's
      // module-scope Symbol). The query silently returns zero rows.
      const realm = model?.[realmURL];
      return realm ? [String(realm)] : undefined;
    },
    { isLive: true },                  // refresh when realm contents change
  );

  get logs() { return this.logsQuery?.instances ?? []; }
  get isLoading() { return this.logsQuery?.isLoading ?? true; }
};
```

**Why callbacks for query + realms:** the host treats both as autotracked. Reading `model.id` and `model[realmURL]` inside the callbacks lets the query rerun cleanly when the host card is replaced or the realm changes.

**Source proven correct against:** `~/Projects/boxel/packages/catalog-realm/sprint-planner/components/base-task-planner.gts:214-235`, `~/Projects/boxel/packages/catalog-realm/calendar/calendar.gts:496`, `~/Projects/boxel/packages/catalog-realm/gaming-hub/gaming-hub.gts:121`, and ~10 other catalog cards. Every working in-component query in the catalog uses this exact signature.

**Critical — what NOT to do:**
- ❌ `import { getCards } from 'https://cardstack.com/base/card-api';` — compiles but `getCards` is undefined at runtime; it's only re-exported as a type.
- ❌ `import { getCards } from '@cardstack/runtime-common/get-cards';` — that module path doesn't exist at all.
- ❌ `await getCards(query, { realmURL })` — wrong shape; no working free-function variant exists.
- ❌ `model.id.split('/').slice(0, -2).join('/')` — fragile string parsing; use `model[realmURL]` (with `realmURL` imported as a Symbol from `@cardstack/runtime-common`) instead.
- ❌ `model[Symbol.for('realmURL')]` — silent zero-rows trap. `Symbol.for` uses the global Symbol registry, which is a *different* Symbol from the one the host injected at module scope. Import `realmURL` from `@cardstack/runtime-common` instead — that gives you the canonical Symbol the host uses.

**Gotchas:**
- The query callback returning `undefined` skips the query (useful while the card is initializing — `model.id` is undefined briefly).
- `model[realmURL]` returns a `URL` object — wrap with `String(...)` because `getCards` expects `string[]`.
- `import.meta.url` works inside `.gts` files at runtime; needs `@ts-expect-error` for the TS check.
- The returned object exposes `instances`, `isLoading`, `instancesByRealm`, `meta` — see `~/Projects/boxel/packages/runtime-common/index.ts:860` for the type definition.

### Circular `linksTo` (parent ↔ child both ways) — `cardOrThunk was undefined`

**Error signature** that means you have an unresolved cycle (or missing import):

```
Error: cardOrThunk was undefined. There might be a cyclic dependency in one of your fields.
      Use '() => CardName' format for the fields with the cycle in all related cards.
      e.g.: '@field friend = linksTo(() => Person)'
    at cardThunk (https://cardstack.com/base/card-api:2985:11)
    at Object.setupField (https://cardstack.com/base/card-api:1193:20)
    at <static_initializer> (https://realms.example.com/.../your-file:NN:NN)
```

Lint and TypeScript both pass clean. The error only fires at module-load time inside the realm-server. Use `npx boxel run-command get-card-type-schema` to reproduce on demand.

The pattern often pairs with a return-trip `linksTo` on the child. When you have BOTH directions, BOTH need the thunk form (`() => Class`) or whichever side loads second sees `undefined`:

```gts
// opportunity.gts — parent
class Opportunity extends CardDef {
  @field activities = linksToMany(() => Activity, {  // ← thunk
    query: {
      filter: {
        on: codeRef(import.meta.url, './activity', 'Activity'),
        eq: { 'opportunity.id': '$this.id' },
      },
    },
  });
}

// activity.gts — child
class Activity extends CardDef {
  @field opportunity = linksTo(() => Opportunity);   // ← thunk
}
```

The lazy arrow defers the class reference past module-evaluation, so the two files can import each other (or, more commonly, one imports the other while the second only resolves the class at field-creation time). Without the thunk, whichever side loads second sees `undefined`. Verified during the 2026-05-22 sales kit (Opportunity ↔ Activity) and NBJ kit (Project ↔ Style ↔ Designer ↔ Client ↔ Material).

### Thunk-by-default — for every kit-internal `linksTo`

Defensive default: every `linksTo` or `linksToMany` whose target is another CardDef in the same kit uses the `() => Class` form, even if there's no obvious cycle. The cost is 4 characters; the bug it prevents costs ~30 minutes of debugging. Cycles often arise transitively (Project → Quote → Project) and reasoning about which direction loads "first" is brittle.

Mark each kit-internal link in the DataModelPlan with a ● in a "thunk" column.

### NOT a cycle — but produces the same error

`cardOrThunk was undefined` is a general "this binding is undefined at thunk-deref time" error. Common causes besides cycles:

- **Named-import of a default-only export.** `import { DateField } from 'https://cardstack.com/base/date'` resolves `DateField` to undefined; `contains(DateField)` then fails. Probe with `get-card-type-schema --input '{"codeRef":{"module":"https://cardstack.com/base/date","name":"DateField"}}'` — `Export "X" not found in module "Y"` means you need the default import (`import DateField from '...'`).
- **Default-import from a module whose default is a DIFFERENT class.** `import ImageDef from 'https://cardstack.com/base/image'` actually gets `ImageCard` (the deprecated default of that module). Use `/base/image-file-def` or `import { ImageDef } from '/base/card-api'` (both work).
- **Bare `linksTo(X)` without thunk** when X is a kit-local class with any back-edge — see above.

**Source:**
- **Option A (schema-level, preferred):** `~/Projects/boxel/packages/experiments-realm/query-field-playground.gts` (single + many), `nested-query-field-playground.gts` (inside a FieldDef).
- **Option B (component-level, context-injected — the only working in-component variant):** `~/Projects/boxel/packages/catalog-realm/sprint-planner/components/base-task-planner.gts:214-235`, `~/Projects/boxel/packages/catalog-realm/calendar/calendar.gts:496`, plus ~10 other catalog cards.
- **Type-only re-export (the trap):** `~/Projects/boxel/packages/base/card-api.gts:72` exports `type getCards` but no value of that name.
- **SearchResource type:** `~/Projects/boxel/packages/runtime-common/index.ts:860`.

**See also:** `show-table-from-query`, `boxel/references/query-systems.md`.
