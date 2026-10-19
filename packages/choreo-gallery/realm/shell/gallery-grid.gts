import type { BoxComponent } from '@cardstack/base/card-api';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion, Presence } from 'glimmer-motion';

import { type GalleryDemo, GROUPS } from '../demo';
import { highlightSample } from '../lib/highlight';

const ALL = 'All';
const DEEP_DIVE = 'Deep Dive';

const NO_PANEL: { id: string }[] = [];

/** somebody who has asked not to be moved is not asked twice */
const reducedMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;
const tileKey = (tile: GalleryTile) => tile.demo.slug;
const hasNotes = (demo: GalleryDemo) =>
  Boolean((demo.constructor as typeof GalleryDemo).notes);

/**
 * One tile of the grid: the demo, and the gallery's field component for it,
 * which renders the demo card in a format of its own. The host owns that
 * component, so a click on the tile opens the demo card through the host.
 */
export interface GalleryTile {
  Card: BoxComponent;
  demo: GalleryDemo;
}

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
    <Presence @items={{this.tiles}} @key={{tileKey}} @mode='popLayout'
      as |tile h|>
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
      ><tile.Card @format='fitted' /></article>
    </Presence>
  </div>
</LayoutGroup>

// and the filter itself is just state
select = (filter) => {
  this.filter = filter;
};`;

interface Signature {
  Args: {
    /** opens a demo card through the host */
    onOpen: (demo: GalleryDemo) => void;
    tiles: GalleryTile[];
  };
}

export class GalleryGrid extends Component<Signature> {
  @tracked filter: string = ALL;
  /** whether a filter has been chosen yet, which starts the announcements */
  @tracked private filtered = false;

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

  get filters(): string[] {
    let filters = [ALL, ...GROUPS];
    return this.args.tiles.some(({ demo }) => hasNotes(demo))
      ? [...filters, DEEP_DIVE]
      : filters;
  }

  get tiles(): GalleryTile[] {
    if (this.filter === ALL) {
      return this.args.tiles;
    }
    if (this.filter === DEEP_DIVE) {
      return this.args.tiles.filter(({ demo }) => hasNotes(demo));
    }
    return this.args.tiles.filter(({ demo }) => demo.group === this.filter);
  }

  get sample() {
    return highlightSample(SAMPLE);
  }

  get panel() {
    return this.code ? [{ id: 'filter-code' }] : NO_PANEL;
  }

  isOn = (filter: string) => filter === this.filter;

  /**
   * What the grid shows, for a status a screen reader announces when a
   * filter changes it. It stays empty until the first filter, so demos
   * arriving as the page loads are not counted aloud.
   */
  get shown(): string {
    if (!this.filtered) {
      return '';
    }
    let total = this.args.tiles.length;
    return this.filter === ALL
      ? `All ${total} demos`
      : `${this.filter}: ${this.tiles.length} of ${total} demos`;
  }

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
    this.filtered = true;
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

  /**
   * A click on a tile that nothing inside it kept: where the host has an
   * overlay, the overlay has already opened the card and kept the click.
   */
  open = (demo: GalleryDemo) => {
    this.args.onOpen(demo);
  };

  <template>
    <section class='hero'>
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
        >Motion<span class='sr-only'> (opens in a new tab)</span></a>
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
      <p class='sr-only' role='status'>{{this.shown}}</p>
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
          @items={{this.tiles}}
          @key={{tileKey}}
          {{! popLayout, so the grid closes up WHILE the leavers fade rather
            than after them }}
          @mode='popLayout'
          {{! no initial=false: the presence context is INHERITED, so blocking
            the first entrance would block it for every motion node inside
            every demo as well }}
          as |tile h|
        >
          {{! The tile is the demo card itself, in its fitted format: the host
            renders it, so a click anywhere on it opens the demo card. The
            card's title is its link, and the keyboard's way in; the click
            here is the mouse's, for a host with no overlay to take it. }}
          <article
            {{! template-lint-disable no-invalid-interactive }}
            class='card'
            data-gallery-tile={{tile.demo.slug}}
            {{on 'click' (fn this.open tile.demo)}}
            {{! a leaving tile is on its way out: it takes no pointer, focus or
              screen reader, so nothing reaches a tile that is fading away }}
            inert={{unless h.isPresent true}}
            {{motion
              presence=h
              layout=this.cardMoves
              initial=this.enterPose
              animate=this.herePose
              exit=this.exitPose
              transition=this.cardTransition
            }}
          >
            <tile.Card @format='fitted' @displayContainer={{false}} />
          </article>
        </Presence>
      </div>
    </LayoutGroup>
    <style scoped>
      /* the hero is a container, so the headline can size against the
         hero's own width rather than the window's: in a host stack the
         two differ */
      .hero {
        container-type: inline-size;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
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
        color: var(--eyebrow);
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

      /* for a viewer who asked for less movement, the rule is simply there */
      @media (prefers-reduced-motion: reduce) {
        .kicker::before {
          animation: none;
        }
      }

      h1 {
        margin: 0;
        max-width: 14ch;
        font-family: var(--font-display);
        font-weight: 800;
        /* 'Choreographed.' is one word, about 5.5em wide in the condensed
           face, and can't wrap: 17.5cqi keeps it inside the hero however
           narrow the hero is, and only binds where the window-sized type
           would not fit */
        font-size: min(clamp(3.4rem, 9vw, 7.2rem), 17.5cqi);
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
           and copper in light, where fading to --ink would turn muddy.
           The bright accents are a deliberate brand treatment in both
           themes. On light cream they fall under the 3:1 large-text
           minimum (ember-hot 2.4:1, copper about 1.8:1, lower under the
           page's ember glow), which is accepted for this word: it is set
           at display size and stays in the heading's accessible name.
           The -ink stops (--ember-ink to --copper-ink) would clear 3:1
           in light but read too dull for the hero. */
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
          color: var(--ember-ink);
          text-decoration-color: var(--ember-ink);
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
        /* full ink: the raised ground and the ember ring say selected, and
           --ember-ink falls under 4.5:1 on --bg-spot in the dark palette */
        color: var(--ink);
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
        color: var(--ember-ink);
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
        color: var(--eyebrow);
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

      /* the tile's box: the demo card's fitted format fills it */
      .card {
        position: relative;
        min-width: 0;
        height: 540px;
        border: 1px solid var(--line);
        border-radius: 18px;
        /* the tile inside rounds its focus ring to this box's inner edge */
        --tile-radius: 17px;
        overflow: hidden;
        background: var(--bg-elev);
        cursor: pointer;
        transition: border-color 180ms var(--ease);
      }

      @media (hover: hover) {
        .card:hover {
          border-color: var(--line-strong);
        }
      }

      @media (max-width: 720px) {
        .hero {
          gap: 20px;
          padding-bottom: 36px;
          margin-bottom: 28px;
        }

        h1 {
          font-size: min(clamp(2.6rem, 14vw, 4.4rem), 17.5cqi);
        }

        .chip {
          padding: 9px 14px;
        }

        .filter-code code {
          font-size: 11px;
        }

        .card {
          height: min(520px, 82vh);
        }
      }
    </style>
  </template>
}
