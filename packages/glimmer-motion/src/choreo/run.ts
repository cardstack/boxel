/**
 * Play a cue list on the motion-dom engine — as a run you can hold (§4.6).
 *
 * The old executor fired timers and forgot; this one owns a master clock.
 * Cues start when the clock crosses them, a gate parks the clock until
 * `advance()` (§4.1), `time` is settable in either direction (a scrubbed
 * frame is a still), and `speed` scales the whole score. Ambient loops and
 * text deliveries ride the platform's own animations, so a busy probe never
 * mistakes an idle loop for motion.
 *
 * The clock runs in tempo-scaled milliseconds; the public face (`time`,
 * `duration`) speaks seconds at 1×, as Motion's playback controls do.
 */
import type { AnimationPlaybackControls, VisualElement } from 'motion-dom';
import {
  animateTarget,
  cancelFrame,
  frame,
  type FrameData,
  spring as springGenerator,
} from 'motion-dom';
import { easingDefinitionToFunction } from 'motion-utils';

import { motionSpeed, scaleTransition } from '../speed.ts';
import { cssEasing, deliver, keyframesOf, type Delivery } from './deliver.ts';
import type {
  ChoreoNode,
  Compiled,
  Cue,
  Easing,
  GateMark,
  PropValue,
  Sprite,
} from './types.ts';

/** how fast each value was moving, in units per second, keyed by element then property */
export type Velocities = Map<HTMLElement, Map<string, number>>;

export interface Run {
  /** open the gate the run is parked at; mid-segment, complete the segment and park (§4.1) */
  advance(): void;
  /** stop everything; removed sprites are released unless a next run is keeping them (`keep`) */
  cancel(keep?: Set<ChoreoNode>): void;
  cues: Cue[];
  /** the run's full length in seconds at 1×, gates included */
  readonly duration: number;
  finished: Promise<void>;
  /** nothing left to play: the run completed or was cancelled */
  isDone(): boolean;
  /** standing at a gate, waiting for advance() — a still, and settled */
  readonly parked: boolean;
  pause(): void;
  play(): void;
  /** put every element this run has touched back to its resting layout NOW */
  releaseForMeasure(): void;
  /** which gate-bounded segment the clock is in */
  readonly segment: number;
  /** playback rate: 1 is normal, 0.5 half, as Motion's controls */
  speed: number;
  /** the clock, in seconds at 1× — settable; setting it across a gate parks there */
  time: number;
  /** what every driven value was doing at the moment of interruption */
  velocities: Velocities;
}

interface RunOptions {
  inherit?: Velocities;
  onSpriteDone(sprite: Sprite): void;
  removed: Sprite[];
}

function isSpring(transition: Record<string, unknown> | undefined): boolean {
  if (!transition) {
    return false;
  }
  if (transition['type']) {
    return transition['type'] === 'spring';
  }
  return (
    'bounce' in transition ||
    'damping' in transition ||
    'stiffness' in transition ||
    'visualDuration' in transition
  );
}

function carryVelocity(
  transition: Record<string, unknown>,
  cue: Cue,
  inherit: Velocities | undefined,
): Record<string, unknown> {
  if (!inherit || !cue.target || !isSpring(transition)) {
    return transition;
  }
  const was =
    inherit.get(cue.sprite.element) ??
    (cue.sprite.counterpart && inherit.get(cue.sprite.counterpart.element));
  if (!was) {
    return transition;
  }
  let out = transition;
  for (const key in cue.target) {
    const velocity = was.get(key);
    if (velocity) {
      if (out === transition) {
        out = { ...transition };
      }
      out[key] = { ...transition, velocity };
    }
  }
  return out;
}

const dash = (key: string) =>
  key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

const noop = () => {};

const SIZES: Record<string, true> = { height: true, width: true };

interface HeldValue {
  had: boolean;
  key: string;
  prior: unknown;
  priorStyle: string;
}

function applyHold(
  ve: VisualElement,
  el: HTMLElement,
  values: Record<string, PropValue>,
): HeldValue[] {
  const held: HeldValue[] = [];
  for (const key in values) {
    const had = ve.hasValue(key);
    const prior = had ? ve.getValue(key)!.get() : undefined;
    const priorStyle = key.startsWith('--')
      ? el.style.getPropertyValue(key)
      : ((el.style as unknown as Record<string, string>)[key] ?? '');
    const mv = ve.getValue(key, values[key]!)!;
    mv.jump(values[key]!);
    held.push({ had, key, prior, priorStyle });
  }
  ve.scheduleRender();
  return held;
}

