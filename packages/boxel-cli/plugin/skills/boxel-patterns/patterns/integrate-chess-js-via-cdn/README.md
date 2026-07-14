---
validated: source-proven
---

# integrate-chess-js-via-cdn — Chess engine + board renderer inside a card

**What this gives you:** A playable chess board inside a card, with move validation (chess.js) and visual rendering (cm-chessboard or similar). Click-to-move, legal-move highlighting, FEN persistence as a card field.

**When to use:** Chess card (BSL-STUDY's canonical example), tactical-puzzle apps, chess-themed learning material. Generalize the pattern to other game engines (`stockfish.js`, `js-chess-engine`, etc.) that need both engine logic + visual renderer.

**The insight:** This is the canonical "engine + renderer" combo pattern. The **engine** (`chess.js`) is pure JS — load it via CDN, mutate it on each move, persist its state as FEN string in a card field. The **renderer** (`cm-chessboard`) is a separate library that draws the board. Wire them together: renderer fires events → engine validates → engine state updates → renderer re-renders.

**Recipe shape:**

```ts
import { modifier } from 'ember-modifier';
import { Chess } from 'https://esm.run/chess.js@1.0.0';
import { Chessboard } from 'https://esm.run/cm-chessboard@8.7.0';
import 'https://esm.run/cm-chessboard@8.7.0/assets/chessboard.css';

const chessBoardModifier = modifier(
  (
    element: HTMLElement,
    [config]: [{ fen: string; onMove: (fen: string) => void }],
  ) => {
    const game = new Chess(config.fen);
    const board = new Chessboard(element, {
      position: config.fen,
      // … standard cm-chessboard options
    });

    board.enableMoveInput((event) => {
      if (event.type === 'moveInputStarted') {
        return true; // allow pickup
      }
      if (event.type === 'validateMoveInput') {
        const move = game.move({
          from: event.squareFrom,
          to: event.squareTo,
          promotion: 'q',
        });
        if (!move) return false;
        config.onMove(game.fen());
        return true;
      }
    });

    return () => {
      board.destroy();
    };
  },
);
```

**Gotchas:**

- **CSS is required.** cm-chessboard ships SVGs and CSS for the squares + pieces — import the CSS from the same CDN URL.
- **FEN strings are the source of truth.** Store the game state as FEN (`@field fen = contains(StringField)`). Don't try to persist the chess.js object directly — it's not serializable.
- **Promotion handling** — for pawn-to-back-rank moves, you must specify a `promotion` piece or chess.js rejects the move. The minimal default is `'q'` (queen).
- **Move validation must happen before the visual update.** Otherwise the user can "make" illegal moves visually but they don't stick.
- **Version pinning.** Both libraries pinned — chess.js@1.0.0 and cm-chessboard@8.7.0 (or whichever versions you've tested).

**Source:** BSL-STUDY V1 cites `chess/chess.gts:14-36` in the catalog-realm as the canonical example. The same pattern works for other ESM engine + renderer combos.

**See also:** `integrate-three-js-via-cdn` (similar load + cleanup shape), `boxel/references/external-libraries.md` (the underlying lifecycle pattern).
