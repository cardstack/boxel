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
import type Owner from '@ember/owner';

// Constants
const suits = ['♠', '♣', '♥', '♦'] as const;
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
] as const;
const numFoundations = 4;
const numTableauPiles = 7;

// Card interface
interface SolitaireCard {
  suit: string;
  rank: string;
  value: number;
  color: 'red' | 'black';
  faceUp: boolean;
}

// Game state union type
type GameState = 'notStarted' | 'playing' | 'gameOver';

class IsolatedTemplate extends Component<typeof Solitaire> {
  @tracked deck: SolitaireCard[] = []; // 52 cards
  @tracked stock: SolitaireCard[] = []; // Stock pile
  @tracked waste: SolitaireCard[] = []; // Waste pile
  @tracked foundations: SolitaireCard[][] = [[], [], [], []]; // 4 foundation piles
  @tracked tableau: SolitaireCard[][] = [[], [], [], [], [], [], []]; // 7 tableau piles
  @tracked selectedCard: SolitaireCard | null = null;
  @tracked selectedPile: { type: string; index: number } | null = null;
  @tracked gameState: GameState =
    (this.args.model.gameState as GameState) || 'notStarted';

  // Check if game can start - requires player
  get gameCanStart() {
    return !!this.args.model.player;
  }

  // Derived properties from gameState
  get isPlaying() {
    return this.gameState === 'playing';
  }

  get hasPlayerWon() {
    return (
      this.gameState === 'gameOver' &&
      this.foundations.every((foundation) => foundation.length === 13)
    );
  }

  get shouldShowGameOverModal() {
    return this.gameState === 'gameOver';
  }

  get stockCardCount() {
    return this.stock.length;
  }

  get hasStockCards() {
    return this.stockCardCount > 0;
  }

  get hasWasteCards() {
    return this.waste.length > 0;
  }

  get wasteStackCards() {
    const lastIndex = this.waste.length - 1;
    const startIndex = Math.max(0, lastIndex - 2);
    return this.waste.slice(startIndex);
  }

  get wasteStackStartIndex() {
    const lastIndex = this.waste.length - 1;
    return Math.max(0, lastIndex - 2);
  }

  // Get status message based on current state
  get gameStatusMessage() {
    switch (this.gameState) {
      case 'notStarted':
        return this.gameCanStart
          ? 'Start a new game'
          : 'Link a player to start playing';
      case 'playing':
        return 'Make your moves!';
      case 'gameOver':
        return this.hasPlayerWon
          ? '🎉 Congratulations! You won! 🎉'
          : 'Game Over - No more moves available';
      default:
        return 'Start a new game';
    }
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

  constructor(owner: Owner, args: any) {
    super(owner, args);

    // Check if we have existing game state to restore
    if (
      this.args.model.gameState &&
      this.args.model.gameState !== 'notStarted'
    ) {
      this.restoreGameState();
    } else {
      // Set initial state without calling initializeGame to avoid tracking conflicts
      if (!this.args.model.gameState) {
        this.gameState = 'notStarted';
      }
    }
  }

  // Helper method to create a standard 52-card deck
  private createDeck(): SolitaireCard[] {
    const deck: SolitaireCard[] = [];

    suits.forEach((suit) => {
      ranks.forEach((rank, index) => {
        deck.push({
          suit,
          rank,
          value: index + 1,
          color: suit === '♥' || suit === '♦' ? 'red' : 'black',
          faceUp: false,
        });
      });
    });

    return deck;
  }

  // Helper method to deal cards to tableau and stock
  private dealCards(): void {
    // Initialize empty piles
    this.tableau = Array(numTableauPiles)
      .fill(null)
      .map(() => []);
    this.foundations = Array(numFoundations)
      .fill(null)
      .map(() => []);
    this.waste = [];

    let cardIndex = 0;

    // Deal to tableau piles (1 card to first pile, 2 to second, etc.)
    for (let pileIndex = 0; pileIndex < numTableauPiles; pileIndex++) {
      for (let cardInPile = 0; cardInPile <= pileIndex; cardInPile++) {
        const card = this.deck[cardIndex++];
        // Only the top card in each pile is face up
        if (cardInPile === pileIndex) {
          card.faceUp = true;
        }
        this.tableau[pileIndex].push(card);
      }
    }

    // Remaining cards go to stock
    this.stock = this.deck.slice(cardIndex);
  }

  @action
  initializeGame() {
    // Create deck
    this.deck = this.createDeck();

    // Shuffle
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }

    // Deal cards
    this.dealCards();
    this.gameState = this.gameCanStart ? 'playing' : 'notStarted';
    this.args.model.gameState = this.gameState;
    this.clearSelection();

    this.saveGameState();
  }

