import { Choreo } from '@cardstack/choreo';
import { array, concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneSeconds } from '../lib/tuning';

/**
 * Nine tests are red in a run of sixty. Find each one, mark it, and do not lose
 * your place.
 *
 * This stage was a list of twenty-four numbered takes and four buttons reading
 * "take 3", "take 11", "take 19", "take 24". It demonstrated the same three
 * steps it demonstrates now and it taught nothing, for a reason worth stating
 * plainly: the motion answered a question the interface never let anyone have.
 * You asked for take 11 by name, from a button an inch away, and the scroll
 * then told you where take 11 was — which you did not need, because you had
 * just named it. A jump is only information when you did not already know
 * where you were going.
 *
 * A failing test is the case where you genuinely do not. You know there are
 * nine; you do not know where they are, how far apart they are, or whether
 * they cluster. So each of the three steps has a job that survives being
 * frozen:
 *
 * - **`c.Scroll`** tells you how far down the run the failure is and whether it
 *   sits with the others. Teleport instead and you get the row with none of the
 *   geography. It also yields to the wheel, which here is a requirement rather
 *   than a nicety: you are already scrolling to read an assertion when the next
 *   jump lands, and a jump that fights your hand is worse than no jump.
 * - **`c.Raise`** is the only way the row can sit outside the pane's `overflow`
 *   clip. `z-index` cannot buy that — a stacking context does not escape an
 *   ancestor's clip. Frozen mid-flight without it, the row is sliced by the
 *   pane's edge.
 *
 *   The toolbar used to overlap the list so that the raise had a header to pass
 *   over as well, which was a better demonstration and a worse interface: with
 *   `land it → at the top`, a row scrolls under the bar, and raising it — the
 *   step doing exactly its job — then covered the count. The bar has its own
 *   row now. The clip is the half of the claim that matters, and it is the half
 *   nothing else can do.
 * - **`c.Hold`** marks it, and `@fill` is the difference between a flash and a
 *   record. Keeping the marks is how you find your place after scrolling away
 *   to read a stack trace; flashing is right when you are only stepping
 *   through. Both are real preferences a person has while triaging, which is
 *   why the control says what they mean rather than saying `@fill`.
 *
 * `@debug` is still literal and still visible, because it is honestly a
 * developer control — but it is out of the app's own row, so it is not
 * competing with the verbs.
 */

const EASE = [0.32, 0.72, 0, 1] as const;

interface Spec {
  /** the assertion, for the ones that failed */
  because?: string;
  id: string;
  ms: number;
  name: string;
  ok: boolean;
  suite: string;
}

/**
 * A run of sixty, nine of them red, and the red ones deliberately NOT evenly
 * spaced: two of them adjacent near the top, a long clean stretch, then a
 * cluster at the bottom. That shape is the thing the scroll is reporting — a
 * run where the failures cluster is a different problem than one where they are
 * scattered, and you can see which from the travel alone.
 */
