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
import DateTimeField from 'https://cardstack.com/base/datetime';
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
    <template>{{@model.label}}</template>
  };

  static edit = GameStatusEdit;
}

export class PlayerOutcomeField extends FieldDef {
  @field player = linksTo(() => CardDef);
  @field outcome = contains(GameStatusField);

  static embedded = class Embedded extends Component<
    typeof PlayerOutcomeField
  > {
    get outcomeClass() {
      const label = this.args.model.outcome?.label?.toLowerCase();
      if (label === 'win') return 'outcome--win';
      if (label === 'lose') return 'outcome--lose';
      return 'outcome--draw';
    }

    get playerAvatarURL(): string | null {
      const p = this.args.model.player as any;
      return (
        p?.cardInfo?.cardThumbnail?.url ?? p?.cardInfo?.cardThumbnailURL ?? null
      );
    }

    <template>
      <div class='player-outcome'>
        {{! Player avatar — reads from built-in cardInfo (new API) }}
        {{#if this.playerAvatarURL}}
          <img
            class='player-avatar'
            src={{this.playerAvatarURL}}
            alt={{@model.player.cardTitle}}
          />
        {{else}}
          <div class='player-avatar-placeholder'>
            <span>{{@model.player.cardTitle}}</span>
          </div>
        {{/if}}
        <span class='player-name'>{{@model.player.cardTitle}}</span>
        <span
          class='outcome-badge {{this.outcomeClass}}'
        >{{@model.outcome.label}}</span>
      </div>
      <style scoped>
        .player-outcome {
          /* ── Casino tokens ── */
          --casino-gold: #d4af37;
          --casino-gold-border: rgba(212, 175, 55, 0.2);
          --casino-gold-avatar-border: rgba(212, 175, 55, 0.5);
          --casino-panel: rgba(0, 0, 0, 0.4);
          --casino-felt-start: #1a5c20;
          --casino-felt-end: #0a3d10;
          --casino-font: 'Georgia', 'Times New Roman', serif;
          --casino-lose-text: #ff6b6b;
          --casino-lose-border: rgba(180, 20, 20, 0.5);
          --casino-draw-text: #aaa;
          --casino-draw-border: rgba(150, 150, 150, 0.4);

          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs) var(--boxel-sp);
          background: var(--casino-panel);
          border-radius: var(--boxel-border-radius);
          border: 1px solid var(--casino-gold-border);
          font-family: var(--casino-font);
        }
        .player-avatar {
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 50%;
          object-fit: cover;
          border: 1px solid var(--casino-gold-avatar-border);
          flex-shrink: 0;
        }
        .player-avatar-placeholder {
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 50%;
          background: radial-gradient(
            circle,
            var(--casino-felt-start) 0%,
            var(--casino-felt-end) 100%
          );
          border: 1px solid var(--casino-gold-avatar-border);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          overflow: hidden;
        }
        .player-avatar-placeholder span {
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          color: var(--casino-gold);
          text-transform: uppercase;
          line-height: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 1.25rem;
        }
        .player-name {
          font-weight: 600;
          color: var(--casino-gold);
          font-size: var(--boxel-font-size-sm);
        }
        .outcome-badge {
          margin-left: auto;
          padding: 0.2rem var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-xl);
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-sm);
        }
        .outcome--win {
          background: rgba(212, 175, 55, 0.25);
          color: var(--casino-gold);
          border: 1px solid rgba(212, 175, 55, 0.5);
        }
        .outcome--lose {
          background: rgba(180, 20, 20, 0.3);
          color: var(--casino-lose-text);
          border: 1px solid var(--casino-lose-border);
        }
        .outcome--draw {
          background: rgba(150, 150, 150, 0.2);
          color: var(--casino-draw-text);
          border: 1px solid var(--casino-draw-border);
        }
      </style>
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
          /* ── Casino tokens ── */
          --casino-gold-dim: rgba(212, 175, 55, 0.8);
          --casino-gold-border: rgba(212, 175, 55, 0.2);
          --casino-panel: rgba(0, 0, 0, 0.3);
          --casino-font: 'Georgia', 'Times New Roman', serif;

          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
          background: var(--casino-panel);
          border-radius: var(--boxel-border-radius);
          border: 1px solid var(--casino-gold-border);
          font-family: var(--casino-font);
        }
        .field-group {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .field-group label {
          font-weight: 600;
          font-size: var(--boxel-font-size-xs);
          color: var(--casino-gold-dim);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xs);
        }
      </style>
    </template>
  };
}

