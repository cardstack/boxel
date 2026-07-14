---
validated: source-proven
---

# organize-base-class-taxonomy — Empty base CardDef as a query-by-type taxonomy

**What this gives you:** A way to query "all cards in category X" without adding a `kind` field to every card. The base class IS the category — subclasses inherit it, and a single `{ filter: { on: BaseClass } }` query surfaces every member of the family.

**When to use:** You have a family of related CardDef types (`Wordle`, `TicTacToe`, `Chess` are all games) and you want them browseable as a group. Or you're laying out a feature where users add cards of related types and you need an "all of this family" filter.

**The insight:** Boxel queries can target a base CardDef and return any subclass. So a trivially-empty `class Game extends CardDef` becomes a real type that the indexer understands — every game subclass inherits it implicitly, and queries filtering `on: Game` pick them all up. No `kind: string` field, no manual categorization, no string-comparison filters.

**Recipe shape:**

```ts
// games/game.gts — the taxonomy root
export class Game extends CardDef {
  static displayName = 'Game';
  // intentionally empty
}

// games/wordle.gts
import { Game } from './game';
export class Wordle extends Game {
  static displayName = 'Wordle';
  @field guesses = containsMany(StringField);
  // …
}

// games/tic-tac-toe.gts
import { Game } from './game';
export class TicTacToe extends Game {
  static displayName = 'Tic-Tac-Toe';
  // …
}

// Querying — gets every game (every subclass of Game):
import { codeRef } from '@cardstack/runtime-common';
const gameRef = codeRef(import.meta.url, './games/game', 'Game');
const query: Query = {
  filter: { type: gameRef },
};

// ⚠️ Use `filter: { type: ref }` — NOT `filter: { on: ref }`.
// `on` is a *scope* for predicates (`eq`/`contains`/`range`), not a filter
// on its own — a bare `{ on: ref }` returns zero rows silently. To match
// all instances of a CardDef (including subclasses), the canonical shape
// is `filter: { type: ref }`. See `boxel/references/query-systems.md`.
```

**Gotchas:**

- The base class must be exported and importable from the same module URL the indexer sees. Relative imports work; ensure the module is reachable.
- Keep the base class genuinely empty (or with only fields shared by _all_ members). Anything else encourages premature abstraction.
- For multiple taxonomies on the same card (e.g. a card that's both a `Game` and a `Featured`), use linking (`linksTo Featured`) — multiple inheritance isn't a thing.
- The taxonomy only works if subclasses are saved with `adoptsFrom` pointing at themselves, not the base — standard Boxel behavior.

**Source:** `boxel-catalog/blog-app/games/game.gts` (1 line of code, used to query all games in `blog-app.gts`).

**See also:** `boxel/references/core-concept.md`, `automate-linked-to-me-lookup`, `show-card-list-with-views`.