  @action clearSelection() {
    this.selectedCard = null;
    this.selectedPile = null;
  }

  @action
  selectCard(card: SolitaireCard, pileType: string, pileIndex: number) {
    if (!this.gameCanStart || !this.isPlaying || !card.faceUp) return;

    // Special handling for waste pile - auto-move if possible
    if (pileType === 'waste') {
      this.autoMoveWasteCard(card);
      return;
    }

    // Special handling for tableau pile - auto-move if possible
    if (pileType === 'tableau') {
      this.autoMoveTableauCard(card, pileIndex);
      return;
    }

    if (this.selectedCard === card) {
      // Deselect
      this.clearSelection();
    } else if (this.selectedCard) {
      // Try to move to the clicked card's pile
      this.tryMove(pileType, pileIndex);
    } else {
      // Select card and pile
      this.selectedCard = card;
      this.selectedPile = { type: pileType, index: pileIndex };
    }
  }

  @action
  tryMove(targetType: string, targetIndex: number) {
    if (!this.selectedCard || !this.selectedPile) return;

    if (targetType === 'foundation') {
      this.moveToFoundation(targetIndex);
    } else {
      this.moveToTableau(targetIndex);
    }
  }

  // Helper method to get the top card from a pile
  private getTopCard(pile: SolitaireCard[]): SolitaireCard | null {
    return pile.length > 0 ? pile[pile.length - 1] : null;
  }

  @action
  canMoveToFoundation(card: SolitaireCard, foundationIndex: number): boolean {
    const foundation = this.foundations[foundationIndex];
    const topCard = this.getTopCard(foundation);

    // Empty foundation can only accept Aces
    if (!topCard) {
      return card.rank === 'A';
    }

    // Must be same suit and one rank higher
    return card.suit === topCard.suit && card.value === topCard.value + 1;
  }

  @action
  canMoveToTableau(card: SolitaireCard, tableauIndex: number): boolean {
    const pile = this.tableau[tableauIndex];
    const topCard = this.getTopCard(pile);

    // Empty tableau can only accept Kings
    if (!topCard) {
      return card.rank === 'K';
    }

    // Must be opposite color and one rank lower
    return card.color !== topCard.color && card.value === topCard.value - 1;
  }

  // Helper method to check if a card can be moved (must be top card)
  private canMoveCard(
    card: SolitaireCard,
    sourcePile: SolitaireCard[],
  ): boolean {
    return sourcePile.indexOf(card) === sourcePile.length - 1;
  }

  // Helper method to remove card from source pile
  private removeCardFromSource(): void {
    if (!this.selectedPile) return;

    if (this.selectedPile.type === 'waste') {
      this.waste = [...this.waste.slice(0, -1)];
    } else if (this.selectedPile.type === 'tableau') {
      const newTableau = [...this.tableau];
      newTableau[this.selectedPile.index] = [
        ...newTableau[this.selectedPile.index].slice(0, -1),
      ];
      this.tableau = newTableau;
    }
  }

  // Helper method to add card to destination pile
  private addCardToDestination(
    destinationType: string,
    destinationIndex: number,
  ): void {
    if (!this.selectedCard) return;

    if (destinationType === 'foundation') {
      const newFoundations = [...this.foundations];
      newFoundations[destinationIndex] = [
        ...newFoundations[destinationIndex],
        this.selectedCard,
      ];
      this.foundations = newFoundations;
    } else if (destinationType === 'tableau') {
      const newTableau = [...this.tableau];
      newTableau[destinationIndex] = [
        ...newTableau[destinationIndex],
        this.selectedCard,
      ];
      this.tableau = newTableau;
    }
  }

