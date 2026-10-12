import type { ChoreoContext } from '@cardstack/choreo';
import { beacon, Choreo } from '@cardstack/choreo';
import type { TOC } from '@ember/component/template-only';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, Presence } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneMotion, tuneSeconds } from '../lib/tuning';
import PresentationNotes from '../notes/presentation';

const IN = 0.32;
/** the beat one element trails another INSIDE a single gate — the whole
 *  reason the deck is ten clicks and not twenty: things that belong to the
 *  same thought arrive together, a breath apart, on one press. */
const CHASE = 0.16;
const GROUP = 0.4;
const FLIGHT = 1.18;
const PULSE = 0.46;
const GLIDE = [0.22, 1, 0.36, 1] as const;
const LAST = 4;
const SLIDES = [0, 1, 2, 3, 4] as const;
const XFADE_T = { duration: 0.48, ease: [0.22, 1, 0.36, 1] } as const;

/* ── the figure ──────────────────────────────────────────────────────────
 *
 * One drawing, built from real geometry rather than a hand-waved squiggle.
 * It has exactly one path the timeline draws (@pathLength) and one bead the
 * timeline flies (c.Move + @path), so the art and the score are the same
 * object seen twice. The title slide deliberately has no figure at all —
 * type, scale and colour carry it.
 */

/** the route: five nodes, one polyline, drawn left to right */
const HOP =
  'M 24 82 C 46 50, 62 32, 88 29 S 128 69, 152 75 S 194 31, 220 25 S 264 54, 292 64';
/** the packet's flight along it, relative to the first node */
const HOP_RIDE =
  'M 0 0 C 22 -32, 38 -50, 64 -53 S 104 -13, 128 -7 S 170 -51, 196 -57 S 240 -28, 268 -18';

/** where the mesh's nodes sit, and the hue each one carries */
const NODES = [
  { cx: 24, cy: 82, key: 'n0', tone: 'is-halo' },
  { cx: 88, cy: 29, key: 'n1', tone: 'is-flux' },
  { cx: 152, cy: 75, key: 'n2', tone: 'is-halo' },
  { cx: 220, cy: 25, key: 'n3', tone: 'is-flux' },
  { cx: 292, cy: 64, key: 'n4', tone: 'is-ember' },
] as const;

const DAYS = [
  { id: 's2-d0', name: 'SFO' },
  { id: 's2-d1', name: 'ORD' },
  { id: 's2-d2', name: 'DUB' },
  { id: 's2-d3', name: 'FRA' },
  { id: 's2-d4', name: 'SIN' },
] as const;

const LINES = [
  {
    copy: 'c-a',
    id: 'cell-a',
    n: '01',
    rule: 'r-a',
    text: 'Nothing waits twice.',
    tick: 't-a',
  },
  {
    copy: 'c-b',
    id: 'cell-b',
    n: '02',
    rule: 'r-b',
    text: 'The edge is the middle.',
    tick: 't-b',
  },
  {
    copy: 'c-c',
    id: 'cell-c',
    n: '03',
    rule: 'r-c',
    text: 'Distance is a decision.',
    tick: 't-c',
  },
] as const;

const MOVES = [
  {
    copy: 'm1-copy',
    id: 'm1',
    n: '01',
    name: 'Edge',
    num: 'm1-num',
    rule: 'm1-rule',
    text: 'Compute where it lands.',
    title: 'm1-title',
  },
  {
    copy: 'm2-copy',
    id: 'm2',
    n: '02',
    name: 'Mesh',
    num: 'm2-num',
    rule: 'm2-rule',
    text: 'Every node a front door.',
    title: 'm2-title',
  },
  {
    copy: 'm3-copy',
    id: 'm3',
    n: '03',
    name: 'Seal',
    num: 'm3-num',
    rule: 'm3-rule',
    text: 'Signed at the boundary.',
    title: 'm3-title',
  },
] as const;

/** the ground each slide is printed on, in order */
const GROUNDS = ['is-atlas', 'is-paper', 'is-split', 'is-flux', 'is-ember'];

type Xfade = 'fade' | 'push' | 'rise' | 'scale';
const XFADES: Xfade[] = ['fade', 'rise', 'scale', 'push'];

const pageKey = (page: { id: number; pass: number }) =>
  `${page.id}.${page.pass}`;

type SlideHost = HTMLElement & {
  choreoCtx?: ChoreoContext;
  innerCtx?: ChoreoContext;
  presentation?: Presentation;
};
/** inner Presence never leaves — so Choreo participants do not register as
 *  the slide plate's exit children (they have no `exit` of their own). */
const HOLD = [{ id: 'hold' }];
const holdKey = (item: { id: string }) => item.id;

/**
 * MESH — the route figure.
 *
 * Five nodes and the one hop that joins them. The faint chords are the paths
 * NOT taken; the bright polyline is the one the packet rides.
 */