// Casino-themed status background — drives the felt colour per outcome
function getStatusStyle(status?: string): string {
  const s = status?.toLowerCase();
  if (s === 'win')
    return 'background: radial-gradient(ellipse at 50% 30%, #1a5c0e 0%, #073d10 60%, #030f05 100%); border-color: #d4af37;';
  if (s === 'lose')
    return 'background: radial-gradient(ellipse at 50% 30%, #5c0e0e 0%, #3d0707 60%, #0f0303 100%); border-color: #b41414;';
  if (s === 'draw')
    return 'background: radial-gradient(ellipse at 50% 30%, #2a2a2a 0%, #1a1a1a 60%, #0a0a0a 100%); border-color: #6b7280;';
  return 'background: radial-gradient(ellipse at 50% 30%, #0e5c1e 0%, #073d10 55%, #030f05 100%); border-color: rgba(212,175,55,0.3);';
}

// Status icon — mirrors blackjack.gts outcome icons
function getStatusIcon(status?: string): string {
  const s = status?.toLowerCase();
  if (s === 'win') return '🏆';
  if (s === 'lose') return '💔';
  if (s === 'draw') return '🤝';
  return '❓';
}

export class GameResult extends CardDef {
  static displayName = 'Game Result';
  static icon = GamepadIcon;

  @field game = linksTo(() => CardDef);
  @field outcome = contains(PlayerOutcomeField);
  @field ref = contains(AbsoluteCodeRefField);
  @field createdAt = contains(DateTimeField, {
    computeVia: function (this: GameResult) {
      let lastModified = getCardMeta(this, 'lastModified');
      return lastModified ? new Date(lastModified * 1000) : undefined;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: GameResult) {
      return this.game.cardTitle ?? 'Untitled Game Result';
    },
  });

