import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion, Presence } from 'glimmer-motion';
import { catalog, groups } from 'test-app/lib/catalog';
import {
  counterpartId,
  crossingActive,
  crossingSettled,
} from 'test-app/lib/crossing';
import { highlightSample } from 'test-app/lib/highlight';
import { isCrossing } from 'test-app/lib/tempo';

const DEEP_DIVE = 'Deep Dive';
const filters = ['All', ...groups, DEEP_DIVE] as const;
type Filter = (typeof filters)[number];

const NO_PANEL: { id: string }[] = [];

/** somebody who has asked not to be moved is not asked twice */
const reducedMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;
const demoKey = (demo: { id: string }) => demo.id;

/** a card that was not in the old list arrives; one that survives just moves */
const cardIn = { opacity: 0, scale: 0.96 };
const cardHere = { opacity: 1, scale: 1 };
const cardOut = { opacity: 0, scale: 0.96 };
const cardSpring = {
  bounce: 0.12,
  type: 'spring',
  visualDuration: 0.42,
} as const;

/**
 * The same three poses with the scale taken out, and a tween instead of a
 * spring — what a filter looks like once the grid has stopped moving cards.
 *
 * A pure opacity change is the one thing that stays cheap when the page is
 * already saturated: it composites, it needs no layout read, and it does not
 * care how many demos are running underneath it.
 */
const flatIn = { opacity: 0 };
const flatHere = { opacity: 1 };
const flatOut = { opacity: 0 };
const flatFade = { duration: 0.18, ease: 'easeOut' } as const;
const panelKey = (item: { id: string }) => item.id;
const panelIn = { opacity: 0, y: -10 };
const panelHere = { opacity: 1, y: 0 };
const panelOut = { opacity: 0, y: -6 };
const panelSpring = {
  bounce: 0.14,
  type: 'spring',
  visualDuration: 0.34,
} as const;

const SAMPLE = `{{! Filtering this list is a layout animation, not a page transition.

    A View Transition would be the obvious reach — and the wrong one here.
    It works by snapshotting the page into bitmaps and crossfading them, and
    every card in this grid is a live demo: two dozen running animations would
    freeze into images for the length of the switch, and the page's own root
    layer would blank out underneath.

    layout=true moves the real elements. The demos keep running while their
    cards fly to new seats. }}
<LayoutGroup>
  <div class='grid'>
    <Presence
      @items={{this.demos}}
      @key={{demoKey}}
      @mode='sync'           {{! popLayout is the one to want here, and the
                                 one that cannot be used yet }}
      {{! no initial=false here: the presence context is inherited, so
          blocking the first entrance would block it for every motion node
          inside every card as well }}
      as |demo h|
    >
      <article
        class='card'
        {{motion
          presence=h
          layout=true        {{! measure before, measure after, animate the difference }}
          initial=cardIn
          animate=cardHere
          exit=cardOut
          transition=cardSpring
        }}
      >…</article>
    </Presence>
  </div>
</LayoutGroup>

// and the filter itself is just state
select = (filter) => {
  this.filter = filter;
};`;

export class Gallery extends Component {
  @tracked filter: Filter = 'All';

  /**
   * Whether the grid still moves cards to their new seats on a filter.
   *
   * `layout=true` measures every surviving card before and after and animates
   * the difference, which is the right answer and the honest one: the demos
   * keep running while their cards fly. It is also the expensive one, and this
   * page is forty-two live demos on one thread. On a machine that cannot afford
   * it the flight is not a flight — it is a series of stills, which is a worse
   * advertisement for a motion library than no flight at all.
   *
   * So the first filter of a session is measured, and if it could not hold a
   * frame rate the grid stops trying: cards fade instead. The decision is made
   * once and kept, because a grid that moves cards on one press and not the
   * next is more unsettling than either behaviour on its own.
   */
  @tracked private heavy = reducedMotion();

  /** frames slower than this are the ones a person sees as a stutter */
  private static readonly SLOW_MS = 34;
  @tracked code = false;

