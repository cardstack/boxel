import {
  CardDef,
  contains,
  linksTo,
  field,
  FieldDef,
  Component,
  getCardMeta,
} from 'https://cardstack.com/base/card-api';

import StringField from 'https://cardstack.com/base/string';
import DatetimeField from 'https://cardstack.com/base/datetime';
import GamepadIcon from '@cardstack/boxel-icons/gamepad-2';
import { RadioInput, FieldContainer } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { AbsoluteCodeRefField } from 'https://cardstack.com/base/code-ref';
import GitBranch from '@cardstack/boxel-icons/git-branch';

export type GameResultStatusType = 'Win' | 'Lose' | 'Draw';

export class GameStatusEdit extends Component<typeof GameStatusField> {
  @tracked label: GameResultStatusType | undefined = this.args.model.label as
    | GameResultStatusType
    | undefined;

  // This ensures you get values from the class the instance is created
  get statuses() {
    return (this.args.model.constructor as any).values as GameStatusField[];
  }

  @action onSelectStatus(status: GameStatusField): void {
    this.label = status.label as GameResultStatusType;
    this.args.model.label = status.label as GameResultStatusType;
  }

  <template>
    <RadioInput
      @groupDescription='Game Result'
      @items={{this.statuses}}
      @name='game-result'
      @checkedId={{this.label}}
      @keyName='label'
      as |item|
    >
      <item.component @onChange={{fn this.onSelectStatus item.data}}>
        {{item.data.label}}
      </item.component>
    </RadioInput>
  </template>
}

export class GameStatusField extends FieldDef {
  @field label = contains(StringField);

  static values = [{ label: 'Win' }, { label: 'Lose' }, { label: 'Draw' }];

  static embedded = class Embedded extends Component<typeof GameStatusField> {
    <template>
      {{@model.label}}
    </template>
  };

  static edit = GameStatusEdit;
}

export class PlayerOutcomeField extends FieldDef {
  @field player = linksTo(() => CardDef);
  @field outcome = contains(GameStatusField);

  static embedded = class Embedded extends Component<
    typeof PlayerOutcomeField
  > {
    <template>
      <div class='player-outcome'>
        <span class='player-name'>{{@model.player.title}}</span>
        <span class='outcome-badge'>{{@model.outcome.label}}</span>
      </div>
    </template>
  };

  static edit = class Edit extends Component<typeof PlayerOutcomeField> {
    <template>
      <div class='player-outcome-edit'>
        <div class='field-group'>
          <label>Player</label>
          <@fields.player />
        </div>
        <div class='field-group'>
          <label>Outcome</label>
          <@fields.outcome />
        </div>
      </div>
      <style scoped>
        .player-outcome-edit {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1rem;
          background: var(--boxel-100);
          border-radius: var(--boxel-border-radius);
          border: var(--boxel-border);
        }
        .field-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .field-group label {
          font-weight: 600;
          font-size: 0.875rem;
          color: var(--boxel-600);
        }
        .player-outcome {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem 1rem;
          background: var(--boxel-100);
          border-radius: var(--boxel-border-radius);
          border: var(--boxel-border);
        }
        .player-name {
          font-weight: 600;
          color: var(--boxel-700);
        }
        .outcome-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 1rem;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          background: var(--boxel-200);
          color: var(--boxel-700);
        }
      </style>
    </template>
  };
}

// Shared status color utility function
function getStatusColors(status?: string) {
  const statusLower = status?.toLowerCase();
  switch (statusLower) {
    case 'win':
      return {
        bg: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #60a5fa 100%)',
        accent: '#10b981',
        border: '#10b981',
        glow: 'rgba(16, 185, 129, 0.3)',
        stars: '#fbbf24',
      };
    case 'lose':
      return {
        bg: 'linear-gradient(135deg, #7f1d1d 0%, #dc2626 50%, #ef4444 100%)',
        accent: '#ef4444',
        border: '#dc2626',
        glow: 'rgba(220, 38, 38, 0.3)',
        stars: '#f59e0b',
      };
    case 'draw':
      return {
        bg: 'linear-gradient(135deg, #92400e 0%, #d97706 50%, #f59e0b 100%)',
        accent: '#f59e0b',
        border: '#ea580c',
        glow: 'rgba(234, 88, 12, 0.3)',
        stars: '#3b82f6',
      };
    default:
      return {
        bg: 'linear-gradient(135deg, #374151 0%, #6b7280 50%, #9ca3af 100%)',
        accent: '#6b7280',
        border: '#6b7280',
        glow: 'rgba(107, 114, 128, 0.3)',
        stars: '#64748b',
      };
  }
}

