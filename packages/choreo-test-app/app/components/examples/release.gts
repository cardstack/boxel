import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion } from 'glimmer-motion';
import { preventSelect } from 'test-app/lib/pointer';

/**
 * Where a drag ends is not a place the layout knows about.
 *
 * Let go of the chip and it is removed from wherever it was and inserted
 * into the bay under the pointer — two elements, one id, so the arrival
 * claims the leaver and Choreo has both boxes. That much is ordinary
 * counterpart matching. What `c.gesture` adds is the part no measurement
 * can supply: the pointer's own VELOCITY. Borrowed as `@from`, the flight
 * starts centred on the finger, moving at the speed the finger was moving —
 * so a toss carries, and a careful placement does not.
 *
 * Turn the borrow off and the flight is measured instead: correct to the
 * pixel, and dead on arrival, because the release was a throw and the
 * measurement only knows where it stopped.
 */

/** the catch: loose enough to overshoot, so inherited speed is visible */
const TOSS = { damping: 21, stiffness: 260 } as const;
const BAYS = ['A', 'B', 'C', 'D'] as const;
const eq = (a: number, b: number) => a === b;

export class Release extends Component {
  /** -1 is the tray; 0…3 are the bays */
  @tracked at = -1;
  @tracked borrow = true;
  @tracked drops = 0;

  bays = BAYS;

  /**
   * Every release replaces the chip element, whether or not it changed bay.
   *
   * This is not a trick to force a render — it is what makes the demo honest.
   * A drag leaves the element wearing a transform, and the only thing that
   * clears it is a new element. Removing and re-inserting on the same id
   * hands the pass a leaver painted where the finger let go and an arrival in
   * its proper seat: a flight home for a drop that changed nothing, and a
   * flight to the bay for one that did. One mechanism, both outcomes.
   */
  get token() {
    return [this.drops];
  }

  toggle = () => {
    this.borrow = !this.borrow;
  };

  send = (to: number) => {
    this.drops += 1;
    this.at = to;
  };

  /**
   * The drop test is a hit test, not a layout question: whatever bay is under
   * the pointer at release wins, and anywhere else means the tray. The score
   * never sees this — it only ever sees a chip that left one parent and
   * arrived in another.
   */
  drop = (event: PointerEvent | MouseEvent) => {
    /**
     * Look PAST the chip. The thing being dragged is by definition the
     * topmost element under the pointer, so a plain `elementFromPoint`
     * hit-tests the chip and answers with the bay the chip came from —
     * every drop reads as "back where it started".
     */
    const bay = document
      .elementsFromPoint(event.clientX, event.clientY)
      .filter((el) => !el.closest('.rel-chip'))
      .map((el) => el.closest('[data-bay]'))
      .find(Boolean);
    const to = bay?.getAttribute('data-bay');
    this.drops += 1;
    this.at = to === null || to === undefined ? -1 : Number(to);
  };

  <template>
    <div class="ex rel-ex no-select" {{on "selectstart" preventSelect}}>
      <div class="rel-controls">
        <button
          type="button"
          class={{if this.borrow "chip is-on" "chip"}}
          {{on "click" this.toggle}}
        >{{if this.borrow "@from=c.gesture" "measured only"}}</button>
        <p class="rel-hint">{{if
            this.borrow
            "The flight starts on the pointer, at the pointer's speed — a toss carries past the bay and settles back."
            "The flight starts at the measured box. Same landing, no throw: the speed you let go at is gone."
          }}</p>
      </div>

      <Choreo class="rel-board" as |c|>
        <div class="rel-tray" data-bay="-1">
          <span class="rel-label">tray</span>
          {{#if (eq this.at -1)}}
            {{#each this.token key="@identity" as |take|}}
              <span
                class="rel-chip"
                data-take={{take}}
                {{motion
                  id="chip"
                  role="chip"
                  drag=true
                  dragElastic=0.16
                  onDragEnd=this.drop
                }}
              >take 04</span>
            {{/each}}
          {{/if}}
        </div>

        <div class="rel-bays">
          {{#each this.bays key="@index" as |name i|}}
            <button
              type="button"
              class="rel-bay"
              data-bay={{i}}
              {{motion id=(concat "bay-" name) role="bay"}}
              {{on "click" (fn this.send i)}}
            >
              <span class="rel-label">{{name}}</span>
              {{#if (eq this.at i)}}
                {{#each this.token key="@identity" as |take|}}
                  <span
                    class="rel-chip is-home"
                    data-take={{take}}
                    {{motion
                      id="chip"
                      role="chip"
                      drag=true
                      dragElastic=0.16
                      onDragEnd=this.drop
                    }}
                  >take 04</span>
                {{/each}}
              {{/if}}
            </button>
          {{/each}}
        </div>

        <c.Parallel>
          {{! the arrival: `c.received` is the half that CLAIMED an identity,
              which is the only sprite in the pass with two boxes to fly
              between. @from replaces the first of them with the pointer. }}
          <c.Move
            @of={{c.received "chip"}}
            @from={{if this.borrow c.gesture}}
            @spring={{TOSS}}
            @size={{false}}
            @swap="none"
          />
          {{! the leaver it claimed — parked in the orphan layer, still
              measurable, and ours to dispose of however we like }}
          <c.Tween @of={{c.counterpart}} @opacity={{0}} @duration={{0.12}} />
          {{! and everything that DIDN'T change: the bays nobody threw at.
              A bay that receives the chip grows by it, so it is `moved`;
              the rest are `still`, and dim for exactly as long as the
              flight lasts. }}
          <c.Hold @of={{c.still "bay"}} @opacity={{0.4}} @duration={{0.42}} />
        </c.Parallel>
      </Choreo>
    </div>
  </template>
}

export default Release;