  /**
   * Mounted mid-crossing — the return trip — the stages wait for the
   * landing: booting thirty live demos is the single heaviest render in
   * the app, and paying it inside the pass stutters the very flight the
   * eye is following. Until the crossing settles the cards are their
   * chrome and type over the stage's own ground — which is exactly what
   * the old system showed too, one way or another — and the demos come
   * alive the moment the move lands. Released ONCE, permanently: a later
   * OPENING crossing must fly real pixels out of the card.
   */
  @tracked private stagesReleased = !isCrossing();

  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    if (!this.stagesReleased) {
      void crossingSettled().then(() => {
        if (!this.isDestroying) {
          this.stagesReleased = true;
        }
      });
    }
  }

  /**
   * …with ONE exception: the counterpart's own stage boards DURING the
   * crossing. The old skin dissolves [1 -> 0] over the receiving tile,
   * and a dissolve needs something real underneath — the live demo
   * reaches full presence exactly as the snapshot reaches none. One
   * demo booting inside the pass is the price of the crossfade; the
   * other twenty-nine still wait for the landing.
   */
  stageLive = (id: string) => this.stagesReleased || id === counterpartId();

  get demos() {
    if (this.filter === 'All') {
      return catalog;
    }
    if (this.filter === DEEP_DIVE) {
      return catalog.filter((demo) => demo.notes);
    }
    return catalog.filter((demo) => demo.group === this.filter);
  }

  /**
   * The unmatched tiles are not the crossing's to fade. During the trip
   * home only ONE card is part of the Magic Move — the one the flight
   * lands on; it stands ready from the first frame (veiled shell, visible
   * contents). Every other tile holds dark for the span and springs in
   * once the crossing settles, so nothing competes with the move for
   * animation frames while it is telling its story.
   */
  cardInitial = (id: string) =>
    isCrossing() && id === counterpartId() ? this.herePose : this.enterPose;

  cardAnimate = (id: string) =>
    this.stagesReleased || id === counterpartId()
      ? this.herePose
      : this.enterPose;

  /** the counterpart's shell hides while its contents are the flight —
   *  empty space where the card would be, exactly as long as needed */
  veiled = (id: string) => crossingActive() && id === counterpartId();

  get panel() {
    return this.code ? [{ id: 'filter-code' }] : NO_PANEL;
  }

  get sample() {
    return highlightSample(SAMPLE);
  }

  /**
   * Watch the frames a filter pass actually got.
   *
   * Sampled rather than predicted. Counting cards, or reading `hardwareConcurrency`,
   * or asking how many demos are live all guess at the answer; the frame clock
   * during a real pass IS the answer, and it costs one rAF loop lasting about
   * half a second.
   */
  private measure() {
    let last = performance.now();
    let frames = 0;
    let slow = 0;
    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      frames += 1;
      // the first frame after a render is long for reasons that are not the
      // animation's fault, so it is not counted against it
      if (frames > 1 && dt > Gallery.SLOW_MS) {
        slow += 1;
      }
      if (frames < 34) {
        requestAnimationFrame(tick);
      } else if (slow >= 8) {
        this.heavy = true;
      }
    };
    requestAnimationFrame(tick);
  }

  select = (filter: Filter) => {
    if (filter === this.filter) {
      return;
    }
    this.filter = filter;
    if (!this.heavy) {
      this.measure();
    }
  };

  /** what a card does on a filter: fly to its new seat, or simply appear */
  get cardMoves() {
    return !this.heavy;
  }

  get enterPose() {
    return this.heavy ? flatIn : cardIn;
  }

  get herePose() {
    return this.heavy ? flatHere : cardHere;
  }

  get exitPose() {
    return this.heavy ? flatOut : cardOut;
  }

  get cardTransition() {
    return this.heavy ? flatFade : cardSpring;
  }

  toggleCode = () => {
    this.code = !this.code;
  };

  <template>
    {{! role='scene': the crossing gives the hero its own exit — it rises
        out — and fades it back in on the way home }}
    <section class="hero" {{motion role="scene"}}>
      {{! the repo is Choreo; the thing you install is still glimmer-motion,
          so the eyebrow credits the package by name }}
      <p class="kicker">Includes glimmer-motion</p>
      <h1>Motion,<br /><em>Choreographed.</em></h1>
      <p class="lede">
        The
        <a href="https://motion.dev" target="_blank" rel="noopener">Motion</a>
        engine for Ember — and a timeline for the scene.
      </p>
      {{! the row is itself the demo: switching the list is a View Transition,
          and the tell sits at the end of the row until you go looking }}
      <div class="filter-row">
        <div class="filters">
          {{#each filters as |filter|}}
            <button
              type="button"
              class={{if (eq filter this.filter) "chip is-on" "chip"}}
              {{on "click" (fn this.select filter)}}
            >{{filter}}</button>
          {{/each}}
        </div>
        <button
          type="button"
          class={{if this.code "filter-tell is-on" "filter-tell"}}
          aria-expanded={{if this.code "true" "false"}}
          {{on "click" this.toggleCode}}
        >
          <span class="filter-tell-mark" aria-hidden="true">&lt;/&gt;</span>
          How this filters
        </button>
      </div>

      <Presence @items={{this.panel}} @key={{panelKey}} as |_panel h|>
        <section
          class="filter-code"
          aria-label="Filter code"
          {{motion
            presence=h
            initial=panelIn
            animate=panelHere
            exit=panelOut
            transition=panelSpring
          }}
        >
          <p class="sample-label">Glimmer</p>
          <pre><code>{{this.sample}}</code></pre>
        </section>
      </Presence>
    </section>

    {{! The filter is this library's own job, not the browser's. Every card is
        a live demo; a View Transition would snapshot all of them into bitmaps
        and crossfade the result. layout=true moves the real elements instead,
        so the demos keep running the whole way across. }}
    <LayoutGroup>
      <div class="grid">
        <Presence
          @items={{this.demos}}
          @key={{demoKey}}
          {{! sync, not popLayout: a popLayout leaver here never reports its
              exit complete, so the card stays in the DOM at opacity 0 and
              coming back leaves it stuck there. }}
          {{! No initial=false handle here, however tempting: the presence
              context is INHERITED, so blocking the first entrance blocks it
              for every motion node inside every demo as well — the pour log
              arrives already scrolled, and a looping keyframe animation is
              seeded at its last frame instead of running. The cards fading in
              once on load is the cheaper price. }}
          as |demo h|
        >
          {{! The card and its pieces are the crossing's participants. The
              card itself (role='card') is a leaver the crossing dissolves —
              naming a container of named things is LEGAL here: the claimed
              stage and type are lifted out of it into the flight, leaving
              holes where the eye expects them. The ids pair with the demo
              page's own stage and type lines, exactly as far matching
              already pairs ids. On a FILTER pass the timeline is not
              rendered, so the region compiles nothing and <Presence> keeps
              owning these same elements' exits. }}
          <article
            class="card{{if (this.veiled demo.id) ' is-veiled'}}"
            data-demo={{demo.id}}
            {{motion
              role="card"
              presence=h
              layout=this.cardMoves
              initial=(this.cardInitial demo.id)
              animate=(this.cardAnimate demo.id)
              exit=this.exitPose
              transition=this.cardTransition
            }}
          >
            <div
              class="card-stage"
              {{motion id=(concat "stage-" demo.id) role="stage"}}
            >
              {{#if (this.stageLive demo.id)}}
                {{#let demo.Example as |Example|}}
                  <Example />
                {{/let}}
              {{/if}}
            </div>
            <LinkTo @route="demo" @model={{demo.id}} class="card-meta">
              <span
                class="card-group"
                {{motion id=(concat "group-" demo.id) role="type"}}
              >
                {{demo.group}}
                {{#if demo.notes}}
                  <span class="card-badge">Deep Dive</span>
                {{/if}}
              </span>
              <span
                class="card-title"
                {{motion id=(concat "title-" demo.id) role="type"}}
              >{{demo.title}}</span>
              <span
                class="card-lede"
                {{motion id=(concat "lede-" demo.id) role="type"}}
              >{{demo.lede}}</span>
            </LinkTo>
          </article>
        </Presence>
      </div>
    </LayoutGroup>
  </template>
}

function eq(left: Filter, right: Filter) {
  return left === right;
}