const Mesh: TOC<{
  Args: { lineId: string };
  Element: SVGSVGElement;
}> = <template>
  <svg class='pres-fig' viewBox='0 0 320 110' aria-hidden='true' ...attributes>
    <path
      class='pres-chord'
      d='M24 82 L152 75 M88 29 L220 25 M152 75 L292 64 M24 82 L88 29'
    />
    <path class='pres-ghost' d={{HOP}} />
    <path
      class='pres-stroke is-build'
      d={{HOP}}
      {{motion id=@lineId role='build'}}
    />
    {{#each NODES as |n|}}
      <circle class='pres-node {{n.tone}}' cx={{n.cx}} cy={{n.cy}} r='4.5' />
      <circle class='pres-node-ring' cx={{n.cx}} cy={{n.cy}} r='9' />
    {{/each}}
  </svg>
  <style scoped>
    /* builds start invisible; the timeline writes them. Back-arrive skips the
       timeline and shows the still — the previous slide, already built. */
    .pres-slide .is-build {
      opacity: 0;
    }

    .pres-slide[data-arrive='back'] .is-build {
      opacity: 1;
      transform: none;
    }

    /* The split is the one ground where a single ink cannot serve the slide: the
       figure runs across the cut, so anything derived from --sl-ink (dark, for
       the paper half) disappears into the steel half — black on black, the exact
       trap. These take a MID tone instead, which holds on cream and on steel. */
    .pres-slide.is-split .pres-ghost,
    .pres-slide.is-split .pres-chord,
    .pres-slide.is-split .pres-node-ring {
      stroke: rgba(140, 138, 134, 0.62);
    }

    /* ---- the figures ---- */

    .pres-fig {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    .pres-ghost,
    .pres-stroke {
      fill: none;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* the path not yet drawn: the same line, at a whisper */
    .pres-ghost {
      stroke: color-mix(in srgb, var(--sl-ink) 16%, transparent);
    }

    /* the one line the timeline pulls on with @pathLength */
    .pres-stroke {
      stroke: var(--sl-accent);
      filter: drop-shadow(
        0 0 6px color-mix(in srgb, var(--sl-accent) 45%, transparent)
      );
    }

    /* MESH — the chords are the routes NOT taken */
    .pres-chord {
      fill: none;
      stroke: color-mix(in srgb, var(--sl-ink) 10%, transparent);
      stroke-width: 1;
      stroke-dasharray: 3 4;
    }

    .pres-node-ring {
      fill: none;
      stroke: color-mix(in srgb, var(--sl-ink) 18%, transparent);
      stroke-width: 1;
    }

    /* the accent set — Halo, Flux and Ember as marks. The deck's one place for
       more than a single hue, and all three come from the brand's own ramps. */
    .pres-node.is-halo {
      fill: #edce9e;
    }

    .pres-node.is-flux {
      fill: #9aa2a8;
    }

    .pres-node.is-ember {
      fill: #f2843e;
    }
  </style>
</template>;

/**
 * Inner region: first render compiles no timeline, so the score waits one
 * frame for participants to exist, then plays. Outer never sees these ids.
 */
class InnerScene extends Component<{
  Blocks: { default: [ChoreoContext] };
}> {
  @tracked go = false;
  boot = modifier(() => {
    const id = requestAnimationFrame(() => {
      this.go = true;
    });
    return () => cancelAnimationFrame(id);
  });

  <template>
    <Choreo class='pres-inner' {{this.boot}} as |c|>
      {{#if this.go}}
        {{yield c}}
      {{/if}}
    </Choreo>
    <style scoped>
      .pres-inner {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
    </style>
  </template>
}

/**
 * A presentation is a run that parks — and a deck is five of those, in a row.
 *
 * TEN CLICKS, end to end. Six of them open a gate; four turn the page. That
 * budget is the whole design: anything that belongs to one thought arrives on
 * one press, a breath apart (see CHASE), rather than dribbling out a beat per
 * click. The week on slide 03 used to be five clicks and is now one @stagger;
 * the third verse and the third move each chase the second instead of asking
 * again. Only the title slide gets two gates — it is the opening, it earns
 * the extra beat — and the deck accelerates from there to a single-gate close.
 *
 * Click the plate to open the next gate on this slide. Mash mid-build and the
 * segment completes rather than skipping. When the slide is done, the same
 * click turns the page. The arrows in the imprint change slides outright; they
 * do not play builds. Back shows the previous slide already built.
 *
 * Keys (once the deck is focused — the copper hairline): Space is a click,
 * < / > (and the arrow keys) turn the page.
 *
 * Slides crossfade through Presence (sync — leaver and newcomer together).
 * The fade kind is a control on the imprint. Slides 02 and 04 keep a nested
 * <Choreo> for the verse / the system: an inner region with its own score,
 * a preamble that plays itself, then a gate you click.
 */
export class Presentation extends Component {
  @tracked live = false;
  @tracked slide = 0;
  @tracked pass = 0;
  @tracked arrive: 'back' | 'fwd' = 'fwd';
  @tracked xfade: Xfade = 'fade';
  private seen = false;
  private c: ChoreoContext | null = null;
  private inner: ChoreoContext | null = null;
  private deck: HTMLElement | null = null;

  wire = modifier((el: HTMLElement, [c]: [ChoreoContext]) => {
    this.c = c;
    const host = el.closest('.pres-slide') as SlideHost | null;
    if (host) {
      host.presentation = this;
      host.choreoCtx = c;
    }
    return () => {
      if (this.c === c) {
        this.c = null;
      }
      if (host) {
        delete host.presentation;
        delete host.choreoCtx;
      }
    };
  });

  wireInner = modifier((el: HTMLElement, [c]: [ChoreoContext]) => {
    this.inner = c;
    const host = el.closest('.pres-slide') as SlideHost | null;
    if (host) {
      host.innerCtx = c;
    }
    return () => {
      if (this.inner === c) {
        this.inner = null;
      }
      if (host && host.innerCtx === c) {
        delete host.innerCtx;
      }
    };
  });

  /** the plate on top — during a crossfade the leaver still has a run */
  private plate(): SlideHost | null {
    return (this.deck?.querySelector(
      '.pres-leaf:not(.is-leaving) .pres-slide',
    ) ?? this.deck?.querySelector('.pres-slide')) as SlideHost | null;
  }

  boot = modifier((el: HTMLElement) => {
    this.deck = el;
    const id = requestAnimationFrame(() => {
      if (!this.seen) {
        this.seen = true;
        this.live = true;
      }
    });
    return () => {
      cancelAnimationFrame(id);
      this.deck = null;
    };
  });

  /** `pass` is in the key, not just the id: Start Over from slide 0 has to
   *  remount the plate, and a key that only names the slide would call that
   *  the same page and keep the built stills exactly as they were. */
  get pages() {
    return [{ id: this.slide, pass: this.pass }];
  }

  get atStart() {
    return this.slide <= 0;
  }

  get atEnd() {
    return this.slide >= LAST;
  }

  get folio() {
    return `${String(this.slide + 1).padStart(2, '0')} / 05`;
  }

  get building() {
    return this.arrive === 'fwd';
  }

  get xfadeIn() {
    switch (this.xfade) {
      case 'rise':
        return { opacity: 0, y: '68%' };
      case 'scale':
        return { opacity: 0, scale: 0.72 };
      case 'push':
        return { opacity: 1, x: this.arrive === 'fwd' ? '100%' : '-100%' };
      default:
        return { opacity: 0 };
    }
  }

  get xfadeOn() {
    return { opacity: 1, scale: 1, x: 0, y: 0 };
  }

  get xfadeOut() {
    switch (this.xfade) {
      case 'rise':
        return { opacity: 0, y: '-46%' };
      case 'scale':
        return { opacity: 0, scale: 1.24 };
      case 'push':
        return { opacity: 1, x: this.arrive === 'fwd' ? '-100%' : '100%' };
      default:
        return { opacity: 0 };
    }
  }

  get xfadeT() {
    return XFADE_T;
  }

  is = (n: number) => this.slide === n;
  isPage = (page: { id: number }, n: number) => page.id === n;

  /**
   * Five slides, four grounds. A deck that paints every slide the same colour
   * is a document; the change of ground IS the punctuation, so the deck runs
   * Atlas, paper, a split, Flux, Ember. Each ground carries its own ink and
   * its own accent, and every element on the slide reads them off the ground
   * rather than naming a hue itself.
   */
  slideClass = (page: { id: number }) => {
    const ground = GROUNDS[page.id] ?? 'is-atlas';
    return page.id === 0
      ? `pres-slide is-title ${ground}`
      : `pres-slide ${ground}`;
  };

  tap = () => {
    this.setHot(true);
    this.deck?.focus({ preventScroll: true });
    if (!this.live) {
      this.live = true;
      return;
    }
    const plate = this.plate();
    const inner = plate?.innerCtx?.run ?? this.inner?.run;
    if (inner && !inner.isDone()) {
      inner.advance();
      return;
    }
    const run = plate?.choreoCtx?.run ?? this.c?.run;
    if (run && !run.isDone()) {
      run.advance();
      return;
    }
    this.fwd();
  };

  /** `>` — the same verb the plate has: open the next gate, or turn the page */
  stepFwd = (event?: Event) => {
    event?.stopPropagation();
    this.tap();
  };

  /**
   * `<` — one build back, innermost first. A nested region is the last thing
   * that moved, so it is the first thing to un-move; only when neither run has
   * a segment behind it does this fall back to the previous slide.
   */
  stepBack = (event?: Event) => {
    event?.stopPropagation();
    this.setHot(true);
    this.deck?.focus({ preventScroll: true });
    const plate = this.plate();
    const inner = plate?.innerCtx?.run ?? this.inner?.run ?? null;
    // retreat() is the engine's Keynote rule: land parked at the previous
    // gate, everything ahead re-closed, and HOLD — no self-open, nothing
    // plays until the next advance replays the segment forward. The
    // binary-search scrub this replaces landed a millisecond shy of the
    // gate with the gate still open and the transport still willing: a
    // @delay gate re-opened itself, and a forward step skipped the
    // un-built segment instead of playing it.
    if (inner?.retreat()) {
      return;
    }
    const outer = plate?.choreoCtx?.run ?? this.c?.run ?? null;
    if (outer?.retreat()) {
      return;
    }
    this.back(event);
  };

  // `{{on}}` types every handler in a realm as taking a plain `Event`
  keys = (e: Event) => {
    const event = e as KeyboardEvent;
    if (event.repeat) {
      return;
    }
    switch (event.key) {
      case ' ':
        event.preventDefault();
        this.tap();
        break;
      case '>':
      case '.':
      case 'ArrowRight':
        event.preventDefault();
        this.stepFwd(event);
        break;
      case '<':
      case ',':
      case 'ArrowLeft':
        event.preventDefault();
        this.stepBack(event);
        break;
    }
  };

  /** classList, not tracked: writing `hot` re-renders the region, and an
   *  in-flight path looks like a moved sprite, which would restart the run. */
  private setHot(on: boolean) {
    this.deck?.classList.toggle('is-hot', on);
  }

  grab = (event: Event) => {
    this.setHot(true);
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  };

  onFocus = () => {
    this.setHot(true);
  };

  onBlur = (e: Event) => {
    const event = e as FocusEvent;
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as HTMLElement).contains(next)) {
      return;
    }
    this.setHot(false);
  };

  /** the bar sits inside the deck, and the deck's own click takes focus —
   *  a control in it has to keep its press to itself */
  stop = (event: Event) => {
    event.stopPropagation();
  };

  isFade = (kind: Xfade) => this.xfade === kind;

  pickFade = (event: Event) => {
    event.stopPropagation();
    this.xfade = (event.target as HTMLSelectElement).value as Xfade;
  };

  turn = (dir: 'back' | 'fwd') => {
    this.arrive = dir;
    this.inner = null;
  };

  go = (n: number, event?: Event) => {
    event?.stopPropagation();
    this.setHot(true);
    this.deck?.focus({ preventScroll: true });
    if (n === this.slide || n < 0 || n > LAST) {
      return;
    }
    this.turn(n < this.slide ? 'back' : 'fwd');
    this.slide = n;
  };

  fwd = (event?: Event) => {
    this.go(this.slide + 1, event);
  };

  /** back to slide 01, unbuilt — a new pass through the same deck */
  restart = (event?: Event) => {
    event?.stopPropagation();
    this.setHot(true);
    this.deck?.focus({ preventScroll: true });
    this.arrive = 'fwd';
    this.inner = null;
    this.slide = 0;
    this.pass += 1;
  };

  back = (event?: Event) => {
    this.go(this.slide - 1, event);
  };

  segClass = (n: number) => {
    if (n === this.slide) {
      return 'pres-seg is-on';
    }
    if (n < this.slide) {
      return 'pres-seg is-seen';
    }
    return 'pres-seg';
  };

  segLabel = (n: number) => `Go to slide ${String(n + 1).padStart(2, '0')}`;

  <template>
    <div class='ex'>
      <div
        class='pres'
        tabindex='0'
        role='region'
        aria-label='Presentation. Space advances a build. Less-than and greater-than change slides.'
        data-test-pres
        {{this.boot}}
        {{on 'keydown' this.keys}}
        {{on 'pointerdown' this.grab}}
        {{on 'click' this.grab}}
        {{on 'focusin' this.onFocus}}
        {{on 'focusout' this.onBlur}}
      >
        {{! the deck is the demo's SUBSTANCE: the crossing matches this box,
            not the stage frame around it }}
        <div class='pres-stage' data-choreo-substance>
          <Presence
            @items={{this.pages}}
            @key={{pageKey}}
            @mode='sync'
            @initial={{false}}
            @custom={{this.arrive}}
            as |page h|
          >
            <div
              class={{if h.isPresent 'pres-leaf' 'pres-leaf is-leaving'}}
              {{motion
                presence=h
                initial=this.xfadeIn
                animate=this.xfadeOn
                exit=this.xfadeOut
                transition=(tuneMotion 'presentation' this.xfadeT 'xfadeT')
              }}
            >
              <Presence @items={{HOLD}} @key={{holdKey}} as |_scene hh|>
                <div class='pres-hold' {{motion presence=hh}}>
                  <Choreo
                    class={{this.slideClass page}}
                    data-arrive={{this.arrive}}
                    data-slide={{page.id}}
                    data-test-pres-slide
                    aria-label='Advance the presentation'
                    {{on 'click' this.tap}}
                    as |c|
                  >
                    <span hidden {{this.wire c}}></span>

                    {{#if this.live}}
                      {{#if (this.isPage page 0)}}
                        <p
                          class='pres-eye is-build'
                          {{motion id='s0-eye' role='build'}}
                        >
                          Meridian — 001
                        </p>
                        {{! No figure. The title slide is type, scale and
                            colour and nothing else: a solid word, an
                            outlined word under it, and the second one does
                            not arrive until you ask for it. }}
                        <h2
                          class='pres-title is-build'
                          {{motion id='s0-title' role='build'}}
                          data-test-pres-title
                        >Signal</h2>
                        <h2
                          class='pres-title is-out is-build'
                          {{motion id='s0-title-b' role='build'}}
                          data-test-pres-title-b
                        >Found</h2>
                        <i
                          class='pres-swipe is-build'
                          {{motion id='s0-rule' role='build'}}
                        ></i>
                        <p
                          class='pres-kicker is-build'
                          {{motion id='s0-kicker' role='build'}}
                          data-test-pres-kicker
                        >Everything arrives somewhere.</p>
                        <p
                          class='pres-stamp is-build'
                          {{motion id='s0-stamp' role='build'}}
                          data-test-pres-stamp
                        >In band</p>

                        {{#if this.building}}
                          <c.Sequence>
                            <c.Parallel>
                              <c.Tween
                                @of={{c.id 's0-eye'}}
                                @opacity={{array 0 1}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  IN
                                  'IN duration'
                                }}
                                @ease='easeOut'
                              />
                              <c.Tween
                                @of={{c.id 's0-title'}}
                                @opacity={{array 0 1}}
                                @y={{array 18 0}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  0.52
                                  'Step 1 duration'
                                }}
                                @ease='easeOut'
                              />
                            </c.Parallel>
                            <c.Gate @delay={{0.7}} />
                            <c.Tween
                              @of={{c.id 's0-kicker'}}
                              @opacity={{array 0 1}}
                              @y={{array 8 0}}
                              @duration={{tuneSeconds
                                'presentation'
                                IN
                                'IN duration'
                              }}
                              @ease='easeOut'
                            />
                            <c.Gate />
                            {{! the word you clicked for: FOUND rises into the
                                outline, and the rule wipes out under it a
                                beat later — one press, two moves }}
                            <c.Parallel>
                              <c.Tween
                                @of={{c.id 's0-title-b'}}
                                @opacity={{array 0 1}}
                                @y={{array 34 0}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  0.66
                                  'Step 2 duration'
                                }}
                                @ease={{GLIDE}}
                              />
                              <c.Tween
                                @of={{c.id 's0-rule'}}
                                @scaleX={{array 0 1}}
                                @opacity={{array 0 1}}
                                @delay={{0.2}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  0.62
                                  'Step 3 duration'
                                }}
                                @ease={{GLIDE}}
                              />
                            </c.Parallel>
                            <c.Gate />
                            <c.Tween
                              @of={{c.id 's0-stamp'}}
                              @opacity={{array 0 1 1}}
                              @scale={{array 0.86 1.08 1}}
                              @duration={{tuneSeconds
                                'presentation'
                                PULSE
                                'PULSE duration'
                              }}
                              @ease='easeOut'
                            />
                          </c.Sequence>
                        {{/if}}
                      {{else if (this.isPage page 1)}}
                        <p
                          class='pres-num is-build'
                          {{motion id='s1-num' role='build'}}
                        >
                          02
                        </p>
                        <div
                          class='pres-plate is-build'
                          {{motion id='s1-plate' role='build'}}
                        ></div>
                        <h2
                          class='pres-hed is-build'
                          {{motion id='s1-hed' role='build'}}
                        >
                          Latency is
                          <em>a design choice.</em>
                        </h2>

                        {{#if this.building}}
                          <c.Sequence>
                            <c.Parallel>
                              <c.Tween
                                @of={{c.id 's1-num'}}
                                @opacity={{array 0 1}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  0.48
                                  'Step 4 duration'
                                }}
                                @ease='easeOut'
                              />
                              <c.Tween
                                @of={{c.id 's1-plate'}}
                                @opacity={{array 0 1}}
                                @scale={{array 0.92 1}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  0.56
                                  'Step 5 duration'
                                }}
                                @ease='easeOut'
                              />
                              <c.Tween
                                @of={{c.id 's1-hed'}}
                                @opacity={{array 0 1}}
                                @y={{array 14 0}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  0.48
                                  'Step 6 duration'
                                }}
                                @ease='easeOut'
                              />
                            </c.Parallel>
                          </c.Sequence>
                        {{/if}}

                        {{#if this.building}}
                          <InnerScene as |n|>
                            <span hidden {{this.wireInner n}}></span>
                            <div class='pres-verse' data-test-pres-verse>
                              {{#each LINES as |line|}}
                                <section
                                  class='pres-cell'
                                  {{motion id=line.id role='cell'}}
                                >
                                  <b
                                    class='pres-tick'
                                    {{motion id=line.tick role='tick'}}
                                  >{{line.n}}</b>
                                  <p
                                    {{motion id=line.copy role='copy'}}
                                  >{{line.text}}</p>
                                  <i
                                    class='pres-rule'
                                    {{motion id=line.rule role='rule'}}
                                  ></i>
                                </section>
                              {{/each}}
                            </div>
                            <n.Sequence>
                              <n.Parallel>
                                <n.Tween
                                  @of={{n.id 'cell-a'}}
                                  @y={{array 18 0}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.5
                                    'Step 7 duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 't-a'}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.72 1.14 1}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    PULSE
                                    'PULSE duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'c-a'}}
                                  @opacity={{array 0 1}}
                                  @by='word'
                                  @stagger={{0.05}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.4
                                    'Step 8 duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'r-a'}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.52
                                    'Step 9 duration'
                                  }}
                                  @ease='easeOut'
                                />
                              </n.Parallel>
                              <n.Gate />
                              <n.Parallel>
                                <n.Tween
                                  @of={{n.id 'cell-b'}}
                                  @y={{array 18 0}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.5
                                    'Step 10 duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 't-b'}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.72 1.14 1}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    PULSE
                                    'PULSE duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'c-b'}}
                                  @opacity={{array 0 1}}
                                  @by='word'
                                  @stagger={{0.05}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.4
                                    'Step 11 duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'r-b'}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.52
                                    'Step 12 duration'
                                  }}
                                  @ease='easeOut'
                                />
                                {{! the third line rides in on the same gate,
                                    one beat behind the second — two verses on
                                    one click rather than one verse per click }}
                                <n.Tween
                                  @of={{n.id 'cell-c'}}
                                  @y={{array 18 0}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.5
                                    'Step 13 duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 't-c'}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.72 1.14 1}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    PULSE
                                    'PULSE duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'c-c'}}
                                  @opacity={{array 0 1}}
                                  @by='word'
                                  @stagger={{0.05}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.4
                                    'Step 14 duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'r-c'}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.52
                                    'Step 15 duration'
                                  }}
                                  @ease='easeOut'
                                />
                              </n.Parallel>
                            </n.Sequence>
                          </InnerScene>
                        {{else}}
                          <div class='pres-verse'>
                            {{#each LINES as |line|}}
                              <section class='pres-cell'>
                                <b class='pres-tick'>{{line.n}}</b>
                                <p>{{line.text}}</p>
                                <i class='pres-rule is-on'></i>
                              </section>
                            {{/each}}
                          </div>
                        {{/if}}
                      {{else if (this.isPage page 2)}}
                        <p class='pres-idx'>03 — the route</p>
                        <h2
                          class='pres-hed is-tight is-build'
                          {{motion id='s2-hed' role='build'}}
                        >
                          Five regions.
                          <em>One hop.</em>
                        </h2>
                        <div class='pres-plot'>
                          <Mesh @lineId='s2-line' />
                          <span
                            class='pres-origin is-poster'
                            {{beacon 's2-shore'}}
                          ></span>
                          <span
                            class='pres-hull is-poster is-build'
                            {{motion id='s2-hull' role='bead'}}
                          ></span>
                          <ol class='pres-stations'>
                            {{#each DAYS as |day|}}
                              <li
                                class='is-build'
                                {{motion id=day.id role='day'}}
                              >{{day.name}}</li>
                            {{/each}}
                          </ol>
                        </div>
                        <p
                          class='pres-cap is-build'
                          {{motion id='s2-cap' role='build'}}
                        >
                          Frankfurt holds.
                        </p>

                        {{#if this.building}}
                          <c.Sequence>
                            <c.Tween
                              @of={{c.id 's2-hed'}}
                              @opacity={{array 0 1}}
                              @duration={{tuneSeconds
                                'presentation'
                                IN
                                'IN duration'
                              }}
                              @ease='easeOut'
                            />
                            <c.Gate />
                            <c.Parallel>
                              <c.Tween
                                @of={{c.id 's2-line'}}
                                @pathLength={{array 0 1}}
                                @opacity={{array 0 1}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  FLIGHT
                                  'FLIGHT duration'
                                }}
                                @ease={{GLIDE}}
                              />
                              <c.Move
                                @of={{c.id 's2-hull'}}
                                @from={{c.beacon 's2-shore'}}
                                @path={{HOP_RIDE}}
                                @size={{false}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  FLIGHT
                                  'FLIGHT duration'
                                }}
                                @ease={{GLIDE}}
                              />
                              <c.Tween
                                @of={{c.id 's2-hull'}}
                                @opacity={{array 0 1}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  0.2
                                  'Step 16 duration'
                                }}
                              />
                              {{! The week on ONE gate. @stagger walks its
                                  ladder across every sprite the role matched,
                                  so five days used to be five clicks and are
                                  now one — and the ladder is timed to land
                                  its last rung exactly as the stroke above
                                  finishes drawing. }}
                              <c.Tween
                                @of={{c.role 'day'}}
                                @opacity={{array 0 1}}
                                @y={{array 6 0}}
                                @stagger={{0.13}}
                                @delay={{0.34}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  IN
                                  'IN duration'
                                }}
                                @ease='easeOut'
                              />
                              <c.Tween
                                @of={{c.id 's2-cap'}}
                                @opacity={{array 0 1}}
                                @delay={{0.96}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  IN
                                  'IN duration'
                                }}
                              />
                            </c.Parallel>
                          </c.Sequence>
                        {{/if}}
                      {{else if (this.isPage page 3)}}
                        <p
                          class='pres-idx is-build'
                          {{motion id='s3-idx' role='build'}}
                        >
                          04 — the stack
                        </p>

                        {{#if this.building}}
                          <c.Sequence>
                            <c.Tween
                              @of={{c.id 's3-idx'}}
                              @opacity={{array 0 1}}
                              @duration={{tuneSeconds
                                'presentation'
                                IN
                                'IN duration'
                              }}
                              @ease='easeOut'
                            />
                          </c.Sequence>
                        {{/if}}

                        {{#if this.building}}
                          <InnerScene as |n|>
                            <span hidden {{this.wireInner n}}></span>
                            <ul class='pres-sys' data-test-pres-sys>
                              {{#each MOVES as |move|}}
                                <li
                                  class='pres-sys-item'
                                  {{motion id=move.id role='card'}}
                                >
                                  <b
                                    {{motion id=move.num role='num'}}
                                  >{{move.n}}</b>
                                  <h3
                                    {{motion id=move.title role='title'}}
                                  >{{move.name}}</h3>
                                  <i
                                    class='pres-rule'
                                    {{motion id=move.rule role='rule'}}
                                  ></i>
                                  <p
                                    {{motion id=move.copy role='copy'}}
                                  >{{move.text}}</p>
                                </li>
                              {{/each}}
                            </ul>
                            <n.Sequence>
                              <n.Parallel>
                                <n.Hold @of={{n.id 'm1'}} @zIndex={{4}} />
                                <n.Tween
                                  @of={{n.id 'm1'}}
                                  @opacity={{array 0 1}}
                                  @y={{array 22 0}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    GROUP
                                    'GROUP duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm1-num'}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.8 1.12 1}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    PULSE
                                    'PULSE duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm1-title'}}
                                  @opacity={{array 0 1}}
                                  @y={{array 10 0}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    GROUP
                                    'GROUP duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm1-rule'}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.5
                                    'Step 17 duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm1-copy'}}
                                  @opacity={{array 0 1}}
                                  @by='word'
                                  @stagger={{0.04}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.36
                                    'Step 18 duration'
                                  }}
                                />
                              </n.Parallel>
                              <n.Gate />
                              <n.Parallel>
                                <n.Hold @of={{n.id 'm2'}} @zIndex={{4}} />
                                <n.Tween
                                  @of={{n.id 'm2'}}
                                  @opacity={{array 0 1}}
                                  @y={{array 22 0}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    GROUP
                                    'GROUP duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm2-num'}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.8 1.12 1}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    PULSE
                                    'PULSE duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm2-title'}}
                                  @opacity={{array 0 1}}
                                  @y={{array 10 0}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    GROUP
                                    'GROUP duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm2-rule'}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.5
                                    'Step 19 duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm2-copy'}}
                                  @opacity={{array 0 1}}
                                  @by='word'
                                  @stagger={{0.04}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.36
                                    'Step 20 duration'
                                  }}
                                />
                                {{! the third move chases the second on the
                                    SAME gate — the system reads as a set
                                    completing, not as two more clicks }}
                                <n.Hold @of={{n.id 'm3'}} @zIndex={{4}} />
                                <n.Tween
                                  @of={{n.id 'm3'}}
                                  @opacity={{array 0 1}}
                                  @y={{array 22 0}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    GROUP
                                    'GROUP duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm3-num'}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.8 1.12 1}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    PULSE
                                    'PULSE duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm3-title'}}
                                  @opacity={{array 0 1}}
                                  @y={{array 10 0}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    GROUP
                                    'GROUP duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm3-rule'}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.5
                                    'Step 21 duration'
                                  }}
                                  @ease='easeOut'
                                />
                                <n.Tween
                                  @of={{n.id 'm3-copy'}}
                                  @opacity={{array 0 1}}
                                  @by='word'
                                  @stagger={{0.04}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    'presentation'
                                    0.36
                                    'Step 22 duration'
                                  }}
                                />
                              </n.Parallel>
                            </n.Sequence>
                          </InnerScene>
                        {{else}}
                          <ul class='pres-sys'>
                            {{#each MOVES as |move|}}
                              <li class='pres-sys-item'>
                                <b>{{move.n}}</b>
                                <h3>{{move.name}}</h3>
                                <i class='pres-rule is-on'></i>
                                <p>{{move.text}}</p>
                              </li>
                            {{/each}}
                          </ul>
                        {{/if}}
                      {{else}}
                        <p class='pres-idx'>05 — the close</p>
                        <h2
                          class='pres-close is-build'
                          {{motion id='s4-hed' role='build'}}
                        >The signal
                          <em>holds.</em></h2>
                        <p
                          class='pres-line is-build'
                          {{motion id='s4-l1' role='build'}}
                        >
                          Meridian · Signal Found · 001
                        </p>
                        <p
                          class='pres-seal is-build'
                          {{motion id='s4-seal' role='build'}}
                        >Sealed</p>

                        {{#if this.building}}
                          <c.Sequence>
                            {{! the close states itself and signs itself on
                                one press: the line follows the head without
                                being asked, and only the seal is gated }}
                            <c.Parallel>
                              <c.Tween
                                @of={{c.id 's4-hed'}}
                                @opacity={{array 0 1}}
                                @y={{array 12 0}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  0.48
                                  'Step 23 duration'
                                }}
                                @ease='easeOut'
                              />
                              <c.Tween
                                @of={{c.id 's4-l1'}}
                                @opacity={{array 0 1}}
                                @delay={{0.42}}
                                @duration={{tuneSeconds
                                  'presentation'
                                  IN
                                  'IN duration'
                                }}
                                @ease='easeOut'
                              />
                            </c.Parallel>
                            <c.Gate />
                            <c.Tween
                              @of={{c.id 's4-seal'}}
                              @opacity={{array 0 1 1}}
                              @scale={{array 0.86 1.08 1}}
                              @duration={{tuneSeconds
                                'presentation'
                                PULSE
                                'PULSE duration'
                              }}
                              @ease='easeOut'
                            />
                          </c.Sequence>
                        {{/if}}
                      {{/if}}
                    {{/if}}
                  </Choreo>
                </div>
              </Presence>
            </div>
          </Presence>
        </div>

        <div class='pres-bar'>
          <nav class='pres-segs' data-slide={{this.slide}} aria-label='Slides'>
            {{#each SLIDES as |n|}}
              <button
                type='button'
                class={{this.segClass n}}
                aria-label={{this.segLabel n}}
                aria-current={{if (this.is n) 'true'}}
                data-test-pres-seg={{n}}
                tabindex='-1'
                {{on 'click' (fn this.go n)}}
              ></button>
            {{/each}}
          </nav>
          <div class='pres-foot'>
            <div class='pres-meta'>
              <p class='pres-keys' aria-hidden='true'>
                <span><kbd>Space</kbd> build</span>
                <span><kbd>‹</kbd><kbd>›</kbd> step</span>
              </p>
              <span class='pres-folio'>{{this.folio}}</span>
            </div>
            <label class='pres-xfade'>
              <span class='pres-xfade-tag'>Transition</span>
              <select
                data-test-pres-xfade
                tabindex='-1'
                {{on 'click' this.stop}}
                {{on 'change' this.pickFade}}
              >
                {{#each XFADES as |kind|}}
                  <option value={{kind}} selected={{this.isFade kind}}>
                    {{kind}}
                  </option>
                {{/each}}
              </select>
            </label>
            {{! ‹ and › walk every BUILD, not every slide: one press is one
                beat, and a slide boundary is just the beat where the page
                happens to turn. }}
            {{! Deliberately never disabled. Knowing whether a build remains
                means reading run.segment, and run state is not tracked — the
                @tracked write that would re-render this bar mid-build reads
                as a moved sprite and restarts the run (the same reason
                is-hot goes through classList). A press at either end is a
                harmless no-op, which is the cheaper honesty. }}
            <button
              type='button'
              class='pres-restart'
              aria-label='Start over'
              data-test-pres-restart
              tabindex='-1'
              {{on 'click' this.restart}}
            >Start over</button>
            <button
              type='button'
              class='pres-arr'
              aria-label='Previous build'
              data-test-pres-back
              tabindex='-1'
              {{on 'click' this.stepBack}}
            >‹</button>
            <button
              type='button'
              class='pres-arr'
              aria-label='Next build'
              data-test-pres-fwd
              tabindex='-1'
              {{on 'click' this.stepFwd}}
            >›</button>
          </div>
        </div>
        <i class='pres-ring' aria-hidden='true'></i>
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

      /* An engraved atlas plate, not a poster.
       *
       * This deck used to be the largest object on the site — 760px, against a
       * vocabulary that runs 300-440 everywhere else and 320 for Slides, which is
       * the same idea at a quarter of the area. At that width every clamp in this
       * section sat pinned to its own maximum, so the fluid middle term never ran
       * at the size anyone actually looks at the thing: a 224px ghost numeral over
       * a 10px mono label, 20:1, set as though it were a billboard.
       *
       * It is 560 x 315 now — 16:9, the shape a deck is actually cut to — and
       * because the ratio is FIXED the slide is a true scale model: every position,
       * measure and step is in `cqw` against the plate, so the whole composition
       * is one drawing that resolves at any size rather than a set of percentages
       * that drift apart from a set of pixel type sizes. The only clamps left are
       * legibility floors on the type, and they engage below ~440 only.
       *
       * The chrome does NOT scale with it: the imprint is UI, so it stays at the
       * site's fixed 10px mono, same as .replay and .wires-bar button.
       */
      .ex:has(.pres) {
        padding-block: 16px;
      }

      .pres {
        position: relative;
        display: flex;
        flex-direction: column;
        /* ONE rounded rect: a 16:9 stage with the transport welded under it, the
           way a deck actually presents itself. The bar is not chrome floating near
           the slide, it is the bottom 46px of the same object. */
        width: min(94cqw, calc((92cqh - 46px) * 1.7778), 560px);
        border: 1px solid var(--line-strong);
        border-radius: 16px;
        background: var(--bg-well);
        box-shadow: 0 12px 30px
          rgba(var(--shadow-rgb), calc(0.32 * var(--shadow-a)));
        container-type: inline-size;
      }

      /* The type scale — five steps on ~1.42, in cqw so they ride the plate.
       *
       * Declared on .pres-stage rather than on .pres itself: an element that
       * ESTABLISHES a container resolves its own cqw against its ANCESTOR
       * container, so a `cqw` written on .pres would silently measure the stage
       * around it instead of the plate. One level in, it measures the plate.
       *
       * The floors are legibility, not layout — below about 440px the type stops
       * shrinking with the plate so a phone-width tile stays readable. The caps sit
       * just above the 560 values, so they never bind at the sizes we ship. */
      .pres-stage {
        --pres-1: clamp(
          8px,
          1.8cqw,
          11px
        ); /* mono labels, folio, ticks, caption */
        --pres-2: clamp(10.5px, 2.55cqw, 15px); /* body copy */
        --pres-3: clamp(14px, 3.6cqw, 21px); /* the system's card titles */
        --pres-4: clamp(18px, 5.15cqw, 30px); /* slide heads */
        --pres-5: clamp(24px, 7.3cqw, 42px); /* the deck title, and the close */
        /* the plate's margin, and the one measure every slide is set against */
        --pres-m: 7cqw;
      }

      /* Shown on :focus (not only :focus-visible) because a click is how you
         take the deck. A hairline drawn just INSIDE the plate edge — the ring
         used to be a 2.5px copper band at inset -8px with a second shadow ring
         outside it, which is a lot of chrome to say "focused". */
      .pres:focus,
      .pres:focus-visible {
        outline: none;
      }

      .pres-ring {
        position: absolute;
        /* the deck is one object, so the focus mark is one hairline around all of
           it — drawn INSIDE the edge, where it cannot be clipped by the stage */
        inset: 0;
        border: 1.5px solid var(--copper-ink);
        border-radius: 16px;
        pointer-events: none;
        z-index: 8;
        opacity: 0;
        transition: opacity 140ms var(--ease);
      }

      .pres.is-hot > .pres-ring,
      .pres:focus > .pres-ring,
      .pres:focus-visible > .pres-ring {
        opacity: 1;
      }

      /* the plate: one surface, all four corners, a shadow that lifts it off the
         stage the way .slide-plate and the Camera prints do */
      .pres-stage {
        position: relative;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        /* top corners only: the bottom two belong to the bar below it */
        border-radius: 15px 15px 0 0;
        border-bottom: 1px solid var(--line-strong);
        background: var(--bg-well);
      }

      /* ---- the four grounds ----
       *
       * Atlas, Ember, Flux and Halo — the brand's four gradients, plus paper. A
       * deck that paints every slide the same colour is a document; the change of
       * ground is the punctuation, so the deck runs Atlas, paper, a split, Flux,
       * Ember, and Halo does the accent work throughout.
       *
       * Each ground sets four tokens — --sl-ink, --sl-dim, --sl-faint, --sl-accent
       * — and every element on the slide reads those instead of naming a hue, so
       * one line here re-colours a whole slide and no rule below has to know which
       * ground it is standing on.
       *
       * No ground bottoms out in black. Flux is the dark one and it lands on a
       * steel #262b2e, because black type on a black field is not contrast, it is
       * just two absences. */
      .pres-slide {
        position: relative;
        height: 100%;
        overflow: hidden;
        cursor: pointer;
        touch-action: pan-y;
        color: var(--sl-ink);
        --sl-ink: var(--ink);
        --sl-dim: var(--ink-dim);
        --sl-faint: var(--ink-faint);
        --sl-accent: #edce9e;
        --sl-rule: rgba(var(--ink-rgb), 0.16);
        background: var(--bg-spot);
      }

      /* ATLAS — burnt sienna into a deep red-brown. The deck opens on it. */
      .pres-slide.is-atlas {
        --sl-ink: #fdf2ea;
        --sl-dim: #e8c3ac;
        --sl-faint: #c1917a;
        --sl-accent: #edce9e;
        --sl-rule: rgba(253, 242, 234, 0.26);
        background: linear-gradient(
          152deg,
          #c2482b 0%,
          #7e2413 46%,
          #3a1008 100%
        );
      }

      /* EMBER — orange into red. The close. */
      .pres-slide.is-ember {
        --sl-ink: #fff6f0;
        --sl-dim: #ffd9c4;
        --sl-faint: #f0ad91;
        --sl-accent: #3a1008;
        --sl-rule: rgba(255, 246, 240, 0.32);
        background: linear-gradient(
          152deg,
          #f2843e 0%,
          #e8502a 46%,
          #d6301c 100%
        );
      }

      /* FLUX — steel. The stack sits here, and this is the deck's dark slide:
         a grey that still has light in it, never a black hole. */
      .pres-slide.is-flux {
        --sl-ink: #f4f6f7;
        --sl-dim: #c3cace;
        --sl-faint: #939ba1;
        --sl-accent: #edce9e;
        --sl-rule: rgba(244, 246, 247, 0.2);
        background: linear-gradient(
          152deg,
          #9aa2a8 0%,
          #5a6268 46%,
          #262b2e 100%
        );
      }

      /* PAPER — the one genuinely light slide. A deck is printed, and print has a
         white page in it somewhere. */
      .pres-slide.is-paper {
        --sl-ink: #1b1712;
        --sl-dim: #6b6255;
        --sl-faint: #9a9082;
        --sl-accent: #d6301c;
        --sl-rule: rgba(27, 23, 18, 0.18);
        background:
          radial-gradient(80% 90% at 92% 8%, #d6301c0d 0%, transparent 58%),
          #f7f3ec;
      }

      /* SPLIT — paper on the left, Flux on the right, cut at 62%. The figure
         straddles the cut, which is the whole point of the slide. */
      .pres-slide.is-split {
        --sl-ink: #1b1712;
        --sl-dim: #6b6255;
        --sl-faint: #9a9082;
        --sl-accent: #d6301c;
        --sl-rule: rgba(27, 23, 18, 0.18);
        background: linear-gradient(
          100deg,
          #f7f3ec 0 62%,
          #4a5157 62%,
          #262b2e 100%
        );
      }

      .pres-leaf {
        position: absolute;
        inset: 0;
        z-index: 1;
      }

      .pres-leaf.is-leaving {
        z-index: 0;
        pointer-events: none;
      }

      .pres-hold {
        position: absolute;
        inset: 0;
      }

      .pres-inner .pres-verse,
      .pres-inner .pres-sys {
        pointer-events: auto;
      }

      /* ---- the imprint ----
       *
       * Not a bar. The footer used to be welded to the plate — its own fill, a
       * border-top, two mitred corners — carrying six species of control, where
       * no other stage on the site carries more than two and none welds anything.
       * What is left is margin: a rule, then one line of mono.
       *
       * This is UI, not slide, so it does NOT ride the plate's cqw scale: 10px
       * mono at 0.12em, the same chrome as .replay and .wires-bar button. */
      .pres-bar {
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        height: 46px;
        padding: 0 10px 8px;
        border-radius: 0 0 15px 15px;
      }

      /* the rail sits hard against the stage's bottom edge — a progress rule for
         the slide above it, not a control floating in the bar */
      .pres-segs {
        display: flex;
        gap: 2px;
        margin: 0 -10px;
      }

      /* The rule is a hairline; the BUTTON around it is not. A 2px-tall control is
         a 2px-tall pointer target, and on a finger it may as well not be there —
         so the hit area is a proper 16px band and the mark inside it stays a line. */
      .pres-seg {
        display: block;
        position: relative;
        height: 16px;
        flex: 1;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: pointer;
      }

      .pres-seg::before {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        height: 2px;
        margin-top: -1px;
        border-radius: 1px;
        background: color-mix(in srgb, var(--ink) 14%, transparent);
        transition: background 140ms var(--ease);
      }

      .pres-seg.is-seen::before {
        background: color-mix(in srgb, var(--copper) 58%, transparent);
      }

      .pres-seg.is-on::before {
        background: var(--ember-hot);
      }

      @media (hover: hover) {
        .pres-seg:hover::before {
          background: var(--ink-dim);
        }
      }

      .pres-foot {
        display: flex;
        flex: 1;
        align-items: center;
        gap: 8px;
      }

      /* Same grid cell so swapping folio ⇄ keys cannot resize the imprint — a
         reflow here moves every sprite and would restart a gated run. */
      .pres-meta {
        display: grid;
        flex: 1;
        min-width: 0;
        justify-items: start;
        align-items: center;
      }

      .pres-keys,
      .pres-folio {
        grid-area: 1 / 1;
      }

      .pres-keys {
        display: flex;
        visibility: hidden;
        align-items: center;
        gap: 10px;
        margin: 0;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .pres.is-hot .pres-keys {
        visibility: visible;
      }

      .pres.is-hot .pres-folio {
        visibility: hidden;
      }

      .pres-keys span {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .pres-keys kbd {
        display: inline-block;
        padding: 1px 4px;
        border: 1px solid var(--line-strong);
        border-radius: 3px;
        font: inherit;
        letter-spacing: 0.08em;
        color: var(--copper-ink);
      }

      .pres-folio {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }
      /* the transition picker: a real <select>, so the four kinds are a list you
         read rather than a word you have to press four times to see */
      .pres-xfade {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        gap: 6px;
        margin: 0;
        cursor: pointer;
      }

      .pres-xfade-tag {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .pres-xfade select {
        appearance: none;
        padding: 4px 20px 4px 9px;
        border: 1px solid var(--line-strong);
        border-radius: 999px;
        background:
          /* the chevron, drawn rather than typed */
          linear-gradient(45deg, transparent 50%, currentcolor 50%)
            calc(100% - 11px) calc(50% - 1px) / 4px 4px no-repeat,
          linear-gradient(-45deg, currentcolor 50%, transparent 50%)
            calc(100% - 7px) calc(50% - 1px) / 4px 4px no-repeat;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-dim);
        cursor: pointer;
      }

      @media (hover: hover) {
        .pres-xfade:hover select {
          color: var(--ink);
          border-color: var(--copper);
        }
      }

      /* Start over — the same pill as the arrows, wearing a word instead of a
         glyph. It reads as part of the transport rather than a fifth species. */
      .pres-restart {
        flex-shrink: 0;
        margin: 0;
        padding: 4px 9px;
        border: 1px solid var(--line-strong);
        border-radius: 999px;
        background: transparent;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      @media (hover: hover) {
        .pres-restart:hover {
          color: var(--ink);
          border-color: var(--copper);
        }
      }
      @container (max-width: 420px) {
        .pres-foot {
          flex-wrap: wrap;
          row-gap: 6px;
        }
      }

      .pres-arr {
        flex-shrink: 0;
        display: grid;
        place-items: center;
        width: 21px;
        height: 21px;
        padding: 0;
        border: 1px solid var(--line-strong);
        border-radius: 999px;
        background: transparent;
        color: var(--ink-dim);
        font-size: 10px;
        line-height: 1;
      }

      @media (hover: hover) {
        .pres-arr:hover:not(:disabled) {
          color: var(--ink);
          border-color: var(--copper);
        }
      }

      .pres-arr:disabled {
        opacity: 0.28;
        cursor: default;
      }

      /* builds start invisible; the timeline writes them. Back-arrive skips the
         timeline and shows the still — the previous slide, already built. */
      .pres-slide .is-build {
        opacity: 0;
      }

      .pres-slide[data-arrive='back'] .is-build {
        opacity: 1;
        transform: none;
      }

      .pres-eye,
      .pres-title,
      .pres-kicker,
      .pres-stamp,
      .pres-num,
      .pres-plate,
      .pres-hed,
      .pres-line,
      .pres-idx,
      .pres-plot,
      .pres-cap,
      .pres-sys,
      .pres-close,
      .pres-seal {
        position: absolute;
      }

      .pres-eye,
      .pres-idx {
        top: 5.5cqw;
        left: var(--pres-m);
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--pres-1);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--sl-accent);
      }

      /* 01 — the title.
       *
       * No figure on this slide: the contrast IS the design. One word solid, the
       * word under it outlined in Halo, at a step nothing else in the deck gets
       * near — 13cqw against a 1.8cqw eyebrow is better than 7:1, and that gap is
       * what makes a title slide read as a title rather than as a big heading. */
      .pres-title {
        top: 14cqw;
        left: var(--pres-m);
        margin: 0;
        font-family: var(--font-display-alt);
        font-weight: 700;
        font-stretch: 62%;
        font-variation-settings: 'wdth' 62;
        font-size: clamp(30px, 13cqw, 76px);
        letter-spacing: -0.045em;
        line-height: 0.84;
        text-transform: uppercase;
      }

      /* the counter-word: the same cut, drawn rather than filled */
      .pres-title.is-out {
        top: 25cqw;
        color: transparent;
        -webkit-text-stroke: 1.4px var(--sl-accent);
      }

      /* the rule that wipes out under the pair, on the same press */
      .pres-swipe {
        position: absolute;
        top: 38.5cqw;
        left: var(--pres-m);
        display: block;
        width: 32cqw;
        height: 2px;
        background: var(--sl-accent);
        transform-origin: 0 50%;
      }

      .pres-slide.is-title .pres-kicker {
        top: 43cqw;
      }

      .pres-kicker {
        top: 26cqw;
        left: var(--pres-m);
        margin: 0;
        width: fit-content;
        font-size: var(--pres-2);
        font-style: italic;
        color: var(--sl-dim);
        letter-spacing: -0.01em;
      }

      /* the mesh is 320x110 — a band. Its box carries the same ratio so the drawing
         fills it rather than floating in the middle of it. */
      .pres-plot {
        top: 25cqw;
        left: var(--pres-m);
        width: 86cqw;
        height: 29.6cqw;
      }

      /* on the split ground the head sits in the paper half and the figure runs
         across the cut, so the type gets the left 58% and nothing overhangs */
      .pres-slide.is-split .pres-hed {
        right: 44cqw;
      }
      /* the station labels cross the cut too, so the ones that land on steel take
         their contrast from that half rather than from the paper half's --sl-faint */
      .pres-slide.is-split .pres-stations li:nth-child(n + 4) {
        color: rgba(244, 246, 247, 0.78);
      }

      /* the two ends of the ride. Positioned in % of the CHART, which is itself a
         cqw box — so the bead sits on the same point of the curve at every size. */
      .pres-origin,
      .pres-hull {
        position: absolute;
        width: 1.3cqw;
        height: 1.3cqw;
        min-width: 6px;
        min-height: 6px;
      }

      .pres-origin {
        left: 3.75%;
        top: 65%;
        margin-top: -0.65cqw;
      }

      .pres-hull {
        left: 96.25%;
        top: 57.5%;
        margin-top: -0.65cqw;
        border-radius: 999px;
        background: var(--sl-accent);
        box-shadow:
          0 0 0 0.55cqw color-mix(in srgb, var(--sl-accent) 24%, transparent),
          0 0 12px color-mix(in srgb, var(--sl-accent) 60%, transparent);
      }

      .pres-stamp,
      .pres-seal {
        margin: 0;
        width: fit-content;
        font-family: var(--font-mono);
        font-weight: 500;
        font-size: var(--pres-1);
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--sl-accent);
      }

      .pres-stamp {
        right: var(--pres-m);
        bottom: 5cqw;
      }

      .pres-seal {
        right: var(--pres-m);
        bottom: 6cqw;
        padding: 1.4cqw 1.8cqw 1.2cqw;
        border: 1px solid var(--sl-accent);
        border-radius: 999px;
      }

      /* 02 — the idea: a cropped numeral, a copper plate, one sentence.
         The numeral is not on the type scale: it is a graphic at 10% ink, cropped
         by two edges, and it is sized against the plate rather than the ladder. */
      .pres-num {
        right: -1cqw;
        top: -4cqw;
        margin: 0;
        font-family: var(--font-display-alt);
        font-weight: 700;
        font-stretch: 62%;
        font-variation-settings: 'wdth' 62;
        font-size: 17cqw;
        line-height: 0.8;
        letter-spacing: -0.06em;
        color: color-mix(in srgb, var(--ink) 10%, transparent);
        pointer-events: none;
      }

      .pres-plate {
        top: 0;
        right: 0;
        bottom: 0;
        width: 26cqw;
        background: linear-gradient(
          160deg,
          #ff7a45 0%,
          #c42712 42%,
          #2a0c08 100%
        );
        box-shadow: -8px 0 24px
          rgba(var(--shadow-rgb), calc(0.3 * var(--shadow-a)));
      }

      .pres-hed,
      .pres-close {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 800;
        letter-spacing: -0.04em;
        line-height: 0.94;
      }

      .pres-hed {
        top: 13cqw;
        left: var(--pres-m);
        right: 34cqw;
        font-size: var(--pres-4);
      }

      .pres-hed.is-tight {
        top: 11cqw;
        right: 9cqw;
      }

      /* Plex Sans italic sets optically larger than Syne 800 at the same body
         size, so the counter-voice steps down to sit level with the display line
         instead of over-reaching it. */
      .pres-hed em,
      .pres-close em {
        display: block;
        font-family: var(--font);
        font-weight: 400;
        font-style: italic;
        font-size: 0.88em;
        letter-spacing: -0.02em;
        color: var(--sl-dim);
      }

      .pres-line {
        left: var(--pres-m);
        margin: 0;
        font-size: var(--pres-2);
        color: var(--sl-ink);
        letter-spacing: -0.01em;
      }

      .pres-verse {
        position: absolute;
        top: 28cqw;
        left: var(--pres-m);
        right: 34cqw;
        bottom: 5cqw;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 1.2cqw;
        margin: 0;
      }

      .pres-cell {
        position: relative;
        display: grid;
        grid-template-columns: auto 1fr;
        grid-template-rows: auto auto;
        column-gap: 1.6cqw;
        row-gap: 0.6cqw;
        min-height: 0;
      }

      .pres-tick {
        grid-row: 1 / -1;
        align-self: start;
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--pres-1);
        font-weight: 500;
        letter-spacing: 0.14em;
        color: var(--sl-accent);
      }

      .pres-cell p {
        margin: 0;
        font-size: var(--pres-2);
        letter-spacing: -0.01em;
      }

      .pres-rule {
        grid-column: 2;
        display: block;
        height: 1px;
        width: 100%;
        max-width: 11em;
        margin: 0;
        background: var(--sl-accent);
        transform-origin: 0 50%;
        opacity: 0;
      }

      .pres-rule.is-on {
        opacity: 1;
      }

      .pres-inner .pres-tick,
      .pres-inner .pres-cell p,
      .pres-inner .pres-rule,
      .pres-inner .pres-sys-item,
      .pres-inner .pres-sys-item b,
      .pres-inner .pres-sys-item h3,
      .pres-inner .pres-sys-item p {
        opacity: 0;
      }

      .pres-stations {
        position: absolute;
        left: 2%;
        right: 2%;
        bottom: -14%;
        display: flex;
        justify-content: space-between;
        margin: 0;
        padding: 0;
        list-style: none;
        font-family: var(--font-mono);
        font-size: var(--pres-1);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--sl-faint);
      }

      .pres-cap {
        right: var(--pres-m);
        bottom: 5cqw;
        left: auto;
        margin: 0;
        width: fit-content;
        font-family: var(--font-mono);
        font-size: var(--pres-1);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--sl-accent);
      }

      /* 04 — the system.
         A band, not the whole plate: the cards used to sit in a box running to the
         bottom margin, which left the lower third empty because every card's
         content is top-aligned inside it. */
      .pres-sys {
        top: 15cqw;
        left: var(--pres-m);
        right: var(--pres-m);
        bottom: 7cqw;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 4cqw;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .pres-sys-item {
        display: flex;
        flex-direction: column;
        gap: 0.7cqw;
        min-width: 0;
        padding-top: 1.6cqw;
        border-top: 1px solid var(--sl-rule);
      }

      .pres-sys-item b {
        font-family: var(--font-mono);
        font-size: var(--pres-1);
        font-weight: 500;
        letter-spacing: 0.16em;
        color: var(--sl-accent);
      }

      .pres-sys-item h3 {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: var(--pres-3);
        letter-spacing: -0.035em;
      }

      /* number, title and rule hold the top of the band; the descriptions drop to
         a shared baseline at the bottom of it, the way a spec plate sets them */
      .pres-sys-item p {
        margin: auto 0 0;
        font-size: var(--pres-2);
        line-height: 1.35;
        color: var(--sl-dim);
      }

      /* 05 — the close */
      .pres-close {
        top: 14cqw;
        left: var(--pres-m);
        /* "The system" needs the full measure; a tighter inset breaks the line
           after "The", which is not a line break anyone chose */
        right: 16cqw;
        font-size: var(--pres-5);
      }

      .pres-slide[data-slide='4'] .pres-line {
        top: 38cqw;
        font-family: var(--font-mono);
        font-size: var(--pres-1);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--sl-faint);
      }

      .choreo-site:not([data-theme='light']) .pres-stage {
        background: #2a2521;
      }
    </style>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSeconds('presentation', IN, 'IN duration');
tuneSeconds('presentation', 0.52, 'Step 1 duration');
tuneSeconds('presentation', 0.66, 'Step 2 duration');
tuneSeconds('presentation', 0.62, 'Step 3 duration');
tuneSeconds('presentation', PULSE, 'PULSE duration');
tuneSeconds('presentation', 0.48, 'Step 4 duration');
tuneSeconds('presentation', 0.56, 'Step 5 duration');
tuneSeconds('presentation', 0.48, 'Step 6 duration');
tuneSeconds('presentation', 0.5, 'Step 7 duration');
tuneSeconds('presentation', 0.4, 'Step 8 duration');
tuneSeconds('presentation', 0.52, 'Step 9 duration');
tuneSeconds('presentation', 0.5, 'Step 10 duration');
tuneSeconds('presentation', 0.4, 'Step 11 duration');
tuneSeconds('presentation', 0.52, 'Step 12 duration');
tuneSeconds('presentation', 0.5, 'Step 13 duration');
tuneSeconds('presentation', 0.4, 'Step 14 duration');
tuneSeconds('presentation', 0.52, 'Step 15 duration');
tuneSeconds('presentation', FLIGHT, 'FLIGHT duration');
tuneSeconds('presentation', 0.2, 'Step 16 duration');
tuneSeconds('presentation', GROUP, 'GROUP duration');
tuneSeconds('presentation', 0.5, 'Step 17 duration');
tuneSeconds('presentation', 0.36, 'Step 18 duration');
tuneSeconds('presentation', 0.5, 'Step 19 duration');
tuneSeconds('presentation', 0.36, 'Step 20 duration');
tuneSeconds('presentation', 0.5, 'Step 21 duration');
tuneSeconds('presentation', 0.36, 'Step 22 duration');
tuneSeconds('presentation', 0.48, 'Step 23 duration');

export class PresentationDemo extends GalleryDemo {
  static stage = Presentation;
  static notes = PresentationNotes;
}
