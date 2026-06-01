import GlimmerComponent from '@glimmer/component';
import MusicIcon from '@cardstack/boxel-icons/music';
import type { AudioDef } from '../audio-file-def';

export default class AudioDefEmbeddedTemplate extends GlimmerComponent<{
  Args: {
    model: AudioDef;
  };
}> {
  <template>
    <div class='audio-embedded'>
      <div class='audio-embedded__header'>
        <MusicIcon class='audio-embedded__icon' width='20' height='20' />
        <span class='audio-embedded__name'>{{@model.name}}</span>
      </div>
      {{#if @model.url}}
        <audio
          class='audio-embedded__player'
          src={{@model.url}}
          controls
          preload='metadata'
        >
          <track kind='captions' />
        </audio>
      {{/if}}
    </div>
    <style scoped>
      .audio-embedded {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
        width: 100%;
      }

      .audio-embedded__header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }

      .audio-embedded__icon {
        color: var(--boxel-600);
        flex-shrink: 0;
      }

      .audio-embedded__name {
        font-weight: 600;
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }

      .audio-embedded__player {
        width: 100%;
      }
    </style>
  </template>
}
