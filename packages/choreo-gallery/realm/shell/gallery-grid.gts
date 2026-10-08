import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion, Presence } from 'glimmer-motion';

import { type GalleryDemo, GROUPS } from '../demo';
import type { Crossing } from '../lib/crossing';
import { highlightSample } from '../lib/highlight';
import type { GalleryNavigation } from '../lib/navigation';
import { restWhenOff } from '../lib/onstage';
import { DemoStage } from './demo-stage';
import { GalleryLink } from './gallery-link';

const ALL = 'All';
const DEEP_DIVE = 'Deep Dive';

const NO_PANEL: { id: string }[] = [];

/** somebody who has asked not to be moved is not asked twice */
const reducedMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;
const demoKey = (demo: GalleryDemo) => demo.slug;
const hasNotes = (demo: GalleryDemo) =>
  Boolean((demo.constructor as typeof GalleryDemo).notes);

/** a tile that was not in the old list arrives; one that survives just moves */
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
 * spring — what a filter looks like once the grid has stopped moving tiles.
 * A pure opacity change composites, needs no layout read, and does not care
 * how many demos are running underneath it.
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
    every tile in this grid is a live demo: running animations would freeze
    into images for the length of the switch.

    layout=true moves the real elements. The demos keep running while their
    tiles fly to new seats. }}
<LayoutGroup>
  <div class='grid'>
    <Presence @items={{this.demos}} @key={{demoKey}} @mode='popLayout'
      as |demo h|>
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

interface Signature {
  Args: {
    crossing: Crossing;
    demos: GalleryDemo[];
    nav: GalleryNavigation;
  };
}

export class GalleryGrid extends Component<Signature> {
  @tracked filter: string = ALL;

  /**
   * Whether the grid still moves tiles to their new seats on a filter.
   *
   * `layout=true` measures every surviving tile before and after and animates
   * the difference. It is also the expensive answer, and this page is dozens
   * of live demos on one thread. So the first filter of a session is
   * measured, and if it could not hold a frame rate the grid stops trying:
   * tiles fade instead. The decision is made once and kept.
   */
  @tracked private heavy = reducedMotion();

  /** frames slower than this are the ones a person sees as a stutter */
  private static readonly SLOW_MS = 34;
  @tracked code = false;

