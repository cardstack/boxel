import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setMotionSpeed } from 'glimmer-motion';

import { radioKeys } from '../lib/focus';

const RATES = [1, 2, 5, 10] as const;

function label(rate: number) {
  return rate === 1 ? 'Full' : `÷${rate}`;
}

/** each rate's name in words, which a screen reader says in place of ÷ */
const SPOKEN: Record<(typeof RATES)[number], string> = {
  1: 'Full speed',
  2: 'Half speed',
  5: 'One fifth speed',
  10: 'One tenth speed',
};

function spoken(rate: (typeof RATES)[number]) {
  return SPOKEN[rate];
}

/**
 * The clock's rate, and which picker set it. Only a speed picker sets
 * glimmer-motion's speed, so the rate here is the clock's.
 */
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
 * A demo page is opening: the clock goes back to full speed, so a demo never
 * starts slowed by a speed picked on another page — including a demo with no
 * speed picker to put it back. Every demo page calls this as it constructs.
 */
export function startPage(): void {
  if (!clock.owner) {
    return;
  }
  setMotionSpeed(1);
  // the render that mounts the page may already have read the picker's
  // state, so that state changes once the render is done
  queueMicrotask(() => {
    if (clock.owner) {
      release();
    }
  });
}

/**
 * Slow motion for the stage. Every transition started from here on is scaled,
 * so a sequence's phases separate out — the fade, then the move, then the
 * fade — instead of going by in four frames.
 *
 * The clock is glimmer-motion's, and global to everything the host animates,
 * so a speed belongs to the demo page it was picked on: another demo page
 * opening starts the clock at full speed again, and so does the page that
 * picked it closing. Every picker on screen shows the clock as it runs.
 */
export class SpeedPicker extends Component {
  get rate() {
    return clock.rate;
  }

  isOn = (rate: number) => rate === this.rate;

  pick = (rate: number) => {
    clock.owner = this;
    clock.rate = rate;
    setMotionSpeed(rate);
  };

  pickAt = (index: number) => {
    let rate = RATES[index];
    if (rate !== undefined) {
      this.pick(rate);
    }
  };

  willDestroy() {
    super.willDestroy();
    if (clock.owner === this) {
      release();
    }
  }

  <template>
    <div class='speeds'>
      <span class='speeds-label' aria-hidden='true'>Speed</span>
      <div
        class='speeds-track'
        role='radiogroup'
        aria-label='Playback speed'
        {{radioKeys this.pickAt}}
      >
        {{#each RATES as |rate|}}
          <button
            type='button'
            class={{if (this.isOn rate) 'speed is-on' 'speed'}}
            role='radio'
            aria-checked={{if (this.isOn rate) 'true' 'false'}}
            aria-label={{spoken rate}}
            tabindex={{if (this.isOn rate) '0' '-1'}}
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
        color: var(--subtle-foreground);
      }

      .speeds-track {
        display: inline-flex;
        padding: 2px;
        gap: 2px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: color-mix(in srgb, var(--canvas) 50%, transparent);
      }

      .speed {
        border: 0;
        background: transparent;
        border-radius: 999px;
        padding: 4px 12px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.08em;
        color: var(--subtle-foreground);
        cursor: pointer;
        transition:
          color 0.16s var(--ease),
          background-color 0.16s var(--ease);
      }

      @media (hover: hover) {
        .speed:hover {
          color: var(--muted-foreground);
        }
      }

      .speed.is-on {
        background: color-mix(in srgb, var(--foreground) 8%, transparent);
        color: var(--foreground);
      }
    </style>
  </template>
}
