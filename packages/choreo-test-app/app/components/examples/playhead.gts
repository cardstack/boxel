import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';
import { motionValue } from 'motion-dom';
import { preventSelect } from 'test-app/lib/pointer';
import {
  type Beat,
  compile,
  ghostAt,
  hitAt,
  moments,
  type Point,
  poseAt,
  type Poses,
  presses,
  type Spring,
  stateAt,
} from 'test-app/lib/score';

/* ── the app being driven ────────────────────────────────────────────────── */

interface State {
  placed: boolean;
  speed: 'express' | 'standard';
  wrap: boolean;
}

const INITIAL: State = { placed: false, speed: 'standard', wrap: false };

/**
 * What pressing a control does — written once, run by both readings of the
 * score. The buttons call it on click, and `moments()` folds it to work out
 * what the app IS at a scrubbed time. There is no second description of the
 * app's behaviour for the timeline to disagree with.
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
 * Every animated value in the scene, as a function of state.
 *
 * All numbers, and all of them plain value animations — no `layout`, no
 * `layoutId`, no `Presence`. That is not squeamishness, it is the boundary
 * this demo is here to draw: a value animation can be asked what it would be
 * at t, because a spring is a function of time. A projection animation cannot,
 * because what it is doing depends on two measurements of a live tree.
 */
function posesOf(state: State): Poses {
  return {
    app: { opacity: state.placed ? 0.28 : 1, scale: state.placed ? 0.97 : 1 },
    knob: { x: state.wrap ? KNOB : 0 },
    lit: { opacity: state.wrap ? 1 : 0 },
    pill: { x: state.speed === 'express' ? SEG : 0 },
    receipt: {
      opacity: state.placed ? 1 : 0,
      scale: state.placed ? 1 : 0.94,
      y: state.placed ? 0 : 18,
    },
  };
}

/**
 * One spring per element, handed to two places: `{{motion transition=…}}` when
 * it is playing, and the sampler when it is being scrubbed. Same numbers, so
 * the same curve either way.
 */
const SPRINGS: Record<string, Spring> = {
  app: { bounce: 0.1, visualDuration: 0.4 },
  knob: { bounce: 0.36, visualDuration: 0.3 },
  lit: { bounce: 0, visualDuration: 0.18 },
  pill: { bounce: 0.3, visualDuration: 0.36 },
  receipt: { bounce: 0.28, visualDuration: 0.48 },
};

/** the same specs as a Motion transition */
const TWEENS: Record<string, object> = Object.fromEntries(
  Object.entries(SPRINGS).map(([name, spec]) => [
    name,
    { type: 'spring', ...spec },
  ])
);

/**
 * A scrubbed frame is a still. Nothing may be in flight in it, because the
 * flight is what the sampler has already worked out — the element is told
 * where it is, and told to go there at once.
 */
const STILL = { duration: 0 } as const;

/* ── the score ───────────────────────────────────────────────────────────── */

/**
 * Beats, not timecodes. Nobody writes "the pointer is at 214,318 at 1;14" —
 * they write walk there, press it, wait. Absolute times fall out of `compile`,
 * and the coordinates fall out of measuring the cue when the question is asked.
 */
const BEATS: Beat[] = [
  { kind: 'hold', ms: 340 },
  { cue: 'express', kind: 'move', ms: 620 },
  { cue: 'express', kind: 'press', ms: 220 },
  { kind: 'hold', ms: 360 },
  { cue: 'wrap', kind: 'move', ms: 520 },
  { cue: 'wrap', kind: 'press', ms: 220 },
  { kind: 'hold', ms: 420 },
  { cue: 'place', kind: 'move', ms: 600 },
  { cue: 'place', kind: 'press', ms: 240 },
  { kind: 'hold', ms: 900 },
  { cue: 'done', kind: 'move', ms: 560 },
  { cue: 'done', kind: 'press', ms: 220 },
  // no cue: `ghostAt` reads a cue-less move as a return to `home`, so this is
  // the one beat in the score that is not walking TOWARD a control
  { kind: 'move', ms: 480 },
  { kind: 'hold', ms: 460 },
];