function releaseHold(ve: VisualElement, el: HTMLElement, held: HeldValue[]) {
  for (const { had, key, prior, priorStyle } of held) {
    if (had) {
      ve.getValue(key)?.jump(prior as PropValue);
    } else {
      ve.removeValue(key);
      if (priorStyle) {
        el.style.setProperty(dash(key), priorStyle);
      } else {
        el.style.removeProperty(dash(key));
      }
    }
  }
  ve.scheduleRender();
}

/** what one cue is doing right now */
interface Track {
  controls?: AnimationPlaybackControls[];
  cue: Cue;
  delivery?: Delivery;
  /** scaled window on the master clock */
  end: number;
  held?: HeldValue[];
  loopAnimation?: Animation;
  /** where each value stood when this track first started — the scrub-back frame */
  origin?: Record<string, PropValue>;
  /** completed while playing (finals landed / hold released) */
  passed: boolean;
  start: number;
  started: boolean;
}

export class ChoreoRun implements Run {
  cues: Cue[];
  velocities: Velocities = new Map();
  finished: Promise<void>;

  // deliberately untracked: the clock mutates inside render-adjacent
  // computations (the pass barrier, engine frames), where a tracked write
  // after a read is an error. Reactive mirrors can wrap this handle later.
  private master = 0;
  private playing = true;
  private parkedAt: (GateMark & { opened: boolean }) | null = null;
  private rate = 1;

  private readonly scale = motionSpeed();
  private readonly total: number;
  private readonly gates: (GateMark & { opened: boolean })[];
  private tracks: Track[] = [];
  private readonly rowEnd = new Map<Sprite, number>();
  private released = new Set<Sprite>();
  private pending: Set<Sprite>;
  private readonly options: RunOptions;
  private borrowedValues: {
    el: HTMLElement;
    key: string;
    ve: VisualElement;
  }[] = [];
  private movedValues: { key: string; ve: VisualElement }[] = [];
  private owned: { el: HTMLElement; key: string; ve: VisualElement }[] = [];
  private cancelled = false;
  private ended = false;
  private resolveFinished!: () => void;
  private ticking = false;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(compiled: Compiled, options: RunOptions) {
    this.options = options;
    this.cues = compiled.cues;
    this.pending = new Set(options.removed);
    const s = this.scale;
    this.gates = compiled.gates.map((g) => ({
      at: g.at * s,
      auto: g.auto === undefined ? undefined : g.auto * s,
      opened: false,
    }));
    let total = 0;
    for (const cue of this.cues) {
      const start = cue.start * s;
      const duration = cue.duration * s;
      this.tracks.push({
        cue,
        end: start + duration,
        passed: false,
        start,
        started: false,
      });
      if (!cue.loop) {
        total = Math.max(total, start + duration);
      }
      this.rowEnd.set(
        cue.sprite,
        Math.max(this.rowEnd.get(cue.sprite) ?? 0, start + duration),
      );
    }
    for (const g of this.gates) {
      total = Math.max(total, g.at);
    }
    // a counterpart lives at least as long as the sprite that replaced it
    for (const [sprite, end] of this.rowEnd) {
      if (sprite.counterpart) {
        this.rowEnd.set(
          sprite.counterpart,
          Math.max(this.rowEnd.get(sprite.counterpart) ?? 0, end),
        );
      }
    }
    this.total = total;
    this.finished = new Promise<void>((resolve) => {
      this.resolveFinished = resolve;
    });
    this.pinStarts();
    // everything at t=0 starts NOW, synchronously — holds land and first
    // keyframes pin before the browser paints the destination layout
    this.evaluate();
    this.startTicking();
  }

  /* ---- the public face, in seconds at 1× ---- */

  get duration(): number {
    return this.total / this.scale / 1000;
  }

  get time(): number {
    return this.master / this.scale / 1000;
  }

  set time(seconds: number) {
    this.seekTo(seconds * 1000 * this.scale);
  }

  get speed(): number {
    return this.rate;
  }

  set speed(rate: number) {
    this.rate = rate;
    for (const t of this.tracks) {
      t.controls?.forEach((c) => (c.speed = rate));
      if (t.delivery) {
        t.delivery.speed(rate);
      }
      if (t.loopAnimation) {
        t.loopAnimation.playbackRate = rate;
      }
    }
  }

  get segment(): number {
    let n = 0;
    for (const g of this.gates) {
      if (this.master > g.at || (this.master === g.at && g.opened)) {
        n++;
      }
    }
    return n;
  }

