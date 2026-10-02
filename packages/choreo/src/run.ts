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
import { motionSpeed, scaleTransition } from 'glimmer-motion';
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

import { cssEasing, deliver, type Delivery, keyframesOf } from './deliver.ts';
import { sampleThrough, settleThrough } from './path.ts';
import { choreoHostById } from './registry.ts';
import type {
  Camera3DState,
  CameraState,
  ChoreoNode,
  Compiled,
  Cue,
  Easing,
  FollowSource,
  GateMark,
  PerformCommand,
  PropValue,
  Rect,
  Sprite,
} from './types.ts';

/** the properties whose mid-flight drive means a sprite is IN SPACE — a
 *  replacement pass must carry these on, never snap them (§3.1) */
const MIDFLIGHT_KEYS = [
  'height',
  'rotate',
  'scale',
  'scaleX',
  'scaleY',
  'width',
  'x',
  'y',
];

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
  /**
   * The sprites this run is DRIVING through space right now — an
   * unfinished move/spring/tween writing geometry — with each cue's
   * transition. A replacement pass reads this to complete its score: a
   * flying sprite the new score does not name gets a continuation move
   * instead of a one-frame release to rest (§3.1).
   */
  midflight(): Map<ChoreoNode, Record<string, unknown> | undefined>;
  /** standing at a gate, waiting for advance() — a still, and settled */
  readonly parked: boolean;
  pause(): void;
  /**
   * The run is not advancing itself: paused, parked at a gate, or otherwise
   * held. Its clock belongs to whoever stopped it.
   *
   * A held run keeps writing: inline width, height and transform stay on
   * every sprite it owns, so the geometry the page reports is the run's
   * rather than the stylesheet's. Anything deciding whether the world has
   * changed by measuring it has to know not to trust what it sees.
   */
  readonly paused: boolean;
  play(): void;
  /** a pass measured and decided to keep this run: put the picture back */
  reassert(): void;
  /** put every element this run has touched back to its resting layout NOW */
  releaseForMeasure(): void;
  /**
   * One build backwards — Keynote's rule. Land PARKED at the previous
   * gate with everything ahead re-closed, and HOLD: a retreat never
   * plays, never self-opens a @delay gate, and the next advance() replays
   * the un-built segment forward. False when nothing stands behind the
   * clock (the caller falls through to whatever "back" means one level
   * out — an outer run, the previous slide).
   */
  retreat(): boolean;
  /** which gate-bounded segment the clock is in */
  readonly segment: number;
  /** playback rate: 1 is normal, 0.5 half, as Motion's controls */
  speed: number;
  /**
   * This run has no end of its own: its score is nothing but OPEN steps, so
   * it holds them — drawing its wires, keeping its holds — until it is
   * cancelled or replaced. A standing run is SETTLED, not in flight: there
   * is nothing to wait for, and `finished` will not resolve until a cancel.
   */
  readonly standing: boolean;
  /** the clock, in seconds at 1× — settable; setting it across a gate parks there */
  time: number;
  /** what every driven value was doing at the moment of interruption */
  velocities: Velocities;
}

