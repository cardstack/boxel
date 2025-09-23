import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { task } from 'ember-concurrency';
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
  not,
} from '@cardstack/boxel-ui/helpers';
import { Player } from '../player/player';
import RecordGameResultCommand from '../commands/record-game-result';
import {
  GameResult,
  GameStatusField,
  PlayerOutcomeField,
  type GameResultStatusType,
} from '../game-result/game-result';
import ValidationSteps, {
  type ValidationStep,
} from '../components/validation-steps';
import { realmURL } from '@cardstack/runtime-common';

// Helper function for array slicing
function slice(array: any[], start: number, end?: number): any[] {
  return array?.slice(start, end) || [];
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
  @tracked isPlaying = false;
  @tracked gameWon = false;
  @tracked gameState = this.args.model.gameState || 'notStarted';
  @tracked gameMessage = this.args.model.gameMessage || 'Start a new game';
  @tracked showModal = false;

  // Check if game can start - requires player
  get gameCanStart() {
    return !!this.args.model.player;
  }

  // Generate validation steps for solitaire setup
  get validationSteps(): ValidationStep[] {
    const steps: ValidationStep[] = [];
    const hasPlayer = !!this.args.model.player;

    // Step 1: Add Player
    if (!hasPlayer) {
      steps.push({
        id: 'player',
        title: '1. Add Player:',
        message: 'Link a player card to start playing',
        status: 'incomplete',
      });
    } else {
      steps.push({
        id: 'player',
        title: '✓ Player Added:',
        message: 'Player card is linked',
        status: 'complete',
      });
    }

    // Final step: Ready to play
    if (hasPlayer) {
      steps.push({
        id: 'ready',
        title: '✓ Ready to Play:',
        message: 'All requirements met - game is ready!',
        status: 'complete',
      });
    }

    return steps;
  }

  constructor(owner: unknown, args: any) {
    super(owner, args);

    // Check if we have existing game state to restore
    if (
      this.args.model.gameState &&
      this.args.model.gameState !== 'notStarted'
    ) {
      // We have saved state - restore it properly
      this.restoreGameState();
    } else {
      // No existing game, initialize new game
      this.initializeGame();
    }
  }

  willDestroy() {
    super.willDestroy();
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
    this.isPlaying = this.gameCanStart; // Only playable if player is linked
    this.gameWon = false;
    this.gameState = this.gameCanStart ? 'playing' : 'notStarted';
    this.gameMessage = this.gameCanStart
      ? 'Make your moves!'
      : 'Link a player to start playing';
    this.showModal = false;
    this.selectedCard = null;
    this.selectedPile = null;

    this.saveGameState();
  }

  @action
  drawCard() {
    if (!this.gameCanStart || !this.isPlaying) return;

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
    this.saveGameState();

    // Defer win condition check to prevent tracking issues
    setTimeout(() => {
      this.checkWinCondition();
    }, 0);
  }

  @action
  selectCard(card: Card, pileType: string, pileIndex: number) {
    if (!this.gameCanStart || !this.isPlaying || !card.faceUp) return;

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

    // Check win condition after any selection change
    this.checkWinCondition();
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
      this.saveGameState();

      // Clear selection first to prevent tracking issues
      this.selectedCard = null;
      this.selectedPile = null;

      // Check win condition after moving to foundation
      this.checkWinCondition();
    } else {
      this.selectedCard = null;
      this.selectedPile = null;
    }
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
    this.saveGameState();

    // Clear selection first to prevent tracking issues
    this.selectedCard = null;
    this.selectedPile = null;

    // Check win condition after each move
    this.checkWinCondition();
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
      this.saveGameState();

      // Check win condition after flipping a card (might reveal new moves)
      this.checkWinCondition();
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
        // checkWinCondition is already called in moveToFoundation
        return;
      }
    }
  }

  @action
  emptyPileClick(pileType: string, pileIndex: number) {
    if (this.selectedCard && pileType === 'tableau') {
      this.tryMove(pileType, pileIndex);
      // checkWinCondition is already called in tryMove -> moveToTableau
    }
  }

  @action
  checkWinCondition() {
    // Check if all foundations have 13 cards (Ace to King)
    const allFoundationsComplete = this.foundations.every(
      (foundation) => foundation.length === 13,
    );

    if (allFoundationsComplete && !this.gameWon) {
      // Use setTimeout to prevent tracking issues
      setTimeout(() => {
        this.gameWon = true;
        this.isPlaying = false;
        this.gameState = 'gameOver';
        this.gameMessage = '🎉 Congratulations! You won! 🎉';
        this.showModal = true;
        this.saveGameState();
        this.recordGameResult();
      }, 0);
      return;
    }

    // Check if no more moves are possible
    if (this.isGameOver()) {
      // Use setTimeout to prevent tracking issues
      setTimeout(() => {
        this.gameWon = false;
        this.isPlaying = false;
        this.gameState = 'gameOver';
        this.gameMessage = 'Game Over - No more moves available';
        this.showModal = true;
        this.saveGameState();
        this.recordGameResult();
      }, 0);
    }
  }

  @action
  isGameOver(): boolean {
    // Check if there are any possible moves
    // 1. Check if any card from waste can be moved
    if (this.waste.length > 0) {
      const topWasteCard = this.waste[this.waste.length - 1];
      if (this.canMoveAnywhere(topWasteCard)) {
        return false;
      }
    }

    // 2. Check if any tableau card can be moved
    for (let i = 0; i < this.tableau.length; i++) {
      const pile = this.tableau[i];
      for (let j = 0; j < pile.length; j++) {
        const card = pile[j];
        if (card.faceUp && this.canMoveAnywhere(card)) {
          return false;
        }
      }
    }

    // 3. Check if we can draw more cards
    if (this.stock.length > 0) {
      return false;
    }

    return true;
  }

  @action
  canMoveAnywhere(card: Card): boolean {
    // Check if card can move to any foundation
    for (let i = 0; i < 4; i++) {
      if (this.canMoveToFoundation(card, i)) {
        return true;
      }
    }

    // Check if card can move to any tableau pile
    for (let i = 0; i < 7; i++) {
      if (this.canMoveToTableau(card, i)) {
        return true;
      }
    }

    return false;
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }

  // Restore game state from model
  restoreGameState() {
    this.gameState = this.args.model.gameState || 'notStarted';
    this.gameMessage = this.args.model.gameMessage || 'Start a new game';
    this.moves = this.args.model.moves || 0;
    this.isPlaying = this.args.model.isPlaying || false;
    this.gameWon = this.args.model.gameWon || false;
    this.showModal = this.args.model.showModal || false;

    // Restore card arrays
    this.stock = this.convertCardsFromModel(this.args.model.stock || []);
    this.waste = this.convertCardsFromModel(this.args.model.waste || []);

    // Restore foundations (4 separate piles) - properly structured
    this.foundations = [[], [], [], []];

    // Try to restore from structured data first
    if ((this.args.model as any).foundationPile0 !== undefined) {
      this.foundations[0] = this.convertCardsFromModel(
        (this.args.model as any).foundationPile0 || [],
      );
      this.foundations[1] = this.convertCardsFromModel(
        (this.args.model as any).foundationPile1 || [],
      );
      this.foundations[2] = this.convertCardsFromModel(
        (this.args.model as any).foundationPile2 || [],
      );
      this.foundations[3] = this.convertCardsFromModel(
        (this.args.model as any).foundationPile3 || [],
      );
    } else if (
      this.args.model.foundations &&
      this.args.model.foundations.length > 0
    ) {
      // Fallback to old flattened format - distribute evenly (not ideal but better than nothing)
      const foundationCards = this.convertCardsFromModel(
        this.args.model.foundations,
      );
      foundationCards.forEach((card, index) => {
        const foundationIndex = index % 4;
        this.foundations[foundationIndex].push(card);
      });
    }

    // Restore tableau (7 separate piles) - properly structured
    this.tableau = [[], [], [], [], [], [], []];

    // Try to restore from structured data first
    if ((this.args.model as any).tableauPile0 !== undefined) {
      this.tableau[0] = this.convertCardsFromModel(
        (this.args.model as any).tableauPile0 || [],
      );
      this.tableau[1] = this.convertCardsFromModel(
        (this.args.model as any).tableauPile1 || [],
      );
      this.tableau[2] = this.convertCardsFromModel(
        (this.args.model as any).tableauPile2 || [],
      );
      this.tableau[3] = this.convertCardsFromModel(
        (this.args.model as any).tableauPile3 || [],
      );
      this.tableau[4] = this.convertCardsFromModel(
        (this.args.model as any).tableauPile4 || [],
      );
      this.tableau[5] = this.convertCardsFromModel(
        (this.args.model as any).tableauPile5 || [],
      );
      this.tableau[6] = this.convertCardsFromModel(
        (this.args.model as any).tableauPile6 || [],
      );
    } else if (this.args.model.tableau && this.args.model.tableau.length > 0) {
      // Fallback to old flattened format - distribute according to deal pattern
      const tableauCards = this.convertCardsFromModel(this.args.model.tableau);
      let cardIndex = 0;
      for (let pileIndex = 0; pileIndex < 7; pileIndex++) {
        const cardsInThisPile = pileIndex + 1; // Pile 1 gets 1 card, pile 2 gets 2, etc.
        for (
          let i = 0;
          i < cardsInThisPile && cardIndex < tableauCards.length;
          i++
        ) {
          this.tableau[pileIndex].push(tableauCards[cardIndex]);
          cardIndex++;
        }
      }
    }

    // Ensure tableau follows solitaire rules (only last card face-up)
    this.fixTableauFaceUpState();

    // Clear any existing selection
    this.selectedCard = null;
    this.selectedPile = null;
  }

  // Fix tableau face-up state to follow solitaire rules (only last card face-up)
  @action
  fixTableauFaceUpState() {
    this.tableau.forEach((pile) => {
      if (pile.length > 0) {
        // Set all cards to face-down first
        pile.forEach((card) => {
          card.faceUp = false;
        });
        // Then set only the last card to face-up
        pile[pile.length - 1].faceUp = true;
      }
    });
  }

  // Convert cards from model format to component format
  convertCardsFromModel(modelCards: any[]): Card[] {
    return modelCards.map((card) => ({
      suit: card.suit,
      rank: card.rank,
      value: card.value,
      color: card.color,
      faceUp: card.faceUp,
    }));
  }

  // Convert cards from component format to model format
  convertCardsToModel(cards: Card[]): any[] {
    return cards.map(
      (card) =>
        new SolitaireCardField({
          suit: card.suit,
          rank: card.rank,
          value: card.value,
          color: card.color,
          faceUp: card.faceUp,
        }),
    );
  }

  // Save game state back to model for persistence
  saveGameState() {
    // Use setTimeout to prevent tracking issues during rendering
    setTimeout(() => {
      this.args.model.gameState = this.gameState;
      this.args.model.gameMessage = this.gameMessage;
      this.args.model.moves = this.moves;
      this.args.model.isPlaying = this.isPlaying;
      this.args.model.gameWon = this.gameWon;
      this.args.model.showModal = this.showModal;

      // Save card arrays
      this.args.model.stock = this.convertCardsToModel(this.stock);
      this.args.model.waste = this.convertCardsToModel(this.waste);

      // Save foundations with structure information
      (this.args.model as any).foundationPile0 = this.convertCardsToModel(
        this.foundations[0] || [],
      );
      (this.args.model as any).foundationPile1 = this.convertCardsToModel(
        this.foundations[1] || [],
      );
      (this.args.model as any).foundationPile2 = this.convertCardsToModel(
        this.foundations[2] || [],
      );
      (this.args.model as any).foundationPile3 = this.convertCardsToModel(
        this.foundations[3] || [],
      );

      // Also save flattened foundations for backward compatibility
      const allFoundationCards: Card[] = [];
      this.foundations.forEach((pile) => {
        allFoundationCards.push(...pile);
      });
      this.args.model.foundations =
        this.convertCardsToModel(allFoundationCards);

      // Save tableau with structure information
      (this.args.model as any).tableauPile0 = this.convertCardsToModel(
        this.tableau[0] || [],
      );
      (this.args.model as any).tableauPile1 = this.convertCardsToModel(
        this.tableau[1] || [],
      );
      (this.args.model as any).tableauPile2 = this.convertCardsToModel(
        this.tableau[2] || [],
      );
      (this.args.model as any).tableauPile3 = this.convertCardsToModel(
        this.tableau[3] || [],
      );
      (this.args.model as any).tableauPile4 = this.convertCardsToModel(
        this.tableau[4] || [],
      );
      (this.args.model as any).tableauPile5 = this.convertCardsToModel(
        this.tableau[5] || [],
      );
      (this.args.model as any).tableauPile6 = this.convertCardsToModel(
        this.tableau[6] || [],
      );

      // Also save flattened tableau for backward compatibility
      const allTableauCards: Card[] = [];
      this.tableau.forEach((pile) => {
        allTableauCards.push(...pile);
      });
      this.args.model.tableau = this.convertCardsToModel(allTableauCards);
    }, 0);
  }

  // Record game result when game ends
  recordGameResult() {
    if (this.gameState !== 'gameOver') return;
    this._recordGameResult.perform();
  }

  _recordGameResult = task(async () => {
    const game = this.args.model;
    const createdAt = new Date();

    const codeRef = {
      module: new URL('../solitaire/solitaire', import.meta.url).href,
      name: 'Solitaire',
    };

    const commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('Command context not available. Please try again.');
    }

    // Determine outcome based on game result
    const outcome = this.gameWon ? 'Win' : 'Lose';

    // Create GameResult for player
    const playerGameResult = new GameResult({
      game,
      outcome: new PlayerOutcomeField({
        player: this.args.model.player,
        outcome: new GameStatusField({
          label: outcome as GameResultStatusType,
        }),
      }),
      createdAt,
      ref: codeRef,
    });

    // Record the game result
    await new RecordGameResultCommand(commandContext).execute({
      card: playerGameResult,
      realm: this.currentRealm!.href,
    });
  });

  <template>
    <div class='solitaire-game'>
      {{#unless this.gameCanStart}}
        <div class='validation-steps-overlay'>
          <ValidationSteps
            @steps={{this.validationSteps}}
            @title='Setup Required'
            @description='You must link a player card to continue.'
            @editModeNote='Switch to edit mode to configure player'
            class='validation-steps'
          />
        </div>
      {{/unless}}

      {{#if this.showModal}}
        <div class='win-modal'>
          <div class='win-content'>
            {{#if this.gameWon}}
              <h2>🎉 You Won! 🎉</h2>
              <p>Completed in {{this.moves}} moves</p>
            {{else}}
              <h2>💀 Game Over 💀</h2>
              <p>No more moves available</p>
            {{/if}}
            <button {{on 'click' this.initializeGame}}>Play Again</button>
          </div>
        </div>
      {{/if}}

      <div class='game-content'>
        <div class='header'>
          <h1>♠ Solitaire ♣</h1>
          <div class='stats'>
            <span>Moves: {{this.moves}}</span>
          </div>
          <div class='game-message'>{{this.gameMessage}}</div>
          <div class='controls'>
            <button
              class='new-game-btn'
              {{on 'click' this.initializeGame}}
              disabled={{not this.gameCanStart}}
            >
              New Game
            </button>
          </div>
        </div>

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
                      {{on
                        'click'
                        (fn this.selectCard card 'tableau' pileIndex)
                      }}
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
    </div>

    <style scoped>
      .solitaire-game {
        background: #2d6e2d;
        min-height: 100vh;
        padding: 20px;
        position: relative;
        width: 100%;
      }

      .validation-steps-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .validation-steps {
        --validation-content-background: #2d6e2d;
        --validation-content-foreground: #fffb12;
      }

      .game-content {
        position: relative;
        z-index: 1;
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

      .game-message {
        color: white;
        font-size: 1.1em;
        text-align: center;
        margin: 10px 0;
        min-height: 1.5em;
        font-weight: 500;
      }

      .controls {
        display: flex;
        justify-content: center;
        gap: 15px;
        margin-top: 10px;
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

      .new-game-btn:disabled {
        background: #666;
        cursor: not-allowed;
        opacity: 0.6;
      }

      .new-game-btn:disabled:hover {
        background: #666;
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
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: flex;
        justify-content: center;
        align-items: center;
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
}

// Card field definition for solitaire cards
class SolitaireCardField extends FieldDef {
  static displayName = 'Solitaire Card';
  @field suit = contains(StringField);
  @field rank = contains(StringField);
  @field value = contains(NumberField);
  @field color = contains(StringField);
  @field faceUp = contains(BooleanField);
}

export class Solitaire extends CardDef {
  static displayName = 'Solitaire';

  @field player = linksTo(() => Player);
  @field gameState = contains(StringField);
  @field gameMessage = contains(StringField);
  @field moves = contains(NumberField);
  @field isPlaying = contains(BooleanField);
  @field gameWon = contains(BooleanField);
  @field showModal = contains(BooleanField);

  // Game state persistence
  @field stock = containsMany(SolitaireCardField);
  @field waste = containsMany(SolitaireCardField);
  @field foundations = containsMany(SolitaireCardField);
  @field tableau = containsMany(SolitaireCardField);

  // Structured foundation piles for proper state persistence
  @field foundationPile0 = containsMany(SolitaireCardField);
  @field foundationPile1 = containsMany(SolitaireCardField);
  @field foundationPile2 = containsMany(SolitaireCardField);
  @field foundationPile3 = containsMany(SolitaireCardField);

  // Structured tableau piles for proper state persistence
  @field tableauPile0 = containsMany(SolitaireCardField);
  @field tableauPile1 = containsMany(SolitaireCardField);
  @field tableauPile2 = containsMany(SolitaireCardField);
  @field tableauPile3 = containsMany(SolitaireCardField);
  @field tableauPile4 = containsMany(SolitaireCardField);
  @field tableauPile5 = containsMany(SolitaireCardField);
  @field tableauPile6 = containsMany(SolitaireCardField);

  @field title = contains(StringField, {
    computeVia: function (this: Solitaire) {
      return 'Solitaire';
    },
  });

  static isolated = IsolatedTemplate;
}
