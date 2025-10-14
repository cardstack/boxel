import {
  CardDef,
  field,
  contains,
  StringField,
  Component,
} from 'https://cardstack.com/base/card-api';
import AvatarField from '../fields/avatar';

export class Player extends CardDef {
  static displayName = 'Player';
  @field avatar = contains(AvatarField, {
    description: 'Avatar for the player',
  });
  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: Player) {
      return this.avatar?.thumbnailURL;
    },
  });

  static embedded = class Embedded extends Component<typeof Player> {
    get avatarAlt() {
      return this.args.model.title || 'Player avatar';
    }

    get avatarFallback() {
      return this.args.model.title || 'Player';
    }

    get playerName() {
      return this.args.model.title || 'Unknown Player';
    }

    <template>
      <div class='player-embedded-card'>
        <div class='player-embedded-card__avatar'>
          {{#if @model.thumbnailURL}}
            <img src={{@model.thumbnailURL}} alt={{this.avatarAlt}} />
          {{else}}
            <span class='player-embedded-card__avatar-fallback'>
              {{this.avatarFallback}}
            </span>
          {{/if}}
        </div>
        <div class='player-embedded-card__info'>
          <span class='player-embedded-card__name'>
            {{this.playerName}}
          </span>
        </div>
      </div>
      <style scoped>
        .player-embedded-card {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }

        .player-embedded-card__avatar {
          position: relative;
          width: 48px;
          height: 48px;
          flex-shrink: 0;
          border-radius: 50%;
          padding: 2px;
          background: linear-gradient(
            135deg,
            rgba(0, 255, 255, 0.6),
            rgba(98, 0, 255, 0.6)
          );
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .player-embedded-card__avatar img {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
        }

        .player-embedded-card__avatar-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: rgba(8, 12, 24, 0.8);
          color: #00ffff;
          font: 600 var(--boxel-font-xxs);
          text-align: center;
          padding: var(--boxel-sp-4xs);
        }

        .player-embedded-card__info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .player-embedded-card__name {
          font: 700 var(--boxel-font-sm);
          color: #ffffff;
          letter-spacing: var(--boxel-lsp-xxs);
          text-shadow: 0 0 6px rgba(0, 255, 255, 0.35);
        }
      </style>
    </template>
  };
}
