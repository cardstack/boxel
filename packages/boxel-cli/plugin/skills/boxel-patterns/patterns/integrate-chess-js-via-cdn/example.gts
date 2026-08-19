import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { modifier } from 'ember-modifier';
import { action } from '@ember/object';
// @ts-expect-error esm.run is a runtime import
import { Chess } from 'https://esm.run/chess.js@1.0.0';
// @ts-expect-error esm.run is a runtime import
import { Chessboard, INPUT_EVENT_TYPE } from 'https://esm.run/cm-chessboard@8.7.0';

// 🧩 PATTERN: Chess engine (chess.js) + board renderer (cm-chessboard).

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

interface BoardConfig {
  fen: string;
  onMove: (newFen: string) => void;
}

const chessBoardModifier = modifier(
  (element: HTMLElement, [config]: [BoardConfig]) => {
    const game = new Chess(config.fen);
    const board = new Chessboard(element, {
      position: config.fen,
      assetsUrl: 'https://esm.run/cm-chessboard@8.7.0/assets/',
      style: { borderType: 'thin', pieces: { file: 'pieces/staunty.svg' } },
    });

    board.enableMoveInput((event: any) => {
      if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
        // Allow pickup only if it's the side-to-move's piece.
        const piece = game.get(event.square);
        if (!piece) return false;
        return piece.color === game.turn();
      }
      if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
        const move = game.move({
          from: event.squareFrom,
          to: event.squareTo,
          promotion: 'q', // simplest promotion default
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

// === The CardDef ======================================================

export class ChessCard extends CardDef {
  static displayName = 'Chess';

  @field fen = contains(StringField);

  static isolated = class extends Component<typeof ChessCard> {
    get currentFen(): string {
      return this.args.model.fen ?? STARTING_FEN;
    }

    @action handleMove(newFen: string) {
      this.args.model.fen = newFen;
    }

    get config(): BoardConfig {
      return {
        fen: this.currentFen,
        onMove: this.handleMove,
      };
    }

    <template>
      {{!-- cm-chessboard CSS for piece sprites + square colors --}}
      <link rel='stylesheet' href='https://esm.run/cm-chessboard@8.7.0/assets/chessboard.css' />

      <article class='chess-card'>
        <h1>Game</h1>
        <div class='board-host' {{chessBoardModifier this.config}}></div>
        <p class='fen'><code>{{this.currentFen}}</code></p>
      </article>

      <style scoped>
        .chess-card { padding: 1rem; }
        .board-host {
          width: 100%;
          max-width: 480px;
          aspect-ratio: 1;        /* Square */
          margin: 1rem auto;
        }
        .fen {
          font-size: 0.75rem;
          word-break: break-all;
          color: var(--muted-foreground, #666);
        }
      </style>
    </template>
  };
}
