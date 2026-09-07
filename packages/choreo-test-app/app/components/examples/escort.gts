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
import { tuneSeconds, tuneSpring } from 'test-app/lib/demo-tuning';

/**
 * Three bays and one card. Click a bay and the card flies to it — and two
 * other things move with it that are NOT animated: a badge pinned to its
 * corner, and a shadow that spreads underneath while it is in transit.
 *
 * Neither is a tween, and that is the whole point of the page. A tween
 * would have to guess: it would need to know, in advance, the shape of the
 * spring it is meant to accompany — including its overshoot, and including
 * what happens when a second click retargets it mid-flight. A derived
 * value never guesses. It is computed, every frame, from where the run
 * holds the card THAT frame — so it is right on frames nobody planned.
 * And it never reads the page to find out: the resting boxes come from
 * the pass's own measurements, the card's position from the values the
 * run is already driving (docs/postmortem-follow.md).
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
 * `rest` is the badge's RESTING box — where the stylesheet has already
 * put it, which is the corner of the bay the card is flying TO. The card
 * is read at `now`: its resting box composed with the transform carrying
 * it, handed over by the run. Nothing here measures the page. Because the
 * seat makes the badge's resting right edge the card's resting right
 * edge, this delta closes to ZERO on its own as the card lands: the
 * follower's window can end whenever it likes and nothing jumps.
 *
 * Which is exactly why it drives x and not y. The badge straddles the
 * card's top edge, so `card.y - rest.y` is a constant half a badge — it
 * would ride that much low for the whole flight and snap back up the
 * moment the window closed. A derived value is only seamless where it
 * agrees with the rest it will return to; nothing needs to move vertically
 * here, so nothing does.
 */
const pin = ({ rest, sources }: DeriveContext) => {
  const card = sources[0]!.now;
  return { x: card.x + card.width - (rest.x + rest.width) };
};

/**
 * The shadow reads LIFT — how far the card is from any bay — and spreads,
 * softens and fades by it. Pure: a function of where the card is, never
 * of where it was going or how fast. Interrupt the flight halfway and the
 * shadow is correct on the very next frame, with nothing to re-aim. And
 * note what it can now do safely: drive `scaleX` from geometry. When the
 * geometry was the live page, this exact function fed its own scale back
 * into its own width and smeared across two bays; `rest` cannot contain
 * what the follower writes, so the runaway is unrepresentable.
 */
const cast = ({ rest, sources }: DeriveContext) => {
  const card = sources[0]!.now;
  const stray = strayOf(card, rest.x + (rest.width - card.width) / 2);
  return {
    filter: `blur(${(5 + stray * 16).toFixed(2)}px)`,
    opacity: 0.72 - stray * 0.42,
    scaleX: 1 + stray * 0.75,
    x: card.x + card.width / 2 - (rest.x + rest.width / 2),
  };
};

const PIN_REST = { x: 0 };
/** must match the stylesheet's resting values exactly, or the window
 *  closing would be a visible step rather than a handover. Nothing in
 *  either file makes that true, so the acceptance suite compares this
 *  against what the page paints before any flight. */
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

/**
 * A depot floor, not three labelled boxes. Each bay is a place with a code
 * painted on it and a count of what is standing in it; the parcel is a
 * waybill with a number, a destination and a weight; the badge is how many
 * items are inside it. None of that changes a frame of the motion — but a
 * demo is a claim about a real interface, and a claim is easier to believe
 * when the thing being carried is something a person would carry.
 */
const BAYS = [
  { code: 'B1', id: 'bay-0', label: 'Hold', queue: 4 },
  { code: 'B2', id: 'bay-1', label: 'Sorting', queue: 1 },
  { code: 'B3', id: 'bay-2', label: 'Dispatch', queue: 2 },
] as const;

/** what is riding in the parcel — the number the badge is counting */
const ITEMS = 3;

export class Escort extends Component {
  @tracked bay = 0;

  items = ITEMS;

  send = (index: number) => {
    this.bay = index;
  };

  isHere = (index: number) => index === this.bay;

  /** two digits, because a depot counts in two digits */
  tally = (index: number) =>
    String(BAYS[index]!.queue + (index === this.bay ? 1 : 0)).padStart(2, '0');

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
              <span class="esc-bay-code">{{bay.code}}</span>
              <span class="esc-bay-floor"></span>
              <span class="esc-bay-foot">
                <span class="esc-bay-name">{{bay.label}}</span>
                <span class="esc-bay-tally">{{this.tally index}}</span>
              </span>
            </button>
          {{/each}}

          {{! All three ride the rail by LAYOUT, in one seat: change the
              bay and their resting positions change together. The seat is
              the card's own box, so the badge's corner and the shadow's
              centre are exact by construction rather than by arithmetic.
              Only the card is moved by the timeline; the other two are
              computed from it, and land where the stylesheet already put
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
              <span class="esc-card-head">
                <span class="esc-card-no">CG-4417</span>
                <span class="esc-card-mass">2.4kg</span>
              </span>
              <span class="esc-card-to">Portland OR</span>
              <span class="esc-card-code"></span>
            </span>
            <span
              class="esc-badge"
              data-test-escort-badge
              title="items in this parcel"
              {{motion id="badge"}}
            >{{this.items}}</span>
          </span>
        </div>

        {{! The score: one composite step, and two values computed from it.
            The follows are anchored to the carry by NAME — a block is a
            step's equal to the anchor system, which is what lets a
            composite be pointed at as one thing. Their window OUTLIVES the
            spring: a follower that closes mid-tail hands the badge to rest
            while the card is still a few pixels out, and the handover is
            only seamless where the two agree. }}
        <c.Parallel>
          <Carry
            @name="carry"
            @of={{c.moved "card"}}
            @spring={{tuneSpring "escort" carry "Carry spring 1"}}
          />
          <c.Follow
            @at={{at "carry"}}
            @of={{c.id "badge"}}
            @to={{c.id "card"}}
            @read={{pin}}
            @rest={{PIN_REST}}
            @duration={{tuneSeconds "escort" 1.6 "Follow duration 2"}}
          />
          <c.Follow
            @at={{at "carry"}}
            @of={{c.id "shadow"}}
            @to={{c.id "card"}}
            @read={{cast}}
            @rest={{CAST_REST}}
            @duration={{tuneSeconds "escort" 1.6 "Follow duration 3"}}
          />
        </c.Parallel>
      </Choreo>

      {{! the house note: one mono line, not a paragraph explaining itself }}
      <p class="esc-note">
        <span class="esc-note-key">CG-4417</span>
        <b>{{this.here}}</b>
        <span class="esc-note-dot">·</span>
        {{this.items}}
        items
        <span class="esc-note-dot">·</span>
        send it again mid-flight
      </p>
    </div>
  </template>
}