interface RunOptions {
  /** where the region's frame stands as this run begins */
  camera?: CameraState;
  /** where the SHOT stands as this run begins — a 3D host's own pose */
  camera3d?: Camera3DState;
  /** the aim point the prior run left applied — see ChoreoRun.cameraAim */
  cameraAim?: { x: number; y: number } | null;
  /** the element the camera transform drives (the region's scene wrapper) */
  cameraFrame?: HTMLElement;
  /**
   * Nothing in this region is staying — every participant it can see is a
   * leaver. See the note in `park`: it decides whether a gate this run stops
   * at is a gate anybody could still open.
   */
  doomed?: boolean;
  inherit?: Velocities;
  /** a camera step landed or the run ended: the frame's new resting state */
  onCamera?(state: CameraState): void;
  /**
   * The 3D shot moved. Called every frame a `c.Camera3D` cue changes the
   * pose — including on a scrub, because the pose is sampled from the
   * score rather than remembered from playback. Choreo has no renderer of
   * its own; this is where the host's does the drawing.
   */
  onCamera3D?(state: Camera3DState): void;
  /**
   * A `c.Perform` command entered the folded set: dispatch it (§C4).
   * Deferred past the render pass, in time order, once per fold entry.
   */
  onPerform?(command: PerformCommand): void;
  /**
   * The folded set shrank — the clock moved to before a command the host
   * already holds. Reset commanded state; the remaining prefix is
   * re-dispatched, in order, immediately after.
   */
  onPerformReset?(): void;
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
  /** camera: the resolved absolute target — relative cues (`by`) resolve
   * against the pose in force at start, absolute cues fill from it */
  cameraTo?: CameraState;
  controls?: AnimationPlaybackControls[];
  cue: Cue;
  delivery?: Delivery;
  /** scaled window on the master clock */
  end: number;
  /** camera3d: the shot as this cue began, and where it resolves to */
  from3d?: Camera3DState;
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
  /** an attachment refused once (an integrator under an exact clock): never driven again */
  refused?: boolean;
  /** scroll: the container being driven, and where it is headed */
  scrolling?: {
    cancelListener(): void;
    container: HTMLElement;
    from: { left: number; top: number };
    to: { left: number; top: number };
  };
  start: number;
  started: boolean;
  /** camera3d: the resolved absolute shot this cue lands on */
  to3d?: Camera3DState;
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
  readonly standing: boolean;
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
    this.camera3d = options.camera3d ?? {
      dolly: 1,
      pitch: 0,
      x: 0,
      y: 0,
      yaw: 0,
    };
    this.initial3d = { ...this.camera3d };
    this.cameraAim = options.cameraAim ?? null;
    // frozen: the fold a random-access seek reconstructs the camera from
    this.initialCamera = { ...this.camera };
    this.initialAim = this.cameraAim ? { ...this.cameraAim } : null;
    this.cues = compiled.cues;
    this.pending = new Set(options.removed);
    const s = this.scale;
    this.gates = compiled.gates.map((g) => ({
      at: g.at * s,
      auto: g.auto === undefined ? undefined : g.auto * s,
      opened: false,
    }));
    this.standing = compiled.open ?? false;
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
      // an ambient loop plays past the run's end and a STANDING cue has no
      // end at all: neither may lend the run a length
      if (!cue.loop && !cue.standing) {
        total = Math.max(total, start + duration);
      }
      // …and neither may hold a leaver's row open forever
      this.rowEnd.set(
        cue.sprite,
        Math.max(
          this.rowEnd.get(cue.sprite) ?? 0,
          cue.standing ? start : start + duration,
        ),
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

  get paused(): boolean {
    return !this.playing;
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

  /**
   * ATTACH: write each attached region's clock from this one's.
   *
   * Several windows may name one region — a film's every beat has a plate
   * window, and the plate is one region re-keyed per beat — so the run
   * resolves ONE governing window per region on every evaluate: the window
   * that holds `now`; else the latest past one, if it holds; else the
   * earliest future one, which stands the child at its head (Remotion's
   * premount: mounted early, clock frozen at `in`). The child's run is
   * paused and told `in + (now − start) × rate`. No history is kept on
   * either side, which is what makes a seek into a window land where
   * playing there would.
   */
  private driveAttachments(now: number) {
    let governing: Map<string, Track> | undefined;
    for (const t of this.tracks) {
      const a = t.cue.attach;
      if (!a || t.refused) {
        continue;
      }
      governing ??= new Map();
      const g = governing.get(a.region);
      if (!g) {
        governing.set(a.region, t);
        continue;
      }
      const rank = (x: Track) =>
        now >= x.start && now < x.end ? 2 : now >= x.end ? 1 : 0;
      const rt = rank(t);
      const rg = rank(g);
      if (
        rt > rg ||
        (rt === rg && rt === 1 && t.end > g.end) ||
        (rt === rg && rt === 0 && t.start < g.start)
      ) {
        governing.set(a.region, t);
      }
    }
    if (!governing) {
      return;
    }
    for (const [region, t] of governing) {
      const a = t.cue.attach!;
      const child = choreoHostById(region)?.currentRun() ?? null;
      if (!child || child === this) {
        continue;
      }
      if (a.exact && child.hasIntegrator()) {
        // refused ONCE, loudly, and never driven: the film goes on, the
        // attachment stands dead, and the error names the region
        t.refused = true;
        console.error(
          `choreo: <Choreo "${region}"> is attached under an exact clock, ` +
            'but its score integrates (a spring or a follow): its state is ' +
            'its history, and a driven clock has none',
        );
        continue;
      }
      let local: number;
      if (now < t.start) {
        local = a.in;
      } else if (now < t.end) {
        local = a.in + ((now - t.start) / 1000 / this.scale) * a.rate;
      } else if (a.end === 'hold') {
        local = a.in + (t.cue.duration / 1000) * a.rate;
      } else {
        continue;
      }
      // PLAY WHEN PLAYING, SEEK WHEN SEEKING. A parent that is playing
      // lets the child play too — natively, on the compositor, as smooth
      // as it ever was — and corrects it only past a frame of drift; a
      // parent that is paused or scrubbed holds the child and writes its
      // clock. Both are the same statement of where the child stands at
      // `now`; only the means differ, and the means is what smoothness
      // is made of.
      const inside = now >= t.start && now < t.end;
      if (this.playing && inside && !this.ended) {
        if (child.paused) {
          child.time = local;
          child.play();
        } else if (Math.abs(child.time - local) > 1 / 30) {
          child.time = local;
        }
        const speed = this.rate * a.rate;
        if (Math.abs(child.speed - speed) > 1e-6) {
          child.speed = speed;
        }
        continue;
      }
      if (!child.paused) {
        child.pause();
      }
      if (Math.abs(child.time - local) > 1e-4) {
        child.time = local;
      }
    }
  }
  /** does this run's score integrate — a spring, a follow — so that its state is its history? */
  hasIntegrator(): boolean {
    return this.tracks.some((t) => t.cue.kind === 'spring' || !!t.cue.derive);
  }
  isDone(): boolean {
    return this.ended || this.cancelled;
  }

  midflight(): Map<ChoreoNode, Record<string, unknown> | undefined> {
    const out = new Map<ChoreoNode, Record<string, unknown> | undefined>();
    if (this.isDone()) {
      return out;
    }
    for (const t of this.tracks) {
      const { cue } = t;
      if (!t.started || t.passed) {
        continue;
      }
      const geometry =
        cue.flight !== undefined ||
        (cue.target !== undefined &&
          MIDFLIGHT_KEYS.some((key) => key in cue.target!));
      if (geometry) {
        out.set(cue.sprite.node, cue.transition);
      }
    }
    return out;
  }

  /* ---- transport ---- */

  pause() {
    if (!this.playing) {
      return;
    }
    this.playing = false;
    this.setPaused(true);
    // a paused parent holds what it drives, where the clock stands
    this.driveAttachments(this.master);
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
    if (!next && this.master >= this.total && !this.standing) {
      this.finish();
    }
  }

  retreat(): boolean {
    if (this.cancelled) {
      return false;
    }
    // the boundary behind the clock: parked AT a gate, the build behind
    // is the previous one; mid-segment, it is the start of this segment
    const eps = 1e-6;
    const behind = this.gates.filter((g) => g.at < this.master - eps);
    const target = behind[behind.length - 1];
    if (!target) {
      return false;
    }
    clearTimeout(this.autoTimer);
    // everything at or ahead of the landing replays forward from here —
    // an opened gate left open would let the next advance() sail PAST
    // the un-built segment instead of playing it
    for (const g of this.gates) {
      if (g.at >= target.at) {
        g.opened = false;
      }
    }
    // a finished run has state behind it too: un-end so advance() works.
    // (Leavers a finish released stay released — a retreat un-builds the
    // score, not the exits the region already settled.)
    this.ended = false;
    // Land a half-millisecond SHY of the gate, not on it: a backward
    // still restores a cleared cue's committed finals only when the
    // playhead stands strictly before its start, and half a millisecond
    // is invisible while advance() — which opens the gate first — plays
    // straight through it.
    this.master = Math.max(0, target.at - 0.5);
    this.playing = false;
    this.setPaused(true);
    this.evaluate();
    this.park(target, false);
    return true;
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
    // A standing run has played everything it has and still is not over:
    // its open cues are the picture, and they hold until something replaces
    // them. It keeps ticking so the wires it draws keep following.
    if (this.master >= this.total && !this.standing) {
      this.finish();
    }
  };

  private park(gate: GateMark & { opened?: boolean }, auto = true) {
    (gate as { opened: boolean }).opened = false;
    this.parkedAt = gate as GateMark & { opened: boolean };
    this.playing = false;
    this.stopTicking();
    /**
     * HAND BACK THE LEAVERS, but only when nobody is left to open the gate.
     *
     * `pending` is removed sprites and nothing else — elements a <Presence>
     * is holding in the document only because this run undertook to see them
     * out. Parking stops the clock (above), so from here nothing advances:
     * every row end still ahead of `master` is unreachable, `onSpriteDone`
     * can never fire for it, and `finished` never resolves. The Presence
     * waits on a beat that is not coming.
     *
     * `doomed` is what separates that from an ordinary build, and the
     * distinction is real rather than a hedge. A gated build parks with the
     * same sprites pending and means it: the slide is still on screen, the
     * click is still coming, and the leaver is meant to fly out when it
     * arrives — releasing it there would make the item vanish instead, which
     * is the animation the registration exists to protect. A region where
     * every participant is leaving has no slide left to click on. Nothing
     * stays, so nothing can ask, and the gate is waiting on an event that
     * cannot happen.
     *
     * That is not hypothetical. Rack's score is a gate followed by one
     * parallel over sixty-one tiles, held still until its slider asks — so
     * filtering its card out of the gallery compiled a score that parked at
     * t=0 with all sixty-one of its participants pending and a clock that
     * never moved. Because <Presence> releases its leavers as a BATCH, those
     * sixty-one held all forty cards leaving beside them: under the default
     * mode the survivors never closed up, and under popLayout forty
     * invisible cards stayed lifted over the grid taking clicks meant for
     * the two you could see.
     *
     * A parked run is a STILL, in this file's own words — settled, not in
     * flight. A still is not an exit animation, so there is nothing here to
     * cut short. If the gate is ever opened the elements are simply gone,
     * which is what leaving means.
     */
    if (this.options.doomed) {
      for (const sprite of [...this.pending]) {
        this.pending.delete(sprite);
        this.options.onSpriteDone(sprite);
      }
    }
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
    // a @delay gate opens itself only when the clock ARRIVES forward: a
    // park reached by stepping back holds until the user advances — the
    // Keynote rule. Without this, backing onto a self-opening gate
    // replayed the build on its own a beat later.
    if (auto && gate.auto !== undefined) {
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
    // the windows it drove are past: hold or leave them, per their policy
    this.driveAttachments(this.master);
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
    // a finished run seeked back inside itself is a run again: an
    // attachment driven past its window and back must be playable, and
    // a retreat already un-ends for the same reason
    if (this.ended && clamped < this.total) {
      this.ended = false;
    }
    // seeking is a still: hold the transport
    const wasPlaying = this.playing;
    this.playing = false;
    this.setPaused(true);
    this.reconstructCameraAt(gate ? gate.at : Infinity);
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
    /**
     * The shot is FOLDED, not remembered.
     *
     * Every other cue kind owns an element and can be started and rewound
     * in place. A camera3d cue owns one shared triple, and per-cue state
     * does not survive that: seeking back from cue two to inside cue one
     * runs cue one's lerp (correct) and then cue two's rewind (which
     * restores the pose cue two INHERITED — cue one's end), and the
     * second write wins because it comes later in the list. The shot
     * ended up at the boundary value for every seek backwards.
     *
     * So it is recomputed from the score on every evaluate: start at the
     * pose the run inherited, walk the cues in order, and let each one
     * pass through, lerp, or land. A relative cue resolves against
     * whatever the walk has accumulated by the time it is reached, which
     * is precisely "the pose in force at cue start" — and it means a
     * direct seek is identical to having played there, by construction
     * rather than by bookkeeping.
     */
    let shot: Camera3DState | null = null;
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
          t.cameraTo = ChoreoRun.resolveCameraTo(cue.camera, t.cameraFrom!);
        } else if (!inside && t.started && now < t.start) {
          t.started = false;
          t.cameraTo = undefined;
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
          const to = t.cameraTo ?? ChoreoRun.resolveCameraTo(cue.camera, from);
          t.cameraP = p;
          this.camera = {
            x: from.x + (to.x - from.x) * p,
            y: from.y + (to.y - from.y) * p,
            zoom: from.zoom + (to.zoom - from.zoom) * p,
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
      if (cue.camera3d) {
        const from: Camera3DState = shot ?? { ...this.initial3d };
        const through = cue.camera3d.through;
        if (through?.length) {
          /**
           * A PATH: the pose in force and the waypoints are the control
           * points of a Catmull-Rom spline, sampled at the cue's eased
           * progress. One clock over the whole chain, so the camera
           * CROSSES each waypoint with continuous velocity instead of
           * parking at it — and it stays a pure function of the clock,
           * which no per-frame integrator can claim.
           */
          if (now <= t.start) {
            shot = from;
          } else {
            const p = now >= t.end ? 1 : this.cameraProgress(t, now - t.start);
            const settle = cue.camera3d.settle;
            const span = t.end - t.start;
            shot =
              settle && span > 0
                ? settleThrough(
                    from,
                    through,
                    p,
                    cue.camera3d.tension,
                    (settle * 1000) / span,
                  )
                : sampleThrough(from, through, p, cue.camera3d.tension);
          }
          continue;
        }
        const want = cue.camera3d.to;
        const fromLook = from.look;
        const to = cue.camera3d.by
          ? {
              dolly: from.dolly * (want.dolly ?? 1),
              look: want.look
                ? {
                    x: (fromLook?.x ?? 0) + want.look.x,
                    y: (fromLook?.y ?? 0) + want.look.y,
                    z: (fromLook?.z ?? 0) + want.look.z,
                  }
                : fromLook,
              pitch: from.pitch + (want.pitch ?? 0),
              x: from.x + (want.x ?? 0),
              y: from.y + (want.y ?? 0),
              yaw: from.yaw + (want.yaw ?? 0),
            }
          : {
              dolly: want.dolly ?? from.dolly,
              look: want.look ?? fromLook,
              pitch: want.pitch ?? from.pitch,
              x: want.x ?? from.x,
              y: want.y ?? from.y,
              yaw: want.yaw ?? from.yaw,
            };
        if (now <= t.start) {
          shot = from; // not yet: the walk passes straight through
        } else {
          const p = now >= t.end ? 1 : this.cameraProgress(t, now - t.start);
          shot = {
            dolly: from.dolly + (to.dolly - from.dolly) * p,
            pitch: from.pitch + (to.pitch - from.pitch) * p,
            x: from.x + (to.x - from.x) * p,
            y: from.y + (to.y - from.y) * p,
            yaw: from.yaw + (to.yaw - from.yaw) * p,
          };
          // the aim tweens with the pose: one clock, no side-channel
          if (to.look || fromLook) {
            const a = fromLook ?? { x: 0, y: 0, z: 0 };
            const b = to.look ?? a;
            shot.look = {
              x: a.x + (b.x - a.x) * p,
              y: a.y + (b.y - a.y) * p,
              z: a.z + (b.z - a.z) * p,
            };
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
    // the folded shot, published once the whole score has been walked and
    // only when it actually moved — a host that redraws on every call
    // would redraw on every evaluate, playing or not
    if (shot) {
      const was = this.camera3d;
      if (
        was.yaw !== shot.yaw ||
        was.pitch !== shot.pitch ||
        was.dolly !== shot.dolly ||
        was.x !== shot.x ||
        was.y !== shot.y ||
        was.look?.x !== shot.look?.x ||
        was.look?.y !== shot.look?.y ||
        was.look?.z !== shot.look?.z
      ) {
        this.camera3d = shot;
        this.options.onCamera3D?.({ ...shot });
      }
    }
    this.rewind(rewinds, now);
    this.driveAttachments(now);
    this.foldPerforms(limit);
  }

  /** perform tracks whose commands the host currently holds (see foldPerforms) */
  private performed = new Set<Track>();
  /** dispatches queued for after the render pass, in fold order */
  private pendingPerforms: (PerformCommand | 'reset')[] = [];
  private performFlushBooked = false;

  /**
   * The command fold (§C4): the set of Perform cues at or before the
   * clock IS the commanded state. Every evaluate — a play tick and a seek
   * alike — re-derives the eligible set; growth dispatches the new
   * commands in time order, and any shrink (a backward seek) resets the
   * host first and replays the whole remaining prefix. Commands are
   * idempotent statements of state by contract (`lamp.on`, never a
   * toggle), which is exactly what makes the replay a re-derivation.
   *
   * Dispatches are DEFERRED past the render pass: the constructor's first
   * evaluate runs while Glimmer may still be rendering, and a command
   * exists to mutate application state. A reset collapses the queue — the
   * dropped dispatches were never seen, and the replay that follows
   * restates everything still standing.
   */
  private foldPerforms(limit: number) {
    if (!this.options.onPerform && !this.options.onPerformReset) {
      return;
    }
    const now = this.master;
    const eligible = this.tracks
      .filter((t) => t.cue.perform && now >= t.start && t.start < limit)
      .sort((a, b) => a.start - b.start);
    const held = new Set(eligible);
    if ([...this.performed].some((t) => !held.has(t))) {
      this.performed.clear();
      this.pendingPerforms.length = 0;
      this.pendingPerforms.push('reset');
    }
    for (const t of eligible) {
      if (this.performed.has(t)) {
        continue;
      }
      this.performed.add(t);
      const p = t.cue.perform!;
      this.pendingPerforms.push({
        action: p.action,
        payload: p.payload,
        target: p.target,
        time: t.start / this.scale / 1000,
      });
    }
    if (this.pendingPerforms.length && !this.performFlushBooked) {
      this.performFlushBooked = true;
      frame.postRender(() => {
        this.performFlushBooked = false;
        const queue = this.pendingPerforms;
        this.pendingPerforms = [];
        for (const item of queue) {
          if (item === 'reset') {
            this.options.onPerformReset?.();
          } else {
            this.options.onPerform?.(item);
          }
        }
      });
    }
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

  /* ---- c.Camera3D: the shot, for a scene Choreo does not draw ---- */

  /**
   * The orbit pose in force. Public for the same reason `camera` is: it is
   * hand-off state, and a replacement run must continue from where this
   * one left the shot rather than snapping back to the framing.
   */
  camera3d: Camera3DState;
  private readonly initial3d: Camera3DState;

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

  /**
   * The absolute pose a camera cue lands on, resolved against the pose it
   * starts from. Absolute fields pass through; missing fields hold; a
   * relative cue (Pan / SlowZoom) offsets and multiplies the pose in
   * force — which is why resolution happens AT START (live) or during the
   * prefix fold (reconstruction), never at compile.
   */
  private static resolveCameraTo(
    cue: NonNullable<Cue['camera']>,
    from: CameraState,
  ): CameraState {
    const { by, to } = cue;
    return {
      x: by?.x !== undefined ? from.x + by.x : (to.x ?? from.x),
      y: by?.y !== undefined ? from.y + by.y : (to.y ?? from.y),
      zoom:
        by?.zoom !== undefined ? from.zoom * by.zoom : (to.zoom ?? from.zoom),
    };
  }

  private cameraProgress(t: Track, ms: number): number {
    const span = t.end - t.start;
    const raw = span > 0 ? Math.min(1, Math.max(0, ms / span)) : 1;
    const transition = t.cue.transition as
      | (Record<string, unknown> & { ease?: unknown })
      | undefined;
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
   * The camera and aim this run inherited, frozen at construction — the
   * fold origin every reconstruction starts from. Public because a
   * replacement run that re-executes the SAME score must inherit this
   * origin, not the pose in force: the pose in force is what the score's
   * prefix already produced, and folding the prefix from it applies every
   * relative cue twice (the world-dock law).
   */
  readonly initialCamera: CameraState;
  readonly initialAim: { x: number; y: number } | null;

  /**
   * Rebuild the camera fold from the score prefix before a seek's still
   * (notes/external-clock-camera-seek-handoff.md). Forward playback folds
   * each camera cue's landing into the run's cumulative camera as the
   * clock crosses it — but a random-access seek can jump clean over a
   * window, and a cue that never starts never folds: the clock reads `t`
   * while the picture holds an earlier shot. So every camera track's
   * bookkeeping (started, cameraFrom, aimFrom/aimTo, cameraP) is
   * re-derived here in timeline order from the run's initial camera;
   * evaluate() then recomputes exactly the numbers forward playback would
   * have produced, and play-after-scrub resumes from them. Pure
   * arithmetic over frozen numbers, like the rest of the camera: no DOM
   * is read, so backward and repeated seeks agree to the pixel.
   */
  private reconstructCameraAt(limit: number) {
    const cams = this.tracks.filter((t) => t.cue.camera);
    if (!cams.length) {
      return;
    }
    const now = this.master;
    cams.sort((a, b) => a.start - b.start);
    const state = { ...this.initialCamera };
    let aim = this.initialAim ? { ...this.initialAim } : null;
    for (const t of cams) {
      if (!(now >= t.start && t.start < limit)) {
        // ahead of the playhead (or behind an unopened gate): this shot
        // contributes nothing, and whatever it acquired on an earlier
        // pass is stale — including a platform animation mid-flight
        t.started = false;
        t.passed = false;
        t.cameraP = 0;
        t.cameraTo = undefined;
        t.aimFrom = aim ?? undefined;
        t.aimTo = aim ?? undefined;
        t.cameraAnimation?.cancel();
        t.cameraAnimation = undefined;
        continue;
      }
      const cue = t.cue.camera!;
      // the same aim algebra evaluate() uses at a live start: a cue with
      // no origin of its own holds the point in force
      const aimTo = cue.origin ?? aim ?? cue.centre ?? { x: 0, y: 0 };
      t.started = true;
      // passed is cleared so evaluate() re-applies this shot's still —
      // a track that had already passed under live play paints nothing
      t.passed = false;
      t.cameraFrom = { ...state };
      t.cameraTo = ChoreoRun.resolveCameraTo(cue, t.cameraFrom);
      t.aimFrom = aim ?? aimTo;
      t.aimTo = aimTo;
      aim = aimTo;
      if (now >= t.end) {
        state.x = t.cameraTo.x;
        state.y = t.cameraTo.y;
        state.zoom = t.cameraTo.zoom;
        t.cameraP = 1;
        // its flight is over: the inline still owns the frame again
        t.cameraAnimation?.cancel();
        t.cameraAnimation = undefined;
      }
    }
    this.camera = state;
    this.cameraAim = aim;
    // evaluate() repaints through every started track; only a seek that
    // leaves NO shot behind the playhead must put the frame back itself,
    // or the last-painted transform would stand at a time before any cue
    if (!cams.some((t) => t.started)) {
      this.applyCamera(cams[0]!);
    }
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
    const cue = t.cue.camera;
    if (!host || !from || !cue) {
      return;
    }
    const final: CameraState =
      t.cameraTo ?? ChoreoRun.resolveCameraTo(cue, from);
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
   * One frame of a derived value (§4.10): compose the context from the
   * pass's measurements, hand it to the author's function, write what
   * comes back.
   *
   * Nothing here touches the DOM — that is the design, not an
   * optimisation (docs/postmortem-follow.md). The resting boxes were
   * measured by the pass with every moved value released, and a source's
   * `now` is its resting box composed with the motion values driving it
   * this frame: JS-side numbers, not a measurement. So a follower is pure
   * BY CONSTRUCTION — there is no live box in reach, it cannot read back
   * its own output, and it cannot force a style recalculation in the
   * middle of a move. It is also correct under INTERRUPTION for free: a
   * replacement run's pass re-measures, so a run born mid-flight computes
   * from rests that are right immediately, with no "last frame" to
   * disagree with.
   *
   * `set`, not an animation: a derived value IS the frame, so there is
   * nothing to interpolate toward and nothing the compositor could be
   * given — this is the main-thread cost the step charges, and the reason
   * it is the same cost `c.Tether` already pays.
   */
  private drive(t: Track, now: number) {
    const derive = t.cue.derive;
    const ve = t.cue.sprite.node.visualElement;
    if (!derive || !ve) {
      return;
    }
    const sources: FollowSource[] = derive.sources.map(
      ({ from, sprite, to }) => {
        const sv = sprite.node.visualElement;
        const num = (key: string): number | undefined => {
          const value = sv?.getValue(key)?.get();
          return typeof value === 'number' ? value : undefined;
        };
        // composed about the centre (motion's default origin): a scaling
        // source reports the box it paints, not the box it laid out
        const sx = num('scaleX') ?? num('scale') ?? 1;
        const sy = num('scaleY') ?? num('scale') ?? 1;
        const width = to.width * sx;
        const height = to.height * sy;
        return {
          from,
          now: {
            height,
            width,
            x: to.x + (num('x') ?? 0) + (to.width - width) / 2,
            y: to.y + (num('y') ?? 0) + (to.height - height) / 2,
          },
          to,
        };
      },
    );
    const span = t.end - t.start;
    const values = derive.read({
      camera: { ...this.camera },
      p: span > 0 ? Math.max(0, Math.min(1, (now - t.start) / span)) : 1,
      rest: { ...derive.restBox },
      sources,
      t: now / 1000,
    });
    for (const [key, value] of Object.entries(values)) {
      ve.getValue(key, value)!.set(value);
    }
    // rendered NOW, not scheduled: a scheduled render lands in motion's
    // own render step, a hop later than the synchronous pin the move it
    // follows just did, and that hop is a visible one-frame flash.
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

  /**
   * The scale between the layer's own pixels and the screen's, per axis.
   *
   * A promotion reads client rects and writes LOCAL pixels, and every
   * transform above the region — a camera zoom, a page crossing carrying the
   * whole scene, any ancestor with a scale on it — sits between the two. Read
   * off the layer itself: its rect is what the screen shows, its offset size
   * is what its own coordinate system calls that. Dividing by the camera zoom
   * alone would catch the region's own transform and miss everything outside
   * it, which is the double-scale the tether draw already dodges by mapping
   * through the screen CTM.
   */
  private static layerScale(el: HTMLElement, box: DOMRect) {
    return {
      x: el.offsetWidth ? box.width / el.offsetWidth : 1,
      y: el.offsetHeight ? box.height / el.offsetHeight : 1,
    };
  }

  private promote(t: Track) {
    const layer = this.options.raisedLayer;
    const el = t.cue.sprite.element;
    if (!layer || !el.isConnected || t.perch) {
      return;
    }
    const box = el.getBoundingClientRect();
    const layerBox = layer.getBoundingClientRect();
    const s = ChoreoRun.layerScale(layer, layerBox);
    const width = box.width / s.x;
    const height = box.height / s.y;
    // the slot holds: siblings must not reflow under a lifted sprite
    const placeholder = document.createElement(el.tagName);
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.cssText = `visibility:hidden;width:${width}px;height:${height}px;margin:0;flex:none`;
    const prior = el.style.cssText;
    el.parentNode?.insertBefore(placeholder, el);
    layer.appendChild(el);
    el.style.position = 'absolute';
    el.style.left = `${(box.left - layerBox.left) / s.x}px`;
    el.style.top = `${(box.top - layerBox.top) / s.y}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
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
    // scrollTop/scrollLeft are LAYOUT pixels; the rect deltas carry every
    // transform above the container (the region's camera, a crossing
    // scaling the whole stage) and must have it divided back out — the
    // raise and the orphan lock live by the same rule
    const s = ChoreoRun.layerScale(container, cBox);
    const align = t.cue.scroll!.align;
    const offsetY = (box.top - cBox.top) / s.y + container.scrollTop;
    const offsetX = (box.left - cBox.left) / s.x + container.scrollLeft;
    const factor = align === 'center' ? 0.5 : align === 'end' ? 1 : 0;
    const to = {
      left: Math.max(
        0,
        offsetX - (container.clientWidth - box.width / s.x) * factor,
      ),
      top: Math.max(
        0,
        offsetY - (container.clientHeight - box.height / s.y) * factor,
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
      const times = cue.transition?.times as number[] | undefined;
      const segmentEase = cssEasing(
        cue.transition?.ease as Easing | undefined,
        cycle,
      );
      t.loopAnimation = el.animate(
        keyframesOf(cue.target ?? {}, times, segmentEase),
        {
          duration: Math.max(1, cycle),
          easing: times ? 'linear' : segmentEase,
          iterations: Infinity,
        },
      );
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
      | (Record<string, unknown> & { ease?: unknown })
      | undefined;
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
      | (Record<string, unknown> & { ease?: unknown; type?: string })
      | undefined;
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
        const times = Array.isArray(raw)
          ? (transition?.times as number[] | undefined)
          : undefined;
        const eased = ease ? ease(p) : p;
        const segments = numeric.length - 1;
        const at = Math.min(segments - 1e-9, eased * segments);
        const index = times
          ? p >= 1
            ? segments - 1
            : Math.max(0, times.findIndex((time) => time > p) - 1)
          : Math.max(0, Math.floor(at));
        const progress = times
          ? p >= 1
            ? 1
            : (p - times[index]!) / (times[index + 1]! - times[index]!)
          : at - index;
        const local = times && ease ? ease(progress) : progress;
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
    // a cancelled run's queued commands die with it: the replacement run
    // re-derives the commanded state from its own clock
    this.pendingPerforms.length = 0;
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
