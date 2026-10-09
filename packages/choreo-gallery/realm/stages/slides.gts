import { Choreo } from '@cardstack/choreo';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, spring, to } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion, tuneSeconds, tuneSpring } from '../lib/tuning';

const slides = [0, 1, 2] as const;
/** the one line that is not on every slide — it arrives and leaves */
const notes = ['', 'Hold 1280°', 'Pass 04'] as const;

type Slide = (typeof slides)[number];

/** the plate's box: a real box animation, so its gradient is never stretched */
const plate = spring({ bounce: 0.1, visualDuration: 0.52 });
/** the type: projection, so it scales between two real font sizes */
const type = { bounce: 0.14, visualDuration: 0.52 };
/** the corner radius, on its own short curve */
const radiusTween = { duration: 0.42, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * A slide deck, magic-moved.
 *
 * Three compositions of the same four things — a plate, a title, a kicker, and
 * a note that is only on two of them. Nothing is added or removed between
 * slides except the note; every other element simply lives somewhere else, at
 * a different size, and the transition is the trip.
 *
 * This demo existed once before, built on the View Transition API. That version
 * is worth knowing about, because what it could not do is why this one is a
 * choreography:
 *
 *   · A view transition is one snapshot crossfading into another. It cannot
 *     sequence — "the note leaves, THEN the layout moves, THEN the next note
 *     arrives" has nowhere to live, so everything happens at once.
 *   · It could not interpolate the plate's corner radius, because the radius is
 *     part of the layout it is transitioning between. That version carried it
 *     across in a pair of custom properties (`--mark-from` / `--mark-to`) set by
 *     hand before every transition. Here it is one more animated property.
 *   · It is not interruptible. Click twice quickly and the second transition
 *     waits for the first; the old version needed a `moving` flag to stop you.
 *
 * Two mechanisms, on purpose, and the difference is the lesson:
 *
 *   The PLATE moves with `c.Move` — a real box animation of left/top/width/
 *   height. It is absolutely positioned, so nothing reflows around it, and its
 *   gradient and its shadow are re-rendered at every size instead of being
 *   stretched. A projected plate would be a 36px square scaled up 6× on one
 *   axis, and it would look it.
 *
 *   The TYPE moves with `layout=true` — projection. The title is a different
 *   font-size on every slide, and projection is what animates between two real
 *   sizes rather than resizing a box around text that has already jumped. It
 *   only reads cleanly because each box is `fit-content`: same string, so width
 *   and height both track font-size and the aspect ratio never changes.
 */
export class Slides extends Component {
  @tracked slide: Slide = 0;

  get note() {
    return notes[this.slide];
  }

  get pass() {
    return `Pass 0${this.slide + 1}`;
  }

  advance = () => {
    this.go(((this.slide + 1) % slides.length) as Slide);
  };

  back = () => {
    this.go(((this.slide + slides.length - 1) % slides.length) as Slide);
  };

  /* -- swipe: the deck reads like a deck on touch --
     One pointer, measured down-to-up. A horizontal throw past the threshold
     turns the page (left = next, right = back); anything shorter falls
     through to the tap, which advances as it always has. The browser still
     fires a click after a swipe, so the swipe sets a flag the click eats. */
  private downAt: { x: number; y: number } | null = null;
  private swiped = false;

  // `{{on}}` types every handler in a realm as taking a plain `Event`
  down = (e: Event) => {
    const event = e as PointerEvent;
    this.downAt = { x: event.clientX, y: event.clientY };
  };

  up = (e: Event) => {
    const event = e as PointerEvent;
    const from = this.downAt;
    this.downAt = null;
    if (!from) {
      return;
    }
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
      this.swiped = true;
      if (dx < 0) {
        this.advance();
      } else {
        this.back();
      }
    }
  };

  tap = () => {
    if (this.swiped) {
      this.swiped = false;
      return;
    }
    this.advance();
  };

  pick = (slide: Slide, event: Event) => {
    event.stopPropagation();
    this.go(slide);
  };

  /** no guard: a second click mid-flight retargets the run rather than queueing */
  go = (slide: Slide) => {
    this.slide = slide;
  };

  isOn = (slide: Slide) => slide === this.slide;

  <template>
    <div class='ex'>
      <div class='slides'>
        <div class='slides-bar'>
          <small class='slides-pass'>{{this.pass}}</small>
          <button type='button' class='slides-next' {{on 'click' this.advance}}>
            Next
          </button>
        </div>

        <Choreo
          class='slide'
          data-slide={{this.slide}}
          {{on 'click' this.tap}}
          {{on 'pointerdown' this.down}}
          {{on 'pointerup' this.up}}
          as |c|
        >
          {{! Every slide renders the same elements. Only the stylesheet, keyed
              on data-slide, says where they are — so the region sees four
              participants that moved and nothing that was replaced. }}
          {{! The corner radius is the one thing the View Transition version of
              this demo could not do at all: a radius belongs to the layout
              being transitioned between, so there was nothing to interpolate,
              and that version carried it across by hand in a pair of custom
              properties. Here it is an ordinary animated value — `animate`
              re-runs whenever its target changes, which is every slide. }}
          <span
            class='slide-plate'
            {{motion
              id='plate'
              role='plate'
              animate=(to borderRadius=(radiusFor this.slide))
              transition=(tuneMotion 'slides' radiusTween 'radiusTween')
            }}
          ></span>

          <b
            class='slide-title'
            {{motion
              id='title'
              role='type'
              layout=true
              transition=(tuneMotion 'slides' type 'type')
            }}
          >Kiln</b>

          <small
            class='slide-kicker'
            {{motion
              id='kicker'
              role='type'
              layout=true
              transition=(tuneMotion 'slides' type 'type')
            }}
          >Night shift</small>

          {{#if this.note}}
            <em
              class='slide-note'
              {{motion id='note' role='note'}}
            >{{this.note}}
            </em>
          {{/if}}

          <c.Parallel>
            {{! The plate's own box: left, top, width and height as real
                values, so its gradient and shadow are re-rendered at every
                size rather than stretched. }}
            <c.Move
              @of={{c.moved 'plate'}}
              @spring={{tuneSpring 'slides' plate 'plate'}}
            />

            {{! The note is the only thing that comes and goes. It leaves fast
                and arrives late, so the slide is never carrying two of them. }}
            <c.Tween
              @of={{c.removed 'note'}}
              @opacity={{0}}
              @duration={{tuneSeconds 'slides' 0.14 'Step 1 duration'}}
            />
            <c.Tween
              @of={{c.inserted 'note'}}
              @opacity={{array 0 1}}
              @delay={{0.22}}
              @duration={{tuneSeconds 'slides' 0.26 'Step 2 duration'}}
            />
          </c.Parallel>
        </Choreo>

        <div class='slides-dots'>
          {{#each slides as |slide|}}
            <button
              type='button'
              class={{if (this.isOn slide) 'slides-dot is-on' 'slides-dot'}}
              aria-label={{dotLabel slide}}
              {{on 'click' (fn this.pick slide)}}
            ></button>
          {{/each}}
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
           The block padding was missing for a long time and it showed on any stage
           tall enough to fill the platter: the content sat flush against the top and
           bottom of the recess while keeping its 16px at the sides, which reads as
           content that has overflowed rather than content that has been placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      /* ---- Slides: three compositions of the same four elements ---- */

      .slides {
        display: flex;
        flex-direction: column;
        width: min(82cqw, 320px);
        height: min(74cqh, 430px);
        overflow: hidden;
        border: 1px solid var(--line-strong);
        border-radius: 22px;
        background: var(--bg-well);
        /* the type is sized against the deck, not the page. inline-size, not size:
           `container-type: size` on the region below it made the projection tree
           measure a contained box and strand its transforms. */
        container-type: inline-size;
      }

      .slides-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px 0;
      }

      .slides-pass {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .slides-next {
        border: 1px solid var(--line-strong);
        background: transparent;
        border-radius: 999px;
        padding: 5px 10px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-dim);
        cursor: pointer;
      }

      @media (hover: hover) {
        .slides-next:hover {
          color: var(--ink);
        }
      }

      /* the <Choreo> region: one slide's worth of space, and a container so the type
         can be sized against it */
      .slide {
        flex: 1;
        min-height: 0;
        margin: 10px 10px 0;
        overflow: hidden;
        border-radius: 16px;
        background: var(--bg-spot);
        cursor: pointer;
        /* horizontal swipes turn the page; vertical stays the page's scroll */
        touch-action: pan-y;
        /* deliberately NOT a container: this element is the <Choreo> region and the
           projection ancestor for everything in it */
        position: relative;
      }

      /* Every element is absolutely positioned, which is what makes this a deck
         rather than a document: each slide states where things ARE, and nothing
         pushes anything else around on the way. */
      .slide-plate,
      .slide-title,
      .slide-kicker,
      .slide-note {
        position: absolute;
      }

      .slide-plate {
        /* the radius is animated by the timeline from here — see radiusFor() */
        border-radius: 10px;
        overflow: clip;
        background: linear-gradient(
          160deg,
          #ff7a45 0%,
          #c42712 42%,
          #2a0c08 100%
        );
        box-shadow: 0 12px 28px
          rgba(var(--shadow-rgb), calc(0.35 * var(--shadow-a)));
      }

      /* fit-content on both, so projection scales the type between two real sizes
         instead of stretching a full-width box around it */
      .slide-title {
        width: fit-content;
        margin: 0;
        font-family: var(--font-display);
        font-weight: 800;
        letter-spacing: -0.05em;
        line-height: 0.92;
      }

      .slide-kicker {
        width: fit-content;
        color: var(--ink-dim);
        font-size: clamp(11px, 4cqw, 13px);
      }

      .slide-note {
        font-family: var(--font-mono);
        font-size: clamp(9px, 3.4cqw, 11px);
        font-style: normal;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ember-hot);
      }

      /* 1 — the title card: a small mark, everything centred */
      .slide[data-slide='0'] .slide-plate {
        top: 16%;
        left: calc(50% - 18px);
        width: 36px;
        height: 36px;
      }

      .slide[data-slide='0'] .slide-title {
        top: 34%;
        left: 50%;
        translate: -50% 0;
        font-size: clamp(2.4rem, 17cqw, 3.4rem);
      }

      .slide[data-slide='0'] .slide-kicker {
        top: 66%;
        left: 50%;
        translate: -50% 0;
      }

      /* 2 — the plate takes the right half and the type moves left */
      .slide[data-slide='1'] .slide-plate {
        top: 14px;
        right: 14px;
        bottom: 14px;
        left: auto;
        width: 52%;
        height: auto;
      }

      .slide[data-slide='1'] .slide-title {
        top: 20%;
        left: 18px;
        translate: none;
        font-size: clamp(1.5rem, 9.5cqw, 2rem);
      }

      .slide[data-slide='1'] .slide-kicker {
        top: 46%;
        left: 18px;
        translate: none;
      }

      .slide[data-slide='1'] .slide-note {
        left: 18px;
        bottom: 20px;
      }

      /* 3 — full bleed down the left edge, square corners */
      .slide[data-slide='2'] .slide-plate {
        top: 0;
        left: 0;
        bottom: 0;
        width: 28%;
        height: auto;
      }

      .slide[data-slide='2'] .slide-title {
        top: 26%;
        left: 36%;
        translate: none;
        font-size: clamp(1.6rem, 10cqw, 2.2rem);
      }

      .slide[data-slide='2'] .slide-kicker {
        top: 48%;
        left: 36%;
        translate: none;
      }

      .slide[data-slide='2'] .slide-note {
        left: 36%;
        bottom: 20%;
      }

      .slides-dots {
        display: flex;
        justify-content: center;
        gap: 8px;
        padding: 12px;
      }

      .slides-dot {
        width: 8px;
        height: 8px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: #5c564f;
        cursor: pointer;
      }

      .slides-dot.is-on {
        background: var(--ember-hot);
      }

      .choreo-site:not([data-theme='light']) .slides {
        background: #2a2521;
      }

      .choreo-site:not([data-theme='light']) .slide {
        background: #2e2925;
      }
    </style>
  </template>
}

/** the radius each composition asks for — animated, not switched */
function radiusFor(slide: Slide) {
  return ['10px', '18px', '0px'][slide]!;
}

function dotLabel(slide: Slide) {
  return `Slide ${slide + 1}`;
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('slides', radiusTween, 'radiusTween');
tuneMotion('slides', type, 'type');
tuneSpring('slides', plate, 'plate');
tuneSeconds('slides', 0.14, 'Step 1 duration');
tuneSeconds('slides', 0.26, 'Step 2 duration');

export class SlidesDemo extends GalleryDemo {
  static stage = Slides;
}
