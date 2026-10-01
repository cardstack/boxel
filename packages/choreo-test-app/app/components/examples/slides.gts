import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion, spring, to } from 'glimmer-motion';
import { tuneMotion, tuneSeconds, tuneSpring } from 'test-app/lib/demo-tuning';

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

  down = (event: PointerEvent) => {
    this.downAt = { x: event.clientX, y: event.clientY };
  };

  up = (event: PointerEvent) => {
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
    <div class="ex">
      <div class="slides">
        <div class="slides-bar">
          <small class="slides-pass">{{this.pass}}</small>
          <button type="button" class="slides-next" {{on "click" this.advance}}>
            Next
          </button>
        </div>

        <Choreo
          class="slide"
          data-slide={{this.slide}}
          {{on "click" this.tap}}
          {{on "pointerdown" this.down}}
          {{on "pointerup" this.up}}
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
            class="slide-plate"
            {{motion
              id="plate"
              role="plate"
              animate=(to borderRadius=(radiusFor this.slide))
              transition=(tuneMotion "slides" radiusTween "radiusTween")
            }}
          ></span>

          <b
            class="slide-title"
            {{motion
              id="title"
              role="type"
              layout=true
              transition=(tuneMotion "slides" type "type")
            }}
          >Kiln</b>

          <small
            class="slide-kicker"
            {{motion
              id="kicker"
              role="type"
              layout=true
              transition=(tuneMotion "slides" type "type")
            }}
          >Night shift</small>

          {{#if this.note}}
            <em
              class="slide-note"
              {{motion id="note" role="note"}}
            >{{this.note}}
            </em>
          {{/if}}

          <c.Parallel>
            {{! The plate's own box: left, top, width and height as real
                values, so its gradient and shadow are re-rendered at every
                size rather than stretched. }}
            <c.Move
              @of={{c.moved "plate"}}
              @spring={{tuneSpring "slides" plate "plate"}}
            />

            {{! The note is the only thing that comes and goes. It leaves fast
                and arrives late, so the slide is never carrying two of them. }}
            <c.Tween
              @of={{c.removed "note"}}
              @opacity={{0}}
              @duration={{tuneSeconds "slides" 0.14 "Step 1 duration"}}
            />
            <c.Tween
              @of={{c.inserted "note"}}
              @opacity={{array 0 1}}
              @delay={{0.22}}
              @duration={{tuneSeconds "slides" 0.26 "Step 2 duration"}}
            />
          </c.Parallel>
        </Choreo>

        <div class="slides-dots">
          {{#each slides as |slide|}}
            <button
              type="button"
              class={{if (this.isOn slide) "slides-dot is-on" "slides-dot"}}
              aria-label={{dotLabel slide}}
              {{on "click" (fn this.pick slide)}}
            ></button>
          {{/each}}
        </div>
      </div>
    </div>
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