// Shared status icon utility function
function getStatusIcon(status?: string) {
  const statusLower = status?.toLowerCase();
  switch (statusLower) {
    case 'win':
      return '🏆';
    case 'lose':
      return '💀';
    case 'draw':
      return '🤝';
    default:
      return '❓';
  }
}

export class GameResult extends CardDef {
  static displayName = 'Game Result';
  static icon = GamepadIcon;

  @field game = linksTo(() => CardDef);
  @field outcome = contains(PlayerOutcomeField);
  @field ref = contains(AbsoluteCodeRefField);
  @field createdAt = contains(DatetimeField, {
    computeVia: function (this: GameResult) {
      let lastModified = getCardMeta(this, 'lastModified');
      return lastModified ? new Date(lastModified * 1000) : undefined;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: GameResult) {
      return this.game.title ?? 'Untitled Game Result';
    },
  });

  static isolated = class Isolated extends Component<typeof GameResult> {
    get statusColors() {
      return getStatusColors(this.args.model.outcome?.outcome?.label);
    }

    get cardStyle() {
      const colors = this.statusColors;
      return htmlSafe(
        `background: ${colors.bg}; border-color: ${colors.border};`,
      );
    }

    <template>
      <div class='game-result-isolated'>
        <div class='card-container' style={{this.cardStyle}}>
          {{! Status Badge }}
          <div class='status-badge'>
            <span class='status-icon'>{{getStatusIcon
                @model.outcome.outcome.label
              }}</span>
            <span class='status-text'>{{@model.outcome.outcome.label}}</span>
          </div>

          {{! Game Title Section }}
          <div class='game-section'>
            <div class='game-header'>
              <GamepadIcon class='game-icon' />
              <h1 class='game-title'>{{@model.game.title}}</h1>
            </div>
            <div class='player-info'>
              <span class='player-label'>Player:</span>
              <span class='player-name'>{{@model.outcome.player.title}}</span>
            </div>
          </div>

          {{! Details Section }}
          <div class='details-section'>
            <div class='detail-group'>
              <span class='detail-label'>Game ID</span>
              <div class='detail-value monospace'>{{@model.game.id}}</div>
            </div>

            <div class='detail-group'>
              <span class='detail-label'>Player ID</span>
              <div
                class='detail-value monospace'
              >{{@model.outcome.player.id}}</div>
            </div>

            <div class='detail-group'>
              <span class='detail-label'>Created</span>
              <div class='detail-value'>
                <@fields.createdAt />
              </div>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .game-result-isolated {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          box-sizing: border-box;
          background: linear-gradient(
            135deg,
            var(--bg-start, #f8fafc) 0%,
            var(--bg-end, #e2e8f0) 100%
          );
          container-type: inline-size;
        }

        .card-container {
          width: 100%;
          max-width: 600px;
          height: auto;
          border-radius: 1.5rem;
          padding: 3rem 2.5rem;
          color: white;
          border: 2px solid;
          font-family:
            'Inter',
            -apple-system,
            sans-serif;
          box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.15),
            0 8px 25px rgba(0, 0, 0, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 2.5rem;
          align-items: center;
          text-align: center;
          backdrop-filter: blur(20px);
        }

        /* Subtle glass effect */
        .card-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(2px);
          pointer-events: none;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          background: rgba(255, 255, 255, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 3rem;
          padding: 1rem 2rem;
          backdrop-filter: blur(15px);
          box-shadow:
            0 4px 20px rgba(0, 0, 0, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.2);
          z-index: 2;
        }

        .status-icon {
          font-size: 1.75rem;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
        }

        .status-text {
          font-size: 1.125rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .game-section {
          z-index: 2;
        }

        .game-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1.5rem;
        }

        .game-icon {
          width: 4rem;
          height: 4rem;
          opacity: 0.95;
          filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.25));
        }

        .game-title {
          font-size: clamp(2rem, 4vw, 3.5rem);
          font-weight: 800;
          margin: 0;
          text-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          line-height: 1.1;
          letter-spacing: -0.02em;
        }

        .player-info {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-top: 1rem;
          padding: 0.75rem 1.25rem;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 1rem;
          backdrop-filter: blur(10px);
        }

        .player-label {
          font-size: 0.875rem;
          font-weight: 600;
          opacity: 0.85;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        .player-name {
          font-size: 1rem;
          font-weight: 600;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        .details-section {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          width: 100%;
          max-width: 400px;
          z-index: 2;
        }

        .detail-group {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
          padding: 1.25rem;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 1rem;
          backdrop-filter: blur(10px);
        }

        .detail-label {
          font-size: 0.875rem;
          font-weight: 600;
          opacity: 0.85;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        .detail-value {
          font-size: 1rem;
          font-weight: 500;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
          word-break: break-all;
          text-align: center;
          line-height: 1.4;
        }

        .detail-value.monospace {
          font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
          font-size: 0.875rem;
          background: rgba(255, 255, 255, 0.1);
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(255, 255, 255, 0.15);
        }

        /* Container Query Responsive Design */
        @container (max-width: 768px) {
          .game-result-isolated {
            padding: 1.5rem;
          }

          .card-container {
            padding: 2rem 1.5rem;
            gap: 2rem;
          }

          .game-icon {
            width: 3rem;
            height: 3rem;
          }

          .status-badge {
            padding: 0.75rem 1.5rem;
          }

          .status-icon {
            font-size: 1.5rem;
          }

          .status-text {
            font-size: 1rem;
          }
        }

        @container (max-width: 480px) {
          .game-result-isolated {
            padding: 1rem;
          }

          .card-container {
            padding: 1.5rem 1rem;
            gap: 1.5rem;
          }

          .game-header {
            gap: 1rem;
          }

          .game-icon {
            width: 2.5rem;
            height: 2.5rem;
          }

          .details-section {
            gap: 1rem;
          }

          .detail-group {
            padding: 1rem;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof GameResult> {
    get tileStyle() {
      const colors = getStatusColors(this.args.model.outcome?.outcome?.label);
      return htmlSafe(`background: ${colors.bg};`);
    }

    <template>
      <div class='game-tile' style={{this.tileStyle}}>
        {{! Left Section - Status }}
        <div class='status-section'>
          <div class='status-badge'>
            <span class='status-icon'>{{getStatusIcon
                @model.outcome.outcome.label
              }}</span>
            <span class='status-text'>{{@model.outcome.outcome.label}}</span>
          </div>
        </div>

        {{! Center Section - Game Info }}
        <div class='game-section'>
          <div class='game-header'>
            <GamepadIcon class='game-icon' />
            <div class='game-title'>{{@model.game.title}}</div>
          </div>
          <div class='player-info'>
            <span class='player-label'>Player:</span>
            <span class='player-name'>{{@model.outcome.player.title}}</span>
          </div>
          <div class='game-meta'>
            <span class='game-id-label'>Game ID:</span>
            <span class='game-id'>{{@model.game.id}}</span>
          </div>
          <div class='created-at-meta'>
            <span class='created-at-label'>Created:</span>
            <@fields.createdAt />
          </div>
        </div>

        {{! Right Section - Accent Line }}
        <div class='accent-line'></div>
      </div>

      <style scoped>
        .game-tile {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          padding: 1rem 1.5rem;
          color: white;
          font-family:
            'Inter',
            -apple-system,
            sans-serif;
          position: relative;
          overflow: hidden;
          container-type: inline-size;
        }

        .game-tile::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.1);
          backdrop-filter: blur(1px);
          pointer-events: none;
        }

        .status-section {
          display: flex;
          align-items: center;
          gap: 0.875rem;
          flex-shrink: 0;
          z-index: 1;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(255, 255, 255, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 2rem;
          padding: 0.5rem 1rem;
          backdrop-filter: blur(10px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .status-icon {
          font-size: 1.25rem;
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
        }

        .status-text {
          font-size: 0.875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        .game-section {
          flex: 1;
          margin-left: 1.5rem;
          min-width: 0;
          z-index: 1;
        }

        .game-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .game-icon {
          width: 1.5rem;
          height: 1.5rem;
          opacity: 0.9;
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
        }

        .game-title {
          font-size: 1.125rem;
          font-weight: 600;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .player-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 0.5rem;
          opacity: 0.9;
        }

        .player-label {
          font-size: 0.75rem;
          font-weight: 500;
          opacity: 0.8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .player-name {
          font-size: 0.8rem;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .game-meta {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          opacity: 0.9;
        }

        .game-id-label {
          font-size: 0.75rem;
          font-weight: 500;
          opacity: 0.8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .game-id {
          font-size: 0.8rem;
          font-weight: 400;
          font-family: 'SF Mono', Monaco, monospace;
          background: rgba(255, 255, 255, 0.1);
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .created-at-meta {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 0.5rem;
          opacity: 0.9;
        }

        .created-at-meta .created-at-label {
          font-size: 0.75rem;
          font-weight: 500;
          opacity: 0.8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .accent-line {
          width: 4px;
          height: 80%;
          background: var(--accent-color, rgba(255, 255, 255, 0.6));
          border-radius: 2px;
          flex-shrink: 0;
          box-shadow: 0 0 8px rgba(255, 255, 255, 0.3);
          z-index: 1;
          margin-left: 0.5rem;
        }

        /* Dynamic accent color based on status */
        .game-tile .accent-line {
          background: rgba(255, 255, 255, 0.8);
          box-shadow: 0 0 12px rgba(255, 255, 255, 0.4);
        }

        /* Container Query Responsive */
        @container (max-width: 420px) {
          .game-section {
            margin-right: 0.5rem;
          }

          .game-tile {
            padding: 0.75rem 1rem;
          }

          .status-badge {
            padding: 0.5rem 0.75rem;
          }

          .status-icon {
            font-size: 1.25rem;
          }

          .game-title {
            font-size: 1rem;
          }

          .game-id {
            max-width: 6rem;
          }
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof GameResult> {
    <template>
      <article class='container'>
        <section class='game section'>
          <header class='row-header' aria-labelledby='game'>
            <GamepadIcon width='20' height='20' role='presentation' />
            <h2 id='game'>Game</h2>
          </header>
          <div data-test-game>
            <@fields.game />
          </div>
        </section>

        <section class='outcome section'>
          <header class='row-header' aria-labelledby='outcome'>
            <GamepadIcon width='20' height='20' role='presentation' />
            <h2 id='outcome'>Player Outcome</h2>
          </header>
          <div data-test-outcome>
            <@fields.outcome />
          </div>
        </section>

        <section class='created-at section'>
          <header class='row-header' aria-labelledby='created-at'>
            <GamepadIcon width='20' height='20' role='presentation' />
            <h2 id='created-at'>Created At</h2>
          </header>
          <div data-test-created-at>
            <@fields.createdAt />
          </div>
        </section>

        <section class='module section'>
          <header class='row-header' aria-labelledby='module'>
            <GitBranch width='20' height='20' role='presentation' />
            <h2 id='module'>Code Reference</h2>
          </header>
          <div class='code-ref-container'>
            <FieldContainer @label='URL' @vertical={{true}}>
              <div class='code-ref-row'>
                <span class='code-ref-value' data-test-module-href>
                  {{@model.ref.module}}
                </span>
              </div>
            </FieldContainer>
            <FieldContainer @label='Module Name' @vertical={{true}}>
              <div class='code-ref-row'>
                <div class='code-ref-value' data-test-exported-name>
                  {{@model.ref.name}}
                </div>
              </div>
            </FieldContainer>
          </div>
        </section>
      </article>
      <style scoped>
        .container {
          --boxel-spec-background-color: #ebeaed;
          --boxel-spec-code-ref-background-color: #e2e2e2;
          --boxel-spec-code-ref-text-color: #646464;

          height: 100%;
          min-height: max-content;
          padding: var(--boxel-sp);
          background-color: var(--boxel-spec-background-color);
        }
        .section {
          margin-top: var(--boxel-sp);
          padding-top: var(--boxel-sp);
        }
        h2 {
          margin: 0;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .row-header {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding-bottom: var(--boxel-sp-lg);
        }

        /* code ref container styles */
        .code-ref-container {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .code-ref-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: var(--boxel-form-control-height);
          padding: var(--boxel-sp-xs);
          background-color: var(
            --boxel-spec-code-ref-background-color,
            var(--boxel-100)
          );
          border: var(--boxel-border);
          border-radius: var(--boxel-border-radius);
          color: var(--boxel-spec-code-ref-text-color, var(--boxel-450));
        }
        .code-ref-value {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };
}
