import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type {
  DeriveContext,
  SpringSpec,
  StepArgs,
  TimelineNode,
} from 'glimmer-motion';
import { at, Choreo, motion, StepComponent, toMs } from 'glimmer-motion';

/**
 * Three bays and one card. Click a bay and the card flies to it — and two
 * other things move with it that are NOT animated: a badge pinned to its
 * corner, and a shadow that spreads underneath while it is in transit.
 *
 * Neither is a tween, and that is the whole point of the page. A tween
 * would have to guess: it would need to know, in advance, the shape of the
 * spring it is meant to accompany — including its overshoot, and including
 * what happens when a second click retargets it mid-flight. A derived
 * value never guesses. It is READ from the card's live box on every frame,
 * so it is right on frames nobody planned.
 */

/* ── the score's words ───────────────────────────────────────────────── */

/**
 * A card crossing four hundred pixels in half a second is a smooth curve
 * nobody can read: measured, it peaked at thirty-two pixels a frame, and
 * what the eye gets from that is a jump with a bit of blur on it. The
 * carry is paced for the distance instead — long enough to watch, with
 * just enough bounce to show that the badge and the halo are following
 * the overshoot rather than a plan.
 */
const carry: SpringSpec = { bounce: 0.18, visualDuration: 0.9 };

/** how far the card is from its bay, as a fraction of one bay's width */
const strayOf = (card: { width: number; x: number }, homeX: number) =>
  Math.min(1, Math.abs(card.x - homeX) / Math.max(1, card.width));

/**
 * The badge rides the card's right edge.
 *
 * `self` is the badge's box with its own translation taken out — where the
 * stylesheet has already put it, which is the corner of the bay the card
 * is flying TO. Because the seat makes the badge's resting right edge the
 * card's resting right edge, this delta closes to ZERO on its own as the
 * card lands: the follower's window can end whenever it likes and nothing
 * jumps.
 *
 * Which is exactly why it drives x and not y. The badge deliberately sits
 * ABOVE the card's top line, so `card.y - self.y` is a constant ten pixels
 * — it would ride ten pixels low for the whole flight and snap back up the
 * moment the window closed. A derived value is only seamless where it
 * agrees with the rest it will return to; nothing needs to move vertically
 * here, so nothing does.
 */
const pin = ({ self, sources }: DeriveContext) => {
  const card = sources[0]!;
  return { x: card.x + card.width - (self.x + self.width) };
};

/**
 * The shadow reads LIFT — how far the card is from any bay — and spreads,
 * softens and fades by it. Pure: a function of where the card is, never of
 * where it was going or how fast. Interrupt the flight halfway and the
 * shadow is correct on the very next frame, with nothing to re-aim.
 */
const cast = ({ self, sources }: DeriveContext) => {
  const card = sources[0]!;
  const stray = strayOf(card, self.x + (self.width - card.width) / 2);
  return {
    filter: `blur(${(5 + stray * 16).toFixed(2)}px)`,
    opacity: 0.72 - stray * 0.42,
    scaleX: 1 + stray * 0.75,
    x: card.x + card.width / 2 - (self.x + self.width / 2),
  };
};

const PIN_REST = { x: 0 };
/** must match the stylesheet's resting values exactly, or the window
 *  closing would be a visible step rather than a handover */
const CAST_REST = {
  filter: 'blur(5px)',
  opacity: 0.72,
  scaleX: 1,
  x: 0,
};

/* ── a step this app said for itself ─────────────────────────────────── */

/**
 * `<Carry>` — a composite step, written in nothing but the published seam
 * (`StepComponent`, `toMs`, node literals). It is the move plus the layer
 * it travels on, said once, so the template below asks for a carry rather
 * than remembering to raise what it moves.
 *
 * Its children are `generic`, so anything more specific in the same
 * timeline takes the sprite away from it without an exclusion syntax —
 * a default, not a cage.
 */
class Carry extends StepComponent<StepArgs & { spring?: SpringSpec }> {
  node(): TimelineNode {
    const { of, name, spring = carry } = this.args;
    return {
      at: this.args.at,
      children: [
        { generic: true, kind: 'move', of, spring },
        { generic: true, kind: 'hold', of, props: { zIndex: 3 } },
      ],
      delay: toMs(this.args.delay),
      kind: 'parallel',
      name,
    };
  }
}

/* ── the demo ────────────────────────────────────────────────────────── */

const BAYS = [
  { id: 'bay-0', label: 'Hold' },
  { id: 'bay-1', label: 'Sorting' },
  { id: 'bay-2', label: 'Dispatch' },
] as const;

export class Escort extends Component {
  @tracked bay = 0;

  send = (index: number) => {
    this.bay = index;
  };

  isHere = (index: number) => index === this.bay;

  get here() {
    return BAYS[this.bay]!.label;
  }

  /** the bay's centre as a percentage of the rail — the resting layout */
  get seat() {
    return htmlSafe(`left:${((this.bay * 2 + 1) / 6) * 100}%`);
  }

  <template>
    <div class="ex esc-stage">
      <Choreo class="esc-field" as |c|>
        <div class="esc-rail">
          {{#each BAYS key="id" as |bay index|}}
            <button
              type="button"
              class="esc-bay{{if (this.isHere index) ' is-here'}}"
              data-test-bay={{index}}
              {{on "click" (fn this.send index)}}
            >
              <span class="esc-bay-name">{{bay.label}}</span>
            </button>
          {{/each}}

          {{! All three ride the rail by LAYOUT, in one seat: change the
              bay and their resting positions change together. The seat is
              the card's own box, so the badge's corner and the shadow's
              centre are exact by construction rather than by arithmetic.
              Only the card is moved by the timeline; the other two are
              READ from it, and land where the stylesheet already put
              them. }}
          <span class="esc-seat" style={{this.seat}}>
            <span
              class="esc-shadow"
              data-test-escort-shadow
              {{motion id="shadow"}}
            ></span>
            <span
              class="esc-card"
              data-test-escort-card
              {{motion id="card" role="card"}}
            >
              <span class="esc-card-no">04</span>
              <span class="esc-card-line"></span>
              <span class="esc-card-line is-short"></span>
            </span>
            <span
              class="esc-badge"
              data-test-escort-badge
              {{motion id="badge"}}
            >2</span>
          </span>
        </div>

        {{! The score: one composite step, and two values read from it.
            The follows are anchored to the carry by NAME — a block is a
            step's equal to the anchor system, which is what lets a
            composite be pointed at as one thing. }}
        <c.Parallel>
          <Carry @name="carry" @of={{c.moved "card"}} @spring={{carry}} />
          <c.Follow
            @at={{at "carry"}}
            @of={{c.id "badge"}}
            @to={{c.id "card"}}
            @read={{pin}}
            @rest={{PIN_REST}}
            @duration={{1.1}}
          />
          <c.Follow
            @at={{at "carry"}}
            @of={{c.id "shadow"}}
            @to={{c.id "card"}}
            @read={{cast}}
            @rest={{CAST_REST}}
            @duration={{1.1}}
          />
        </c.Parallel>
      </Choreo>

      <p class="esc-note">
        <b>{{this.here}}</b>
        — the badge and the shadow are read from the card's live box, not
        animated alongside it. Click another bay mid-flight.
      </p>
    </div>
  </template>
}
