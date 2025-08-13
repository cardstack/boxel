import {
  Component as BoxelComponent,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import Component from '@glimmer/component';
import StringField from 'https://cardstack.com/base/string';
import { contains, field } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import { cn } from '@cardstack/boxel-ui/helpers';
import { not } from '@cardstack/boxel-ui/helpers';

// @ts-ignore
import {
  Chessboard,
  INPUT_EVENT_TYPE,
  COLOR,
  PROMOTION_DIALOG_RESULT_TYPE,
  // @ts-ignore
} from 'https://esm.run/cm-chessboard@8.7.3';

//@ts-ignore
import { action } from '@ember/object';

//@ts-ignore
import { Chess as _ChessJS } from 'https://cdn.jsdelivr.net/npm/chess.js/+esm';
import type { Chess as _ChessJSType } from 'chess.js';
type ChessJS = _ChessJSType;
const ChessJS: typeof _ChessJSType = _ChessJS;

//@ts-ignore
import {
  MARKER_TYPE,
  Markers,
  //@ts-ignore
} from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8.7.3/src/extensions/markers/Markers.js/+esm';

import Modifier from 'ember-modifier';
import { Resource } from 'ember-modify-based-class-resource';

import BooleanField from 'https://cardstack.com/base/boolean';
import { tracked } from '@glimmer/tracking';
import ChessIcon from '@cardstack/boxel-icons/chess';

type ChessboardModifierSignature = {
  Args: {
    Named: {
      game: ChessJS;
      updatePgn: (pgn: string) => void;
    };
  };
  Element: HTMLElement;
};

class ChessboardModifier extends Modifier<ChessboardModifierSignature> {
  chessboard: any;
  modify(
    element: HTMLElement,
    _positional: [],
    { game, updatePgn }: ChessboardModifierSignature['Args']['Named'],
  ) {
    function inputHandler(event: any) {
      if (event.type === INPUT_EVENT_TYPE.movingOverSquare) {
        return; // ignore this event
      }
      if (event.type !== INPUT_EVENT_TYPE.moveInputFinished) {
        event.chessboard.removeMarkers(MARKER_TYPE.bevel);
        event.chessboard.removeMarkers(MARKER_TYPE.dot);
      }
      if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
        console.log(`moveInputStarted: ${event.squareFrom}`);
        const moves = game.moves({
          square: event.squareFrom,
          verbose: true,
        });

        event.chessboard.addLegalMovesMarkers(moves);
        return moves.length > 0;
      } else if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
        console.log(`validateMoveInput: ${event.squareFrom}-${event.squareTo}`);
        const move = {
          from: event.squareFrom,
          to: event.squareTo,
          promotion: event.promotion,
        };
        const result = game.move(move);
        if (result) {
          event.chessboard.state.moveInputProcess.then(() => {
            // wait for the move input process has finished
            event.chessboard.setPosition(game.fen(), true).then(() => {
              updatePgn(game.pgn());
              // update position, maybe castled and wait for animation has finished
              // makeEngineMove(event.chessboard)
            });
          });
        } else {
          // promotion?
          let possibleMoves = game.moves({
            square: event.squareFrom,
            verbose: true,
          });
          for (const possibleMove of possibleMoves) {
            if (possibleMove.promotion && possibleMove.to === event.squareTo) {
              event.chessboard.showPromotionDialog(
                event.squareTo,
                COLOR.white,
                (result: any) => {
                  console.log('promotion result', result);
                  if (
                    result.type === PROMOTION_DIALOG_RESULT_TYPE.pieceSelected
                  ) {
                    game.move({
                      from: event.squareFrom,
                      to: event.squareTo,
                      promotion: result.piece.charAt(1),
                    });
                    event.chessboard.setPosition(game.fen(), true);
                    // makeEngineMove(event.chessboard)
                  } else {
                    // promotion canceled
                    event.chessboard.enableMoveInput(inputHandler, COLOR.white);
                    event.chessboard.setPosition(game.fen(), true);
                  }
                },
              );
              return true;
            }
          }
        }
        return result;
      }
      return undefined;
    }
    if (this.chessboard === undefined) {
      this.chessboard = new Chessboard(element, {
        position: game.fen(),
        assetsUrl: 'https://cdn.jsdelivr.net/npm/cm-chessboard@latest/assets/',
        style: {
          cssClass: 'green',
          pieces: {
            file: 'pieces/staunty.svg',
          },
        },
        extensions: [
          { class: Markers, props: { autoMarkers: MARKER_TYPE.square } },
        ],
      });
      this.chessboard.enableMoveInput(inputHandler);
    } else {
      //I hate that I have to do this
      //It comes from inputHandler function perhaps needs to use an arrow
      this.chessboard.setPosition(game.fen());
      this.chessboard.disableMoveInput();
      this.chessboard.enableMoveInput(inputHandler);
    }
  }
}

