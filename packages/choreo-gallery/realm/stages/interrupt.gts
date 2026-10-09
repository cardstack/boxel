import { Choreo } from '@cardstack/choreo';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, spring } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneSeconds, tuneSpring } from '../lib/tuning';
import InterruptNotes from '../notes/interrupt';

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
    <div class='ex'>
      <div class='rails'>
        {{! A puck is not positioned — it is RENDERED into one slot or another,
            and the region works out that the same id is somewhere new. That is
            the same counterpart matching two lists use; here it is what gives
            the Move a from and a to. }}
        <div class='rail-row'>
          <Choreo @id='spring' class='rail' as |c|>
            {{! the track, not the region, is the grid: a <Choreo> root also holds
                its orphan layer and the timeline's marker elements, and they
                would take slots of their own }}
            <div class='rail-track'>
              {{#each stations as |station|}}
                <button
                  type='button'
                  class='slot'
                  {{on 'click' (fn this.go station)}}
                >
                  {{#if (this.isAt station)}}
                    <span
                      class='puck is-spring'
                      {{motion id='puck' role='puck'}}
                    ></span>
                  {{/if}}
                </button>
              {{/each}}
            </div>
            {{! @swap="none": this demo carries ONE skin. The default 'during'
                crossfades the pair, and two identical pucks at complementary
                opacities never sum back to solid — the flight visibly dims. }}
            <c.Move
              @of={{c.kept 'puck'}}
              @spring={{tuneSpring 'interrupt' carry 'carry'}}
              @size={{false}}
              @swap='none'
            />
            {{! the old copy goes at once — its counterpart is already in the
                air. Naming it here is also what tells the region the sprite
                belongs to this run, so it is released when the run ends. }}
            <c.Hold @of={{c.removed 'puck'}} @opacity={{0}} />
          </Choreo>
          <span class='rail-name'>spring<em>keeps its speed</em></span>
        </div>

        <div class='rail-row'>
          <Choreo @id='tween' class='rail' as |c|>
            <div class='rail-track'>
              {{#each stations as |station|}}
                <button
                  type='button'
                  class='slot'
                  {{on 'click' (fn this.go station)}}
                >
                  {{#if (this.isAt station)}}
                    <span
                      class='puck is-tween'
                      {{motion id='puck' role='puck'}}
                    ></span>
                  {{/if}}
                </button>
              {{/each}}
            </div>
            <c.Move
              @of={{c.kept 'puck'}}
              @duration={{tuneSeconds 'interrupt' TIMED 'TIMED duration'}}
              @ease='easeInOut'
              @size={{false}}
              @swap='none'
            />
            <c.Hold @of={{c.removed 'puck'}} @opacity={{0}} />
          </Choreo>
          <span class='rail-name'>tween<em>starts over</em></span>
        </div>
      </div>

    </div>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
           reads as a layout bug rather than as a stage, and the ones sized
           `min(Npx, 100%)` hit the frame exactly when the card is narrow.
           The block padding matters as much as the inline: on a stage tall
           enough to fill the platter, content flush against the top and bottom
           of the recess reads as overflowed rather than placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      .rails {
        display: flex;
        flex-direction: column;
        gap: 18px;
        width: min(92%, 400px);
        margin-bottom: 26px;
      }

      .rail-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .rail {
        height: 46px;
        padding: 0 6px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: linear-gradient(180deg, var(--bg-spot), var(--bg-well));
      }

      /* four equal slots, so a puck's home is decided by which slot it is rendered
         into rather than by any number in the template */
      .rail-track {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        align-items: center;
        height: 100%;
      }

      /* every other interactive control on the page resets its own native button
         chrome; this one was missed, and Chrome's default button background/border
         was showing through as a gray rounded rectangle in each of the four cells */
      .slot {
        display: grid;
        place-items: center;
        height: 100%;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        appearance: none;
        cursor: pointer;
        transition: background-color 0.15s var(--ease);
      }

      /* four slots read as one blank track without SOME line between them — a
         hairline rather than a full border, so it disappears under the puck's own
         box-shadow instead of competing with it */
      .slot:not(:first-child) {
        border-left: 1px solid var(--line);
      }

      /* the end slots round off to follow .rail's own pill cap — a plain
         rectangle's hover fill square-cornered its way past the curve, and
         clipping it with overflow on .rail instead left a seam of its own at
         the cap where the border's anti-aliasing and the clip boundary
         disagreed.

         The negative margin is what makes the fill actually REACH the cap.
         .rail carries 6px of side padding, so the track — and every slot in it —
         starts 6px inside the rail's own curve, and a hover fill that stopped
         there left a dark crescent in the cap that the pointer was already over.
         Bleeding the end slots back across that padding, with matching padding of
         their own so the content box (and therefore the puck's centre) does not
         move, covers it. At 44px of inner height a 999px radius resolves to the
         same 22px as the rail's inner edge, so the two curves coincide. */
      .slot:first-child {
        margin-left: -6px;
        padding-left: 6px;
        border-radius: 999px 0 0 999px;
      }

      .slot:last-child {
        margin-right: -6px;
        padding-right: 6px;
        border-radius: 0 999px 999px 0;
      }

      .slot:focus-visible {
        background: rgba(var(--surface-tint-rgb), 0.08);
      }

      /* the tap's own flash — hover is gated to hover-capable devices above, so
         touch needs feedback of its own, one step brighter than the hover fill
         so it reads against the rail in dark */
      .slot:active {
        background: rgba(var(--surface-tint-rgb), 0.14);
      }

      @media (hover: hover) {
        .slot:hover {
          background: rgba(var(--surface-tint-rgb), 0.08);
        }
      }

      .puck {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        box-shadow: 0 6px 18px
          rgba(var(--shadow-rgb), calc(0.55 * var(--shadow-a)));
      }

      .puck.is-spring {
        background:
          radial-gradient(circle at 32% 28%, #fff8, transparent 44%),
          linear-gradient(160deg, var(--ember-hot), var(--ember));
      }

      .puck.is-tween {
        background:
          radial-gradient(circle at 32% 28%, #fff6, transparent 44%),
          linear-gradient(160deg, #8ba6ff, #1b1f52);
      }

      .rail-name {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding-left: 12px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      .rail-name em {
        font-style: normal;
        letter-spacing: 0.04em;
        text-transform: none;
        color: var(--ink-faint);
      }

      .choreo-site:not([data-theme='light']) .rail {
        background: linear-gradient(180deg, #2c2723, #241f1b);
      }
    </style>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSpring('interrupt', carry, 'carry');
tuneSeconds('interrupt', TIMED, 'TIMED duration');

export class InterruptDemo extends GalleryDemo {
  static stage = Interrupt;
  static notes = InterruptNotes;
}
