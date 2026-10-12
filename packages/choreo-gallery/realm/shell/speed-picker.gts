import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motionSpeed, setMotionSpeed } from 'glimmer-motion';

const RATES = [1, 2, 5, 10] as const;

function label(rate: number) {
  return rate === 1 ? 'Full' : `÷${rate}`;
}

interface Signature {
  Args: {
    /** the demo the speed applies to; a choice made on one demo ends with it */
    slug: string;
  };
}

/**
 * Slow motion for the stage. Every transition started from here on is scaled,
 * so a sequence's phases separate out — the fade, then the move, then the
 * fade — instead of going by in four frames.
 *
 * The clock is glimmer-motion's, and global to everything the host animates,
 * so a speed picked here lasts only while this picker is on screen.
 */
export class SpeedPicker extends Component<Signature> {
  @tracked private picked: { rate: number; slug: string } | null = null;

  /**
   * The rate picked for this demo. Moving to another demo resets the clock,
   * and the same picker can stay on screen across that move, so a choice made
   * for an earlier demo is not this one's.
   */
  get rate() {
    return this.picked?.slug === this.args.slug
      ? this.picked.rate
      : motionSpeed();
  }

  isOn = (rate: number) => rate === this.rate;

  pick = (rate: number) => {
    this.picked = { rate, slug: this.args.slug };
    setMotionSpeed(rate);
  };

  willDestroy() {
    super.willDestroy();
    if (this.picked) {
      setMotionSpeed(1);
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