const SUITES: Array<[string, string[]]> = [
  [
    'layout',
    [
      'measures a resting box before the change',
      'reads a transformed parent through its screen CTM',
      'declines a pass nothing moved in',
      'keeps a scroll offset out of the delta',
      'reparents without a flash',
      'survives a scaled ancestor',
      'batches reads before writes',
      'settles a nested group inside out',
    ],
  ],
  [
    'presence',
    [
      'holds a leaver until its exit finishes',
      'claims an id a leaver gave up',
      'runs popLayout out of the flow',
      'reports exit complete once',
      'cancels an exit that came back',
      'keys by identity, not by index',
    ],
  ],
  [
    'drag',
    [
      'releases the global lock on unmount',
      'projects momentum from release velocity',
      'clamps to constraints with elastic',
      'forwards a handle to controls.start',
      'distinguishes a tap from a drag',
      'maps a point through a viewBox',
      'keeps the pointer captured across the fold',
    ],
  ],
  [
    'choreo/compile',
    [
      'orders a sequence by its anchors',
      'stretches a step to its stagger ladder',
      'gives a spring exactly two keyframes',
      'names a step so a twin does not dedupe',
      'fails a forward reference, named',
      'multiplies a repeat into the schedule',
      'resolves after(name) to end plus delay',
      'compiles an empty region to nothing',
    ],
  ],
  [
    'choreo/run',
    [
      'seeks to a time it never played',
      'reconstructs a relative cue under seek',
      'holds a fill past its window',
      'raises above an ancestor clip',
      'yields a scroll to the wheel',
      'pauses without losing the clock',
      'plays a paused run from where it stood',
      'ends once, not once per cue',
    ],
  ],
  [
    'gestures',
    [
      'starts a pan past the threshold',
      'ends a press that left the element',
      'reports velocity at release',
      'suppresses hover while dragging',
    ],
  ],
  [
    'camera',
    [
      'fits a target to a padding share',
      'aims without changing zoom',
      'pans relative to the shot in force',
      'clamps a shot to the world',
      'composes a zoom onto an aim',
    ],
  ],
  [
    'scroll',
    [
      'observes against a container root',
      'fires once when once is asked for',
      'tracks progress through a band',
      'stops at the end of the track',
    ],
  ],
  [
    'value',
    [
      'interpolates a colour through oklab',
      'rounds a unitless value cleanly',
      'reads back a transform it wrote',
      'shares one value between two nodes',
    ],
  ],
  [
    'ssr',
    [
      'renders initial without a document',
      'defers measurement to the first frame',
      'emits no transform before hydration',
      'matches the server pose on the first frame',
    ],
  ],
  [
    'reorder',
    [
      'moves a keyed node rather than rebuilding it',
      'settles a dropped item against its neighbours',
    ],
  ],
];

/**
 * Which ones are red, by flat index into SUITES, each with the assertion that
 * belongs to THAT test.
 *
 * Worth stating because the first version got it wrong and it was the single
 * most damaging thing on the stage: the indices were picked for their spacing
 * and the assertions were written separately, so "seek(2.4) landed at 1.9"
 * ended up under a test about suppressing hover. Every row read as nonsense to
 * anyone who actually read it, which on a stage whose whole subject is READING
 * a list is fatal. The failures still cluster the way the scroll wants — two
 * adjacent near the top, a long clean stretch, three in a row in choreo/run —
 * but the shape is now chosen from rows that could plausibly fail together.
 */
const RED = new Map<number, string>([
  [3, 'expected 0 in the delta, got 118 — the container had scrolled'],
  [4, 'element was rebuilt: 2 mounts, expected 1'],
  [11, 'exit complete fired twice for "card-3"'],
  [19, 'expected (240, 96), got (480, 192) — viewBox scale not divided out'],
  [30, 'seek(2.4) landed at 1.9 — the relative cue lost its base'],
  [31, 'fill released at window end, expected held'],
  [32, 'row clipped by .pane overflow at y=312'],
  [42, 'zoom moved 1.00 to 1.18 during an aim'],
  [52, 'read back "none" after writing translateX(40px)'],
]);

const SPECS: Spec[] = (() => {
  const out: Spec[] = [];
  let i = 0;
  for (const [suite, names] of SUITES) {
    for (const name of names) {
      const because = RED.get(i);
      out.push({
        because,
        id: `spec-${i}`,
        // a stable pseudo-duration: this list must not change between renders
        ms: 4 + ((i * 37) % 90),
        name,
        ok: because === undefined,
        suite,
      });
      i += 1;
    }
  }
  return out;
})();

const ALIGNS = [
  { label: 'centred', value: 'center' },
  { label: 'at the top', value: 'start' },
] as const;

const MARKS = [
  { keep: true, label: 'kept' },
  { keep: false, label: 'a flash' },
] as const;

