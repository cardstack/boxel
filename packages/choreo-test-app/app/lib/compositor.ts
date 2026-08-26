/**
 * The C1 composition host (docs/choreo-composition.md, Phase C1) —
 * application-side code on purpose. It owns the scene-level model a
 * directed composition needs and consumes only public surfaces:
 * `choreo-player` for the run transport, and actor "ports" the
 * application registers against stable addresses.
 *
 * The contract in one sentence: the composition is a function of time.
 * Timed cues are semantic commands folded through `t` — never callbacks,
 * never remembered coordinates — so `renderAt(8.9)` on a fresh page
 * produces the same state as playing there. The fold is diff-aware:
 * monotonically increasing seeks apply only the cues newly crossed (a
 * capture worker walking frames pays nothing), while a backward seek
 * resets every actor that owns a reset port and replays the remaining
 * prefix, because a semantic command cannot be un-executed — only
 * re-derived from zero.
 *
 * Deliberately absent, per the doc's review gates: no scene graph, no
 * planes registry, no clips, no journal. Those arrive only after a
 * composition demonstrates the need.
 */
import { createChoreoPlayer } from 'choreo-player';

/** The structural run contract the player drives (a public ChoreoRun fits). */
export interface CompositorRun {
  readonly duration: number;
  pause(): void;
  play(): void;
  speed: number;
  time: number;
}

export interface SemanticAction {
  action: string;
  payload?: unknown;
  target: string;
}

/** A semantic command attached to the composition clock. */
export interface TimedCue extends SemanticAction {
  at: number;
}

/** A continuous parameter channel: target port ← sample(t). */
export interface Automation {
  /** apply only from this composition time on (default: always) */
  from?: number;
  name: string;
  sample: (time: number) => number;
  target: string;
}

/**
 * What an actor offers the composition. Actions receive the cue payload;
 * `reset` returns the actor to its pre-cue rest so a backward fold can
 * replay the prefix; parameters accept continuous values; `presence` is
 * how a clip mounts and unmounts the actor's subtree (the port receives
 * only CHANGES, so a tracked flip behind it is cheap).
 */
export interface ActorPorts {
  actions?: Record<string, (payload?: unknown) => PromiseLike<void> | void>;
  parameters?: Record<string, (value: number) => void>;
  presence?: (present: boolean) => void;
  reset?: () => PromiseLike<void> | void;
}

/**
 * A clip: an activation and a source-time window over one actor
 * (docs/choreo-composition.md, Phase C3). Pure parent→source arithmetic:
 *
 *   source = sourceIn + (parent − at) × rate
 *   window = (sourceOut − sourceIn) / rate  seconds of parent time
 *
 * Before `at` the actor is absent; inside the window it is present and
 * its named parameter port receives source time; past the window the end
 * policy applies — `remove` unmounts (the default), `hold` stays mounted
 * standing at the edited `sourceOut` sample, `freeze` stays mounted and
 * writes nothing further. Every state is re-derived from `t` on every
 * fold, never discovered by playing from zero.
 */
export interface ClipSpec {
  at: number;
  end?: 'freeze' | 'hold' | 'remove';
  id: string;
  /** which parameter port receives source-local time (default 'time') */
  parameter?: string;
  rate?: number;
  sourceIn?: number;
  sourceOut: number;
  target: string;
}

/** Read-only, serializable inspection data (for tests and future cards). */
export interface CompositionSnapshot {
  actors: string[];
  appliedCues: TimedCue[];
  clips: { id: string; state: ClipState }[];
  duration: number;
  recentActions: SemanticAction[];
  time: number;
}

export type ClipState = 'absent' | 'active' | 'frozen' | 'held';

export interface CompositorOptions {
  automations: Automation[];
  clips?: ClipSpec[];
  cues: TimedCue[];
  duration: number;
  /** mount/compile the scored pass before the first external seek */
  prepare?: () => PromiseLike<void> | void;
  /** the runs this composition explicitly owns — never a global registry */
  runs: () => CompositorRun[];
  /** resolve when Glimmer and layout are ready to be sampled again */
  settle?: () => PromiseLike<void> | void;
}

export class Compositor {
  private readonly options: CompositorOptions;
  private readonly cues: TimedCue[];
  private readonly ports = new Map<string, ActorPorts>();
  private applied = 0; // cues[0..applied) are folded into current state
  private lastTime = 0;
  private readonly clipPresence = new Map<string, boolean>();
  private readonly clipStates = new Map<string, ClipState>();
  private readonly recent: SemanticAction[] = [];
  private readonly player: {
    pause(): void;
    renderAt(t: number, o?: object): Promise<void>;
  };

  constructor(options: CompositorOptions) {
    this.options = options;
    this.cues = [...options.cues].sort((a, b) => a.at - b.at);
    this.player = createChoreoPlayer({
      duration: options.duration,
      prepare: options.prepare,
      runs: options.runs,
    });
  }

  /** Register an actor's ports at a stable address; returns unregister. */
  register(address: string, ports: ActorPorts): () => void {
    this.ports.set(address, ports);
    return () => {
      if (this.ports.get(address) === ports) {
        this.ports.delete(address);
      }
    };
  }

