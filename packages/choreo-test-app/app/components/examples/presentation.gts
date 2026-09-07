import type { TOC } from '@ember/component/template-only';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { ChoreoContext } from 'glimmer-motion';
import { beacon, Choreo, motion, Presence } from 'glimmer-motion';
import { tuneMotion, tuneSeconds } from 'test-app/lib/demo-tuning';

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
  <svg class="pres-fig" viewBox="0 0 320 110" aria-hidden="true" ...attributes>
    <path
      class="pres-chord"
      d="M24 82 L152 75 M88 29 L220 25 M152 75 L292 64 M24 82 L88 29"
    />
    <path class="pres-ghost" d={{HOP}} />
    <path
      class="pres-stroke is-build"
      d={{HOP}}
      {{motion id=@lineId role="build"}}
    />
    {{#each NODES as |n|}}
      <circle class="pres-node {{n.tone}}" cx={{n.cx}} cy={{n.cy}} r="4.5" />
      <circle class="pres-node-ring" cx={{n.cx}} cy={{n.cy}} r="9" />
    {{/each}}
  </svg>
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
    <Choreo class="pres-inner" {{this.boot}} as |c|>
      {{#if this.go}}
        {{yield c}}
      {{/if}}
    </Choreo>
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
      '.pres-leaf:not(.is-leaving) .pres-slide'
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

  keys = (event: KeyboardEvent) => {
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

  grab = (event: PointerEvent) => {
    this.setHot(true);
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  };

  onFocus = () => {
    this.setHot(true);
  };

  onBlur = (event: FocusEvent) => {
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
    <div class="ex">
      <div
        class="pres"
        tabindex="0"
        role="region"
        aria-label="Presentation. Space advances a build. Less-than and greater-than change slides."
        data-test-pres
        {{this.boot}}
        {{on "keydown" this.keys}}
        {{on "pointerdown" this.grab}}
        {{on "click" this.grab}}
        {{on "focusin" this.onFocus}}
        {{on "focusout" this.onBlur}}
      >
        {{! the deck is the demo's SUBSTANCE: the crossing matches this box,
            not the stage frame around it }}
        <div class="pres-stage" data-choreo-substance>
          <Presence
            @items={{this.pages}}
            @key={{pageKey}}
            @mode="sync"
            @initial={{false}}
            @custom={{this.arrive}}
            as |page h|
          >
            <div
              class={{if h.isPresent "pres-leaf" "pres-leaf is-leaving"}}
              {{motion
                presence=h
                initial=this.xfadeIn
                animate=this.xfadeOn
                exit=this.xfadeOut
                transition=(tuneMotion "presentation" this.xfadeT "xfadeT")
              }}
            >
              <Presence @items={{HOLD}} @key={{holdKey}} as |_scene hh|>
                <div class="pres-hold" {{motion presence=hh}}>
                  <Choreo
                    class={{this.slideClass page}}
                    data-arrive={{this.arrive}}
                    data-slide={{page.id}}
                    data-test-pres-slide
                    aria-label="Advance the presentation"
                    {{on "click" this.tap}}
                    as |c|
                  >
                    <span hidden {{this.wire c}}></span>

                    {{#if this.live}}
                      {{#if (this.isPage page 0)}}
                        <p
                          class="pres-eye is-build"
                          {{motion id="s0-eye" role="build"}}
                        >
                          Meridian — 001
                        </p>
                        {{! No figure. The title slide is type, scale and
                            colour and nothing else: a solid word, an
                            outlined word under it, and the second one does
                            not arrive until you ask for it. }}
                        <h2
                          class="pres-title is-build"
                          {{motion id="s0-title" role="build"}}
                          data-test-pres-title
                        >Signal</h2>
                        <h2
                          class="pres-title is-out is-build"
                          {{motion id="s0-title-b" role="build"}}
                          data-test-pres-title-b
                        >Found</h2>
                        <i
                          class="pres-swipe is-build"
                          {{motion id="s0-rule" role="build"}}
                        ></i>
                        <p
                          class="pres-kicker is-build"
                          {{motion id="s0-kicker" role="build"}}
                          data-test-pres-kicker
                        >Everything arrives somewhere.</p>
                        <p
                          class="pres-stamp is-build"
                          {{motion id="s0-stamp" role="build"}}
                          data-test-pres-stamp
                        >In band</p>

                        {{#if this.building}}
                          <c.Sequence>
                            <c.Parallel>
                              <c.Tween
                                @of={{c.id "s0-eye"}}
                                @opacity={{array 0 1}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  IN
                                  "IN duration"
                                }}
                                @ease="easeOut"
                              />
                              <c.Tween
                                @of={{c.id "s0-title"}}
                                @opacity={{array 0 1}}
                                @y={{array 18 0}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  0.52
                                  "Step 1 duration"
                                }}
                                @ease="easeOut"
                              />
                            </c.Parallel>
                            <c.Gate @delay={{0.7}} />
                            <c.Tween
                              @of={{c.id "s0-kicker"}}
                              @opacity={{array 0 1}}
                              @y={{array 8 0}}
                              @duration={{tuneSeconds
                                "presentation"
                                IN
                                "IN duration"
                              }}
                              @ease="easeOut"
                            />
                            <c.Gate />
                            {{! the word you clicked for: FOUND rises into the
                                outline, and the rule wipes out under it a
                                beat later — one press, two moves }}
                            <c.Parallel>
                              <c.Tween
                                @of={{c.id "s0-title-b"}}
                                @opacity={{array 0 1}}
                                @y={{array 34 0}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  0.66
                                  "Step 2 duration"
                                }}
                                @ease={{GLIDE}}
                              />
                              <c.Tween
                                @of={{c.id "s0-rule"}}
                                @scaleX={{array 0 1}}
                                @opacity={{array 0 1}}
                                @delay={{0.2}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  0.62
                                  "Step 3 duration"
                                }}
                                @ease={{GLIDE}}
                              />
                            </c.Parallel>
                            <c.Gate />
                            <c.Tween
                              @of={{c.id "s0-stamp"}}
                              @opacity={{array 0 1 1}}
                              @scale={{array 0.86 1.08 1}}
                              @duration={{tuneSeconds
                                "presentation"
                                PULSE
                                "PULSE duration"
                              }}
                              @ease="easeOut"
                            />
                          </c.Sequence>
                        {{/if}}
                      {{else if (this.isPage page 1)}}
                        <p
                          class="pres-num is-build"
                          {{motion id="s1-num" role="build"}}
                        >
                          02
                        </p>
                        <div
                          class="pres-plate is-build"
                          {{motion id="s1-plate" role="build"}}
                        ></div>
                        <h2
                          class="pres-hed is-build"
                          {{motion id="s1-hed" role="build"}}
                        >
                          Latency is
                          <em>a design choice.</em>
                        </h2>

                        {{#if this.building}}
                          <c.Sequence>
                            <c.Parallel>
                              <c.Tween
                                @of={{c.id "s1-num"}}
                                @opacity={{array 0 1}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  0.48
                                  "Step 4 duration"
                                }}
                                @ease="easeOut"
                              />
                              <c.Tween
                                @of={{c.id "s1-plate"}}
                                @opacity={{array 0 1}}
                                @scale={{array 0.92 1}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  0.56
                                  "Step 5 duration"
                                }}
                                @ease="easeOut"
                              />
                              <c.Tween
                                @of={{c.id "s1-hed"}}
                                @opacity={{array 0 1}}
                                @y={{array 14 0}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  0.48
                                  "Step 6 duration"
                                }}
                                @ease="easeOut"
                              />
                            </c.Parallel>
                          </c.Sequence>
                        {{/if}}

                        {{#if this.building}}
                          <InnerScene as |n|>
                            <span hidden {{this.wireInner n}}></span>
                            <div class="pres-verse" data-test-pres-verse>
                              {{#each LINES as |line|}}
                                <section
                                  class="pres-cell"
                                  {{motion id=line.id role="cell"}}
                                >
                                  <b
                                    class="pres-tick"
                                    {{motion id=line.tick role="tick"}}
                                  >{{line.n}}</b>
                                  <p
                                    {{motion id=line.copy role="copy"}}
                                  >{{line.text}}</p>
                                  <i
                                    class="pres-rule"
                                    {{motion id=line.rule role="rule"}}
                                  ></i>
                                </section>
                              {{/each}}
                            </div>
                            <n.Sequence>
                              <n.Parallel>
                                <n.Tween
                                  @of={{n.id "cell-a"}}
                                  @y={{array 18 0}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.5
                                    "Step 7 duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "t-a"}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.72 1.14 1}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    PULSE
                                    "PULSE duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "c-a"}}
                                  @opacity={{array 0 1}}
                                  @by="word"
                                  @stagger={{0.05}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.4
                                    "Step 8 duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "r-a"}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.52
                                    "Step 9 duration"
                                  }}
                                  @ease="easeOut"
                                />
                              </n.Parallel>
                              <n.Gate />
                              <n.Parallel>
                                <n.Tween
                                  @of={{n.id "cell-b"}}
                                  @y={{array 18 0}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.5
                                    "Step 10 duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "t-b"}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.72 1.14 1}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    PULSE
                                    "PULSE duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "c-b"}}
                                  @opacity={{array 0 1}}
                                  @by="word"
                                  @stagger={{0.05}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.4
                                    "Step 11 duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "r-b"}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.52
                                    "Step 12 duration"
                                  }}
                                  @ease="easeOut"
                                />
                                {{! the third line rides in on the same gate,
                                    one beat behind the second — two verses on
                                    one click rather than one verse per click }}
                                <n.Tween
                                  @of={{n.id "cell-c"}}
                                  @y={{array 18 0}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.5
                                    "Step 13 duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "t-c"}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.72 1.14 1}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    PULSE
                                    "PULSE duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "c-c"}}
                                  @opacity={{array 0 1}}
                                  @by="word"
                                  @stagger={{0.05}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.4
                                    "Step 14 duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "r-c"}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.52
                                    "Step 15 duration"
                                  }}
                                  @ease="easeOut"
                                />
                              </n.Parallel>
                            </n.Sequence>
                          </InnerScene>
                        {{else}}
                          <div class="pres-verse">
                            {{#each LINES as |line|}}
                              <section class="pres-cell">
                                <b class="pres-tick">{{line.n}}</b>
                                <p>{{line.text}}</p>
                                <i class="pres-rule is-on"></i>
                              </section>
                            {{/each}}
                          </div>
                        {{/if}}
                      {{else if (this.isPage page 2)}}
                        <p class="pres-idx">03 — the route</p>
                        <h2
                          class="pres-hed is-tight is-build"
                          {{motion id="s2-hed" role="build"}}
                        >
                          Five regions.
                          <em>One hop.</em>
                        </h2>
                        <div class="pres-plot">
                          <Mesh @lineId="s2-line" />
                          <span
                            class="pres-origin is-poster"
                            {{beacon "s2-shore"}}
                          ></span>
                          <span
                            class="pres-hull is-poster is-build"
                            {{motion id="s2-hull" role="bead"}}
                          ></span>
                          <ol class="pres-stations">
                            {{#each DAYS as |day|}}
                              <li
                                class="is-build"
                                {{motion id=day.id role="day"}}
                              >{{day.name}}</li>
                            {{/each}}
                          </ol>
                        </div>
                        <p
                          class="pres-cap is-build"
                          {{motion id="s2-cap" role="build"}}
                        >
                          Frankfurt holds.
                        </p>

                        {{#if this.building}}
                          <c.Sequence>
                            <c.Tween
                              @of={{c.id "s2-hed"}}
                              @opacity={{array 0 1}}
                              @duration={{tuneSeconds
                                "presentation"
                                IN
                                "IN duration"
                              }}
                              @ease="easeOut"
                            />
                            <c.Gate />
                            <c.Parallel>
                              <c.Tween
                                @of={{c.id "s2-line"}}
                                @pathLength={{array 0 1}}
                                @opacity={{array 0 1}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  FLIGHT
                                  "FLIGHT duration"
                                }}
                                @ease={{GLIDE}}
                              />
                              <c.Move
                                @of={{c.id "s2-hull"}}
                                @from={{c.beacon "s2-shore"}}
                                @path={{HOP_RIDE}}
                                @size={{false}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  FLIGHT
                                  "FLIGHT duration"
                                }}
                                @ease={{GLIDE}}
                              />
                              <c.Tween
                                @of={{c.id "s2-hull"}}
                                @opacity={{array 0 1}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  0.2
                                  "Step 16 duration"
                                }}
                              />
                              {{! The week on ONE gate. @stagger walks its
                                  ladder across every sprite the role matched,
                                  so five days used to be five clicks and are
                                  now one — and the ladder is timed to land
                                  its last rung exactly as the stroke above
                                  finishes drawing. }}
                              <c.Tween
                                @of={{c.role "day"}}
                                @opacity={{array 0 1}}
                                @y={{array 6 0}}
                                @stagger={{0.13}}
                                @delay={{0.34}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  IN
                                  "IN duration"
                                }}
                                @ease="easeOut"
                              />
                              <c.Tween
                                @of={{c.id "s2-cap"}}
                                @opacity={{array 0 1}}
                                @delay={{0.96}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  IN
                                  "IN duration"
                                }}
                              />
                            </c.Parallel>
                          </c.Sequence>
                        {{/if}}
                      {{else if (this.isPage page 3)}}
                        <p
                          class="pres-idx is-build"
                          {{motion id="s3-idx" role="build"}}
                        >
                          04 — the stack
                        </p>

                        {{#if this.building}}
                          <c.Sequence>
                            <c.Tween
                              @of={{c.id "s3-idx"}}
                              @opacity={{array 0 1}}
                              @duration={{tuneSeconds
                                "presentation"
                                IN
                                "IN duration"
                              }}
                              @ease="easeOut"
                            />
                          </c.Sequence>
                        {{/if}}

                        {{#if this.building}}
                          <InnerScene as |n|>
                            <span hidden {{this.wireInner n}}></span>
                            <ul class="pres-sys" data-test-pres-sys>
                              {{#each MOVES as |move|}}
                                <li
                                  class="pres-sys-item"
                                  {{motion id=move.id role="card"}}
                                >
                                  <b
                                    {{motion id=move.num role="num"}}
                                  >{{move.n}}</b>
                                  <h3
                                    {{motion id=move.title role="title"}}
                                  >{{move.name}}</h3>
                                  <i
                                    class="pres-rule"
                                    {{motion id=move.rule role="rule"}}
                                  ></i>
                                  <p
                                    {{motion id=move.copy role="copy"}}
                                  >{{move.text}}</p>
                                </li>
                              {{/each}}
                            </ul>
                            <n.Sequence>
                              <n.Parallel>
                                <n.Hold @of={{n.id "m1"}} @zIndex={{4}} />
                                <n.Tween
                                  @of={{n.id "m1"}}
                                  @opacity={{array 0 1}}
                                  @y={{array 22 0}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    GROUP
                                    "GROUP duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m1-num"}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.8 1.12 1}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    PULSE
                                    "PULSE duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m1-title"}}
                                  @opacity={{array 0 1}}
                                  @y={{array 10 0}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    GROUP
                                    "GROUP duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m1-rule"}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.5
                                    "Step 17 duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m1-copy"}}
                                  @opacity={{array 0 1}}
                                  @by="word"
                                  @stagger={{0.04}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.36
                                    "Step 18 duration"
                                  }}
                                />
                              </n.Parallel>
                              <n.Gate />
                              <n.Parallel>
                                <n.Hold @of={{n.id "m2"}} @zIndex={{4}} />
                                <n.Tween
                                  @of={{n.id "m2"}}
                                  @opacity={{array 0 1}}
                                  @y={{array 22 0}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    GROUP
                                    "GROUP duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m2-num"}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.8 1.12 1}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    PULSE
                                    "PULSE duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m2-title"}}
                                  @opacity={{array 0 1}}
                                  @y={{array 10 0}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    GROUP
                                    "GROUP duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m2-rule"}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.5
                                    "Step 19 duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m2-copy"}}
                                  @opacity={{array 0 1}}
                                  @by="word"
                                  @stagger={{0.04}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.36
                                    "Step 20 duration"
                                  }}
                                />
                                {{! the third move chases the second on the
                                    SAME gate — the system reads as a set
                                    completing, not as two more clicks }}
                                <n.Hold @of={{n.id "m3"}} @zIndex={{4}} />
                                <n.Tween
                                  @of={{n.id "m3"}}
                                  @opacity={{array 0 1}}
                                  @y={{array 22 0}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    GROUP
                                    "GROUP duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m3-num"}}
                                  @opacity={{array 0 1 1}}
                                  @scale={{array 0.8 1.12 1}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    PULSE
                                    "PULSE duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m3-title"}}
                                  @opacity={{array 0 1}}
                                  @y={{array 10 0}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    GROUP
                                    "GROUP duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m3-rule"}}
                                  @scaleX={{array 0 1}}
                                  @opacity={{array 0 1}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.5
                                    "Step 21 duration"
                                  }}
                                  @ease="easeOut"
                                />
                                <n.Tween
                                  @of={{n.id "m3-copy"}}
                                  @opacity={{array 0 1}}
                                  @by="word"
                                  @stagger={{0.04}}
                                  @delay={{CHASE}}
                                  @duration={{tuneSeconds
                                    "presentation"
                                    0.36
                                    "Step 22 duration"
                                  }}
                                />
                              </n.Parallel>
                            </n.Sequence>
                          </InnerScene>
                        {{else}}
                          <ul class="pres-sys">
                            {{#each MOVES as |move|}}
                              <li class="pres-sys-item">
                                <b>{{move.n}}</b>
                                <h3>{{move.name}}</h3>
                                <i class="pres-rule is-on"></i>
                                <p>{{move.text}}</p>
                              </li>
                            {{/each}}
                          </ul>
                        {{/if}}
                      {{else}}
                        <p class="pres-idx">05 — the close</p>
                        <h2
                          class="pres-close is-build"
                          {{motion id="s4-hed" role="build"}}
                        >The signal
                          <em>holds.</em></h2>
                        <p
                          class="pres-line is-build"
                          {{motion id="s4-l1" role="build"}}
                        >
                          Meridian · Signal Found · 001
                        </p>
                        <p
                          class="pres-seal is-build"
                          {{motion id="s4-seal" role="build"}}
                        >Sealed</p>

                        {{#if this.building}}
                          <c.Sequence>
                            {{! the close states itself and signs itself on
                                one press: the line follows the head without
                                being asked, and only the seal is gated }}
                            <c.Parallel>
                              <c.Tween
                                @of={{c.id "s4-hed"}}
                                @opacity={{array 0 1}}
                                @y={{array 12 0}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  0.48
                                  "Step 23 duration"
                                }}
                                @ease="easeOut"
                              />
                              <c.Tween
                                @of={{c.id "s4-l1"}}
                                @opacity={{array 0 1}}
                                @delay={{0.42}}
                                @duration={{tuneSeconds
                                  "presentation"
                                  IN
                                  "IN duration"
                                }}
                                @ease="easeOut"
                              />
                            </c.Parallel>
                            <c.Gate />
                            <c.Tween
                              @of={{c.id "s4-seal"}}
                              @opacity={{array 0 1 1}}
                              @scale={{array 0.86 1.08 1}}
                              @duration={{tuneSeconds
                                "presentation"
                                PULSE
                                "PULSE duration"
                              }}
                              @ease="easeOut"
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

        <div class="pres-bar">
          <nav class="pres-segs" data-slide={{this.slide}} aria-label="Slides">
            {{#each SLIDES as |n|}}
              <button
                type="button"
                class={{this.segClass n}}
                aria-label={{this.segLabel n}}
                aria-current={{if (this.is n) "true"}}
                data-test-pres-seg={{n}}
                tabindex="-1"
                {{on "click" (fn this.go n)}}
              ></button>
            {{/each}}
          </nav>
          <div class="pres-foot">
            <div class="pres-meta">
              <p class="pres-keys" aria-hidden="true">
                <span><kbd>Space</kbd> build</span>
                <span><kbd>‹</kbd><kbd>›</kbd> step</span>
              </p>
              <span class="pres-folio">{{this.folio}}</span>
            </div>
            <label class="pres-xfade">
              <span class="pres-xfade-tag">Transition</span>
              <select
                aria-label="Slide transition"
                data-test-pres-xfade
                tabindex="-1"
                {{on "click" this.stop}}
                {{on "change" this.pickFade}}
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
              type="button"
              class="pres-restart"
              aria-label="Start over"
              data-test-pres-restart
              tabindex="-1"
              {{on "click" this.restart}}
            >Start over</button>
            <button
              type="button"
              class="pres-arr"
              aria-label="Previous build"
              data-test-pres-back
              tabindex="-1"
              {{on "click" this.stepBack}}
            >‹</button>
            <button
              type="button"
              class="pres-arr"
              aria-label="Next build"
              data-test-pres-fwd
              tabindex="-1"
              {{on "click" this.stepFwd}}
            >›</button>
          </div>
        </div>
        <i class="pres-ring" aria-hidden="true"></i>
      </div>
    </div>
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
