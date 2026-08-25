import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { ChoreoRun, Query, SpringSpec } from 'glimmer-motion';
import { at, Choreo, motion } from 'glimmer-motion';
import { motionValue } from 'motion-dom';
import { preventSelect } from 'test-app/lib/pointer';

/* ── the app being driven ────────────────────────────────────────────────── */

interface State {
  placed: boolean;
  speed: 'express' | 'standard';
  wrap: boolean;
}

const INITIAL: State = { placed: false, speed: 'standard', wrap: false };

/**
 * What pressing a control does — written once, run by both readings of the
 * score. The buttons call it on click, and the transport folds it over the
 * presses behind the playhead to work out what the app IS at a scrubbed
 * time. There is no second description of the app's behaviour for the
 * timeline to disagree with.
 */
function press(state: State, cue: string): State {
  switch (cue) {
    case 'done':
      return INITIAL;
    case 'express':
      return { ...state, speed: 'express' };
    case 'place':
      return { ...state, placed: true };
    case 'standard':
      return { ...state, speed: 'standard' };
    case 'wrap':
      return { ...state, wrap: !state.wrap };
    default:
      return state;
  }
}

/** how far the segmented pill and the switch knob travel, in px */
const SEG = 127;
const KNOB = 20;

/**
 * One spring per element — the same numbers whether the score plays them,
 * the scrubber samples them, or a live hand interrupts them.
 */
const PILL: SpringSpec = { bounce: 0.3, visualDuration: 0.36 };
const KNOB_S: SpringSpec = { bounce: 0.36, visualDuration: 0.3 };
const LIT: SpringSpec = { bounce: 0, visualDuration: 0.18 };
const APP: SpringSpec = { bounce: 0.1, visualDuration: 0.4 };
const RECEIPT: SpringSpec = { bounce: 0.28, visualDuration: 0.48 };

/**
 * The score names the STANDING scene: kept sprites, by id — an untyped id
 * query would conscript a dying gallery card's parts into the score while
 * its Presence waits (see the Build Order demo, which learned this first).
 */
const standing = (id: string): Query => ({ id, type: 'kept' });

/** the presses, in score order — the fixed cast the transport folds over */
const PRESSES = ['express', 'wrap', 'place', 'done'] as const;

/** a press's click lands mid-dip: the finger is down at 55% of the press */
const CLICK_AT = 0.55;

/* ── the demo ────────────────────────────────────────────────────────────── */

/**
 * A UI, a hand that clicks it, and a playhead you can drag.
 *
 * The score IS the template now: a `<c.Sequence>` of holds, walks and
 * presses, with the app's own value changes anchored to the presses by
 * name — `{{at 'press-express' 0.55}}` is "as the finger lands". The old
 * private sampler (a `poseAt` that re-ran Motion's spring generator, a
 * `ghostAt` that eased the hand along its clips) is deleted whole: the
 * library plays the score, and a scrubbed frame is the library's own
 * computed still. The walks' coordinates are still measured here — where
 * a control LIVES is this stage's knowledge — but nothing about TIME is.
 *
 * Three modes, and they differ in exactly one thing: who owns the clock.
 *
 *   playing   `run.play()`. The score fires a REAL `.click()` on the real
 *             control as each press's moment goes by — the transport reads
 *             `run.time`, and the app's own handler is what changes the
 *             app. The playhead is a readout.
 *   scored    `run.pause()` and `run.time = t`. A scrubbed frame is a
 *             computed still; dragging backwards is the same operation as
 *             dragging forwards. The app's STATE at t is folded from the
 *             presses behind the playhead — same reducer the buttons use.
 *   live      You own it. Touch a control yourself and the score steps
 *             aside — the template swaps the score for a handful of
 *             state-target springs, so the app behaves like the plain app
 *             it is. Play, Reset and the scrubber all take the scene back.
 */
export class Playhead extends Component {
  @tracked mode: 'live' | 'playing' | 'scored' = 'scored';
  @tracked state: State = INITIAL;
  /** bumped once, when first seen: the region's first render plays nothing */
  @tracked take = 0;
  /** re-measured layout: the walks' coordinates re-resolve through this */
  @tracked measured = 0;
  /** where each press lands on the rail — read back from `run.cues` */
  @tracked marks: { cue: string; style: ReturnType<typeof htmlSafe> }[] = [];