interface ChessJSResourceArgs {
  named: {
    pgn?: string;
  };
}

class ChessJSResource extends Resource<ChessJSResourceArgs> {
  game!: ChessJS;
  snapshot!: ChessJS;
  private future: string[] = [];
  @tracked snapshotPgn: string | undefined;

  modify(_positional: never[], named: ChessJSResourceArgs['named']) {
    this.game = new ChessJS();
    this.snapshot = new ChessJS();
    if (named.pgn) {
      this.game.loadPgn(named.pgn);
    }

    if (this.snapshotPgn) {
      this.snapshot.loadPgn(this.snapshotPgn);
    } else if (named.pgn) {
      this.snapshot.loadPgn(named.pgn);
    }
  }

  @action
  prev() {
    let tmp = new ChessJS();
    let moves = this.game.history();
    let previous = moves.length - this.future.length - 1;
    for (var i = 0; i < previous; i++) {
      tmp.move(moves[i]);
    }
    let previousPgn = tmp.pgn();
    tmp.move(moves[previous]);
    let futurePgn = tmp.pgn();
    this.future.push(futurePgn);
    this.snapshotPgn = previousPgn;
  }

  @action
  next() {
    this.snapshotPgn = this.future.pop();
  }

  @action
  updatePgn(pgn: string) {
    this.future = [];
    this.snapshotPgn = pgn;
  }

  @action reset() {
    this.snapshotPgn = '';
    this.future = [];
    this.game = new ChessJS();
    this.snapshot = new ChessJS();
  }
}

function getChessJS(parent: object, pgn: () => string | undefined) {
  return ChessJSResource.from(parent, () => ({
    named: {
      pgn: pgn(),
    },
  }));
}

interface ChessGameComponentSignature {
  Args: {
    pgn?: string;
    updatePgn?: (pgn: string) => void;
    analysis?: boolean;
  };
}

type GameState = 'checkmate' | 'check' | 'draw' | 'play';