  @action
  moveToFoundation(foundationIndex: number) {
    if (!this.selectedCard || !this.selectedPile) return;

    const sourcePile = this.getSourcePile();

    // Only allow moving the top card
    if (!this.canMoveCard(this.selectedCard, sourcePile)) {
      this.clearSelection();
      return;
    }

    // Validate the move
    if (!this.canMoveToFoundation(this.selectedCard, foundationIndex)) {
      this.clearSelection();
      return;
    }

    // Execute the move
    this.removeCardFromSource();
    this.addCardToDestination('foundation', foundationIndex);
    this.flipTopCard(this.selectedPile.type, this.selectedPile.index);

    this.saveGameState();
    this.clearSelection();
    this.checkGameOver();
  }

  @action
  moveToTableau(tableauIndex: number) {
    if (!this.selectedCard || !this.selectedPile) return;

    const sourcePile = this.getSourcePile();

    // Only allow moving the top card
    if (!this.canMoveCard(this.selectedCard, sourcePile)) {
      this.clearSelection();
      return;
    }

    // Validate the move
    if (!this.canMoveToTableau(this.selectedCard, tableauIndex)) {
      this.clearSelection();
      return;
    }

    // Ensure card stays face-up when moved
    this.selectedCard.faceUp = true;

    // Execute the move
    this.removeCardFromSource();
    this.addCardToDestination('tableau', tableauIndex);
    this.flipTopCard(this.selectedPile.type, this.selectedPile.index);

    this.saveGameState();
    this.clearSelection();
    this.checkGameOver();
  }

  @action
  getSourcePile(): SolitaireCard[] {
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
  flipTopCard(sourcePileType: string, sourcePileIndex: number) {
    // Only flip if the source was a tableau pile
    if (sourcePileType !== 'tableau') return;

    const pile = this.tableau[sourcePileIndex];
    if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
      pile[pile.length - 1].faceUp = true;
      this.saveGameState();
    }
  }

  @action
  autoMoveWasteCard(card: SolitaireCard) {
    // Only auto-move the top card from waste
    if (this.waste.length === 0 || this.waste[this.waste.length - 1] !== card) {
      return;
    }

    // First try to move to foundation (higher priority)
    for (let i = 0; i < 4; i++) {
      if (this.canMoveToFoundation(card, i)) {
        this.selectedCard = card;
        this.selectedPile = { type: 'waste', index: 0 };
        this.moveToFoundation(i);
        return;
      }
    }

    // Then try to move to tableau
    for (let i = 0; i < 7; i++) {
      if (this.canMoveToTableau(card, i)) {
        this.selectedCard = card;
        this.selectedPile = { type: 'waste', index: 0 };
        this.moveToTableau(i);
        return;
      }
    }

    // If no valid moves, just select the card for manual placement
    this.selectedCard = card;
    this.selectedPile = { type: 'waste', index: 0 };
  }

  @action
  autoMoveTableauCard(card: SolitaireCard, sourcePileIndex: number) {
    // Only auto-move the top card from tableau pile
    const sourcePile = this.tableau[sourcePileIndex];
    if (sourcePile.length === 0 || sourcePile[sourcePile.length - 1] !== card) {
      return;
    }

    // First try to move to foundation (higher priority)
    for (let i = 0; i < 4; i++) {
      if (this.canMoveToFoundation(card, i)) {
        this.selectedCard = card;
        this.selectedPile = { type: 'tableau', index: sourcePileIndex };
        this.moveToFoundation(i);
        return;
      }
    }

    // Then try to move to other tableau piles
    for (let i = 0; i < 7; i++) {
      if (i !== sourcePileIndex && this.canMoveToTableau(card, i)) {
        this.selectedCard = card;
        this.selectedPile = { type: 'tableau', index: sourcePileIndex };
        this.moveToTableau(i);
        return;
      }
    }

    // If no valid moves, just select the card for manual placement
    this.selectedCard = card;
    this.selectedPile = { type: 'tableau', index: sourcePileIndex };
  }

