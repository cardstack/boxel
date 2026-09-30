import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motionSpeed, setMotionSpeed } from 'glimmer-motion';

const RATES = [1, 2, 5, 10] as const;

/**
 * Slow motion for the stage. Every transition started from here on is scaled,
 * so a sequence's phases separate out — the fade, then the move, then the
 * fade — instead of going by in four frames.
 */
export class SpeedPicker extends Component {
  @tracked rate = motionSpeed();

  pick = (rate: number) => {
    this.rate = rate;
    setMotionSpeed(rate);
  };

  <template>
    <div class="speeds">
      <span class="speeds-label">Speed</span>
      <div class="speeds-track" role="group" aria-label="Playback speed">
        {{#each RATES as |rate|}}
          <button
            type="button"
            class={{if (eq rate this.rate) "speed is-on" "speed"}}
            aria-pressed="{{eq rate this.rate}}"
            {{on "click" (fn this.pick rate)}}
          >{{label rate}}</button>
        {{/each}}
      </div>
    </div>
  </template>
}

function eq(a: number, b: number) {
  return a === b;
}
function label(rate: number) {
  return rate === 1 ? 'Full' : `÷${rate}`;
}