  get parked(): boolean {
    return this.parkedAt !== null;
  }

  isDone(): boolean {
    return this.ended || this.cancelled;
  }

  /* ---- transport ---- */

  pause() {
    if (!this.playing) {
      return;
    }
    this.playing = false;
    this.setPaused(true);
  }

  play() {
    if (this.playing || this.ended || this.cancelled) {
      return;
    }
    if (this.parkedAt) {
      return; // parked is a gate's business; advance() opens it
    }
    this.playing = true;
    this.setPaused(false);
    this.startTicking();
  }

  advance() {
    if (this.ended || this.cancelled) {
      return;
    }
    const gate = this.parkedAt;
    if (gate) {
      // open the gate and go
      gate.opened = true;
      this.parkedAt = null;
      clearTimeout(this.autoTimer);
      this.playing = true;
      this.setPaused(false);
      this.startTicking();
      return;
    }
    // mid-segment: complete it instantly and park at the gate (§4.1) —
    // Keynote's click-through. Past the last gate, complete the run.
    const next = this.gates.find((g) => !g.opened && g.at >= this.master);
    this.seekTo(next ? next.at : this.total);
    if (!next && this.master >= this.total) {
      this.finish();
    }
  }

  /* ---- the clock ---- */

  private startTicking() {
    if (this.ticking || !this.playing || this.cancelled || this.ended) {
      return;
    }
    this.ticking = true;
    frame.update(this.tick, true);
  }

  private stopTicking() {
    if (this.ticking) {
      this.ticking = false;
      cancelFrame(this.tick);
    }
  }

  private tick = (data: FrameData) => {
    if (!this.playing || this.cancelled || this.ended) {
      this.stopTicking();
      return;
    }
    const next = this.master + data.delta * this.rate;
    const gate = this.gates.find(
      (g) => !g.opened && g.at >= this.master && g.at <= next,
    );
    if (gate) {
      this.master = gate.at;
      // the boundary is exclusive: a cue starting AT the gate is the next
      // segment's first word, and must not begin while the run parks
      this.evaluate(gate.at);
      this.park(gate);
      return;
    }
    this.master = next;
    this.evaluate();
    // playing forward is the only clock that releases a leaver — a scrub is
    // a still and must stay reversible
    for (const [sprite, end] of this.rowEnd) {
      if (this.master >= end && !this.released.has(sprite)) {
        this.released.add(sprite);
        if (this.pending.delete(sprite)) {
          this.options.onSpriteDone(sprite);
        }
      }
    }
    if (this.master >= this.total) {
      this.finish();
    }
  };

  private park(gate: GateMark & { opened?: boolean }) {
    (gate as { opened: boolean }).opened = false;
    this.parkedAt = gate as GateMark & { opened: boolean };
    this.playing = false;
    this.stopTicking();
    // the engine's clock and this one drift by a frame: anything that ends
    // at or before the gate LANDS — a parked segment is complete, exactly
    // (§4.1's click-through rule, applied to the natural arrival too)
    for (const t of this.tracks) {
      if (t.started && !t.cue.loop && !t.cue.hold && t.end <= this.master) {
        this.completeTrack(t);
      }
    }
    this.setPaused(true);
    if (gate.auto !== undefined) {
      this.autoTimer = setTimeout(() => {
        if (this.parkedAt === gate && !this.cancelled) {
          this.advance();
        }
      }, gate.auto / this.rate);
    }
  }

  private finish() {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.stopTicking();
    // land every remaining final before handing the layout back; ambient
    // loops play on until the next pass cancels them
    for (const t of this.tracks) {
      if (t.started && !t.cue.loop && !t.cue.hold && !t.cue.delivery) {
        this.completeTrack(t);
      }
    }
    // the stylesheet owns the elements again between runs
    this.releaseForMeasure();
    for (const sprite of [...this.pending]) {
      this.pending.delete(sprite);
      this.options.onSpriteDone(sprite);
    }
    this.resolveFinished();
  }

  /* ---- cue lifecycle against the clock ---- */

  private setPaused(paused: boolean) {
    const now = this.master;
    for (const t of this.tracks) {
      if (!t.started) {
        continue;
      }
      // resume only what the clock is inside — an animation kept alive for
      // scrubbing must not play before its start or after its end
      const due = now >= t.start && (now < t.end || t.cue.loop);
      const run = !paused && due;
      t.controls?.forEach((c) => (run ? c.play() : c.pause()));
      if (t.delivery) {
        (run ? t.delivery.play : t.delivery.pause)();
      }
      if (t.loopAnimation) {
        if (run) {
          t.loopAnimation.play();
        } else {
          t.loopAnimation.pause();
        }
      }
    }
  }

