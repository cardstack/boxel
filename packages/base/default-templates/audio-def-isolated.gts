import GlimmerComponent from '@glimmer/component';
import MusicIcon from '@cardstack/boxel-icons/music';
import type { AudioDef } from '../audio-file-def';

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !isFinite(seconds) || seconds <= 0) return '';
  let mins = Math.floor(seconds / 60);
  let secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default class AudioDefIsolatedTemplate extends GlimmerComponent<{
  Args: {
    model: AudioDef;
  };
}> {
  get formattedDuration() {
    return formatDuration(this.args.model?.duration);
  }
  <template>
    <div class='audio-isolated'>
      <header class='audio-isolated__header'>
        <MusicIcon class='audio-isolated__icon' width='32' height='32' />
        <div class='audio-isolated__meta'>
          <div class='audio-isolated__name'>{{@model.name}}</div>
          {{#if this.formattedDuration}}
            <div
              class='audio-isolated__duration'
            >{{this.formattedDuration}}</div>
          {{/if}}
        </div>
      </header>
      {{#if @model.url}}
        <audio
          class='audio-isolated__player'
          src={{@model.url}}
          controls
          preload='metadata'
        >
          <track kind='captions' />
        </audio>
      {{else}}
        <p class='audio-isolated__empty'>No audio source</p>
      {{/if}}
    </div>
    <style scoped>
      .audio-isolated {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }

      .audio-isolated__header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
      }

      .audio-isolated__icon {
        color: var(--boxel-600);
        flex-shrink: 0;
      }

      .audio-isolated__meta {
        min-width: 0;
        flex: 1;
      }

      .audio-isolated__name {
        font-weight: 600;
        color: var(--boxel-900);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .audio-isolated__duration {
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
      }

      .audio-isolated__player {
        width: 100%;
      }

      .audio-isolated__empty {
        color: var(--boxel-600);
        margin: 0;
      }
    </style>
  </template>
}
