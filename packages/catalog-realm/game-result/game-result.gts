import {
  CardDef,
  contains,
  linksTo,
  field,
  FieldDef,
  Component,
} from 'https://cardstack.com/base/card-api';

import StringField from 'https://cardstack.com/base/string';
import GamepadIcon from '@cardstack/boxel-icons/gamepad-2';
import { RadioInput, FieldContainer } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn, concat } from '@ember/helper';
import { AbsoluteCodeRefField } from 'https://cardstack.com/base/code-ref';
import GitBranch from '@cardstack/boxel-icons/git-branch';

export class GameStatusEdit extends Component<typeof GameStatusField> {
  @tracked label: string | undefined = this.args.model.label;

  // This ensures you get values from the class the instance is created
  get statuses() {
    return (this.args.model.constructor as any).values as GameStatusField[];
  }

  @action onSelectStatus(status: any): void {
    this.label = status.label;
    this.args.model.label = status.label;
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

export class GameResult extends CardDef {
  static displayName = 'Game Result';
  static icon = GamepadIcon;

  @field game = linksTo(() => CardDef);
  @field status = contains(GameStatusField);
  @field ref = contains(AbsoluteCodeRefField);
  @field title = contains(StringField, {
    computeVia: function (this: GameResult) {
      return this.game.title ?? 'Untitled Game Result';
    },
  });

  static isolated = class Isolated extends Component<typeof GameResult> {
    get statusColors() {
      const status = this.args.model.status?.label?.toLowerCase();
      switch (status) {
        case 'win':
          return {
            bg: 'linear-gradient(135deg, #a7f3d0 0%, #6ee7b7 50%, #34d399 100%)',
            border: '#10b981',
            glow: 'rgba(16, 185, 129, 0.3)',
            stars: '#fbbf24',
          };
        case 'lose':
          return {
            bg: 'linear-gradient(135deg, #fecaca 0%, #f87171 50%, #ef4444 100%)',
            border: '#dc2626',
            glow: 'rgba(220, 38, 38, 0.3)',
            stars: '#f59e0b',
          };
        case 'draw':
          return {
            bg: 'linear-gradient(135deg, #fed7aa 0%, #fdba74 50%, #fb923c 100%)',
            border: '#ea580c',
            glow: 'rgba(234, 88, 12, 0.3)',
            stars: '#3b82f6',
          };
        default:
          return {
            bg: 'linear-gradient(135deg, #e5e7eb 0%, #d1d5db 50%, #9ca3af 100%)',
            border: '#6b7280',
            glow: 'rgba(107, 114, 128, 0.3)',
            stars: '#64748b',
          };
      }
    }

    get statusIcon() {
      const status = this.args.model.status?.label?.toLowerCase();
      switch (status) {
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

    get statusTitle() {
      const status = this.args.model.status?.label?.toLowerCase();
      switch (status) {
        case 'win':
          return 'YOU WIN!';
        case 'lose':
          return 'GAME OVER';
        case 'draw':
          return 'TIE GAME';
        default:
          return 'RESULT';
      }
    }

    <template>
      <div class='game-result-panel'>
        <!-- Decorative Stars -->
        <div class='stars-decoration'>
          ⭐ ⭐ ⭐ ⭐ ⭐
        </div>

        <!-- Main Game Panel -->
        <div
          class='game-panel'
          style={{concat
            'background: '
            this.statusColors.bg
            '; border-color: '
            this.statusColors.border
            '; box-shadow: 0 8px 32px '
            this.statusColors.glow
          }}
        >

          <!-- Status Header with Status Badge -->
          <div class='status-header'>
            <div
              class='status-icon'
              style={{concat 'color: ' this.statusColors.stars}}
            >{{this.statusIcon}}</div>
            <div class='status-badge' data-test-status>
              <span class='status-text'>{{@model.status.label}}</span>
            </div>
            <div class='decorative-line'></div>
          </div>

          <!-- Game Info Section -->
          <div class='game-info-section'>
            <div class='game-badge'>
              <GamepadIcon class='game-icon' />
              <div class='game-details'>
                <span class='game-label'>GAME</span>
                <div class='game-name' data-test-game>
                  <@fields.game />
                </div>
              </div>
            </div>
          </div>

          <!-- Code Reference Panel -->
          <div class='code-panel'>
            <div class='panel-header'>
              <GitBranch class='code-icon' />
              <span class='panel-title'>CODE REFERENCE</span>
            </div>
            <div class='code-info'>
              <div class='code-item'>
                <span class='code-label'>MODULE:</span>
                <div
                  class='code-value'
                  data-test-module-href
                >{{this.args.model.ref.module}}</div>
              </div>
              <div class='code-item'>
                <span class='code-label'>NAME:</span>
                <div
                  class='code-value'
                  data-test-exported-name
                >{{this.args.model.ref.name}}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom Stars -->
        <div class='stars-decoration bottom'>
          ⭐ ⭐ ⭐ ⭐ ⭐
        </div>
      </div>

      <style scoped>
        @import url('https://fonts.googleapis.com/css2?family=Fredoka+One:wght@400&family=Nunito:wght@400;600;700;800&display=swap');

        .game-result-panel {
          min-height: 100vh;
          background: #2c3e50;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: 'Nunito', sans-serif;
          position: relative;
          overflow: hidden;
        }

        .game-result-panel::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image:
            /* Racing track lines - matching character-creator */
            linear-gradient(
              90deg,
              transparent 48%,
              rgba(255, 255, 255, 0.1) 49%,
              rgba(255, 255, 255, 0.1) 51%,
              transparent 52%
            ),
            linear-gradient(
              0deg,
              transparent 48%,
              rgba(255, 255, 255, 0.08) 49%,
              rgba(255, 255, 255, 0.08) 51%,
              transparent 52%
            );
          background-size:
            60px 60px,
            60px 60px;
          pointer-events: none;
          z-index: 0;
          animation: trackMove 8s linear infinite;
        }

        @keyframes trackMove {
          0% {
            transform: translateX(0) translateY(0);
          }
          100% {
            transform: translateX(60px) translateY(60px);
          }
        }

        .stars-decoration {
          font-size: 2.5rem;
          animation: coinFloat 3s ease-in-out infinite;
          text-shadow: 0 0 20px rgba(255, 215, 0, 0.8);
        }

        .stars-decoration::before {
          content: '🪙 ';
        }

        .stars-decoration::after {
          content: ' 🪙';
        }

        .stars-decoration.bottom {
          animation-delay: 1.5s;
        }

        .stars-decoration.bottom::before {
          content: '💰 ';
        }

        .stars-decoration.bottom::after {
          content: ' 💰';
        }

        @keyframes coinFloat {
          0%,
          100% {
            transform: translateY(0px) rotate(0deg);
          }
          50% {
            transform: translateY(-10px) rotate(5deg);
          }
        }

        .game-panel {
          background: linear-gradient(
            145deg,
            #f4f1e8 0%,
            #e8dcc6 30%,
            #d4c5a9 60%,
            #c2a878 100%
          );
          border: 8px solid #e6b800;
          border-radius: 32px;
          padding: 3rem 2.5rem;
          max-width: 520px;
          width: 100%;
          box-shadow:
            0 12px 40px rgba(0, 0, 0, 0.25),
            0 0 0 6px rgba(194, 168, 120, 0.6),
            0 0 0 12px #e6b800,
            inset 0 8px 16px rgba(230, 184, 0, 0.2),
            inset 0 -8px 16px rgba(0, 0, 0, 0.1);
          position: relative;
          text-align: center;
        }

        /* Ornate corner decorations */
        .game-panel::before {
          content: '';
          position: absolute;
          top: -12px;
          left: -12px;
          right: -12px;
          bottom: -12px;
          background:
            radial-gradient(circle at 20px 20px, #ffd700 0%, transparent 50%),
            radial-gradient(
              circle at calc(100% - 20px) 20px,
              #ffd700 0%,
              transparent 50%
            ),
            radial-gradient(
              circle at 20px calc(100% - 20px),
              #ffd700 0%,
              transparent 50%
            ),
            radial-gradient(
              circle at calc(100% - 20px) calc(100% - 20px),
              #ffd700 0%,
              transparent 50%
            );
          border-radius: 44px;
          z-index: -1;
          animation: ornateGlow 4s ease-in-out infinite;
        }

        /* Decorative gems in corners */
        .game-panel::after {
          content: '💎 💎 💎 💎';
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 1.5rem;
          color: #00ced1;
          text-shadow: 0 0 20px rgba(0, 206, 209, 0.8);
          animation: gemSparkle 3s ease-in-out infinite;
        }

        @keyframes ornateGlow {
          0%,
          100% {
            opacity: 0.7;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.02);
          }
        }

        @keyframes gemSparkle {
          0%,
          100% {
            transform: translateX(-50%) scale(1);
          }
          50% {
            transform: translateX(-50%) scale(1.1);
          }
        }

        .status-header {
          margin-bottom: 2rem;
        }

        .status-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
          animation: bounce 1s ease-in-out infinite;
          filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
        }

        @keyframes bounce {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }

        .status-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          padding: 0.5rem 1rem;
          background: linear-gradient(
            145deg,
            #fff8dc 0%,
            #fffacd 50%,
            #f0e68c 100%
          );
          border: 6px solid #ffd700;
          border-radius: 25px;
          color: #8b4513;
          font-weight: 800;
          font-size: 2.2rem;
          font-family: 'Fredoka One', cursive;
          text-transform: uppercase;
          letter-spacing: 3px;
          position: relative;
          overflow: hidden;
          box-shadow:
            0 8px 24px rgba(0, 0, 0, 0.3),
            0 0 0 4px #8b4513,
            0 0 0 8px #ffd700,
            inset 0 6px 12px rgba(255, 255, 255, 0.6),
            inset 0 -6px 12px rgba(139, 69, 19, 0.2);
          text-shadow:
            2px 2px 0px #ffd700,
            4px 4px 0px #daa520,
            6px 6px 8px rgba(0, 0, 0, 0.3);
          animation: statusPulse 2s ease-in-out infinite;
        }

        @keyframes statusPulse {
          0%,
          100% {
            transform: scale(1);
            box-shadow:
              0 0 30px rgba(255, 255, 255, 0.8),
              0 0 60px rgba(255, 255, 255, 0.6),
              0 0 90px rgba(255, 255, 255, 0.4),
              inset 0 4px 8px rgba(255, 255, 255, 0.8),
              inset 0 -4px 8px rgba(0, 0, 0, 0.1);
          }
          50% {
            transform: scale(1.05);
            box-shadow:
              0 0 40px rgba(255, 255, 255, 1),
              0 0 80px rgba(255, 255, 255, 0.8),
              0 0 120px rgba(255, 255, 255, 0.6),
              inset 0 6px 12px rgba(255, 255, 255, 1),
              inset 0 -6px 12px rgba(0, 0, 0, 0.2);
          }
        }

        .status-badge::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: linear-gradient(
            45deg,
            transparent 30%,
            rgba(255, 255, 255, 0.8) 50%,
            transparent 70%
          );
          transform: rotate(45deg);
          animation: sweepLight 3s ease-in-out infinite;
        }

        @keyframes sweepLight {
          0% {
            transform: translateX(-100%) translateY(-100%) rotate(45deg);
          }
          50% {
            transform: translateX(0%) translateY(0%) rotate(45deg);
          }
          100% {
            transform: translateX(100%) translateY(100%) rotate(45deg);
          }
        }

        .status-badge::after {
          content: '✨ ⭐ ✨';
          position: absolute;
          top: -20px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 1.2rem;
          color: #fbbf24;
          animation: floatingSparkles 2s ease-in-out infinite;
          text-shadow: 0 0 10px rgba(251, 191, 36, 0.8);
        }

        @keyframes floatingSparkles {
          0%,
          100% {
            transform: translateX(-50%) translateY(0) rotate(0deg);
          }
          50% {
            transform: translateX(-50%) translateY(-5px) rotate(10deg);
          }
        }

        .decorative-line {
          height: 4px;
          background: linear-gradient(90deg, transparent, white, transparent);
          border-radius: 2px;
          margin: 0 auto;
          width: 60%;
        }

        .game-info-section {
          margin-bottom: 2rem;
        }

        .game-badge {
          background: linear-gradient(
            145deg,
            #fefcf3 0%,
            #fef7e0 50%,
            #fed7aa 100%
          );
          border-radius: 20px;
          padding: 2rem;
          display: flex;
          align-items: center;
          gap: 1.5rem;
          box-shadow:
            0 6px 20px rgba(0, 0, 0, 0.2),
            0 0 0 4px #d97706,
            0 0 0 8px #e6b800,
            inset 0 4px 8px rgba(255, 255, 255, 0.5);
          border: 4px solid #e6b800;
          position: relative;
        }

        .game-badge::before {
          content: '⚔️';
          position: absolute;
          top: -10px;
          right: -10px;
          font-size: 2rem;
          background: linear-gradient(45deg, #ffd700, #ffa500);
          border-radius: 50%;
          width: 50px;
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          animation: weaponSpin 3s ease-in-out infinite;
        }

        @keyframes weaponSpin {
          0%,
          100% {
            transform: rotate(0deg) scale(1);
          }
          50% {
            transform: rotate(10deg) scale(1.1);
          }
        }

        .game-icon {
          width: 2.5rem;
          height: 2.5rem;
          color: #4f46e5;
        }

        .game-details {
          flex: 1;
          text-align: left;
        }

        .game-label {
          font-size: 0.875rem;
          font-weight: 700;
          color: #6b7280;
          letter-spacing: 1px;
        }

        .game-name {
          font-size: 1.25rem;
          font-weight: 800;
          color: #1f2937;
          margin-top: 0.25rem;
        }

        .code-panel {
          background: linear-gradient(
            145deg,
            #fefcf3 0%,
            #fef7e0 50%,
            #fed7aa 100%
          );
          border-radius: 20px;
          padding: 2rem;
          margin-bottom: 2rem;
          border: 4px solid #e6b800;
          text-align: left;
          box-shadow:
            0 6px 20px rgba(0, 0, 0, 0.2),
            0 0 0 4px #d97706,
            inset 0 4px 8px rgba(255, 255, 255, 0.4),
            inset 0 -4px 8px rgba(217, 119, 6, 0.15);
          position: relative;
        }

        .code-panel::before {
          content: '📜';
          position: absolute;
          top: -12px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 2rem;
          background: linear-gradient(45deg, #ffd700, #ffa500);
          border-radius: 50%;
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .panel-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
          border-bottom: 2px solid #e5e7eb;
        }

        .code-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: #4f46e5;
        }

        .panel-title {
          font-size: 0.875rem;
          font-weight: 700;
          color: #1f2937;
          letter-spacing: 1px;
        }

        .code-item {
          margin-bottom: 1rem;
        }

        .code-item:last-child {
          margin-bottom: 0;
        }

        .code-label {
          font-size: 0.75rem;
          font-weight: 700;
          color: #6b7280;
          letter-spacing: 1px;
          display: block;
          margin-bottom: 0.25rem;
        }

        .code-value {
          font-family: 'SF Mono', 'Monaco', monospace;
          font-size: 0.875rem;
          color: #1f2937;
          background: #f3f4f6;
          padding: 0.5rem;
          border-radius: 6px;
          word-break: break-all;
          border: 1px solid #d1d5db;
        }

        /* Responsive design */
        @media (max-width: 640px) {
          .game-result-panel {
            padding: 1rem;
          }

          .game-panel {
            padding: 1.5rem;
          }

          .status-title {
            font-size: 2rem;
          }

          .action-buttons {
            flex-direction: column;
          }

          .stats-section {
            flex-direction: column;
            gap: 1rem;
            text-align: center;
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

        <section class='status section'>
          <header class='row-header' aria-labelledby='status'>
            <GamepadIcon width='20' height='20' role='presentation' />
            <h2 id='status'>Status</h2>
          </header>
          <div data-test-status>
            <@fields.status />
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
                  {{this.args.model.ref.module}}
                </span>
              </div>
            </FieldContainer>
            <FieldContainer @label='Module Name' @vertical={{true}}>
              <div class='code-ref-row'>
                <div class='code-ref-value' data-test-exported-name>
                  {{this.args.model.ref.name}}
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
