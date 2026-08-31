import { array, concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion } from 'glimmer-motion';

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
    <div class="ex jump-ex">
      <div class="jump-pane">
        {{! Sticky, INSIDE the scrolling pane — which is the thing `c.Raise`
            has to clear. A row scrolled to the top of the pane would sit
            under this bar; raised, it is out of the pane's clip entirely and
            passes over it. }}
        {{! A transport, not a button. The count is the readout, the two
            controls beside it are prev and next, and they are one object
            because they are one idea — move through the failures. }}
        <header class="jump-bar">
          <span class="jump-tally {{if this.done 'is-done' ''}}">
            {{this.tally}}
          </span>
          <div class="jump-transport">
            <button
              type="button"
              class="jump-back"
              aria-label="Previous failure"
              disabled={{this.backOff}}
              {{on "click" this.back}}
            >◂</button>
            <button
              type="button"
              class="jump-go"
              {{on "click" this.next}}
            >{{this.cta}}</button>
          </div>
        </header>

        {{! Sixty ticks, one per spec: the run at a glance, and the reference
            the scroll's travel is measured against. }}
        <ol class="jump-strip" aria-label="The run">
          {{#each this.strip key="id" as |tick|}}
            <li>
              <button
                type="button"
                class={{tick.cls}}
                title={{tick.label}}
                aria-label={{tick.label}}
                {{on "click" (fn this.goTo tick.id)}}
              ></button>
            </li>
          {{/each}}
        </ol>

        <Choreo class="jump-region" @debug={{this.debug}} as |c|>
          {{! The run, grouped the way it was written. The suite was on every
              row before, which said "layout" eight times in a column and gave
              the run no shape at all. }}
          <ol class="jump-list">
            {{#each this.groups key="suite" as |group|}}
              <li class="jump-group">
                <span class="jump-suite">{{group.suite}}</span>
                <span class="jump-count">{{this.groupNote group.suite}}</span>
              </li>
              {{#each group.specs key="id" as |spec|}}
                <li
                  class={{this.rowClass spec}}
                  {{motion id=spec.id role="row"}}
                >
                  <span class="jump-dot"></span>
                  <span class="jump-name">{{spec.name}}</span>
                  <span class="jump-ms">{{spec.ms}}ms</span>
                  {{#if spec.because}}
                    <span class="jump-why">{{spec.because}}</span>
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
          {{#each (array this.pass) key="@identity" as |ask|}}
            {{! The ask number is in the name so that pressing "next failure"
                twice on the same row is a different score. A region declines a
                pass whose compiled tree fingerprints identical to the one
                already standing — that is what stops a neighbour's render
                restarting every run on a busy page — and two asks for the same
                spec compile the same tree unless something says which ask this
                is. Pressing it twice on one row is a thing people do. }}
            <c.Sequence @name={{concat "ask-" ask}}>
              <c.Scroll
                @of={{c.id this.target}}
                @align={{this.align}}
                @duration={{0.5}}
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
                  @duration={{0.9}}
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
                  @backgroundColor="var(--bg-elev)"
                  @duration={{0.7}}
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
      <div class="jump-set">
        <span class="jump-key">land it</span>
        {{#each this.aligns key="value" as |option|}}
          <button
            type="button"
            class={{this.alignClass option.value}}
            {{on "click" (fn this.setAlign option.value)}}
          >{{option.label}}</button>
        {{/each}}

        <span class="jump-key">marks</span>
        {{#each this.marks key="label" as |option|}}
          <button
            type="button"
            class={{this.keepClass option.keep}}
            {{on "click" (fn this.setKeep option.keep)}}
          >{{option.label}}</button>
        {{/each}}

        <button
          type="button"
          class="{{this.debugClass}} jump-dev"
          title="outline every participant and print the pass"
          {{on "click" this.toggleDebug}}
        >debug</button>
      </div>
    </div>
  </template>
}

export default Jump;