const { clips: CLIPS, duration: RUNTIME } = compile(BEATS);
const HITS = presses(CLIPS);
const MOMENTS = moments(CLIPS, INITIAL, press);

/** where each click lands on the scrub track — the score's own tick marks */
const MARKS = HITS.map((clip) => ({
  cue: clip.cue,
  style: htmlSafe(`left:${((hitAt(clip) / RUNTIME) * 100).toFixed(3)}%`),
}));

/* ── the demo ────────────────────────────────────────────────────────────── */

/**
 * A UI, a hand that clicks it, and a playhead you can drag.
 *
 * Three modes, and they differ in exactly one thing: who owns the clock.
 *
 *   playing   Motion owns it. The score fires a REAL `.click()` on the real
 *             control at each press, the app's own handler runs, and every
 *             `{{motion}}` element animates the way it always does — on the
 *             engine's clock, at the engine's pace. The playhead is a readout
 *             of how far through the score that has got.
 *   scored    The playhead owns it. Nothing animates; every value is sampled
 *             out of the score at t and jumped there. Dragging backwards is
 *             the same operation as dragging forwards, which is what makes it
 *             a scrub and not a replay.
 *   live      You own it. Touch a control yourself and the timeline steps
 *             aside — a playhead that fights a hand is a playhead that lies
 *             about what it is showing. Nothing on the transport is disabled
 *             while it is aside: play, reset and the scrubber all take the
 *             scene back, because all three recompute it rather than resume.
 *
 * The hand is sampled in ALL of them, playback included, because the hand is
 * the one thing here with a score. That asymmetry is the whole demo: the app
 * can only be played, the cursor can be played or seeked, and closing that gap
 * for the app is what a `valueAt(t)` on <Choreo> is for.
 */
export class Playhead extends Component {
  @tracked mode: 'live' | 'playing' | 'scored' = 'scored';
  @tracked state: State = INITIAL;
  /** the playhead, in ms */
  @tracked t = 0;

  /** the hand, and the ring a click leaves behind — sampled, never animated */
  private hx = motionValue(0);
  private hy = motionValue(0);
  private hs = motionValue(1);
  private rx = motionValue(0);
  private ry = motionValue(0);
  private rs = motionValue(0.4);
  private ro = motionValue(0);
  /** the scrub bar's fill and its head, for the same reason: no re-render per frame */
  private fill = motionValue(0);
  private hp = motionValue(0);

  private stage?: HTMLElement;
  private spots = new Map<string, Point>();
  /** the scrub track's width, so the head can be placed in px like everything else */
  private railW = 0;
  private watcher?: ResizeObserver;
  private viewport?: IntersectionObserver;
  /** the run in flight, and the frame it last ticked on */
  private raf = 0;
  private last = 0;
  /** how many presses have already been dispatched */
  private fired = 0;
  /** true while the score is clicking, so `hit` knows it is not a real hand */
  private scripted = false;

  duration = RUNTIME;
  marks = MARKS;

  willDestroy() {
    super.willDestroy();
    cancelAnimationFrame(this.raf);
    this.watcher?.disconnect();
    this.viewport?.disconnect();
  }

  /* — measuring — */