  private seekTo(target: number) {
    // setting time across an unopened gate parks at the gate (§4.6)
    const gate = this.gates.find(
      (g) => !g.opened && g.at >= this.master && g.at <= target,
    );
    const clamped = Math.max(0, Math.min(gate ? gate.at : target, this.total));
    this.master = clamped;
    // seeking is a still: hold the transport
    const wasPlaying = this.playing;
    this.playing = false;
    this.setPaused(true);
    this.evaluate(gate ? gate.at : Infinity);
    if (gate) {
      this.park(gate);
      return;
    }
    if (wasPlaying && !this.ended) {
      this.playing = true;
      this.setPaused(false);
      this.startTicking();
    }
  }

  private evaluate(limit = Infinity) {
    const now = this.master;
    for (const t of this.tracks) {
      const { cue } = t;
      // a completed track scrubbed back into range plays again; its
      // animation was kept, so only the flag moves
      if (t.passed && now < t.end) {
        t.passed = false;
      }
      const fill = cue.hold?.fill ?? false;
      const inside =
        now >= t.start &&
        t.start < limit &&
        (now < t.end || cue.loop || fill);
      if (cue.hold) {
        if (inside && !t.started) {
          t.started = true;
          const ve = cue.sprite.node.visualElement;
          if (ve) {
            t.held = applyHold(ve, cue.sprite.element, cue.hold.values);
          }
        } else if (!inside && t.started) {
          t.started = false;
          const ve = cue.sprite.node.visualElement;
          if (ve && t.held) {
            releaseHold(ve, cue.sprite.element, t.held);
            t.held = undefined;
          }
        }
        continue;
      }
      if (cue.kind === 'wait') {
        continue;
      }
      if (inside && !t.started) {
        this.startTrack(t);
      } else if (
        inside &&
        t.started &&
        this.playing &&
        !t.controls &&
        !t.delivery &&
        !t.loopAnimation &&
        cue.target
      ) {
        // a scrub retired the animation; play re-enters the window, so a
        // fresh one carries on from wherever the scrub left the values
        this.startTrack(t);
      } else if (!inside && t.started && now < t.start) {
        // scrubbed back before its start: retire the animation and stand
        // the values back on their origin
        t.passed = false;
        t.started = false;
        t.controls?.forEach((c) => c.stop());
        t.controls = undefined;
        t.delivery?.cancel();
        t.delivery = undefined;
        t.loopAnimation?.cancel();
        t.loopAnimation = undefined;
        const ve = cue.sprite.node.visualElement;
        if (ve && t.origin) {
          for (const key in t.origin) {
            ve.getValue(key, t.origin[key]!)!.jump(t.origin[key]!);
          }
          ve.render();
        }
      } else if (t.started && now >= t.end && !cue.loop && !this.playing) {
        // scrubbed (or parked) past its end: hold the finals
        this.completeTrack(t);
      } else if (!t.started && now >= t.end && !cue.loop && !this.playing) {
        // never played and the clock is past it: land finals directly
        this.jumpFinals(t);
      }
      if (t.started && !this.playing && now >= t.start) {
        if (t.delivery) {
          t.delivery.pause();
          t.delivery.seek(now - t.start);
        } else if (t.loopAnimation) {
          t.loopAnimation.pause();
          const cycle = t.end - t.start;
          t.loopAnimation.currentTime = cycle ? (now - t.start) % cycle : 0;
        } else if (cue.target) {
          // a still frame is COMPUTED, not driven: the live animation (if
          // any) is retired and every value jumped to its sampled position —
          // deterministic, and immune to animation-lifecycle races
          t.controls?.forEach((c) => c.stop());
          t.controls = undefined;
          this.sampleStill(t, now);
        }
      }
    }
  }

