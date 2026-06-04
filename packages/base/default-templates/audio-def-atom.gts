import GlimmerComponent from '@glimmer/component';
import MusicIcon from '@cardstack/boxel-icons/music';
import type { AudioDef } from '../audio-file-def';

export default class AudioDefAtomTemplate extends GlimmerComponent<{
  Args: {
    model: AudioDef;
  };
}> {
  <template>
    <span class='audio-atom'>
      <MusicIcon class='audio-atom__icon' width='16' height='16' />
      <span class='audio-atom__name'>{{@model.name}}</span>
    </span>
    <style scoped>
      .audio-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }

      .audio-atom__icon {
        flex-shrink: 0;
        color: var(--boxel-600);
      }

      .audio-atom__name {
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}
