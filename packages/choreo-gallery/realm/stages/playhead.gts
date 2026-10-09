import type { ChoreoRun, Query, SpringSpec } from '@cardstack/choreo';
import { at, Choreo } from '@cardstack/choreo';
import { createChoreoPlayer } from '@cardstack/choreo-player';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, motionValue } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { observeStage } from '../lib/onstage';
import { preventSelect } from '../lib/pointer';
import { tuneSeconds, tuneSpring } from '../lib/tuning';
import PlayheadNotes from '../notes/playhead';

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
  /**
   * True once an EXTERNAL clock has actually asked for a frame — every
   * player entry point runs `prepare` first, so this is armed by the
   * recorder's own arrival and by nothing else.
   *
   * It has to be, because the player's job is to pause, seek and rate-limit
   * the runs it is handed, and that is precisely the transport this demo
   * already owns. Handed the live run during an ordinary visit, the two
   * share a clock and a scrub is answered by whichever wrote last.
   */
  private recording = false;
  private resolveScoreReady!: () => void;
  private scoreReady = new Promise<void>((resolve) => {
    this.resolveScoreReady = resolve;
  });
  @tracked private recordingRenderGeneration = 0;
  private recordingRenderWaiters = new Map<number, () => void>();

  private recordingPlayer = createChoreoPlayer({
    duration: 7,
    prepare: () => {
      this.recording = true;
      // HyperFrames starts each parallel capture worker on a fresh page. Make
      // the scored pass exist before that worker's first seek; otherwise its
      // first frames are the parked opening and appear as reset flashes.
      if (this.take === 0) {
        this.take++;
      }
      if (!this.scoreRun || this.scoreRun !== this.c?.run) {
        return this.scoreReady;
      }
      return undefined;
    },
    runs: () =>
      this.recording && this.scoreRun && this.scoreRun === this.c?.run
        ? [this.scoreRun]
        : [],
  });
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
  private viewport?: ReturnType<typeof observeStage>;
  private raf = 0;
  private clockEl?: HTMLElement | null;
  private rangeEl?: HTMLInputElement | null;

  /** Duration exposed to the external HyperFrames composition bridge. */
  get recordingDuration() {
    return this.recordingPlayer.duration;
  }

  /**
   * Deterministically reconstruct the demo and stand Choreo at one frame.
   * This is composition glue around the public run API, not a core hook.
   */
  async renderAt(time: number) {
    const t = Math.max(0, Math.min(time, this.recordingDuration));

    // A fresh capture worker arrives before Glimmer has necessarily compiled
    // the score. The player's async prepare barrier waits for observeRun to
    // publish it, so this seek cannot resolve against an empty run set.
    await this.recordingPlayer.renderAt(t, { settle: false });

    // adopt() now knows the score's press moments. Fold application state,
    // wait for Glimmer to paint that state, then reassert the sampled frame on
    // the DOM that will actually be captured.
    const rendered = this.waitForRecordingRender();
    this.scrub({ target: { value: String(t) } } as unknown as Event);
    await rendered;
    await this.recordingPlayer.renderAt(t, { settle: false });
    this.paint();
  }

  willDestroy() {
    super.willDestroy();
    this.resolveScoreReady();
    for (const resolve of this.recordingRenderWaiters.values()) {
      resolve();
    }
    this.recordingRenderWaiters.clear();
    cancelAnimationFrame(this.raf);
    this.watcher?.disconnect();
    this.viewport?.disconnect();
  }

  /* — wiring — */

  wire = modifier(
    (_el: Element, [c, generation]: [{ run: ChoreoRun | null }, number]) => {
      this.c = c;
      this.observeRun(c.run);
      for (const [pending, resolve] of this.recordingRenderWaiters) {
        if (pending <= generation) {
          this.recordingRenderWaiters.delete(pending);
          resolve();
        }
      }
    },
  );

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
    this.viewport = observeStage(
      el,
      (visible) => {
        if (visible) {
          this.raf ||= requestAnimationFrame(this.tick);
          if (this.mode === 'playing') {
            this.c?.run?.play();
          }
          if (this.seen === null && this.take === 0) {
            // the parked opening: the first pass compiles the score so the
            // transport has a run to hold — paused at 0, waiting for Play
            this.take++;
          }
        } else {
          cancelAnimationFrame(this.raf);
          this.raf = 0;
          if (this.mode === 'playing') {
            this.c?.run?.pause();
          }
        }
      },
      { threshold: 0.35 },
    );
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
    this.observeRun(run);
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

  private observeRun(run: ChoreoRun | null) {
    if (!run || run === this.seen) {
      return;
    }
    this.seen = run;
    if (this.mode !== 'live') {
      this.scoreRun = run;
      this.adopt(run);
      this.resolveScoreReady();
      // A HyperFrames worker can seek immediately after Glimmer publishes
      // the run, so a recording synchronises in this same modifier turn
      // rather than waiting for the demo's ticker to notice on a later
      // frame. ONLY while recording, though: sync() pauses every run it is
      // given and seeks it to the recorder's clock, which starts at zero —
      // done on every ordinary pass it silently reset the scene each time
      // a new run was adopted, and a scrub afterwards stood on nothing.
      if (this.recording) {
        void this.recordingPlayer.sync({ settle: false });
      }
    }
  }

  private waitForRecordingRender(): Promise<void> {
    const generation = ++this.recordingRenderGeneration;
    return new Promise((resolve) => {
      this.recordingRenderWaiters.set(generation, resolve);
    });
  }

  private paint() {
    const progress = this.runtime > 0 ? this.t / this.runtime : 0;
    this.fill.jump(progress);
    this.hp.jump(progress * this.railW);
    if (this.recording && this.stage) {
      // A parallel worker's first seek can set these MotionValues before the
      // freshly mounted modifiers subscribe to them. Repeating the same value
      // then emits no update, leaving only the transport drawing at its HTML
      // default for that one captured frame. The recorder owns a still, so
      // write that still explicitly after Glimmer's awaited render pass.
      if (this.railW <= 0) {
        this.measureRail();
      }
      const fill = this.stage.querySelector<HTMLElement>('.ph-fill');
      const thumb = this.stage.querySelector<HTMLElement>('.ph-thumb');
      if (fill) {
        fill.style.transform = `scaleX(${progress})`;
      }
      if (thumb) {
        thumb.style.transform = `translateX(${progress * this.railW}px)`;
      }
    }
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
      Math.max(0, run.duration - 0.01),
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
      ...run.cues.map((cue) => cue.start + cue.duration),
    );
    const dips = run.cues
      .filter(
        (cue) =>
          cue.sprite.id === 'hand' &&
          cue.kind === 'tween' &&
          cue.target &&
          'scale' in cue.target,
      )
      .sort((a, b) => a.start - b.start)
      .slice(0, PRESSES.length);
    this.pressAt = dips.map(
      (cue) => ((cue.start + cue.duration * CLICK_AT) / total) * run.duration,
    );
    const next = dips.map((cue, i) => ({
      cue: PRESSES[i]!,
      style: htmlSafe(
        `left:${(((cue.start + cue.duration * CLICK_AT) / total) * 100).toFixed(3)}%`,
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
      class='ex ph-stage no-select'
      {{this.register}}
      {{on 'selectstart' preventSelect}}
      as |c|
    >
      <div class='ph-app' {{motion id='app'}}>
        <header class='ph-head'>
          <span class='ph-kicker'>Order</span>
          <span class='ph-sum'>{{this.total}}</span>
        </header>

        <p class='ph-legend'>Delivery</p>
        {{! the sliding pill is a plain `x`, deliberately — layoutId would be
            the idiomatic reach and would put the one thing on this stage the
            playhead cannot seek right in the middle of it }}
        <div class='ph-seg'>
          <span class='ph-pill' {{motion id='pill'}}></span>
          <button
            type='button'
            class={{if this.onStandard 'ph-seg-btn is-on' 'ph-seg-btn'}}
            data-cue='standard'
            {{on 'click' (fn this.hit 'standard')}}
          >Standard</button>
          <button
            type='button'
            class={{if this.onExpress 'ph-seg-btn is-on' 'ph-seg-btn'}}
            data-cue='express'
            {{on 'click' (fn this.hit 'express')}}
          >Express</button>
        </div>

        <button
          type='button'
          class='ph-row'
          data-cue='wrap'
          aria-pressed='{{this.state.wrap}}'
          {{on 'click' (fn this.hit 'wrap')}}
        >
          <span class='ph-row-copy'>Gift wrap<small>+ $4</small></span>
          <span class='ph-switch'>
            <span class='ph-lit' {{motion id='lit'}}></span>
            <span class='ph-knob' {{motion id='knob'}}></span>
          </span>
        </button>

        <button
          type='button'
          class='ph-go'
          data-cue='place'
          {{on 'click' (fn this.hit 'place')}}
        >Place order</button>
      </div>

      {{! always mounted, never a Presence: the score owns its opacity, and a
          scrubbed frame must be able to stand it anywhere in either
          direction }}
      <div
        class={{if this.state.placed 'ph-receipt is-on' 'ph-receipt'}}
        {{motion id='receipt'}}
      >
        {{! lucide "check" }}
        <svg class='ph-tick' viewBox='0 0 24 24' aria-hidden='true'>
          <path d='M20 6 9 17l-5-5' />
        </svg>
        <b>Order placed</b>
        <small>{{this.line}}</small>
        <button
          type='button'
          class='ph-done'
          data-cue='done'
          {{on 'click' (fn this.hit 'done')}}
        >Done</button>
      </div>

      {{! the hand, and the ring a press leaves behind — participants, driven
          by the score's own cues; `data-take` is the parked opening }}
      <span
        class={{if this.isLive 'ph-hand is-off' 'ph-hand'}}
        data-take='{{this.take}}'
        {{motion id='hand'}}
        {{this.wire c this.recordingRenderGeneration}}
      >
        <svg viewBox='0 0 24 24' aria-hidden='true'><path
            d='M5 2.5 19 12.2l-6.1.7-2.4 6z'
          /></svg>
        <span class='ph-ring' {{motion id='ring'}}></span>
      </span>

      {{#if this.isLive}}
        {{! the score has stepped aside: the app is a plain app, its values
            springing to what its state says — same springs, same numbers }}
        <c.Parallel>
          <c.Spring
            @of={{standing 'pill'}}
            @x={{this.pillX}}
            @spring={{tuneSpring 'playhead' PILL 'PILL'}}
          />
          <c.Spring
            @of={{standing 'knob'}}
            @x={{this.knobX}}
            @spring={{tuneSpring 'playhead' KNOB_S 'KNOB_S'}}
          />
          <c.Spring
            @of={{standing 'lit'}}
            @opacity={{this.litO}}
            @spring={{tuneSpring 'playhead' LIT 'LIT'}}
          />
          <c.Spring
            @of={{standing 'app'}}
            @opacity={{this.appO}}
            @scale={{this.appS}}
            @spring={{tuneSpring 'playhead' APP 'APP'}}
          />
          <c.Spring
            @of={{standing 'receipt'}}
            @opacity={{this.rcpO}}
            @scale={{this.rcpS}}
            @y={{this.rcpY}}
            @spring={{tuneSpring 'playhead' RECEIPT 'RECEIPT'}}
          />
        </c.Parallel>
      {{else}}
        {{! The score, verbatim. Holds and walks in sequence flow; each
            press is a NAMED dip of the hand; the ring's pop and the app's
            own value changes hang off the press by name — `at 'press-x'
            0.55` is the moment the finger lands, and `dispatch` fires the
            real click at exactly that moment. Every value cue states both
            ends of its journey, so the run's first frame pins the whole
            scene to its opening state and a scrub is deterministic in
            either direction. }}
        <c.Sequence>
          <c.Wait
            @of={{standing 'hand'}}
            @duration={{tuneSeconds 'playhead' 0.34 'Step 1 duration'}}
          />
          <c.Tween
            @of={{standing 'hand'}}
            @x={{this.walkX 'home' 'express'}}
            @y={{this.walkY 'home' 'express'}}
            @ease='easeInOut'
            @duration={{tuneSeconds 'playhead' 0.62 'Step 2 duration'}}
          />
          <c.Tween
            @name='press-express'
            @of={{standing 'hand'}}
            @scale={{array 1 0.74 1}}
            @duration={{tuneSeconds 'playhead' 0.22 'Step 3 duration'}}
          />
          <c.Tween
            @at={{at 'press-express' CLICK_AT}}
            @of={{standing 'ring'}}
            @opacity={{array 0 0.8 0.4 0}}
            @scale={{array 0.4 1.9}}
            @ease='easeOut'
            @duration={{tuneSeconds 'playhead' 0.42 'Step 4 duration'}}
          />
          <c.Spring
            @at={{at 'press-express' CLICK_AT}}
            @of={{standing 'pill'}}
            @x={{array 0 SEG}}
            @spring={{tuneSpring 'playhead' PILL 'PILL'}}
          />

          <c.Wait
            @of={{standing 'hand'}}
            @duration={{tuneSeconds 'playhead' 0.36 'Step 5 duration'}}
          />
          <c.Tween
            @of={{standing 'hand'}}
            @x={{this.walkX 'express' 'wrap'}}
            @y={{this.walkY 'express' 'wrap'}}
            @ease='easeInOut'
            @duration={{tuneSeconds 'playhead' 0.52 'Step 6 duration'}}
          />
          <c.Tween
            @name='press-wrap'
            @of={{standing 'hand'}}
            @scale={{array 1 0.74 1}}
            @duration={{tuneSeconds 'playhead' 0.22 'Step 7 duration'}}
          />
          <c.Tween
            @at={{at 'press-wrap' CLICK_AT}}
            @of={{standing 'ring'}}
            @opacity={{array 0 0.8 0.4 0}}
            @scale={{array 0.4 1.9}}
            @ease='easeOut'
            @duration={{tuneSeconds 'playhead' 0.42 'Step 8 duration'}}
          />
          <c.Spring
            @at={{at 'press-wrap' CLICK_AT}}
            @of={{standing 'knob'}}
            @x={{array 0 KNOB}}
            @spring={{tuneSpring 'playhead' KNOB_S 'KNOB_S'}}
          />
          <c.Spring
            @at={{at 'press-wrap' CLICK_AT}}
            @of={{standing 'lit'}}
            @opacity={{array 0 1}}
            @spring={{tuneSpring 'playhead' LIT 'LIT'}}
          />

          <c.Wait
            @of={{standing 'hand'}}
            @duration={{tuneSeconds 'playhead' 0.42 'Step 9 duration'}}
          />
          <c.Tween
            @of={{standing 'hand'}}
            @x={{this.walkX 'wrap' 'place'}}
            @y={{this.walkY 'wrap' 'place'}}
            @ease='easeInOut'
            @duration={{tuneSeconds 'playhead' 0.6 'Step 10 duration'}}
          />
          <c.Tween
            @name='press-place'
            @of={{standing 'hand'}}
            @scale={{array 1 0.74 1}}
            @duration={{tuneSeconds 'playhead' 0.24 'Step 11 duration'}}
          />
          <c.Tween
            @at={{at 'press-place' CLICK_AT}}
            @of={{standing 'ring'}}
            @opacity={{array 0 0.8 0.4 0}}
            @scale={{array 0.4 1.9}}
            @ease='easeOut'
            @duration={{tuneSeconds 'playhead' 0.42 'Step 12 duration'}}
          />
          <c.Spring
            @at={{at 'press-place' CLICK_AT}}
            @of={{standing 'app'}}
            @opacity={{array 1 0.28}}
            @scale={{array 1 0.97}}
            @spring={{tuneSpring 'playhead' APP 'APP'}}
          />
          <c.Spring
            @at={{at 'press-place' CLICK_AT}}
            @of={{standing 'receipt'}}
            @opacity={{array 0 1}}
            @scale={{array 0.94 1}}
            @y={{array 18 0}}
            @spring={{tuneSpring 'playhead' RECEIPT 'RECEIPT'}}
          />

          <c.Wait
            @of={{standing 'hand'}}
            @duration={{tuneSeconds 'playhead' 0.9 'Step 13 duration'}}
          />
          <c.Tween
            @of={{standing 'hand'}}
            @x={{this.walkX 'place' 'done'}}
            @y={{this.walkY 'place' 'done'}}
            @ease='easeInOut'
            @duration={{tuneSeconds 'playhead' 0.56 'Step 14 duration'}}
          />
          <c.Tween
            @name='press-done'
            @of={{standing 'hand'}}
            @scale={{array 1 0.74 1}}
            @duration={{tuneSeconds 'playhead' 0.22 'Step 15 duration'}}
          />
          <c.Tween
            @at={{at 'press-done' CLICK_AT}}
            @of={{standing 'ring'}}
            @opacity={{array 0 0.8 0.4 0}}
            @scale={{array 0.4 1.9}}
            @ease='easeOut'
            @duration={{tuneSeconds 'playhead' 0.42 'Step 16 duration'}}
          />
          <c.Spring
            @at={{at 'press-done' CLICK_AT}}
            @of={{standing 'pill'}}
            @x={{array SEG 0}}
            @spring={{tuneSpring 'playhead' PILL 'PILL'}}
          />
          <c.Spring
            @at={{at 'press-done' CLICK_AT}}
            @of={{standing 'knob'}}
            @x={{array KNOB 0}}
            @spring={{tuneSpring 'playhead' KNOB_S 'KNOB_S'}}
          />
          <c.Spring
            @at={{at 'press-done' CLICK_AT}}
            @of={{standing 'lit'}}
            @opacity={{array 1 0}}
            @spring={{tuneSpring 'playhead' LIT 'LIT'}}
          />
          <c.Spring
            @at={{at 'press-done' CLICK_AT}}
            @of={{standing 'app'}}
            @opacity={{array 0.28 1}}
            @scale={{array 0.97 1}}
            @spring={{tuneSpring 'playhead' APP 'APP'}}
          />
          <c.Spring
            @at={{at 'press-done' CLICK_AT}}
            @of={{standing 'receipt'}}
            @opacity={{array 1 0}}
            @scale={{array 1 0.94}}
            @y={{array 0 18}}
            @spring={{tuneSpring 'playhead' RECEIPT 'RECEIPT'}}
          />

          <c.Tween
            @of={{standing 'hand'}}
            @x={{this.walkX 'done' 'home'}}
            @y={{this.walkY 'done' 'home'}}
            @ease='easeInOut'
            @duration={{tuneSeconds 'playhead' 0.48 'Step 17 duration'}}
          />
          <c.Wait
            @of={{standing 'hand'}}
            @duration={{tuneSeconds 'playhead' 0.46 'Step 18 duration'}}
          />
        </c.Sequence>
      {{/if}}

      <div class={{if this.isLive 'ph-transport is-off' 'ph-transport'}}>
        {{! never disabled: play is the other way back }}
        <button
          type='button'
          class='ph-play'
          aria-label={{if this.playing 'Pause' 'Play'}}
          {{on 'click' this.toggle}}
        >
          {{#if this.playing}}
            {{! lucide "pause" }}
            <svg class='tp-icon' viewBox='0 0 24 24' aria-hidden='true'>
              <rect x='14' y='3' width='5' height='18' rx='1' />
              <rect x='5' y='3' width='5' height='18' rx='1' />
            </svg>
          {{else}}
            {{! lucide "play" }}
            <svg class='tp-icon' viewBox='0 0 24 24' aria-hidden='true'>
              <path
                d='M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'
              />
            </svg>
          {{/if}}
        </button>

        <div class='ph-track'>
          <span class='ph-rail'></span>
          <span class='ph-fill' {{motion style=this.bar}}></span>
          <span class='ph-thumb' {{motion style=this.head}}></span>
          {{#each this.marks key='cue' as |mark|}}
            <i class='ph-mark' style={{mark.style}}></i>
          {{/each}}
          {{! a real range input, transparent over the drawing — max and
              value are written by `paint`, never bound: a tracked binding
              would re-render at 60fps, and a programmatic write during a
              drag detaches WebKit's thumb tracking }}
          <input
            type='range'
            class='ph-range'
            min='0'
            max='0'
            step='0.01'
            value='0'
            aria-label='Playhead'
            {{on 'pointerdown' this.grab}}
            {{on 'pointerup' this.release}}
            {{on 'pointercancel' this.release}}
            {{on 'input' this.scrub}}
          />
        </div>

        <span class='ph-clock'>0.00s</span>
        {{! the one control that stays true when a real hand has taken over —
            it is the handover back, so it says what it does }}
        <button
          type='button'
          class='ph-rewind'
          {{on 'click' this.rewind}}
        >Reset</button>
      </div>

      <p class={{if this.isLive 'ph-note is-live' 'ph-note'}}>{{this.note}}</p>
    </Choreo>
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

      .no-select,
      .no-select * {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }

      /* Playhead — a scripted hand, and a timeline you can drag ------------------ */

      .ph-stage {
        /* the transport and its note live at the bottom of the stage, so the app
           centres in what is left rather than under them */
        padding-bottom: 76px;
        cursor: default;
      }

      /* one cell, two children: the receipt sits exactly over the card without
         either of them owning a transform the way absolute centring would */
      .ph-app,
      .ph-receipt {
        grid-area: 1 / 1;
      }

      .ph-app {
        width: 288px;
        max-width: 100%;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: linear-gradient(
          180deg,
          var(--ph-card-top),
          var(--ph-card-bot)
        );
        box-shadow: 0 18px 44px
          rgba(var(--shadow-rgb), calc(0.45 * var(--shadow-a)));
      }

      .ph-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--line);
      }

      .ph-kicker {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .ph-sum {
        font-family: var(--font-display);
        font-size: 20px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--ink);
      }

      .ph-legend {
        margin: 12px 0 6px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .ph-seg {
        position: relative;
        display: flex;
        width: 260px;
        max-width: 100%;
        padding: 3px;
        border: 1px solid var(--line);
        border-radius: 10px;
        /* a recessed groove relative to .ph-app's own surface, not a neutral
           black veil — black-over-a-light-card reads as flat grey once .ph-app
           turns light, so this reaches for the warm well tone directly */
        background: var(--ph-groove);
      }

      /* the pill travels on x — 127px, the width of one half. A fixed number
         because the sampler needs one: `valueAt` is arithmetic, not measurement. */
      .ph-pill {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 127px;
        height: 30px;
        border-radius: 8px;
        background: linear-gradient(180deg, var(--ember-hot), var(--ember));
        box-shadow: 0 4px 14px rgba(255, 59, 31, 0.35);
      }

      .ph-seg-btn {
        position: relative;
        flex: 1 1 0;
        height: 30px;
        border: 0;
        border-radius: 8px;
        background: none;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        color: var(--ink-dim);
        cursor: pointer;
        transition: color 0.18s var(--ease);
      }

      .ph-seg-btn.is-on {
        color: #fff;
      }

      .ph-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        margin-top: 12px;
        padding: 10px 10px 10px 12px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--ph-row);
        font: inherit;
        color: var(--ink);
        text-align: left;
        cursor: pointer;
      }

      .ph-row-copy {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 13px;
      }

      .ph-row-copy small {
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--ink-faint);
      }

      .ph-switch {
        position: relative;
        flex: none;
        width: 44px;
        height: 24px;
        padding: 3px;
        border-radius: 12px;
        background: rgba(var(--ink-rgb), 0.1);
      }

      /* the "on" colour is its own element rather than a class, because a class is
         a step and the playhead wants a number it can be halfway through */
      .ph-lit {
        position: absolute;
        inset: 0;
        border-radius: 12px;
        background: linear-gradient(180deg, var(--ember-hot), var(--ember));
        /* dark until the score (or a live hand) lights it — the wrap starts off,
           and the rest pose must not depend on the run's frame-0 pin landing
           (same rule as .ph-receipt above) */
        opacity: 0;
      }

      .ph-knob {
        position: relative;
        display: block;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 6px
          rgba(var(--shadow-rgb), calc(0.45 * var(--shadow-a)));
      }

      .ph-go {
        width: 100%;
        height: 40px;
        margin-top: 12px;
        border: 1px solid var(--line-strong);
        border-radius: 10px;
        background: linear-gradient(180deg, var(--ph-go-top), var(--ph-go-bot));
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: var(--ink);
        cursor: pointer;
      }

      .ph-receipt {
        z-index: 3;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        width: 232px;
        max-width: 100%;
        padding: 20px 18px 16px;
        border: 1px solid var(--line-strong);
        border-radius: 16px;
        background: linear-gradient(
          180deg,
          var(--ph-receipt-top),
          var(--ph-receipt-bot)
        );
        box-shadow: 0 24px 60px
          rgba(var(--shadow-rgb), calc(0.6 * var(--shadow-a)));
        text-align: center;
        /* invisible until the score places the order, and not in the way until then
           — but still measurable, which is how the hand knows where Done is.
           The stylesheet states the rest pose itself (like .ph-ring): the score's
           frame-0 pin writes the same inline `opacity: 0`, but on a slow first
           load that pin can lose the race to the parked pause — and a receipt
           hidden only by the pin would sit white over the card until the first
           interaction forced an evaluation */
        opacity: 0;
        pointer-events: none;
      }

      .ph-receipt.is-on {
        pointer-events: auto;
      }

      .ph-tick {
        display: grid;
        place-items: center;
        box-sizing: border-box;
        width: 32px;
        height: 32px;
        /* the disc is the element; the padding is what keeps the tick inside it */
        padding: 8px;
        border-radius: 50%;
        background: rgba(255, 59, 31, 0.16);
        color: var(--ember-hot);
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      /* Transport glyphs, drawn rather than typed.
         ▶ and ❚❚ are characters, and a character is at the mercy of whatever font
         resolves it — on iOS they picked up the emoji face and rendered as colour
         emoji next to a monospace clock. These are Lucide (lucide.dev, ISC), taken
         as published, which is also why they are stroked and not filled. */
      .tp-icon {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .ph-receipt b {
        font-family: var(--font-display);
        font-size: 15px;
        font-weight: 700;
      }

      .ph-receipt small {
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--ink-faint);
      }

      .ph-done {
        width: 100%;
        height: 32px;
        margin-top: 8px;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        background: none;
        font: inherit;
        font-size: 12px;
        color: var(--ink-dim);
        cursor: pointer;
      }

      /* the hand ---------------------------------------------------------------- */

      .ph-hand {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 6;
        /* the arrow's tip, not its box, is what sits on the cue — and the press
           scales about that same point so the tip does not slide while it clicks */
        margin: -2px 0 0 -4px;
        transform-origin: 5px 3px;
        pointer-events: none;
        transition: opacity 0.24s var(--ease);
      }

      .ph-hand svg {
        display: block;
        width: 22px;
        height: 22px;
        fill: #fff;
        stroke: rgba(0, 0, 0, 0.5);
        stroke-width: 1.2;
        filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.6));
      }

      /* the ring rides INSIDE the hand now — one transform source, so the pop
         happens wherever the hand is without a second set of position cues. It
         centres on the arrow's hotspot and rests invisible: the score's own
         keyframes are the only thing that ever lights it. */
      .ph-ring {
        position: absolute;
        top: 3px;
        left: 5px;
        z-index: -1;
        width: 38px;
        height: 38px;
        margin: -19px 0 0 -19px;
        border: 2px solid var(--ember-hot);
        border-radius: 50%;
        opacity: 0;
        pointer-events: none;
      }

      .ph-hand.is-off {
        opacity: 0;
      }

      /* the transport ----------------------------------------------------------- */

      .ph-transport {
        position: absolute;
        right: 16px;
        bottom: 34px;
        left: 16px;
        z-index: 7;
        display: flex;
        align-items: center;
        /* .ph-thumb rests at the track's own left edge, and its glow ring reaches
           back out ~8.5px past that — against a 10px gap, the ring and the play
           button were nearly touching at rest. */
        gap: 18px;
      }

      .ph-play,
      .ph-rewind {
        display: grid;
        flex: none;
        place-items: center;
        height: 28px;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        background: var(--ph-btn);
        font: inherit;
        font-size: 11px;
        color: var(--ink);
        cursor: pointer;
        transition:
          opacity 0.2s var(--ease),
          border-color 0.2s var(--ease),
          color 0.2s var(--ease);
      }

      .ph-play {
        width: 28px;
      }

      .ph-rewind {
        display: inline-flex;
        align-items: center;
        padding: 0 12px;
        font-family: var(--font-mono);
        font-size: 10px;
        line-height: 1;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      .ph-play:disabled {
        cursor: default;
      }

      .ph-track {
        position: relative;
        flex: 1 1 auto;
        height: 20px;
      }

      .ph-rail,
      .ph-fill {
        position: absolute;
        top: 50%;
        left: 0;
        width: 100%;
        height: 3px;
        margin-top: -1.5px;
        border-radius: 2px;
      }

      .ph-rail {
        background: var(--line-strong);
      }

      .ph-fill {
        /* scaleX from a motion value, so the bar is repainted without a render */
        transform-origin: left center;
        background: linear-gradient(90deg, var(--ember), var(--copper));
      }

      .ph-mark {
        position: absolute;
        top: 50%;
        z-index: 1;
        width: 2px;
        height: 10px;
        border-radius: 1px;
        background: var(--ink-faint);
        transform: translate(-1px, -50%);
      }

      .ph-thumb {
        position: absolute;
        top: 50%;
        left: 0;
        z-index: 2;
        width: 11px;
        height: 11px;
        margin: -5.5px 0 0 -5.5px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 0 0 3px rgba(255, 59, 31, 0.28);
      }

      /* the real control, invisible over the drawing */
      .ph-range {
        /* A horizontal slider and a vertical scroll want the same gesture, and on a
           touch screen the scroller wins by default: the drag panned the page and
           the playhead never moved, so the timeline read as broken rather than as
           scrubbable. `none` hands the gesture to the control, which is the only
           thing on this row that a sideways drag could plausibly mean. */
        touch-action: none;

        position: absolute;
        inset: 0;
        z-index: 3;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        opacity: 0;
        cursor: ew-resize;
        -webkit-appearance: none;
        appearance: none;
        background: none;
      }

      .ph-range:disabled {
        cursor: default;
      }

      .ph-clock {
        flex: none;
        min-width: 44px;
        font-family: var(--font-mono);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        text-align: right;
        color: var(--ink-dim);
      }

      /* live: the timeline is showing a position in a score that is no longer what
         happened, so it reads as stale — not as disabled. Every control on it still
         works, and using any of them is what makes it true again. */
      .ph-transport.is-off .ph-track,
      .ph-transport.is-off .ph-clock {
        opacity: 0.5;
      }

      .ph-transport.is-off .ph-rewind {
        border-color: var(--ember);
        color: var(--ember-hot);
      }

      .ph-note {
        position: absolute;
        right: 16px;
        bottom: 14px;
        left: 16px;
        margin: 0;
        z-index: 7;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.04em;
        color: var(--ink-faint);
        text-align: center;
      }

      .ph-note.is-live {
        color: var(--copper-ink);
      }
    </style>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSpring('playhead', PILL, 'PILL');
tuneSpring('playhead', KNOB_S, 'KNOB_S');
tuneSpring('playhead', LIT, 'LIT');
tuneSpring('playhead', APP, 'APP');
tuneSpring('playhead', RECEIPT, 'RECEIPT');
tuneSeconds('playhead', 0.34, 'Step 1 duration');
tuneSeconds('playhead', 0.62, 'Step 2 duration');
tuneSeconds('playhead', 0.22, 'Step 3 duration');
tuneSeconds('playhead', 0.42, 'Step 4 duration');
tuneSeconds('playhead', 0.36, 'Step 5 duration');
tuneSeconds('playhead', 0.52, 'Step 6 duration');
tuneSeconds('playhead', 0.22, 'Step 7 duration');
tuneSeconds('playhead', 0.42, 'Step 8 duration');
tuneSeconds('playhead', 0.42, 'Step 9 duration');
tuneSeconds('playhead', 0.6, 'Step 10 duration');
tuneSeconds('playhead', 0.24, 'Step 11 duration');
tuneSeconds('playhead', 0.42, 'Step 12 duration');
tuneSeconds('playhead', 0.9, 'Step 13 duration');
tuneSeconds('playhead', 0.56, 'Step 14 duration');
tuneSeconds('playhead', 0.22, 'Step 15 duration');
tuneSeconds('playhead', 0.42, 'Step 16 duration');
tuneSeconds('playhead', 0.48, 'Step 17 duration');
tuneSeconds('playhead', 0.46, 'Step 18 duration');

export class PlayheadDemo extends GalleryDemo {
  static stage = Playhead;
  static notes = PlayheadNotes;
}
