import Component from '@glimmer/component';
import type { PlayerCard } from '../player-card/player-card';

export interface ValidationStep {
  id: string;
  title: string;
  message: string;
  status: 'complete' | 'incomplete';
}

interface ValidationStepsSignature {
  Args: {
    steps: ValidationStep[];
    title?: string;
    description?: string;
    editModeNote?: string;
  };
  Element: HTMLElement;
}

export default class ValidationSteps extends Component<ValidationStepsSignature> {
  <template>
    <section class='validation-content' ...attributes>
      <h2>{{@title}}</h2>
      {{#if @description}}
        <p class='validation-description'>{{@description}}</p>
      {{/if}}
      <div class='validation-steps'>
        {{#each @steps as |step|}}
          <div class='validation-step {{step.status}}' data-step-id={{step.id}}>
            <strong>{{step.title}}</strong>
            {{step.message}}
          </div>
        {{/each}}
      </div>
      {{#if @editModeNote}}
        <p class='edit-mode-note'>{{@editModeNote}}</p>
      {{/if}}
    </section>

    <style>
      .validation-content {
        background-color: var(--validation-content-bg, rgba(0, 0, 0, 0.5));
        border-radius: var(--validation-content-border-radius, 15px);
        padding: var(--validation-content-padding, 30px);
        max-width: var(--validation-content-max-width, 500px);
        width: var(--validation-content-width, 100%);
        box-shadow: var(
          --validation-content-box-shadow,
          0 10px 30px rgba(0, 0, 0, 0.5)
        );
        border: var(
          --validation-content-border,
          2px solid var(--boxel-highlight)
        );
      }

      .validation-content h2 {
        color: var(--validation-title-color, #f9a825);
        margin: var(--validation-title-margin, 0 0 15px 0);
        text-align: var(--validation-title-align, center);
        font-size: var(--validation-title-size, 24px);
        font-weight: var(--validation-title-weight, bold);
      }

      .validation-description {
        color: var(--validation-desc-color, var(--boxel-light-500));
        text-align: var(--validation-desc-align, center);
        margin: var(--validation-desc-margin, 0 0 20px 0);
        font-size: var(--validation-desc-size, 16px);
        line-height: var(--validation-desc-line-height, 1.4);
      }

      .validation-steps {
        display: flex;
        flex-direction: column;
        gap: var(--validation-steps-gap, 0.5rem);
      }

      .validation-step {
        background-color: var(--validation-step-bg, rgba(0, 0, 0, 0.3));
        font-size: var(--validation-step-font-size, 16px);
        line-height: var(--validation-step-line-height, 1.4);
        padding: var(--validation-step-padding, 10px);
        border: var(--validation-step-border, 1px solid #fff);
        border-radius: var(--validation-step-border-radius, 5px);
        border-left: var(--validation-step-border-left, 4px solid transparent);
        box-shadow: var(
          --validation-step-box-shadow,
          0 4px 16px 0 rgba(0, 0, 0, 0.18),
          0 1.5px 4px 0 rgba(249, 168, 37, 0.15)
        );
      }

      .validation-step:last-child {
        margin-bottom: 0;
      }

      .validation-step.incomplete {
        background-color: var(
          --validation-incomplete-bg,
          rgba(138, 14, 5, 0.8)
        );
        border-left-color: var(--validation-incomplete-border, #f44336);
      }

      .validation-step.incomplete strong {
        color: var(--validation-incomplete-text-color, #f44336);
      }

      .validation-step.complete {
        background-color: var(--validation-complete-bg, rgba(76, 175, 80, 0.1));
        border-left-color: var(--validation-complete-border, #4caf50);
      }

      .validation-step.complete strong {
        color: var(--validation-complete-text-color, #4caf50);
      }

      .validation-step strong {
        color: var(--validation-step-title-color, var(--boxel-highlight));
        display: var(--validation-step-title-display, block);
        margin: var(--validation-step-title-margin, 0 0 4px 0);
        font-weight: var(--validation-step-title-weight, inherit);
      }

      .edit-mode-note {
        font-style: var(--validation-note-style, italic);
        color: var(--validation-note-color, var(--boxel-light-500));
        margin: var(--validation-note-margin, 20px 0 0 0);
        font-size: var(--validation-note-size, 16px);
        text-align: var(--validation-note-align, center);
      }
    </style>
  </template>
}

// Game Validation State
export interface GameValidationState {
  players: PlayerCard[];
}

export function generateSetupValidationSteps(
  gameState: GameValidationState,
): ValidationStep[] {
  const steps: ValidationStep[] = [];

  // Helper functions to check game state
  const hasPlayers = () => gameState.players.length > 0;

  const hasHumanPlayer = () =>
    gameState.players.some((p: PlayerCard) => p.type === 'human');

  const getBotDealerCount = () =>
    gameState.players.filter((p: PlayerCard) => p.type === 'bot').length;

  const hasExactlyOneBotDealer = () => getBotDealerCount() === 1;

  const hasTooManyBotDealers = () => getBotDealerCount() > 1;

  const gameCanStart = () => hasExactlyOneBotDealer() && hasHumanPlayer();

  // Validation conditions
  const needsPlayers = !hasPlayers();
  const needsHumanPlayer = hasPlayers() && !hasHumanPlayer();
  const needsBotDealer = hasPlayers() && getBotDealerCount() === 0;
  const needsFewerBotDealers = hasPlayers() && hasTooManyBotDealers();

  // Step 1: Add Players - always show
  if (needsPlayers) {
    steps.push({
      id: 'players',
      title: '1. Add Players:',
      message: 'Link existing player cards or create new ones',
      status: 'incomplete',
    });

    // When no players are linked, show all upcoming requirements
    steps.push({
      id: 'human-player-preview',
      title: '2. Add Human Player:',
      message: 'You need at least one human player to play',
      status: 'incomplete',
    });

    steps.push({
      id: 'bot-dealer-preview',
      title: '3. Add Bot Dealer:',
      message: 'You need exactly one bot player card to act as dealer',
      status: 'incomplete',
    });
  } else {
    steps.push({
      id: 'players',
      title: '✓ Players Added:',
      message: 'Player cards are linked',
      status: 'complete',
    });

    // Step 2: Add Human Player (show when we have players)
    if (needsHumanPlayer) {
      steps.push({
        id: 'human-player',
        title: '2. Add Human Player:',
        message: 'You need at least one human player to play',
        status: 'incomplete',
      });
    } else {
      steps.push({
        id: 'human-player',
        title: '✓ Human Player:',
        message: 'Human player is ready',
        status: 'complete',
      });
    }

    // Step 3: Add Bot Dealer (show when we have players)
    if (needsBotDealer) {
      steps.push({
        id: 'bot-dealer',
        title: '3. Add Bot Dealer:',
        message: 'You need exactly one bot player card to act as dealer',
        status: 'incomplete',
      });
    } else if (needsFewerBotDealers) {
      steps.push({
        id: 'bot-dealer',
        title: '3. Too Many Bot Dealers:',
        message: `You have ${getBotDealerCount()} bot dealers, but need exactly 1. Remove extra bot dealers.`,
        status: 'incomplete',
      });
    } else {
      steps.push({
        id: 'bot-dealer',
        title: '✓ Bot Dealer:',
        message: 'Bot dealer is ready',
        status: 'complete',
      });
    }
  }

  // Final step: Ready to play
  if (gameCanStart()) {
    steps.push({
      id: 'ready',
      title: '✓ Ready to Play:',
      message: 'All requirements met - game is ready!',
      status: 'complete',
    });
  }

  return steps;
}

export function canGameStart(gameState: GameValidationState): boolean {
  const hasHumanPlayer = () =>
    gameState.players.some((p: PlayerCard) => p.type === 'human');

  const getBotDealerCount = () =>
    gameState.players.filter((p: PlayerCard) => p.type === 'bot').length;

  const hasExactlyOneBotDealer = () => getBotDealerCount() === 1;

  return hasExactlyOneBotDealer() && hasHumanPlayer();
}