  static isolated = class Isolated extends Component<typeof GameResult> {
    get cardStyle() {
      return htmlSafe(getStatusStyle(this.args.model.outcome?.outcome?.label));
    }

    get statusIcon() {
      return getStatusIcon(this.args.model.outcome?.outcome?.label);
    }

    get outcomeLabel() {
      return this.args.model.outcome?.outcome?.label ?? '';
    }

    get outcomeClass() {
      const label = this.outcomeLabel.toLowerCase();
      if (label === 'win') return 'badge--win';
      if (label === 'lose') return 'badge--lose';
      return 'badge--draw';
    }

    get playerAvatarURL(): string | null {
      const p = this.args.model.outcome?.player as any;
      return (
        p?.cardInfo?.cardThumbnail?.url ?? p?.cardInfo?.cardThumbnailURL ?? null
      );
    }

    <template>
      <div class='gr-isolated' style={{this.cardStyle}}>

        {{! Felt micro-texture overlay }}
        <div class='gr-felt-texture' aria-hidden='true'></div>

        <div class='gr-content'>

          {{! Status badge }}
          <div class='gr-status-badge {{this.outcomeClass}}'>
            <span class='gr-status-icon'>{{this.statusIcon}}</span>
            <span class='gr-status-text'>{{this.outcomeLabel}}</span>
          </div>

          {{! Game title section }}
          <div class='gr-title-section'>
            <div class='gr-title-row'>
              <GamepadIcon class='gr-icon' />
              <h1 class='gr-title'>{{@model.game.cardTitle}}</h1>
            </div>
            <div class='gr-player-row'>
              {{#if this.playerAvatarURL}}
                <img
                  class='gr-player-avatar'
                  src={{this.playerAvatarURL}}
                  alt={{@model.outcome.player.cardTitle}}
                />
              {{else}}
                <div class='gr-player-avatar-placeholder'>
                  <span>{{@model.outcome.player.cardTitle}}</span>
                </div>
              {{/if}}
              <span class='gr-player-label'>Player</span>
              <span
                class='gr-player-name'
              >{{@model.outcome.player.cardTitle}}</span>
            </div>
          </div>

          {{! Divider }}
          <div class='gr-divider'>
            <div class='gr-divider-line'></div>
            <div class='gr-divider-text'>♠ GAME RESULT ♠</div>
            <div class='gr-divider-line'></div>
          </div>

          {{! Details }}
          <div class='gr-details'>
            <div class='gr-detail-row'>
              <span class='gr-detail-label'>Game ID</span>
              <span class='gr-detail-value gr-mono'>{{@model.game.id}}</span>
            </div>
            <div class='gr-detail-row'>
              <span class='gr-detail-label'>Player ID</span>
              <span
                class='gr-detail-value gr-mono'
              >{{@model.outcome.player.id}}</span>
            </div>
            <div class='gr-detail-row'>
              <span class='gr-detail-label'>Recorded</span>
              <span class='gr-detail-value'><@fields.createdAt /></span>
            </div>
          </div>

        </div>
      </div>

      <style scoped>
        /* ── Casino design tokens ──────────────────────────────── */
        .gr-isolated {
          --casino-gold: #d4af37;
          --casino-gold-dim: rgba(212, 175, 55, 0.6);
          --casino-gold-border: rgba(212, 175, 55, 0.22);
          --casino-gold-glow: rgba(212, 175, 55, 0.6);
          --casino-panel: rgba(0, 0, 0, 0.42);
          --casino-panel-border: rgba(212, 175, 55, 0.12);
          --casino-text: #ffffff;
          --casino-text-muted: rgba(255, 255, 255, 0.45);
          --casino-font: 'Georgia', 'Times New Roman', serif;
          --casino-mono: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
          --casino-ring-inner: rgba(139, 105, 20, 0.6);
          --casino-ring-outer: rgba(212, 175, 55, 0.1);
          --casino-win-border: rgba(212, 175, 55, 0.6);
          --casino-win-glow: rgba(212, 175, 55, 0.3);
          --casino-lose: #b41414;
          --casino-lose-text: #ff6b6b;
          --casino-lose-border: rgba(180, 20, 20, 0.6);
          --casino-lose-glow: rgba(180, 20, 20, 0.3);
          --casino-draw-border: rgba(150, 150, 150, 0.4);

          /* ── Layout ── */
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--boxel-sp-xl);
          box-sizing: border-box;
          position: relative;
          overflow: hidden;
          font-family: var(--casino-font);
          border: 2px solid;
          box-shadow:
            inset 0 0 0 3px var(--casino-ring-inner),
            inset 0 0 0 5px var(--casino-ring-outer);
          container-type: inline-size;
        }

        /* Felt micro-texture — same repeating pattern as bj-table::after */
        .gr-felt-texture {
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

        .gr-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-lg);
          width: 100%;
          max-width: 560px;
          color: var(--casino-text);
          text-align: center;
        }

        /* ── Status badge ──────────────────────────────────────── */
        .gr-status-badge {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-sm) var(--boxel-sp-xl);
          border-radius: var(--boxel-border-radius-xl);
          border: 1px solid;
          background: var(--casino-panel);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          box-shadow:
            0 4px 20px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }
        .badge--win {
          border-color: var(--casino-win-border);
          box-shadow:
            0 0 20px var(--casino-win-glow),
            inset 0 1px 0 rgba(212, 175, 55, 0.1);
        }
        .badge--lose {
          border-color: var(--casino-lose-border);
          box-shadow:
            0 0 20px var(--casino-lose-glow),
            inset 0 1px 0 rgba(255, 100, 100, 0.05);
        }
        .badge--draw {
          border-color: var(--casino-draw-border);
        }