  /** land a cue's end values without ever having played it */
  private jumpFinals(t: Track) {
    const { cue } = t;
    const ve = cue.sprite.node.visualElement;
    if (!ve || !cue.target) {
      return;
    }
    if (!t.origin) {
      // capture where things stood first, so a scrub back can undo this
      const origin: Record<string, PropValue> = {};
      for (const key in cue.target) {
        const value = cue.target[key];
        if (Array.isArray(value)) {
          origin[key] = value[0] as PropValue;
        } else {
          const held = ve.getValue(key)?.get();
          origin[key] =
            held !== undefined
              ? (held as PropValue)
              : getComputedStyle(cue.sprite.element).getPropertyValue(
                  dash(key),
                ) || 0;
        }
      }
      t.origin = origin;
    }
    t.passed = true;
    for (const key in cue.target) {
      const raw = cue.target[key];
      const end = Array.isArray(raw) ? raw[raw.length - 1] : raw;
      ve.getValue(key, end as PropValue)!.jump(end as PropValue);
    }
    ve.render();
  }

  private startTrack(t: Track) {
    const { cue } = t;
    const ve = cue.sprite.node.visualElement;
    if (!ve) {
      return;
    }
    t.started = true;
    t.passed = false;
    if (cue.target && !t.origin) {
      const origin: Record<string, PropValue> = {};
      for (const key in cue.target) {
        const value = cue.target[key];
        if (Array.isArray(value)) {
          origin[key] = value[0] as PropValue;
        } else {
          const held = ve.getValue(key)?.get();
          const latest = (
            ve.latestValues as Record<string, PropValue | undefined>
          )[key];
          origin[key] =
            held !== undefined
              ? (held as PropValue)
              : latest !== undefined
                ? latest
                : getComputedStyle(cue.sprite.element).getPropertyValue(
                    dash(key),
                  ) || 0;
        }
      }
      t.origin = origin;
    }
    if (cue.delivery) {
      t.delivery = deliver(cue, this.scale);
      if (!this.playing) {
        t.delivery.pause();
      }
      return;
    }
    if (cue.loop) {
      // an ambient loop rides the platform: the engine's probes stay quiet,
      // and its phase is the run clock's remainder (§4.5)
      const el = cue.sprite.element;
      const cycle = t.end - t.start;
      t.loopAnimation = el.animate(keyframesOf(cue.target ?? {}), {
        duration: Math.max(1, cycle),
        easing: cssEasing(
          (cue.transition as { ease?: Easing } | undefined)?.ease,
          cycle,
        ),
        iterations: Infinity,
      });
      t.loopAnimation.playbackRate = this.rate;
      if (!this.playing) {
        t.loopAnimation.pause();
      }
      return;
    }
    if (!cue.target) {
      return;
    }
    if (!this.playing) {
      // born inside a still: no animation at all — stop() before the async
      // keyframe resolution is dropped, and the resolver revives the
      // animation a frame later. A still is computed, never driven.
      this.sampleStill(t, this.master);
      return;
    }
    const transition = carryVelocity(
      scaleTransition({ ...cue.transition } as never, this.scale) as Record<
        string,
        unknown
      >,
      cue,
      this.options.inherit,
    );
    // Every run-driven value stays on the main-thread driver: an
    // accelerated (WAAPI) animation commits its finals asynchronously,
    // which lands AFTER a scrub's origin jump and overwrites it. A handle
    // that can seek needs values it can sample, and this is the switch
    // motion provides for exactly that.
    transition['onUpdate'] ??= noop;
    t.controls = animateTarget(ve, {
      ...cue.target,
      transition,
    } as never);
    for (const c of t.controls) {
      c.speed = this.rate;
    }
  }

  /** compute one still frame of a cue and jump the values onto the element */
  private sampleStill(t: Track, now: number) {
    const { cue } = t;
    const ve = cue.sprite.node.visualElement;
    if (!ve || !cue.target) {
      return;
    }
    const span = t.end - t.start;
    const p = span > 0 ? Math.min(1, Math.max(0, (now - t.start) / span)) : 1;
    const transition = cue.transition as
      | (Record<string, unknown> & { ease?: unknown; type?: string })
      | undefined;
    const sprung = isSpring(transition);
    const ease = sprung
      ? null
      : easingDefinitionToFunction(
          (transition?.ease as never) ?? 'easeInOut',
        );
    for (const key in cue.target) {
      const raw = cue.target[key];
      const frames: PropValue[] = Array.isArray(raw)
        ? (raw as PropValue[])
        : [t.origin?.[key] ?? 0, raw as PropValue];
      const numeric = frames.map((f) => parseFloat(String(f)));
      if (numeric.some((n) => Number.isNaN(n))) {
        // non-numeric values snap to the nearest keyframe
        const index = Math.min(
          frames.length - 1,
          Math.floor(p * frames.length),
        );
        ve.getValue(key, frames[index]!)!.jump(frames[index]!);
        continue;
      }
      let value: number;
      if (sprung) {
        const generator = springGenerator({
          keyframes: [numeric[0]!, numeric[numeric.length - 1]!],
          ...(transition ?? {}),
        } as never);
        value = generator.next(now - t.start).value;
      } else {
        const eased = ease ? ease(p) : p;
        const segments = numeric.length - 1;
        const at = Math.min(segments - 1e-9, eased * segments);
        const index = Math.max(0, Math.floor(at));
        const local = at - index;
        value =
          numeric[index]! + (numeric[index + 1]! - numeric[index]!) * local;
      }
      ve.getValue(key, value)!.jump(value);
    }
    ve.render();
  }