  get duration(): number {
    return this.options.duration;
  }

  get snapshot(): CompositionSnapshot {
    return {
      actors: [...this.ports.keys()],
      appliedCues: this.cues.slice(0, this.applied),
      clips: (this.options.clips ?? []).map((c) => ({
        id: c.id,
        state: this.clipStates.get(c.id) ?? 'absent',
      })),
      duration: this.options.duration,
      recentActions: [...this.recent],
      time: this.lastTime,
    };
  }

  /** Dispatch a discrete semantic action through its port, now. */
  send(action: SemanticAction): void {
    const ports = this.ports.get(action.target);
    if (!ports) {
      throw new Error(`Compositor: no actor registered as "${action.target}"`);
    }
    const port = ports.actions?.[action.action];
    if (!port) {
      throw new Error(
        `Compositor: actor "${action.target}" has no action "${action.action}"`
      );
    }
    this.recent.push(action);
    if (this.recent.length > 32) {
      this.recent.shift();
    }
    void port(action.payload);
  }

  /** Write a continuous value straight through a parameter port. */
  setParameter(target: string, name: string, value: number): void {
    const port = this.ports.get(target)?.parameters?.[name];
    if (!port) {
      throw new Error(
        `Compositor: actor "${target}" has no parameter "${name}"`
      );
    }
    port(value);
  }

  /**
   * Fold cues (and, by default, parameters) through `t` — state only, no
   * run transport. Live preview shares this with the capture path, so the
   * two can never disagree about which commands have happened by a time.
   * Preview passes `parameters: false`: a parameter channel is capture
   * reconstruction — it stands a demo's own engine at a still, which
   * would fight the very playback the preview exists to show. play() is
   * GPU; renderAt(t) is a still (docs/choreo-composition.md, scope
   * decisions).
   */
  async foldTo(
    time: number,
    options?: { parameters?: boolean }
  ): Promise<void> {
    const target = this.countAt(time);
    if (target < this.applied) {
      // backward across at least one cue: commands cannot be un-executed,
      // so every resettable actor returns to rest and the prefix replays
      for (const ports of this.ports.values()) {
        await ports.reset?.();
      }
      this.applied = 0;
    }
    while (this.applied < target) {
      const cue = this.cues[this.applied]!;
      this.applied += 1;
      const port = this.ports.get(cue.target)?.actions?.[cue.action];
      if (!port) {
        throw new Error(
          `Compositor: cue at ${cue.at}s addresses "${cue.target}.${cue.action}", which is not registered`
        );
      }
      await port(cue.payload);
    }
    for (const clip of this.options.clips ?? []) {
      const ports = this.ports.get(clip.target);
      if (!ports) {
        throw new Error(
          `Compositor: clip "${clip.id}" addresses "${clip.target}", which is not registered`
        );
      }
      const rate = clip.rate ?? 1;
      const sourceIn = clip.sourceIn ?? 0;
      const window = (clip.sourceOut - sourceIn) / rate;
      let state: ClipState;
      let sample: number | null;
      if (time < clip.at) {
        state = 'absent';
        sample = null;
      } else if (time < clip.at + window) {
        state = 'active';
        sample = sourceIn + (time - clip.at) * rate;
      } else {
        const end = clip.end ?? 'remove';
        state =
          end === 'hold' ? 'held' : end === 'freeze' ? 'frozen' : 'absent';
        sample = end === 'hold' ? clip.sourceOut : null;
      }
      this.clipStates.set(clip.id, state);
      const present = state !== 'absent';
      if (this.clipPresence.get(clip.id) !== present) {
        this.clipPresence.set(clip.id, present);
        ports.presence?.(present);
      }
      // presence is structure and folds in every mode; SEEKING an actor's
      // engine is capture reconstruction, so preview skips it
      if (sample !== null && options?.parameters !== false) {
        ports.parameters?.[clip.parameter ?? 'time']?.(sample);
      }
    }
    if (options?.parameters !== false) {
      for (const auto of this.options.automations) {
        if (auto.from !== undefined && time < auto.from) {
          continue;
        }
        this.ports
          .get(auto.target)
          ?.parameters?.[auto.name]?.(auto.sample(time));
      }
    }
    this.lastTime = time;
  }

  /** Hand the transport back (teardown, or a preview reclaiming its runs). */
  pause(): void {
    this.player.pause();
  }

  /**
   * The whole transaction: stand every owned run at `t`, fold application
   * state through `t`, let Glimmer commit it, then reassert the runs on
   * the DOM that will actually be sampled.
   */
  async renderAt(time: number): Promise<void> {
    const t = Math.max(0, Math.min(time, this.options.duration));
    await this.player.renderAt(t, { settle: false });
    await this.foldTo(t);
    await this.options.settle?.();
    await this.player.renderAt(t, { settle: false });
  }

  private countAt(time: number): number {
    let n = 0;
    while (n < this.cues.length && this.cues[n]!.at <= time) {
      n += 1;
    }
    return n;
  }
}

export function createCompositor(options: CompositorOptions): Compositor {
  return new Compositor(options);
}
