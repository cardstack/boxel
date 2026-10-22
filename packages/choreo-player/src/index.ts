/** The structural part of a public Choreo run that the player controls. */
export interface ChoreoRun {
  readonly duration: number;
  pause(): void;
  play(): void;
  speed: number;
  time: number;
}

export interface ChoreoPlayer {
  readonly duration: number;
  readonly isPlaying: boolean;
  pause(): void;
  play(): Promise<void>;
  readonly playbackRate: number;
  renderAt(
    timeSeconds: number,
    options?: ChoreoPlayerUpdateOptions,
  ): Promise<void>;
  setPlaybackRate(rate: number): void;
  sync(options?: ChoreoPlayerUpdateOptions): Promise<void>;
  readonly time: number;
}

export interface ChoreoPlayerUpdateOptions {
  /** Skip host settling when an external renderer supplies a stronger barrier. */
  settle?: boolean;
}

export interface ChoreoPlayerOptions {
  /** An optional composition duration. Without one, the longest run wins. */
  duration?: number | (() => number);
  /** One-time hook that makes the host mount/compile its externally driven run. */
  prepare?: () => PromiseLike<void> | void;
  /** Explicitly owned runs. The provider is read again for every operation. */
  runs: () => Iterable<ChoreoRun>;
  /** Host readiness hook. Defaults to two post-render browser frames. */
  settle?: () => PromiseLike<void> | void;
}

const finiteDuration = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

const finiteTime = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const finiteRate = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 1;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      queueMicrotask(resolve);
    }
  });
}

async function settleChoreoStill(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

/** A headless transport for one or more explicitly owned Choreo runs. */
class DefaultChoreoPlayer implements ChoreoPlayer {
  private currentTime = 0;
  private playing = false;
  private preparation: Promise<void> | null = null;
  private prepared = false;
  private rate = 1;
  private updateGeneration = 0;
  private options: ChoreoPlayerOptions;

  constructor(options: ChoreoPlayerOptions) {
    this.options = options;
  }

  get duration(): number {
    const explicit = this.options.duration;
    if (typeof explicit === 'function') {
      return finiteDuration(explicit());
    }
    if (explicit !== undefined) {
      return finiteDuration(explicit);
    }
    return Math.max(0, ...this.runs().map((run) => run.duration));
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get playbackRate(): number {
    return this.rate;
  }

  get time(): number {
    if (this.playing) {
      const times = this.runs().map((run) => run.time);
      if (times.length) {
        return Math.max(...times);
      }
    }
    return this.currentTime;
  }

  pause(): void {
    const runs = this.runs();
    if (this.playing && runs.length) {
      this.currentTime = this.clamp(Math.max(...runs.map((run) => run.time)));
    }
    this.playing = false;
    for (const run of runs) {
      run.pause();
    }
  }

  async play(): Promise<void> {
    this.playing = true;
    try {
      await this.prepare();
    } catch (error) {
      this.playing = false;
      throw error;
    }
    if (!this.playing) {
      return;
    }
    this.playRuns();
  }

  async renderAt(
    timeSeconds: number,
    options: ChoreoPlayerUpdateOptions = {},
  ): Promise<void> {
    const generation = ++this.updateGeneration;
    this.playing = false;
    this.currentTime = this.clamp(timeSeconds);
    await this.prepare();
    if (generation !== this.updateGeneration) {
      return;
    }
    for (const run of this.runs()) {
      run.pause();
      run.speed = this.rate;
      run.time = Math.min(this.currentTime, run.duration);
    }
    if (options.settle !== false) {
      await this.settle();
    }
  }

  setPlaybackRate(rate: number): void {
    this.rate = finiteRate(rate);
    for (const run of this.runs()) {
      run.speed = this.rate;
    }
  }

  /** Apply current time and transport state after the host mounts a new run. */
  async sync(options: ChoreoPlayerUpdateOptions = {}): Promise<void> {
    await this.prepare();
    const runs = this.runs();
    for (const run of runs) {
      run.pause();
      run.speed = this.rate;
      run.time = Math.min(this.currentTime, run.duration);
    }
    if (options.settle !== false) {
      await this.settle();
    }
    if (this.playing) {
      for (const run of runs) {
        run.play();
      }
    }
  }

  private clamp(value: number): number {
    const time = finiteTime(value);
    const duration = this.duration;
    return duration > 0 ? Math.min(time, duration) : time;
  }

  private prepare(): Promise<void> {
    if (this.prepared) {
      return Promise.resolve();
    }
    if (this.preparation) {
      return this.preparation;
    }
    let result: PromiseLike<void> | void;
    try {
      result = this.options.prepare?.();
    } catch (error) {
      return Promise.reject(error);
    }
    if (!result || typeof result.then !== 'function') {
      this.prepared = true;
      return Promise.resolve();
    }
    this.preparation = Promise.resolve(result).then(
      () => {
        this.prepared = true;
        this.preparation = null;
      },
      (error: unknown) => {
        this.preparation = null;
        throw error;
      },
    );
    return this.preparation;
  }

  private playRuns(): void {
    for (const run of this.runs()) {
      run.speed = this.rate;
      run.play();
    }
  }

  private runs(): ChoreoRun[] {
    return [...this.options.runs()];
  }

  private settle(): Promise<void> {
    return Promise.resolve((this.options.settle ?? settleChoreoStill)());
  }
}

export function createChoreoPlayer(options: ChoreoPlayerOptions): ChoreoPlayer {
  return new DefaultChoreoPlayer(options);
}
