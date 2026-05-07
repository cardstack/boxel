import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import RecordGameResultCommand from './commands/record-game-result';
import {
  GameResult,
  GameStatusField,
  PlayerOutcomeField,
  type GameResultStatusType,
} from './game-result/game-result';
import { Player } from './player/player';
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
} from './components/validation-steps';
import { codeRef, realmURL } from '@cardstack/runtime-common';

// @ts-expect-error import.meta is valid ESM but TS detects .gts as CJS
const here: string = import.meta.url;

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

function normalizeStatistics(
  statistics?: {
    wins?: number | null;
    losses?: number | null;
    earnings?: number | null;
  } | null,
) {
  return {
    wins: statistics?.wins ?? 0,
    losses: statistics?.losses ?? 0,
    earnings: statistics?.earnings ?? 0,
  };
}

class IsolatedTemplate extends Component<typeof BlackjackGame> {
  // Game state
  @tracked gameState!: string;
  @tracked gameMessage!: string;

  // Player data
  @tracked playerChips!: number;
  @tracked currentBet!: number;
  @tracked statistics = {
    wins: 0,
    losses: 0,
    earnings: 0,
  };

  // Card deck and hands
  @tracked deck: PlayingCardField[] = [];
  @tracked playerHand: PlayingCardField[] = [];
  @tracked dealerHand: PlayingCardField[] = [];

  // ─── Enhanced UI getters ───────────────────────────────────────────────────

  get isGameOver() {
    return this.gameState === 'gameOver';
  }

  get playerWon() {
    return this.isGameOver && this.determineGameOutcome() === 'Win';
  }

  get playerLost() {
    return this.isGameOver && this.determineGameOutcome() === 'Lose';
  }

  get isPush() {
    return this.isGameOver && this.determineGameOutcome() === 'Draw';
  }

  get outcomeClass() {
    if (this.playerWon) return 'bj-outcome--win';
    if (this.playerLost) return 'bj-outcome--lose';
    return 'bj-outcome--push';
  }

  get outcomeIcon() {
    if (this.playerWon) return '🏆';
    if (this.playerLost) return '💔';
    return '🤝';
  }

  get outcomeTitle() {
    if (!this.isGameOver) return '';
    if (this.gameMessage?.includes('Blackjack!')) return '🃏 BLACKJACK!';
    if (
      this.gameMessage?.includes('Bust!') &&
      !this.gameMessage?.includes('Dealer')
    )
      return '💥 BUST!';
    if (this.gameMessage?.includes('Dealer busts')) return '🎉 DEALER BUSTS!';
    if (this.playerWon) return '🏆 YOU WIN!';
    if (this.playerLost) return '😔 YOU LOSE';
    return '🤝 PUSH';
  }

  get dealerScoreHidden() {
    return this.dealerHand.some((c) => !c.faceUp);
  }

  get displayedDealerScore(): string | number {
    if (this.dealerScoreHidden) return '?';
    return this.calculatedDealerScore;
  }

  get playerBust() {
    return this.calculatedPlayerScore > 21;
  }

  get playerPerfect() {
    return this.calculatedPlayerScore === 21;
  }

  get chipEarnings() {
    const e = this.statistics?.earnings || 0;
    return e >= 0 ? `+${e}` : String(e);
  }

  get earningsPositive() {
    return (this.statistics?.earnings || 0) >= 0;
  }

  get statusClass() {
    if (this.playerWon) return 'bj-status--win';
    if (this.playerLost) return 'bj-status--lose';
    if (this.isPush) return 'bj-status--push';
    return '';
  }

  get playerScoreClass() {
    if (this.playerBust) return 'bj-score--bust';
    if (this.playerPerfect) return 'bj-score--perfect';
    return '';
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  get gameCanStart() {
    return !!this.args.model.player && !!this.args.model.dealer;
  }

  get validationSteps(): ValidationStep[] {
    const steps: ValidationStep[] = [];
    const hasPlayer = !!this.args.model.player;
    const hasDealer = !!this.args.model.dealer;

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

    if (hasPlayer && hasDealer) {
      steps.push({
        id: 'ready',
        title: '✓ Ready to Play:',
        message: 'All requirements met — game is ready!',
        status: 'complete',
      });
    }

    return steps;
  }

  // ─── Deck & game logic (unchanged) ─────────────────────────────────────────

  suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.gameState = args.model.gameState;
    this.gameMessage = args.model.gameMessage;
    this.playerChips = args.model.playerChips || 5000;
    this.currentBet = args.model.currentBet || 100;
    this.statistics = normalizeStatistics(args.model.statistics);
    this.createDeck();
    this.shuffleDeck();

    if (args.model.playerHand.length > 0 || args.model.dealerHand.length > 0) {
      const playerCards: PlayingCardField[] = [];
      const dealerCards: PlayingCardField[] = [];

      this.args.model.playerHand?.forEach((card) => {
        playerCards.push(
          new PlayingCardField({
            suit: card.suit,
            value: card.value,
            faceUp: card.faceUp !== undefined ? card.faceUp : true,
          }),
        );
      });

      this.args.model.dealerHand?.forEach((card) => {
        dealerCards.push(
          new PlayingCardField({
            suit: card.suit,
            value: card.value,
            faceUp: card.faceUp !== undefined ? card.faceUp : true,
          }),
        );
      });

      this.playerHand = playerCards;
      this.dealerHand = dealerCards;

      if (this.gameState === 'betting') {
        this.gameMessage = 'Place your bet and deal';
      } else if (this.gameState === 'playerTurn') {
        this.gameMessage = 'Your turn. Hit or Stand?';
      } else if (this.gameState === 'dealerTurn') {
        this.gameMessage = "Dealer's turn.";
        if (this.dealerHand.length > 0 && !this.dealerHand[1].faceUp) {
          setTimeout(() => this.dealerPlay(), 1000);
        }
      }
    } else {
      this.initializeGame();
    }
  }

  initializeGame() {
    this.gameState = 'betting';
    this.gameMessage = 'Place your bet and deal';
    this.playerHand = [];
    this.dealerHand = [];
  }

