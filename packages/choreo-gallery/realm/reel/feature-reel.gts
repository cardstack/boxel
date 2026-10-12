import { CardDef, Component as CardComponent } from '@cardstack/base/card-api';
import type { ChoreoRun } from '@cardstack/choreo';
import { Choreo } from '@cardstack/choreo';
import { array } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';

import { ChoreoRoot } from '../shell/choreo-root';
import { BuildOrder } from '../stages/build-order';
import { Inbox } from '../stages/inbox';
import { Lightbox } from '../stages/lightbox';
import { createCompositor } from './compositor';
import { LowerThird } from './lower-third';

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
  /** the mark's homecoming: chip leaves the brand plane, docks in the world */
  @tracked docked = false;
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
  /** wall seconds spent holding the lockup after the score ends */
  private holdClock = 0;
  /** runs a loop wrap let go of — never re-adopted at the seam */
  private retired = new WeakSet<ChoreoRun>();
  private lastTick = 0;
  private resolveReady!: () => void;
  private ready = new Promise<void>((resolve) => (this.resolveReady = resolve));

  /**
   * The composition host (notes/choreo-composition.md, Phase C1). Cues are
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
      { action: 'dock', at: 12.9, target: 'brand' },
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
    this.compositor.register('brand', {
      actions: {
        /** ensure the mark is docked in the world — a command, not a toggle */
        dock: () => {
          if (!this.docked) {
            this.docked = true;
          }
        },
      },
      reset: () => {
        if (this.docked) {
          this.docked = false;
        }
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
    },
  );

  wireBrand = modifier(
    (_el: Element, [b]: [{ run: ChoreoRun | null }, number]) => {
      this.b = b;
    },
  );

  wireClock = modifier(
    (_el: Element, [k]: [{ run: ChoreoRun | null }, number]) => {
      this.k = k;
    },
  );

  register = modifier((el: HTMLElement) => {
    this.root = el;
    // the capture handle: a driver finds the reel on its viewport element
    Object.defineProperty(el, 'choreoReel', {
      configurable: true,
      value: this,
    });
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
    // The handle belongs to the viewport element. Leaving it attached also
    // survives modifier teardown/reinstall around Glimmer render passes; the
    // element itself becomes unreachable when the reel unmounts.
  });

  /**
   * Live preview: the runs PLAY — play() is GPU, renderAt(t) is a still
   * (notes/choreo-composition.md, scope decisions). This clock only fires
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
    // adopt replacement runs against the clock in force, THEN read the clock
    const adoptTime = Math.min(DURATION, this.previewClock);
    this.adoptForPreview(this.c?.run ?? null, 'score', adoptTime);
    this.adoptForPreview(this.t?.run ?? null, 'titleScore', adoptTime);
    this.adoptForPreview(this.b?.run ?? null, 'brandScore', adoptTime);
    this.adoptForPreview(this.k?.run ?? null, 'clockScore', adoptTime);
    // ONE clock: the world run's own transport IS the preview clock. The
    // picture plays on WAAPI wall time; a separately accumulated rAF sum
    // drifts from it under load, and then every cue, title and SMPTE
    // frame folds against a world that is somewhere else — the 4-loop
    // recording measured hundreds of ms of divergence. Reading the run
    // keeps clock and picture one thing; only the closing hold (nothing
    // is animating) and the pre-score boot accumulate deltas.
    if (this.score) {
      const t = this.score.time;
      // …and the closing hold is a PAUSE, never a finished run: a run
      // that finishes hands its values back (the pose snaps) and §3.1
      // replays it from zero on the very next render — the film
      // restarting mid-hold, without the fold home. Park every plane a
      // hair before the end; the wrap's take bump compiles fresh runs.
      if (this.holdClock === 0 && t >= DURATION - 0.06) {
        for (const run of [
          this.score,
          this.titleScore,
          this.brandScore,
          this.clockScore,
        ]) {
          run?.pause();
        }
      }
      this.previewClock = Math.min(t, DURATION);
      this.holdClock = t >= DURATION - 0.06 ? this.holdClock + dt : 0;
    } else {
      this.previewClock += dt;
    }
    if (this.holdClock >= 1.2) {
      // the film loops: hold the lockup a beat, fold the commands home
      // (the lightbox closes, the composed row goes back out through the
      // demo's own delete), and a take bump compiles every plane a fresh
      // score — the same first-render-plays-nothing rule as a new visit.
      // The outgoing runs are RETIRED, not merely replaced: until the
      // fresh runs compile, a clock read from the parked old score would
      // hand adoption the film's END as the seam's time, retiming every
      // new plane to 14.9s — where it finishes at once and replays
      // offset (the 4-loop protocol caught exactly this).
      for (const run of [
        this.score,
        this.titleScore,
        this.brandScore,
        this.clockScore,
      ]) {
        if (run) {
          this.retired.add(run);
        }
      }
      this.score = null;
      this.titleScore = null;
      this.brandScore = null;
      this.clockScore = null;
      this.previewClock = 0;
      this.holdClock = 0;
      void this.compositor.foldTo(0, { parameters: false });
      this.take++;
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const previewTime = Math.min(DURATION, this.previewClock);
    this.paintClock(previewTime);
    void this.compositor.foldTo(previewTime, { parameters: false });
    // a debug handle, not a display: an attribute write invalidates style
    // on the whole viewport subtree, so in preview it updates at 4Hz —
    // the capture path writes it per still through renderAt instead
    const coarse = (Math.floor(previewTime * 4) / 4).toFixed(2);
    if (this.root && this.root.dataset.scoreTime !== coarse) {
      this.root.dataset.scoreTime = coarse;
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
    previewTime: number,
  ) {
    if (!run || run === this[key] || this.retired.has(run)) {
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
    this.root = undefined;
  }

  <template>
    <div class='reel-viewport' {{this.register}}>
      <Choreo class='reel-world' @quiet={{true}} as |c|>
        <section
          class='reel-scene reel-lightbox'
          data-take={{this.take}}
          {{motion id='reel-lightbox-scene' role='scene'}}
          {{this.wire c this.take}}
        >
          <div class='reel-kicker'><span>01</span><p>Lightbox</p></div>
          <div class='reel-demo-asset is-lightbox'><Lightbox /></div>
          <div
            class='reel-camera-target lightbox-aim'
            {{motion id='reel-lightbox-aim'}}
          ></div>
          <p class='reel-proof'>The real layoutId demo</p>
        </section>
        <section
          class='reel-scene reel-beacons'
          {{motion id='reel-beacons-scene' role='scene'}}
        >
          <div class='reel-kicker'><span>02</span><p>Beacons</p></div>
          <div class='reel-demo-asset is-inbox'><Inbox /></div>
          <div
            class='reel-camera-target beacon-aim'
            {{motion id='reel-beacon-aim'}}
          ></div>
          <p class='reel-proof'>The real Compose control</p>
        </section>
        <section
          class='reel-scene reel-build'
          {{motion id='reel-build-scene' role='scene'}}
        >
          <div class='reel-kicker'><span>03</span><p>Build Order</p></div>
          <div class='reel-demo-asset is-build'><BuildOrder /></div>
          <div
            class='reel-camera-target build-logo-aim'
            {{motion id='reel-build-logo-aim'}}
          ></div>
          <div
            class='reel-camera-target build-panel-aim'
            {{motion id='reel-build-panel-aim'}}
          ></div>
          {{#if this.docked}}
            {{! the mark's homecoming: a cross-plane arrival — the same
                identity as the corner chip, received into the WORLD
                itself. It lands under the lockup and rides the world's
                camera through the closing push-in: an in-world flight
                into a camera'd, mid-score region — the world-dock case }}
            <span
              class='reel-dock-mark'
              {{motion id='brand' role='brand'}}
            >Choreo</span>
          {{/if}}
        </section>

        {{! the natural authoring contract: a move, then a wait. Every
            wait here once had to be a constant-easing camera duplicate so a
            random-access seek would land on the pose — the workaround
            notes/external-clock-camera-seek-handoff.md records. The score
            staying Wait-based IS the proof the transport reconstructs. }}
        <c.Parallel>
          <c.Sequence>
            <c.Frame
              @of={{c.id 'reel-lightbox-scene'}}
              @padding={{1}}
              @duration={{0.01}}
            />
            <c.Wait @duration={{0.44}} />
            <c.Frame
              @of={{c.id 'reel-lightbox-aim'}}
              @padding={{0.82}}
              @duration={{1}}
              @ease={{GLIDE}}
            />
            {{! holds breathe: a recorded frame that is fully frozen reads as
              a hang, so every hold pushes gently toward its aim in force }}
            <c.SlowZoom @by={{1.03}} @duration={{1.2}} @ease={{GLIDE}} />
            <c.Frame
              @of={{c.id 'reel-beacons-scene'}}
              @padding={{1}}
              @duration={{1.15}}
              @ease={{GLIDE}}
            />
            <c.SlowZoom @by={{1.02}} @duration={{0.55}} @ease={{GLIDE}} />
            <c.Frame
              @of={{c.id 'reel-beacon-aim'}}
              @padding={{0.84}}
              @duration={{1}}
              @ease={{GLIDE}}
            />
            <c.SlowZoom @by={{1.03}} @duration={{1.1}} @ease={{GLIDE}} />
            <c.Frame
              @of={{c.id 'reel-build-scene'}}
              @padding={{1}}
              @duration={{1.2}}
              @ease={{GLIDE}}
            />
            <c.Wait @duration={{0.1}} />
            <c.Frame
              @of={{c.id 'reel-build-logo-aim'}}
              @padding={{0.82}}
              @duration={{1}}
              @ease={{GLIDE}}
            />
            <c.SlowZoom @by={{1.025}} @duration={{1}} @ease={{GLIDE}} />
            <c.Frame
              @of={{c.id 'reel-build-panel-aim'}}
              @padding={{0.8}}
              @duration={{1.05}}
              @ease={{GLIDE}}
            />
            <c.SlowZoom @by={{1.025}} @duration={{1}} @ease={{GLIDE}} />
            <c.Frame
              @of={{c.id 'reel-build-logo-aim'}}
              @padding={{0.82}}
              @duration={{1.1}}
              @ease={{GLIDE}}
            />
            {{! the hold gets its life from a push-in: 5% over the whole
              lockup, toward the aim in force — the logo }}
            <c.SlowZoom @by={{1.05}} @duration={{2.1}} @ease={{GLIDE}} />
          </c.Sequence>
          <c.Sequence>
            <c.Wait @duration={{12.9}} />
            {{! the homecoming flight: the receiver pins page-true where
                the corner chip stood (page space is the pact between
                planes) and lands in ITS world — under the camera, inside
                the push-in. Move-only and quick, the brand crossing's
                lessons applied across a zoom disagreement }}
            <c.Move
              @of={{c.received 'brand'}}
              @size={{false}}
              @duration={{0.45}}
              @ease={{GLIDE}}
            />
          </c.Sequence>
        </c.Parallel>
      </Choreo>

      {{! The brand plane: poster → corner chip is a CROSSING, not a cut.
          One region, one identity — the boundary fold flips both clips in
          a single render pass, the changeset pairs the removed wordmark
          with the inserted chip, and the flight is part of this plane's
          own seekable score. The plate leaves as an ordinary removed
          sprite the score fades. }}
      <Choreo
        class='reel-plane reel-brand'
        data-plane='brand'
        @quiet={{true}}
        as |b|
      >
        <div
          class='reel-brand-strip'
          data-take={{this.take}}
          {{this.wireBrand b this.take}}
        >
          {{#if this.poster}}
            <div class='reel-poster' {{motion id='poster-plate' role='plate'}}>
              <span class='reel-poster-rule' aria-hidden='true'></span>
              <p class='reel-poster-word' {{motion id='brand' role='brand'}}>
                Choreo
              </p>
              <p class='reel-poster-tag'>Motion. Choreographed.</p>
            </div>
          {{else}}
            {{#unless this.docked}}
              <div class='reel-brand-chip'>
                <span
                  class='reel-brand-mark'
                  {{motion id='brand' role='brand'}}
                >Choreo</span>
              </div>
            {{/unless}}
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
              @of={{b.received 'brand'}}
              @size={{false}}
              @duration={{0.4}}
              @ease={{GLIDE}}
            />
            <b.Tween
              @of={{b.removed 'plate'}}
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
        class='reel-plane reel-titles'
        data-plane='titles'
        @quiet={{true}}
        as |lt|
      >
        <div
          class='reel-titles-strip'
          data-take={{this.take}}
          {{this.wireTitles lt this.take}}
        >
          <LowerThird
            @id='lt-lightbox'
            @variant='feature'
            @label='01 · Lightbox'
            @title='Magic move, for real'
            @detail="The gallery's layoutId demo, live"
          />
          <LowerThird
            @id='lt-beacons'
            @variant='feature'
            @label='02 · Beacons'
            @title='A point, not an identity'
            @detail='Compose flies from the real button'
          />
          <LowerThird
            @id='lt-build'
            @variant='feature'
            @label='03 · Build Order'
            @title='Nine cues, one logo'
            @detail='Scored, scrubbed, interruptible'
          />
          <LowerThird
            @id='lt-logo'
            @variant='proof'
            @label='Choreo'
            @title='Motion. Choreographed.'
          />
        </div>
        <lt.Sequence>
          {{! the first third holds for the poster: type enters AFTER the
              cut, never underneath the plate }}
          <lt.Wait @duration={{0.55}} />
          <lt.Tween
            @of={{lt.id 'lt-lightbox'}}
            @opacity={{array 0 1}}
            @y={{array 24 0}}
            @duration={{0.55}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{1.2}} />
          <lt.Tween
            @of={{lt.id 'lt-lightbox'}}
            @opacity={{array 1 0}}
            @y={{array 0 -14}}
            @duration={{0.45}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{0.85}} />
          <lt.Tween
            @of={{lt.id 'lt-beacons'}}
            @opacity={{array 0 1}}
            @y={{array 24 0}}
            @duration={{0.55}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{1.95}} />
          <lt.Tween
            @of={{lt.id 'lt-beacons'}}
            @opacity={{array 1 0}}
            @y={{array 0 -14}}
            @duration={{0.45}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{1.05}} />
          <lt.Tween
            @of={{lt.id 'lt-build'}}
            @opacity={{array 0 1}}
            @y={{array 24 0}}
            @duration={{0.55}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{2.15}} />
          <lt.Tween
            @of={{lt.id 'lt-build'}}
            @opacity={{array 1 0}}
            @y={{array 0 -14}}
            @duration={{0.45}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{2.15}} />
          <lt.Tween
            @of={{lt.id 'lt-logo'}}
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
        class='reel-plane reel-clock'
        data-plane='clock'
        @quiet={{true}}
        as |k|
      >
        <div
          class='reel-clock-strip'
          data-take={{this.take}}
          {{this.wireClock k this.take}}
        >
          <div class='reel-clock-face' {{motion id='clock-face' role='clock'}}>
            <span class='reel-clock-label'>SMPTE 60</span>
            <span class='reel-clock-tc'>00:00:00:00</span>
          </div>
        </div>
        <k.Sequence>
          <k.Camera @origin={{k.id 'clock-face'}} @duration={{0.01}} />
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
    <style scoped>
      /* ── 15-second Choreo feature reel ───────────────────────────────────────
       All three 1920×1080 scenes coexist in one world; c.Camera translates that
       world beneath this sixteen-by-nine viewport. */

      .reel-viewport {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        background: #090b10;
        color: #f5f3ee;
        font-family: var(--font-sans);
        container-type: size;
      }

      .reel-viewport[data-capture-trace]::after {
        content: attr(data-capture-trace);
        position: absolute;
        z-index: 99999;
        right: 12px;
        bottom: 12px;
        max-width: calc(100vw - 24px);
        color: #ff4;
        background: #000;
        font: 18px/1.3 monospace;
        white-space: nowrap;
      }

      .reel-world {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform-origin: 0 0;
        background: #090b10;
      }

      .reel-scene {
        position: absolute;
        top: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        /* the demos inside each scene animate continuously; containment keeps
         their layout and paint invalidations from re-pricing the whole
         camera'd world layer every frame (the Safari half of the live gap) */
        contain: layout style paint;
      }

      /* Glass under a moving camera is repriced every frame — a
       backdrop-filter can never be cached, and Safari re-samples and
       re-blurs the scene behind the lightbox panels on every frame of
       camera motion (the orphan lesson, § app.css line ~9079, applied to
       the live world). The panels sit over their own dim wash, so a plain
       translucent ground reads the same at speed; the interactive gallery
       keeps its true glass. */

      .reel-world :deep(.backdrop),
      .reel-world :deep(.lightbox-body),
      .reel-world :deep(.lightbox-close) {
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
      }

      .reel-world :deep(.lightbox-body) {
        /* the blur carried most of the panel's legibility; without it the
         wash is a touch deeper, same hue, photo tint still showing through */
        background: rgba(12, 9, 8, 0.62);
      }

      .reel-lightbox {
        left: 0;
        background: #090b10;
      }

      .reel-beacons {
        left: 100%;
        background: #0d1117;
      }

      .reel-build {
        left: 200%;
        background: #f3f0e9;
        color: #17191f;
      }

      .reel-scene::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(
          125deg,
          transparent 55%,
          rgb(129 86 255 / 8%)
        );
      }

      .reel-build::after {
        background: linear-gradient(
          125deg,
          transparent 55%,
          rgb(87 47 212 / 7%)
        );
      }

      .reel-kicker {
        position: absolute;
        z-index: 3;
        top: 10%;
        left: 7.2%;
        display: flex;
        align-items: center;
        gap: 20px;
        font-family: var(--font-mono);
        font-size: clamp(13px, 1.05vw, 20px);
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .reel-kicker span {
        display: grid;
        place-items: center;
        width: 40px;
        aspect-ratio: 1;
        border: 1px solid #8269ff;
        border-radius: 50%;
        color: #a998ff;
      }

      .reel-kicker p,
      .reel-proof {
        margin: 0;
      }

      .reel-proof {
        position: absolute;
        z-index: 3;
        right: 9%;
        bottom: 11%;
        font-family: var(--font-mono);
        font-size: clamp(12px, 0.9vw, 17px);
        letter-spacing: 0.1em;
        color: #aaa6b2;
        text-transform: uppercase;
      }

      /* The reel mounts the gallery's actual interactive components. Their native
       controls, projection tree and nested Choreo regions stay live. */

      .reel-demo-asset {
        position: absolute;
        z-index: 2;
        inset: 16% 7% 9%;
        overflow: hidden;
        border: 1px solid rgb(255 255 255 / 13%);
        border-radius: 30px;
        background: var(--bg);
        box-shadow: 0 35px 90px rgb(0 0 0 / 32%);
      }

      .reel-demo-asset > :deep(.ex) {
        position: absolute;
        inset: 0;
      }

      .reel-demo-asset.is-lightbox :deep(.shots) {
        width: min(58cqw, 460px);
      }

      .reel-demo-asset.is-lightbox :deep(.lightbox) {
        width: min(74cqw, 430px, 58cqh);
      }

      .reel-demo-asset.is-inbox :deep(.inbox) {
        width: min(82cqw, 760px);
      }

      .reel-demo-asset.is-build {
        inset: 14% 5% 5%;
        border-color: rgb(22 24 30 / 13%);
        box-shadow: 0 35px 90px rgb(30 21 60 / 14%);
      }

      .reel-demo-asset.is-build :deep(.bo-split) {
        max-width: 920px;
        grid-template-columns: minmax(0, 1fr) minmax(240px, 310px);
      }

      .reel-camera-target {
        position: absolute;
        z-index: -1;
        pointer-events: none;
        opacity: 0;
      }

      .reel-camera-target.lightbox-aim {
        left: 28%;
        top: 18%;
        width: 44%;
        height: 68%;
      }

      .reel-camera-target.beacon-aim {
        left: 17%;
        top: 24%;
        width: 66%;
        height: 55%;
      }

      .reel-camera-target.build-logo-aim {
        left: 16%;
        top: 23%;
        width: 42%;
        height: 52%;
      }

      .reel-camera-target.build-panel-aim {
        left: 56%;
        top: 20%;
        width: 37%;
        height: 58%;
      }

      /* ── The title plane ─────────────────────────────────────────────────────
       Its own Choreo region, a sibling of the camera'd world: viewport-
       anchored on purpose, so the demo camera can dive without dragging the
       typography with it. */

      .reel-titles {
        position: absolute;
        inset: 0;
        z-index: 20;
        pointer-events: none;
      }

      /* ── The poster cut ──────────────────────────────────────────────────────
       A full-frame plate the poster clip mounts for the film's first beat;
       its removal at 0.45s IS the hard cut — no transition, by definition. */

      .reel-poster {
        position: absolute;
        inset: 0;
        z-index: 15;
        display: grid;
        place-content: center;
        justify-items: start;
        background: #090b10;
        color: #f3ece3;
      }

      .reel-poster-rule {
        width: 84px;
        height: 3px;
        background: #ff3b1f;
        margin-bottom: 26px;
      }

      .reel-poster-word {
        margin: 0;
        font:
          800 clamp(64px, 9vw, 168px) / 0.92 'Syne',
          sans-serif;
        letter-spacing: -0.04em;
      }

      .reel-poster-tag {
        margin: 18px 0 0;
        color: #d2c9bf;
        font:
          500 22px/1.2 'IBM Plex Mono',
          monospace;
        letter-spacing: 0.22em;
        text-transform: uppercase;
      }

      /* ── The brand plane ─────────────────────────────────────────────────────
       Poster and corner chip share one identity; the flight between them is
       the brand region's own score. The chip rests where the crossing lands. */

      .reel-brand {
        position: absolute;
        inset: 0;
        z-index: 16;
        pointer-events: none;
      }

      .reel-brand-chip {
        position: absolute;
        top: 4.5%;
        right: 4.2%;
      }

      .reel-brand-mark {
        display: inline-block;
        color: #f3ece3;
        opacity: 0.85;
        font:
          800 26px/1 'Syne',
          sans-serif;
        letter-spacing: -0.02em;
      }

      /* ── The plane family and the clock plane ────────────────────────────────
       Every overlay is a named plane: its own Choreo region, its own camera.
       The clock is the debug member — an SMPTE readout whose plane camera
       pulses in during scene transitions, independent of the world's dive. */

      .reel-plane {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .reel-clock {
        z-index: 18;
      }

      .reel-clock-face {
        position: absolute;
        bottom: 3.4%;
        left: 50%;
        display: flex;
        gap: 12px;
        align-items: baseline;
        padding: 8px 14px;
        border: 1px solid rgba(243, 236, 227, 0.28);
        border-radius: 4px;
        background: rgba(9, 11, 16, 0.72);
        color: #f3ece3;
        transform: translateX(-50%);
      }

      .reel-clock-label {
        color: #ff3b1f;
        font:
          500 12px/1 'IBM Plex Mono',
          monospace;
        letter-spacing: 0.18em;
      }

      .reel-clock-tc {
        font:
          500 20px/1 'IBM Plex Mono',
          monospace;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.08em;
      }

      /* the docked mark: the chip's homecoming — a cross-plane arrival into the
       clock plane, perched above the timecode for the lockup. Centred by
       margin, NOT transform: the mark is a flight target, and a stylesheet
       transform on a participant is clobbered by the flight — rest measured
       WITH it, flown WITHOUT it, landing beside itself. */

      .reel-world .reel-dock-mark {
        position: absolute;
        top: 63.9%;
        left: 36.9%;
        z-index: 4;
        color: rgb(243 236 227 / 85%);
        font:
          800 17px/1 'Syne',
          sans-serif;
        letter-spacing: -0.02em;
      }
    </style>
  </template>
}

class ReelIsolated extends CardComponent<typeof ChoreoFeatureReel> {
  <template>
    {{! the reel is authored against the dark palette, so it pins it }}
    <ChoreoRoot data-theme='dark'>
      <FeatureReel />
    </ChoreoRoot>
  </template>
}

/**
 * The fifteen-second feature reel: three of the gallery's demos, live, in one
 * camera'd world, with a title plane, a brand plane and a timecode over it.
 * It plays on its own clock in preview, and an external clock drives it
 * frame by frame through the viewport's `choreoReel.renderAt(t)` handle.
 */
export class ChoreoFeatureReel extends CardDef {
  static displayName = 'Choreo Feature Reel';
  static prefersWideFormat = true;
  static isolated = ReelIsolated;
}
