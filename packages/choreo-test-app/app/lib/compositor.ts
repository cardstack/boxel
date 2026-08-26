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
 * replay the prefix; parameters accept continuous values.
 */
export interface ActorPorts {
  actions?: Record<string, (payload?: unknown) => PromiseLike<void> | void>;
  parameters?: Record<string, (value: number) => void>;
  reset?: () => PromiseLike<void> | void;
}

/** Read-only, serializable inspection data (for tests and future cards). */
export interface CompositionSnapshot {
  actors: string[];
  appliedCues: TimedCue[];
  duration: number;
  recentActions: SemanticAction[];
  time: number;
}

export interface CompositorOptions {
  automations: Automation[];
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
  private readonly recent: SemanticAction[] = [];
  private readonly player: { renderAt(t: number, o?: object): Promise<void> };

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
   * Fold cues and parameters through `t` — state only, no run transport.
   * Live preview shares this with the capture path, so the two can never
   * disagree about what the composition looks like at a time.
   */
  async foldTo(time: number): Promise<void> {
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
    for (const auto of this.options.automations) {
      if (auto.from !== undefined && time < auto.from) {
        continue;
      }
      this.ports.get(auto.target)?.parameters?.[auto.name]?.(auto.sample(time));
    }
    this.lastTime = time;
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