  @action
  doubleClickCard(card: SolitaireCard, pileType: string, pileIndex: number) {
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

  // Also update the drawCard method to be more aggressive about checking game over
  @action
  drawCard() {
    if (!this.gameCanStart || !this.isPlaying) return;

    // Clear any existing selection when drawing new cards
    this.clearSelection();

    if (this.stock.length === 0) {
      // Return ALL waste cards to stock when stock is empty
      if (this.waste.length === 0) {
        // No cards to recycle - check if game is over
        this.checkGameOver();
        return;
      }

      // Collect all cards from waste back to stock (face-down)
      const allWasteCards = [...this.waste];
      allWasteCards.forEach((card) => (card.faceUp = false));
      this.stock = allWasteCards.reverse();
      this.waste = [];
    } else {
      // Draw 1 card from stock to waste (face-up)
      const newStock = [...this.stock];
      const drawnCard = newStock.pop()!;
      drawnCard.faceUp = true;

      // Add the drawn card to waste
      this.waste = [...this.waste, drawnCard];
      this.stock = newStock;
    }
    this.saveGameState();
    // Check if game is over after drawing cards
    this.checkGameOver();
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }

  // Check if the game is over (no more valid moves possible)
  isGameOver(): boolean {
    // Check if all foundations are complete (game won)
    if (this.foundations.every((foundation) => foundation.length === 13)) {
      return true;
    }

    // Check if there are any valid moves available
    return !this.hasValidMoves();
  }

  // Check if there are any valid moves available
  hasValidMoves(): boolean {
    // If we can draw more cards, there are always potential moves
    if (this.stock.length > 0) {
      return true;
    }

    // Check if top waste card can be played
    if (this.canPlayWasteCard()) {
      return true;
    }

    // Check if any tableau cards can be played
    if (this.canPlayTableauCards()) {
      return true;
    }

    // Check if any waste cards (not just top) can be played
    if (this.canPlayAnyWasteCard()) {
      return true;
    }

    return false;
  }

  // Helper method to check if the top waste card can be played
  private canPlayWasteCard(): boolean {
    if (this.waste.length === 0) return false;

    const topWasteCard = this.waste[this.waste.length - 1];

    // Check foundation moves
    for (
      let foundationIndex = 0;
      foundationIndex < numFoundations;
      foundationIndex++
    ) {
      if (this.canMoveToFoundation(topWasteCard, foundationIndex)) {
        return true;
      }
    }

    // Check tableau moves
    for (let tableauIndex = 0; tableauIndex < numTableauPiles; tableauIndex++) {
      if (this.canMoveToTableau(topWasteCard, tableauIndex)) {
        return true;
      }
    }

    return false;
  }

  // Helper method to check if any tableau cards can be played
  private canPlayTableauCards(): boolean {
    for (let pileIndex = 0; pileIndex < numTableauPiles; pileIndex++) {
      const pile = this.tableau[pileIndex];
      if (pile.length === 0) continue;

      const topCard = this.getTopCard(pile);
      if (!topCard || !topCard.faceUp) continue;

      // Check foundation moves
      for (
        let foundationIndex = 0;
        foundationIndex < numFoundations;
        foundationIndex++
      ) {
        if (this.canMoveToFoundation(topCard, foundationIndex)) {
          return true;
        }
      }

      // Check other tableau moves
      for (let targetIndex = 0; targetIndex < numTableauPiles; targetIndex++) {
        if (
          pileIndex !== targetIndex &&
          this.canMoveToTableau(topCard, targetIndex)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  // Helper method to check if any waste card (not just top) can be played
  private canPlayAnyWasteCard(): boolean {
    for (let cardIndex = 0; cardIndex < this.waste.length; cardIndex++) {
      const wasteCard = this.waste[cardIndex];

      // Check foundation moves
      for (
        let foundationIndex = 0;
        foundationIndex < numFoundations;
        foundationIndex++
      ) {
        if (this.canMoveToFoundation(wasteCard, foundationIndex)) {
          return true;
        }
      }

      // Check tableau moves
      for (
        let tableauIndex = 0;
        tableauIndex < numTableauPiles;
        tableauIndex++
      ) {
        if (this.canMoveToTableau(wasteCard, tableauIndex)) {
          return true;
        }
      }
    }

    return false;
  }

  // Check if game is over and update game state accordingly
  checkGameOver() {
    if (this.isGameOver()) {
      this.gameState = 'gameOver';
      this.args.model.gameState = 'gameOver';
      this.saveGameState();
      this.recordGameResult();
    }
  }

  // Helper method to get pile field name by index
  private getPileFieldName(
    pileType: 'foundation' | 'tableau',
    index: number,
  ): string {
    return `${pileType}Pile${index}`;
  }

  // Restore game state from model
  restoreGameState() {
    this.gameState = (this.args.model.gameState as GameState) || 'notStarted';

    // Restore basic piles
    this.stock = this.convertCardsFromFields(this.args.model.stock || []);
    this.waste = this.convertCardsFromFields(this.args.model.waste || []);

    // Restore foundation piles
    this.foundations = Array(numFoundations)
      .fill(null)
      .map((_, index) => {
        const fieldName = this.getPileFieldName('foundation', index);
        return this.convertCardsFromFields(
          (this.args.model as any)[fieldName] || [],
        );
      });

    // Restore tableau piles
    this.tableau = Array(numTableauPiles)
      .fill(null)
      .map((_, index) => {
        const fieldName = this.getPileFieldName('tableau', index);
        return this.convertCardsFromFields(
          (this.args.model as any)[fieldName] || [],
        );
      });

    this.clearSelection();
  }

  // Convert cards from field format to component format
  convertCardsFromFields(modelCards: SolitaireField[]): SolitaireCard[] {
    return modelCards.map((card) => ({
      suit: card.suit,
      rank: card.rank,
      value: card.value,
      color: card.color as 'red' | 'black',
      faceUp: card.faceUp,
    }));
  }

  // Convert cards from component format to field format
  convertCardsToFields(cards: SolitaireCard[]): SolitaireField[] {
    return cards.map(
      (card) =>
        new SolitaireField({
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
    // Save basic piles
    this.args.model.stock = this.convertCardsToFields(this.stock);
    this.args.model.waste = this.convertCardsToFields(this.waste);

    // Save foundation piles
    this.args.model.foundationPile0 = this.convertCardsToFields(
      this.foundations[0] || [],
    );
    this.args.model.foundationPile1 = this.convertCardsToFields(
      this.foundations[1] || [],
    );
    this.args.model.foundationPile2 = this.convertCardsToFields(
      this.foundations[2] || [],
    );
    this.args.model.foundationPile3 = this.convertCardsToFields(
      this.foundations[3] || [],
    );

    // Save tableau piles
    this.args.model.tableauPile0 = this.convertCardsToFields(
      this.tableau[0] || [],
    );
    this.args.model.tableauPile1 = this.convertCardsToFields(
      this.tableau[1] || [],
    );
    this.args.model.tableauPile2 = this.convertCardsToFields(
      this.tableau[2] || [],
    );
    this.args.model.tableauPile3 = this.convertCardsToFields(
      this.tableau[3] || [],
    );
    this.args.model.tableauPile4 = this.convertCardsToFields(
      this.tableau[4] || [],
    );
    this.args.model.tableauPile5 = this.convertCardsToFields(
      this.tableau[5] || [],
    );
    this.args.model.tableauPile6 = this.convertCardsToFields(
      this.tableau[6] || [],
    );
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
    const outcome = this.hasPlayerWon ? 'Win' : 'Lose';

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

      {{#if this.shouldShowGameOverModal}}
        <div class='win-modal'>
          <div class='win-content'>
            <h2>{{this.gameStatusMessage}}</h2>
            <button {{on 'click' this.initializeGame}}>Play Again</button>
          </div>
        </div>
      {{/if}}

      <div class='game-content'>
        <div class='header'>
          <h1>♠ Solitaire ♣</h1>
          <div class='stats'>
          </div>
          <div class='game-message'>{{this.gameStatusMessage}}</div>
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
                {{#if this.hasStockCards}}
                  <div class='card face-down'>
                    <div class='card-back'></div>
                  </div>
                  <span class='pile-count'>{{this.stockCardCount}}</span>
                {{else}}
                  <div class='empty-stock'>↻</div>
                {{/if}}
              </button>

              <div class='waste pile'>
                {{#if this.hasWasteCards}}
                  <div class='waste-stack'>
                    {{#each this.wasteStackCards as |card index|}}
                      {{#let
                        (add this.wasteStackStartIndex index)
                        as |actualIndex|
                      }}
                        <button
                          type='button'
                          class='card face-up
                            {{if (eq this.selectedCard card) "selected"}}
                            {{if
                              (eq
                                card
                                (get this.waste (subtract this.waste.length 1))
                              )
                              "top-card"
                            }}'
                          style={{htmlSafe
                            (concat 'left: ' (multiply index 30) 'px')
                          }}
                          {{on
                            'click'
                            (fn this.selectCard card 'waste' actualIndex)
                          }}
                          {{on
                            'dblclick'
                            (fn this.doubleClickCard card 'waste' actualIndex)
                          }}
                        >
                          <div class='card-content'>
                            <div class='card-top'>
                              <span
                                class='rank {{card.color}}'
                              >{{card.rank}}</span>
                              <span
                                class='suit {{card.color}}'
                              >{{card.suit}}</span>
                            </div>
                            <div class='card-center'>
                              <span
                                class='suit {{card.color}}'
                              >{{card.suit}}</span>
                            </div>
                            <div class='card-bottom'>
                              <span
                                class='rank {{card.color}}'
                              >{{card.rank}}</span>
                              <span
                                class='suit {{card.color}}'
                              >{{card.suit}}</span>
                            </div>
                          </div>
                        </button>
                      {{/let}}
                    {{/each}}
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
                          <div class='card-top'>
                            <span
                              class='rank {{topCard.color}}'
                            >{{topCard.rank}}</span>
                            <span
                              class='suit {{topCard.color}}'
                            >{{topCard.suit}}</span>
                          </div>
                          <div class='card-center'>
                            <span
                              class='suit {{topCard.color}}'
                            >{{topCard.suit}}</span>
                          </div>
                          <div class='card-bottom'>
                            <span
                              class='rank {{topCard.color}}'
                            >{{topCard.rank}}</span>
                            <span
                              class='suit {{topCard.color}}'
                            >{{topCard.suit}}</span>
                          </div>
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
                          <div class='card-top'>
                            <span
                              class='rank {{card.color}}'
                            >{{card.rank}}</span>
                            <span
                              class='suit {{card.color}}'
                            >{{card.suit}}</span>
                          </div>
                          <div class='card-center'>
                            <span
                              class='suit {{card.color}}'
                            >{{card.suit}}</span>
                          </div>
                          <div class='card-bottom'>
                            <span
                              class='rank {{card.color}}'
                            >{{card.rank}}</span>
                            <span
                              class='suit {{card.color}}'
                            >{{card.suit}}</span>
                          </div>
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

      .check-status-btn {
        background: #ff9800;
        color: white;
        border: none;
        padding: 10px 20px;
        font-size: 1.1em;
        border-radius: 5px;
        cursor: pointer;
        transition: background 0.3s;
      }

      .check-status-btn:hover {
        background: #f57c00;
      }

      .check-status-btn:disabled {
        background: #666;
        cursor: not-allowed;
        opacity: 0.6;
      }

      .check-status-btn:disabled:hover {
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
        justify-content: space-between;
        height: 100%;
        padding: 8px;
        position: relative;
      }

      .card-top {
        position: absolute;
        top: 4px;
        left: 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        font-size: 0.9em;
        line-height: 1;
      }

      .card-bottom {
        position: absolute;
        bottom: 4px;
        right: 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        font-size: 0.9em;
        line-height: 1;
        transform: rotate(180deg);
      }

      .card-center {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        font-size: 1.8em;
        line-height: 1;
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
class SolitaireField extends FieldDef {
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

  // Game state persistence
  @field stock = containsMany(SolitaireField);
  @field waste = containsMany(SolitaireField);

  // Structured foundation piles for proper state persistence
  @field foundationPile0 = containsMany(SolitaireField);
  @field foundationPile1 = containsMany(SolitaireField);
  @field foundationPile2 = containsMany(SolitaireField);
  @field foundationPile3 = containsMany(SolitaireField);

  // Structured tableau piles for proper state persistence
  @field tableauPile0 = containsMany(SolitaireField);
  @field tableauPile1 = containsMany(SolitaireField);
  @field tableauPile2 = containsMany(SolitaireField);
  @field tableauPile3 = containsMany(SolitaireField);
  @field tableauPile4 = containsMany(SolitaireField);
  @field tableauPile5 = containsMany(SolitaireField);
  @field tableauPile6 = containsMany(SolitaireField);

  @field title = contains(StringField, {
    computeVia: function (this: Solitaire) {
      return 'Solitaire';
    },
  });

  static isolated = IsolatedTemplate;
}
