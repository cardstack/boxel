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

interface SeekableDemoElement extends HTMLElement {
  seekDemo?: (time: number) => PromiseLike<void> | void;
}

interface BuildOrderElement extends HTMLElement {
  buildOrder?: { scrub(event: Event): void };
}

/** New editorial shell; the subjects are the gallery's real demos. */
export class FeatureReel extends Component {
  @tracked take = 0;
  private root?: HTMLElement;
  private c?: { run: ChoreoRun | null };
  private t?: { run: ChoreoRun | null };
  private score: ChoreoRun | null = null;
  private titleScore: ChoreoRun | null = null;
  private externallyDriven = false;
  private raf = 0;
  private previewStart = 0;
  private resolveReady!: () => void;
  private ready = new Promise<void>((resolve) => (this.resolveReady = resolve));

  /**
   * The composition host (docs/choreo-composition.md, Phase C1). Cues are
   * idempotent semantic commands folded through the composition clock in
   * BOTH modes; parameter channels are capture-only reconstruction — in
   * preview the demos play their own engines.
   */
  private compositor = createCompositor({
    automations: [
      {
        name: 'time',
        sample: (t: number) => Math.max(0, t - 0.55),
        target: 'lightbox',
      },
      {
        name: 'time',
        sample: (t: number) => Math.max(0, t - 3.45),
        target: 'inbox',
      },
      {
        from: 7.3,
        name: 'progress',
        sample: (t: number) => Math.max(0, t - 7.3),
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
      // no reset: the inbox has no cheap return to its seed rows; the
      // compose port is idempotent, so a backward replay cannot double it
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
    this.previewStart ||= performance.now();
    const previewTime = Math.min(
      DURATION,
      Math.max(0, (performance.now() - this.previewStart) / 1000)
    );
    this.adoptForPreview(this.c?.run ?? null, 'score', previewTime);
    this.adoptForPreview(this.t?.run ?? null, 'titleScore', previewTime);
    void this.compositor.foldTo(previewTime, { parameters: false });
    if (this.root) {
      this.root.dataset.scoreTime = previewTime.toFixed(3);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private adoptForPreview(
    run: ChoreoRun | null,
    key: 'score' | 'titleScore',
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
          <c.Camera
            @fit={{c.id "reel-lightbox-scene"}}
            @margin={{1}}
            @duration={{0.01}}
          />
          <c.Wait @duration={{0.44}} />
          <c.Camera
            @fit={{c.id "reel-lightbox-aim"}}
            @margin={{0.82}}
            @duration={{1}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{1.2}} />
          <c.Camera
            @fit={{c.id "reel-beacons-scene"}}
            @margin={{1}}
            @duration={{1.15}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{0.55}} />
          <c.Camera
            @fit={{c.id "reel-beacon-aim"}}
            @margin={{0.84}}
            @duration={{1}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{1.1}} />
          <c.Camera
            @fit={{c.id "reel-build-scene"}}
            @margin={{1}}
            @duration={{1.2}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{0.1}} />
          <c.Camera
            @fit={{c.id "reel-build-logo-aim"}}
            @margin={{0.82}}
            @duration={{1}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{1}} />
          <c.Camera
            @fit={{c.id "reel-build-panel-aim"}}
            @margin={{0.8}}
            @duration={{1.05}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{1}} />
          <c.Camera
            @fit={{c.id "reel-build-logo-aim"}}
            @margin={{0.82}}
            @duration={{1.1}}
            @ease={{GLIDE}}
          />
          <c.Wait @duration={{2.1}} />
        </c.Sequence>
      </Choreo>

      {{! The title plane: its own Choreo region, a sibling of the camera'd
          world — viewport-anchored typography the demo camera cannot drag.
          Its fade is a plain tween on the plane's actors: the experiment
          that keeps the addressable control channel unbuilt. }}
      <Choreo class="reel-titles" @quiet={{true}} as |lt|>
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
          <lt.Wait @duration={{0.15}} />
          <lt.Tween
            @of={{lt.id "lt-lightbox"}}
            @opacity={{array 0 1}}
            @y={{array 24 0}}
            @duration={{0.55}}
            @ease={{GLIDE}}
          />
          <lt.Wait @duration={{1.6}} />
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
    </div>
  </template>
}
