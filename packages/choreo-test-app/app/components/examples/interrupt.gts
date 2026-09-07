import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion, spring } from 'glimmer-motion';
import { tuneSeconds, tuneSpring } from 'test-app/lib/demo-tuning';

const stations = [0, 1, 2, 3];

/**
 * Loose on purpose. A stiff spring arrives before you can interrupt it, and
 * the whole demonstration is what happens to something still moving.
 */
const carry = spring({ damping: 15, stiffness: 130 });
/** the same journey, timed instead of simulated */
const TIMED = 0.62;

/**
 * Interruption — the thing the engine does best, and the hardest to see.
 *
 * Every animation here is interruptible, but you only ever notice it by
 * changing your mind halfway. So: two pucks on two rails, driven by the same
 * clicks, differing only in what carries them.
 *
 * The top one is a spring. Retarget it mid-flight and the run that is being
 * replaced hands over how fast everything was going, so the new spring is born
 * already travelling — it bends toward the new station and, if you send it
 * back the way it came, overshoots before it turns. That is momentum, and it
 * is not scripted anywhere.
 *
 * The bottom one is a tween. A tween has a start, an end and a curve between
 * them, and interrupting it can only mean starting a new curve from wherever
 * it happens to be — so it stops dead and eases away again. Nothing is broken;
 * it is what a duration means.
 *
 * Click two stations in quick succession, and click back the way you came. At
 * ÷5 the difference is the whole demo.
 */
export class Interrupt extends Component {
  @tracked at = 0;

  go = (station: number) => {
    this.at = station;
  };

  isAt = (station: number) => station === this.at;

  <template>
    <div class="ex">
      <div class="rails">
        {{! A puck is not positioned — it is RENDERED into one slot or another,
            and the region works out that the same id is somewhere new. That is
            the same counterpart matching two lists use; here it is what gives
            the Move a from and a to. }}
        <div class="rail-row">
          <Choreo @id="spring" class="rail" as |c|>
            {{! the track, not the region, is the grid: a <Choreo> root also holds
                its orphan layer and the timeline's marker elements, and they
                would take slots of their own }}
            <div class="rail-track">
              {{#each stations as |station|}}
                <button
                  type="button"
                  class="slot"
                  {{on "click" (fn this.go station)}}
                >
                  {{#if (this.isAt station)}}
                    <span
                      class="puck is-spring"
                      {{motion id="puck" role="puck"}}
                    ></span>
                  {{/if}}
                </button>
              {{/each}}
            </div>
            {{! @swap="none": this demo carries ONE skin. The default 'during'
                crossfades the pair, and two identical pucks at complementary
                opacities never sum back to solid — the flight visibly dims. }}
            <c.Move
              @of={{c.kept "puck"}}
              @spring={{tuneSpring "interrupt" carry "carry"}}
              @size={{false}}
              @swap="none"
            />
            {{! the old copy goes at once — its counterpart is already in the
                air. Naming it here is also what tells the region the sprite
                belongs to this run, so it is released when the run ends. }}
            <c.Hold @of={{c.removed "puck"}} @opacity={{0}} />
          </Choreo>
          <span class="rail-name">spring<em>keeps its speed</em></span>
        </div>

        <div class="rail-row">
          <Choreo @id="tween" class="rail" as |c|>
            <div class="rail-track">
              {{#each stations as |station|}}
                <button
                  type="button"
                  class="slot"
                  {{on "click" (fn this.go station)}}
                >
                  {{#if (this.isAt station)}}
                    <span
                      class="puck is-tween"
                      {{motion id="puck" role="puck"}}
                    ></span>
                  {{/if}}
                </button>
              {{/each}}
            </div>
            <c.Move
              @of={{c.kept "puck"}}
              @duration={{tuneSeconds "interrupt" TIMED "TIMED duration"}}
              @ease="easeInOut"
              @size={{false}}
              @swap="none"
            />
            <c.Hold @of={{c.removed "puck"}} @opacity={{0}} />
          </Choreo>
          <span class="rail-name">tween<em>starts over</em></span>
        </div>
      </div>

    </div>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSpring('interrupt', carry, 'carry');
tuneSeconds('interrupt', TIMED, 'TIMED duration');