/** the run, grouped the way it was written — which is how it reads */
const GROUPS = SUITES.map(([suite]) => ({
  specs: SPECS.filter((s) => s.suite === suite),
  suite,
}));

export class Jump extends Component {
  specs = SPECS;
  groups = GROUPS;
  aligns = ALIGNS;
  marks = MARKS;

  @tracked align: 'center' | 'start' = 'center';
  /** keep a record of what has been looked at, or just flash it */
  @tracked keep = true;
  @tracked debug = false;
  @tracked target = '';
  /** a new number for every jump, so asking for the same row twice re-runs it */
  @tracked pass = 0;
  /** where in the list of failures the cursor stands; -1 before the first jump */
  @tracked cursor = -1;
  @tracked seen: string[] = [];

  get failures() {
    return SPECS.filter((s) => !s.ok);
  }

  /**
   * The whole run as sixty ticks, beside the list.
   *
   * This is the thing the stage was missing, and it was missing the point with
   * it. `c.Scroll` is here because a jump should tell you HOW FAR DOWN the run
   * a failure is and whether it sits with the others — and a pane showing eight
   * rows out of sixty gives that travel nothing to mean anything against. You
   * watched a list move and learned nothing from the movement.
   *
   * With the strip, the same scroll is legible: you can see the two failures
   * near the top, the long clean stretch, the three in a row in the middle. The
   * scroll is the answer and the strip is the question it is answering.
   *
   * It is also the fastest way to get anywhere, which is why the ticks are
   * buttons. A minimap you cannot click is a decoration.
   */
  get strip() {
    return SPECS.map((spec) => ({
      cls: this.tickClass(spec),
      id: spec.id,
      label: spec.ok ? spec.name : `${spec.name} — failing`,
    }));
  }

  tickClass = (spec: Spec) => {
    const classes = ['jump-tick'];
    if (!spec.ok) {
      classes.push('is-red');
    }
    if (this.seen.includes(spec.id)) {
      classes.push('is-seen');
    }
    if (this.target === spec.id) {
      classes.push('is-at');
    }
    return classes.join(' ');
  };

  /** the strip is navigation as well as a picture: go straight to that spec */
  goTo = (id: string) => {
    const at = this.failures.findIndex((f) => f.id === id);
    if (at >= 0) {
      this.cursor = at;
    }
    this.target = id;
    this.pass += 1;
    if (this.keep && !this.seen.includes(id)) {
      this.seen = [...this.seen, id];
    }
  };

  failuresIn = (suite: string) =>
    SPECS.filter((s) => s.suite === suite && !s.ok).length;

  groupNote = (suite: string) => {
    const n = this.failuresIn(suite);
    const all = SPECS.filter((s) => s.suite === suite).length;
    return n === 0 ? `${all} passing` : `${all} · ${n} failing`;
  };

  get triagedCount() {
    return this.seen.length;
  }

  get done() {
    return this.seen.length >= this.failures.length;
  }

  get tally() {
    const n = this.failures.length;
    if (!this.keep) {
      return `${n} failing`;
    }
    return this.done
      ? `all ${n} triaged`
      : `${n} failing · ${this.triagedCount} triaged`;
  }

  /**
   * One label, always. It used to read "first failure" until you had pressed it
   * once and "next failure" thereafter, which is churn in the one place on the
   * stage that should be a fixed point: the control you press over and over
   * changing its name under your hand reads as something having gone wrong.
   */
  readonly cta = 'next failure';

  /** disabled on the first failure, because there is nothing behind it */
  get backOff() {
    return this.cursor <= 0;
  }

