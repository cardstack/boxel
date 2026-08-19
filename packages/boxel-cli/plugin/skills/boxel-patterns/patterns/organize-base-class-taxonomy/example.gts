import { CardDef, field, contains, containsMany, StringField, Component } from 'https://cardstack.com/base/card-api';

// 🧩 PATTERN: Empty base class as a query-by-type taxonomy.
//
// One-line base class + subclasses that inherit it. Query `on: Game`
// returns every Game subclass without any `kind` field.

// === The taxonomy root ===============================================

export class Game extends CardDef {
  static displayName = 'Game';
  // intentionally empty — subclasses define their own schemas
}

// === A subclass ======================================================

export class Wordle extends Game {
  static displayName = 'Wordle';

  @field targetWord = contains(StringField);
  @field guesses    = containsMany(StringField);

  static isolated = class extends Component<typeof Wordle> {
    <template>
      <article class='wordle'>
        <h1>Wordle</h1>
        <p>Target: {{@model.targetWord}}</p>
        <ol>
          {{#each @model.guesses as |g|}}
            <li>{{g}}</li>
          {{/each}}
        </ol>
      </article>
    </template>
  };
}

// === Another subclass ================================================

export class TicTacToe extends Game {
  static displayName = 'Tic-Tac-Toe';

  @field currentPlayer = contains(StringField);  // 'X' | 'O'
  @field board         = contains(StringField);  // serialized 3x3
}

// === Querying all games (in a consuming card) ========================
//
//   import { type Query } from '@cardstack/runtime-common';
//
//   // @ts-expect-error import.meta is supported by the Boxel host
//   const gameModule = new URL('./game', import.meta.url).href;
//
//   const allGames: Query = {
//     filter: {
//       on: { module: gameModule, name: 'Game' },
//     },
//   };
//
//   // Pass to <CardsGrid @query={{allGames}} … /> and you get
//   // Wordle + TicTacToe + every other Game subclass in your realm.