  /**
   * The playhead in seconds and the run's length — NOT tracked: the region
   * re-passes on every render, so per-frame tracked writes would replay the
   * pass per frame (the Build Order demo's lesson). The clock, the range
   * and the rail are written imperatively in `paint`.
   */
  private t = 0;
  private runtime = 0;
  /** each press's moment in seconds, resolved by the compiler */
  private pressAt: number[] = [];
  /** how many presses have already been dispatched */
  private fired = 0;
  /** true while the score is clicking, so `hit` knows it is not a real hand */
  private scripted = false;

  private c?: { run: ChoreoRun | null };
  private seen: ChoreoRun | null = null;
  /** the run that IS the score — the live branch's springs are never it,
      and the transport must never seek them */
  private scoreRun: ChoreoRun | null = null;
  private reseek: number | null = null;
  private scrubbing = false;

  /** the rail's fill and head — motion values, painted per frame */
  private fill = motionValue(0);
  private hp = motionValue(0);

  private stage?: HTMLElement;
  private spots = new Map<string, { x: number; y: number }>();
  private rest: { x: number; y: number } | null = null;
  private railW = 0;
  private watcher?: ResizeObserver;
  private viewport?: IntersectionObserver;
  private raf = 0;
  private clockEl?: HTMLElement | null;
  private rangeEl?: HTMLInputElement | null;

  willDestroy() {
    super.willDestroy();
    cancelAnimationFrame(this.raf);
    this.watcher?.disconnect();
    this.viewport?.disconnect();
  }

  /* — wiring — */

  wire = modifier((_el: Element, [c]: [{ run: ChoreoRun | null }]) => {
    this.c = c;
  });

