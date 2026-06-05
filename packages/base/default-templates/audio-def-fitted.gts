import GlimmerComponent from '@glimmer/component';
import MusicIcon from '@cardstack/boxel-icons/music';
import type { AudioDef } from '../audio-file-def';

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !isFinite(seconds) || seconds <= 0) return '';
  let mins = Math.floor(seconds / 60);
  let secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default class AudioDefFittedTemplate extends GlimmerComponent<{
  Args: {
    model: AudioDef;
  };
}> {
  get formattedDuration() {
    return formatDuration(this.args.model?.duration);
  }
  <template>
    <article class='audio-fitted'>
      <div class='audio-fitted__icon'>
        <MusicIcon width='100%' height='100%' />
      </div>
      <div class='audio-fitted__text'>
        <header class='audio-fitted__name'>{{@model.name}}</header>
        {{#if this.formattedDuration}}
          <p class='audio-fitted__duration'>{{this.formattedDuration}}</p>
        {{/if}}
      </div>
    </article>
    <style scoped>
      .audio-fitted {
        container-name: fitted-card;
        container-type: size;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        overflow: hidden;
      }

      .audio-fitted__icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        color: var(--boxel-600);
      }

      .audio-fitted__text {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }

      .audio-fitted__name {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .audio-fitted__duration {
        color: var(--boxel-600);
        font-size: var(--boxel-font-xs);
        margin: 0;
      }

      /* Portrait tall: icon above text */
      @container fitted-card (aspect-ratio <= 1.0) and (height >= 120px) {
        .audio-fitted {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .audio-fitted__icon {
          width: 28px;
          height: 28px;
        }

        .audio-fitted__name {
          -webkit-line-clamp: 3;
        }
      }

      /* Portrait short: hide duration */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 120px) {
        .audio-fitted__duration {
          display: none;
        }
      }

      /* Portrait very short: hide icon too */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 80px) {
        .audio-fitted__icon {
          display: none;
        }
      }

      /* Landscape short: center-align, hide duration */
      @container fitted-card (1.0 < aspect-ratio) and (height <= 80px) {
        .audio-fitted {
          align-items: center;
        }

        .audio-fitted__duration {
          display: none;
        }
      }

      /* Very small: name only, smaller font */
      @container fitted-card (height <= 57px) {
        .audio-fitted__icon {
          display: none;
        }

        .audio-fitted__duration {
          display: none;
        }

        .audio-fitted__name {
          font-size: var(--boxel-font-xs);
          -webkit-line-clamp: 1;
        }
      }
    </style>
  </template>
}
