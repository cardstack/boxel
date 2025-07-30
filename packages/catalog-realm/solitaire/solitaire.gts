import { CardDef, Component } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn, get, concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import {
  eq,
  gt,
  lt,
  add,
  multiply,
  subtract,
} from '@cardstack/boxel-ui/helpers';

// Define slice helper locally since it's not available from imports
function slice(array: any[], start: number, end?: number): any[] {
  if (!array || !Array.isArray(array)) return [];
  return array.slice(start, end);
}

// Card interface
interface Card {
  suit: string;
  rank: string;
  value: number;
  color: 'red' | 'black';
  faceUp: boolean;
}

class IsolatedTemplate extends Component<typeof Solitaire> {
  @tracked deck: Card[] = [];
  @tracked stock: Card[] = [];
  @tracked waste: Card[] = [];
  @tracked foundations: Card[][] = [[], [], [], []];
  @tracked tableau: Card[][] = [[], [], [], [], [], [], []];
  @tracked selectedCard: Card | null = null;
  @tracked selectedPile: { type: string; index: number } | null = null;
  @tracked moves = 0;
  @tracked seconds = 0;
  @tracked isPlaying = false;
  @tracked gameWon = false;

  timer: any = null;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.initializeGame();
  }

  willDestroy() {
    super.willDestroy();
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  get timeDisplay() {
    const minutes = Math.floor(this.seconds / 60);
    const secs = this.seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  @action
  initializeGame() {
    // Create deck
    this.deck = [];
    const suits = ['♠', '♣', '♥', '♦'];
    const ranks = [
      'A',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      'J',
      'Q',
      'K',
    ];

    suits.forEach((suit) => {
      ranks.forEach((rank, index) => {
        this.deck.push({
          suit,
          rank,
          value: index + 1,
          color: suit === '♥' || suit === '♦' ? 'red' : 'black',
          faceUp: false,
        });
      });
    });

    // Shuffle
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }

    // Deal
    this.tableau = [[], [], [], [], [], [], []];
    this.foundations = [[], [], [], []];
    this.waste = [];

    let cardIndex = 0;
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j <= i; j++) {
        const card = this.deck[cardIndex++];
        if (j === i) {
          card.faceUp = true;
        }
        this.tableau[i].push(card);
      }
    }

    // Rest to stock
    this.stock = this.deck.slice(cardIndex);
    this.moves = 0;
    this.seconds = 0;
    this.isPlaying = true;
    this.gameWon = false;
    this.selectedCard = null;
    this.selectedPile = null;

    // Start timer
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      if (this.isPlaying && !this.gameWon) {
        this.seconds++;
      }
    }, 1000);
  }

  @action
  drawCard() {
    // Clear any existing selection when drawing new cards
    this.selectedCard = null;
    this.selectedPile = null;

    if (this.stock.length === 0) {
      // Return ALL waste cards to stock (not just displayed ones)
      if (this.waste.length === 0) {
        // No cards to recycle
        return;
      }

      // Collect all cards from waste back to stock
      const allWasteCards = [...this.waste];
      allWasteCards.forEach((card) => (card.faceUp = false));
      this.stock = allWasteCards.reverse();
      this.waste = [];
    } else {
      // Draw up to 3 cards
      const drawCount = Math.min(3, this.stock.length);
      const newStock = [...this.stock];
      const drawnCards = [];

      for (let i = 0; i < drawCount; i++) {
        const card = newStock.pop()!;
        card.faceUp = true;
        drawnCards.push(card);
      }

      // Add to existing waste pile
      this.waste = [...this.waste, ...drawnCards];
      this.stock = newStock;
    }
    this.moves++;
  }

  @action
  selectCard(card: Card, pileType: string, pileIndex: number) {
    if (!card.faceUp) return;

    if (this.selectedCard === card) {
      // Deselect
      this.selectedCard = null;
      this.selectedPile = null;
    } else if (this.selectedCard) {
      // Try to move to the clicked card's pile
      this.tryMove(pileType, pileIndex);
    } else {
      // Select
      this.selectedCard = card;
      this.selectedPile = { type: pileType, index: pileIndex };
    }
  }

  @action
  tryMove(targetType: string, targetIndex: number) {
    if (!this.selectedCard || !this.selectedPile) return;

    if (targetType === 'foundation') {
      if (this.canMoveToFoundation(this.selectedCard, targetIndex)) {
        this.moveToFoundation(targetIndex);
      }
    } else if (targetType === 'tableau') {
      if (this.canMoveToTableau(this.selectedCard, targetIndex)) {
        this.moveToTableau(targetIndex);
      }
    }
  }

  @action
  canMoveToFoundation(card: Card, foundationIndex: number): boolean {
    const foundation = this.foundations[foundationIndex];

    if (foundation.length === 0) {
      return card.rank === 'A';
    }

    const topCard = foundation[foundation.length - 1];
    return card.suit === topCard.suit && card.value === topCard.value + 1;
  }

  @action
  canMoveToTableau(card: Card, tableauIndex: number): boolean {
    const pile = this.tableau[tableauIndex];

    if (pile.length === 0) {
      return card.rank === 'K';
    }

    const topCard = pile[pile.length - 1];
    // Check if the card being placed is one less in value and opposite color
    return card.color !== topCard.color && card.value === topCard.value - 1;
  }

  @action
  moveToFoundation(foundationIndex: number) {
    if (!this.selectedCard || !this.selectedPile) return;

    const sourcePile = this.getSourcePile();
    const cardIndex = sourcePile.indexOf(this.selectedCard);

    // Only allow moving the last card from waste or tableau to foundation
    if (cardIndex === sourcePile.length - 1) {
      if (this.selectedPile.type === 'waste') {
        // Remove from waste
        const newWaste = [...this.waste];
        newWaste.pop();
        this.waste = newWaste;
      } else if (this.selectedPile.type === 'tableau') {
        // Remove from tableau
        const newTableau = [...this.tableau];
        newTableau[this.selectedPile.index] = [
          ...newTableau[this.selectedPile.index],
        ];
        newTableau[this.selectedPile.index].pop();
        this.tableau = newTableau;
      }

      // Add to foundation
      const newFoundations = [...this.foundations];
      newFoundations[foundationIndex] = [
        ...newFoundations[foundationIndex],
        this.selectedCard,
      ];
      this.foundations = newFoundations;

      // Flip new top card if needed
      this.flipTopCard();

      this.moves++;
    }

    this.selectedCard = null;
    this.selectedPile = null;
  }

  @action
  moveToTableau(tableauIndex: number) {
    if (!this.selectedCard || !this.selectedPile) return;

    const sourcePile = this.getSourcePile();
    const cardIndex = sourcePile.indexOf(this.selectedCard);

    if (this.selectedPile.type === 'waste') {
      // Can only move the last card from waste
      if (cardIndex === this.waste.length - 1) {
        const newWaste = [...this.waste];
        const card = newWaste.pop()!;
        this.waste = newWaste;

        const newTableau = [...this.tableau];
        newTableau[tableauIndex] = [...newTableau[tableauIndex], card];
        this.tableau = newTableau;
      }
    } else if (this.selectedPile.type === 'tableau') {
      // Move card and all cards on top of it
      const sourceIndex = this.selectedPile.index;
      const newTableau = [...this.tableau];

      // Copy source pile and remove cards
      const sourcePileCopy = [...newTableau[sourceIndex]];
      const cardsToMove = sourcePileCopy.splice(cardIndex);
      newTableau[sourceIndex] = sourcePileCopy;

      // Add cards to destination
      newTableau[tableauIndex] = [...newTableau[tableauIndex], ...cardsToMove];
      this.tableau = newTableau;
    }

    // Flip new top card if needed
    this.flipTopCard();

    this.moves++;

    this.selectedCard = null;
    this.selectedPile = null;
  }

  @action
  getSourcePile(): Card[] {
    if (!this.selectedPile) return [];

    if (this.selectedPile.type === 'waste') {
      return this.waste;
    } else if (this.selectedPile.type === 'tableau') {
      return this.tableau[this.selectedPile.index];
    } else if (this.selectedPile.type === 'foundation') {
      return this.foundations[this.selectedPile.index];
    }

    return [];
  }

  @action
  flipTopCard() {
    if (!this.selectedPile || this.selectedPile.type !== 'tableau') return;

    const pile = this.tableau[this.selectedPile.index];
    if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
      pile[pile.length - 1].faceUp = true;
    }
  }

  @action
  doubleClickCard(card: Card, pileType: string, pileIndex: number) {
    // Try to auto-move to foundation
    for (let i = 0; i < 4; i++) {
      if (this.canMoveToFoundation(card, i)) {
        this.selectedCard = card;
        this.selectedPile = { type: pileType, index: pileIndex };
        this.moveToFoundation(i);
        return;
      }
    }
  }

  @action
  emptyPileClick(pileType: string, pileIndex: number) {
    if (this.selectedCard && pileType === 'tableau') {
      this.tryMove(pileType, pileIndex);
    }
  }

  <template>
    <div class='solitaire-game'>
      <div class='header'>
        <h1>♠ Solitaire ♣</h1>
        <div class='stats'>
          <span>Moves: {{this.moves}}</span>
          <span>Time: {{this.timeDisplay}}</span>
        </div>
        <button class='new-game-btn' {{on 'click' this.initializeGame}}>
          New Game
        </button>
      </div>

      {{#if this.gameWon}}
        <div class='win-modal'>
          <div class='win-content'>
            <h2>🎉 You Won! 🎉</h2>
            <p>Completed in {{this.moves}} moves</p>
            <p>Time: {{this.timeDisplay}}</p>
            <button {{on 'click' this.initializeGame}}>Play Again</button>
          </div>
        </div>
      {{/if}}

      <div class='game-board'>
        <div class='top-area'>
          <div class='stock-waste'>
            <button
              type='button'
              class='stock pile'
              {{on 'click' this.drawCard}}
            >
              {{#if (gt this.stock.length 0)}}
                <div class='card face-down'>
                  <div class='card-back'></div>
                </div>
                <span class='pile-count'>{{this.stock.length}}</span>
              {{else}}
                <div class='empty-stock'>↻</div>
              {{/if}}
            </button>

            <div class='waste pile'>
              {{#if (gt this.waste.length 0)}}
                <div class='waste-stack'>
                  {{#let (subtract this.waste.length 1) as |lastIndex|}}
                    {{#let (subtract lastIndex 2) as |startIndex|}}
                      {{#each
                        (slice
                          this.waste
                          (if (lt startIndex 0) 0 startIndex)
                          this.waste.length
                        )
                        as |card index|
                      }}
                        <button
                          type='button'
                          class='card face-up
                            {{if (eq this.selectedCard card) "selected"}}
                            {{if
                              (eq card (get this.waste lastIndex))
                              "top-card"
                            }}'
                          style={{htmlSafe
                            (concat 'left: ' (multiply index 30) 'px')
                          }}
                          {{on
                            'click'
                            (fn
                              this.selectCard
                              card
                              'waste'
                              (add (if (lt startIndex 0) 0 startIndex) index)
                            )
                          }}
                          {{on
                            'dblclick'
                            (fn
                              this.doubleClickCard
                              card
                              'waste'
                              (add (if (lt startIndex 0) 0 startIndex) index)
                            )
                          }}
                        >
                          <div class='card-content'>
                            <span
                              class='rank {{card.color}}'
                            >{{card.rank}}</span>
                            <span
                              class='suit {{card.color}}'
                            >{{card.suit}}</span>
                          </div>
                        </button>
                      {{/each}}
                    {{/let}}
                  {{/let}}
                </div>
              {{/if}}
            </div>
          </div>

          <div class='foundations'>
            {{#each this.foundations as |foundation index|}}
              <button
                type='button'
                class='foundation pile'
                {{on 'click' (fn this.tryMove 'foundation' index)}}
              >
                {{#if (gt foundation.length 0)}}
                  {{#let
                    (get foundation (subtract foundation.length 1))
                    as |topCard|
                  }}
                    <div class='card face-up'>
                      <div class='card-content'>
                        <span
                          class='rank {{topCard.color}}'
                        >{{topCard.rank}}</span>
                        <span
                          class='suit {{topCard.color}}'
                        >{{topCard.suit}}</span>
                      </div>
                    </div>
                  {{/let}}
                {{else}}
                  <div class='empty-foundation'>A</div>
                {{/if}}
              </button>
            {{/each}}
          </div>
        </div>

        <div class='tableau-area'>
          {{#each this.tableau as |pile pileIndex|}}
            <div class='tableau-column'>
              {{#if (eq pile.length 0)}}
                <button
                  type='button'
                  class='empty-tableau'
                  {{on 'click' (fn this.emptyPileClick 'tableau' pileIndex)}}
                >
                  K
                </button>
              {{else}}
                {{#each pile as |card cardIndex|}}
                  <button
                    type='button'
                    class='card
                      {{if card.faceUp "face-up" "face-down"}}
                      {{if (eq this.selectedCard card) "selected"}}'
                    style={{htmlSafe
                      (concat
                        'top: '
                        (multiply cardIndex 25)
                        'px; z-index: '
                        cardIndex
                        ';'
                      )
                    }}
                    {{on 'click' (fn this.selectCard card 'tableau' pileIndex)}}
                    {{on
                      'dblclick'
                      (fn this.doubleClickCard card 'tableau' pileIndex)
                    }}
                  >
                    {{#if card.faceUp}}
                      <div class='card-content'>
                        <span class='rank {{card.color}}'>{{card.rank}}</span>
                        <span class='suit {{card.color}}'>{{card.suit}}</span>
                      </div>
                    {{else}}
                      <div class='card-back'></div>
                    {{/if}}
                  </button>
                {{/each}}
              {{/if}}
            </div>
          {{/each}}
        </div>
      </div>
    </div>

    <style scoped>
      .solitaire-game {
        background: #2d6e2d;
        min-height: 100vh;
        padding: 20px;
        position: relative;
      }

      .header {
        text-align: center;
        margin-bottom: 20px;
      }

      .header h1 {
        color: white;
        margin: 0 0 10px 0;
        font-size: 2.5em;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
      }

      .stats {
        color: white;
        font-size: 1.2em;
        display: flex;
        justify-content: center;
        gap: 30px;
        margin-bottom: 10px;
      }

      .new-game-btn {
        background: #4caf50;
        color: white;
        border: none;
        padding: 10px 20px;
        font-size: 1.1em;
        border-radius: 5px;
        cursor: pointer;
        transition: background 0.3s;
      }

      .new-game-btn:hover {
        background: #5cbf60;
      }

      .game-board {
        max-width: 900px;
        margin: 0 auto;
      }

      .top-area {
        display: flex;
        justify-content: space-between;
        margin-bottom: 40px;
      }

      .stock-waste {
        display: flex;
        gap: 20px;
      }

      .foundations {
        display: flex;
        gap: 10px;
      }

      .tableau-area {
        display: flex;
        justify-content: center;
        gap: 10px;
      }

      .pile {
        width: 90px;
        height: 125px;
        border: 2px dashed rgba(255, 255, 255, 0.3);
        border-radius: 8px;
        position: relative;
      }

      /* Button styling to make them look like divs */
      button.pile {
        background: none;
        border: 2px dashed rgba(255, 255, 255, 0.3);
        padding: 0;
        margin: 0;
        font-family: inherit;
        cursor: pointer;
      }

      button.card {
        background: white;
        border: 1px solid #333;
        padding: 0;
        margin: 0;
        font-family: inherit;
        cursor: pointer;
      }

      button.empty-tableau {
        background: none;
        border: 2px dashed rgba(255, 255, 255, 0.3);
        padding: 0;
        margin: 0;
        font-family: inherit;
        cursor: pointer;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.8em;
        color: rgba(255, 255, 255, 0.3);
        font-weight: bold;
      }

      .tableau-column {
        width: 90px;
        position: relative;
        min-height: 125px;
        padding-bottom: 200px; /* Extra space for cascading cards */
      }

      .card {
        width: 90px;
        height: 125px;
        background: white;
        border: 1px solid #333;
        border-radius: 8px;
        position: absolute;
        top: 0;
        cursor: pointer;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
        transition: all 0.2s;
      }

      .card-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: 10px;
      }

      .card:hover {
        transform: translateY(-5px);
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.4);
      }

      .card.selected {
        box-shadow:
          0 0 0 3px #ffd700,
          0 0 10px #ffd700;
        transform: translateY(-2px);
      }

      .card-back {
        width: 100%;
        height: 100%;
        background: repeating-linear-gradient(
          45deg,
          #1e3c72,
          #1e3c72 5px,
          #2a5298 5px,
          #2a5298 10px
        );
        border-radius: 7px;
      }

      .rank {
        font-size: 1.5em;
        font-weight: bold;
      }

      .suit {
        font-size: 2em;
      }

      .red {
        color: #e74c3c;
      }

      .black {
        color: #2c3e50;
      }

      .empty-stock,
      .empty-foundation,
      .empty-tableau {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.8em;
        color: rgba(255, 255, 255, 0.3);
        font-weight: bold;
      }

      .stock {
        cursor: pointer;
      }

      .pile-count {
        position: absolute;
        bottom: 5px;
        right: 5px;
        color: white;
        font-size: 0.8em;
        background: rgba(0, 0, 0, 0.5);
        padding: 2px 6px;
        border-radius: 3px;
      }

      .waste-stack {
        position: relative;
        width: 100%;
        height: 100%;
      }

      .waste-stack .card {
        position: absolute;
        pointer-events: none;
      }

      .waste-stack .card.top-card {
        pointer-events: auto;
      }

      .win-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .win-content {
        background: white;
        padding: 40px;
        border-radius: 10px;
        text-align: center;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      }

      .win-content h2 {
        color: #4caf50;
        margin: 0 0 20px 0;
        font-size: 2.5em;
      }

      .win-content p {
        font-size: 1.3em;
        margin: 10px 0;
      }

      .win-content button {
        background: #4caf50;
        color: white;
        border: none;
        padding: 12px 30px;
        font-size: 1.2em;
        border-radius: 5px;
        cursor: pointer;
        margin-top: 20px;
      }

      .win-content button:hover {
        background: #5cbf60;
      }
    </style>
  </template>

  // Define helper functions
  get multiply() {
    return (a: number, b: number) => a * b;
  }

  get subtract() {
    return (a: number, b: number) => a - b;
  }
}

export class Solitaire extends CardDef {
  static displayName = 'Solitaire';
  static isolated = IsolatedTemplate;
}