class ChessGameComponent extends Component<ChessGameComponentSignature> {
  <template>
    <div class='content'>
      <div class='position-info'>
        <div><strong>Pgn:</strong> {{this.pgnDisplay}}</div>
      </div>
      <div class='board-container'>
        <div
          id='board'
          class={{cn disabled=this.notAtMostCurrentMove}}
          {{ChessboardModifier game=this.snapshot updatePgn=this.updatePgn}}
        >
        </div>
      </div>
      <div class='actions'>
        <button {{on 'click' this.prevMove}}>Prev Move</button>
        <button {{on 'click' this.nextMove}}>Next Move</button>
        <button {{on 'click' this.backToPosition}}>Back To Game Position</button>
        {{#if (not @analysis)}}
          <button {{on 'click' this.reset}}>Reset</button>
        {{/if}}
      </div>

      <div class='info'>

        <div class='game-info'>
          <h2> Info </h2>
          <div><strong>Turn:</strong> {{this.turn}}</div>
          <div><strong>State:</strong> {{this.state}}</div>
          <div><strong>Move:</strong> {{this.moveNumber}}</div>
        </div>
        <div class='move-info'>
          <h2>Game Moves</h2>
          <div class='game-moves'>
            {{#each this.moves as |move|}}
              <div>
                {{move}}
              </div>
            {{/each}}
          </div>

        </div>
      </div>

    </div>
    <style scoped>
      .content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 15px;
        max-width: 700px;
      }
      .actions {
        display: flex;
        flex-direction: row;
        gap: 10px;
      }
      #board {
        width: 600px;
      }
      #board.disabled {
        pointer-events: none;
      }
      .selected {
        color: red;
      }
      .info {
        display: flex;
        width: 100%;
      }
      .game-info {
        flex: 1;
      }

      .move-info {
        flex: 3;
      }
      .game-moves {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        gap: 2px;
      }
    </style>
    <link
      href='https://cdn.jsdelivr.net/npm/cm-chessboard@8.7.3/assets/chessboard.css'
      rel='stylesheet'
    />
    <link
      rel='stylesheet'
      href='https://cdn.jsdelivr.net/npm/cm-chessboard@8.7.3/assets/extensions/markers/markers.css'
    />
    {{! This is absolutely needed so piece doesn't diapplear when dragging }}
    {{! template-lint-disable require-scoped-style }}
    <style>
      .cm-chessboard-draggable-piece {
        z-index: 100;
      }
    </style>
  </template>

  private chessJSResource = getChessJS(this, () => this.args.pgn);
  @tracked selectedMoveIndex: number | undefined;

  @action
  updatePgn(pgn: string) {
    if (this.args.analysis) {
      this.chessJSResource.updatePgn(pgn);
    } else {
      this.args.updatePgn!(pgn);
    }
  }

  get notAtMostCurrentMove() {
    return !this.args.analysis && !(this.pgnDisplay === this.game.pgn());
  }

  //Game state
  get game() {
    return this.chessJSResource.game;
  }
  get pgnDisplay() {
    return this.snapshot.pgn();
  }

  get isGameOver() {
    return this.game.isGameOver();
  }

  get moves() {
    return this.game.history({ verbose: true }).map((move) => move.san);
  }

  @action
  reset() {
    this.args.updatePgn!('');
    this.chessJSResource.reset();
  }
  //snapshot state
  get snapshot() {
    return this.chessJSResource.snapshot;
  }

  get snapshotHistory() {
    return this.snapshot.history({ verbose: true });
  }
  get snapshotMoves() {
    return this.snapshotHistory.map((move) => move.san);
  }

  get fen() {
    return this.snapshot.fen();
  }

  get turn() {
    return this.snapshot.turn() === 'b' ? 'black' : 'white';
  }

  get moveNumber() {
    return this.snapshot.moveNumber();
  }

  get state(): GameState {
    if (this.snapshot.isCheckmate()) {
      return 'checkmate';
    }
    if (this.snapshot.inCheck()) {
      return 'check';
    }
    if (this.snapshot.isDraw()) {
      return 'draw';
    }
    return 'play';
  }

  @action
  prevMove() {
    this.chessJSResource.prev();
  }

  @action
  nextMove() {
    this.chessJSResource.next();
  }

  @action
  backToPosition() {
    this.selectedMoveIndex = undefined;
    this.chessJSResource.updatePgn(this.game.pgn());
  }
}

class Isolated extends BoxelComponent<typeof Chess> {
  @action
  updatePgn(pgn: string): void {
    this.args.model.pgn = pgn;
  }

  // have to toggle between analysis and play mode
  get mode() {
    return this.args.model.analysis ? 'Analysis' : 'Game';
  }

  <template>
    <div class='main'>
      <div class={{cn analysis=@model.analysis}}>
        <h1>
          {{this.mode}}
        </h1>
      </div>
      <ChessGameComponent
        @pgn={{@model.validatedPgn}}
        @updatePgn={{this.updatePgn}}
        @analysis={{@model.analysis}}
      />
    </div>
    <style scoped>
      .main {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .analysis {
        color: blue;
      }
    </style>
  </template>
}

export class Chess extends CardDef {
  static displayName = 'Chess';
  static icon = ChessIcon;
  @field pgn = contains(StringField);
  @field analysis = contains(BooleanField);

  @field title = contains(StringField, {
    computeVia: function (this: Chess) {
      return 'Chess Game';
    },
  });

  @field validatedPgn = contains(StringField, {
    computeVia: function (this: Chess) {
      if (this.pgn == null) {
        return this.pgn;
      }
      // Validating pgn string
      let chess = new ChessJS();
      chess.loadPgn(this.pgn);
      return this.pgn;
    },
  });

  static isolated = Isolated;
}