  createDeck() {
    this.deck = [];
    for (let suit of this.suits) {
      for (let value of this.values) {
        this.deck.push(new PlayingCardField({ suit, value, faceUp: true }));
      }
    }
  }

  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  drawCard(faceUp = true) {
    if (this.deck.length === 0) {
      this.createDeck();
      this.shuffleDeck();
    }
    const card = this.deck.pop();
    if (!card) throw new Error('No card to draw');
    card.faceUp = faceUp;
    return card;
  }

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
    while (score > 21 && aces > 0) {
      score -= 10;
      aces -= 1;
    }
    return score;
  }

  checkForBlackjack() {
    const playerHasBlackjack =
      this.calculatedPlayerScore === 21 && this.playerHand.length === 2;
    const dealerHasBlackjack =
      this.calculatedDealerScore === 21 && this.dealerHand.length === 2;
    if (!this.currentBet) throw new Error('Current bet is undefined');

    if (playerHasBlackjack && dealerHasBlackjack) {
      this.gameState = 'gameOver';
      this.gameMessage = 'Push! Both have Blackjack.';
      this.saveGameState();
      this.recordGameResult();
      return true;
    } else if (playerHasBlackjack) {
      this.gameState = 'gameOver';
      this.gameMessage = 'Blackjack! You win 1.5x your bet!';
      this.playerChips += this.currentBet * 1.5;
      this.statistics.wins += 1;
      this.statistics.earnings += this.currentBet * 1.5;
      this.saveGameState();
      this.recordGameResult();
      return true;
    } else if (dealerHasBlackjack) {
      this.gameState = 'gameOver';
      this.gameMessage = 'Dealer has Blackjack! You lose.';
      this.playerChips -= this.currentBet;
      this.statistics.losses += 1;
      this.statistics.earnings -= this.currentBet;
      this.saveGameState();
      this.recordGameResult();
      return true;
    }
    return false;
  }

  checkForBust() {
    if (this.calculatedPlayerScore > 21) {
      this.gameState = 'gameOver';
      this.gameMessage = 'Bust! You lose.';
      this.playerChips -= this.currentBet;
      this.statistics.losses += 1;
      this.statistics.earnings -= this.currentBet;
      this.saveGameState();
      this.recordGameResult();
      return true;
    }
    return false;
  }

  dealerPlay() {
    const newDealerHand = [...this.dealerHand];
    newDealerHand.forEach((card) => (card.faceUp = true));
    this.dealerHand = newDealerHand;

    while (this.calculatedDealerScore < 17) {
      this.dealerHand = [...this.dealerHand, this.drawCard()];
    }

    const playerScore = this.calculatedPlayerScore;
    const dealerScore = this.calculatedDealerScore;

    if (dealerScore > 21) {
      this.gameMessage = 'Dealer busts! You win!';
      this.playerChips += this.currentBet;
      this.statistics.wins += 1;
      this.statistics.earnings += this.currentBet;
    } else if (dealerScore > playerScore) {
      this.gameMessage = 'Dealer wins!';
      this.playerChips -= this.currentBet;
      this.statistics.losses += 1;
      this.statistics.earnings -= this.currentBet;
    } else if (dealerScore < playerScore) {
      this.gameMessage = 'You win!';
      this.playerChips += this.currentBet;
      this.statistics.wins += 1;
      this.statistics.earnings += this.currentBet;
    } else {
      this.gameMessage = "Push! It's a tie.";
    }

    this.gameState = 'gameOver';
    this.saveGameState();
    this.recordGameResult();
  }

  @action placeBet(amount: number) {
    if (this.gameState !== 'betting') return;
    if (amount > this.playerChips) return;
    this.currentBet = amount;
    this.gameMessage = `Bet set to ${amount} chips — ready to deal!`;
  }

  @action deal() {
    if (!this.gameCanStart || this.gameState !== 'betting') return;
    if (this.playerChips < this.currentBet) {
      this.gameMessage = 'Not enough chips to place this bet!';
      return;
    }
    this.playerHand = [];
    this.dealerHand = [];

    const p1 = this.drawCard();
    const d1 = this.drawCard();
    const p2 = this.drawCard();
    const d2 = this.drawCard(false);

    this.playerHand = [p1, p2];
    this.dealerHand = [d1, d2];

    if (this.checkForBlackjack()) return;
    this.gameState = 'playerTurn';
    this.gameMessage = 'Your turn — Hit or Stand?';
    this.saveGameState();
  }

  @action hit() {
    if (this.gameState !== 'playerTurn') return;
    const newCard = this.drawCard();
    this.playerHand = [...this.playerHand, newCard];
    if (this.checkForBust()) return;
    this.gameMessage = `Drew ${newCard.value} of ${newCard.suit} — Hit or Stand?`;
  }

  @action stand() {
    if (this.gameState !== 'playerTurn') return;
    this.gameState = 'dealerTurn';
    this.gameMessage = "Dealer's turn…";
    setTimeout(() => this.dealerPlay(), 1000);
  }

  @action doubleDown() {
    if (this.gameState !== 'playerTurn' || this.playerHand.length !== 2) return;
    if (this.playerChips < this.currentBet) return;
    this.currentBet *= 2;
    this.gameMessage = 'Double Down! One card, then standing.';
    const newCard = this.drawCard();
    this.playerHand = [...this.playerHand, newCard];
    if (this.checkForBust()) return;
    setTimeout(() => this.stand(), 1000);
  }

  @action newGame() {
    if (this.gameState !== 'gameOver') return;
    if (this.deck.length < 10) {
      this.createDeck();
      this.shuffleDeck();
    }
    this.gameState = 'betting';
    this.gameMessage = 'Place your bet and deal';
    this.playerHand = [];
    this.dealerHand = [];
    this.saveGameState();
  }

  determineGameOutcome(): 'Win' | 'Lose' | 'Draw' {
    if (
      this.gameMessage?.includes('You win') ||
      this.gameMessage?.includes('Blackjack!') ||
      this.gameMessage?.includes('Dealer busts')
    )
      return 'Win';
    if (
      this.gameMessage?.includes('You lose') ||
      this.gameMessage?.includes('Bust!') ||
      this.gameMessage?.includes('Dealer wins') ||
      this.gameMessage?.includes('Dealer has Blackjack')
    )
      return 'Lose';
    return 'Draw';
  }

  determineDealerOutcome(
    playerOutcome: GameResultStatusType,
  ): GameResultStatusType {
    if (playerOutcome === 'Win') return 'Lose';
    if (playerOutcome === 'Lose') return 'Win';
    return 'Draw';
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }

  recordGameResult() {
    if (this.gameState !== 'gameOver') return;
    this._recordGameResult.perform();
  }

  _recordGameResult = task(async () => {
    const game = this.args.model;
    const createdAt = new Date();
    const blackjackRef = codeRef(here, './blackjack', 'BlackjackGame');
    const commandContext = this.args.context?.commandContext;
    if (!commandContext)
      throw new Error('Command context not available. Please try again.');

    const playerOutcome = this.determineGameOutcome();
    const playerGameResult = new GameResult({
      game,
      outcome: new PlayerOutcomeField({
        player: this.args.model.player,
        outcome: new GameStatusField({ label: playerOutcome }),
      }),
      createdAt,
      ref: blackjackRef,
    });

    const dealerOutcome = this.determineDealerOutcome(playerOutcome);
    const dealerGameResult = new GameResult({
      game,
      outcome: new PlayerOutcomeField({
        player: this.args.model.dealer,
        outcome: new GameStatusField({ label: dealerOutcome }),
      }),
      createdAt,
      ref: blackjackRef,
    });

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

  saveGameState() {
    this.args.model.playerChips = this.playerChips;
    this.args.model.currentBet = this.currentBet;
    this.args.model.gameState = this.gameState;
    this.args.model.gameMessage = this.gameMessage;
    this.args.model.statistics ??= new StatsField();
    this.args.model.statistics.wins = this.statistics.wins;
    this.args.model.statistics.losses = this.statistics.losses;
    this.args.model.statistics.earnings = this.statistics.earnings;
    this.args.model.playerHand = [];
    this.args.model.dealerHand = [];
    this.playerHand.forEach((card) => {
      this.args.model.playerHand?.push(
        new PlayingCardField({
          suit: card.suit,
          value: card.value,
          faceUp: card.faceUp !== undefined ? card.faceUp : true,
        }),
      );
    });
    this.dealerHand.forEach((card) => {
      this.args.model.dealerHand?.push(
        new PlayingCardField({
          suit: card.suit,
          value: card.value,
          faceUp: card.faceUp !== undefined ? card.faceUp : true,
        }),
      );
    });
  }

  get calculatedPlayerScore() {
    return this.calculateScore(this.playerHand);
  }
  get calculatedDealerScore() {
    return this.calculateScore(this.dealerHand);
  }

  <template>
    <div class='bj-table'>

      {{! ── Setup validation overlay ── }}
      {{#unless this.gameCanStart}}
        <div class='bj-validation-overlay'>
          <ValidationSteps
            @steps={{this.validationSteps}}
            @title='Setup Required'
            @description='Link a dealer and player card to begin playing.'
            class='bj-validation-steps'
            as |step|
          >
            <div class='bj-validation-step-body'>
              <span class='validation-step__message'>{{step.message}}</span>
              {{#if (eq step.id 'player')}}
                {{#if (eq step.status 'incomplete')}}
                  <@fields.player
                    @format='edit'
                    class='bj-link-editor bj-link-editor--player'
                  />
                {{/if}}
              {{/if}}
              {{#if (eq step.id 'dealer')}}
                {{#if (eq step.status 'incomplete')}}
                  <@fields.dealer
                    @format='edit'
                    class='bj-link-editor bj-link-editor--dealer'
                  />
                {{/if}}
              {{/if}}
            </div>
          </ValidationSteps>
        </div>
      {{/unless}}

      {{! ── Game-over outcome overlay ── }}
      {{#if this.isGameOver}}
        <div class='bj-outcome-overlay {{this.outcomeClass}}'>
          <div class='bj-outcome-icon'>{{this.outcomeIcon}}</div>
          <div class='bj-outcome-title'>{{this.outcomeTitle}}</div>
          <div class='bj-outcome-sub'>{{this.gameMessage}}</div>
          <button class='bj-play-again-btn' {{on 'click' this.newGame}}>Play
            Again</button>
        </div>
      {{/if}}

      <div class='bj-content'>

        {{! ── Header ── }}
        <div class='bj-header'>
          <div class='bj-casino-title'>
            <span class='bj-suit-accent'>♠</span>
            <span class='bj-title-text'>{{@model.casinoName}}
              Blackjack</span>
            <span class='bj-suit-accent'>♠</span>
          </div>
          <div class='bj-stats'>
            <div class='bj-stat'>
              <span class='bj-stat-label'>Wins</span>
              <span
                class='bj-stat-val bj-stat-val--wins'
              >{{this.statistics.wins}}</span>
            </div>
            <div class='bj-stat'>
              <span class='bj-stat-label'>Losses</span>
              <span
                class='bj-stat-val bj-stat-val--losses'
              >{{this.statistics.losses}}</span>
            </div>
            <div class='bj-stat'>
              <span class='bj-stat-label'>P / L</span>
              <span
                class='bj-stat-val
                  {{if
                    this.earningsPositive
                    "bj-stat-val--pos"
                    "bj-stat-val--neg"
                  }}'
              >{{this.chipEarnings}}</span>
            </div>
          </div>
        </div>

        {{! ── Felt play area ── }}
        <div class='bj-felt'>

          {{! Dealer zone }}
          <div class='bj-zone'>
            <div class='bj-zone-bar'>
              <@fields.dealer
                @format='atom'
                @displayContainer={{false}}
                class='bj-player-pill'
              />
              <div
                class='bj-score-badge
                  {{if this.dealerScoreHidden "bj-score-badge--hidden"}}'
              >{{this.displayedDealerScore}}</div>
            </div>
            <div class='bj-cards'>
              {{#each this.dealerHand as |card|}}
                <div class='bj-card {{if (not card.faceUp) "bj-card--back"}}'>
                  {{#if card.faceUp}}
                    <div
                      class='bj-card-corner bj-card-tl bj-suit-{{card.suit}}'
                    >
                      <div class='bj-cv'>{{card.value}}</div>
                      <div class='bj-cp'>
                        {{#if (eq card.suit 'hearts')}}♥{{/if}}
                        {{#if (eq card.suit 'diamonds')}}♦{{/if}}
                        {{#if (eq card.suit 'clubs')}}♣{{/if}}
                        {{#if (eq card.suit 'spades')}}♠{{/if}}
                      </div>
                    </div>
                    <div class='bj-card-center bj-suit-{{card.suit}}'>
                      {{#if (eq card.suit 'hearts')}}♥{{/if}}
                      {{#if (eq card.suit 'diamonds')}}♦{{/if}}
                      {{#if (eq card.suit 'clubs')}}♣{{/if}}
                      {{#if (eq card.suit 'spades')}}♠{{/if}}
                    </div>
                    <div
                      class='bj-card-corner bj-card-br bj-suit-{{card.suit}}'
                    >
                      <div class='bj-cv'>{{card.value}}</div>
                      <div class='bj-cp'>
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

          {{! Divider }}
          <div class='bj-divider'>
            <div class='bj-divider-line'></div>
            <div class='bj-divider-text'>BLACKJACK PAYS 3 TO 2</div>
            <div class='bj-divider-line'></div>
          </div>

          {{! Player zone }}
          <div class='bj-zone'>
            <div class='bj-zone-bar'>
              <@fields.player
                @format='atom'
                @displayContainer={{false}}
                class='bj-player-pill'
              />
              <div
                class='bj-score-badge {{this.playerScoreClass}}'
              >{{this.calculatedPlayerScore}}</div>
            </div>
            <div class='bj-cards'>
              {{#each this.playerHand as |card|}}
                <div class='bj-card'>
                  <div class='bj-card-corner bj-card-tl bj-suit-{{card.suit}}'>
                    <div class='bj-cv'>{{card.value}}</div>
                    <div class='bj-cp'>
                      {{#if (eq card.suit 'hearts')}}♥{{/if}}
                      {{#if (eq card.suit 'diamonds')}}♦{{/if}}
                      {{#if (eq card.suit 'clubs')}}♣{{/if}}
                      {{#if (eq card.suit 'spades')}}♠{{/if}}
                    </div>
                  </div>
                  <div class='bj-card-center bj-suit-{{card.suit}}'>
                    {{#if (eq card.suit 'hearts')}}♥{{/if}}
                    {{#if (eq card.suit 'diamonds')}}♦{{/if}}
                    {{#if (eq card.suit 'clubs')}}♣{{/if}}
                    {{#if (eq card.suit 'spades')}}♠{{/if}}
                  </div>
                  <div class='bj-card-corner bj-card-br bj-suit-{{card.suit}}'>
                    <div class='bj-cv'>{{card.value}}</div>
                    <div class='bj-cp'>
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

        </div>{{! /bj-felt }}

        {{! ── Bottom controls ── }}
        <div class='bj-bottom'>

          {{! Status message }}
          <div class='bj-status {{this.statusClass}}'>{{this.gameMessage}}</div>

          {{! Bankroll row }}
          <div class='bj-bankroll'>
            <div class='bj-chips-pill'>
              <span class='bj-chips-icon'>🪙</span>
              <span class='bj-chips-num'>{{this.playerChips}}</span>
              <span class='bj-chips-lbl'>chips</span>
            </div>
            <div class='bj-bet-pill'>
              <span class='bj-bet-lbl'>BET</span>
              <span class='bj-bet-num'>{{this.currentBet}}</span>
            </div>
          </div>

          {{! Action controls }}
          <div class='bj-controls'>

            {{#if (eq this.gameState 'betting')}}
              <div class='bj-chip-row'>
                <button
                  class='bj-chip bj-chip--red'
                  disabled={{not this.gameCanStart}}
                  {{on 'click' (fn this.placeBet 5)}}
                >5</button>
                <button
                  class='bj-chip bj-chip--blue'
                  disabled={{not this.gameCanStart}}
                  {{on 'click' (fn this.placeBet 20)}}
                >20</button>
                <button
                  class='bj-chip bj-chip--green'
                  disabled={{not this.gameCanStart}}
                  {{on 'click' (fn this.placeBet 50)}}
                >50</button>
                <button
                  class='bj-chip bj-chip--black'
                  disabled={{not this.gameCanStart}}
                  {{on 'click' (fn this.placeBet 100)}}
                >100</button>
                <button
                  class='bj-chip bj-chip--purple'
                  disabled={{not this.gameCanStart}}
                  {{on 'click' (fn this.placeBet 500)}}
                >500</button>
              </div>
              <button
                class='bj-deal-btn'
                disabled={{not this.gameCanStart}}
                {{on 'click' this.deal}}
              >Deal Cards</button>
            {{/if}}

            {{#if (eq this.gameState 'playerTurn')}}
              <div class='bj-action-row'>
                <button class='bj-act-btn bj-act--hit' {{on 'click' this.hit}}>
                  <span class='bj-act-icon'>👆</span>Hit
                </button>
                <button
                  class='bj-act-btn bj-act--stand'
                  {{on 'click' this.stand}}
                >
                  <span class='bj-act-icon'>✋</span>Stand
                </button>
                <button
                  class='bj-act-btn bj-act--double'
                  {{on 'click' this.doubleDown}}
                >
                  <span class='bj-act-icon'>⚡</span>Double
                </button>
              </div>
            {{/if}}

            {{#if (eq this.gameState 'dealerTurn')}}
              <div class='bj-thinking'>
                <div class='bj-dot'></div>
                <div class='bj-dot'></div>
                <div class='bj-dot'></div>
                <span>Dealer thinking…</span>
              </div>
            {{/if}}

          </div>
        </div>
      </div>
    </div>

    <style scoped>
      /* ── Root table ────────────────────────────────────────── */
      .bj-table {
        /* ── Casino design tokens ──────────────────────────── */
        --casino-gold: #d4af37;
        --casino-gold-dim: rgba(212, 175, 55, 0.35);
        --casino-gold-border: rgba(212, 175, 55, 0.22);
        --casino-gold-glow: rgba(212, 175, 55, 0.45);
        --casino-gold-shine: rgba(212, 175, 55, 0.9);
        --casino-gold-btn-text: #1a0a00;
        --casino-felt-bg: radial-gradient(
          ellipse at 50% 30%,
          #0e5c1e 0%,
          #073d10 55%,
          #030f05 100%
        );
        --casino-felt-inner: rgba(8, 50, 14, 0.45);
        --casino-panel: rgba(0, 0, 0, 0.42);
        --casino-panel-mid: rgba(0, 0, 0, 0.38);
        --casino-panel-dark: rgba(0, 0, 0, 0.48);
        --casino-panel-light: rgba(0, 0, 0, 0.3);
        --casino-panel-border: rgba(255, 255, 255, 0.09);
        --casino-ring: #8b6914;
        --casino-ring-glow: rgba(212, 175, 55, 0.15);
        --casino-font: 'Georgia', 'Times New Roman', serif;
        --casino-text: #ffffff;
        --casino-text-muted: rgba(255, 255, 255, 0.45);
        --casino-text-sub: rgba(255, 255, 255, 0.65);
        --casino-text-light: rgba(255, 255, 255, 0.85);
        --casino-win-green: #69f0ae;
        --casino-win-bg: rgba(0, 90, 0, 0.4);
        --casino-win-border: rgba(105, 240, 174, 0.35);
        --casino-lose-red: #ff6b6b;
        --casino-lose-bright: #ff8a80;
        --casino-lose-bg: rgba(100, 0, 0, 0.4);
        --casino-lose-border: rgba(255, 100, 100, 0.35);
        --casino-draw-color: #bbb;
        --casino-draw-bg: rgba(55, 55, 55, 0.4);
        --casino-draw-border: rgba(180, 180, 180, 0.25);
        --casino-card-white: #ffffff;
        --casino-card-back: #1a237e;
        --casino-card-back-border: rgba(255, 255, 255, 0.15);
        --casino-suit-red: #c62828;
        --casino-suit-black: #111111;
        --casino-score-perfect-bg: rgba(212, 175, 55, 0.25);
        --casino-score-bust-bg: rgba(160, 0, 0, 0.3);
        --casino-score-bust-color: #ff5252;
        --chip-red: linear-gradient(145deg, #d32f2f, #b71c1c);
        --chip-blue: linear-gradient(145deg, #1565c0, #0d47a1);
        --chip-green: linear-gradient(145deg, #2e7d32, #1b5e20);
        --chip-black: linear-gradient(145deg, #424242, #212121);
        --chip-purple: linear-gradient(145deg, #7b1fa2, #4a148c);
        --btn-hit: linear-gradient(145deg, #388e3c, #1b5e20);
        --btn-stand: linear-gradient(145deg, #e65100, #bf360c);
        --btn-double: linear-gradient(145deg, #c62828, #891717);

        background: var(--casino-felt-bg);
        height: 100%;
        width: 100%;
        color: var(--casino-text);
        font-family: var(--casino-font);
        display: flex;
        flex-direction: column;
        position: relative;
        overflow: hidden;
        /* Gold outer border */
        box-shadow:
          inset 0 0 0 3px var(--casino-ring),
          inset 0 0 0 5px var(--casino-ring-glow);
      }

      /* Felt micro-texture */
      .bj-table::after {
        content: '';
        position: absolute;
        inset: 0;
        background-image:
          repeating-linear-gradient(
            0deg,
            transparent,
            transparent 3px,
            rgba(0, 0, 0, 0.04) 3px,
            rgba(0, 0, 0, 0.04) 4px
          ),
          repeating-linear-gradient(
            90deg,
            transparent,
            transparent 3px,
            rgba(0, 0, 0, 0.04) 3px,
            rgba(0, 0, 0, 0.04) 4px
          );
        pointer-events: none;
        z-index: 0;
      }

      /* ── Validation overlay ────────────────────────────────── */
      .bj-validation-overlay {
        position: absolute;
        inset: 0;
        z-index: 60;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .bj-validation-steps {
        --validation-content-background: #08090b;
        --validation-content-foreground: #c9a84c;
      }
      .bj-validation-step-body {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .bj-link-editor {
        width: 100%;
      }
      .bj-link-editor :deep(.links-to-editor) {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .bj-link-editor :deep(.links-to-editor.can-write) {
        grid-template-columns: minmax(0, 1fr);
      }
      .bj-link-editor :deep(.add-new) {
        width: 100%;
        justify-content: center;
        min-height: 3rem;
        border-radius: 3px;
        border: 1px solid rgba(201, 168, 76, 0.5);
        border-top: 2px solid rgba(201, 168, 76, 0.7);
        background: #0d0f12;
        color: #c9a84c;
        box-shadow: none;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 0.8125rem;
        font-weight: 700;
        transition:
          background 0.15s ease,
          border-color 0.15s ease;
      }
      .bj-link-editor :deep(.add-new:hover),
      .bj-link-editor :deep(.add-new:focus-visible) {
        background: #141618;
        border-color: rgba(201, 168, 76, 0.75);
        color: #e8c96a;
      }
      .bj-link-editor :deep(.boxel-card-container.fitted-format) {
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.04),
          0 0 0 1px rgba(212, 175, 55, 0.18),
          var(--boxel-box-shadow-sm);
      }
      .bj-link-editor :deep(.field-component-card.fitted-format) {
        min-height: 4.25rem;
      }
      .bj-link-editor :deep(.remove) {
        --icon-bg: rgba(103, 18, 18, 0.95);
        --icon-border: rgba(255, 107, 107, 0.55);
        --icon-color: #ffd1d1;
      }
      .bj-link-editor :deep(.remove:hover),
      .bj-link-editor :deep(.remove:focus-visible) {
        --icon-bg: rgba(145, 24, 24, 1);
        --icon-border: rgba(255, 138, 128, 0.75);
      }

      /* ── Outcome overlay ───────────────────────────────────── */
      .bj-outcome-overlay {
        position: absolute;
        inset: 0;
        z-index: 50;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-sm);
        animation: overlayIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      .bj-outcome--win {
        background: radial-gradient(
          ellipse at center,
          rgba(212, 175, 55, 0.4) 0%,
          rgba(0, 0, 0, 0.88) 70%
        );
      }
      .bj-outcome--lose {
        background: radial-gradient(
          ellipse at center,
          rgba(180, 20, 20, 0.4) 0%,
          rgba(0, 0, 0, 0.88) 70%
        );
      }
      .bj-outcome--push {
        background: radial-gradient(
          ellipse at center,
          rgba(80, 80, 80, 0.4) 0%,
          rgba(0, 0, 0, 0.88) 70%
        );
      }
      .bj-outcome-icon {
        font-size: 52px;
        animation: iconPop 0.5s 0.15s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      .bj-outcome-title {
        font-size: 32px;
        font-weight: bold;
        letter-spacing: 4px;
        text-transform: uppercase;
        animation: titleSlideUp 0.4s 0.25s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      .bj-outcome--win .bj-outcome-title {
        color: var(--casino-gold);
        text-shadow: 0 0 30px var(--casino-gold-shine);
        animation:
          titleSlideUp 0.4s 0.25s cubic-bezier(0.22, 1, 0.36, 1) both,
          goldGlow 1.8s 0.7s ease-in-out infinite alternate;
      }
      .bj-outcome--lose .bj-outcome-title {
        color: var(--casino-lose-red);
        text-shadow: 0 0 20px rgba(255, 50, 50, 0.7);
      }
      .bj-outcome--push .bj-outcome-title {
        color: var(--casino-draw-color);
      }
      .bj-outcome-sub {
        font-size: var(--boxel-font-size-sm);
        color: var(--casino-text-sub);
        letter-spacing: var(--boxel-lsp-xs);
        animation: titleSlideUp 0.4s 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      .bj-play-again-btn {
        margin-top: var(--boxel-sp);
        padding: var(--boxel-sp-sm) var(--boxel-sp-xl);
        background: linear-gradient(
          135deg,
          #b8902a 0%,
          #f5d278 40%,
          #d4af37 60%,
          #a07820 100%
        );
        background-size: 300% 300%;
        color: var(--casino-gold-btn-text);
        border: none;
        border-radius: var(--boxel-border-radius-xl);
        font-size: var(--boxel-font-size);
        font-weight: bold;
        letter-spacing: var(--boxel-lsp-sm);
        cursor: pointer;
        box-shadow: 0 4px 22px var(--casino-gold-glow);
        animation:
          goldShimmer 2.5s linear infinite,
          titleSlideUp 0.4s 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
        transition:
          transform 0.2s,
          box-shadow 0.2s;
      }
      .bj-play-again-btn:hover {
        transform: scale(1.06);
        box-shadow: 0 6px 28px rgba(212, 175, 55, 0.6);
      }

      /* ── Content wrapper ───────────────────────────────────── */
      .bj-content {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: var(--boxel-sp-sm);
        gap: var(--boxel-sp-xs);
        overflow: hidden;
      }

      /* ── Header ────────────────────────────────────────────── */
      .bj-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        background: var(--casino-panel);
        border-radius: var(--boxel-border-radius);
        border: 1px solid var(--casino-gold-border);
        flex-shrink: 0;
      }
      .bj-casino-title {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size);
        font-weight: bold;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .bj-title-text {
        color: var(--casino-gold);
      }
      .bj-suit-accent {
        color: var(--casino-gold);
        font-size: var(--boxel-font-size-sm);
      }

      .bj-stats {
        display: flex;
        gap: var(--boxel-sp-xs);
      }
      .bj-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 3px var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius-sm);
        background: var(--casino-panel-mid);
        border: 1px solid rgba(255, 255, 255, 0.08);
        min-width: 46px;
      }
      .bj-stat-label {
        font-size: 9px;
        color: var(--casino-text-muted);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .bj-stat-val {
        font-size: var(--boxel-font-size-sm);
        font-weight: bold;
        line-height: 1.2;
      }
      .bj-stat-val--wins {
        color: var(--casino-win-green);
      }
      .bj-stat-val--losses {
        color: var(--casino-lose-red);
      }
      .bj-stat-val--pos {
        color: var(--casino-win-green);
      }
      .bj-stat-val--neg {
        color: var(--casino-lose-red);
      }

      /* ── Felt area ─────────────────────────────────────────── */
      .bj-felt {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        background: var(--casino-felt-inner);
        border-radius: var(--boxel-border-radius-lg);
        border: 1px solid rgba(212, 175, 55, 0.12);
        box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.45);
        min-height: 0;
        overflow: hidden;
        gap: var(--boxel-sp-xs);
      }

      /* ── Player zones ──────────────────────────────────────── */
      .bj-zone {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .bj-zone-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .bj-player-pill {
        font-size: var(--boxel-font-size-xs);
      }

      /* Score badge */
      .bj-score-badge {
        padding: 2px var(--boxel-sp);
        border-radius: var(--boxel-border-radius-xl);
        font-size: var(--boxel-font-size);
        font-weight: bold;
        min-width: 44px;
        text-align: center;
        background: var(--casino-panel-dark);
        border: 1px solid rgba(255, 255, 255, 0.18);
        transition: all 0.3s;
      }
      .bj-score-badge--hidden {
        color: var(--casino-text-muted);
        letter-spacing: 4px;
      }
      .bj-score--perfect {
        background: var(--casino-score-perfect-bg);
        border-color: var(--casino-gold);
        color: var(--casino-gold);
        box-shadow: 0 0 14px var(--casino-gold-glow);
        animation: badgePulse 1.2s ease-in-out infinite alternate;
      }
      .bj-score--bust {
        background: var(--casino-score-bust-bg);
        border-color: var(--casino-score-bust-color);
        color: var(--casino-score-bust-color);
        box-shadow: 0 0 12px rgba(255, 50, 50, 0.4);
      }

      /* ── Cards ─────────────────────────────────────────────── */
      .bj-cards {
        display: flex;
        gap: var(--boxel-sp-sm);
        min-height: 96px;
        flex-wrap: wrap;
        align-items: flex-start;
      }

      .bj-card {
        position: relative;
        width: 68px;
        height: 100px;
        border-radius: var(--boxel-border-radius);
        background: var(--casino-card-white);
        box-shadow:
          2px 5px 14px rgba(0, 0, 0, 0.55),
          0 0 0 1px rgba(0, 0, 0, 0.08);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 5px 6px;
        flex-shrink: 0;
        animation: cardDeal 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
        transition:
          transform 0.18s,
          box-shadow 0.18s;
      }
      .bj-card:hover {
        transform: translateY(-7px) rotate(1.5deg);
        box-shadow: 4px 12px 22px rgba(0, 0, 0, 0.65);
      }

      /* Inner inset border on face-up cards */
      .bj-card:not(.bj-card--back)::before {
        content: '';
        position: absolute;
        inset: 3px;
        border: 1px solid rgba(0, 0, 0, 0.07);
        border-radius: 5px;
        pointer-events: none;
      }

      /* Card back — classic crosshatch */
      .bj-card--back {
        background: var(--casino-card-back);
        background-image:
          repeating-linear-gradient(
            45deg,
            rgba(255, 255, 255, 0.06) 0,
            rgba(255, 255, 255, 0.06) 2px,
            transparent 0,
            transparent 50%
          ),
          repeating-linear-gradient(
            -45deg,
            rgba(255, 255, 255, 0.06) 0,
            rgba(255, 255, 255, 0.06) 2px,
            transparent 0,
            transparent 50%
          );
        background-size: 10px 10px;
        border: 2px solid var(--casino-card-back-border);
      }
      .bj-card--back::after {
        content: '♦';
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 42px;
        color: rgba(255, 255, 255, 0.08);
      }

      /* Card corners */
      .bj-card-corner {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        line-height: 1.1;
      }
      .bj-card-br {
        transform: rotate(180deg);
      }
      .bj-cv {
        font-size: 15px;
        font-weight: bold;
        color: var(--casino-suit-black);
        line-height: 1;
      }
      .bj-cp {
        font-size: 12px;
        line-height: 1;
      }

      /* Center pip */
      .bj-card-center {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 30px;
        line-height: 1;
        opacity: 0.88;
        pointer-events: none;
      }

      /* Suit colours */
      .bj-suit-hearts,
      .bj-suit-diamonds {
        color: var(--casino-suit-red);
      }
      .bj-suit-clubs,
      .bj-suit-spades {
        color: var(--casino-suit-black);
      }

      /* nth-child deal-delay stagger */
      .bj-card:nth-child(1) {
        animation-delay: 0s;
      }
      .bj-card:nth-child(2) {
        animation-delay: 0.1s;
      }
      .bj-card:nth-child(3) {
        animation-delay: 0.2s;
      }
      .bj-card:nth-child(4) {
        animation-delay: 0.3s;
      }
      .bj-card:nth-child(5) {
        animation-delay: 0.4s;
      }

      /* ── Divider ────────────────────────────────────────────── */
      .bj-divider {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding: 2px 0;
      }
      .bj-divider-line {
        flex: 1;
        height: 1px;
        background: linear-gradient(
          90deg,
          transparent,
          var(--casino-gold-dim),
          transparent
        );
      }
      .bj-divider-text {
        font-size: 9px;
        color: rgba(212, 175, 55, 0.55);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
        white-space: nowrap;
      }

      /* ── Bottom controls ───────────────────────────────────── */
      .bj-bottom {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      /* Status bar */
      .bj-status {
        text-align: center;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        border-radius: var(--boxel-border-radius);
        font-size: var(--boxel-font-size-sm);
        letter-spacing: var(--boxel-lsp-xs);
        background: var(--casino-panel-dark);
        border: 1px solid var(--casino-panel-border);
        transition:
          background 0.35s,
          border-color 0.35s,
          color 0.35s;
      }
      .bj-status--win {
        background: var(--casino-win-bg);
        border-color: var(--casino-win-border);
        color: var(--casino-win-green);
      }
      .bj-status--lose {
        background: var(--casino-lose-bg);
        border-color: var(--casino-lose-border);
        color: var(--casino-lose-bright);
      }
      .bj-status--push {
        background: var(--casino-draw-bg);
        border-color: var(--casino-draw-border);
        color: var(--casino-draw-color);
      }

      /* Bankroll */
      .bj-bankroll {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .bj-chips-pill {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        background: var(--casino-panel-mid);
        padding: 4px var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius-xl);
        border: 1px solid var(--casino-gold-border);
      }
      .bj-chips-icon {
        font-size: var(--boxel-font-size-sm);
      }
      .bj-chips-num {
        font-size: var(--boxel-font-size);
        font-weight: bold;
        color: var(--casino-gold);
      }
      .bj-chips-lbl {
        font-size: var(--boxel-font-size-xs);
        color: var(--casino-text-muted);
      }

      .bj-bet-pill {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        background: rgba(212, 175, 55, 0.12);
        border: 1px solid rgba(212, 175, 55, 0.38);
        padding: 4px var(--boxel-sp);
        border-radius: var(--boxel-border-radius-xl);
      }
      .bj-bet-lbl {
        font-size: 9px;
        color: rgba(212, 175, 55, 0.65);
        letter-spacing: var(--boxel-lsp-sm);
        text-transform: uppercase;
      }
      .bj-bet-num {
        font-size: var(--boxel-font-size);
        font-weight: bold;
        color: var(--casino-gold);
      }

      /* Controls shell */
      .bj-controls {
        background: var(--casino-panel-light);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-sm);
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      /* ── Betting chips ─────────────────────────────────────── */
      .bj-chip-row {
        display: flex;
        justify-content: center;
        gap: var(--boxel-sp-sm);
        flex-wrap: wrap;
        margin-bottom: var(--boxel-sp-sm);
      }
      .bj-chip {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        font-weight: bold;
        font-size: var(--boxel-font-size-xs);
        cursor: pointer;
        border: none;
        color: var(--casino-text);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow:
          0 5px 10px rgba(0, 0, 0, 0.5),
          inset 0 1px 0 rgba(255, 255, 255, 0.25),
          0 0 0 4px rgba(255, 255, 255, 0.12);
        transition:
          transform 0.15s,
          box-shadow 0.15s;
        position: relative;
        overflow: hidden;
      }
      /* Chip dashed ring */
      .bj-chip::before {
        content: '';
        position: absolute;
        inset: 5px;
        border-radius: 50%;
        border: 2px dashed rgba(255, 255, 255, 0.3);
        pointer-events: none;
      }
      .bj-chip:hover:not(:disabled) {
        transform: translateY(-4px) scale(1.1);
        box-shadow:
          0 9px 18px rgba(0, 0, 0, 0.55),
          inset 0 1px 0 rgba(255, 255, 255, 0.3),
          0 0 0 4px rgba(255, 255, 255, 0.18);
      }
      .bj-chip:active:not(:disabled) {
        transform: scale(0.95);
      }
      .bj-chip:disabled {
        opacity: 0.38;
        cursor: not-allowed;
      }

      .bj-chip--red {
        background: var(--chip-red);
      }
      .bj-chip--blue {
        background: var(--chip-blue);
      }
      .bj-chip--green {
        background: var(--chip-green);
      }
      .bj-chip--black {
        background: var(--chip-black);
      }
      .bj-chip--purple {
        background: var(--chip-purple);
      }

      /* ── Deal button ───────────────────────────────────────── */
      .bj-deal-btn {
        display: block;
        width: 100%;
        padding: var(--boxel-sp-sm);
        border: none;
        border-radius: var(--boxel-border-radius);
        font-size: var(--boxel-font-size);
        font-weight: bold;
        letter-spacing: var(--boxel-lsp-sm);
        cursor: pointer;
        background: linear-gradient(
          135deg,
          #a07820 0%,
          #f5d278 40%,
          #d4af37 60%,
          #7a5810 100%
        );
        background-size: 300% 300%;
        color: var(--casino-gold-btn-text);
        box-shadow:
          0 4px 18px var(--casino-gold-glow),
          inset 0 1px 0 rgba(255, 255, 255, 0.25);
        animation: goldShimmer 3s linear infinite;
        transition:
          transform 0.18s,
          box-shadow 0.18s;
      }
      .bj-deal-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 8px 26px rgba(212, 175, 55, 0.5);
      }
      .bj-deal-btn:active:not(:disabled) {
        transform: translateY(1px);
      }
      .bj-deal-btn:disabled {
        opacity: 0.38;
        cursor: not-allowed;
        animation: none;
      }

      /* ── Action buttons (Hit / Stand / Double) ─────────────── */
      .bj-action-row {
        display: flex;
        gap: var(--boxel-sp-sm);
      }
      .bj-act-btn {
        flex: 1;
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        border: none;
        border-radius: var(--boxel-border-radius);
        font-size: var(--boxel-font-size-sm);
        font-weight: bold;
        letter-spacing: var(--boxel-lsp-xs);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
        transition:
          transform 0.15s,
          box-shadow 0.15s;
      }
      .bj-act-icon {
        font-size: var(--boxel-font-size-lg);
      }
      .bj-act-btn:hover {
        transform: translateY(-3px);
        box-shadow: 0 7px 18px rgba(0, 0, 0, 0.5);
      }
      .bj-act-btn:active {
        transform: translateY(1px);
      }
      .bj-act--hit {
        background: var(--btn-hit);
        color: var(--casino-text);
      }
      .bj-act--stand {
        background: var(--btn-stand);
        color: var(--casino-text);
      }
      .bj-act--double {
        background: var(--btn-double);
        color: var(--casino-text);
      }

      /* ── Dealer thinking ───────────────────────────────────── */
      .bj-thinking {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
        color: var(--casino-text-sub);
        font-style: italic;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .bj-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--casino-gold);
        animation: dotBounce 1.3s ease-in-out infinite;
      }
      .bj-dot:nth-child(2) {
        animation-delay: 0.2s;
      }
      .bj-dot:nth-child(3) {
        animation-delay: 0.4s;
      }

      /* ── Keyframes ─────────────────────────────────────────── */
      @keyframes cardDeal {
        from {
          opacity: 0;
          transform: translateY(-18px) scale(0.82) rotate(-4deg);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1) rotate(0deg);
        }
      }

      @keyframes overlayIn {
        from {
          opacity: 0;
          transform: scale(0.96);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      @keyframes iconPop {
        from {
          opacity: 0;
          transform: scale(0.2) rotate(-15deg);
        }
        to {
          opacity: 1;
          transform: scale(1) rotate(0deg);
        }
      }

      @keyframes titleSlideUp {
        from {
          opacity: 0;
          transform: translateY(14px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes goldGlow {
        from {
          text-shadow: 0 0 16px rgba(212, 175, 55, 0.5);
        }
        to {
          text-shadow:
            0 0 40px rgba(212, 175, 55, 1),
            0 0 80px rgba(212, 175, 55, 0.35);
        }
      }

      @keyframes goldShimmer {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      @keyframes badgePulse {
        from {
          box-shadow: 0 0 6px rgba(212, 175, 55, 0.3);
        }
        to {
          box-shadow: 0 0 22px rgba(212, 175, 55, 0.85);
        }
      }

      @keyframes dotBounce {
        0%,
        60%,
        100% {
          transform: translateY(0);
        }
        30% {
          transform: translateY(-9px);
        }
      }

      /* ── Responsive ────────────────────────────────────────── */
      @media (max-height: 720px) {
        .bj-card {
          width: 58px;
          height: 86px;
        }
        .bj-cv {
          font-size: 13px;
        }
        .bj-cp {
          font-size: 10px;
        }
        .bj-card-center {
          font-size: 24px;
        }
        .bj-casino-title {
          font-size: var(--boxel-font-size-sm);
        }
        .bj-chip {
          width: 42px;
          height: 42px;
          font-size: 11px;
        }
        .bj-act-btn {
          padding: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-xs);
        }
        .bj-act-icon {
          font-size: var(--boxel-font-size);
        }
      }

      @media (max-width: 560px) {
        .bj-header {
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .bj-stats {
          justify-content: center;
        }
        .bj-card {
          width: 58px;
          height: 86px;
        }
        .bj-card-center {
          font-size: 24px;
        }
        .bj-chip {
          width: 42px;
          height: 42px;
          font-size: 11px;
        }
        .bj-action-row {
          flex-wrap: wrap;
        }
        .bj-outcome-title {
          font-size: 24px;
          letter-spacing: 2px;
        }
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof BlackjackGame> {
  get casinoName() {
    return this.args.model.casinoName?.trim() || 'Royal Casino';
  }

  <template>
    <article class='bj-fitted'>

      {{! ── BADGE ≤150×169 ── }}
      <div class='layout-badge'>
        <div class='logo-chip' aria-hidden='true'>
          <span class='logo-chip__number'>21</span>
        </div>
        <span class='bj-label'>BLACKJACK</span>
      </div>

      {{! ── STRIP 151+×≤169 ── }}
      <div class='layout-strip'>
        <div class='logo-chip logo-chip--sm' aria-hidden='true'>
          <span class='logo-chip__number'>21</span>
        </div>
        <div class='strip-copy'>
          <span class='bj-title'>BLACKJACK</span>
          <span class='bj-sub'>{{this.casinoName}}</span>
        </div>
        <div class='chip-row chip-row--1' aria-hidden='true'>
          <span class='casino-chip casino-chip--black'>100</span>
        </div>
      </div>

      {{! ── TILE ≤399×170+ ── }}
      <div class='layout-tile'>
        <div class='tile-top' aria-hidden='true'>
          <span class='pays-text'>BLACKJACK PAYS 3 TO 2</span>
        </div>
        <div class='tile-center'>
          <div class='logo-lockup'>
            <div class='logo-chip logo-chip--md' aria-hidden='true'>
              <span class='logo-chip__number'>21</span>
            </div>
            <div class='logo-suits' aria-hidden='true'>
              <span class='suit suit--spade'>♠</span>
              <span class='suit suit--heart'>♥</span>
              <span class='suit suit--diamond'>♦</span>
              <span class='suit suit--club'>♣</span>
            </div>
          </div>
          <h3 class='bj-title bj-title--tile'>BLACKJACK</h3>
          <p class='bj-sub'>{{this.casinoName}}</p>
        </div>
        <div class='chip-row chip-row--3' aria-hidden='true'>
          <span class='casino-chip casino-chip--red'>5</span>
          <span class='casino-chip casino-chip--green'>50</span>
          <span class='casino-chip casino-chip--black'>100</span>
        </div>
      </div>

      {{! ── CARD 400+×170+ ── }}
      <div class='layout-card'>
        {{! Left showpiece }}
        <div class='card-showpiece' aria-hidden='true'>
          <div class='showpiece-bg'></div>
          <div class='playing-cards'>
            <span class='play-card play-card--back play-card--left'></span>
            <span class='play-card play-card--red'>A♥</span>
            <span class='play-card play-card--black'>K♠</span>
          </div>
          <div class='logo-chip logo-chip--lg'>
            <span class='logo-chip__number'>21</span>
          </div>
          <span class='pays-text pays-text--arc'>BLACKJACK PAYS 3 TO 2</span>
        </div>

        {{! Right info panel }}
        <div class='card-info'>
          <div class='card-info__top'>
            <span class='bj-eyebrow'>{{this.casinoName}}</span>
            <h3 class='bj-title bj-title--hero'>BLACKJACK</h3>
            <p class='bj-tagline'>
              Hit, stand, double down — chase twenty-one.
            </p>
          </div>
          <div class='card-info__bottom'>
            <div class='chip-row chip-row--5' aria-hidden='true'>
              <span class='casino-chip casino-chip--red'>5</span>
              <span class='casino-chip casino-chip--blue'>20</span>
              <span class='casino-chip casino-chip--green'>50</span>
              <span class='casino-chip casino-chip--black'>100</span>
              <span class='casino-chip casino-chip--purple'>500</span>
            </div>
          </div>
        </div>
      </div>

    </article>

    <style scoped>
      /* ── Design tokens ─────────────────────────────────── */
      .bj-fitted {
        --gold: #d4af37;
        --gold-dim: rgba(212, 175, 55, 0.32);
        --gold-border: rgba(212, 175, 55, 0.3);
        --gold-glow: rgba(212, 175, 55, 0.55);
        --cream: #fff6d8;
        --cream-dim: rgba(255, 246, 216, 0.65);
        --casino-red: #b21d2a;
        --felt-bg: radial-gradient(
          ellipse at 50% 25%,
          #126128 0%,
          #063d12 55%,
          #020d04 100%
        );
        --felt-sheen: radial-gradient(
          circle at 18% 12%,
          rgba(255, 246, 216, 0.13),
          transparent 30%
        );
        --panel-border: rgba(139, 105, 20, 0.45);
        --chip-red: linear-gradient(145deg, #d32f2f, #891212);
        --chip-blue: linear-gradient(145deg, #1565c0, #0a3475);
        --chip-green: linear-gradient(145deg, #2e7d32, #124a15);
        --chip-black: linear-gradient(145deg, #3a3a3a, #1a1a1a);
        --chip-purple: linear-gradient(145deg, #7b1fa2, #3d0a5e);
        --casino-font: 'Georgia', 'Times New Roman', serif;

        width: 100%;
        height: 100%;
        color: var(--cream);
        font-family: var(--casino-font);
        container-type: size;
      }

      /* ── Shared layout shell ───────────────────────────── */
      .layout-badge,
      .layout-strip,
      .layout-tile,
      .layout-card {
        display: none;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        overflow: hidden;
        border-radius: 0.875rem;
        border: 1px solid var(--gold-border);
        background: var(--felt-sheen), var(--felt-bg);
        box-shadow:
          inset 0 0 0 2px var(--panel-border),
          inset 0 -3rem 6rem rgba(0, 0, 0, 0.3),
          0 0.5rem 1.5rem rgba(0, 0, 0, 0.25);
        position: relative;
      }

      /* Felt micro-texture overlay */
      .layout-badge::after,
      .layout-strip::after,
      .layout-tile::after,
      .layout-card::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background-image:
          repeating-linear-gradient(
            0deg,
            transparent,
            transparent 3px,
            rgba(0, 0, 0, 0.025) 3px,
            rgba(0, 0, 0, 0.025) 4px
          ),
          repeating-linear-gradient(
            90deg,
            transparent,
            transparent 3px,
            rgba(0, 0, 0, 0.025) 3px,
            rgba(0, 0, 0, 0.025) 4px
          );
        pointer-events: none;
        z-index: 0;
      }

      /* ── Logo chip ─────────────────────────────────────── */
      .logo-chip {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        flex-shrink: 0;
        /* Conic casino chip pattern */
        background:
          radial-gradient(circle, #0e4d1c 0 36%, transparent 37%),
          repeating-conic-gradient(
            from 0deg,
            var(--cream) 0deg 9deg,
            var(--casino-red) 9deg 20deg
          );
        box-shadow:
          0 0 0 2px rgba(255, 246, 216, 0.18),
          0 0.3rem 1rem rgba(0, 0, 0, 0.5),
          0 0 1.5rem var(--gold-glow);
        z-index: 1;
      }

      .logo-chip__number {
        font-size: inherit;
        font-weight: 900;
        color: var(--gold);
        letter-spacing: -0.02em;
        text-shadow:
          0 0 8px var(--gold-glow),
          0 1px 2px rgba(0, 0, 0, 0.6);
        z-index: 2;
        line-height: 1;
      }

      .logo-chip--sm {
        width: 2.1rem;
        height: 2.1rem;
        font-size: 0.78rem;
      }

      .logo-chip--md {
        width: 3.5rem;
        height: 3.5rem;
        font-size: 1.15rem;
        animation: chipGlow 2.5s ease-in-out infinite alternate;
      }

      .logo-chip--lg {
        width: clamp(3.8rem, 16cqw, 6.5rem);
        height: clamp(3.8rem, 16cqw, 6.5rem);
        font-size: clamp(1.2rem, 4.5cqw, 2rem);
        animation: chipGlow 2.5s ease-in-out infinite alternate;
      }

      /* ── Typography ────────────────────────────────────── */
      .bj-label {
        font-size: 0.52rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--cream-dim);
      }

      .bj-eyebrow {
        font-size: 0.62rem;
        font-weight: 600;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--cream-dim);
        margin: 0;
      }

      .bj-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 800;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--gold);
        line-height: 1;
        text-shadow: 0 0 18px var(--gold-glow);
        white-space: nowrap;
      }

      .bj-title--tile {
        font-size: clamp(1.1rem, 7cqw, 1.7rem);
        margin-top: 0.4rem;
        animation: goldPulse 3s ease-in-out infinite alternate;
      }

      .bj-title--hero {
        font-size: clamp(1.6rem, 6cqw, 3rem);
        letter-spacing: 0.18em;
        animation: goldPulse 3s ease-in-out infinite alternate;
      }

      .bj-sub {
        margin: 0.2rem 0 0;
        font-size: 0.68rem;
        color: var(--cream-dim);
        letter-spacing: 0.04em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bj-tagline {
        margin: 0.35rem 0 0;
        font-size: 0.72rem;
        color: var(--cream-dim);
        font-style: italic;
        line-height: 1.4;
      }

      /* ── Suit symbols ──────────────────────────────────── */
      .logo-suits {
        display: flex;
        gap: 0.22rem;
        margin-top: 0.4rem;
      }

      .suit {
        font-size: 0.85rem;
        line-height: 1;
        opacity: 0.75;
      }

      .suit--heart,
      .suit--diamond {
        color: #e53935;
      }

      .suit--spade,
      .suit--club {
        color: var(--cream);
      }

      /* ── Casino chips ──────────────────────────────────── */
      .chip-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        z-index: 1;
        position: relative;
      }

      .casino-chip {
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-size: 0.56rem;
        font-weight: 700;
        color: var(--cream);
        line-height: 1;
        position: relative;
        overflow: hidden;
        /* Chip ring */
        box-shadow:
          0 0 0 2px rgba(255, 255, 255, 0.18),
          0 3px 8px rgba(0, 0, 0, 0.55),
          inset 0 1px 0 rgba(255, 255, 255, 0.22);
      }

      /* Dashed inner ring */
      .casino-chip::before {
        content: '';
        position: absolute;
        inset: 3px;
        border-radius: 50%;
        border: 1.5px dashed rgba(255, 255, 255, 0.28);
        pointer-events: none;
      }

      .casino-chip--red {
        background: var(--chip-red);
      }
      .casino-chip--blue {
        background: var(--chip-blue);
      }
      .casino-chip--green {
        background: var(--chip-green);
      }
      .casino-chip--black {
        background: var(--chip-black);
      }
      .casino-chip--purple {
        background: var(--chip-purple);
      }

      /* ── Pays text ─────────────────────────────────────── */
      .pays-text {
        font-size: 0.58rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--gold-dim);
        white-space: nowrap;
      }

      /* ── BADGE layout ──────────────────────────────────── */
      .layout-badge {
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.3rem;
        padding: 0.4rem 0.3rem;
      }

      /* ── STRIP layout ──────────────────────────────────── */
      .layout-strip {
        flex-direction: row;
        align-items: center;
        gap: 0.6rem;
        padding: 0.5rem 0.7rem;
      }

      .strip-copy {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 0.15rem;
      }

      /* Strip chip sizing */
      .chip-row--1 .casino-chip {
        width: 2rem;
        height: 2rem;
        font-size: 0.6rem;
      }

      /* ── TILE layout ───────────────────────────────────── */
      .layout-tile {
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        padding: 0.6rem 0.75rem;
        gap: 0.4rem;
        text-align: center;
      }

      .tile-top {
        z-index: 1;
      }

      .tile-center {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0;
        z-index: 1;
      }

      .logo-lockup {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      /* Tile chip sizing */
      .chip-row--3 .casino-chip {
        width: clamp(1.8rem, 8cqw, 2.5rem);
        height: clamp(1.8rem, 8cqw, 2.5rem);
        font-size: clamp(0.55rem, 2cqw, 0.72rem);
      }

      /* ── CARD layout ───────────────────────────────────── */
      .layout-card {
        flex-direction: row;
        align-items: stretch;
      }

      /* Left showpiece */
      .card-showpiece {
        position: relative;
        width: 42%;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.6rem;
        padding: 0.75rem 0.5rem;
        z-index: 1;
        /* Subtle inner separator */
        border-right: 1px solid var(--gold-border);
        background: rgba(0, 0, 0, 0.15);
      }

      .showpiece-bg {
        position: absolute;
        inset: 0;
        background: radial-gradient(
          ellipse at center,
          rgba(212, 175, 55, 0.07),
          transparent 70%
        );
        pointer-events: none;
      }

      .pays-text--arc {
        margin-top: 0.4rem;
        text-align: center;
      }

      /* Playing cards fan */
      .playing-cards {
        position: relative;
        width: clamp(5rem, 18cqw, 8rem);
        height: clamp(3.5rem, 14cqw, 6rem);
        flex-shrink: 0;
      }

      .play-card {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48%;
        height: 90%;
        border-radius: 0.3rem;
        font-size: clamp(0.65rem, 2.5cqw, 1rem);
        font-weight: 800;
        box-shadow:
          0 4px 14px rgba(0, 0, 0, 0.5),
          0 0 0 1px rgba(0, 0, 0, 0.1);
      }

      .play-card--back {
        background:
          repeating-linear-gradient(
            45deg,
            rgba(255, 255, 255, 0.055) 0,
            rgba(255, 255, 255, 0.055) 2px,
            transparent 0,
            transparent 50%
          ),
          #1a237e;
        background-size:
          8px 8px,
          auto;
        left: 0;
        top: 8%;
        rotate: -10deg;
        z-index: 0;
      }

      .play-card--red {
        background: var(--cream);
        color: var(--casino-red);
        left: 24%;
        top: 0;
        rotate: -3deg;
        z-index: 1;
      }

      .play-card--black {
        background: var(--cream);
        color: #111;
        right: 0;
        top: 4%;
        rotate: 9deg;
        z-index: 2;
      }

      /* Right info panel */
      .card-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 0.85rem 0.9rem;
        z-index: 1;
        min-width: 0;
      }

      .card-info__top {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .card-info__bottom {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      /* Card chip sizing */
      .chip-row--5 .casino-chip {
        width: clamp(1.6rem, 5cqw, 2.6rem);
        height: clamp(1.6rem, 5cqw, 2.6rem);
        font-size: clamp(0.48rem, 1.5cqw, 0.72rem);
      }

      /* ── Player rows ───────────────────────────────────── */
      /* ── Animations ────────────────────────────────────── */
      @keyframes chipGlow {
        from {
          box-shadow:
            0 0 0 2px rgba(255, 246, 216, 0.18),
            0 0.3rem 1rem rgba(0, 0, 0, 0.5),
            0 0 0.8rem var(--gold-glow);
        }
        to {
          box-shadow:
            0 0 0 2px rgba(255, 246, 216, 0.3),
            0 0.3rem 1rem rgba(0, 0, 0, 0.5),
            0 0 2.5rem var(--gold-glow);
        }
      }

      @keyframes goldPulse {
        from {
          text-shadow: 0 0 10px rgba(212, 175, 55, 0.4);
        }
        to {
          text-shadow:
            0 0 28px rgba(212, 175, 55, 0.9),
            0 0 48px rgba(212, 175, 55, 0.25);
        }
      }

      /* ── Container breakpoints ─────────────────────────── */

      /* Badge: ≤150px wide OR ≤169px tall in tiny box */
      @container (max-width: 150px) and (max-height: 169px) {
        .layout-badge {
          display: flex;
        }
        .logo-chip--sm {
          width: 2.6rem;
          height: 2.6rem;
          font-size: 0.95rem;
        }
      }

      /* Strip: wider but still short */
      @container (min-width: 151px) and (max-height: 169px) {
        .layout-strip {
          display: flex;
        }
      }

      /* Tile: taller, narrower */
      @container (max-width: 399px) and (min-height: 170px) {
        .layout-tile {
          display: flex;
        }
      }

      /* Card: wide & tall */
      @container (min-width: 400px) and (min-height: 170px) {
        .layout-card {
          display: flex;
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

  @field cardTitle = contains(StringField, {
    computeVia: function (this: BlackjackGame) {
      return 'Blackjack';
    },
  });

  static isolated = IsolatedTemplate;
  static fitted = FittedTemplate;
}
