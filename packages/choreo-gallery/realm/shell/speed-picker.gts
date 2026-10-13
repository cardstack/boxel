import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setMotionSpeed } from 'glimmer-motion';

const RATES = [1, 2, 5, 10] as const;

function label(rate: number) {
  return rate === 1 ? 'Full' : `÷${rate}`;
}

/** which picker set the clock, and to what */
class Clock {
  @tracked owner: SpeedPicker | null = null;
  @tracked rate = 1;
}

const clock = new Clock();

function release() {
  clock.owner = null;
  clock.rate = 1;
  setMotionSpeed(1);
}

/**
 * Slow motion for the stage. Every transition started from here on is scaled,
 * so a sequence's phases separate out — the fade, then the move, then the
 * fade — instead of going by in four frames.
 *
 * The clock is glimmer-motion's, and global to everything the host animates,
 * so a speed belongs to the demo page it was picked on: another demo page
 * opening starts the clock at full speed again, and so does the page that
 * picked it closing.
 */
export class SpeedPicker extends Component {
  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    if (clock.owner) {
      setMotionSpeed(1);
      // the render that mounts this picker may already have read the other
      // picker's state, so that state changes once the render is done
      queueMicrotask(() => {
        if (clock.owner && clock.owner !== this) {
          release();
        }
      });
    }
  }

  get rate() {
    return clock.owner === this ? clock.rate : 1;
  }

  isOn = (rate: number) => rate === this.rate;

  pick = (rate: number) => {
    clock.owner = this;
    clock.rate = rate;
    setMotionSpeed(rate);
  };

  willDestroy() {
    super.willDestroy();
    if (clock.owner === this) {
      release();
    }
  }

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
