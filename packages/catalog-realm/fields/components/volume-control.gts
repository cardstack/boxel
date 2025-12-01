import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { or, eq } from '@cardstack/boxel-ui/helpers';
import { IconButton } from '@cardstack/boxel-ui/components';
import Volume2Icon from '@cardstack/boxel-icons/volume-2';
import VolumeXIcon from '@cardstack/boxel-icons/volume-x';

interface VolumeControlSignature {
  Element: HTMLDivElement;
  Args: {
    volume: number; // Current volume (0-1)
    isMuted: boolean; // Mute state
    onVolumeChange: (event: Event) => void; // Volume change callback
    onToggleMute: () => void; // Mute toggle callback
  };
}

export class VolumeControl extends GlimmerComponent<VolumeControlSignature> {
  <template>
    <div class='volume-control' data-test-volume-control>
      <IconButton
        @icon={{if (or @isMuted (eq @volume 0)) VolumeXIcon Volume2Icon}}
        @width='20px'
        @height='20px'
        class='volume-button'
        {{on 'click' @onToggleMute}}
        aria-label={{if @isMuted 'Unmute' 'Mute'}}
      />
      <input
        type='range'
        min='0'
        max='1'
        step='0.01'
        value={{@volume}}
        {{on 'input' @onVolumeChange}}
        class='volume-slider'
        aria-label='Volume control'
      />
    </div>

    <style scoped>
      .volume-control {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding-top: 0.5rem;
        border-top: 1px solid var(--border, #e5e7eb);
      }

      .volume-button {
        width: 2rem;
        height: 2rem;
        border-radius: 0.25rem;
        flex-shrink: 0;
      }

      .volume-slider {
        flex: 1;
        height: 0.25rem;
        background: var(--muted, #e5e7eb);
        border-radius: 0.125rem;
        appearance: none;
        cursor: pointer;
      }

      .volume-slider::-webkit-slider-thumb {
        appearance: none;
        width: 0.75rem;
        height: 0.75rem;
        background: var(--primary, #3b82f6);
        border-radius: 50%;
        cursor: pointer;
      }

      .volume-slider::-moz-range-thumb {
        width: 0.75rem;
        height: 0.75rem;
        background: var(--primary, #3b82f6);
        border-radius: 50%;
        cursor: pointer;
        border: none;
      }
    </style>
  </template>
}
