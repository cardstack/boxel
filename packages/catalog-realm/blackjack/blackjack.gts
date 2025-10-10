import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import RecordGameResultCommand from '../commands/record-game-result';
import {
  GameResult,
  GameStatusField,
  PlayerOutcomeField,
  type GameResultStatusType,
} from '../game-result/game-result';
import { Player } from '../player/player';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { task } from 'ember-concurrency';
import type Owner from '@ember/owner';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import ValidationSteps, {
  type ValidationStep,
} from '../components/validation-steps';
import { realmURL } from '@cardstack/runtime-common';

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

  // Check if game can start - requires player and dealer
  get gameCanStart() {
    const hasPlayer = !!this.args.model.player;
    const hasDealer = !!this.args.model.dealer;
    return hasPlayer && hasDealer;
  }

  // Generate validation steps for blackjack setup
  get validationSteps(): ValidationStep[] {
    const steps: ValidationStep[] = [];
    const hasPlayer = !!this.args.model.player;
    const hasDealer = !!this.args.model.dealer;

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

    // Step 2: Add Dealer
    if (!hasDealer) {
      steps.push({
        id: 'dealer',
        title: '2. Add Dealer:',
        message: 'Link a dealer card to manage the game',
        status: 'incomplete',
      });
    } else {
      steps.push({
        id: 'dealer',
        title: '✓ Dealer Added:',
        message: 'Dealer card is linked',
        status: 'complete',
      });
    }

    // Final step: Ready to play
    if (hasPlayer && hasDealer) {
      steps.push({
        id: 'ready',
        title: '✓ Ready to Play:',
        message: 'All requirements met - game is ready!',
        status: 'complete',
      });
    }

    return steps;
  }

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

      // Record the game result
      this.recordGameResult();
      return true;
    } else if (playerHasBlackjack) {
      // Player wins with blackjack (pays 3:2)
      this.gameState = 'gameOver';
      this.gameMessage = 'Blackjack! You win 1.5x your bet!';

      this.playerChips += this.currentBet * 1.5;
      this.statistics.wins += 1;
      this.statistics.earnings += this.currentBet * 1.5;
      this.saveGameState();

      // Record the game result
      this.recordGameResult();
      return true;
    } else if (dealerHasBlackjack) {
      // Dealer wins with blackjack
      this.gameState = 'gameOver';
      this.gameMessage = 'Dealer has Blackjack! You lose.';
      this.playerChips -= this.currentBet;
      this.statistics.losses += 1;
      this.statistics.earnings -= this.currentBet;
      this.saveGameState();

      // Record the game result
      this.recordGameResult();
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

      // Record the game result
      this.recordGameResult();
      return true;
    }
    return false;
  }

  // Dealer's turn
  dealerPlay() {
    // Reveal dealer's hole card
    const newDealerHand = [...this.dealerHand];
    newDealerHand.forEach((card) => (card.faceUp = true));

    this.dealerHand = newDealerHand;

    // Dealer draws until 17 or higher
    while (this.calculatedDealerScore < 17) {
      const newCard = this.drawCard();

      this.dealerHand = [...this.dealerHand, newCard];
    }

    // Determine the outcome
    const playerScore = this.calculatedPlayerScore;
    const dealerScore = this.calculatedDealerScore;

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

    // Record the game result
    this.recordGameResult();
  }

  // Action handlers
  @action placeBet(amount: number) {
    if (this.gameState !== 'betting') return;
    if (amount > this.playerChips) return;
    this.currentBet = amount;
    this.gameMessage = `Bet placed: ${amount} chips. Deal to start the game.`;
  }

  @action deal() {
    if (!this.gameCanStart || this.gameState !== 'betting') return;

    // Check if player has enough chips
    if (this.playerChips < this.currentBet) {
      this.gameMessage = 'Not enough chips to place bet!';
      return;
    }

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

    // Create new array references to trigger reactivity
    this.playerHand = [...playerHand];
    this.dealerHand = [...dealerHand];

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

    // Draw a card for the player and create a new array reference
    const newCard = this.drawCard();

    const newHand = [...this.playerHand, newCard];

    this.playerHand = newHand;

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

    // Double the bet
    this.currentBet *= 2;
    this.gameMessage = 'Double Down! Drawing one card then standing.';

    // Draw one card then stand with a new array reference
    const newCard = this.drawCard();

    this.playerHand = [...this.playerHand, newCard];

    // Check if player busts
    if (this.checkForBust()) {
      return;
    }

    // Player automatically stands after doubling down
    setTimeout(() => this.stand(), 1000);
  }

  @action newGame() {
    if (this.gameState !== 'gameOver') return;

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

  // Determine game outcome from game message
  determineGameOutcome(): 'Win' | 'Lose' | 'Draw' {
    if (
      this.gameMessage?.includes('You win') ||
      this.gameMessage?.includes('Blackjack!') ||
      this.gameMessage?.includes('Dealer busts')
    ) {
      return 'Win';
    } else if (
      this.gameMessage?.includes('You lose') ||
      this.gameMessage?.includes('Bust!') ||
      this.gameMessage?.includes('Dealer wins') ||
      this.gameMessage?.includes('Dealer has Blackjack')
    ) {
      return 'Lose';
    } else {
      return 'Draw'; // Push/tie
    }
  }

  // Determine dealer outcome (opposite of player outcome)
  determineDealerOutcome(
    playerOutcome: GameResultStatusType,
  ): GameResultStatusType {
    if (playerOutcome === 'Win') {
      return 'Lose';
    } else if (playerOutcome === 'Lose') {
      return 'Win';
    } else {
      return 'Draw';
    }
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }

  // Record game result when game ends - following daily-report pattern
  recordGameResult() {
    if (this.gameState !== 'gameOver') return;
    this._recordGameResult.perform();
  }

  _recordGameResult = task(async () => {
    const game = this.args.model;
    const createdAt = new Date();

    const codeRef = {
      module: new URL('../blackjack/blackjack', import.meta.url).href,
      name: 'BlackjackGame',
    };

    const commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('Command context not available. Please try again.');
    }

    // Create GameResult for player
    const playerOutcome = this.determineGameOutcome();
    const playerGameResult = new GameResult({
      game,
      outcome: new PlayerOutcomeField({
        player: this.args.model.player,
        outcome: new GameStatusField({
          label: playerOutcome,
        }),
      }),
      createdAt,
      ref: codeRef,
    });

    // Create GameResult for dealer (opposite outcome)
    const dealerOutcome = this.determineDealerOutcome(playerOutcome);
    const dealerGameResult = new GameResult({
      game,
      outcome: new PlayerOutcomeField({
        player: this.args.model.dealer,
        outcome: new GameStatusField({
          label: dealerOutcome,
        }),
      }),
      createdAt,
      ref: codeRef,
    });

    // Record both game results
    await Promise.all([
      new RecordGameResultCommand(commandContext).execute({
        card: playerGameResult,
        realm: this.currentRealm!.href,
      }),
      new RecordGameResultCommand(commandContext).execute({
        card: dealerGameResult,
        realm: this.currentRealm!.href,
      }),
    ]);
  });

  // Save game state back to model for persistence
  saveGameState() {
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
  }

  // Score getter for convenience
  get calculatedPlayerScore() {
    return this.calculateScore(this.playerHand);
  }

  get calculatedDealerScore() {
    return this.calculateScore(this.dealerHand);
  }

  <template>
    <div class='blackjack-table'>
      {{#unless this.gameCanStart}}
        <div class='validation-steps-overlay'>
          <ValidationSteps
            @steps={{this.validationSteps}}
            @title='Setup Required'
            @description='You must link at least one dealer and one player card to continue.'
            @editModeNote='Switch to edit mode to configure players'
            class='validation-steps'
          />
        </div>
      {{/unless}}
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
              <div class='player-avatar-container'>
                <img
                  src={{@model.dealer.thumbnailURL}}
                  alt={{@model.dealer.title}}
                  class='player-avatar'
                />
                <div>Dealer: {{@model.dealer.title}}</div>
              </div>
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
              <div class='player-avatar-container'>
                <img
                  src={{@model.player.thumbnailURL}}
                  alt={{@model.player.title}}
                  class='player-avatar'
                />
                <div>Player: {{@model.player.title}}</div>
              </div>
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
                  disabled={{not this.gameCanStart}}
                  {{on 'click' (fn this.placeBet 5)}}
                >5</button>
                <button
                  class='chip blue'
                  disabled={{not this.gameCanStart}}
                  {{on 'click' (fn this.placeBet 20)}}
                >20</button>
                <button
                  class='chip green'
                  disabled={{not this.gameCanStart}}
                  {{on 'click' (fn this.placeBet 50)}}
                >50</button>
                <button
                  class='chip black'
                  disabled={{not this.gameCanStart}}
                  {{on 'click' (fn this.placeBet 100)}}
                >100</button>
                <button
                  class='button primary'
                  disabled={{not this.gameCanStart}}
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

    <style scoped>
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
        --validation-content-background: #1b5e20;
        --validation-content-foreground: #fffb12;
      }
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
      .player-avatar-container {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        gap: 10px;
        background-color: rgba(0, 0, 0, 0.3);
        padding: 5px;
        border-radius: 5px;
      }
      .player-avatar {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        object-fit: cover;
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
  </template>
}

export class BlackjackGame extends CardDef {
  static displayName = 'Blackjack Game';
  static prefersWideFormat = true;

  @field casinoName = contains(StringField);

  @field player = linksTo(() => Player);
  @field dealer = linksTo(() => Player);

  @field playerChips = contains(NumberField);
  @field currentBet = contains(NumberField);
  @field gameState = contains(StringField);
  @field gameMessage = contains(StringField);
  @field statistics = contains(StatsField);
  @field playerScore = contains(NumberField);
  @field dealerScore = contains(NumberField);
  @field dealerHand = containsMany(PlayingCardField);
  @field playerHand = containsMany(PlayingCardField);

  @field title = contains(StringField, {
    computeVia: function (this: BlackjackGame) {
      return 'Blackjack';
    },
  });

  static isolated = IsolatedTemplate;
}
