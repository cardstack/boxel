import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { createChoreoPlayer } from 'choreo-player';
import { modifier } from 'ember-modifier';
import type { ChoreoRun } from 'glimmer-motion';
import { Choreo, motion } from 'glimmer-motion';
import { BuildOrder } from 'test-app/components/examples/build-order';
import { Inbox } from 'test-app/components/examples/inbox';
import { Lightbox } from 'test-app/components/examples/lightbox';

const DURATION = 15;
const EASE = [0.2, 0, 0, 1] as const;

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
  private score: ChoreoRun | null = null;
  private externallyDriven = false;
  private lightboxFired = false;
  private inboxFired = false;
  private raf = 0;
  private previewStart = 0;
  private resolveReady!: () => void;
  private ready = new Promise<void>((resolve) => (this.resolveReady = resolve));

  private player = createChoreoPlayer({
    duration: DURATION,
    prepare: () => this.prepareScore(),
    runs: () => {
      // Child demos can legitimately cause the enclosing Choreo region to
      // publish a replacement all-kept run. Always drive the run currently
      // owned by the region; requiring object identity here made the capture
      // silently stop seeking the camera after the first demo updated.
      const run = this.c?.run ?? this.score;
      if (!run) {
        return [];
      }
      if (run !== this.score) {
        run.pause();
        this.score = run;
      }
      return [run];
    },
  });

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

  /** Live preview presses the real demo controls at score cues. */
  private tick = () => {
    const live = this.c?.run ?? null;
    this.previewStart ||= performance.now();
    const previewTime = Math.min(
      DURATION,
      Math.max(0, (performance.now() - this.previewStart) / 1000)
    );
    if (live && live !== this.score) {
      this.score = live;
      if (this.root) {
        this.root.dataset.scoreDuration = String(live.duration);
      }
      this.resolveReady();
      live.pause();
    }
    if (live && !this.externallyDriven) {
      live.pause();
      live.time = Math.min(previewTime, live.duration);
    }
    const time = this.externallyDriven ? (this.score?.time ?? 0) : previewTime;
    if (this.root) {
      this.root.dataset.scoreTime = time.toFixed(3);
    }
    if (time >= 0.55 && !this.lightboxFired) {
      this.lightboxFired = true;
      this.root
        ?.querySelectorAll<HTMLButtonElement>('.reel-lightbox .shot')[3]
        ?.click();
    }
    if (time >= 4.35 && !this.inboxFired) {
      this.inboxFired = true;
      this.root
        ?.querySelector<HTMLButtonElement>('.reel-beacons .inbox-compose')
        ?.click();
    }
    if (!this.isDestroying && !this.externallyDriven) {
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  /** HyperFrames seeks the outer score and each mounted demo's real engine. */
  async renderAt(time: number) {
    const trace: string[] = [];
    const mark = (label: string) =>
      trace.push(`${label}:${this.score?.time ?? -1}`);
    this.externallyDriven = true;
    cancelAnimationFrame(this.raf);
    // The capture engine's opening seek arrives before its first browser
    // frame. Let that frame mount/compile the score instead of making frame 0
    // wait for work that only frame 0 can advance.
    if (!this.score) {
      if (this.take === 0) {
        this.take++;
      }
      const run = this.c?.run;
      if (!run) {
        return;
      }
      this.score = run;
      run.pause();
      this.resolveReady();
    }
    mark('ready');
    await this.player.renderAt(time, { settle: false });
    mark('outer-1');
    const lightbox =
      this.root?.querySelector<SeekableDemoElement>('.reel-lightbox .ex');
    const inbox =
      this.root?.querySelector<SeekableDemoElement>('.reel-beacons .ex');
    await Promise.all([
      lightbox?.seekDemo?.(time),
      inbox?.seekDemo?.(Math.max(0, time - 3.45)),
    ]);
    mark('children');
    // A real demo state change is a real Glimmer render, so the enclosing
    // region legitimately compiles a replacement all-kept camera run. Adopt
    // that run before sampling the requested editorial frame.
    const refreshed = this.c?.run;
    if (refreshed && refreshed !== this.score) {
      refreshed.pause();
      this.score = refreshed;
    }
    mark('refreshed');
    const build = this.root?.querySelector<BuildOrderElement>(
      '.reel-build .bo-stage'
    )?.buildOrder;
    if (build && time >= 7.3) {
      build.scrub({
        target: { value: String(Math.max(0, time - 7.3)) },
      } as unknown as Event);
    }
    // The capture event itself is the frame barrier. Waiting for another rAF
    // here would deadlock the renderer between frame N and N+1.
    await this.player.renderAt(time, { settle: false });
    mark('outer-2');
    if (this.root) {
      this.root.dataset.scoreTime = String(this.score?.time ?? -1);
      this.root.dataset.scoreDuration = String(this.score?.duration ?? -1);
      (this.root as HTMLElement & { choreoRun?: ChoreoRun }).choreoRun =
        this.score ?? undefined;
      this.root.dataset.captureTrace = trace.join('|');
    }
  }

  willDestroy() {
    super.willDestroy();
    if (this.root) {
      this.root.dataset.featureReelDestroyed = 'yes';
    }
    cancelAnimationFrame(this.raf);
    this.resolveReady();
    this.player.pause();
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
            @duration={{0.65}}
            @ease={{EASE}}
          />
          <c.Wait @duration={{1.55}} />
          <c.Camera
            @fit={{c.id "reel-beacons-scene"}}
            @margin={{1}}
            @duration={{0.8}}
            @ease={{EASE}}
          />
          <c.Wait @duration={{0.9}} />
          <c.Camera
            @fit={{c.id "reel-beacon-aim"}}
            @margin={{0.84}}
            @duration={{0.65}}
            @ease={{EASE}}
          />
          <c.Wait @duration={{1.45}} />
          <c.Camera
            @fit={{c.id "reel-build-scene"}}
            @margin={{1}}
            @duration={{0.85}}
            @ease={{EASE}}
          />
          <c.Wait @duration={{0.45}} />
          <c.Camera
            @fit={{c.id "reel-build-logo-aim"}}
            @margin={{0.82}}
            @duration={{0.65}}
            @ease={{EASE}}
          />
          <c.Wait @duration={{1.35}} />
          <c.Camera
            @fit={{c.id "reel-build-panel-aim"}}
            @margin={{0.8}}
            @duration={{0.75}}
            @ease={{EASE}}
          />
          <c.Wait @duration={{1.3}} />
          <c.Camera
            @fit={{c.id "reel-build-logo-aim"}}
            @margin={{0.82}}
            @duration={{0.75}}
            @ease={{EASE}}
          />
          <c.Wait @duration={{2.45}} />
        </c.Sequence>
      </Choreo>
    </div>
  </template>
}