  register = modifier((el: HTMLElement) => {
    this.stage = el;
    this.watcher = new ResizeObserver(() => {
      this.spots.clear();
      this.measureRail();
      this.paint();
    });
    this.watcher.observe(el);
    // Twenty-six of these live in the gallery at once. A run belongs to the
    // stage it is on: scroll the card out of sight and the playhead stops
    // rather than quietly spending the browser's frames on a scene nobody is
    // watching. It keeps its position, so scrolling back and pressing play
    // carries on from there.
    this.viewport = new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting)) {
        this.halt();
      }
    });
    this.viewport.observe(el);
    this.measureRail();
    this.paint();
    return () => {
      this.watcher?.disconnect();
      this.viewport?.disconnect();
      this.watcher = undefined;
      this.viewport = undefined;
      this.stage = undefined;
    };
  });

  /**
   * A cue's centre, in stage coordinates — by offset, not by
   * `getBoundingClientRect`.
   *
   * The card is scaled while the receipt is up and the receipt itself flies in
   * on `y` and `scale`, so a measured rectangle would be wherever the animation
   * had got to. Layout offsets ignore transforms, so the hand aims at where the
   * control LIVES rather than at where it currently looks — which is also what
   * keeps the aim identical whether the frame was played or seeked.
   */
  private place = (cue: string): Point => {
    const known = this.spots.get(cue);
    if (known) {
      return known;
    }
    const root = this.stage;
    const el = root?.querySelector<HTMLElement>(`[data-cue="${cue}"]`);
    if (!root || !el) {
      return this.home;
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
  };

  private measureRail() {
    const rail = this.stage?.querySelector<HTMLElement>('.ph-track');
    this.railW = rail?.clientWidth ?? 0;
  }

  /**
   * Where the hand waits before the first beat, and where it goes home to.
   *
   * Close beside the card and above it, not out in a corner: the transport
   * lives along the BOTTOM of the stage the whole width of it, so any resting
   * spot low enough to feel "off to the side" also sits inside the transport's
   * own band and overlaps it. Up and to the right — near where the first beat
   * is headed anyway — clears the transport and reads as a hand waiting next
   * to the thing it is about to touch, rather than parked in dead space.
   */
  private get home(): Point {
    const el = this.stage;
    const w = el?.clientWidth ?? 320;
    const h = el?.clientHeight ?? 380;
    // Beside the CARD, not at a fraction of the stage.
    //
    // Fractions of the stage only look right at the stage's desktop
    // proportions. On a phone the stage is tall and narrow, and the same
    // 82%/40% put the hand halfway down open space with the card nowhere
    // near it — "returns to the middle of the board" rather than to where it
    // started. The card is the thing the hand is waiting to touch, so the
    // rest position is measured from the card: just off its right edge, a
    // third of the way down, clamped so it can never sit outside the stage.
    const card = this.stage?.querySelector<HTMLElement>('.ph-app');
    if (!card || !el) {
      return { x: w * 0.82, y: h * 0.4 };
    }
    const box = card.getBoundingClientRect();
    const root = el.getBoundingClientRect();
    const left = box.left - root.left;
    const top = box.top - root.top;
    return {
      x: Math.min(left + box.width + 34, w - 26),
      y: Math.max(top + box.height * 0.32, 26),
    };
  }

  /* — painting the hand — */

  /**
   * The hand at the current t, jumped rather than animated.
   *
   * `jump` and not `set`: a sampled value has no history, so it must not leave
   * a velocity behind for the next spring to inherit. This is the whole of
   * "sample, don't play" — the values exist, they are simply told where to be.
   */
  private paint = () => {
    const ghost = ghostAt(this.t, CLIPS, this.place, this.home);
    this.hx.jump(ghost.x);
    this.hy.jump(ghost.y);
    this.hs.jump(1 - 0.26 * ghost.down);
    this.rx.jump(ghost.ringX);
    this.ry.jump(ghost.ringY);
    this.rs.jump(0.35 + 1.5 * ghost.ring);
    this.ro.jump(ghost.ring >= 1 ? 0 : 0.85 * (1 - ghost.ring) ** 2);
    const progress = this.t / RUNTIME;
    this.fill.jump(progress);
    this.hp.jump(progress * this.railW);
  };

  get hand() {
    return { scale: this.hs, x: this.hx, y: this.hy };
  }

  get ripple() {
    return { opacity: this.ro, scale: this.rs, x: this.rx, y: this.ry };
  }

  get bar() {
    return { scaleX: this.fill };
  }

  get head() {
    return { x: this.hp };
  }

  /* — the two readings — */

  /** true when the playhead owns the frame: paused or mid-scrub */
  get scored() {
    return this.mode === 'scored';
  }

  get playing() {
    return this.mode === 'playing';
  }

  get isLive() {
    return this.mode === 'live';
  }

  /**
   * Sampled while the playhead owns the frame; the plain target otherwise.
   *
   * This is the one line where the two clocks meet. Everything else — the
   * markup, the springs, the reducer — is shared.
   */
  @cached
  get poses(): Poses {
    return this.scored
      ? poseAt(this.t, MOMENTS, posesOf, SPRINGS)
      : posesOf(this.state);
  }

  pose = (name: string) => this.poses[name] ?? {};

  tx = (name: string) => (this.scored ? STILL : TWEENS[name]);

  /* — transport — */

  /**
   * The playhead ticks on its own frame, and by a clamped delta.
   *
   * Two things had to be true, and the obvious spellings of both are wrong.
   *
   * NOT `t = now - startedAt`. Any gap — a background tab, a compositor over
   * budget, a gallery painting twenty-six demos — and the next frame teleports
   * the playhead to wherever the wall clock got to, which looks exactly like
   * the run never played. A delta clamped to one slow frame cannot teleport;
   * a late frame costs the score 50ms and no more.
   *
   * NOT `frame.update(…, true)`, Motion's own keepAlive step, tempting as it
   * is to share the engine's clock. A press in this score dispatches a real
   * DOM click, a click re-renders, and a re-render re-enters the frame loop —
   * and a render step that re-enters runs its keepAlive callbacks AGAIN with
   * the same frameData. On a quiet page that is rare enough not to show. In
   * the gallery it happened over a hundred times in a single frame, and the
   * whole six-second run went by before the browser painted once.
   *
   * The rule this leaves behind, for whatever drives a <Choreo> playhead
   * later: a score that causes work must tick OUTSIDE the loop that work runs
   * in. One tick per frame is a property of where the clock lives, not
   * something you can assert from inside it.
   */
  private advance = (now: number) => {
    const t = Math.min(this.t + Math.min(now - this.last, 50), RUNTIME);
    this.last = now;
    this.t = t;
    this.dispatch(t);
    this.paint();
    if (t >= RUNTIME) {
      this.halt();
      return;
    }
    this.raf = requestAnimationFrame(this.advance);
  };

  /**
   * Fire every press whose moment has gone by — as a real DOM click on the
   * real control, so the app's own handler is what changes the app. The score
   * knows which button; it does not know what the button does.
   */
  private dispatch(t: number) {
    while (this.fired < HITS.length && hitAt(HITS[this.fired]!) <= t) {
      const cue = HITS[this.fired]!.cue!;
      this.scripted = true;
      this.stage?.querySelector<HTMLElement>(`[data-cue="${cue}"]`)?.click();
      this.scripted = false;
      this.fired += 1;
    }
  }

  private halt() {
    if (this.mode === 'playing') {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.mode = 'scored';
    }
  }

  /**
   * Play is never disabled, even when a real hand has taken the scene.
   *
   * It does not need to be: seeking re-folds the state out of the score, so
   * pressing play undoes whatever was clicked by hand simply by asking the
   * score what should be true at t. The transport that cannot lie is the one
   * that recomputes rather than resumes.
   */
  toggle = () => {
    if (this.playing) {
      this.halt();
      return;
    }
    this.seek(this.t >= RUNTIME - 1 ? 0 : this.t);
    this.mode = 'playing';
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.advance);
  };

  /**
   * Put the playhead at t: the state is re-folded from the score rather than
   * stepped, so scrubbing backwards is not a special case. It is the same
   * question asked with a smaller number.
   */
  private seek(t: number) {
    this.t = t;
    this.state = stateAt(t, MOMENTS);
    this.fired = HITS.filter((clip) => hitAt(clip) <= t).length;
    this.paint();
  }

  /**
   * Touching the timeline is the third way back, and the same way back.
   *
   * Nothing is disabled while a real hand has the scene — not play, not the
   * scrubber. It does not need to be, because seeking does not RESUME, it
   * recomputes: the state at t is folded out of the score from zero, so
   * whatever was clicked by hand is simply not in the answer. A transport that
   * derives its scene can always be trusted; one that resumes from wherever it
   * was left could not.
   */
  scrub = (event: Event) => {
    this.halt();
    this.mode = 'scored';
    this.seek(Number((event.target as HTMLInputElement).value));
  };

  rewind = () => {
    this.halt();
    this.mode = 'scored';
    this.seek(0);
  };

  /**
   * A real click on a real control.
   *
   * The score's own clicks come through here too — they are DOM clicks on this
   * very button — so the flag is the only way to tell a scripted hand from a
   * human one. A human one takes the timeline out of the loop: it is showing a
   * position in a score that is no longer what happened.
   */
  hit = (cue: string) => {
    if (!this.scripted) {
      this.halt();
      this.mode = 'live';
    }
    this.state = press(this.state, cue);
  };

  /* — readouts — */

  get clock() {
    return `${(this.t / 1000).toFixed(2)}s`;
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
      ? 'Playing · the engine animates · clicks dispatched'
      : 'Scored · sampled at t · nothing is animating';
  }

  <template>
    <div
      class="ex ph-stage no-select"
      {{this.register}}
      {{on "selectstart" preventSelect}}
    >
      <div
        class="ph-app"
        {{motion animate=(this.pose "app") transition=(this.tx "app")}}
      >
        <header class="ph-head">
          <span class="ph-kicker">Order</span>
          <span class="ph-sum">{{this.total}}</span>
        </header>

        <p class="ph-legend">Delivery</p>
        {{! the sliding pill is a plain `x`, deliberately — layoutId would be
            the idiomatic reach and would put the one thing on this stage the
            playhead cannot seek right in the middle of it }}
        <div class="ph-seg">
          <span
            class="ph-pill"
            {{motion animate=(this.pose "pill") transition=(this.tx "pill")}}
          ></span>
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
            <span
              class="ph-lit"
              {{motion animate=(this.pose "lit") transition=(this.tx "lit")}}
            ></span>
            <span
              class="ph-knob"
              {{motion animate=(this.pose "knob") transition=(this.tx "knob")}}
            ></span>
          </span>
        </button>

        <button
          type="button"
          class="ph-go"
          data-cue="place"
          {{on "click" (fn this.hit "place")}}
        >Place order</button>
      </div>

      {{! always mounted, never a Presence: an exit animation is owned by the
          engine's clock and there is no honest way to sample one }}
      <div
        class={{if this.state.placed "ph-receipt is-on" "ph-receipt"}}
        {{motion animate=(this.pose "receipt") transition=(this.tx "receipt")}}
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

      {{! the hand: two elements, both bound to sampled values }}
      <span
        class={{if this.isLive "ph-ring is-off" "ph-ring"}}
        {{motion style=this.ripple}}
      ></span>
      <span
        class={{if this.isLive "ph-hand is-off" "ph-hand"}}
        {{motion style=this.hand}}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path
            d="M5 2.5 19 12.2l-6.1.7-2.4 6z"
          /></svg>
      </span>

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
          {{! a real range input, transparent over the drawing: keyboard scrub
              and a11y for free, and `disabled` is the whole handover }}
          <input
            type="range"
            class="ph-range"
            min="0"
            max={{this.duration}}
            step="1"
            value={{this.t}}
            aria-label="Playhead"
            {{on "input" this.scrub}}
          />
        </div>

        <span class="ph-clock">{{this.clock}}</span>
        {{! the one control that stays true when a real hand has taken over —
            it is the handover back, so it says what it does }}
        <button
          type="button"
          class="ph-rewind"
          {{on "click" this.rewind}}
        >Reset</button>
      </div>

      <p class={{if this.isLive "ph-note is-live" "ph-note"}}>{{this.note}}</p>
    </div>
  </template>
}
