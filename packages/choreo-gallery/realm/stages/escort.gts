import type {
  DeriveContext,
  SpringSpec,
  StepArgs,
  TimelineNode,
} from '@cardstack/choreo';
import { at, Choreo, StepComponent, toMs } from '@cardstack/choreo';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneSeconds, tuneSpring } from '../lib/tuning';

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
    <div class='ex esc-stage'>
      <Choreo class='esc-field' as |c|>
        <div class='esc-rail'>
          {{#each BAYS key='id' as |bay index|}}
            <button
              type='button'
              class='esc-bay{{if (this.isHere index) " is-here"}}'
              data-test-bay={{index}}
              {{on 'click' (fn this.send index)}}
            >
              <span class='esc-bay-code'>{{bay.code}}</span>
              <span class='esc-bay-floor'></span>
              <span class='esc-bay-foot'>
                <span class='esc-bay-name'>{{bay.label}}</span>
                <span class='esc-bay-tally'>{{this.tally index}}</span>
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
          <span class='esc-seat' style={{this.seat}}>
            <span
              class='esc-shadow'
              data-test-escort-shadow
              {{motion id='shadow'}}
            ></span>
            <span
              class='esc-card'
              data-test-escort-card
              {{motion id='card' role='card'}}
            >
              <span class='esc-card-head'>
                <span class='esc-card-no'>CG-4417</span>
                <span class='esc-card-mass'>2.4kg</span>
              </span>
              <span class='esc-card-to'>Portland OR</span>
              <span class='esc-card-code'></span>
            </span>
            <span
              class='esc-badge'
              data-test-escort-badge
              title='items in this parcel'
              {{motion id='badge'}}
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
            @name='carry'
            @of={{c.moved 'card'}}
            @spring={{tuneSpring 'escort' carry 'Carry spring 1'}}
          />
          <c.Follow
            @at={{at 'carry'}}
            @of={{c.id 'badge'}}
            @to={{c.id 'card'}}
            @read={{pin}}
            @rest={{PIN_REST}}
            @duration={{tuneSeconds 'escort' 1.6 'Follow duration 2'}}
          />
          <c.Follow
            @at={{at 'carry'}}
            @of={{c.id 'shadow'}}
            @to={{c.id 'card'}}
            @read={{cast}}
            @rest={{CAST_REST}}
            @duration={{tuneSeconds 'escort' 1.6 'Follow duration 3'}}
          />
        </c.Parallel>
      </Choreo>

      {{! the house note: one mono line, not a paragraph explaining itself }}
      <p class='esc-note'>
        <span class='esc-note-key'>CG-4417</span>
        <b>{{this.here}}</b>
        <span class='esc-note-dot'>·</span>
        {{this.items}}
        items
        <span class='esc-note-dot'>·</span>
        send it again mid-flight
      </p>
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

      /* ── Escort: derived values, read from a moving card ──────────────────── */

      .esc-stage {
        container-type: inline-size;
        display: flex;
        flex-direction: column;
        /* .ex centres its children, which makes a column child shrink to its
           content — the rail has to span to lay its bays out */
        align-items: stretch;
        justify-content: center;
        gap: clamp(10px, 3cqw, 18px);
        padding: clamp(14px, 4cqw, 26px);
      }

      .esc-field {
        position: relative;
        /* bounded on purpose: the bays are what the card travels between, so
           the rail's width IS the length of the move. Left to fill a desktop it
           became a four-hundred-pixel dash. */
        width: min(100%, 560px);
        margin-inline: auto;
      }

      .esc-rail {
        /* one source of truth for the rider geometry: percentage margins resolve
           against the CONTAINER, not the element, so every offset here is px.
           The cast's top is DERIVED from the card's — the two used to be
           independent clamps that happened to agree at one width, which is a
           coincidence a stylesheet cannot keep. */
        --esc-card-w: clamp(84px, 24cqw, 124px);
        --esc-card-h: clamp(56px, 15cqw, 78px);
        --esc-card-top: clamp(16px, 4.5cqw, 26px);
        --esc-cast-top: calc(
          var(--esc-card-top) + var(--esc-card-h) + clamp(3px, 1cqw, 6px)
        );
        --esc-badge-w: clamp(17px, 4.4cqw, 21px);
        /* On the dark ground a cast shadow is invisible — a card lifting off a
           near-black floor has nothing to darken. So dark mode casts LIGHT: an
           ember halo that spreads and softens on exactly the same reading. */
        --esc-cast: var(--ember);
        position: relative;
        display: grid;
        /* NO gap: the seat parks at 1/6, 3/6, 5/6 of the rail, and a gap moves a
           column's centre off those marks by a third of it — the parcel landed
           five pixels shy of the middle of every bay. The plates are separated by
           their own margin instead, which the grid's arithmetic never sees. */
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      /* a bay is a floor plate, not an outline: it has an edge, a code painted at
         the back of it, and a count of what is standing in it */
      .esc-bay {
        position: relative;
        display: block;
        min-height: clamp(126px, 34cqw, 176px);
        margin-inline: clamp(3px, 1cqw, 7px);
        padding: clamp(7px, 2cqw, 11px);
        border: 1px solid var(--line);
        border-radius: 12px;
        background: linear-gradient(
          180deg,
          transparent 52%,
          color-mix(in srgb, var(--bg-well) 65%, transparent)
        );
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        /* the handoff between cells CROSSFADES. It used to switch border-style
           the instant the bay changed, which snapped from one cell to the next
           while the card was still gliding between them — and a hard cut beside
           a smooth move reads as the move having jumped. */
        transition: border-color 0.36s var(--ease);
      }

      .esc-bay:hover {
        border-color: var(--line-strong);
      }

      .esc-bay.is-here {
        border-color: color-mix(in srgb, var(--ember) 45%, transparent);
      }

      /* the lit floor — a pool at the spot the parcel lands, faded in rather than
         switched, for the same reason the border is */
      .esc-bay-floor {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: radial-gradient(
          120% 66% at 50% 60%,
          color-mix(in srgb, var(--ember) 15%, transparent),
          transparent 72%
        );
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.36s var(--ease);
      }

      .esc-bay.is-here .esc-bay-floor {
        opacity: 1;
      }

      .esc-bay-code {
        position: absolute;
        top: clamp(6px, 1.8cqw, 10px);
        left: clamp(8px, 2.2cqw, 12px);
        font-family: var(--font-mono);
        font-size: clamp(8px, 1.9cqw, 10px);
        letter-spacing: 0.12em;
        color: var(--ink-faint);
        opacity: 0.55;
      }

      .esc-bay-foot {
        position: absolute;
        right: clamp(8px, 2.2cqw, 12px);
        bottom: clamp(7px, 2cqw, 11px);
        left: clamp(8px, 2.2cqw, 12px);
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
      }

      .esc-bay-name,
      .esc-bay-tally {
        font-family: var(--font-mono);
        font-size: clamp(8.5px, 2cqw, 10.5px);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
        transition: color 0.36s var(--ease);
      }

      .esc-bay-tally {
        letter-spacing: 0.06em;
        font-variant-numeric: tabular-nums;
        opacity: 0.7;
      }

      .esc-bay.is-here .esc-bay-name {
        color: var(--ink);
      }

      .esc-bay.is-here .esc-bay-tally {
        color: var(--ember-hot);
        opacity: 1;
      }

      /* the seat: the card's own box, parked at a bay. Everything that rides
         with the card is positioned against THIS, so the badge's corner and the
         shadow's centre are exact by construction — no arithmetic to drift. */
      .esc-seat {
        position: absolute;
        top: 0;
        width: var(--esc-card-w);
        height: 100%;
        margin-left: calc(var(--esc-card-w) / -2);
      }

      /* the parcel: a waybill with a number, somewhere to be, and a weight */
      .esc-card {
        position: absolute;
        top: var(--esc-card-top);
        left: 0;
        display: flex;
        flex-direction: column;
        gap: clamp(4px, 1.2cqw, 7px);
        width: 100%;
        height: var(--esc-card-h);
        padding: clamp(6px, 1.8cqw, 9px) clamp(7px, 2cqw, 10px);
        overflow: hidden;
        border: 1px solid
          color-mix(in srgb, var(--line-strong) 70%, transparent);
        border-radius: 8px;
        background: linear-gradient(160deg, var(--bg-spot), var(--bg-well));
        box-shadow: 0 1px 0 rgba(var(--bg-rgb), 0.6) inset;
      }

      .esc-card-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
      }

      .esc-card-no {
        font-family: var(--font-mono);
        font-size: clamp(8.5px, 2cqw, 10.5px);
        letter-spacing: 0.02em;
        color: var(--ember);
      }

      .esc-card-mass {
        font-family: var(--font-mono);
        font-size: clamp(7.5px, 1.7cqw, 9px);
        color: var(--ink-faint);
      }

      .esc-card-to {
        overflow: hidden;
        font-size: clamp(8.5px, 2cqw, 11px);
        font-weight: 600;
        letter-spacing: -0.01em;
        line-height: 1.2;
        color: var(--ink);
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      /* a barcode drawn rather than drawn ON: one repeating gradient, so it reads
         at whatever width the clamp lands on and costs no asset */
      .esc-card-code {
        margin-top: auto;
        height: clamp(9px, 2.4cqw, 13px);
        background: repeating-linear-gradient(
          90deg,
          var(--line-strong) 0 1px,
          transparent 1px 3px,
          var(--line-strong) 3px 5px,
          transparent 5px 6px,
          var(--line-strong) 6px 7px,
          transparent 7px 10px
        );
        opacity: 0.85;
      }

      /* the count of what is inside the parcel, ringed so it reads as pinned ON
         the corner rather than beside it */
      .esc-badge {
        position: absolute;
        /* straddling the card's top edge, which is where a count belongs — and,
           like the card's top, derived rather than a second guess at it */
        top: calc(var(--esc-card-top) - var(--esc-badge-w) / 2);
        right: 0;
        z-index: 4;
        display: grid;
        place-items: center;
        width: var(--esc-badge-w);
        height: var(--esc-badge-w);
        border-radius: 50%;
        background: var(--ember);
        box-shadow: 0 2px 6px
          rgba(var(--shadow-rgb), calc(0.5 * var(--shadow-a)));
        color: #fff;
        font-family: var(--font-mono);
        font-size: clamp(9px, 2.2cqw, 10.5px);
        line-height: 1;
      }

      /* Ground contact. A SOLID fill blurred by five pixels keeps a saturated
         core — the blur softens the rim and leaves the middle flat ink, which on
         the cream ground read as a hard grey bar with the halo around it (the
         "grey smear" the light palette's own note warns about, at the top of this
         file). A radial falloff has no core to keep, so the ellipse is contact at
         any alpha, and the animated blur still softens it further in transit. */
      .esc-shadow {
        position: absolute;
        top: var(--esc-cast-top);
        left: 0;
        width: 100%;
        height: clamp(10px, 2.8cqw, 15px);
        border-radius: 50%;
        background: radial-gradient(closest-side, var(--esc-cast), transparent);
        filter: blur(5px);
        opacity: 0.72;
      }

      /* light mode has a floor to darken, so it keeps a real shadow — scaled by
         --shadow-a like every other shadow in this stylesheet. It was the one
         that opted out, at rgba(…, 0.8) under opacity 0.72: an effective 0.58 ink
         where light mode's darkest is 0.18. */
      .choreo-site[data-theme='light'] .esc-rail {
        --esc-cast: rgba(var(--shadow-rgb), calc(1.6 * var(--shadow-a)));
      }

      .esc-note {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: center;
        gap: 0.5em;
        width: min(100%, 560px);
        margin-inline: auto;
        font-family: var(--font-mono);
        font-size: clamp(8.5px, 2cqw, 10.5px);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .esc-note-key {
        color: var(--ember);
      }

      .esc-note-dot {
        opacity: 0.4;
      }

      .esc-note b {
        font-weight: 500;
        color: var(--ink);
      }
    </style>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSpring('escort', carry, 'Carry spring 1');
tuneSeconds('escort', 1.6, 'Follow duration 2');
tuneSeconds('escort', 1.6, 'Follow duration 3');

export class EscortDemo extends GalleryDemo {
  static stage = Escort;
}
