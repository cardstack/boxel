---
validated: source-proven
---

# resource-consume-from-context — Render straight off `getCards` / `getCard` / `getCardCollection`

**What this gives you:** The one correct way to read what the three `@context` data getters hand back. Hold the resource on the component, read its properties from the template or from getters, and let Glimmer re-render when the data lands. No `await`, no `.then`, no copy into a `@tracked` field, no timer.

**When to use:** Every time a component calls `this.args.context?.getCards(...)`, `getCard(...)` or `getCardCollection(...)`. Also whenever you are reviewing card code (yours or anyone's) that reads one of them — run the smell list below against it.

**The insight:** These getters return **resources, not promises.** A resource is an object whose properties start out empty and fill in as the data arrives. You read those properties synchronously; Glimmer tracked every read, so whatever read them re-renders when they change. The resource already tells you when it is loading and when it is done — `isLoading` / `isLoaded` — and a live search keeps telling you as the realm changes.

Wrapping a resource in a promise defeats it. The awaited value is a **snapshot**: the resource keeps updating, but the field your template reads does not, so a live search stops being live. Loading and error state then have to be rebuilt by hand, and usually get dropped (`.catch(() => {})`). Reaching that promise by **polling** the resource on a timer defeats it twice over: it pays for reactivity, throws it away, then burns a timer rediscovering what the resource was already going to tell you. A "done" heuristic can settle early on a result that is merely empty *so far*, or never settle — at which point a timeout hands the card a wrong answer instead of an error. Every such loop is also work the framework cannot see or coalesce.

## The three getters and what they hand back

All three are reached through `@context` — none is a value import (importing `getCards` compiles, then throws `getCards is not a function`). The first argument is the owner the resource's lifetime is tied to: pass `this`, the component. The id / query / realms arguments are **thunks** — the resource re-runs when any tracked value read inside them changes.

| Getter | Call | Properties to read | Loading / error |
|---|---|---|---|
| `getCards` | `getCards(this, () => query, () => realms, { isLive: true })` | `instances`, `instancesByRealm`, `meta` (`meta.page.total`) | `isLoading`, `meta.incomplete` |
| `getCard` | `getCard(this, () => id)` | `card`, `id` | `isLoaded` (true once the card **or its error** is in), `cardError` |
| `getCardCollection` | `getCardCollection(this, () => ids)` | `cards`, `ids` | `isLoaded` (false forever for an `undefined` id list — pass `[]`), `cardErrors` |

- **`getCards` is not live unless you ask.** Without `{ isLive: true }` the search runs once per change to its query or realms. With it, the resource also subscribes to the searched realms and re-runs as their contents change. A live search costs a re-run per relevant realm change, so ask for it when the card is on screen and should follow writes — not by reflex on every list.
- **A failed `getCards` search looks empty.** It has no error property: a failure clears `instances`, sets `meta.page.total` to 0, and sets `meta.incomplete`. The same flag is set when a realm the search fanned out to did not answer, so the rows are a floor. Check `meta.incomplete` before reporting a count or "nothing here".
- **An `undefined` query holds the search; it does not clear it.** Return `undefined` from the query thunk until the inputs exist, and the resource stays idle — `isLoading: false`, no instances — so guard on your own input, not the empty list. A query that *goes back* to `undefined` later leaves the last results in place (and a live search keeps re-running that last query on realm changes), so don't use `undefined` to mean "show nothing"; gate the template on your input instead.
- **`getCard` reports an error as loaded.** Check `cardError` before trusting `card`: when the card's server state becomes an error, `card` can still hold the last good instance.
- Want to render whole cards rather than read their fields? You probably want `@context.searchResultsComponent`, not `getCards` — see `show-list-prefer-prerendered`.

## Recipe shape

Hold the resource as a class field; read it in the template and in getters.

```gts
class Isolated extends Component<typeof Course> {
  skills = this.args.context?.getCards(
    this,
    () => ({ filter: { type: skillRef } }), // skillRef = codeRef(here, './skill', 'Skill')
    () => [this.realm],
    { isLive: true },
  );

  // Derive with a getter, not a copy — it re-runs whenever `instances` changes.
  // (Filtering belongs in the query, where the server does it; see `show-list-prefer-prerendered`.)
  get featuredSkills() {
    return (this.skills?.instances ?? []).slice(0, 3);
  }

  <template>
    {{#if this.skills.isLoading}}
      <p>Loading skills…</p>
    {{else}}
      {{#each this.featuredSkills as |skill|}}…{{/each}}
    {{/if}}
  </template>
}
```

`getCard` and `getCardCollection` read the same way — `this.instructor.card`, `this.members.cards` — guarded by `isLoaded` and their error property. See `example.gts` for all three side by side.

**A genuinely one-shot, imperative read** — inside a click handler or a command, where the answer is consumed once and nothing renders from it — is a promise API, not a resource: `await this.args.context?.store.search(query, realms)` or `await this.args.context?.store.get(id)`. `store.get` resolves to the card **or its error** rather than rejecting, so check which you got before using it. Choose that API; don't manufacture a promise out of a resource.

## Smell list — check your own output against it

Any of these in a card means the resource is being fought instead of read. Replace it with the recipe above.

1. **Awaiting a resource** — `await this.args.context.getCards(...)`, or `await` on any variable holding one.
2. **Calling `.then` on a resource**, or on a helper that turns one into a promise.
3. **Copying `.instances` / `.card` / `.cards` into a `@tracked` field** — `this.skillCards = res.instances`. Use a getter over the resource.
4. **Holding a promise for a resource** — `new Promise((resolve) => …res.isLoading…)`, a `Promise`-typed field, or a `loadX(): Promise<Card[]>` helper that wraps a getter.
5. **Polling a resource on a timer or racing it against a timeout** — `setInterval` / `setTimeout` / `requestAnimationFrame` loops that check `isLoading` or `instances.length`, or `Promise.race` with a deadline.
6. **Reading a resource from a constructor** — the constructor runs once, before the data exists; whatever it derives stays empty. Create the resource as a class field and read it from the template or a getter.
7. **Creating a resource inside a getter or template helper** — `get skills() { return this.args.context?.getCards(...) }` makes a new resource, and a new search, on every read. Create it once, as a class field.
8. **Swallowing the resource's error** — `.catch(() => {})`, rendering `card` without looking at `cardError` / `cardErrors`, or rendering an empty `getCards` result without looking at `meta.incomplete`.

**Gotchas:**
- The thunks are the tracking boundary: read `this.args.model.x` *inside* `() => …`, not before it. A value captured outside the thunk is fixed forever.
- An empty input is not a load in progress. `getCard` with an `undefined` id, and `getCardCollection` with an `undefined` id list, report `isLoaded: false` forever. Check your own input before showing a loading state, and give `getCardCollection` `[]` for "no ids".
- `@context` can be absent (a context-free render), so the field is `Resource | undefined`; read it with `?.` rather than asserting it.

**Source:** Boxel monorepo — `packages/experiments-realm/blog-app.gts` (`getCard` held as a field, read through `resource.card`), `packages/experiments-realm/app-card.gts` (`getCardCollection` + `isLoaded`), `packages/base/commands/search-card-result.gts` (`cards` + `cardErrors`), and the contracts in `packages/runtime-common/index.ts` (`getCard` / `getCards` / `getCardCollection` types) and `packages/host/app/resources/{search,card-resource,card-collection}.ts`.

## See also

- `show-list-prefer-prerendered` — whether you should be hydrating instances at all.
- `show-table-from-query` — a `getCards` consumer that reads per-field values off each instance.
- `automate-linked-to-me-lookup` — a query-backed `linksToMany` when the result belongs in the schema, not the component.
- `resource-for-state` / `organize-resource-class-data-loader` — *authoring* your own `Resource` subclass; its consumers follow the same rules as this one.
- `boxel/references/query-systems.md` — which query API to reach for and what each costs.