  /**
   * The cursor walks the failures in order and wraps. It does NOT skip the ones
   * already seen: coming back to a failure you have already read is an ordinary
   * thing to do — you are checking whether the fix took — and a button that
   * silently refuses to revisit is a button that has decided what you meant.
   */
  next = () => {
    const fails = this.failures;
    if (!fails.length) {
      return;
    }
    const at = (this.cursor + 1) % fails.length;
    const spec = fails[at]!;
    this.cursor = at;
    this.target = spec.id;
    this.pass += 1;
    if (this.keep && !this.seen.includes(spec.id)) {
      this.seen = [...this.seen, spec.id];
    }
  };

  /**
   * The other half of the transport. A "next" with no "back" is not a
   * transport, it is a slideshow — and going back to the last failure is what
   * you do the moment you have read the one after it and want to compare.
   */
  back = () => {
    const fails = this.failures;
    if (this.cursor <= 0 || !fails.length) {
      return;
    }
    const at = this.cursor - 1;
    this.cursor = at;
    this.target = fails[at]!.id;
    this.pass += 1;
  };

  setAlign = (align: 'center' | 'start') => {
    this.align = align;
  };

  /**
   * Turning the record off clears it, rather than hiding it and bringing it
   * back. The control is a statement about how you want to work, and a set of
   * marks that reappear from a previous mood is a set of marks you no longer
   * trust.
   */
  setKeep = (keep: boolean) => {
    if (keep === this.keep) {
      return;
    }
    this.keep = keep;
    if (!keep) {
      this.seen = [];
    }
  };

  toggleDebug = () => {
    this.debug = !this.debug;
  };

  alignClass = (value: string) =>
    this.align === value ? 'chip is-on' : 'chip';

  /**
   * Getters, not methods. `class={{this.keepClass}}` on a zero-argument method
   * renders the FUNCTION — Glimmer only invokes a value that is a helper — and
   * the attribute comes out empty rather than wrong, so the control simply
   * stops showing its state and nothing anywhere reports a problem.
   */
  keepClass = (keep: boolean) =>
    keep === this.keep ? 'jump-opt is-on' : 'jump-opt';

  get debugClass() {
    return this.debug ? 'jump-opt is-on' : 'jump-opt';
  }

  rowClass = (spec: Spec) => {
    const state = spec.ok ? 'jump-row' : 'jump-row is-red';
    return this.seen.includes(spec.id) ? `${state} is-seen` : state;
  };

  <template>
    <div class='ex jump-ex'>
      <div class='jump-pane'>
        {{! Sticky, INSIDE the scrolling pane — which is the thing `c.Raise`
            has to clear. A row scrolled to the top of the pane would sit
            under this bar; raised, it is out of the pane's clip entirely and
            passes over it. }}
        {{! A transport, not a button. The count is the readout, the two
            controls beside it are prev and next, and they are one object
            because they are one idea — move through the failures. }}
        <header class='jump-bar'>
          <span class='jump-tally {{if this.done "is-done" ""}}'>
            {{this.tally}}
          </span>
          <div class='jump-transport'>
            <button
              type='button'
              class='jump-back'
              aria-label='Previous failure'
              disabled={{this.backOff}}
              {{on 'click' this.back}}
            >◂</button>
            <button
              type='button'
              class='jump-go'
              {{on 'click' this.next}}
            >{{this.cta}}</button>
          </div>
        </header>