  /**
   * Mounted mid-crossing — the return trip — the stages wait for the
   * landing: booting every live demo is the heaviest render in the gallery,
   * and paying it inside the pass stutters the very flight the eye is
   * following. Released ONCE, permanently: a later opening crossing must fly
   * real pixels out of the tile.
   */
  @tracked private stagesReleased: boolean;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args);
    this.stagesReleased = !args.crossing.isCrossing;
    if (!this.stagesReleased) {
      void args.crossing.settled().then(() => {
        if (!this.isDestroying) {
          this.stagesReleased = true;
        }
      });
    }
  }

  get filters(): string[] {
    let filters = [ALL, ...GROUPS];
    return this.args.demos.some(hasNotes) ? [...filters, DEEP_DIVE] : filters;
  }

  get demos(): GalleryDemo[] {
    if (this.filter === ALL) {
      return this.args.demos;
    }
    if (this.filter === DEEP_DIVE) {
      return this.args.demos.filter(hasNotes);
    }
    return this.args.demos.filter((demo) => demo.group === this.filter);
  }

  get sample() {
    return highlightSample(SAMPLE);
  }

  get panel() {
    return this.code ? [{ id: 'filter-code' }] : NO_PANEL;
  }

  /**
   * …with ONE exception: the counterpart's own stage boards DURING the
   * crossing. The old skin dissolves over the receiving tile, and a dissolve
   * needs something real underneath.
   */
  stageLive = (slug: string) =>
    this.stagesReleased || slug === this.args.crossing.counterpart;

  /**
   * The unmatched tiles are not the crossing's to fade. During the trip home
   * only ONE tile is part of the Magic Move — the one the flight lands on; it
   * stands ready from the first frame. Every other tile holds dark for the
   * span and springs in once the crossing settles.
   */
  cardInitial = (slug: string) =>
    this.args.crossing.isCrossing && slug === this.args.crossing.counterpart
      ? this.herePose
      : this.enterPose;

  cardAnimate = (slug: string) =>
    this.stageLive(slug) ? this.herePose : this.enterPose;

  /** the counterpart's shell hides while its contents are the flight */
  veiled = (slug: string) =>
    this.args.crossing.active && slug === this.args.crossing.counterpart;

  isOn = (filter: string) => filter === this.filter;

  /**
   * Watch the frames a filter pass actually got: sampled rather than
   * predicted, at the cost of one rAF loop lasting about half a second.
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
      if (frames > 1 && dt > GalleryGrid.SLOW_MS) {
        slow += 1;
      }
      if (frames < 34) {
        requestAnimationFrame(tick);
      } else if (slow >= 8 && !this.isDestroying) {
        this.heavy = true;
      }
    };
    requestAnimationFrame(tick);
  }

  select = (filter: string) => {
    if (filter === this.filter) {
      return;
    }
    this.filter = filter;
    if (!this.heavy) {
      this.measure();
    }
  };

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
    <section class='hero' {{motion role='scene'}}>
      {{! the repo is Choreo; the thing you install is still glimmer-motion,
        so the eyebrow credits the package by name }}
      <p class='kicker'>Includes glimmer-motion</p>
      <h1>Motion,<br /><em>Choreographed.</em></h1>
      <p class='lede'>
        The
        <a
          href='https://motion.dev'
          target='_blank'
          rel='noopener noreferrer'
        >Motion</a>
        engine for Ember — and a timeline for the scene.
      </p>
      <div class='filter-row'>
        <div class='filters'>
          {{#each this.filters as |filter|}}
            <button
              type='button'
              class={{if (this.isOn filter) 'chip is-on' 'chip'}}
              aria-pressed={{if (this.isOn filter) 'true' 'false'}}
              {{on 'click' (fn this.select filter)}}
            >{{filter}}</button>
          {{/each}}
        </div>
        <button
          type='button'
          class={{if this.code 'filter-tell is-on' 'filter-tell'}}
          aria-expanded={{if this.code 'true' 'false'}}
          {{on 'click' this.toggleCode}}
        >
          <span class='filter-tell-mark' aria-hidden='true'>&lt;/&gt;</span>
          How this filters
        </button>
      </div>
      <Presence @items={{this.panel}} @key={{panelKey}} as |_panel h|>
        <section
          class='filter-code'
          aria-label='Filter code'
          {{motion
            presence=h
            initial=panelIn
            animate=panelHere
            exit=panelOut
            transition=panelSpring
          }}
        >
          <p class='sample-label'>Glimmer</p>
          <pre><code>{{this.sample}}</code></pre>
        </section>
      </Presence>
    </section>
    {{! The filter is the library's own job, not the browser's: layout=true
      moves the real elements, so the demos keep running the whole way
      across. }}
    <LayoutGroup>
      <div class='grid'>
        <Presence
          @items={{this.demos}}
          @key={{demoKey}}
          {{! popLayout, so the grid closes up WHILE the leavers fade rather
            than after them }}
          @mode='popLayout'
          {{! no initial=false: the presence context is INHERITED, so blocking
            the first entrance would block it for every motion node inside
            every demo as well }}
          as |demo h|
        >
          {{! The tile and its pieces are the crossing's participants. The ids
            pair with the demo page's own stage and type lines; on a filter
            pass the timeline is not rendered, so <Presence> keeps owning
            these same elements' exits. }}
          <article
            class={{if (this.veiled demo.slug) 'card is-veiled' 'card'}}
            {{! the crossing finds the tile it lands on by this attribute }}
            data-gallery-tile={{demo.slug}}
            {{motion
              role='card'
              presence=h
              layout=this.cardMoves
              initial=(this.cardInitial demo.slug)
              animate=(this.cardAnimate demo.slug)
              exit=this.exitPose
              transition=this.cardTransition
            }}
          >
            {{! Scrolled away, a tile stops animating — see restWhenOff }}
            <div
              class='card-stage'
              {{restWhenOff}}
              {{motion id=(concat 'stage-' demo.slug) role='stage'}}
            >
              {{#if (this.stageLive demo.slug)}}
                <DemoStage @demo={{demo}} />
              {{/if}}
            </div>
            <GalleryLink
              @href={{@nav.hrefFor demo.slug}}
              @onFollow={{fn @nav.go demo.slug}}
              class='card-meta'
            >
              <span
                class='card-group'
                {{motion id=(concat 'group-' demo.slug) role='type'}}
              >
                {{demo.group}}
                {{#if (hasNotes demo)}}
                  <span class='card-badge'>Deep Dive</span>
                {{/if}}
              </span>
              <span
                class='card-title'
                {{motion id=(concat 'title-' demo.slug) role='type'}}
              >{{demo.title}}</span>
              <span
                class='card-lede'
                {{motion id=(concat 'lede-' demo.slug) role='type'}}
              >{{demo.lede}}</span>
            </GalleryLink>
          </article>
        </Presence>
      </div>
    </LayoutGroup>
    <style scoped>
      .hero {
        display: grid;
        gap: 28px;
        padding-bottom: 56px;
        border-bottom: 1px solid var(--line);
        margin-bottom: 40px;
      }

      /* the hero's eyebrow is ember, so the word and the rule it draws for
         itself read as one accent */
      .kicker {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin: 0;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--copper-ink);
      }

      .choreo-site[data-theme='light'] .kicker {
        color: var(--ember);
      }

      .kicker::before {
        content: '';
        width: 18px;
        height: 1px;
        background: var(--ember);
        box-shadow: 0 0 12px var(--glow);
        /* drawn, not just present: the rule runs out from the left as the
           page arrives */
        transform-origin: left center;
        animation: kicker-rule 520ms cubic-bezier(0.2, 0, 0, 1) both;
      }

      @keyframes kicker-rule {
        from {
          transform: scaleX(0);
        }

        to {
          transform: scaleX(1);
        }
      }

      h1 {
        margin: 0;
        max-width: 14ch;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: clamp(3.4rem, 9vw, 7.2rem);
        letter-spacing: -0.055em;
        line-height: 0.95;
      }

      /* 'Choreographed.' in Syne at 800 would set the width of the whole
         heading; the condensed face keeps the word intact and lets the rest
         stay wide. 1.108em is measured so both lines share a right edge. */
      h1 em {
        font-family: var(--font-display-alt);
        font-weight: 700;
        font-stretch: 62%;
        font-variation-settings: 'wdth' 62;
        font-size: 1.108em;
        letter-spacing: -0.02em;
        font-style: normal;
        color: transparent;
        /* the tail fades toward --gradient-tail, which is --ink in dark mode
           and copper in light, where fading to --ink would turn muddy */
        background: linear-gradient(
          120deg,
          var(--ember-hot) 10%,
          var(--copper) 70%,
          var(--gradient-tail) 120%
        );
        background-clip: text;
        -webkit-background-clip: text;
      }

      .lede {
        max-width: 38rem;
        margin: 0;
        color: var(--ink-dim);
        font-size: 1.125rem;
      }

      .lede a {
        color: var(--ink);
        text-decoration: underline;
        text-decoration-color: var(--line-strong);
        text-underline-offset: 3px;
      }

      @media (hover: hover) {
        .lede a:hover {
          color: var(--ember-hot);
          text-decoration-color: var(--ember-hot);
        }
      }

      .filter-row {
        display: flex;
        align-items: center;
        gap: 14px;
        flex-wrap: wrap;
      }

      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .chip {
        border: 1px solid var(--line);
        background: transparent;
        color: var(--ink-dim);
        border-radius: 999px;
        padding: 7px 12px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      @media (hover: hover) {
        .chip:hover {
          color: var(--ink);
          border-color: var(--line-strong);
          background: var(--bg-spot);
        }
      }

      .chip.is-on {
        border-color: var(--line-strong);
        background: var(--bg-spot);
        box-shadow: inset 0 0 0 1px rgba(255, 59, 31, 0.35);
        color: var(--ember-hot);
      }

      /* the tell waits until the row is under the pointer, then says what
         this is */
      .filter-tell {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border: 1px solid transparent;
        border-radius: 999px;
        background: none;
        color: var(--ink-faint);
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        cursor: pointer;
        opacity: 0;
        translate: -6px 0;
        transition:
          opacity 160ms ease,
          translate 160ms ease,
          color 160ms ease,
          border-color 160ms ease;
      }

      .filter-row:focus-within .filter-tell,
      .filter-tell.is-on {
        opacity: 1;
        translate: 0 0;
      }

      @media (hover: hover) {
        .filter-row:hover .filter-tell {
          opacity: 1;
          translate: 0 0;
        }

        .filter-tell:hover {
          color: var(--copper-ink);
          border-color: var(--line-strong);
        }
      }

      /* a tell that waits for a pointer is a tell a finger never sees */
      @media (hover: none) {
        .filter-tell {
          opacity: 1;
          translate: 0 0;
        }
      }

      .filter-tell.is-on {
        color: var(--copper-ink);
        border-color: var(--line-strong);
      }

      .filter-tell-mark {
        font-size: 11px;
        letter-spacing: 0;
        color: var(--ember-hot);
      }

      .filter-code {
        border: 1px solid var(--line);
        border-radius: 16px;
        background: rgba(var(--surface-tint-rgb), 0.03);
        overflow: hidden;
      }

      .sample-label {
        margin: 0;
        padding: 14px 18px 0;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--copper-ink);
      }

      .filter-code pre {
        margin: 0;
        padding: 4px 18px 18px;
        overflow-x: auto;
      }

      .filter-code code {
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.55;
        color: var(--ink);
        white-space: pre;
        -webkit-user-select: text;
        user-select: text;
      }

      .grid {
        /* popLayout lifts a leaving tile out of flow and places it against
           this box, so this box has to be one */
        position: relative;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr));
        gap: 16px;
      }

      /* NOT content-visibility: auto — a skipped tile is not painted, so the
         tile the crossing travels to would have nothing in it to fly */
      .card {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 100%;
        border: 1px solid var(--line);
        background:
          linear-gradient(
            180deg,
            rgba(var(--surface-tint-rgb), 0.02),
            transparent 40%
          ),
          var(--bg-elev);
        border-radius: 18px;
        overflow: hidden;
        transition: border-color 180ms var(--ease);
      }

      @media (hover: hover) {
        .card:hover {
          border-color: var(--line-strong);
        }
      }

      /* the counterpart tile of a return crossing: its contents ARE the
         flight, so its own ground hides for exactly that long */
      .card.is-veiled {
        background: transparent;
        border-color: transparent;
        transition: none;
      }

      .card-stage {
        position: relative;
        height: 400px;
        /* a NAMED size container, so a stage can ask about the platter
           specifically rather than whichever container is nearest */
        container-name: platter;
        container-type: size;
        background:
          radial-gradient(
            80% 70% at 50% 40%,
            rgba(255, 59, 31, 0.08),
            transparent 62%
          ),
          var(--bg);
      }

      /* A tile nobody can see holds its animations where they stand —
         paused, so coming back does not restart every loop */
      .card-stage.is-resting,
      .card-stage.is-resting :deep(*) {
        animation-play-state: paused !important;
      }

      .card-meta {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 16px 18px 18px;
        border-top: 1px solid var(--line);
        background: rgba(var(--surface-tint-rgb), 0.015);
      }

      @media (hover: hover) {
        .card-meta:hover .card-title {
          color: var(--ember-hot);
        }
      }

      .card-group {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ember-hot);
      }

      .card-badge {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 6px;
        font-size: 9px;
        font-family: var(--font-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ember);
        border: 1px solid var(--ember);
        border-radius: 3px;
        opacity: 0.7;
        vertical-align: middle;
      }

      .card-title {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 1.2rem;
        letter-spacing: -0.03em;
      }

      .card-lede {
        color: var(--ink-dim);
        font-size: 0.92rem;
      }

      @media (max-width: 720px) {
        .hero {
          gap: 20px;
          padding-bottom: 36px;
          margin-bottom: 28px;
        }

        h1 {
          font-size: clamp(2.6rem, 14vw, 4.4rem);
        }

        .chip {
          padding: 9px 14px;
        }

        .filter-code code {
          font-size: 11px;
        }

        .card-stage {
          height: min(380px, 68vh);
        }
      }
    </style>
  </template>
}
