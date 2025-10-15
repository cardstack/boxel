import { CardDef } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';

interface PlayerPreviewSignature {
  Args: {
    player: CardDef;
    wins: number;
    losses: number;
    draws: number;
    totalGames: number;
    rank: number;
  };
  Element: HTMLElement;
}

export default class PlayerPreview extends GlimmerComponent<PlayerPreviewSignature> {
  private getComponent = (card: CardDef) => card.constructor.getComponent(card);

  private get winRate() {
    if (!this.args.totalGames) {
      return 0;
    }
    return Math.round((this.args.wins / this.args.totalGames) * 100);
  }

  get rankString() {
    return String(this.args.rank ?? '');
  }

  <template>
    <div
      class='player-preview player-preview--rank-{{@rank}}'
      data-rank={{this.rankString}}
    >
      <div class='player-preview__rank'>
        <span class='player-preview__rank-label'>Rank</span>
        <span class='player-preview__rank-value'>#{{@rank}}</span>
      </div>
      <div class='player-preview__player'>
        {{#let (this.getComponent @player) as |PlayerComponent|}}
          <PlayerComponent @format='embedded' />
        {{/let}}
      </div>
      <div class='player-preview__stats'>
        <span class='player-preview__stat'>
          <span class='player-preview__stat-label'>Wins</span>
          <span class='player-preview__stat-value'>{{@wins}}</span>
        </span>
        <span class='player-preview__stat'>
          <span class='player-preview__stat-label'>Games</span>
          <span class='player-preview__stat-value'>{{@totalGames}}</span>
        </span>
        <span class='player-preview__stat'>
          <span class='player-preview__stat-label'>Win Rate</span>
          <span class='player-preview__stat-value'>{{this.winRate}}%</span>
        </span>
      </div>
    </div>

    <style scoped>
      .player-preview {
        --border: none;
        --background: transparent;
        position: relative;
        display: grid;
        grid-template-columns: minmax(90px, 110px) minmax(220px, 1fr) minmax(
            210px,
            240px
          );
        align-items: center;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
        border-radius: 24px;
        background: linear-gradient(
          120deg,
          rgba(0, 255, 255, 0.35),
          rgba(20, 40, 120, 0.5) 50%,
          rgba(8, 12, 32, 0.9)
        );
        border: 1px solid rgba(0, 200, 255, 0.45);
        box-shadow:
          0 10px 25px rgba(0, 0, 0, 0.35),
          inset 0 1px 0 rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(14px);
        overflow: hidden;
      }
      .player-preview::before {
        content: '';
        position: absolute;
        inset: 0;
        background: radial-gradient(
          circle at 80% 50%,
          rgba(0, 255, 255, 0.3),
          transparent 60%
        );
        opacity: 0.35;
        pointer-events: none;
      }
      .player-preview__rank {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 4px;
      }
      .player-preview__rank-label {
        font: 600 var(--boxel-font-xxs);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xxs);
        color: rgba(255, 255, 255, 0.65);
      }
      .player-preview__rank-value {
        font: 700 clamp(1.4rem, 1.1rem + 1vw, 2.1rem);
        letter-spacing: var(--boxel-lsp-xs);
        color: #ffffff;
        text-shadow:
          0 0 12px rgba(0, 255, 255, 0.65),
          0 0 28px rgba(0, 255, 255, 0.35);
      }
      .player-preview__player {
        position: relative;
        z-index: 1;
      }
      .player-preview__stats {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: repeat(3, minmax(70px, 1fr));
        gap: var(--boxel-sp-md);
        justify-items: end;
      }
      .player-preview__stat {
        display: grid;
        gap: 4px;
        font: var(--boxel-font-xs);
        text-align: right;
      }
      .player-preview__stat-label {
        color: rgba(255, 255, 255, 0.7);
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xxs);
      }
      .player-preview__stat-value {
        font: 700 var(--boxel-font-sm);
        color: #ffffff;
        text-shadow: 0 0 8px rgba(0, 255, 255, 0.3);
      }

      /* Rank-specific styling for top 3 players */
      .player-preview--rank-1 {
        background: linear-gradient(
          120deg,
          rgba(255, 215, 0, 0.4),
          rgba(255, 193, 7, 0.3) 50%,
          rgba(184, 134, 11, 0.2)
        );
        border: 2px solid rgba(255, 215, 0, 0.6);
        box-shadow:
          0 15px 35px rgba(255, 215, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
      }
      .player-preview--rank-1::before {
        background: radial-gradient(
          circle at 80% 50%,
          rgba(255, 215, 0, 0.4),
          transparent 60%
        );
        opacity: 0.5;
      }
      .player-preview--rank-1 .player-preview__rank-value {
        color: #ffd700;
        text-shadow:
          0 0 15px rgba(255, 215, 0, 0.8),
          0 0 30px rgba(255, 215, 0, 0.4);
      }

      .player-preview--rank-2 {
        background: linear-gradient(
          120deg,
          rgba(192, 192, 192, 0.4),
          rgba(169, 169, 169, 0.3) 50%,
          rgba(128, 128, 128, 0.2)
        );
        border: 2px solid rgba(192, 192, 192, 0.6);
        box-shadow:
          0 15px 35px rgba(192, 192, 192, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
      }
      .player-preview--rank-2::before {
        background: radial-gradient(
          circle at 80% 50%,
          rgba(192, 192, 192, 0.4),
          transparent 60%
        );
        opacity: 0.5;
      }
      .player-preview--rank-2 .player-preview__rank-value {
        color: #c0c0c0;
        text-shadow:
          0 0 15px rgba(192, 192, 192, 0.8),
          0 0 30px rgba(192, 192, 192, 0.4);
      }

      .player-preview--rank-3 {
        background: linear-gradient(
          120deg,
          rgba(205, 127, 50, 0.4),
          rgba(184, 115, 51, 0.3) 50%,
          rgba(160, 82, 45, 0.2)
        );
        border: 2px solid rgba(205, 127, 50, 0.6);
        box-shadow:
          0 15px 35px rgba(205, 127, 50, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
      }
      .player-preview--rank-3::before {
        background: radial-gradient(
          circle at 80% 50%,
          rgba(205, 127, 50, 0.4),
          transparent 60%
        );
        opacity: 0.5;
      }
      .player-preview--rank-3 .player-preview__rank-value {
        color: #cd7f32;
        text-shadow:
          0 0 15px rgba(205, 127, 50, 0.8),
          0 0 30px rgba(205, 127, 50, 0.4);
      }
    </style>
  </template>
}