        .gr-status-icon {
          font-size: var(--boxel-font-size-xl);
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
        }
        .gr-status-text {
          font-size: var(--boxel-font-size-lg);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xl);
          color: var(--casino-gold);
          text-shadow: 0 0 20px var(--casino-gold-glow);
        }
        .badge--lose .gr-status-text {
          color: var(--casino-lose-text);
          text-shadow: 0 0 20px rgba(255, 50, 50, 0.5);
        }
        .badge--draw .gr-status-text {
          color: #aaa;
          text-shadow: none;
        }

        /* ── Title section ─────────────────────────────────────── */
        .gr-title-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-sm);
        }
        .gr-title-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
        }
        .gr-icon {
          width: 3rem;
          height: 3rem;
          color: var(--casino-gold);
          opacity: 0.9;
          filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.4));
        }
        .gr-title {
          margin: 0;
          font-size: clamp(1.75rem, 4cqi, 3rem);
          font-weight: 800;
          color: var(--casino-text);
          text-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
          letter-spacing: -0.02em;
          line-height: 1.1;
        }
        .gr-player-row {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs) var(--boxel-sp-lg) var(--boxel-sp-xs)
            var(--boxel-sp-xs);
          background: var(--casino-panel);
          border: 1px solid var(--casino-gold-border);
          border-radius: var(--boxel-border-radius-xl);
        }
        .gr-player-avatar {
          width: 1.75rem;
          height: 1.75rem;
          border-radius: 50%;
          object-fit: cover;
          border: 1px solid rgba(212, 175, 55, 0.5);
          flex-shrink: 0;
        }
        .gr-player-avatar-placeholder {
          width: 1.75rem;
          height: 1.75rem;
          border-radius: 50%;
          background: radial-gradient(circle, #1a5c20 0%, #0a3d10 100%);
          border: 1px solid rgba(212, 175, 55, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          overflow: hidden;
        }
        .gr-player-avatar-placeholder span {
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          color: var(--casino-gold);
          text-transform: uppercase;
          line-height: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 1.5rem;
        }
        .gr-player-label {
          font-size: var(--boxel-font-size-xs);
          color: var(--casino-text-muted);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-sm);
        }
        .gr-player-name {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          color: var(--casino-gold);
        }

        /* ── Divider — mirrors bj-divider ──────────────────────── */
        .gr-divider {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          width: 100%;
        }
        .gr-divider-line {
          flex: 1;
          height: 1px;
          background: linear-gradient(
            to right,
            transparent,
            var(--casino-gold-dim),
            transparent
          );
        }
        .gr-divider-text {
          font-size: var(--boxel-font-size-xs);
          font-weight: bold;
          letter-spacing: var(--boxel-lsp-xl);
          color: var(--casino-gold-dim);
          white-space: nowrap;
        }

        /* ── Details panel ─────────────────────────────────────── */
        .gr-details {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
          width: 100%;
          max-width: 420px;
        }
        .gr-detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
          background: var(--casino-panel);
          border: 1px solid var(--casino-panel-border);
          border-radius: var(--boxel-border-radius);
          gap: var(--boxel-sp);
        }
        .gr-detail-label {
          font-size: var(--boxel-font-size-xs);
          color: var(--casino-text-muted);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-sm);
          flex-shrink: 0;
        }
        .gr-detail-value {
          font-size: var(--boxel-font-size-sm);
          color: rgba(255, 255, 255, 0.85);
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 60%;
        }
        .gr-mono {
          font-family: var(--casino-mono);
          font-size: var(--boxel-font-size-xs);
          background: rgba(0, 0, 0, 0.3);
          padding: 0.2rem var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-sm);
          border: 1px solid rgba(212, 175, 55, 0.1);
          color: var(--casino-gold-dim);
        }

        /* ── Container query responsive ────────────────────────── */
        @container (max-width: 480px) {
          .gr-isolated {
            padding: var(--boxel-sp-lg);
          }
          .gr-content {
            gap: var(--boxel-sp);
          }
          .gr-status-badge {
            padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
          }
          .gr-status-icon {
            font-size: var(--boxel-font-size-lg);
          }
          .gr-icon {
            width: 2.25rem;
            height: 2.25rem;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof GameResult> {
    get tileStyle() {
      return htmlSafe(getStatusStyle(this.args.model.outcome?.outcome?.label));
    }

    get statusIcon() {
      return getStatusIcon(this.args.model.outcome?.outcome?.label);
    }

    get outcomeLabel() {
      return this.args.model.outcome?.outcome?.label ?? '';
    }

    get outcomeClass() {
      const label = this.outcomeLabel.toLowerCase();
      if (label === 'win') return 'badge--win';
      if (label === 'lose') return 'badge--lose';
      return 'badge--draw';
    }

    <template>
      <div class='gr-tile' style={{this.tileStyle}}>

        <div class='gr-felt-texture' aria-hidden='true'></div>

        {{! Left accent strip }}
        <div class='gr-accent-strip {{this.outcomeClass}}'></div>

        {{! Status section }}
        <div class='gr-status-section'>
          <div class='gr-status-pill {{this.outcomeClass}}'>
            <span class='gr-status-icon'>{{this.statusIcon}}</span>
            <span class='gr-status-text'>{{this.outcomeLabel}}</span>
          </div>
        </div>

        {{! Game info section }}
        <div class='gr-info-section'>
          <div class='gr-info-row'>
            <GamepadIcon class='gr-icon' />
            <span class='gr-game-title'>{{@model.game.cardTitle}}</span>
          </div>
          <div class='gr-meta-row'>
            <span class='gr-meta-label'>Player</span>
            <span class='gr-meta-val'>{{@model.outcome.player.cardTitle}}</span>
          </div>
          <div class='gr-meta-row'>
            <span class='gr-meta-label'>Recorded</span>
            <span class='gr-meta-val'><@fields.createdAt /></span>
          </div>
        </div>

      </div>

      <style scoped>
        /* ── Casino design tokens ──────────────────────────────── */
        .gr-tile {
          --casino-gold: #d4af37;
          --casino-gold-border: rgba(212, 175, 55, 0.2);
          --casino-gold-glow: rgba(212, 175, 55, 0.5);
          --casino-panel: rgba(0, 0, 0, 0.42);
          --casino-panel-border: rgba(212, 175, 55, 0.3);
          --casino-text: #ffffff;
          --casino-text-muted: rgba(255, 255, 255, 0.4);
          --casino-font: 'Georgia', 'Times New Roman', serif;
          --casino-ring-inner: rgba(139, 105, 20, 0.3);
          --casino-lose: #b41414;
          --casino-lose-text: #ff6b6b;
          --casino-lose-border: rgba(180, 20, 20, 0.5);
          --casino-lose-glow: rgba(180, 20, 20, 0.5);
          --casino-draw: #6b7280;
          --casino-draw-border: rgba(150, 150, 150, 0.3);

          /* ── Layout ── */
          width: 100%;
          height: 100%;
          display: flex;
          align-items: stretch;
          color: var(--casino-text);
          font-family: var(--casino-font);
          position: relative;
          overflow: hidden;
          border: 1px solid var(--casino-gold-border);
          box-shadow: inset 0 0 0 2px var(--casino-ring-inner);
          container-type: inline-size;
        }

        /* Felt micro-texture */
        .gr-felt-texture {
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

        /* Left accent strip */
        .gr-accent-strip {
          width: 4px;
          flex-shrink: 0;
          background: var(--casino-gold);
          box-shadow: 0 0 8px var(--casino-gold-glow);
          z-index: 1;
        }
        .gr-accent-strip.badge--lose {
          background: var(--casino-lose);
          box-shadow: 0 0 8px var(--casino-lose-glow);
        }
        .gr-accent-strip.badge--draw {
          background: var(--casino-draw);
          box-shadow: none;
        }

        /* Status section */
        .gr-status-section {
          display: flex;
          align-items: center;
          padding: var(--boxel-sp-sm) var(--boxel-sp);
          flex-shrink: 0;
          z-index: 1;
        }
        .gr-status-pill {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-xl);
          background: var(--casino-panel);
          border: 1px solid var(--casino-panel-border);
        }
        .gr-status-pill.badge--lose {
          border-color: var(--casino-lose-border);
        }
        .gr-status-pill.badge--draw {
          border-color: var(--casino-draw-border);
        }
        .gr-status-icon {
          font-size: var(--boxel-font-size);
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
        }
        .gr-status-text {
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-sm);
          color: var(--casino-gold);
        }
        .badge--lose .gr-status-text {
          color: var(--casino-lose-text);
        }
        .badge--draw .gr-status-text {
          color: #aaa;
        }

        /* Info section */
        .gr-info-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: var(--boxel-sp-xxs);
          padding: var(--boxel-sp-sm) var(--boxel-sp) var(--boxel-sp-sm)
            var(--boxel-sp-xs);
          min-width: 0;
          z-index: 1;
        }
        .gr-info-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .gr-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: var(--casino-gold);
          opacity: 0.85;
          flex-shrink: 0;
        }
        .gr-game-title {
          font-size: var(--boxel-font-size);
          font-weight: 700;
          color: var(--casino-text);
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .gr-meta-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .gr-meta-label {
          font-size: var(--boxel-font-size-xs);
          color: var(--casino-text-muted);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xs);
          flex-shrink: 0;
        }
        .gr-meta-val {
          font-size: var(--boxel-font-size-xs);
          color: rgba(212, 175, 55, 0.8);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Container query responsive */
        @container (max-width: 380px) {
          .gr-status-pill {
            padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
          }
          .gr-status-text {
            display: none;
          }
          .gr-game-title {
            font-size: var(--boxel-font-size-sm);
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
        /* ── Casino design tokens ──────────────────────────────── */
        .container {
          --casino-gold: #d4af37;
          --casino-gold-border: rgba(212, 175, 55, 0.2);
          --casino-gold-dim: rgba(212, 175, 55, 0.15);
          --casino-font: 'Georgia', 'Times New Roman', serif;
          --casino-mono: 'SF Mono', 'Monaco', monospace;
          --casino-bg: #0a1a0c;
          --casino-code-bg: #0d2410;
          --casino-code-text: rgba(212, 175, 55, 0.7);

          height: 100%;
          min-height: max-content;
          padding: var(--boxel-sp);
          background-color: var(--casino-bg);
          color: #fff;
          font-family: var(--casino-font);
        }
        .section {
          margin-top: var(--boxel-sp);
          padding-top: var(--boxel-sp);
          border-top: 1px solid var(--casino-gold-dim);
        }
        .section:first-child {
          border-top: none;
          margin-top: 0;
        }
        h2 {
          margin: 0;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
          color: var(--casino-gold);
        }
        .row-header {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding-bottom: var(--boxel-sp-lg);
          color: var(--casino-gold);
        }
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
          background-color: var(--casino-code-bg);
          border: 1px solid var(--casino-gold-border);
          border-radius: var(--boxel-border-radius);
          color: var(--casino-code-text);
        }
        .code-ref-value {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: var(--casino-mono);
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };
}
