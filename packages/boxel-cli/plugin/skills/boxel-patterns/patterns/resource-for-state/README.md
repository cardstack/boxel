---
validated: source-proven
---

# resource-for-state — Stateful objects that re-run when their args change

**What this gives you:** A `Resource` subclass that owns mutable state (parsed library data, kanban column order, third-party adapter, expensive computation result) and *automatically re-runs* when its named args change. Render-time `@tracked` properties on the Resource drive template reactivity.

**When to use:**
- A third-party library (`chess.js`, `papaparse`, `d3-scale`, custom WASM) needs an instance that survives across renders.
- Kanban board state where moves should stay smooth (no flicker on parent card update).
- Any "I want to derive something expensive from the model and keep it around" case where a Glimmer getter would recompute too often.
- Anywhere agents reached for a `setTimeout` or a manual change-detection loop.

When NOT to use:
- A pure synchronous derivation of one field → another field — that's `computeVia`, not a Resource.
- A query whose result you want server-side reactive — that's `linksTo`/`linksToMany` with `query:` (see `automate-linked-to-me-lookup`).
- A one-shot async load on mount — a Component `constructor()` + `@tracked` is simpler.

**The insight:** `ember-modify-based-class-resource` provides `Resource<Args>` — a class whose `modify(positional, named)` hook is invoked whenever any tracked input changes. State you assign as `@tracked` properties or instance fields persists across re-runs (unless `modify` overwrites them). You consume the Resource via a factory function that calls `Resource.from(parent, () => ({ named: {...} }))`.

**Recipe shape — wrapping a third-party library (chess.js):**

```gts
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { Resource } from 'ember-modify-based-class-resource';
import ChessJS from 'chess.js'; // your CDN-loaded import

interface ChessArgs {
  named: { pgn?: string };
}

class ChessJSResource extends Resource<ChessArgs> {
  game!: ChessJS;
  snapshot!: ChessJS;
  private future: string[] = [];
  @tracked snapshotPgn: string | undefined;

  modify(_positional: never[], named: ChessArgs['named']) {
    this.game = new ChessJS();
    if (named.pgn) this.game.loadPgn(named.pgn);
    this.snapshot = new ChessJS();
    if (this.snapshotPgn) this.snapshot.loadPgn(this.snapshotPgn);
    else if (named.pgn) this.snapshot.loadPgn(named.pgn);
  }

  @action prev() { /* navigate history; updates @tracked snapshotPgn */ }
  @action next() { /* same */ }
}

// Factory — what consumers actually call.
export function getChessJS(parent: object, pgn: () => string | undefined) {
  return ChessJSResource.from(parent, () => ({
    named: { pgn: pgn() },
  }));
}
```

Consume in a Component:

```gts
class Isolated extends Component<typeof ChessGame> {
  chess = getChessJS(this, () => this.args.model.pgn);

  <template>
    <ChessBoard @pgn={{this.chess.snapshotPgn}} />
    <button {{on 'click' this.chess.prev}}>Back</button>
    <button {{on 'click' this.chess.next}}>Forward</button>
  </template>
}
```

When `model.pgn` changes, `modify()` re-runs with the new value. `@tracked snapshotPgn` triggers template re-render whenever a navigation action sets it.

**Recipe shape — kanban with stable card ordering:**

```ts
interface KanbanArgs {
  named: {
    cards: CardDef[];
    columnKeys: string[];
    hasColumnKey: (card: CardDef, key: string) => boolean;
    orderBy?: (a: CardDef, b: CardDef) => number;
  };
}

class KanbanResource extends Resource<KanbanArgs> {
  @tracked private data: Map<string, DndColumn> = new Map();

  commit(cards: CardDef[], columnKeys: string[]) {
    columnKeys.forEach(key => {
      const current = this.data.get(key);
      const matching = cards.filter(c => this.hasColumnKey!(c, key));
      if (current) {
        // Preserve order of existing, append new ones
        const existingIds = new Set(current.cards.map(c => c.id));
        const kept = current.cards.filter(c => matching.some(m => m.id === c.id));
        const added = matching.filter(c => !existingIds.has(c.id));
        let next = [...added, ...kept];
        if (this.orderBy) next = next.sort(this.orderBy);
        this.data.set(key, new DndColumn(key, next));
      } else {
        const next = this.orderBy ? [...matching].sort(this.orderBy) : matching;
        this.data.set(key, new DndColumn(key, next));
      }
    });
  }

  get columns() { return Array.from(this.data.values()); }

  hasColumnKey?: KanbanArgs['named']['hasColumnKey'];
  orderBy?: KanbanArgs['named']['orderBy'];

  modify(_positional: never[], named: KanbanArgs['named']) {
    this.hasColumnKey = named.hasColumnKey;
    this.orderBy = named.orderBy;
    this.commit(named.cards, named.columnKeys);
  }
}
```

The key trick: `commit()` walks BOTH the existing column order AND the new cards, preserving position of carry-overs and appending only true additions. Without this, every realm reindex would shuffle the visible order — flickery and disorienting.

**Why use a Resource instead of just `@tracked` on the component:**
- The Resource's lifecycle is tied to its args, not the component instance — surviving across format flips that remount the component.
- State updates inside `modify()` are batched; `@tracked` field changes outside `modify()` re-render exactly what depends on them.
- The factory function pattern (`getChessJS(parent, () => pgn)`) makes the lazy-evaluation contract explicit — args are read each tracking pass.
- Multiple components can share the same Resource by passing the same `parent` reference (rare but possible).

**Gotchas:**
- The args object MUST have shape `{ named: {...} }` (or `{ positional: [...] }` if you use positional args). Forgetting the wrapper breaks `modify()`'s typing.
- Args inside the factory callback must be read inside the callback body — `pgn()` not `pgn`. The Resource library treats the callback as the autotrack barrier.
- Don't initialize state in the constructor — do it in `modify()` so it re-runs on arg changes.
- `@tracked` on the Resource class itself works; plain instance fields don't trigger re-render.
- Import: `import { Resource } from 'ember-modify-based-class-resource';` — there is a different `Resource` in `ember-resources` with a similar but not identical API. The experiments realm uses `ember-modify-based-class-resource` consistently.

**New kanban note:** For new drag-and-drop kanban boards, prefer `layout-kanban-drag-drop` and `KanbanPlane` from `@cardstack/boxel-ui/components`. The `DndColumn` resource recipe above is useful legacy context for CRM/sprint-planner code, but new boards should persist placements separately and let `KanbanPlane` own pointer/keyboard drag behavior.

**Source:**
- `~/Projects/boxel/packages/experiments-realm/kanban-resource.gts` — DndColumn-based kanban with stable ordering.
- `~/Projects/boxel/packages/experiments-realm/chess-game.gts:160-220` — wrapping `chess.js` with history navigation.
- `~/Projects/boxel/packages/experiments-realm/components/base-task-planner.gts` — kanban consumer.

**See also:** `automate-linked-to-me-lookup` (use a query-backed link instead when the state IS the search result), `command-data-resource` (the `commandData<T>` helper, a higher-level wrapper for command-driven async state), `integrate-chess-js-via-cdn` (the CDN loader for chess.js itself).