  private completeTrack(t: Track) {
    const { cue } = t;
    if (t.passed) {
      return;
    }
    t.passed = true;
    // the animation survives, parked on its last frame — a scrub back only
    // has to move its time
    // setting a paused animation's time to its duration finishes and resets
    // it — so a completed track is stopped outright and its finals jumped;
    // a scrub back re-creates it from the recorded origin
    t.started = false;
    t.controls?.forEach((c) => c.stop());
    t.controls = undefined;
    const ve = cue.sprite.node.visualElement;
    if (ve && cue.target) {
      for (const key in cue.target) {
        const raw = cue.target[key];
        const end = Array.isArray(raw) ? raw[raw.length - 1] : raw;
        ve.getValue(key, end as PropValue)!.jump(end as PropValue);
      }
      ve.render();
    }
  }

  /* ---- starting values, velocities, and giving the layout back ---- */

  private pinStarts() {
    const pinned = new Set<string>();
    const rendered = new Set<VisualElement>();
    for (const t of [...this.tracks].sort((a, b) => a.start - b.start)) {
      const cue = t.cue;
      const ve = cue.sprite.node.visualElement;
      if (!ve || !cue.target || cue.delivery || cue.loop) {
        continue;
      }
      for (const key in cue.target) {
        const value = cue.target[key];
        if (!Array.isArray(value) || value[0] === undefined) {
          continue;
        }
        const seen = `${cue.sprite.node.layoutKey}:${key}`;
        if (pinned.has(seen)) {
          continue;
        }
        pinned.add(seen);
        this.owned.push({ el: cue.sprite.element, key, ve });
        if (cue.kind === 'move') {
          if (key in SIZES) {
            if (!ve.hasValue(key)) {
              this.borrowedValues.push({ el: cue.sprite.element, key, ve });
            }
          } else {
            this.movedValues.push({ key, ve });
          }
        }
        ve.getValue(key, value[0] as PropValue)!.jump(value[0] as PropValue);
        rendered.add(ve);
      }
    }
    rendered.forEach((ve) => ve.render());
  }

  private sampleVelocities() {
    for (const { ve, el, key } of this.owned) {
      let byKey = this.velocities.get(el);
      if (byKey?.has(key)) {
        continue;
      }
      const velocity = ve.getValue(key)?.getVelocity();
      if (!velocity) {
        continue;
      }
      if (!byKey) {
        this.velocities.set(el, (byKey = new Map()));
      }
      byKey.set(key, velocity);
    }
  }

  releaseForMeasure() {
    this.sampleVelocities();
    const touched = new Set<VisualElement>();
    for (const { ve, el, key } of this.borrowedValues.splice(0)) {
      ve.removeValue(key);
      el.style.removeProperty(dash(key));
      touched.add(ve);
    }
    for (const { ve, key } of this.movedValues.splice(0)) {
      ve.getValue(key)?.jump(0);
      touched.add(ve);
    }
    touched.forEach((ve) => ve.render());
  }

  cancel(keep?: Set<ChoreoNode>) {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.stopTicking();
    clearTimeout(this.autoTimer);
    this.sampleVelocities();
    for (const t of this.tracks) {
      t.controls?.forEach((c) => c.stop());
      t.delivery?.cancel();
      t.loopAnimation?.cancel();
      const ve = t.cue.sprite.node.visualElement;
      if (t.held && ve) {
        releaseHold(ve, t.cue.sprite.element, t.held);
        t.held = undefined;
      }
    }
    this.releaseForMeasure();
    for (const sprite of [...this.pending]) {
      if (keep?.has(sprite.node)) {
        this.pending.delete(sprite);
      } else {
        this.pending.delete(sprite);
        this.options.onSpriteDone(sprite);
      }
    }
    this.resolveFinished();
  }
}

export function execute(compiled: Compiled, options: RunOptions): ChoreoRun {
  return new ChoreoRun(compiled, options);
}