        {{! Sixty ticks, one per spec: the run at a glance, and the reference
            the scroll's travel is measured against. }}
        <ol class='jump-strip' aria-label='The run'>
          {{#each this.strip key='id' as |tick|}}
            <li>
              <button
                type='button'
                class={{tick.cls}}
                title={{tick.label}}
                aria-label={{tick.label}}
                {{on 'click' (fn this.goTo tick.id)}}
              ></button>
            </li>
          {{/each}}
        </ol>

        <Choreo class='jump-region' @debug={{this.debug}} as |c|>
          {{! The run, grouped the way it was written. The suite was on every
              row before, which said "layout" eight times in a column and gave
              the run no shape at all. }}
          <ol class='jump-list'>
            {{#each this.groups key='suite' as |group|}}
              <li class='jump-group'>
                <span class='jump-suite'>{{group.suite}}</span>
                <span class='jump-count'>{{this.groupNote group.suite}}</span>
              </li>
              {{#each group.specs key='id' as |spec|}}
                <li
                  class={{this.rowClass spec}}
                  {{motion id=spec.id role='row'}}
                >
                  <span class='jump-dot'></span>
                  <span class='jump-name'>{{spec.name}}</span>
                  <span class='jump-ms'>{{spec.ms}}ms</span>
                  {{#if spec.because}}
                    <span class='jump-why'>{{spec.because}}</span>
                  {{/if}}
                </li>
              {{/each}}
            {{/each}}
          </ol>

          {{! The score is rendered from the first pass, not from the first
              click. A region does not collect a timeline on the pass that
              first renders it — so a score that appears in the same pass as
              the change it describes sits out that change and runs on the
              next one. With an empty target the steps select nothing and cost
              nothing; the first press then has a score waiting for it. }}
          {{#each (array this.pass) key='@identity' as |ask|}}
            {{! The ask number is in the name so that pressing "next failure"
                twice on the same row is a different score. A region declines a
                pass whose compiled tree fingerprints identical to the one
                already standing — that is what stops a neighbour's render
                restarting every run on a busy page — and two asks for the same
                spec compile the same tree unless something says which ask this
                is. Pressing it twice on one row is a thing people do. }}
            <c.Sequence @name={{concat 'ask-' ask}}>
              <c.Scroll
                @of={{c.id this.target}}
                @align={{this.align}}
                @duration={{tuneSeconds 'jump' 0.5 'Scroll duration 1'}}
                @ease={{EASE}}
              />
              <c.Parallel>
                {{! only once it has arrived: out of the pane's clip for the
                    length of the window, with the shadow that says it left the
                    page. Raising DURING the scroll would pin the row to where
                    it stood when the lift began and the list would slide out
                    from under it. }}
                <c.Raise
                  @of={{c.id this.target}}
                  @shadow={{true}}
                  @duration={{tuneSeconds 'jump' 0.9 'Raise duration 2'}}
                />
                {{! and the mark. `@fill` holds it past the window when the
                    marks are being kept, which bridges the flight to the
                    render that commits the row's own class — without it the
                    highlight drops on the last frame and the class arrives on
                    the next one, and the row blinks in between. }}
                {{! An OPAQUE surface, not a tint. The row is out of the
                    list's clip and above everything at this moment, and a
                    translucent mark lets the rows it is passing over show
                    through it — which reads as a rendering fault rather than
                    as a lift. Everything else on the list is deliberately a
                    little transparent, so the one solid thing is the one
                    being pointed at. }}
                <c.Hold
                  @of={{c.id this.target}}
                  @backgroundColor='var(--bg-elev)'
                  @duration={{tuneSeconds 'jump' 0.7 'Hold duration 3'}}
                  @fill={{this.keep}}
                />
              </c.Parallel>
            </c.Sequence>
          {{/each}}
        </Choreo>
      </div>

      {{! Settings for an instrument, said as a sentence. These were four
          uppercase chips in a row, which is what a control panel looks like
          when it has been bolted under an app rather than built into one — and
          three of them were preferences, not verbs. Verbs get buttons;
          preferences get words you can click. }}
      <div class='jump-set'>
        <span class='jump-key'>land it</span>
        {{#each this.aligns key='value' as |option|}}
          <button
            type='button'
            class={{this.alignClass option.value}}
            {{on 'click' (fn this.setAlign option.value)}}
          >{{option.label}}</button>
        {{/each}}

        <span class='jump-key'>marks</span>
        {{#each this.marks key='label' as |option|}}
          <button
            type='button'
            class={{this.keepClass option.keep}}
            {{on 'click' (fn this.setKeep option.keep)}}
          >{{option.label}}</button>
        {{/each}}

        <button
          type='button'
          class='{{this.debugClass}} jump-dev'
          title='outline every participant and print the pass'
          {{on 'click' this.toggleDebug}}
        >debug</button>
      </div>
    </div>
    <style scoped>
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

      .chip.is-on {
        color: var(--ink);
        border-color: var(--line-strong);
        background: var(--bg-spot);
      }

      @media (hover: hover) {
        .chip:hover {
          color: var(--ink);
          border-color: var(--line-strong);
          background: var(--bg-spot);
        }
      }

      .chip.is-on {
        box-shadow: inset 0 0 0 1px rgba(255, 59, 31, 0.35);
        color: var(--ember-hot);
      }

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

      @media (max-width: 720px) {
        .chip {
          padding: 9px 14px;
        }
      }

      /* ---- Triage: nine red in sixty, and not losing your place ---- */

      .jump-ex {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: min(720px, 100%);
      }

      /* The pane is the scroll container `c.Scroll` drives and the clip `c.Raise`
         has to escape. Both of those are the point of the stage, so it is a real
         overflow box rather than the page's own scroll. */
      .jump-pane {
        background: rgba(var(--ink-rgb), 0.03);
        border: 1px solid var(--line);
        border-radius: 10px;
        display: grid;
        flex: 1;
        /* the strip, then the run */
        grid-template-columns: 16px minmax(0, 1fr);
        /* and ONE row that cannot grow. Without this the row is sized by its content
           — sixty rows, about 2200px — and the pane stops being a viewport at all:
           the strip stretches to the full height of the run it is supposed to be a
           miniature of. `minmax(0, 1fr)` is the grid spelling of "take the height you
           were given and no more". */
        /* the bar, then the run. The bar used to be absolutely positioned OVER the
           list, which is how it managed to be covered by its own content: with
           `land it → at the top` a row scrolls under it, and raising that row —
           which is `c.Raise` doing exactly its job — put it over the count. A bar in
           its own row cannot be covered, and the raise still has the thing that
           matters to escape: the pane's clip. */
        grid-template-rows: auto minmax(0, 1fr);
        min-height: 0;
        overflow: hidden;
        position: relative;
      }

      /* The run as sixty ticks. Sixteen pixels of gutter that turn the scroll from
         a movement into a measurement: you can see the two failures near the top, the
         long clean stretch, the three together in the middle — and then watch the
         list travel exactly that far. Without it the pane shows eight rows out of
         sixty and the travel has nothing to mean anything against. */
      .jump-strip {
        background: rgba(var(--ink-rgb), 0.04);
        border-right: 1px solid var(--line);
        grid-row: 1 / -1;
        display: flex;
        flex-direction: column;
        gap: 1px;
        justify-content: center;
        list-style: none;
        margin: 0;
        min-height: 0;
        overflow: hidden;
        padding: 6px 4px;
      }

      .jump-strip li {
        display: flex;
        flex: 1;
        max-height: 7px;
      }

      .jump-tick {
        background: rgba(var(--ink-rgb), 0.16);
        border: 0;
        border-radius: 1px;
        cursor: pointer;
        display: block;
        flex: 1;
        padding: 0;
        transition:
          background 140ms var(--ease),
          transform 140ms var(--ease);
      }

      .jump-tick:hover {
        transform: scaleX(1.6);
      }

      .jump-tick.is-red {
        background: var(--ember);
      }

      /* a failure that has been looked at: still there, no longer shouting */
      .jump-tick.is-red.is-seen {
        background: rgba(255, 59, 31, 0.4);
      }

      .jump-tick.is-at {
        background: var(--copper);
        transform: scaleX(1.8);
      }

      .jump-bar {
        align-items: center;
        background: rgba(var(--bg-rgb), 0.7);
        border-bottom: 1px solid var(--line);
        display: flex;
        gap: 10px;
        grid-column: 2;
        padding: 8px 10px;
      }

      .jump-tally {
        color: var(--ink-dim);
        flex: 1;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.04em;
      }

      .jump-tally.is-done {
        color: var(--copper-ink);
      }

      /* The transport: one object, because prev and next are one idea. Joined rather
         than spaced, with the primary carrying the colour — a pair of equal buttons
         would make going back look like half the point of the stage. */
      .jump-transport {
        display: flex;
        flex: none;
        gap: 1px;
      }

      .jump-back,
      .jump-go {
        border: 0;
        cursor: pointer;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.04em;
        padding: 5px 12px;
        transition:
          background 160ms var(--ease),
          color 160ms var(--ease);
      }

      .jump-back {
        background: rgba(var(--ink-rgb), 0.08);
        border-radius: 999px 0 0 999px;
        color: var(--ink-dim);
        padding: 5px 10px;
      }

      .jump-back:hover:not(:disabled) {
        background: rgba(var(--ink-rgb), 0.14);
        color: var(--ink);
      }

      .jump-back:disabled {
        cursor: default;
        opacity: 0.35;
      }

      /* Not red. Red on this stage means FAILING — it is on nine rows, nine ticks in
         the strip and every assertion — and a red button is then the loudest thing on
         screen while meaning nothing of the sort. A semantic colour has to keep its
         one job or it stops being semantic. The transport is ink, and the copper
         underline in the settings row is the only other accent. */
      .jump-go {
        background: rgba(var(--ink-rgb), 0.14);
        border-radius: 0 999px 999px 0;
        color: var(--ink);
      }

      .jump-go:hover {
        background: rgba(var(--ink-rgb), 0.22);
      }

      /* The region sits in the second column, under the bar. */
      .jump-region {
        grid-column: 2;
        grid-row: 2;
        min-height: 0;
      }

      /* The region is the positioned wrapper and NOT the scroller.
         The scroll container has to be a descendant, for two reasons that point the
         same way. `c.Scroll` drives the sprite's own scroll container, and the region
         element is not it. And the raise layer lives inside the region — so a region
         that scrolled would carry the raised row along with the list, which is
         exactly what the raise exists to prevent. */
      .jump-region {
        height: 100%;
        position: relative;
      }

      .jump-list {
        display: flex;
        flex-direction: column;
        height: 100%;
        list-style: none;
        margin: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 6px 0 12px;
        /* Reserve the scrollbar's channel whether or not there is a scrollbar. Without
           it the box is one width when the list overflows and another when a filter
           leaves it short, and everything inside shifts sideways as you use it. */
        scrollbar-gutter: stable;
        scrollbar-width: thin;
      }

      /* A suite header, so the run has a shape. The suite used to be a column on
         every row, which said "layout" eight times and told you nothing. */
      .jump-group {
        align-items: baseline;
        color: var(--ink-faint);
        display: flex;
        font-family: var(--font-mono);
        font-size: 9.5px;
        gap: 8px;
        letter-spacing: 0.1em;
        margin: 10px 6px 2px;
        padding: 0 8px 3px;
        text-transform: uppercase;
      }

      .jump-group:first-child {
        margin-top: 0;
      }

      .jump-suite {
        color: var(--ink-dim);
      }

      .jump-count {
        border-top: 1px solid var(--line);
        flex: 1;
        padding-top: 3px;
        text-align: right;
      }

      /* At rest a row is a little transparent, so that the one the transport has
         raised — opaque, on its own surface — is unmistakably the one being pointed
         at. A list where everything is solid has to shout to mark one row; a list
         that is quiet only has to stop being quiet. */
      .jump-row {
        align-items: baseline;
        border-radius: 5px;
        color: var(--ink-dim);
        opacity: 0.72;
        display: grid;
        font-size: 11.5px;
        gap: 0 8px;
        grid-template-columns: 8px minmax(0, 1fr) auto;
        margin: 0 6px;
        padding: 5px 8px;
      }

      /* A failure reads as a block rather than as a line with a red dot on it: it is
         the thing you are hunting, and it should be findable while the list is
         moving past.
         A tint and a full hairline ring, NOT an inset left bar. A straight band
         fights the corner radius it sits inside — it either stops short and leaves a
         notch or runs into the curve and is clipped into a wedge, and no radius makes
         that look deliberate. A ring follows the shape. */
      .jump-row.is-red {
        background: rgba(255, 59, 31, 0.07);
        box-shadow: inset 0 0 0 1px rgba(255, 59, 31, 0.22);
        opacity: 0.92;
      }

      /* the pass/fail mark, which is the only colour on a green row */
      .jump-dot {
        background: var(--steel);
        border-radius: 50%;
        height: 6px;
        opacity: 0.5;
        width: 6px;
      }

      .jump-row.is-red .jump-dot {
        background: var(--ember);
        opacity: 1;
      }

      .jump-suite {
        color: var(--ink-faint);
        font-family: var(--font-mono);
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .jump-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .jump-row.is-red .jump-name {
        color: var(--ink);
      }

      .jump-ms {
        color: var(--ink-faint);
        font-family: var(--font-mono);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }

      /* the assertion, under the name and indented to it */
      .jump-why {
        color: var(--ember);
        font-family: var(--font-mono);
        font-size: 10px;
        grid-column: 2 / -1;
        opacity: 0.85;
        padding-top: 2px;
      }

      /* The record. This is app state — a row you have been to — and it is what
         `@fill` bridges to: the hold keeps the mark alive until the render that adds
         this class has landed, so the row does not blink between the two.
         Handled reads as HANDLED: it steps back rather than lighting up. A triaged
         failure is one you no longer need to find. */
      .jump-row.is-seen {
        opacity: 0.45;
      }

      .jump-row.is-seen .jump-dot {
        background: transparent;
        box-shadow: inset 0 0 0 1.5px var(--ember);
      }

      /* Preferences, as a line of words rather than a row of chips.
         Four uppercase pills under an app is what a control panel looks like when it
         has been bolted on; and three of these are not verbs at all, they are
         choices. A verb earns a button. A choice earns a word you can click, marked
         by weight and colour rather than by a box. */
      .jump-set {
        align-items: baseline;
        color: var(--ink-faint);
        display: flex;
        flex-wrap: wrap;
        font-size: 11px;
        gap: 4px 8px;
      }

      .jump-key {
        color: var(--ink-faint);
        font-family: var(--font-mono);
        font-size: 9.5px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .jump-key:not(:first-child) {
        margin-left: 8px;
      }

      .jump-opt {
        background: none;
        border: 0;
        border-bottom: 1px solid transparent;
        color: var(--ink-faint);
        cursor: pointer;
        font-size: 11px;
        padding: 0 0 1px;
        transition:
          color 140ms var(--ease),
          border-color 140ms var(--ease);
      }

      .jump-opt:hover {
        color: var(--ink-dim);
      }

      .jump-opt.is-on {
        border-bottom-color: var(--copper);
        color: var(--ink);
      }

      /* honestly a developer control, so it sits apart and stays quiet */
      .jump-dev {
        font-family: var(--font-mono);
        font-size: 10px;
        margin-left: auto;
      }

      @container platter (max-width: 430px) {
        .jump-ms {
          display: none;
        }
      }
      @container (max-width: 400px) {
        .jump-ex {
          transform: scale(0.78);
          transform-origin: center;
        }
      }
    </style>
  </template>
}

export default Jump;

// Declare the demo variables before the first interactive Choreo pass.
tuneSeconds('jump', 0.5, 'Scroll duration 1');
tuneSeconds('jump', 0.9, 'Raise duration 2');
tuneSeconds('jump', 0.7, 'Hold duration 3');

export class JumpDemo extends GalleryDemo {
  static stage = Jump;
}
