import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motionSpeed, setMotionSpeed } from 'glimmer-motion';

const RATES = [1, 2, 5, 10] as const;

function label(rate: number) {
  return rate === 1 ? 'Full' : `÷${rate}`;
}

/**
 * Slow motion for the stage. Every transition started from here on is scaled,
 * so a sequence's phases separate out — the fade, then the move, then the
 * fade — instead of going by in four frames.
 */
export class SpeedPicker extends Component {
  @tracked rate = motionSpeed();

  isOn = (rate: number) => rate === this.rate;

  pick = (rate: number) => {
    this.rate = rate;
    setMotionSpeed(rate);
  };

  <template>
    <div class='speeds'>
      <span class='speeds-label'>Speed</span>
      <div class='speeds-track' role='group' aria-label='Playback speed'>
        {{#each RATES as |rate|}}
          <button
            type='button'
            class={{if (this.isOn rate) 'speed is-on' 'speed'}}
            aria-pressed={{if (this.isOn rate) 'true' 'false'}}
            {{on 'click' (fn this.pick rate)}}
          >{{label rate}}</button>
        {{/each}}
      </div>
    </div>
    <style scoped>
      .speeds {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 12px;
      }

      .speeds-label {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .speeds-track {
        display: inline-flex;
        padding: 2px;
        gap: 2px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(var(--bg-rgb), 0.5);
      }

      .speed {
        border: 0;
        background: transparent;
        border-radius: 999px;
        padding: 4px 12px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.08em;
        color: var(--ink-faint);
        cursor: pointer;
        transition:
          color 0.16s var(--ease),
          background-color 0.16s var(--ease);
      }

      @media (hover: hover) {
        .speed:hover {
          color: var(--ink-dim);
        }
      }

      .speed.is-on {
        background: rgba(var(--ink-rgb), 0.08);
        color: var(--ink);
      }
    </style>
  </template>
}
