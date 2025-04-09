import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';

class PlayingCardField extends FieldDef {
  static displayName = 'Playing Card';
  @field suit = contains(StringField);
  @field value = contains(StringField);
  @field faceUp = contains(BooleanField);
}

class StatsField extends FieldDef {
  static displayName = 'Hand Statistics';

  @field wins = contains(NumberField);
  @field losses = contains(NumberField);
  @field earnings = contains(NumberField);
}

class IsolatedTemplate extends Component<typeof BlackjackGame> {
  // Game state
  @tracked gameState = this.args.model.gameState;
  @tracked gameMessage = this.args.model.gameMessage;

  // Player data
  @tracked playerChips = this.args.model.playerChips || 5000;
  @tracked currentBet = this.args.model.currentBet || 100;
  @tracked statistics = this.args.model.statistics || {
    wins: 0,
    losses: 0,
    earnings: 0,
  };

  // Card deck and hands
  @tracked deck: PlayingCardField[] = [];
  @tracked playerHand: PlayingCardField[] = [];
  @tracked dealerHand: PlayingCardField[] = [];

  // Card and suit arrays for generating the deck
  suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.createDeck();
    this.shuffleDeck();

    // Initialize hands from model or create empty hands
    if (args.model.playerHand.length > 0 || args.model.dealerHand.length > 0) {
      // We have saved state - restore it properly
      const playerCards: PlayingCardField[] = [];
      const dealerCards: PlayingCardField[] = [];

      // Parse and recreate player hand
      this.args.model.playerHand?.forEach((card) => {
        let playingCard = new PlayingCardField({
          suit: card.suit,
          value: card.value,
          faceUp: card.faceUp !== undefined ? card.faceUp : true,
        });
        playerCards.push(playingCard);
      });

      // Parse and recreate dealer hand
      this.args.model.dealerHand?.forEach((card) => {
        let playingCard = new PlayingCardField({
          suit: card.suit,
          value: card.value,
          faceUp: card.faceUp !== undefined ? card.faceUp : true,
        });
        dealerCards.push(playingCard);
      });

      this.playerHand = playerCards;
      this.dealerHand = dealerCards;

      // Match game state based on the state we were in
      if (this.gameState === 'betting') {
        this.gameMessage = 'Place your bet and deal';
      } else if (this.gameState === 'playerTurn') {
        this.gameMessage = 'Your turn. Hit or Stand?';
      } else if (this.gameState === 'dealerTurn') {
        this.gameMessage = "Dealer's turn.";
        // If we're in dealer turn but haven't flipped the card yet
        if (this.dealerHand.length > 0 && !this.dealerHand[1].faceUp) {
          setTimeout(() => this.dealerPlay(), 1000);
        }
      } else if (this.gameState === 'gameOver') {
        // Game already over, no action needed
      }
    } else {
      // No existing game, set to initial state
      this.initializeGame();
    }
  }

  // Initialize the game
  initializeGame() {
    // Set initial state
    this.gameState = 'betting';
    this.gameMessage = 'Place your bet and deal';
    this.playerHand = [];
    this.dealerHand = [];
  }

  // Create a fresh deck of cards
  createDeck() {
    this.deck = [];
    for (let suit of this.suits) {
      for (let value of this.values) {
        let playingCard = new PlayingCardField({
          suit,
          value,
          faceUp: true,
        });
        this.deck.push(playingCard);
      }
    }
  }

  // Shuffle the deck using Fisher-Yates algorithm
  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  // Draw a card from the deck
  drawCard(faceUp = true) {
    if (this.deck.length === 0) {
      this.createDeck();
      this.shuffleDeck();
    }

    const card = this.deck.pop();
    if (!card) {
      throw new Error('No card to draw');
    }
    card.faceUp = faceUp;
    console.log(
      'Card drawn:',
      card.value,
      'of',
      card.suit,
      faceUp ? '(face up)' : '(face down)',
    );
    return card;
  }

  // Calculate the score of a hand
  calculateScore(hand: PlayingCardField[]) {
    let score = 0;
    let aces = 0;

    for (let card of hand) {
      if (!card.faceUp) continue;

      if (card.value === 'A') {
        aces += 1;
        score += 11;
      } else if (['K', 'Q', 'J'].includes(card.value)) {
        score += 10;
      } else {
        score += parseInt(card.value);
      }
    }

    // Adjust for aces if necessary
    while (score > 21 && aces > 0) {
      score -= 10;
      aces -= 1;
    }

    return score;
  }

  // Update the scores for player and dealer
  updateScores() {
    // We're not setting tracked properties anymore, just using the getters when needed
  }

  // Check for blackjack
  checkForBlackjack() {
    const playerHasBlackjack =
      this.calculatedPlayerScore === 21 && this.playerHand.length === 2;
    const dealerHasBlackjack =
      this.calculatedDealerScore === 21 && this.dealerHand.length === 2;

    if (!this.currentBet) {
      throw new Error('Current bet is undefined');
    }

    if (playerHasBlackjack && dealerHasBlackjack) {
      // Tie - both have blackjack
      this.gameState = 'gameOver';
      this.gameMessage = 'Push! Both have Blackjack.';
      this.saveGameState();
      return true;
    } else if (playerHasBlackjack) {
      // Player wins with blackjack (pays 3:2)
      this.gameState = 'gameOver';
      this.gameMessage = 'Blackjack! You win 1.5x your bet!';

      this.playerChips += this.currentBet * 1.5;
      this.statistics.wins += 1;
      this.statistics.earnings += this.currentBet * 1.5;
      this.saveGameState();
      return true;
    } else if (dealerHasBlackjack) {
      // Dealer wins with blackjack
      this.gameState = 'gameOver';
      this.gameMessage = 'Dealer has Blackjack! You lose.';
      this.playerChips -= this.currentBet;
      this.statistics.losses += 1;
      this.statistics.earnings -= this.currentBet;
      this.saveGameState();
      return true;
    }

    return false;
  }

  // Check if player busts
  checkForBust() {
    if (this.calculatedPlayerScore > 21) {
      this.gameState = 'gameOver';
      this.gameMessage = 'Bust! You lose.';
      this.playerChips -= this.currentBet;
      this.statistics.losses += 1;
      this.statistics.earnings -= this.currentBet;
      this.saveGameState();
      return true;
    }
    return false;
  }

  // Dealer's turn
  dealerPlay() {
    console.log('Dealer playing...');

    // Reveal dealer's hole card
    const newDealerHand = [...this.dealerHand];
    newDealerHand.forEach((card) => (card.faceUp = true));

    console.log('Dealer hand with cards face up:', newDealerHand);
    this.dealerHand = newDealerHand;

    // Dealer draws until 17 or higher
    while (this.calculatedDealerScore < 17) {
      const newCard = this.drawCard();
      console.log('Dealer drawing card:', newCard);

      this.dealerHand = [...this.dealerHand, newCard];
      console.log('Updated dealer hand:', this.dealerHand);
    }

    // Determine the outcome
    const playerScore = this.calculatedPlayerScore;
    const dealerScore = this.calculatedDealerScore;

    console.log(
      `Final scores - Player: ${playerScore}, Dealer: ${dealerScore}`,
    );

    if (dealerScore > 21) {
      // Dealer busts
      this.gameMessage = 'Dealer busts! You win!';
      this.playerChips += this.currentBet;
      this.statistics.wins += 1;
      this.statistics.earnings += this.currentBet;
    } else if (dealerScore > playerScore) {
      // Dealer wins
      this.gameMessage = 'Dealer wins!';
      this.playerChips -= this.currentBet;
      this.statistics.losses += 1;
      this.statistics.earnings -= this.currentBet;
    } else if (dealerScore < playerScore) {
      // Player wins
      this.gameMessage = 'You win!';
      this.playerChips += this.currentBet;
      this.statistics.wins += 1;
      this.statistics.earnings += this.currentBet;
    } else {
      // Push (tie)
      this.gameMessage = "Push! It's a tie.";
    }

    this.gameState = 'gameOver';
    this.saveGameState();
  }

  // Action handlers
  @action placeBet(amount: number) {
    if (this.gameState !== 'betting') return;
    if (amount > this.playerChips) return;
    this.currentBet = amount;
    this.gameMessage = `Bet placed: ${amount} chips. Deal to start the game.`;
  }

  @action deal() {
    if (this.gameState !== 'betting') return;

    // Check if player has enough chips
    if (this.playerChips < this.currentBet) {
      this.gameMessage = 'Not enough chips to place bet!';
      return;
    }

    console.log('Dealing new hand...');

    // Reset hands
    this.playerHand = [];
    this.dealerHand = [];

    // Initial deal - 2 cards each, dealer's second card face down
    const playerHand = [];
    const dealerHand = [];

    const playerCard1 = this.drawCard();
    const dealerCard1 = this.drawCard();
    const playerCard2 = this.drawCard();
    const dealerCard2 = this.drawCard(false); // Face down

    playerHand.push(playerCard1);
    dealerHand.push(dealerCard1);
    playerHand.push(playerCard2);
    dealerHand.push(dealerCard2);

    console.log('Player hand:', playerHand);
    console.log('Dealer hand:', dealerHand);

    // Create new array references to trigger reactivity
    this.playerHand = [...playerHand];
    this.dealerHand = [...dealerHand];

    console.log('After assignment - Player hand:', this.playerHand);
    console.log('After assignment - Dealer hand:', this.dealerHand);

    // Update scores and check for blackjack
    if (this.checkForBlackjack()) {
      return;
    }

    this.gameState = 'playerTurn';
    this.gameMessage = 'Your turn. Hit or Stand?';
    this.saveGameState();
  }

  @action hit() {
    if (this.gameState !== 'playerTurn') return;

    console.log('Player hitting...');

    // Draw a card for the player and create a new array reference
    const newCard = this.drawCard();
    console.log('New card:', newCard);

    const newHand = [...this.playerHand, newCard];
    console.log('New hand before assignment:', newHand);

    this.playerHand = newHand;
    console.log('New hand after assignment:', this.playerHand);

    // Check if player busts
    if (this.checkForBust()) {
      return;
    }

    this.gameMessage = `You drew a ${newCard.value}. Hit or Stand?`;
  }

  @action stand() {
    if (this.gameState !== 'playerTurn') return;

    this.gameState = 'dealerTurn';
    this.gameMessage = "Dealer's turn.";

    // Dealer plays after a brief delay
    setTimeout(() => this.dealerPlay(), 1000);
  }

  @action doubleDown() {
    if (this.gameState !== 'playerTurn' || this.playerHand.length !== 2) return;
    if (this.playerChips < this.currentBet) return;

    console.log('Player doubling down...');

    // Double the bet
    this.currentBet *= 2;
    this.gameMessage = 'Double Down! Drawing one card then standing.';

    // Draw one card then stand with a new array reference
    const newCard = this.drawCard();
    console.log('Double down card:', newCard);

    this.playerHand = [...this.playerHand, newCard];
    console.log('Hand after double down:', this.playerHand);

    // Check if player busts
    if (this.checkForBust()) {
      return;
    }

    // Player automatically stands after doubling down
    setTimeout(() => this.stand(), 1000);
  }

  @action newGame() {
    if (this.gameState !== 'gameOver') return;

    console.log('Starting new game...');

    // If the deck is running low, create a new shuffled deck
    if (this.deck.length < 10) {
      this.createDeck();
      this.shuffleDeck();
    }

    this.gameState = 'betting';
    this.gameMessage = 'Place your bet and deal';

    // Clear the hands to ensure proper reactivity for the next game
    this.playerHand = [];
    this.dealerHand = [];

    // Save the state
    this.saveGameState();
  }

  // Save game state back to model for persistence
  saveGameState() {
    console.log('Saving game state...');

    // Update the model's properties with our current state
    this.args.model.playerChips = this.playerChips;
    this.args.model.currentBet = this.currentBet;
    this.args.model.gameState = this.gameState;
    this.args.model.gameMessage = this.gameMessage;
    if (this.args.model.statistics) {
      this.args.model.statistics.wins = this.statistics.wins;
      this.args.model.statistics.losses = this.statistics.losses;
      this.args.model.statistics.earnings = this.statistics.earnings;
    }

    // Clear and update the hands in the model
    this.args.model.playerHand = [];
    this.args.model.dealerHand = [];

    // Add each card to the model
    this.playerHand.forEach((card) => {
      let playingCard = new PlayingCardField({
        suit: card.suit,
        value: card.value,
        faceUp: card.faceUp !== undefined ? card.faceUp : true,
      });
      this.args.model.playerHand?.push(playingCard);
    });

    this.dealerHand.forEach((card) => {
      let playingCard = new PlayingCardField({
        suit: card.suit,
        value: card.value,
        faceUp: card.faceUp !== undefined ? card.faceUp : true,
      });
      this.args.model.dealerHand?.push(playingCard);
    });

    console.log('Game state saved to model');
  }

  // Score getter for convenience
  get calculatedPlayerScore() {
    return this.calculateScore(this.playerHand);
  }

  get calculatedDealerScore() {
    return this.calculateScore(this.dealerHand);
  }

  <template>
    <style scoped>
      .blackjack-table {
        background-color: #1b5e20;
        background-image: radial-gradient(
          circle,
          #2e7d32 0%,
          #1b5e20 70%,
          #0d3311 100%
        );
        height: 100%;
        width: 100%;
        padding: 15px;
        color: white;
        font-family: sans-serif;
        display: flex;
        flex-direction: column;
        position: relative;
        overflow: hidden;
      }

      .blackjack-table::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-image: url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='%23257211' fill-opacity='0.15' fill-rule='evenodd'/%3E%3C/svg%3E");
        opacity: 0.3;
        z-index: 0;
        pointer-events: none;
      }

      .table-content {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        flex: 1;
        max-width: 1200px;
        height: 100%;
        margin: 0 auto;
        width: 100%;
        overflow: hidden;
      }

      .table-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        padding: 10px 15px;
        background-color: rgba(0, 0, 0, 0.3);
        border-radius: 10px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        flex-shrink: 0;
      }

      .game-title {
        font-size: 24px;
        font-weight: bold;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      .statistics {
        display: flex;
        gap: 15px;
      }

      .stat {
        background-color: rgba(0, 0, 0, 0.4);
        padding: 6px 12px;
        border-radius: 5px;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .game-area {
        display: flex;
        flex-direction: column;
        gap: 30px;
        flex: 1;
        margin: 10px 0;
        padding: 15px;
        border-radius: 20px;
        box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.4);
        background-color: rgba(27, 94, 32, 0.7);
        overflow-y: auto;
        min-height: 0;
      }

      .dealer-area,
      .player-area {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .area-label {
        font-size: 18px;
        margin-bottom: 3px;
        display: flex;
        justify-content: space-between;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      .card-area {
        display: flex;
        gap: 15px;
        min-height: 120px;
        flex-wrap: wrap;
      }

      .card {
        width: 80px;
        height: 120px;
        background-color: white;
        border-radius: 10px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 8px;
        color: black;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
        transition: transform 0.2s;
        position: relative;
        transform-style: preserve-3d;
      }

      .card:hover {
        transform: translateY(-5px);
      }

      .card.hidden {
        background-color: #1e5799;
        background-image: linear-gradient(
          135deg,
          #1e5799 0%,
          #2989d8 50%,
          #207cca 51%,
          #7db9e8 100%
        );
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
      }

      .card::after {
        content: '';
        position: absolute;
        top: 5px;
        left: 5px;
        right: 5px;
        bottom: 5px;
        border-radius: 7px;
        box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.1);
        pointer-events: none;
      }

      .card-top,
      .card-bottom {
        display: flex;
        flex-direction: column;
      }

      .card-bottom {
        transform: rotate(180deg);
      }

      .card-value {
        font-size: 20px;
        font-weight: bold;
      }

      .suit {
        font-size: 24px;
        line-height: 1;
      }

      .suit.hearts,
      .suit.diamonds {
        color: #e53935;
      }

      .suit.clubs,
      .suit.spades {
        color: #212121;
      }

      .game-bottom-area {
        flex-shrink: 0;
        margin-top: auto;
      }

      .controls-container {
        margin-top: 10px;
        background-color: rgba(0, 0, 0, 0.3);
        border-radius: 15px;
        padding: 15px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
      }

      .controls {
        display: flex;
        gap: 15px;
        flex-wrap: wrap;
        justify-content: center;
      }

      .betting-controls {
        display: flex;
        gap: 15px;
        flex-wrap: wrap;
        justify-content: center;
      }

      .chip {
        width: 50px;
        height: 50px;
        border-radius: 25px;
        display: flex;
        justify-content: center;
        align-items: center;
        color: white;
        font-weight: bold;
        font-size: 16px;
        cursor: pointer;
        box-shadow: 0 6px 10px rgba(0, 0, 0, 0.5);
        border: 3px dashed rgba(255, 255, 255, 0.8);
        transition:
          transform 0.2s,
          box-shadow 0.2s;
      }

      .chip:hover {
        transform: translateY(-3px) scale(1.05);
        box-shadow: 0 8px 15px rgba(0, 0, 0, 0.5);
      }

      .chip:active {
        transform: translateY(0) scale(0.98);
      }

      .chip.red {
        background-color: #e53935;
      }
      .chip.blue {
        background-color: #1976d2;
      }
      .chip.green {
        background-color: #2e7d32;
      }
      .chip.black {
        background-color: #212121;
      }

      .button {
        padding: 10px 20px;
        border-radius: 8px;
        font-weight: bold;
        font-size: 15px;
        cursor: pointer;
        border: none;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        transition:
          transform 0.2s,
          box-shadow 0.2s;
        min-width: 100px;
      }

      .button:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
      }

      .button:active {
        transform: translateY(1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .button.primary {
        background-color: #f9a825;
        color: #212121;
      }

      .button.secondary {
        background-color: #e67e22;
        color: white;
      }

      .button.danger {
        background-color: #c62828;
        color: white;
      }

      .button.success {
        background-color: #2e7d32;
        color: white;
      }

      .button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      }

      .status-bar {
        background-color: rgba(0, 0, 0, 0.5);
        padding: 10px;
        text-align: center;
        border-radius: 10px;
        margin: 10px 0;
        font-size: 18px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      .chips-display {
        background-color: rgba(0, 0, 0, 0.4);
        padding: 6px 12px;
        border-radius: 5px;
        font-weight: bold;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .bet-amount {
        background-color: rgba(249, 168, 37, 0.3);
        padding: 6px 12px;
        border-radius: 5px;
        font-weight: bold;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      @media (max-height: 750px) {
        .game-title {
          font-size: 20px;
        }

        .stat {
          padding: 4px 10px;
          font-size: 14px;
        }

        .card-area {
          min-height: 100px;
        }

        .card {
          width: 70px;
          height: 100px;
        }

        .card-value,
        .suit {
          font-size: 18px;
        }

        .chip {
          width: 45px;
          height: 45px;
          font-size: 14px;
        }

        .button {
          padding: 8px 16px;
          font-size: 14px;
          min-width: 90px;
        }
      }

      @media (max-width: 600px) {
        .table-header {
          flex-direction: column;
          gap: 10px;
          padding: 8px;
        }

        .game-title {
          font-size: 20px;
        }

        .statistics {
          width: 100%;
          justify-content: space-between;
        }

        .stat {
          padding: 5px 8px;
          font-size: 14px;
        }

        .card {
          width: 70px;
          height: 100px;
        }

        .card-value,
        .suit {
          font-size: 18px;
        }

        .chip {
          width: 45px;
          height: 45px;
          font-size: 14px;
        }

        .button {
          padding: 8px 16px;
          font-size: 14px;
          min-width: 90px;
        }
      }
    </style>

    <div class='blackjack-table'>
      <div class='table-content'>
        <div class='table-header'>
          <div class='game-title'>{{@model.casinoName}}
            Blackjack</div>
          <div class='statistics'>
            <div class='stat'>Wins: {{this.statistics.wins}}</div>
            <div class='stat'>Losses: {{this.statistics.losses}}</div>
            <div class='stat'>Earnings: {{this.statistics.earnings}}</div>
          </div>
        </div>

        <div class='game-area'>
          <div class='dealer-area'>
            <div class='area-label'>
              <span>Dealer</span>
              <span>Score: {{this.calculatedDealerScore}}</span>
            </div>
            <div class='card-area'>
              {{#each this.dealerHand as |card|}}
                <div class='card {{if (not card.faceUp) "hidden"}}'>
                  {{#if card.faceUp}}
                    <div class='card-top'>
                      <div class='card-value'>{{card.value}}</div>
                      <div class='suit {{card.suit}}'>
                        {{#if (eq card.suit 'hearts')}}♥{{/if}}
                        {{#if (eq card.suit 'diamonds')}}♦{{/if}}
                        {{#if (eq card.suit 'clubs')}}♣{{/if}}
                        {{#if (eq card.suit 'spades')}}♠{{/if}}
                      </div>
                    </div>
                    <div class='card-bottom'>
                      <div class='card-value'>{{card.value}}</div>
                      <div class='suit {{card.suit}}'>
                        {{#if (eq card.suit 'hearts')}}♥{{/if}}
                        {{#if (eq card.suit 'diamonds')}}♦{{/if}}
                        {{#if (eq card.suit 'clubs')}}♣{{/if}}
                        {{#if (eq card.suit 'spades')}}♠{{/if}}
                      </div>
                    </div>
                  {{/if}}
                </div>
              {{/each}}
            </div>
          </div>

          <div class='player-area'>
            <div class='area-label'>
              <span>Player ({{@model.playerName}})</span>
              <span>Score: {{this.calculatedPlayerScore}}</span>
            </div>
            <div class='card-area'>
              {{#each this.playerHand as |card|}}
                <div class='card'>
                  <div class='card-top'>
                    <div class='card-value'>{{card.value}}</div>
                    <div class='suit {{card.suit}}'>
                      {{#if (eq card.suit 'hearts')}}♥{{/if}}
                      {{#if (eq card.suit 'diamonds')}}♦{{/if}}
                      {{#if (eq card.suit 'clubs')}}♣{{/if}}
                      {{#if (eq card.suit 'spades')}}♠{{/if}}
                    </div>
                  </div>
                  <div class='card-bottom'>
                    <div class='card-value'>{{card.value}}</div>
                    <div class='suit {{card.suit}}'>
                      {{#if (eq card.suit 'hearts')}}♥{{/if}}
                      {{#if (eq card.suit 'diamonds')}}♦{{/if}}
                      {{#if (eq card.suit 'clubs')}}♣{{/if}}
                      {{#if (eq card.suit 'spades')}}♠{{/if}}
                    </div>
                  </div>
                </div>
              {{/each}}
            </div>
          </div>
        </div>

        <div class='game-bottom-area'>
          <div class='status-bar'>
            {{this.gameMessage}}
          </div>

          <div class='area-label'>
            <span class='chips-display'>Chips: {{this.playerChips}}</span>
            <span class='bet-amount'>Current Bet: {{this.currentBet}}</span>
          </div>

          <div class='controls-container'>
            {{#if (eq this.gameState 'betting')}}
              <div class='betting-controls'>
                <button
                  class='chip red'
                  {{on 'click' (fn this.placeBet 5)}}
                >5</button>
                <button
                  class='chip blue'
                  {{on 'click' (fn this.placeBet 20)}}
                >20</button>
                <button
                  class='chip green'
                  {{on 'click' (fn this.placeBet 50)}}
                >50</button>
                <button
                  class='chip black'
                  {{on 'click' (fn this.placeBet 100)}}
                >100</button>
                <button
                  class='button primary'
                  {{on 'click' this.deal}}
                >Deal</button>
              </div>
            {{else}}
              <div class='controls'>
                <button
                  class='button primary'
                  {{on 'click' this.hit}}
                  disabled={{not (eq this.gameState 'playerTurn')}}
                >Hit</button>
                <button
                  class='button secondary'
                  {{on 'click' this.stand}}
                  disabled={{not (eq this.gameState 'playerTurn')}}
                >Stand</button>
                <button
                  class='button danger'
                  {{on 'click' this.doubleDown}}
                  disabled={{not (eq this.gameState 'playerTurn')}}
                >Double Down</button>
                <button
                  class='button success'
                  {{on 'click' this.newGame}}
                  disabled={{not (eq this.gameState 'gameOver')}}
                >New Game</button>
              </div>
            {{/if}}
          </div>
        </div>
      </div>
    </div>
  </template>
}

export class BlackjackGame extends CardDef {
  static displayName = 'Blackjack Game';
  static prefersWideFormat = true;

  @field playerName = contains(StringField);
  @field playerChips = contains(NumberField);
  @field currentBet = contains(NumberField);
  @field gameState = contains(StringField);
  @field gameMessage = contains(StringField);
  @field statistics = contains(StatsField);
  @field playerScore = contains(NumberField);
  @field dealerScore = contains(NumberField);
  @field dealerHand = containsMany(PlayingCardField);
  @field playerHand = containsMany(PlayingCardField);
  @field casinoName = contains(StringField);

  static isolated = IsolatedTemplate;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='edit-container'>
        <h3>Casino Information</h3>
        <div class='field-row'>
          <label>Casino Name:</label>
          <@fields.casinoName />
        </div>

        <h3>Player Information</h3>
        <div class='field-row'>
          <label>Player Name:</label>
          <@fields.playerName />
        </div>
        <div class='field-row'>
          <label>Starting Chips:</label>
          <@fields.playerChips />
        </div>
        <div class='field-row'>
          <label>Initial Bet:</label>
          <@fields.currentBet />
        </div>

        <h3>Game Statistics</h3>
        <div class='field-row'>
          <label>Wins:</label>
          <@fields.statistics.wins />
        </div>
        <div class='field-row'>
          <label>Losses:</label>
          <@fields.statistics.losses />
        </div>
        <div class='field-row'>
          <label>Earnings:</label>
          <@fields.statistics.earnings />
        </div>

        <h3>Game State</h3>
        <div class='field-row'>
          <label>Game State:</label>
          <@fields.gameState />
        </div>
        <div class='field-row'>
          <label>Game Message:</label>
          <@fields.gameMessage />
        </div>
        <div class='field-row'>
          <label>Player Score:</label>
          <@fields.playerScore />
        </div>
        <div class='field-row'>
          <label>Dealer Score:</label>
          <@fields.dealerScore />
        </div>

        <style scoped>
          .edit-container {
            font-family: sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .field-row {
            margin-bottom: 15px;
            display: flex;
            flex-direction: column;
            gap: 5px;
          }
          h3 {
            margin-top: 20px;
            margin-bottom: 10px;
            border-bottom: 1px solid #eee;
            padding-bottom: 5px;
          }
          label {
            font-weight: bold;
          }
        </style>
      </div>
    </template>
  };
}
