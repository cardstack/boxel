import { array } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { ChoreoRun } from 'glimmer-motion';
import { Choreo, motion } from 'glimmer-motion';
import { BuildOrder } from 'test-app/components/examples/build-order';
import { Inbox } from 'test-app/components/examples/inbox';
import { Lightbox } from 'test-app/components/examples/lightbox';
import { LowerThird } from 'test-app/components/reel/lower-third';
import { createCompositor } from 'test-app/lib/compositor';

const DURATION = 15;
/**
 * The genre's curve, not the app's: recorded motion glides — a long,
 * symmetric ease with soft ends — where interactive motion snaps and
 * bounces. The demos inside the frame keep their own snappy springs
 * (they ARE the product); this curve belongs to the editorial layer,
 * the camera and the titles.
 */
const GLIDE = [0.65, 0, 0.35, 1] as const;
/** the clock plane's pulse returns exactly whence it came */
const UNPULSE = 1 / 1.3;

/** SMPTE timecode at the composition's 60fps: HH:MM:SS:FF */
const timecode = (t: number): string => {
  // derive from whole frames, not float remainders: 5.1 % 1 is
  // 0.0999…964, and a floor there drops a frame the clock never skipped
  const frames = Math.round(Math.max(0, t) * 60);
  const f = frames % 60;
  const sec = Math.floor(frames / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}:${pad(f)}`;
};

interface SeekableDemoElement extends HTMLElement {
  seekDemo?: (time: number) => PromiseLike<void> | void;
}

interface BuildOrderElement extends HTMLElement {
  buildOrder?: { scrub(event: Event): void };
}

/** New editorial shell; the subjects are the gallery's real demos. */
export class FeatureReel extends Component {
  @tracked take = 0;
  /** the opening plate: mounted by the poster clip's presence fold */
  @tracked poster = true;
  private root?: HTMLElement;
  private c?: { run: ChoreoRun | null };
  private t?: { run: ChoreoRun | null };
  private b?: { run: ChoreoRun | null };
  private k?: { run: ChoreoRun | null };
  private score: ChoreoRun | null = null;
  private titleScore: ChoreoRun | null = null;
  private brandScore: ChoreoRun | null = null;
  private clockScore: ChoreoRun | null = null;
  private externallyDriven = false;
  private raf = 0;
  /** the preview's own clock: clamped per-frame deltas, so a hidden tab
   * (where rAF stalls but wall time marches) pauses instead of skipping */
  private previewClock = 0;
  private lastTick = 0;
  private resolveReady!: () => void;
  private ready = new Promise<void>((resolve) => (this.resolveReady = resolve));

  /**
   * The composition host (docs/choreo-composition.md, Phase C1). Cues are
   * idempotent semantic commands folded through the composition clock in
   * BOTH modes; parameter channels are capture-only reconstruction — in
   * preview the demos play their own engines.
   */
  private compositor = createCompositor({
    automations: [{ name: 'time', sample: (t: number) => t, target: 'clock' }],
    // the reel's editorial structure IS clips now: each demo take is a
    // declared source-time window instead of a hand-rolled offset, and
    // the poster is the hard cut — a plate that opens the film and cuts
    // to the picture as the first camera move begins
    clips: [
      { at: 0, id: 'poster', sourceOut: 0.45, target: 'poster' },
      {
        at: 0.55,
        end: 'hold',
        id: 'lightbox-take',
        sourceOut: 2.9,
        target: 'lightbox',
      },
      {
        at: 3.45,
        end: 'hold',
        id: 'inbox-take',
        sourceOut: 3.0,
        target: 'inbox',
      },
      {
        at: 7.3,
        end: 'hold',
        id: 'build-take',
        parameter: 'progress',
        sourceOut: 7.7,
        target: 'build',
      },
    ],
    cues: [
      { action: 'photo.open', at: 0.55, payload: 3, target: 'lightbox' },
      { action: 'compose', at: 4.35, target: 'inbox' },
    ],
    duration: DURATION,
    prepare: () => this.prepareScore(),
    runs: () => {
      // Child demos legitimately cause either region to publish a
      // replacement all-kept run. Always drive the runs the regions
      // currently own; identity-pinning here once made the capture
      // silently stop seeking the camera after the first demo updated.
      const runs: ChoreoRun[] = [];
      const world = this.c?.run ?? this.score;
      if (world) {
        if (world !== this.score) {
          world.pause();
          this.score = world;
        }
        runs.push(world);
      }
      const titles = this.t?.run ?? this.titleScore;
      if (titles) {
        if (titles !== this.titleScore) {
          titles.pause();
          this.titleScore = titles;
        }
        runs.push(titles);
      }
      const brand = this.b?.run ?? this.brandScore;
      if (brand) {
        if (brand !== this.brandScore) {
          brand.pause();
          this.brandScore = brand;
        }
        runs.push(brand);
      }
      const clock = this.k?.run ?? this.clockScore;
      if (clock) {
        if (clock !== this.clockScore) {
          clock.pause();
          this.clockScore = clock;
        }
        runs.push(clock);
      }
      return runs;
    },
    // cue-driven state is ordinary tracked state; two macrotasks let
    // Glimmer commit it before the closing reassertion seek. Not rAF on
    // purpose: the capture barrier must never depend on the frame pump.
    settle: () =>
      new Promise<void>((resolve) => {
        setTimeout(() => setTimeout(resolve, 0), 0);
      }),
  });

  /**
   * Sidecar ports: the composition speaks to each demo through the same
   * controls a person clicks. Every action is an ENSURE, never a toggle —
   * a replayed fold must be able to hit a port twice without doubling.
   */
  private installPorts() {
    const q = <T extends HTMLElement>(sel: string) =>
      this.root?.querySelector<T>(sel) ?? null;
    this.compositor.register('lightbox', {
      actions: {
        'photo.open': (index) => {
          if (!q('.reel-lightbox .overlay')) {
            this.root
              ?.querySelectorAll<HTMLButtonElement>('.reel-lightbox .shot')
              [Number(index)]?.click();
          }
        },
      },
      parameters: {
        time: (v) =>
          void q<SeekableDemoElement>('.reel-lightbox .ex')?.seekDemo?.(v),
      },
      reset: () =>
        q<HTMLButtonElement>('.reel-lightbox .lightbox-close')?.click(),
    });
    this.compositor.register('inbox', {
      actions: {
        compose: () => {
          // ensure the composed row exists; the demo seeds three
          const rows =
            this.root?.querySelectorAll('.reel-beacons .mail').length ?? 0;
          if (rows <= 3) {
            q<HTMLButtonElement>('.reel-beacons .inbox-compose')?.click();
          }
        },
      },
      parameters: {
        time: (v) =>
          void q<SeekableDemoElement>('.reel-beacons .ex')?.seekDemo?.(v),
      },
      reset: () => {
        // the composed row goes back out the way everything here moves:
        // through the demo's own delete control, flight and all
        this.root
          ?.querySelectorAll<HTMLElement>('.reel-beacons .mail')[3]
          ?.querySelector<HTMLButtonElement>('button')
          ?.click();
      },
    });
    this.compositor.register('poster', {
      presence: (present) => {
        if (this.poster !== present) {
          this.poster = present;
        }
      },
    });
    this.compositor.register('clock', {
      parameters: {
        time: (v) => this.paintClock(v),
      },
    });
    this.compositor.register('build', {
      parameters: {
        progress: (v) =>
          q<BuildOrderElement>('.reel-build .bo-stage')?.buildOrder?.scrub({
            target: { value: String(v) },
          } as unknown as Event),
      },
    });
  }

  private async prepareScore() {
    if (this.take === 0) {
      this.take++;
    }
    for (let frame = 0; frame < 120 && !this.score; frame++) {
      const run = this.c?.run;
      if (run) {
        this.score = run;
        run.pause();
        this.resolveReady();
        break;
      }
      // HyperFrames' first frame is waiting on this barrier, so readiness
      // cannot itself wait for a browser frame. This timer is only a mount
      // poll; all authored sequencing remains in c.Sequence.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!this.score) {
      await this.ready;
    }
  }

  wire = modifier((_el: Element, [c]: [{ run: ChoreoRun | null }, number]) => {
    this.c = c;
  });

  wireTitles = modifier(
    (_el: Element, [t]: [{ run: ChoreoRun | null }, number]) => {
      this.t = t;
    }
  );

  wireBrand = modifier(
    (_el: Element, [b]: [{ run: ChoreoRun | null }, number]) => {
      this.b = b;
    }
  );

  wireClock = modifier(
    (_el: Element, [k]: [{ run: ChoreoRun | null }, number]) => {
      this.k = k;
    }
  );

  register = modifier((el: HTMLElement) => {
    this.root = el;
    const shell = el.closest<HTMLElement>('.app-shell');
    shell?.setAttribute('data-layout-ignore', '');
    Object.defineProperty(el, 'choreoReel', {
      configurable: true,
      value: this,
    });
    (window as Window & { __choreoReel?: FeatureReel }).__choreoReel = this;
    el.dataset.captureHandle = 'ready';
    this.installPorts();
    if (
      (window as Window & { __choreoRecording?: boolean }).__choreoRecording
    ) {
      // a recorder owns this page from birth: the first render plays
      // nothing (docs/demo-recording.md) — no preview clock ever starts,
      // no cue fires on wall time, and the score mounts through the
      // player's own prepare barrier when the first seek arrives
      this.externallyDriven = true;
      return;
    }
    requestAnimationFrame(() => {
      if (!this.isDestroying && this.take === 0) {
        this.take++;
      }
    });
    this.raf ||= requestAnimationFrame(this.tick);
    // The handle belongs to this private route's element. Leaving it attached
    // also survives modifier teardown/reinstall around Glimmer render passes;
    // the element itself becomes unreachable when the route is removed.
  });

  /**
   * Live preview: the runs PLAY — play() is GPU, renderAt(t) is a still
   * (docs/choreo-composition.md, scope decisions). This clock only fires
   * cues through the same fold capture uses, and retimes a newly compiled
   * replacement run to the composition clock ONCE; it never pauses or
   * seeks a run that is already playing.
   */
  private tick = () => {
    if (this.externallyDriven || this.isDestroying) {
      return;
    }
    const nowMs = performance.now();
    const dt = this.lastTick
      ? Math.min((nowMs - this.lastTick) / 1000, 0.1)
      : 0;
    this.lastTick = nowMs;
    this.previewClock += dt;
    if (this.previewClock >= DURATION + 1.2) {
      // the film loops: hold the lockup a beat, fold the commands home
      // (the lightbox closes, the composed row goes back out through the
      // demo's own delete), and a take bump compiles every plane a fresh
      // score — the same first-render-plays-nothing rule as a new visit
      this.previewClock = 0;
      void this.compositor.foldTo(0, { parameters: false });
      this.take++;
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const previewTime = Math.min(DURATION, this.previewClock);
    this.adoptForPreview(this.c?.run ?? null, 'score', previewTime);
    this.adoptForPreview(this.t?.run ?? null, 'titleScore', previewTime);
    this.adoptForPreview(this.b?.run ?? null, 'brandScore', previewTime);
    this.adoptForPreview(this.k?.run ?? null, 'clockScore', previewTime);
    this.paintClock(previewTime);
    void this.compositor.foldTo(previewTime, { parameters: false });
    if (this.root) {
      this.root.dataset.scoreTime = previewTime.toFixed(3);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private paintClock(t: number) {
    const tc = this.root?.querySelector('.reel-clock-tc');
    if (tc) {
      // the last frame of a 15s/60fps film is 14:59f59 — a clock that
      // reads 15:00 names a frame the film does not have
      tc.textContent = timecode(Math.min(t, DURATION - 1 / 60));
    }
  }

  private adoptForPreview(
    run: ChoreoRun | null,
    key: 'brandScore' | 'clockScore' | 'score' | 'titleScore',
    previewTime: number
  ) {
    if (!run || run === this[key]) {
      return;
    }
    this[key] = run;
    this.resolveReady();
    if (this.root && key === 'score') {
      this.root.dataset.scoreDuration = String(run.duration);
    }
    // a replacement run compiles parked at ITS zero mid-film: retime it to
    // the composition clock once, then hand it back its own clock
    if (previewTime > 0.05 && previewTime < run.duration) {
      run.time = previewTime;
    }
    run.play();
  }

  /** HyperFrames' transaction: one call stands the composition at `t`. */
  async renderAt(time: number) {
    this.externallyDriven = true;
    cancelAnimationFrame(this.raf);
    // The host's prepare barrier (prepareScore) bumps the take and polls
    // for the compiled score, so an opening seek that arrives before the
    // first browser frame waits for the mount instead of painting nothing.
    await this.compositor.renderAt(time);
    if (this.root) {
      this.root.dataset.scoreTime = String(this.score?.time ?? -1);
      this.root.dataset.scoreDuration = String(this.score?.duration ?? -1);
      (this.root as HTMLElement & { choreoRun?: ChoreoRun }).choreoRun =
        this.score ?? undefined;
      this.root.dataset.captureTrace = `t:${String(this.score?.time ?? -1)}`;
    }
  }

  willDestroy() {
    super.willDestroy();
    if (this.root) {
      this.root.dataset.featureReelDestroyed = 'yes';
    }
    cancelAnimationFrame(this.raf);
    this.resolveReady();
    this.compositor.pause();
    delete (window as Window & { __choreoReel?: FeatureReel }).__choreoReel;
    this.root
      ?.closest<HTMLElement>('.app-shell')
      ?.removeAttribute('data-layout-ignore');
    this.root = undefined;
  }

  <template>
    <div class="reel-viewport" {{this.register}}>
      <Choreo class="reel-world" @quiet={{true}} as |c|>
        <section
          class="reel-scene reel-lightbox"
          data-take={{this.take}}
          {{motion id="reel-lightbox-scene" role="scene"}}
          {{this.wire c this.take}}
        >
          <header class="reel-kicker"><span>01</span><p>Lightbox</p></header>
          <div class="reel-demo-asset is-lightbox"><Lightbox /></div>
          <div
            class="reel-camera-target lightbox-aim"
            {{motion id="reel-lightbox-aim"}}
          ></div>
          <p class="reel-proof">The real layoutId demo</p>
        </section>
        <section
          class="reel-scene reel-beacons"
          {{motion id="reel-beacons-scene" role="scene"}}
        >
          <header class="reel-kicker"><span>02</span><p>Beacons</p></header>
          <div class="reel-demo-asset is-inbox"><Inbox /></div>
          <div
            class="reel-camera-target beacon-aim"
            {{motion id="reel-beacon-aim"}}
          ></div>
          <p class="reel-proof">The real Compose control</p>
        </section>
        <section
          class="reel-scene reel-build"
          {{motion id="reel-build-scene" role="scene"}}
        >
          <header class="reel-kicker"><span>03</span><p>Build Order</p></header>
          <div class="reel-demo-asset is-build"><BuildOrder /></div>
          <div
            class="reel-camera-target build-logo-aim"
            {{motion id="reel-build-logo-aim"}}
          ></div>
          <div
            class="reel-camera-target build-panel-aim"
            {{motion id="reel-build-panel-aim"}}
          ></div>
        </section>

        {{! the natural authoring contract: a move, then a wait. Every
            wait here once had to be a constant-easing camera duplicate so a
            random-access seek would land on the pose — the workaround
            docs/external-clock-camera-seek-handoff.md records. The score
            staying Wait-based IS the proof the transport reconstructs. }}
        <c.Sequence>
          <c.Frame
            @of={{c.id "reel-lightbox-scene"}}
            @padding={{1}}
            @duration={{0.01}}
          />
          <c.Wait @duration={{0.44}} />
          <c.Frame
            @of={{c.id "reel-lightbox-aim"}}
            @padding={{0.82}}
            @duration={{1}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{1.2}} />
          <c.Frame
            @of={{c.id "reel-beacons-scene"}}
            @padding={{1}}
            @duration={{1.15}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{0.55}} />
          <c.Frame
            @of={{c.id "reel-beacon-aim"}}
            @padding={{0.84}}
            @duration={{1}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{1.1}} />
          <c.Frame
            @of={{c.id "reel-build-scene"}}
            @padding={{1}}
            @duration={{1.2}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{0.1}} />
          <c.Frame
            @of={{c.id "reel-build-logo-aim"}}
            @padding={{0.82}}
            @duration={{1}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{1}} />
          <c.Frame
            @of={{c.id "reel-build-panel-aim"}}
            @padding={{0.8}}
            @duration={{1.05}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{1}} />
          <c.Frame
            @of={{c.id "reel-build-logo-aim"}}
            @padding={{0.82}}
            @duration={{1.1}}
            @ease={{GLIDE}}
          />
          {{! the hold gets its life from a push-in: 5% over the whole
              lockup, toward the aim in force — the logo }}
          <c.SlowZoom @by={{1.05}} @duration={{2.1}} @ease={{GLIDE}} />
        </c.Sequence>
      </Choreo>

      {{! The brand plane: poster → corner chip is a CROSSING, not a cut.
          One region, one identity — the boundary fold flips both clips in
          a single render pass, the changeset pairs the removed wordmark
          with the inserted chip, and the flight is part of this plane's
          own seekable score. The plate leaves as an ordinary removed
          sprite the score fades. }}
      <Choreo
        class="reel-plane reel-brand"
        data-plane="brand"
        @quiet={{true}}
        as |b|
      >
        <div
          class="reel-brand-strip"
          data-take={{this.take}}
          {{this.wireBrand b this.take}}
        >
          {{#if this.poster}}
            <div class="reel-poster" {{motion id="poster-plate" role="plate"}}>
              <span class="reel-poster-rule" aria-hidden="true"></span>
              <p class="reel-poster-word" {{motion id="brand" role="brand"}}>
                Choreo
              </p>
              <p class="reel-poster-tag">Motion. Choreographed.</p>
            </div>
          {{else}}
            <div class="reel-brand-chip">
              <span
                class="reel-brand-mark"
                {{motion id="brand" role="brand"}}
              >Choreo</span>
            </div>
          {{/if}}
        </div>
        <b.Sequence>
          <b.Wait @duration={{0.45}} />
          <b.Parallel>
            {{! move-only: display type cannot hold proportions across a
                6.5× FLIP — the mark condenses into the corner instead of
                stretching a texture across the frame }}
            {{! quick: the engine crossfades the outgoing word across the
                flight at its natural size — a 0.4s flight makes that a
                flash of type instead of a passenger }}
            <b.Move
              @of={{b.received "brand"}}
              @size={{false}}
              @duration={{0.4}}
              @ease={{GLIDE}}
            />
            <b.Tween
              @of={{b.removed "plate"}}
              @opacity={{array 1 0}}
              @duration={{0.3}}
              @ease={{GLIDE}}
            />
          </b.Parallel>
        </b.Sequence>
      </Choreo>

      {{! The title plane: its own Choreo region, a sibling of the camera'd
          world — viewport-anchored typography the demo camera cannot drag.
          Its fade is a plain tween on the plane's actors: the experiment
          that keeps the addressable control channel unbuilt. }}
      <Choreo
        class="reel-plane reel-titles"
        data-plane="titles"
        @quiet={{true}}
        as |lt|
      >
        <div
          class="reel-titles-strip"
          data-take={{this.take}}
          {{this.wireTitles lt this.take}}
        >
          <LowerThird
            @id="lt-lightbox"
            @variant="feature"
            @label="01 · Lightbox"
            @title="Magic move, for real"
            @detail="The gallery's layoutId demo, live"
          />
          <LowerThird
            @id="lt-beacons"
            @variant="feature"
            @label="02 · Beacons"
            @title="A point, not an identity"
            @detail="Compose flies from the real button"
          />
          <LowerThird
            @id="lt-build"
            @variant="feature"
            @label="03 · Build Order"
            @title="Nine cues, one logo"
            @detail="Scored, scrubbed, interruptible"
          />
          <LowerThird
            @id="lt-logo"
            @variant="proof"
            @label="Choreo"
            @title="Motion. Choreographed."
          />
        </div>
        <lt.Sequence>
          {{! the first third holds for the poster: type enters AFTER the
              cut, never underneath the plate }}
          <lt.Wait @duration={{0.55}} />
          <lt.Tween
            @of={{lt.id "lt-lightbox"}}
            @opacity={{array 0 1}}
            @y={{array 24 0}}
            @duration={{0.55}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{1.2}} />
          <lt.Tween
            @of={{lt.id "lt-lightbox"}}
            @opacity={{array 1 0}}
            @y={{array 0 -14}}
            @duration={{0.45}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{0.85}} />
          <lt.Tween
            @of={{lt.id "lt-beacons"}}
            @opacity={{array 0 1}}
            @y={{array 24 0}}
            @duration={{0.55}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{1.95}} />
          <lt.Tween
            @of={{lt.id "lt-beacons"}}
            @opacity={{array 1 0}}
            @y={{array 0 -14}}
            @duration={{0.45}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{1.05}} />
          <lt.Tween
            @of={{lt.id "lt-build"}}
            @opacity={{array 0 1}}
            @y={{array 24 0}}
            @duration={{0.55}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{2.15}} />
          <lt.Tween
            @of={{lt.id "lt-build"}}
            @opacity={{array 1 0}}
            @y={{array 0 -14}}
            @duration={{0.45}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{2.15}} />
          <lt.Tween
            @of={{lt.id "lt-logo"}}
            @opacity={{array 0 1}}
            @y={{array 24 0}}
            @duration={{0.7}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{1.4}} />
        </lt.Sequence>
      </Choreo>

      {{! The clock plane: a debug SMPTE readout with its OWN camera —
          independent zoom on an overlay plane, pulsing in during scene
          transitions while the world's camera flies its own path. The
          aim is set once (a zero-length cue with an @origin and no pose)
          so every relative pulse zooms about the clock itself. }}
      <Choreo
        class="reel-plane reel-clock"
        data-plane="clock"
        @quiet={{true}}
        as |k|
      >
        <div
          class="reel-clock-strip"
          data-take={{this.take}}
          {{this.wireClock k this.take}}
        >
          <div class="reel-clock-face" {{motion id="clock-face" role="clock"}}>
            <span class="reel-clock-label">SMPTE 60</span>
            <span class="reel-clock-tc">00:00:00:00</span>
          </div>
        </div>
        <k.Sequence>
          <k.Camera @origin={{k.id "clock-face"}} @duration={{0.01}} />
          <k.Wait @duration={{2.64}} />
          <k.SlowZoom @by={{1.3}} @duration={{0.35}} @ease={{GLIDE}} />
          <k.Wait @duration={{0.45}} />
          <k.SlowZoom @by={{UNPULSE}} @duration={{0.35}} @ease={{GLIDE}} />
          <k.Wait @duration={{2.65}} />
          <k.SlowZoom @by={{1.3}} @duration={{0.35}} @ease={{GLIDE}} />
          <k.Wait @duration={{0.5}} />
          <k.SlowZoom @by={{UNPULSE}} @duration={{0.35}} @ease={{GLIDE}} />
          <k.Wait @duration={{4.15}} />
          <k.SlowZoom @by={{1.3}} @duration={{0.35}} @ease={{GLIDE}} />
          <k.Wait @duration={{0.4}} />
          <k.SlowZoom @by={{UNPULSE}} @duration={{0.35}} @ease={{GLIDE}} />
          <k.Wait @duration={{2.1}} />
        </k.Sequence>
      </Choreo>
    </div>
  </template>
}