  register = modifier((el: HTMLElement) => {
    this.stage = el;
    // a debug/test handle: the integration test drives the transport directly
    (el as HTMLElement & { playhead?: Playhead }).playhead = this;
    this.watcher = new ResizeObserver(() => {
      this.spots.clear();
      this.rest = null;
      this.measureRail();
      // the tracked bump re-renders, and a render inside ResizeObserver's
      // own dispatch is the textbook "RO loop completed with undelivered
      // notifications" — defer it one frame
      requestAnimationFrame(() => {
        if (!this.isDestroying) {
          this.measured++;
        }
      });
    });
    this.watcher.observe(el);
    // the score plays on demand, but only while it is being looked at —
    // off screen the run pauses where it was; back on, a press of Play
    // carries on from there
    this.viewport = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.raf ||= requestAnimationFrame(this.tick);
          if (this.seen === null && this.take === 0) {
            // the parked opening: the first pass compiles the score so the
            // transport has a run to hold — paused at 0, waiting for Play
            this.take++;
          }
        } else {
          cancelAnimationFrame(this.raf);
          this.raf = 0;
          if (this.mode === 'playing') {
            this.mode = 'scored';
            this.c?.run?.pause();
          }
        }
      },
      { threshold: 0.35 }
    );
    this.viewport.observe(el);
    this.measureRail();
    // the hand waits at home from the very first paint — the score's pin
    // takes over the moment the first run exists
    const hand = el.querySelector<HTMLElement>('.ph-hand');
    if (hand) {
      const rest = this.home();
      hand.style.transform = `translateX(${rest.x}px) translateY(${rest.y}px)`;
    }
    return () => {
      this.watcher?.disconnect();
      this.viewport?.disconnect();
      this.watcher = undefined;
      this.viewport = undefined;
      this.stage = undefined;
    };
  });

  private measureRail() {
    this.railW =
      this.stage?.querySelector<HTMLElement>('.ph-track')?.clientWidth ?? 0;
  }

  /* — measuring the walks — */

  /**
   * A cue's centre, in stage coordinates — by offset, not by
   * `getBoundingClientRect`: the card is scaled while the receipt is up, so
   * a measured rectangle would be wherever the animation had got to. Layout
   * offsets ignore transforms, so the hand aims at where the control LIVES.
   */
  private place(cue: string): { x: number; y: number } {
    if (cue === 'home') {
      return this.home();
    }
    const known = this.spots.get(cue);
    if (known) {
      return known;
    }
    const root = this.stage;
    const el = root?.querySelector<HTMLElement>(`[data-cue="${cue}"]`);
    if (!root || !el) {
      return this.home();
    }
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = el;
    while (node && node !== root) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    const spot = { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
    this.spots.set(cue, spot);
    return spot;
  }

  /**
   * Where the hand waits and returns to: just off the card's right edge, a
   * third of the way down — measured from the card, not a fraction of the
   * stage, so a tall phone layout does not park it in dead space. Cached
   * per layout: the score both starts and ends here, and a home computed
   * live would drift as the card's own springs settle.
   */
  private home(): { x: number; y: number } {
    if (this.rest) {
      return this.rest;
    }
    const el = this.stage;
    const w = el?.clientWidth ?? 320;
    const h = el?.clientHeight ?? 380;
    const card = el?.querySelector<HTMLElement>('.ph-app');
    if (!card || !el) {
      return { x: w * 0.82, y: h * 0.4 };
    }
    let left = 0;
    let top = 0;
    let node: HTMLElement | null = card;
    while (node && node !== el) {
      left += node.offsetLeft;
      top += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    this.rest = {
      x: Math.min(left + card.offsetWidth + 34, w - 26),
      y: Math.max(top + card.offsetHeight * 0.32, 26),
    };
    return this.rest;
  }

  /** a walk's keyframes: from one spot's coordinate to the next */
  walkX = (from: string, to: string): number[] => {
    void this.measured;
    return [this.place(from).x, this.place(to).x];
  };

  walkY = (from: string, to: string): number[] => {
    void this.measured;
    return [this.place(from).y, this.place(to).y];
  };

  /* — the transport: a reader, not a clock — */

  private tick = () => {
    const run = this.c?.run ?? null;
    if (run && run !== this.seen) {
      this.seen = run;
      if (this.mode !== 'live') {
        this.scoreRun = run;
        this.adopt(run);
      }
    }
    if (run && run === this.scoreRun && this.mode !== 'live') {
      this.t = run.time;
      this.paint();
      if (this.mode === 'playing') {
        this.dispatch(this.t);
        if (this.t >= run.duration - 0.02) {
          // park at the end rather than let the run finish: a FINISHED
          // run replays on any unrelated render (that is the Hold-refire
          // rule), and a score that has been watched must simply stand
          run.pause();
          run.time = Math.max(0, run.duration - 0.01);
          this.mode = 'scored';
        }
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private paint() {
    const progress = this.runtime > 0 ? this.t / this.runtime : 0;
    this.fill.jump(progress);
    this.hp.jump(progress * this.railW);
    this.clockEl ??= this.stage?.querySelector<HTMLElement>('.ph-clock');
    this.rangeEl ??= this.stage?.querySelector<HTMLInputElement>('.ph-range');
    const text = `${this.t.toFixed(2)}s`;
    if (this.clockEl && this.clockEl.textContent !== text) {
      this.clockEl.textContent = text;
    }
    if (this.rangeEl && !this.scrubbing) {
      const max = String(this.runtime);
      if (this.rangeEl.max !== max) {
        this.rangeEl.max = max;
      }
      if (
        this.mode === 'playing' ||
        Math.abs(Number(this.rangeEl.value) - this.t) > 0.02
      ) {
        this.rangeEl.value = String(this.t);
      }
    }
  }

  private adopt(run: ChoreoRun) {
    this.runtime = run.duration;
    // continuity: a replaced run resumes where the last stood; only a run
    // parked at zero or the very end starts its successor fresh
    const target = Math.min(
      this.reseek ?? this.t,
      Math.max(0, run.duration - 0.01)
    );
    this.reseek = null;
    if (target > 0.005) {
      run.time = target;
    }
    if (this.mode !== 'playing') {
      run.pause();
    }
    // the presses' moments, read back from the compiled cues: a press is
    // the hand's scale dip, and the click lands 55% of the way into it
    const total = Math.max(
      1,
      ...run.cues.map((cue) => cue.start + cue.duration)
    );
    const dips = run.cues
      .filter(
        (cue) =>
          cue.sprite.id === 'hand' &&
          cue.kind === 'tween' &&
          cue.target &&
          'scale' in cue.target
      )
      .sort((a, b) => a.start - b.start)
      .slice(0, PRESSES.length);
    this.pressAt = dips.map(
      (cue) => ((cue.start + cue.duration * CLICK_AT) / total) * run.duration
    );
    const next = dips.map((cue, i) => ({
      cue: PRESSES[i]!,
      style: htmlSafe(
        `left:${(((cue.start + cue.duration * CLICK_AT) / total) * 100).toFixed(3)}%`
      ),
    }));
    if (JSON.stringify(next) !== JSON.stringify(this.marks)) {
      this.marks = next;
    }
  }

  /**
   * Fire every press whose moment has gone by — as a real DOM click on the
   * real control, so the app's own handler is what changes the app. The
   * score knows which button; it does not know what the button does.
   */
  private dispatch(t: number) {
    while (this.fired < this.pressAt.length && this.pressAt[this.fired]! <= t) {
      const cue = PRESSES[this.fired]!;
      this.scripted = true;
      this.stage?.querySelector<HTMLElement>(`[data-cue="${cue}"]`)?.click();
      this.scripted = false;
      this.fired += 1;
    }
  }

  /**
   * Put the playhead at t: the app's state is re-folded from the presses
   * behind it rather than stepped, so scrubbing backwards is not a special
   * case — it is the same question asked with a smaller number.
   */
  private fold(t: number) {
    let state = INITIAL;
    let fired = 0;
    for (const [i, moment] of this.pressAt.entries()) {
      if (moment <= t) {
        state = press(state, PRESSES[i]!);
        fired = i + 1;
      }
    }
    this.state = state;
    this.fired = fired;
  }

  /* — transport controls — */

  /**
   * Play is never disabled, even when a real hand has taken the scene: the
   * score is recompiled by the mode swap, the new run is put back at t, and
   * whatever was clicked by hand is simply not in the folded answer.
   */
  toggle = () => {
    const run = this.scoreRun;
    if (this.mode === 'playing') {
      this.mode = 'scored';
      if (run === this.c?.run) {
        run?.pause();
      }
      return;
    }
    const fromLive = this.mode === 'live';
    const t = this.t >= this.runtime - 0.05 ? 0 : this.t;
    this.mode = 'playing';
    if (fromLive || !run || run !== this.c?.run) {
      // the template swaps back to the score; the next run adopts at t
      this.reseek = t;
      this.t = t;
      this.fold(t);
      return;
    }
    run.time = t;
    this.t = t;
    this.fold(t);
    run.play();
  };

  /** pointerdown claims the clock before the first input arrives */
  grab = () => {
    this.scrubbing = true;
    const wasLive = this.mode === 'live';
    this.mode = 'scored';
    if (!wasLive) {
      this.c?.run?.pause();
    }
  };

  release = () => {
    this.scrubbing = false;
  };

  scrub = (event: Event) => {
    const t = Number((event.target as HTMLInputElement).value);
    this.t = t;
    if (this.mode !== 'scored') {
      this.mode = 'scored';
    }
    const run = this.scoreRun;
    if (run && run === this.c?.run) {
      run.pause();
      run.time = t;
    } else {
      // mid-swap back from live: the next adopted run seeks here
      this.reseek = t;
    }
    this.fold(t);
    this.paint();
  };

  rewind = () => {
    this.mode = 'scored';
    this.t = 0;
    this.fold(0);
    const run = this.scoreRun;
    if (run && run === this.c?.run) {
      run.pause();
      run.time = 0;
    } else {
      this.reseek = 0;
    }
    this.paint();
  };

  /**
   * A real click on a real control. The score's own clicks come through
   * here too — they are DOM clicks on this very button — so the flag is
   * the only way to tell a scripted hand from a human one. A human one
   * swaps the score out for the app's own springs.
   */
  hit = (cue: string) => {
    if (!this.scripted && this.mode !== 'live') {
      this.mode = 'live';
      this.c?.run?.pause();
    }
    this.state = press(this.state, cue);
  };

  /* — readouts — */

  get isLive() {
    return this.mode === 'live';
  }

  get playing() {
    return this.mode === 'playing';
  }

  get bar() {
    return { scaleX: this.fill };
  }

  get head() {
    return { x: this.hp };
  }

  get total() {
    const cents =
      42 + (this.state.speed === 'express' ? 9 : 0) + (this.state.wrap ? 4 : 0);
    return `$${cents.toFixed(2)}`;
  }

  get onStandard() {
    return this.state.speed === 'standard';
  }

  get onExpress() {
    return this.state.speed === 'express';
  }

  get line() {
    const speed = this.state.speed === 'express' ? 'Express' : 'Standard';
    return this.state.wrap ? `${speed} · gift wrapped` : speed;
  }

  get note() {
    if (this.isLive) {
      return 'You have the controls — Play, Reset or the timeline takes it back.';
    }
    return this.playing
      ? 'Playing · the run animates · clicks dispatched'
      : 'Scored · a computed still at run.time · nothing is animating';
  }

  /* — the live targets: the app as a plain app — */

  get pillX() {
    return this.state.speed === 'express' ? SEG : 0;
  }
  get knobX() {
    return this.state.wrap ? KNOB : 0;
  }
  get litO() {
    return this.state.wrap ? 1 : 0;
  }
  get appO() {
    return this.state.placed ? 0.28 : 1;
  }
  get appS() {
    return this.state.placed ? 0.97 : 1;
  }
  get rcpO() {
    return this.state.placed ? 1 : 0;
  }
  get rcpS() {
    return this.state.placed ? 1 : 0.94;
  }
  get rcpY() {
    return this.state.placed ? 0 : 18;
  }

  <template>
    <Choreo
      class="ex ph-stage no-select"
      {{this.register}}
      {{on "selectstart" preventSelect}}
      as |c|
    >
      <div class="ph-app" {{motion id="app"}}>
        <header class="ph-head">
          <span class="ph-kicker">Order</span>
          <span class="ph-sum">{{this.total}}</span>
        </header>

        <p class="ph-legend">Delivery</p>
        {{! the sliding pill is a plain `x`, deliberately — layoutId would be
            the idiomatic reach and would put the one thing on this stage the
            playhead cannot seek right in the middle of it }}
        <div class="ph-seg">
          <span class="ph-pill" {{motion id="pill"}}></span>
          <button
            type="button"
            class={{if this.onStandard "ph-seg-btn is-on" "ph-seg-btn"}}
            data-cue="standard"
            {{on "click" (fn this.hit "standard")}}
          >Standard</button>
          <button
            type="button"
            class={{if this.onExpress "ph-seg-btn is-on" "ph-seg-btn"}}
            data-cue="express"
            {{on "click" (fn this.hit "express")}}
          >Express</button>
        </div>

        <button
          type="button"
          class="ph-row"
          data-cue="wrap"
          aria-pressed="{{this.state.wrap}}"
          {{on "click" (fn this.hit "wrap")}}
        >
          <span class="ph-row-copy">Gift wrap<small>+ $4</small></span>
          <span class="ph-switch">
            <span class="ph-lit" {{motion id="lit"}}></span>
            <span class="ph-knob" {{motion id="knob"}}></span>
          </span>
        </button>

        <button
          type="button"
          class="ph-go"
          data-cue="place"
          {{on "click" (fn this.hit "place")}}
        >Place order</button>
      </div>

      {{! always mounted, never a Presence: the score owns its opacity, and a
          scrubbed frame must be able to stand it anywhere in either
          direction }}
      <div
        class={{if this.state.placed "ph-receipt is-on" "ph-receipt"}}
        {{motion id="receipt"}}
      >
        {{! lucide "check" }}
        <svg class="ph-tick" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <b>Order placed</b>
        <small>{{this.line}}</small>
        <button
          type="button"
          class="ph-done"
          data-cue="done"
          {{on "click" (fn this.hit "done")}}
        >Done</button>
      </div>

      {{! the hand, and the ring a press leaves behind — participants, driven
          by the score's own cues; `data-take` is the parked opening }}
      <span
        class={{if this.isLive "ph-hand is-off" "ph-hand"}}
        data-take="{{this.take}}"
        {{motion id="hand"}}
        {{this.wire c}}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path
            d="M5 2.5 19 12.2l-6.1.7-2.4 6z"
          /></svg>
        <span class="ph-ring" {{motion id="ring"}}></span>
      </span>

      {{#if this.isLive}}
        {{! the score has stepped aside: the app is a plain app, its values
            springing to what its state says — same springs, same numbers }}
        <c.Parallel>
          <c.Spring @of={{standing "pill"}} @x={{this.pillX}} @spring={{PILL}} />
          <c.Spring
            @of={{standing "knob"}}
            @x={{this.knobX}}
            @spring={{KNOB_S}}
          />
          <c.Spring @of={{standing "lit"}} @opacity={{this.litO}} @spring={{LIT}} />
          <c.Spring
            @of={{standing "app"}}
            @opacity={{this.appO}}
            @scale={{this.appS}}
            @spring={{APP}}
          />
          <c.Spring
            @of={{standing "receipt"}}
            @opacity={{this.rcpO}}
            @scale={{this.rcpS}}
            @y={{this.rcpY}}
            @spring={{RECEIPT}}
          />
        </c.Parallel>
      {{else}}
        {{!-- The score, verbatim. Holds and walks in sequence flow; each
            press is a NAMED dip of the hand; the ring's pop and the app's
            own value changes hang off the press by name — `at 'press-x'
            0.55` is the moment the finger lands, and `dispatch` fires the
            real click at exactly that moment. Every value cue states both
            ends of its journey, so the run's first frame pins the whole
            scene to its opening state and a scrub is deterministic in
            either direction. --}}
        <c.Sequence>
          <c.Wait @of={{standing "hand"}} @duration={{0.34}} />
          <c.Tween
            @of={{standing "hand"}}
            @x={{this.walkX "home" "express"}}
            @y={{this.walkY "home" "express"}}
            @ease="easeInOut"
            @duration={{0.62}}
          />
          <c.Tween
            @name="press-express"
            @of={{standing "hand"}}
            @scale={{array 1 0.74 1}}
            @duration={{0.22}}
          />
          <c.Tween
            @at={{at "press-express" CLICK_AT}}
            @of={{standing "ring"}}
            @opacity={{array 0 0.8 0.4 0}}
            @scale={{array 0.4 1.9}}
            @ease="easeOut"
            @duration={{0.42}}
          />
          <c.Spring
            @at={{at "press-express" CLICK_AT}}
            @of={{standing "pill"}}
            @x={{array 0 SEG}}
            @spring={{PILL}}
          />

          <c.Wait @of={{standing "hand"}} @duration={{0.36}} />
          <c.Tween
            @of={{standing "hand"}}
            @x={{this.walkX "express" "wrap"}}
            @y={{this.walkY "express" "wrap"}}
            @ease="easeInOut"
            @duration={{0.52}}
          />
          <c.Tween
            @name="press-wrap"
            @of={{standing "hand"}}
            @scale={{array 1 0.74 1}}
            @duration={{0.22}}
          />
          <c.Tween
            @at={{at "press-wrap" CLICK_AT}}
            @of={{standing "ring"}}
            @opacity={{array 0 0.8 0.4 0}}
            @scale={{array 0.4 1.9}}
            @ease="easeOut"
            @duration={{0.42}}
          />
          <c.Spring
            @at={{at "press-wrap" CLICK_AT}}
            @of={{standing "knob"}}
            @x={{array 0 KNOB}}
            @spring={{KNOB_S}}
          />
          <c.Spring
            @at={{at "press-wrap" CLICK_AT}}
            @of={{standing "lit"}}
            @opacity={{array 0 1}}
            @spring={{LIT}}
          />

          <c.Wait @of={{standing "hand"}} @duration={{0.42}} />
          <c.Tween
            @of={{standing "hand"}}
            @x={{this.walkX "wrap" "place"}}
            @y={{this.walkY "wrap" "place"}}
            @ease="easeInOut"
            @duration={{0.6}}
          />
          <c.Tween
            @name="press-place"
            @of={{standing "hand"}}
            @scale={{array 1 0.74 1}}
            @duration={{0.24}}
          />
          <c.Tween
            @at={{at "press-place" CLICK_AT}}
            @of={{standing "ring"}}
            @opacity={{array 0 0.8 0.4 0}}
            @scale={{array 0.4 1.9}}
            @ease="easeOut"
            @duration={{0.42}}
          />
          <c.Spring
            @at={{at "press-place" CLICK_AT}}
            @of={{standing "app"}}
            @opacity={{array 1 0.28}}
            @scale={{array 1 0.97}}
            @spring={{APP}}
          />
          <c.Spring
            @at={{at "press-place" CLICK_AT}}
            @of={{standing "receipt"}}
            @opacity={{array 0 1}}
            @scale={{array 0.94 1}}
            @y={{array 18 0}}
            @spring={{RECEIPT}}
          />

          <c.Wait @of={{standing "hand"}} @duration={{0.9}} />
          <c.Tween
            @of={{standing "hand"}}
            @x={{this.walkX "place" "done"}}
            @y={{this.walkY "place" "done"}}
            @ease="easeInOut"
            @duration={{0.56}}
          />
          <c.Tween
            @name="press-done"
            @of={{standing "hand"}}
            @scale={{array 1 0.74 1}}
            @duration={{0.22}}
          />
          <c.Tween
            @at={{at "press-done" CLICK_AT}}
            @of={{standing "ring"}}
            @opacity={{array 0 0.8 0.4 0}}
            @scale={{array 0.4 1.9}}
            @ease="easeOut"
            @duration={{0.42}}
          />
          <c.Spring
            @at={{at "press-done" CLICK_AT}}
            @of={{standing "pill"}}
            @x={{array SEG 0}}
            @spring={{PILL}}
          />
          <c.Spring
            @at={{at "press-done" CLICK_AT}}
            @of={{standing "knob"}}
            @x={{array KNOB 0}}
            @spring={{KNOB_S}}
          />
          <c.Spring
            @at={{at "press-done" CLICK_AT}}
            @of={{standing "lit"}}
            @opacity={{array 1 0}}
            @spring={{LIT}}
          />
          <c.Spring
            @at={{at "press-done" CLICK_AT}}
            @of={{standing "app"}}
            @opacity={{array 0.28 1}}
            @scale={{array 0.97 1}}
            @spring={{APP}}
          />
          <c.Spring
            @at={{at "press-done" CLICK_AT}}
            @of={{standing "receipt"}}
            @opacity={{array 1 0}}
            @scale={{array 1 0.94}}
            @y={{array 0 18}}
            @spring={{RECEIPT}}
          />

          <c.Tween
            @of={{standing "hand"}}
            @x={{this.walkX "done" "home"}}
            @y={{this.walkY "done" "home"}}
            @ease="easeInOut"
            @duration={{0.48}}
          />
          <c.Wait @of={{standing "hand"}} @duration={{0.46}} />
        </c.Sequence>
      {{/if}}

      <div class={{if this.isLive "ph-transport is-off" "ph-transport"}}>
        {{! never disabled: play is the other way back }}
        <button
          type="button"
          class="ph-play"
          aria-label={{if this.playing "Pause" "Play"}}
          {{on "click" this.toggle}}
        >
          {{#if this.playing}}
            {{! lucide "pause" }}
            <svg class="tp-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="14" y="3" width="5" height="18" rx="1" />
              <rect x="5" y="3" width="5" height="18" rx="1" />
            </svg>
          {{else}}
            {{! lucide "play" }}
            <svg class="tp-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"
              />
            </svg>
          {{/if}}
        </button>

        <div class="ph-track">
          <span class="ph-rail"></span>
          <span class="ph-fill" {{motion style=this.bar}}></span>
          <span class="ph-thumb" {{motion style=this.head}}></span>
          {{#each this.marks key="cue" as |mark|}}
            <i class="ph-mark" style={{mark.style}}></i>
          {{/each}}
          {{! a real range input, transparent over the drawing — max and
              value are written by `paint`, never bound: a tracked binding
              would re-render at 60fps, and a programmatic write during a
              drag detaches WebKit's thumb tracking }}
          <input
            type="range"
            class="ph-range"
            min="0"
            max="0"
            step="0.01"
            value="0"
            aria-label="Playhead"
            {{on "pointerdown" this.grab}}
            {{on "pointerup" this.release}}
            {{on "pointercancel" this.release}}
            {{on "input" this.scrub}}
          />
        </div>

        <span class="ph-clock">0.00s</span>
        {{! the one control that stays true when a real hand has taken over —
            it is the handover back, so it says what it does }}
        <button
          type="button"
          class="ph-rewind"
          {{on "click" this.rewind}}
        >Reset</button>
      </div>

      <p class={{if this.isLive "ph-note is-live" "ph-note"}}>{{this.note}}</p>
    </Choreo>
  </template>
}
