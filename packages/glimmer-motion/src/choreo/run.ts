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
  flushKeyframeResolvers,
  frame,
  type FrameData,
  generateLinearEasing,
  spring as springGenerator,
} from 'motion-dom';
import { easingDefinitionToFunction } from 'motion-utils';

import { motionSpeed, scaleTransition } from '../speed.ts';
import { cssEasing, deliver, type Delivery, keyframesOf } from './deliver.ts';
import type {
  CameraState,
  ChoreoNode,
  Compiled,
  Cue,
  Easing,
  GateMark,
  PropValue,
  Rect,
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
  /** a pass measured and decided to keep this run: put the picture back */
  reassert(): void;
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
  /** where the region's frame stands as this run begins */
  camera?: CameraState;
  /** the aim point the prior run left applied — see ChoreoRun.cameraAim */
  cameraAim?: { x: number; y: number } | null;
  /** the element the camera transform drives (the region's scene wrapper) */
  cameraFrame?: HTMLElement;
  inherit?: Velocities;
  /** a camera step landed or the run ended: the frame's new resting state */
  onCamera?(state: CameraState): void;
  onSpriteDone(sprite: Sprite): void;
  /** the region's elevated layer, where c.Raise promotes the living */
  raisedLayer?: HTMLElement;
  removed: Sprite[];
  /** the svg the tethers draw into */
  tetherLayer?: SVGSVGElement;
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

/**
 * A platform Animation in the controls shape the transport speaks, so
 * setPaused / speed / stopTrack drive it exactly like an engine animation.
 */
function platformControls(animation: Animation): AnimationPlaybackControls {
  return {
    cancel: () => animation.cancel(),
    pause: () => animation.pause(),
    play: () => animation.play(),
    get speed() {
      return animation.playbackRate;
    },
    set speed(rate: number) {
      animation.playbackRate = rate;
    },
    get state() {
      return animation.playState;
    },
    stop: () => animation.cancel(),
    get time() {
      return ((animation.currentTime as number) ?? 0) / 1000;
    },
    set time(seconds: number) {
      animation.currentTime = seconds * 1000;
    },
  } as unknown as AnimationPlaybackControls;
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
  /** camera: the aim point in force when this step began */
  aimFrom?: { x: number; y: number };
  /** camera: this step's own aim point, frozen at its start */
  aimTo?: { x: number; y: number };
  /** camera: the platform animation flying the region's frame (§6.3) */
  cameraAnimation?: Animation;
  /** camera: where the frame stood when this step began */
  cameraFrom?: CameraState;
  /** camera: eased progress of the live step, for the aim-term lerp */
  cameraP?: number;
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
  /** raise: how to put the element back where it was */
  perch?: {
    placeholder: HTMLElement;
    prior: string;
  };
  /** flight: the platform animations this track owns — cancelled before any measure */
  platform?: Animation[];
  /** scroll: the container being driven, and where it is headed */
  scrolling?: {
    cancelListener(): void;
    container: HTMLElement;
    from: { left: number; top: number };
    to: { left: number; top: number };
  };
  start: number;
  started: boolean;
  /** tether: the wire this step draws */
  wire?: SVGPathElement;
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
    /** what the style ATTRIBUTE already said, restored on release — an
     *  inline declaration removeProperty cannot resurrect */
    prior: string;
    ve: VisualElement;
  }[] = [];
  /** rest is what releaseForMeasure jumps to: 0 for translates, 1 for scales, 'none' for clips */
  private movedValues: {
    key: string;
    rest?: PropValue;
    ve: VisualElement;
  }[] = [];
  /** what the last releaseForMeasure retired, so a kept pass can put it back */
  private retired: {
    borrowed: {
      el: HTMLElement;
      key: string;
      prior: string;
      value: unknown;
      ve: VisualElement;
    }[];
    moved: {
      key: string;
      rest?: PropValue;
      value: unknown;
      ve: VisualElement;
    }[];
  } = { borrowed: [], moved: [] };
  private owned: { el: HTMLElement; key: string; ve: VisualElement }[] = [];
  private cancelled = false;
  private ended = false;
  private resolveFinished!: () => void;
  private ticking = false;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(compiled: Compiled, options: RunOptions) {
    this.options = options;
    this.camera = options.camera ?? { x: 0, y: 0, zoom: 1 };
    this.cameraAim = options.cameraAim ?? null;
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
    activeRuns.add(this);
    void this.finished.then(() => activeRuns.delete(this));
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
      if (t.cameraAnimation) {
        t.cameraAnimation.playbackRate = rate;
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
    this.scheduleRestill();
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
    this.scheduleRestill();
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
    this.options.onCamera?.({ ...this.camera });
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
      // Touch only live animations. An accelerated animation that FINISHED
      // has already committed its finals and been cancelled — and the WAAPI
      // pause procedure RESURRECTS a cancelled animation, parked at zero
      // with fill:both, its FIRST keyframe overriding the committed finals.
      // That is how the Playhead's receipt reappeared at the park: pausing
      // the run paused its long-finished [1→0] spring, which came back as
      // a standing opacity 1. play() on a finished control is the same
      // hazard in the other direction: it restarts the spring from zero.
      t.controls?.forEach((c) => {
        if (run) {
          if (c.state === 'running' || c.state === 'paused') {
            c.play();
          }
        } else if (c.state === 'running') {
          c.pause();
        }
      });
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
      if (t.cameraAnimation) {
        if (run) {
          t.cameraAnimation.play();
        } else {
          t.cameraAnimation.pause();
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
      return;
    }
    this.scheduleRestill();
  }

  /**
   * The one cost WAAPI acceleration charges a scrubbable run: a finished
   * accelerated animation commits its finals asynchronously, and that
   * commit can land AFTER a still's jump and overwrite it. So a still is
   * re-asserted on the two frames after it is entered — by then any
   * pending commit has landed, and the computed frame wins again.
   */
  private restillPending = 0;

  private scheduleRestill() {
    if (this.restillPending > 0) {
      return;
    }
    this.restillPending = 2;
    const pass = () => {
      if (this.playing || this.cancelled) {
        this.restillPending = 0;
        return;
      }
      this.restill();
      this.restillPending -= 1;
      if (this.restillPending > 0) {
        frame.postRender(pass);
      }
    };
    frame.postRender(pass);
  }

  private restill() {
    const now = this.master;
    const rewinds: Track[] = [];
    for (const t of this.tracks) {
      const { cue } = t;
      const ve = cue.sprite.node.visualElement;
      if (!ve || cue.camera || cue.tether) {
        continue;
      }
      if (!t.started && t.origin && now < t.start) {
        // scrubbed back before its start: stand the origin up again —
        // deferred and ordered with the others (see rewind())
        rewinds.push(t);
      } else if (
        t.started &&
        !t.controls &&
        !t.delivery &&
        !t.loopAnimation &&
        (cue.target || cue.flight) &&
        now >= t.start &&
        now < t.end
      ) {
        this.sampleStill(t, now);
      }
    }
    this.rewind(rewinds, now);
  }

  private evaluate(limit = Infinity) {
    const now = this.master;
    const rewinds: Track[] = [];
    for (const t of this.tracks) {
      const { cue } = t;
      // a completed track scrubbed back into range plays again; its
      // animation was kept, so only the flag moves
      if (t.passed && now < t.end) {
        t.passed = false;
        if (now < t.start && t.origin) {
          // completed, and the jump cleared its start entirely: its
          // committed finals must not stand — restored with the others
          rewinds.push(t);
        }
      }
      const fill = cue.hold?.fill ?? false;
      const inside =
        now >= t.start && t.start < limit && (now < t.end || cue.loop || fill);
      if (cue.camera) {
        if (inside && !t.started) {
          t.started = true;
          t.cameraFrom = { ...this.camera };
          // Transform-origin is pinned at 0 0, so aiming at P is the
          // translate (1−z)·P and the frame's centre cancels out of the
          // model entirely. The aim point is frozen per cue and lerped
          // from the point in force — a re-aim is smooth by construction,
          // and z = 1 is the identity frame for any aim.
          //
          // A cue with NO origin of its own holds the aim in force rather
          // than recentring: zooming back out of a dive must back straight
          // out of the tile it dived on — an aim lerping toward the centre
          // mid-flight reads as sliding onto the NEIGHBOURING tile first.
          const aimTo = cue.camera.origin ??
            this.cameraAim ??
            cue.camera.centre ?? { x: 0, y: 0 };
          t.aimFrom = this.cameraAim ?? aimTo;
          t.aimTo = aimTo;
          this.cameraAim = aimTo;
        } else if (!inside && t.started && now < t.start) {
          t.started = false;
          t.cameraAnimation?.cancel();
          t.cameraAnimation = undefined;
          if (t.cameraFrom) {
            this.camera = { ...t.cameraFrom };
            this.cameraAim = t.aimFrom ?? null;
            t.cameraP = 0;
            this.applyCamera(t);
          }
        }
        if (t.started && (now < t.end || !t.passed)) {
          // the SHADOW state: interpolated every evaluate regardless of who
          // draws, so interruption, onCamera and the next run always have a
          // current value to read without decomposing a matrix. Past the
          // end, progress is EXACTLY 1 — a spring sampled at its end time is
          // 0.99998 of the way there, and a camera that lands beside its
          // target instead of on it re-arms every subsequent pass: the
          // landing renders, the replay chases the miss, and the equality
          // guard downstream never sees the same state twice.
          const p = now >= t.end ? 1 : this.cameraProgress(t, now - t.start);
          const from = t.cameraFrom!;
          const to = cue.camera.to;
          t.cameraP = p;
          this.camera = {
            x: from.x + ((to.x ?? from.x) - from.x) * p,
            y: from.y + ((to.y ?? from.y) - from.y) * p,
            zoom: from.zoom + ((to.zoom ?? from.zoom) - from.zoom) * p,
          };
          // the platform draws the frame while playing (§6.3 on WAAPI): the
          // whole scene composites off the main thread. Stills stay inline.
          if (this.playing && now < t.end) {
            if (!t.cameraAnimation) {
              this.startCameraAnimation(t, now);
            } else if (t.cameraAnimation.playState === 'paused') {
              t.cameraAnimation.play();
            }
          } else if (t.cameraAnimation) {
            if (now >= t.end) {
              // landing: the animation ends and the inline style takes over
              this.dropCameraAnimation(t);
            } else {
              t.cameraAnimation.pause();
              t.cameraAnimation.currentTime = Math.max(0, now - t.start);
            }
          }
          this.applyCamera(t);
          if (now >= t.end && this.playing && !t.passed) {
            t.passed = true;
            this.options.onCamera?.({ ...this.camera });
          }
        }
        continue;
      }
      if (cue.tether) {
        if (inside && !t.started) {
          t.started = true;
          const layer = this.options.tetherLayer;
          if (layer) {
            t.wire = document.createElementNS(
              'http://www.w3.org/2000/svg',
              'path',
            );
            t.wire.setAttribute('data-choreo-tether', '');
            if (t.cue.tether?.name) {
              t.wire.setAttribute('data-thread', t.cue.tether.name);
            }
            layer.appendChild(t.wire);
          }
        } else if (!inside && t.started) {
          t.started = false;
          t.wire?.remove();
          t.wire = undefined;
        }
        if (t.started && t.wire) {
          // after the engine's own render this frame, so the wire sits
          // inside the boxes as they are painted, not as they were
          this.scheduleTetherDraw();
        }
        continue;
      }
      if (cue.derive) {
        if (inside && !t.started) {
          t.started = true;
          // the keys this cue drives are registered as MOVED, with the
          // rest the author declared: releaseForMeasure then jumps them
          // back before a measurement, and reassert() puts them again —
          // the same contract every flight already lives under
          const ve = cue.sprite.node.visualElement;
          if (ve) {
            for (const [key, rest] of Object.entries(cue.derive.rest)) {
              this.movedValues.push({ key, rest, ve });
            }
          }
        } else if (!inside && t.started) {
          t.started = false;
          this.restDerived(t);
        }
        if (t.started) {
          this.drive(t, now);
        }
        continue;
      }
      if (cue.raise) {
        if (inside && !t.started) {
          t.started = true;
          this.promote(t);
        } else if (!inside && t.started) {
          t.started = false;
          this.restore(t);
        }
        continue;
      }
      if (cue.scroll) {
        if (inside && !t.started) {
          t.started = true;
          this.startScroll(t);
        } else if (!inside && t.started && now < t.start) {
          t.started = false;
          this.stopScroll(t, true);
        }
        if (t.started && t.scrolling) {
          // clock-driven in every mode: a scroll has no engine animation
          const p = this.flightlessProgress(t, now - t.start);
          const { container, from, to } = t.scrolling;
          container.scrollTop = from.top + (to.top - from.top) * p;
          container.scrollLeft = from.left + (to.left - from.left) * p;
          if (p >= 1 && this.playing) {
            this.stopScroll(t, false);
          }
        }
        continue;
      }
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
        (cue.target || cue.flight)
      ) {
        // a scrub retired the animation; play re-enters the window, so a
        // fresh one carries on from wherever the scrub left the values
        this.startTrack(t);
      } else if (!inside && t.started && now < t.start) {
        // scrubbed back before its start: retire the animation; the
        // origin is restored with the other rewinds AFTER the sweep, in
        // an order that leaves the right one standing (see rewind())
        t.passed = false;
        t.started = false;
        flushKeyframeResolvers();
        this.stopTrack(t);
        t.delivery?.cancel();
        t.delivery = undefined;
        t.loopAnimation?.cancel();
        t.loopAnimation = undefined;
        if (t.origin) {
          rewinds.push(t);
        }
      } else if (t.started && now >= t.end && !cue.loop && !this.playing) {
        // scrubbed (or parked) past its end: hold the finals
        this.completeTrack(t);
      } else if (!t.started && !t.passed && now >= t.end && !cue.loop) {
        // Never played and the clock is past it: land finals directly.
        // NOT gated on a paused clock — while playing, a coarse tick (a
        // throttled tab, a long main-thread stall) can jump clean over a
        // track's whole window, and a track that never starts never lands:
        // its seeded first keyframe (an arrival's opacity 0) would stand
        // forever.
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
        } else if (cue.target || cue.flight) {
          // a still frame is COMPUTED, not driven: the live animation (if
          // any) is retired and every value jumped to its sampled position —
          // deterministic, and immune to animation-lifecycle races
          if (t.controls) {
            flushKeyframeResolvers();
            this.stopTrack(t);
          }
          this.sampleStill(t, now);
        }
      }
    }
    this.rewind(rewinds, now);
  }

  /**
   * Stand rewound tracks back on their origins — the part of a backward
   * seek that must be ORDERED. A sprite with sequential cues has one
   * origin per cue, each equal to the previous cue's landing; restored
   * in track order they clobber forward and the sprite ends up standing
   * on its LAST future cue's origin (the Playhead demo's hand parked on
   * 'place' after a scrub to zero; its receipt refusing to dismiss). So:
   * latest-first, which leaves the EARLIEST future cue's origin — the
   * value the timeline actually holds at `now` — standing; and a key
   * that any track AT or BEFORE `now` writes is not touched at all,
   * because that track's own sample or landing is the answer.
   */
  private rewind(rewinds: Track[], now: number) {
    rewinds.sort((a, b) => b.start - a.start);
    for (const t of rewinds) {
      const ve = t.cue.sprite.node.visualElement;
      if (!ve || !t.origin) {
        continue;
      }
      let wrote = false;
      for (const key in t.origin) {
        const owned = this.tracks.some(
          (s) =>
            s !== t &&
            s.start <= now &&
            s.cue.target !== undefined &&
            key in s.cue.target &&
            s.cue.sprite.node.visualElement === ve,
        );
        if (!owned) {
          ve.getValue(key, t.origin[key]!)!.jump(t.origin[key]!);
          wrote = true;
        }
      }
      if (wrote) {
        ve.render();
      }
    }
  }

  /** the eased progress of a plain clock-driven track */
  private flightlessProgress(t: Track, ms: number): number {
    const span = t.end - t.start;
    const raw = span > 0 ? Math.min(1, Math.max(0, ms / span)) : 1;
    return easingDefinitionToFunction('easeInOut')(raw);
  }

  /* ---- c.Camera: the region's frame (§6.3) ---- */

  camera: CameraState;
  /**
   * The aim point P in force, local px. With transform-origin pinned at
   * 0 0, the applied transform is translate(x + (1−z)·P) scale(z) — the
   * frame's centre cancels out of the algebra entirely, so neither a
   * board that reflows mid-cue nor a stage that changes height between
   * cues can move the picture: the formula reads no live DOM at all.
   * z = 1 is the identity for any P. Public because it is hand-off state:
   * the next run lerps from the point THIS run left aimed, exactly as it
   * inherits the camera.
   */
  cameraAim: { x: number; y: number } | null = null;

  private cameraProgress(t: Track, ms: number): number {
    const span = t.end - t.start;
    const raw = span > 0 ? Math.min(1, Math.max(0, ms / span)) : 1;
    const transition = t.cue.transition as
      (Record<string, unknown> & { ease?: unknown }) | undefined;
    if (isSpring(transition)) {
      const generator = springGenerator({
        keyframes: [0, 100],
        ...(transition ?? {}),
      } as never);
      return generator.next(ms / this.scale).value / 100;
    }
    return easingDefinitionToFunction(
      (transition?.ease as never) ?? 'easeInOut',
    )(raw);
  }

  /**
   * The damped counter-scale (§6.4): steady sprites scale with the host but
   * not 1:1 — pow(z, .30) zoomed out so they stay readable, pow(z, .70)
   * zoomed in so they don't feel stuck, clamped to what the eye tolerates.
   */
  private static damped(zoom: number): number {
    const target = Math.min(
      1.8,
      Math.max(0.85, Math.pow(zoom, zoom < 1 ? 0.3 : 0.7)),
    );
    return target / zoom;
  }

  /**
   * The frame's APPLIED transform for a camera state at aim progress `p`.
   *
   * Transform-origin is pinned at 0 0, so the applied transform is
   * translate(x + (1−z)·P) scale(z) with P the lerped aim point — pure
   * arithmetic over frozen numbers. Nothing here reads the DOM, so a board
   * that reflows mid-cue cannot move the camera, and every boundary
   * (landing, re-aim, next run) agrees to the pixel. At z = 1 the aim term
   * vanishes: an unpanned camera is EXACTLY the identity.
   */
  private appliedCamera(
    t: Track,
    state: CameraState,
    p: number,
  ): { x: number; y: number; zoom: number } {
    const from = t.aimFrom ?? t.aimTo ?? { x: 0, y: 0 };
    const to = t.aimTo ?? from;
    const aim = {
      x: from.x + (to.x - from.x) * p,
      y: from.y + (to.y - from.y) * p,
    };
    return {
      x: state.x + (1 - state.zoom) * aim.x,
      y: state.y + (1 - state.zoom) * aim.y,
      zoom: state.zoom,
    };
  }

  private static cameraCss(a: { x: number; y: number; zoom: number }): string {
    return a.zoom === 1 && a.x === 0 && a.y === 0
      ? ''
      : `translate(${a.x}px, ${a.y}px) scale(${a.zoom})`;
  }

  /**
   * Fly the region's frame on the platform: two transform keyframes and the
   * eased clock pre-sampled into a linear() easing. The biggest layer in the
   * region composites off the main thread for the whole move.
   */
  private startCameraAnimation(t: Track, now: number) {
    const host = this.options.cameraFrame;
    const from = t.cameraFrom;
    const to = t.cue.camera?.to;
    if (!host || !from || !to) {
      return;
    }
    const final: CameraState = {
      x: to.x ?? from.x,
      y: to.y ?? from.y,
      zoom: to.zoom ?? from.zoom,
    };
    const span = Math.max(1, t.end - t.start);
    const anim = host.animate(
      [
        {
          transform:
            ChoreoRun.cameraCss(this.appliedCamera(t, from, 0)) || 'none',
        },
        {
          transform:
            ChoreoRun.cameraCss(this.appliedCamera(t, final, 1)) || 'none',
        },
      ],
      {
        duration: span,
        easing: generateLinearEasing(
          (p: number) => this.cameraProgress(t, p * span),
          span,
        ),
        fill: 'both',
      },
    );
    anim.playbackRate = this.rate;
    anim.currentTime = Math.max(0, now - t.start);
    t.cameraAnimation = anim;
  }

  /**
   * Retire the frame's platform animation and hand the picture back to
   * inline style, written from the shadow state — so a cancel mid-zoom
   * freezes exactly where the eye was, and a landing holds its final.
   */
  private dropCameraAnimation(t: Track) {
    if (!t.cameraAnimation) {
      return;
    }
    t.cameraAnimation.cancel();
    t.cameraAnimation = undefined;
    this.applyCamera(t);
  }

  private applyCamera(t: Track) {
    const frame = this.options.cameraFrame;
    if (!frame) {
      return;
    }
    const { zoom } = this.camera;
    // the origin is PINNED at 0 0 — a percentage origin is a live DOM
    // quantity, and a stage that changes height would move the picture
    frame.style.transformOrigin = '0px 0px';
    // the frame is the author's own region element: at identity, leave no
    // trace — a resting transform would quietly become a containing block.
    // While a platform animation owns the frame, the inline write is
    // skipped: the animation overrides it anyway, and the stale value would
    // flash when the animation is cancelled.
    if (!t.cameraAnimation) {
      frame.style.transform = ChoreoRun.cameraCss(
        this.appliedCamera(t, this.camera, t.cameraP ?? 1),
      );
    }
    for (const sprite of t.cue.camera?.steady ?? []) {
      const ve = sprite.node.visualElement;
      if (ve) {
        const counter = ChoreoRun.damped(zoom);
        ve.getValue('scale', counter)!.set(counter);
      }
    }
  }

  /* ---- c.Tether: the wire that follows (§6.1) ---- */

  private tetherDrawScheduled = false;

  private scheduleTetherDraw() {
    if (this.tetherDrawScheduled) {
      return;
    }
    this.tetherDrawScheduled = true;
    frame.postRender(() => {
      this.tetherDrawScheduled = false;
      for (const t of this.tracks) {
        if (t.started && t.wire) {
          this.drawTether(t);
        }
      }
    });
  }

  /**
   * One frame of a derived value (§4.10). Read the scene, hand it to the
   * author's function, write what comes back.
   *
   * `set`, not an animation: a derived value IS the frame, so there is
   * nothing to interpolate toward and nothing the compositor could be
   * given — this is the main-thread cost the step charges, and the reason
   * it is the same cost `c.Tether` already pays.
   */
  private drive(t: Track, now: number) {
    const { cue } = t;
    const derive = cue.derive;
    const ve = cue.sprite.node.visualElement;
    if (!derive || !ve) {
      return;
    }
    const self = this.regionRect(cue.sprite);
    if (!self) {
      return;
    }
    // `self` is the follower's box with its own translation TAKEN OUT. A
    // read that saw its own output would be a function of its own last
    // frame — the memory that makes a scrub irreproducible — and in
    // practice it oscillates: pin x to a source, and next frame the read
    // sees the pinned box and computes zero.
    //
    // The correction comes from the RENDERED transform, not from the
    // motion value: the value can be a render ahead of the box that was
    // just measured, and mixing the two is a doubling bug that only shows
    // itself on a seek (280 becomes 560, then 1120…).
    const painted = new DOMMatrix(
      getComputedStyle(cue.sprite.element).transform,
    );
    const zoom = this.camera.zoom || 1;
    self.x -= painted.e / zoom;
    self.y -= painted.f / zoom;
    const sources: Rect[] = [];
    for (const source of derive.sources) {
      const rect = this.liveRect(source);
      if (!rect) {
        return; // a source that is not on the page has no box to follow
      }
      sources.push(rect);
    }
    const span = t.end - t.start;
    const values = derive.read({
      camera: { ...this.camera },
      p: span > 0 ? Math.max(0, Math.min(1, (now - t.start) / span)) : 1,
      self,
      sources,
      t: now / 1000,
    });
    for (const [key, value] of Object.entries(values)) {
      ve.getValue(key, value)!.set(value);
    }
    // rendered NOW, not scheduled. A scheduled render lands in motion's
    // own render step, which is a hop later than the synchronous pin the
    // move it is following just did — so on the first frame of a flight
    // the source would already be drawn at the origin while the follower
    // was still drawn at the destination, which is a whole bay's flash.
    ve.render();
  }

  /** the window closed (or was scrubbed out of): put the declared rest back */
  private restDerived(t: Track) {
    const rest = t.cue.derive?.rest;
    const ve = t.cue.sprite.node.visualElement;
    if (!rest || !ve) {
      return;
    }
    for (const [key, value] of Object.entries(rest)) {
      ve.getValue(key, value)!.jump(value);
    }
    ve.render();
  }

  /**
   * A source's box as it will be THIS frame, not as it was painted last
   * frame.
   *
   * A measured rect carries the transform the browser last painted, which
   * is one frame stale — and one frame of staleness is not a rounding
   * error when the source is a FLIP. On the first frame of a move the
   * element's layout has already jumped to the destination while its
   * transform still has to carry it back to the origin, so a follower
   * reading the painted box sees the card a whole bay away from where it
   * is about to be drawn, and flashes there. Correcting the measured box
   * by (current motion value − painted translate) removes the staleness
   * entirely: the follower is exact, not merely close.
   */
  private liveRect(sprite: Sprite): Rect | null {
    const rect = this.regionRect(sprite);
    const el = sprite.element;
    if (!rect || !el) {
      return rect;
    }
    const ve = sprite.node.visualElement;
    const painted = new DOMMatrix(getComputedStyle(el).transform);
    const zoom = this.camera.zoom || 1;
    rect.x += ((ve?.getValue('x')?.get() as number) ?? 0) - painted.e / zoom;
    rect.y += ((ve?.getValue('y')?.get() as number) ?? 0) - painted.f / zoom;
    return rect;
  }

  /**
   * A sprite's box in the region's own space — the same mapping the
   * tether draws in, so a follower and a wire agree at any camera zoom.
   */
  private regionRect(sprite: Sprite): Rect | null {
    const el = sprite.element;
    if (!el?.isConnected) {
      return null;
    }
    const r = el.getBoundingClientRect();
    const frame = this.options.cameraFrame?.getBoundingClientRect();
    const zoom = this.camera.zoom || 1;
    if (!frame) {
      return { height: r.height, width: r.width, x: r.x, y: r.y };
    }
    return {
      height: r.height / zoom,
      width: r.width / zoom,
      x: (r.x - frame.x) / zoom,
      y: (r.y - frame.y) / zoom,
    };
  }

  private drawTether(t: Track) {
    const layer = this.options.tetherLayer;
    const tether = t.cue.tether;
    if (!layer || !tether || !t.wire) {
      return;
    }
    // the svg rides the camera with the scene, so client coordinates are
    // mapped through its screen CTM — a wire drawn in user units lands on
    // its sprites at any zoom, not only at identity
    const inverse = layer.getScreenCTM()?.inverse();
    const box = layer.getBoundingClientRect();
    const toLocal = (clientX: number, clientY: number) => {
      if (!inverse) {
        return { x: clientX - box.left, y: clientY - box.top };
      }
      const p = new DOMPoint(clientX, clientY).matrixTransform(inverse);
      return { x: p.x, y: p.y };
    };
    const rectOf = (sprite: Sprite | null): Rect | null => {
      const el = sprite?.element;
      if (!el?.isConnected) {
        return null;
      }
      const r = el.getBoundingClientRect();
      const tl = toLocal(r.left, r.top);
      const br = toLocal(r.right, r.bottom);
      return {
        height: br.y - tl.y,
        width: br.x - tl.x,
        x: tl.x,
        y: tl.y,
      };
    };
    const a = rectOf(tether.from);
    const b = rectOf(tether.to);
    if (a && b) {
      t.wire.setAttribute('d', tether.path(a, b));
    }
  }

  /* ---- c.Raise: the elevated layer (§6.3) ---- */

  private promote(t: Track) {
    const layer = this.options.raisedLayer;
    const el = t.cue.sprite.element;
    if (!layer || !el.isConnected || t.perch) {
      return;
    }
    const box = el.getBoundingClientRect();
    const layerBox = layer.getBoundingClientRect();
    // the slot holds: siblings must not reflow under a lifted sprite
    const placeholder = document.createElement(el.tagName);
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.cssText = `visibility:hidden;width:${box.width}px;height:${box.height}px;margin:0;flex:none`;
    const prior = el.style.cssText;
    el.parentNode?.insertBefore(placeholder, el);
    layer.appendChild(el);
    el.style.position = 'absolute';
    el.style.left = `${box.left - layerBox.left}px`;
    el.style.top = `${box.top - layerBox.top}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
    el.style.margin = '0';
    if (t.cue.raise?.shadow) {
      el.style.filter = 'drop-shadow(0 18px 24px rgba(0,0,0,0.35))';
    }
    t.perch = { placeholder, prior };
  }

  private restore(t: Track) {
    const el = t.cue.sprite.element;
    const perch = t.perch;
    if (!perch) {
      return;
    }
    t.perch = undefined;
    perch.placeholder.parentNode?.replaceChild(el, perch.placeholder);
    el.style.cssText = perch.prior;
    t.cue.sprite.node.visualElement?.scheduleRender();
  }

  /* ---- c.Scroll: the container as a step (§6.1) ---- */

  private startScroll(t: Track) {
    const el = t.cue.sprite.element;
    let container: HTMLElement | null = el.parentElement;
    while (container) {
      const cs = getComputedStyle(container);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) {
        break;
      }
      container = container.parentElement;
    }
    if (!container) {
      return;
    }
    const box = el.getBoundingClientRect();
    const cBox = container.getBoundingClientRect();
    const align = t.cue.scroll!.align;
    const offsetY = box.top - cBox.top + container.scrollTop;
    const offsetX = box.left - cBox.left + container.scrollLeft;
    const factor = align === 'center' ? 0.5 : align === 'end' ? 1 : 0;
    const to = {
      left: Math.max(0, offsetX - (container.clientWidth - box.width) * factor),
      top: Math.max(
        0,
        offsetY - (container.clientHeight - box.height) * factor,
      ),
    };
    // the user's own wheel takes the container back: the step cancels, the
    // run survives (§8.2)
    const onWheel = () => this.stopScroll(t, false);
    container.addEventListener('wheel', onWheel, { passive: true });
    container.addEventListener('touchmove', onWheel, { passive: true });
    t.scrolling = {
      cancelListener: () => {
        container.removeEventListener('wheel', onWheel);
        container.removeEventListener('touchmove', onWheel);
      },
      container,
      from: { left: container.scrollLeft, top: container.scrollTop },
      to,
    };
  }

  private stopScroll(t: Track, rewind: boolean) {
    const s = t.scrolling;
    if (!s) {
      return;
    }
    t.scrolling = undefined;
    s.cancelListener();
    if (rewind) {
      s.container.scrollTop = s.from.top;
      s.container.scrollLeft = s.from.left;
    }
  }

  /** stop a track's animations at the value level — an async animation
   *  cancelled before it resolves stays 'idle' forever if only the controls
   *  are stopped, and its value then reads as animating for good */
  private stopTrack(t: Track) {
    t.controls?.forEach((c) => c.stop());
    t.controls = undefined;
    t.platform?.forEach((a) => a.cancel());
    t.platform = undefined;
    const ve = t.cue.sprite.node.visualElement;
    if (ve && t.cue.target) {
      for (const key in t.cue.target) {
        ve.getValue(key)?.stop();
      }
    }
  }

  /** land a cue's end values without ever having played it */
  private jumpFinals(t: Track) {
    const { cue } = t;
    const ve = cue.sprite.node.visualElement;
    if (!ve || (!cue.target && !cue.flight)) {
      return;
    }
    if (cue.flight) {
      // the platform owned the journey; the landing is written inline
      this.applyFlight(t, 1);
      ve.render();
      if (!cue.target) {
        t.passed = true;
        return;
      }
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
      // The sprite has stood pinned at its FIRST keyframes since the run
      // began (pinStarts) so a build-in sits hidden until its window. From
      // here the split's slots carry those keyframes each in their own
      // window, and they are the sprite's children — so the container must
      // step aside to its END values now, or its pinned opacity would
      // multiply every slot to nothing. land() leaves it in the same place.
      for (const key in cue.target) {
        const raw = cue.target[key];
        if (Array.isArray(raw)) {
          const end = raw[raw.length - 1] as PropValue;
          ve.getValue(key, end)!.jump(end);
        }
      }
      ve.render();
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
    if (cue.flight) {
      this.startFlight(t);
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
    // Playback rides the platform: plain tweens and springs are left free
    // to accelerate onto WAAPI, off the main thread — a gallery of live
    // demos cannot afford a JS driver for every value. The cost is one
    // race: a finished accelerated animation commits its finals
    // asynchronously, which can land AFTER a scrub's jump and overwrite
    // it. Stills pay for the acceleration by re-asserting themselves on
    // the frames after they are entered (scheduleRestill).
    t.controls = animateTarget(ve, {
      ...cue.target,
      transition,
    } as never);
    for (const c of t.controls) {
      c.speed = this.rate;
    }
  }

  /** put the sprite at progress `p` of its sampled flight path (§4.4) */
  private applyFlight(t: Track, p: number) {
    const { cue } = t;
    const ve = cue.sprite.node.visualElement;
    const flight = cue.flight;
    if (!ve || !flight) {
      return;
    }
    const pts = flight.points;
    const at = Math.min(
      pts.length - 1 - 1e-9,
      Math.max(0, p) * (pts.length - 1),
    );
    const index = Math.floor(at);
    const local = at - index;
    const a = pts[index]!;
    const b = pts[Math.min(index + 1, pts.length - 1)]!;
    const x = a.x + (b.x - a.x) * local - flight.rest.x;
    const y = a.y + (b.y - a.y) * local - flight.rest.y;
    ve.getValue('x', x)!.set(x);
    ve.getValue('y', y)!.set(y);
    if (flight.rotate !== undefined) {
      const angle =
        (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI +
        (typeof flight.rotate === 'number' ? flight.rotate : 0);
      ve.getValue('rotate', angle)!.set(angle);
    }
  }

  /** the eased progress a flight sits at, `ms` into its window */
  private flightProgress(t: Track, ms: number): number {
    const span = t.end - t.start;
    const raw = span > 0 ? Math.min(1, Math.max(0, ms / span)) : 1;
    const transition = t.cue.transition as
      (Record<string, unknown> & { ease?: unknown }) | undefined;
    if (isSpring(transition)) {
      const pts = t.cue.flight!.points;
      const end = pts[pts.length - 1]!;
      const distance = Math.hypot(end.x, end.y) || 1;
      const generator = springGenerator({
        keyframes: [0, distance],
        ...(transition ?? {}),
      } as never);
      return generator.next(ms / this.scale).value / distance;
    }
    return easingDefinitionToFunction(
      (transition?.ease as never) ?? 'easeInOut',
    )(raw);
  }

  /**
   * The sampled path as platform keyframes: each point becomes a transform,
   * uniformly spaced (the points were sampled uniformly in progress), and
   * the eased clock rides the animation's easing instead of per-frame JS.
   */
  private flightKeyframes(t: Track): Keyframe[] {
    const flight = t.cue.flight!;
    const pts = flight.points;
    const frames: Keyframe[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      let transform = `translate(${p.x - flight.rest.x}px, ${p.y - flight.rest.y}px)`;
      if (flight.rotate !== undefined) {
        const a = pts[Math.max(0, i - 1)]!;
        const b = pts[Math.min(pts.length - 1, i + 1)]!;
        const angle =
          (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI +
          (typeof flight.rotate === 'number' ? flight.rotate : 0);
        transform += ` rotate(${angle}deg)`;
      }
      frames.push({ transform });
    }
    return frames;
  }

  private startFlight(t: Track) {
    const { cue } = t;
    const ve = cue.sprite.node.visualElement;
    if (!ve) {
      return;
    }
    if (!this.playing) {
      // born inside a still: computed, never driven, like every other cue
      this.sampleStill(t, this.master);
      return;
    }
    const span = Math.max(1, t.end - t.start);
    const controls: AnimationPlaybackControls[] = [];
    // The journey rides the platform (§6.2's move, made early): the
    // pre-sampled path IS a keyframe list, and the eased clock — spring or
    // tween — pre-samples into a linear() easing, so the compositor flies
    // the box while the main thread stays free.
    const anim = cue.sprite.element.animate(this.flightKeyframes(t), {
      duration: span,
      easing: generateLinearEasing(
        (p: number) => this.flightProgress(t, p * span),
        span,
      ),
      fill: 'both',
    });
    anim.playbackRate = this.rate;
    anim.currentTime = Math.min(span, Math.max(0, this.master - t.start));
    (t.platform ??= []).push(anim);
    controls.push(platformControls(anim));
    // size pairs still ride the engine; position rides the sampled path
    if (cue.target && Object.keys(cue.target).length) {
      const transition = scaleTransition(
        { ...cue.transition, onUpdate: noop } as never,
        this.scale,
      ) as Record<string, unknown>;
      controls.push(
        ...animateTarget(ve, { ...cue.target, transition } as never),
      );
    }
    for (const c of controls) {
      c.speed = this.rate;
    }
    t.controls = controls;
  }

  /** compute one still frame of a cue and jump the values onto the element */
  private sampleStill(t: Track, now: number) {
    const { cue } = t;
    const ve = cue.sprite.node.visualElement;
    if (!ve || (!cue.target && !cue.flight)) {
      return;
    }
    if (cue.flight) {
      this.applyFlight(t, this.flightProgress(t, now - t.start));
      ve.render();
      if (!cue.target) {
        return;
      }
    }
    const span = t.end - t.start;
    const p = span > 0 ? Math.min(1, Math.max(0, (now - t.start) / span)) : 1;
    const transition = cue.transition as
      (Record<string, unknown> & { ease?: unknown; type?: string }) | undefined;
    const sprung = isSpring(transition);
    const ease = sprung
      ? null
      : easingDefinitionToFunction((transition?.ease as never) ?? 'easeInOut');
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
    flushKeyframeResolvers();
    this.stopTrack(t);
    if (t.delivery) {
      // a delivery mid-split when the scrub crossed its end: finish it —
      // end values land and the sprite's own text nodes come back
      t.delivery.complete();
      t.delivery = undefined;
    }
    const ve = cue.sprite.node.visualElement;
    if (ve && cue.flight) {
      // the platform animation is cancelled above; land the journey inline
      this.applyFlight(t, 1);
      ve.render();
    }
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
      if (!ve || cue.loop) {
        continue;
      }
      if (cue.flight) {
        this.movedValues.push({ key: 'x', ve }, { key: 'y', ve });
        this.owned.push(
          { el: cue.sprite.element, key: 'x', ve },
          { el: cue.sprite.element, key: 'y', ve },
        );
        if (cue.flight.rotate !== undefined) {
          this.movedValues.push({ key: 'rotate', ve });
        }
        // stand the sprite on the path's first point before first paint
        this.applyFlight({ ...t }, 0);
        rendered.add(ve);
      }
      if (!cue.target) {
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
              this.borrowedValues.push({
                el: cue.sprite.element,
                key,
                prior: cue.sprite.element.style.getPropertyValue(dash(key)),
                ve,
              });
            }
          } else {
            this.movedValues.push({
              key,
              rest: key.startsWith('scale')
                ? 1
                : key === 'clipPath'
                  ? 'none'
                  : 0,
              ve,
            });
          }
        } else if (cue.borrow && !ve.hasValue(key)) {
          // the cue only borrows this value (the crossfade's color-carry):
          // returned — inline style removed — when the run releases, so the
          // stylesheet's own declaration stands again
          this.borrowedValues.push({
            el: cue.sprite.element,
            key,
            prior: cue.sprite.element.style.getPropertyValue(dash(key)),
            ve,
          });
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
    // platform animations override inline style, and a measurement must see
    // the resting layout — every native is cancelled before anything reads
    for (const t of this.tracks) {
      t.platform?.forEach((a) => a.cancel());
      t.platform = undefined;
      this.dropCameraAnimation(t);
    }
    const touched = new Set<VisualElement>();
    this.retired = { borrowed: [], moved: [] };
    for (const { ve, el, key, prior } of this.borrowedValues.splice(0)) {
      this.retired.borrowed.push({
        el,
        key,
        prior,
        value: ve.getValue(key)?.get(),
        ve,
      });
      ve.removeValue(key);
      if (prior) {
        el.style.setProperty(dash(key), prior);
      } else {
        el.style.removeProperty(dash(key));
      }
      touched.add(ve);
    }
    for (const { ve, key, rest } of this.movedValues.splice(0)) {
      this.retired.moved.push({
        key,
        rest,
        value: ve.getValue(key)?.get(),
        ve,
      });
      ve.getValue(key)?.jump(rest ?? 0);
      touched.add(ve);
    }
    touched.forEach((ve) => ve.render());
  }

  /**
   * A pass measured this run's world at rest and then decided to KEEP the
   * run — but the measurement itself was destructive: releaseForMeasure
   * cancels platform animations, returns borrowed values, and jumps every
   * moved value to rest, and a MotionValue.jump() STOPS the animation
   * driving it. Left like that, a kept run keeps its clock and its landing
   * but loses its picture: the flight freezes at rest until the finals
   * land — which on a busy page (the gallery: neighbours re-pass the
   * region every render) is every crossing, every time. So the keep path
   * calls this: moved and borrowed values are stood back where they were,
   * their bookkeeping is re-registered, every in-flight track's animation
   * is retired so evaluate re-enters it — the machinery a scrub-then-play
   * already uses — and the re-entered animations are seeked back onto the
   * run's own clock, so a keep is invisible rather than a restart.
   */
  reassert() {
    const { borrowed, moved } = this.retired;
    this.retired = { borrowed: [], moved: [] };
    for (const { el, key, prior, value, ve } of borrowed) {
      if (value !== undefined) {
        ve.getValue(key, value as PropValue)!.jump(value as PropValue);
      }
      this.borrowedValues.push({ el, key, prior, ve });
    }
    for (const { key, rest, value, ve } of moved) {
      if (value !== undefined) {
        ve.getValue(key)?.jump(value as PropValue);
      }
      this.movedValues.push({ key, rest, ve });
    }
    if (!this.playing) {
      // a paused run is a still, and stills re-assert themselves (restill)
      return;
    }
    const now = this.master;
    const restarted: Track[] = [];
    for (const t of this.tracks) {
      if (
        t.started &&
        !t.passed &&
        now >= t.start &&
        (now < t.end || t.cue.loop) &&
        (t.cue.target || t.cue.flight)
      ) {
        flushKeyframeResolvers();
        this.stopTrack(t);
        restarted.push(t);
      }
    }
    this.evaluate();
    for (const t of restarted) {
      // startFlight seeks its platform animation itself; engine tweens and
      // springs are stood at the window's elapsed time here
      if (!t.cue.flight) {
        const at = Math.max(0, now - t.start) / 1000;
        t.controls?.forEach((c) => {
          c.time = at;
        });
      }
    }
  }

  cancel(keep?: Set<ChoreoNode>) {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    activeRuns.delete(this);
    this.stopTicking();
    clearTimeout(this.autoTimer);
    this.options.onCamera?.({ ...this.camera });
    // resolve everything first: a stop() issued before the async keyframe
    // resolution is dropped, and the revived animation leaves its value
    // reading as animating forever — the probe never settles
    flushKeyframeResolvers();
    this.sampleVelocities();
    for (const t of this.tracks) {
      this.stopTrack(t);
      t.delivery?.cancel();
      t.loopAnimation?.cancel();
      this.dropCameraAnimation(t);
      this.restore(t);
      this.stopScroll(t, false);
      t.wire?.remove();
      t.wire = undefined;
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

/** every live run, for the test helpers that drive gates and clocks */
export const activeRuns = new Set<ChoreoRun>();

export function execute(compiled: Compiled, options: RunOptions): ChoreoRun {
  return new ChoreoRun(compiled, options);
}
