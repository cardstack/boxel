import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import {
  type Camera3DState,
  Choreo,
  type ChoreoContext,
  type ChoreoRun,
  motion,
} from 'glimmer-motion';
import { Board } from 'test-app/components/long-take/board';
import type { SHOTS } from 'test-app/components/long-take/shots';
import { BOARD, GLIDE, tunedShots } from 'test-app/components/long-take/shots';
import config from 'test-app/config/environment';
import { cameraCss, objectCss, perspective } from 'test-app/lib/css3d';
import { observeStage, onStage } from 'test-app/lib/onstage';
import type * as THREE from 'three';

/**
 * ONE SHOT, NO CUTS — and two cameras on the same list.
 *
 * The laptop's screen holds a drawing that never changes. Nothing on it
 * mounts, unmounts, moves or animates for the whole film: there is no
 * `c.Move`, no changeset, no `c.Perform`, not one `@animate` anywhere in
 * `long-take/board.gts`. Every frame of it is camera.
 *
 * There are two of them, and they are nested:
 *
 *   `c.Camera` INSIDE the screen moves the frame over the drawing —
 *   `c.Frame` to arrive, `c.Aim` to travel with the zoom held, `c.Pan` to
 *   drift, `c.SlowZoom` to keep a hold alive, `c.Hold` for the beat.
 *
 *   `c.Camera3D` OUTSIDE moves the laptop in the room, and it barely
 *   moves at all. A device that swings about while you are trying to read
 *   something is a demo talking over itself, so the outer camera does one
 *   slow drift per shot and nothing else.
 *
 * They read ONE list (`long-take/shots.ts`), which is what keeps them in
 * step: a shot's length is `move + hold`, both regions are handed the
 * same number, and neither of them owns it. Two scores that each kept
 * their own timings would need those timings kept equal by hand, and the
 * first edit that forgot would be a film whose cameras had drifted a
 * second apart with nothing to point at.
 *
 * There is no 2D mode. The demo is about a camera inside a camera, and
 * flat there is only one of them.
 */

/** the DOM screen, at the model's own display aspect */
/**
 * PUBLIC ASSETS ARE ADDRESSED FROM THE ROOT URL, NEVER FROM `/`.
 *
 * These are hand-written strings handed to a loader (or an `img`) at runtime,
 * so nothing rewrites them. Vite rewrites the script and stylesheet hrefs it
 * emits into index.html and it rewrites `?url` imports, but a literal inside
 * a call it never parses is just a literal. At `/` — every dev server, every
 * test — a root-absolute path is indistinguishable from a correct one, which
 * is why this class of bug can only ever appear on the deploy.
 *
 * On GitHub Pages the app is served from `/choreo/`, so `/models/x.glb` is a
 * 404 and `/choreo/models/x.glb` is the file. `config.rootURL` is the same
 * `APP_BASE` that sets Vite's `base`, so deriving from it keeps the two in
 * step by construction.
 *
 * It fails quietly, too, which is what made it expensive: a decoder that 404s
 * leaves the GLTF load hanging forever, so the canvas is never sized off the
 * model and the scene renders as a 300x150 default with nothing drawn in it.
 * No exception, no failed promise — just a blank rectangle that looks for all
 * the world like a WebGL problem.
 */
const DRACO = `${config.rootURL}draco/`;
const LAPTOP = `${config.rootURL}models/macbook-pro.glb`;
const STILL = `${config.rootURL}still/macbook.webp`;

const SCREEN = { h: BOARD.h, w: BOARD.w };

/**
 * How much of the room the cover glass gives back — the reflectance of the
 * sheet, as a plain 0-to-1 grey. It scales the WHOLE specular response, the
 * softboxes as well as the painted room, which is what makes it a single
 * honest number: 0 is a matte screen, 1 is a mirror you cannot read the
 * drawing through. A real display is nearer the bottom of that range than
 * feels right until you see it.
 */
const GLOSS = 0.12;

/**
 * THE FLAT LAPTOP IS A PHOTOGRAPH OF THE ROUND ONE.
 *
 * 2D used to be a laptop drawn in CSS, which meant the switch changed what
 * the machine LOOKED like as well as whether it moved — two devices, and
 * the flat one always the poor relation. This is a WebP of the WebGL
 * laptop at its rest pose instead, so the two modes are the same picture
 * and the only difference is that one of them is alive.
 *
 * It works because of the hole. The canvas is drawn with alpha and the
 * display mesh punches itself out of it, so a straight readback of that
 * canvas is a laptop with a transparent screen — and an `<img>` of it,
 * laid over the DOM exactly where the canvas goes, composites the drawing
 * through it in exactly the same way. 53 KB against a megabyte and a half
 * of engine.
 *
 * The catch is that the picture and the matrices below are ONE
 * measurement, taken at REF and no other size. Replace one and you must
 * replace all of them: `window.__take.capture()` in the dev server writes
 * the file AND returns these three strings for exactly that reason. The
 * whole flat composite is then scaled as a unit — see `--k` — because
 * scaling a projection is only sound when everything projected scales
 * with it.
 */
const REF = { h: 838, w: 1178 };

/**
 * How far the two cameras may come apart before one is seeked to the other,
 * in seconds. About a frame: tighter and it seeks on every tick for no visible
 * gain, looser and the error is one you can see.
 */
const SYNC_SLOP = 1 / 30;

const FROZEN = {
  cam:
    'translateZ(1289.55px) matrix3d(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, ' +
    '0, 32.0808, -2177.02, 1) translate(589px, 419px)',
  perspective: '1289.55px',
  plane:
    'translate(-50%, -50%) matrix3d(1, 0, 0, 0, 0, -0.999896, -0.0144164, ' +
    '0, 0, -0.0144164, 0.999896, 0, 0.215572, 24.8416, -511.218, 1) ' +
    'scale(1.006)',
};

/** how much of the box the laptop fills — closer than the mockup's, on purpose */
const fillFor = (h: number) => (h < 520 ? 1.06 : h < 660 ? 1.0 : 0.94);

/** the lid's own layer: the one thing the eye-level key light may not touch */
const EYE_LEVEL = 1;

const RANGE = {
  dolly: [0.5, 1.9],
  pan: [-0.4, 0.4],
  /** the top of the range is the high angle over the keyboard */
  pitch: [-20, 27],
  yaw: [-38, 38],
} as const;

interface LongTakeWindow extends Window {
  __take?: unknown;
}

export class LongTake extends Component {
  /** flat by default: the engine is a megabyte and a half, the still is 53 KB */
  @tracked mode: '2d' | '3d' = '2d';
  /** pressed 3D, engine still downloading: stay flat until it can draw */
  @tracked arming = false;
  @tracked status = 'flat — the same picture, no engine loaded';
  @tracked cameraOn = true;
  @tracked roomy = true;
  @tracked take = 0;
  @tracked drawn = false;

  private region?: { run: ChoreoRun | null };
  private shotHost?: (state: Camera3DState) => void;
  private poseHost?: (
    partial: Partial<Camera3DState>,
    relative?: boolean
  ) => void;
  private leanHost?: (partial: Partial<Camera3DState>) => void;
  private resetHost?: () => void;
  private boot?: () => Promise<void>;
  private halt?: () => void;
  private inRoom = false;
  private holdRendering?: (held: boolean) => void;

  isMode = (mode: '2d' | '3d') => this.mode === mode;

  /**
   * Scrolled out of sight: drop to 2D and stop the cameras.
   *
   * This stage is one of the two most expensive things in the gallery — a WebGL
   * context, a model, a render loop and two choreography regions — and the
   * gallery keeps forty-two demos mounted at once. Off screen it should cost
   * nothing, and 2D is genuinely nothing: `setMode('2d')` halts the render loop
   * and the whole 3D path stops being rendered.
   *
   * It does NOT come back on its own. Pressing 3D is a choice someone made, and
   * a stage that re-boots a WebGL context every time it crosses the fold is
   * worse than one that waits to be asked again — the still is what this looks
   * like unasked, and that is the state it returns to.
   */
  offstage = (visible: boolean) => {
    if (this.inRoom) {
      // Keep the 3D canvas and pose exactly where the camera left them.
      this.holdRendering?.(!visible);
      if (!visible) {
        this.region?.run?.pause();
      } else if (this.cameraOn) {
        this.region?.run?.play();
      }
      return;
    }
    if (visible) {
      return;
    }
    this.cameraOn = false;
    this.region?.run?.pause();
    this.setMode('2d');
  };

  /**
   * While flat, EITHER chip starts the film.
   *
   * Pressing 2D when you are already looking at 2D did nothing, which is
   * correct for a segmented control and useless here: the flat state is a still
   * of a laptop, and the only thing anyone can want from it is to see the
   * thing move. A press on a control that answers with nothing reads as a
   * broken control, and the one at hand was the wrong half of a toggle.
   *
   * In 3D the pair behaves as an ordinary toggle again — 2D is the way back,
   * and 3D is where you already are.
   */
  choose = (mode: '2d' | '3d') => {
    this.setMode(this.mode === '2d' ? '3d' : mode);
  };

  setMode = (mode: '2d' | '3d') => {
    if (mode === this.mode || this.arming) {
      return;
    }
    if (mode === '2d') {
      this.mode = '2d';
      this.halt?.();
      return;
    }
    // FLIP ONLY WHEN 3D CAN ACTUALLY DRAW. Switching first and loading
    // after is a second and a half of empty stage and then a pop — a flash
    // where a transition should be. The still stays up, the button says
    // so, and the swap happens when the first frame is mapped.
    this.arming = true;
    void this.boot?.().then(() => {
      this.arming = false;
      this.mode = '3d';
      // ENTERING 3D IS ASKING FOR THE FILM. Nobody presses 3D to look at
      // a still of a laptop — and a region does not collect its score on
      // the pass that first renders it, so the take that made the film
      // exist has to be followed by one that can compile it.
      this.cameraOn = true;
      this.ended = false;
      requestAnimationFrame(() => {
        this.take += 1;
      });
    });
  };

  get shots() {
    return tunedShots();
  }

  get clockStyle() {
    return htmlSafe(`width:${this.take}px`);
  }
  readonly glide = GLIDE;

  /**
   * NOTHING PLAYS UNTIL THE SCREEN HAS A SIZE.
   *
   * The inner camera's first step is `c.Frame` — fit this station to the
   * frame — and a fit is a ratio of two measured boxes. The DOM plane has
   * no width at all until the GLB has landed and the display has been
   * measured, so a score that started at mount would divide by a screen
   * that is 0 wide, land on zoom 0, and then measure everything through
   * its own zero scale forever after. That is not a slow start; it is a
   * latch, and the demo comes up as a blank navy rectangle with no way
   * back.
   *
   * So both regions wait for the first mapped frame. It also happens to
   * be the honest thing: the film should not be three seconds in by the
   * time there is a laptop to look at.
   */
  /**
   * `roomy` is deliberately NOT in here.
   *
   * It was, and it made the film unplayable in a gallery card: `roomy` is
   * set once at mount from `closest('.stage-wrap')`, which only the demo
   * page has, and nothing ever sets it back. So the 3D button armed the
   * camera, bumped the take, and the score still never rendered — the
   * transport was furniture. The mockup stage on the same page has always
   * left `roomy` out of its own play gate, which is why the phone moved in
   * a card and the laptop did not.
   *
   * The two gates that remain are the ones that mean something: the film
   * only exists in 3D, and only once there is a mapped frame to look at.
   * `roomy` keeps its real job, which is the thumbstick pads.
   */
  get playing() {
    return this.mode === '3d' && this.cameraOn && this.drawn;
  }

  /** the outer camera's leg for a shot is exactly the shot's own length */
  legFor = (shot: (typeof SHOTS)[number]) => shot.move + shot.hold;

  shot = (state: Camera3DState) => {
    this.shotHost?.(state);
  };

  /**
   * A stick moved. Playing, it is a NUDGE laid on top of the film that
   * unwinds when you let go — lean in to read something and simply
   * release to be handed back to the shot. Stopped, the same stick
   * INTEGRATES and drives the pose itself.
   */
  nudge = (kind: string, x: number, y: number, dt: number) => {
    const lean = this.cameraOn;
    const k = lean ? 1 : dt;
    const move =
      kind === 'orbit'
        ? { pitch: y * (lean ? 20 : 62), yaw: x * (lean ? 34 : 100) }
        : kind === 'pan'
          ? { x: x * (lean ? 0.26 : 0.7), y: -y * (lean ? 0.26 : 0.7) }
          : { dolly: -y * (lean ? 0.5 : 1.1) };
    const scaled = Object.fromEntries(
      Object.entries(move).map(([key, v]) => [key, v * k])
    ) as Partial<Camera3DState>;
    if (lean) {
      this.leanHost?.(scaled);
    } else {
      this.poseHost?.(scaled, true);
    }
  };

  /** a drag means "let me look", and that stops the outer camera */
  seizeCamera = () => {
    if (this.cameraOn) {
      this.cameraOn = false;
      this.region?.run?.pause();
    }
  };

  // NO RESYNC BUTTON. The drawing is inert — there is nothing on it to
  // press, so the only thing a person can take over is the camera, and the
  // camera control already hands it back. A second button that means
  // "undo the first button" is furniture.

  /** the run reached its end: resuming has to compile a fresh one */
  private ended = false;

  toggleCamera = () => {
    const next = !this.cameraOn;
    this.cameraOn = next;
    const run = this.region?.run;
    if (!next) {
      run?.pause();
      return;
    }
    // RESUME, DO NOT RESTART.
    //
    // Bumping the take compiles a fresh score and starts it at zero, and
    // on a rapid double press that stacks one film on top of another —
    // each one snapping the pose back to its first shot. That is the
    // throb. There is a run standing right there with a clock on it, so
    // press play; only a run that has actually ENDED needs a new one.
    //
    // The stick's lean is dropped either way, because a film that resumes
    // holding someone's pull is not the film. The POSE is left alone: it
    // is where the shot was, and the next cue tweens out of it.
    this.leanHost?.({});
    if (run && !this.ended) {
      run.play();
      return;
    }
    this.ended = false;
    this.take += 1;
  };

  /**
   * The board's run, handed up by the Board so this stage can drive it.
   * Not tracked: it is read inside a frame loop and never rendered from.
   */
  private boardRun: ChoreoRun | null = null;

  takeBoardRun = (run: ChoreoRun | null) => {
    this.boardRun = run;
  };

  /**
   * ONE CLOCK, TWO SCORES.
   *
   * The two cameras are given identical durations — each `c.Camera3D` out here
   * lasts exactly the `move + hold` of the shot the board's own camera is
   * running — and for a while that was taken to be enough: "neither region owns
   * it, which is the only reason they cannot drift". It is not enough. Equal
   * durations only means equal LENGTHS; the two regions still compile on
   * different passes, start on different frames, and run on separate clocks,
   * and a few milliseconds at the top of a thirty-second film is a few
   * milliseconds all the way down it. On a stage with no interactivity at all —
   * nothing on this drawing can be clicked, dragged or changed — every frame is
   * determined by the script, so any divergence between the two is error and
   * nothing else.
   *
   * So the outer run is the clock and the board's is seeked to it. The tolerance
   * is about a frame: correcting a drift smaller than that would seek on every
   * tick for no visible gain, and correcting nothing lets it accumulate.
   *
   * This is only sound because camera cues are seekable by construction —
   * absolute shots are computed from measured geometry and relative ones are
   * reconstructed against the pose in force. A score with a changeset in it
   * could not be driven this way, and this one deliberately has none.
   */
  sync = modifier((el: HTMLElement) => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const outer = this.region?.run;
      const board = this.boardRun;
      if (!outer || !board) {
        return;
      }
      if (Math.abs(board.time - outer.time) > SYNC_SLOP) {
        board.time = outer.time;
      }
    };
    const observer = observeStage(el, (visible) => {
      cancelAnimationFrame(raf);
      raf = visible ? requestAnimationFrame(tick) : 0;
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  });

  /** hold the region so the film can loop when its score finishes */
  wire = modifier((_el: HTMLElement, [c]: [ChoreoContext, number]) => {
    this.region = c as unknown as { run: ChoreoRun | null };
    const run = this.region.run;
    if (!run) {
      return;
    }
    let live = true;
    void run.finished.then(() => {
      if (!live) {
        return;
      }
      if (this.cameraOn) {
        this.take += 1;
      } else {
        // stopped at the end: there is nothing left to press play on
        this.ended = true;
      }
    });
    return () => {
      live = false;
    };
  });

  /**
   * THUMBSTICKS, not sliders: progressive resistance so the outer travel
   * costs something, a damped knob that chases the finger, and an elastic
   * snap home. The camera integrates the stick's OFFSET, so a stick that
   * springs back does not undo what it did.
   */
  padDrag = modifier((el: HTMLElement, [kind]: [string]) => {
    const knob = { vx: 0, vy: 0, x: 0, y: 0 };
    let held = false;
    let raf = 0;
    let want = { x: 0, y: 0 };
    let last = 0;

    const resist = (t: number) =>
      Math.sign(t) * Math.min(1, Math.abs(t)) ** 1.7;

    const read = (ev: PointerEvent) => {
      const b = el.getBoundingClientRect();
      const half = Math.min(b.width, b.height) / 2 || 1;
      want = {
        x: resist((ev.clientX - (b.left + b.width / 2)) / half),
        y: resist((ev.clientY - (b.top + b.height / 2)) / half),
      };
    };

    const CHASE = { c: 26, k: 340 };
    const HOME = { c: 15, k: 150 };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      const target = held ? want : { x: 0, y: 0 };
      const s = held ? CHASE : HOME;
      for (const axis of ['x', 'y'] as const) {
        const v = axis === 'x' ? 'vx' : 'vy';
        const a = s.k * (target[axis] - knob[axis]) - s.c * knob[v];
        knob[v] += a * dt;
        knob[axis] += knob[v] * dt;
      }
      el.style.setProperty('--knob-x', knob.x.toFixed(4));
      el.style.setProperty('--knob-y', knob.y.toFixed(4));
      const lean = this.cameraOn;
      this.nudge(kind, lean ? want.x : knob.x, lean ? want.y : knob.y, dt);
      if (
        !held &&
        Math.hypot(knob.x, knob.y) < 0.002 &&
        Math.hypot(knob.vx, knob.vy) < 0.01
      ) {
        cancelAnimationFrame(raf);
        raf = 0;
        knob.x = 0;
        knob.y = 0;
        el.style.setProperty('--knob-x', '0');
        el.style.setProperty('--knob-y', '0');
      }
    };

    const spin = () => {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    const move = (ev: PointerEvent) => {
      if (held) {
        read(ev);
      }
    };
    const up = () => {
      held = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      spin();
    };
    const start = (ev: PointerEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      held = true;
      read(ev);
      spin();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };
    el.addEventListener('pointerdown', start);
    return () => {
      el.removeEventListener('pointerdown', start);
      up();
      if (raf) {
        cancelAnimationFrame(raf);
      }
    };
  });

  stage = modifier((host: HTMLElement) => {
    this.inRoom = !!host.closest('[data-widget-active]');
    const canvas = host.querySelector('canvas')!;
    const layer = host.querySelector<HTMLElement>('.lt-css')!;
    const cam = host.querySelector<HTMLElement>('.lt-cam')!;
    const plane = host.querySelector<HTMLElement>('.lt-plane')!;

    // START CLEAN: an inline matrix left by a previous mount beats the 2D
    // stylesheet and leaves a flat laptop wearing a 3D transform
    plane.style.transform = '';
    cam.style.transform = '';
    layer.style.perspective = '';

    /**
     * IS THIS THE DEMO'S OWN PAGE, OR A CARD IN THE GALLERY?
     *
     * A film that loops forever is right on a page you opened to watch it
     * and wrong in a grid of thirty-odd cards, where it is a WebGL context
     * and a permanent repaint behind everything else. So the gallery gets
     * it paused, with the controls right there to start it.
     *
     * That used to be guessed from the stage's HEIGHT, and the guess was
     * wrong twice. It read the box before layout, so a full page could be
     * mistaken for a card — and on a phone, where the demo IS the page, a
     * short stage is exactly the case the rule was meant to exclude. The
     * page and the card have different containers; ask which one this is.
     */
    const onOwnPage = !!host.closest('.stage-wrap, .workbench-stage');
    this.roomy = onOwnPage;
    if (!onOwnPage) {
      this.cameraOn = false;
    }

    /**
     * ONE FIT, TWO CONSUMERS. The 3D camera solves a distance that fills
     * FILL of the box; the flat laptop is scaled by the same fraction, so
     * the 2D/3D switch does not resize the device under you.
     */
    /**
     * ONE SCALE FOR THE WHOLE FLAT COMPOSITE.
     *
     * The still and the frozen matrices were measured together at REF, so
     * flat mode reproduces that box exactly and scales it as a unit —
     * image, perspective, camera element and plane all by the same `--k`.
     * Fitting them separately would be scaling a projection against its
     * own image, which comes apart the moment the lid is not square on.
     */
    const watch = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      host.style.setProperty(
        '--k',
        String(Math.min(w / REF.w, h / REF.h).toFixed(4))
      );
    };

    /**
     * Put the flat composite's transforms back. In 3D the tick overwrites
     * all three every frame; flat, they are the ones the still was shot
     * with and nothing else will do.
     */
    const freeze = () => {
      layer.style.perspective = FROZEN.perspective;
      cam.style.transform = FROZEN.cam;
      plane.style.transform = FROZEN.plane;
      plane.style.width = `${SCREEN.w}px`;
      plane.style.height = `${SCREEN.h}px`;
    };
    freeze();
    // THE ROOM IS DECIDED BY THE OBSERVER, NEVER BY THIS CALL. A modifier
    // runs before its element has been laid out, so the height here is
    // whatever the box happened to be mid-render — and a full page read a
    // frame too early is classified as a gallery card, which opens paused
    // with no film. The ResizeObserver's first callback carries the box
    // the browser actually settled on.
    watch();
    const ro = new ResizeObserver(watch);
    ro.observe(host);

    let raf = 0;
    let running = false;
    let built = false;
    let building = false;
    let ready = false;
    let tick: (() => void) | undefined;
    let clear: (() => void) | undefined;
    let rx = -0.05;
    let ry = 0.32;
    let dolly = 1;
    let truck = 0;
    let pedestal = 0;
    let dispose: (() => void) | undefined;
    let stopTheme: (() => void) | undefined;

    /**
     * Everything 3D lives behind this. three plus a GLTF loader, a DRACO
     * decoder and an environment is a megabyte and a half of JavaScript —
     * none of which a visitor looking at the flat deck has any use for.
     */
    const build = async () => {
      if (built || building) {
        return;
      }
      building = true;
      this.status = 'fetching the 3D engine…';
      const [T, { RectAreaLightUniformsLib }, { DRACOLoader }, { GLTFLoader }] =
        await Promise.all([
          import('three'),
          import('three/examples/jsm/lights/RectAreaLightUniformsLib.js'),
          import('three/examples/jsm/loaders/DRACOLoader.js'),
          import('three/examples/jsm/loaders/GLTFLoader.js'),
        ]);

      const renderer = new T.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
      });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.96;
      const scene = new T.Scene();
      const pmrem = new T.PMREMGenerator(renderer);

      /**
       * TWO ROOMS, for the same reason a real set has flags. The
       * aluminium wants a bright one — metal is nothing but the
       * reflection of its surroundings — and the glass wants a dark one,
       * or the room comes back as a white sheet over the slides. Painted
       * in equirectangular space: u is the compass with 0 at the lens.
       */
      const cyc = (
        walls: string,
        lamps: [number, number, number, number, string, number][]
      ) => {
        const c = document.createElement('canvas');
        c.width = 1024;
        c.height = 512;
        const g = c.getContext('2d')!;
        const U = c.width;
        const V = c.height;
        g.fillStyle = walls;
        g.fillRect(0, 0, U, V);
        for (const [at, v, w, h, tint, power] of lamps) {
          const cx = ((0.5 + at + 1) % 1) * U;
          const grad = g.createRadialGradient(cx, v * V, 0, cx, v * V, w * U);
          grad.addColorStop(0, tint);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.save();
          g.globalAlpha = power;
          g.translate(cx, v * V);
          g.scale(1, (h * V) / (w * U));
          g.translate(-cx, -(v * V));
          g.fillStyle = grad;
          g.fillRect(0, 0, U, V);
          g.restore();
        }
        const tex = new T.CanvasTexture(c);
        tex.colorSpace = T.SRGBColorSpace;
        tex.mapping = T.EquirectangularReflectionMapping;
        return pmrem.fromEquirectangular(tex).texture;
      };

      scene.environment = cyc('#2b3038', [
        [0.0, 0.08, 0.5, 0.16, '#ffffff', 0.72],
        [-0.22, 0.44, 0.16, 0.72, '#e8f0ff', 0.7],
        [0.34, 0.4, 0.14, 0.6, '#ffdcb4', 0.6],
        [0.05, 0.94, 0.4, 0.12, '#aab2c0', 0.45],
      ]);

      /** the flagged room, for the panel: lamps down, nothing at the lens */
      const flagged = cyc('#05060a', [
        [0.0, 0.07, 0.34, 0.07, '#ffffff', 0.95],
        [-0.26, 0.4, 0.07, 0.5, '#9fb4d6', 0.5],
        [0.36, 0.38, 0.06, 0.4, '#c9a27a', 0.4],
      ]);

      const camera = new T.PerspectiveCamera(36, 1, 1, 20000);
      camera.position.set(0, 0, 2200);

      /**
       * FIT THE LAPTOP TO THE PLATTER. World units are CSS pixels, so
       * framing is arithmetic: the height a perspective camera shows at
       * distance d is 2·d·tan(fov/2), and the same in width once aspect
       * is folded in. Solve both, take the further. A laptop is landscape
       * and so is usually width-bound — which needs no special case.
       */
      let mac = { h: 1000, w: 1600 };
      let rest = 2200;
      /** the laptop sits a touch low, leaving air for the chrome on top */
      const DROP = 0.03;
      const frame2 = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        const vFov = (camera.fov * Math.PI) / 180;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (w / h));
        const fill = fillFor(h);
        const dV = mac.h / fill / 2 / Math.tan(vFov / 2);
        const dH = mac.w / fill / 2 / Math.tan(hFov / 2);
        rest = Math.max(dV, dH);
      };

      /**
       * THE RIG. A desk, not a void: one big soft key camera-left for the
       * streak down the aluminium lid, a low bounce standing in for the
       * table the laptop is on, a warm kicker behind to cut the
       * silhouette off the backdrop, and an overhead strip that is the
       * one highlight a glossy panel SHOULD carry.
       */
      RectAreaLightUniformsLib.init();
      scene.add(new T.AmbientLight(0xffffff, 0.14));

      /**
       * KEY, at eye level — and the ONE unit the panel may not see. A
       * source level with the lens reflects off the glass straight back
       * down it: a white sheet over the slides rather than a highlight.
       * three filters lights per object by LAYER, so this one lives alone
       * on layer 1 and every mesh joins layer 1 EXCEPT the display.
       */
      const key = new T.RectAreaLight(0xffffff, 2.6, 1800, 1400);
      key.position.set(-1150, 420, 1500);
      key.lookAt(0, 0, 0);
      key.layers.set(EYE_LEVEL);
      scene.add(key);

      /** overhead strip: long, shallow, high and only just in front */
      const top = new T.RectAreaLight(0xffffff, 1.3, 2200, 380);
      top.position.set(120, 2400, 320);
      top.lookAt(0, 0, 0);
      scene.add(top);

      /**
       * ONE HARD SOURCE, for the glint along the lid's top edge and the
       * hinge. Everything else here is big and soft, which models form
       * beautifully and leaves nothing to catch the eye; a product shot
       * needs one small source somewhere making one small bright thing.
       *
       * three counts point lights in candela and this one has decay 2, so
       * reaching a laptop's distance is a large number by construction
       * rather than by taste — the inverse square is doing the work, not
       * the intensity.
       *
       * FLAGGED OFF THE SCREEN, with the key. A point source is the one
       * thing a mirror cannot hold still: its specular on the cover glass
       * is a couple of pixels across and hundreds of times brighter than
       * the drawing under it, so as the shot turns it does not slide
       * across the panel, it blinks on and off between frames. Everything
       * the glass is allowed to see is wide and soft for that reason.
       */
      const glint = new T.PointLight(0xffffff, 1_600_000, 0, 2);
      glint.position.set(-520, 1450, 1050);
      glint.layers.set(EYE_LEVEL);
      scene.add(glint);

      /** the table: a wide dim source coming back up off the desk */
      const bounce = new T.RectAreaLight(0xc6cedb, 0.8, 2600, 900);
      bounce.position.set(0, -1250, 900);
      bounce.lookAt(0, 0, 0);
      bounce.layers.set(EYE_LEVEL);
      scene.add(bounce);

      /** warm kicker behind-right: the rim that lifts it off the cyc */
      const kick = new T.RectAreaLight(0xffe0b8, 3.4, 700, 1500);
      kick.position.set(1250, 700, -1200);
      kick.lookAt(0, 0, 0);
      scene.add(kick);

      /** and behind-left, low: the hairline along the lid's back edge */
      const rim = new T.RectAreaLight(0xdfe7f5, 3.2, 1700, 700);
      rim.position.set(-260, -680, -1150);
      rim.lookAt(0, 0, 0);
      scene.add(rim);

      /**
       * SCREEN GLOW — the tell that a display is on. A lit panel throws
       * its colour onto everything near it, and on a laptop that means
       * the keyboard deck and the inner bezel. Facing back at the model,
       * on the flagged layer so the one surface it may not light is the
       * glass it is standing on.
       */
      const glow = new T.RectAreaLight(0x9fb6e8, 2.2, SCREEN.w, SCREEN.h);
      glow.position.set(0, 60, 900);
      glow.lookAt(0, -300, 0);
      glow.layers.set(EYE_LEVEL);
      scene.add(glow);

      /**
       * THE SET. A backdrop the laptop stands in front of, so the eye can
       * tell the two motions apart: when the SHOT moves the horizon
       * shifts; when the DEVICE turns it does not. Without it a yaw and
       * an orbit are the same picture.
       */
      const cycCanvas = document.createElement('canvas');
      cycCanvas.width = 512;
      cycCanvas.height = 512;
      const cycCtx = cycCanvas.getContext('2d')!;
      const cycTex = new T.CanvasTexture(cycCanvas);
      cycTex.colorSpace = T.SRGBColorSpace;
      /** the set follows the page: a dark cyc behind a light page is a hole */
      const dressSet = () => {
        const light =
          document.documentElement.getAttribute('data-theme') === 'light';
        const base = light ? '#5b626e' : '#14161b';
        const floor = light ? '#3f444e' : '#090a0d';
        const pool = light ? '#ffffff2e' : '#ffffff1c';
        const g = cycCtx;
        g.fillStyle = base;
        g.fillRect(0, 0, 512, 512);
        const wash = g.createLinearGradient(0, 0, 0, 512);
        wash.addColorStop(0, '#00000047');
        wash.addColorStop(0.55, '#00000000');
        wash.addColorStop(0.6, '#ffffff12');
        wash.addColorStop(0.64, floor);
        wash.addColorStop(1, floor);
        g.fillStyle = wash;
        g.fillRect(0, 0, 512, 512);
        const spot = g.createRadialGradient(256, 330, 8, 256, 330, 210);
        spot.addColorStop(0, pool);
        spot.addColorStop(1, '#ffffff00');
        g.fillStyle = spot;
        g.fillRect(0, 0, 512, 512);
        cycTex.needsUpdate = true;
      };
      dressSet();
      const themeWatch = new MutationObserver(dressSet);
      themeWatch.observe(document.documentElement, {
        attributeFilter: ['data-theme'],
        attributes: true,
      });
      stopTheme = () => themeWatch.disconnect();
      const setPlane = new T.Mesh(
        new T.PlaneGeometry(9000, 9000),
        new T.MeshBasicMaterial({ map: cycTex })
      );
      setPlane.position.set(0, 0, -3600);
      scene.add(setPlane);

      /** everything the pointer orbits */
      const pivot = new T.Object3D();
      scene.add(pivot);
      /** the display's own frame: what the DOM plane is pinned to */
      const anchor = new T.Object3D();
      pivot.add(anchor);
      /** the cover glass's material, for `window.__take.gloss(n)` */
      let glassMat: THREE.MeshPhysicalMaterial | undefined;

      const draco = new DRACOLoader().setDecoderPath(DRACO);
      const loader = new GLTFLoader().setDRACOLoader(draco);
      await new Promise<void>((resolve) => {
        loader.load(LAPTOP, (gltf) => {
          const model = gltf.scene;
          model.updateMatrixWorld(true);

          /**
           * THE DISPLAY, BY NAME. Unlike the phone's GLB this model was
           * exported with its materials named, and one of them is
           * `screen.001` — so the panel is simply the mesh wearing it. A
           * geometry fallback is kept for the day that stops being true:
           * the thinnest mesh whose face is close to the lid's aspect.
           */
          let found: THREE.Mesh | undefined;
          let fallback: { mesh: THREE.Mesh; thin: number } | undefined;
          model.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) {
              return;
            }
            const mats = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            if (mats.some((m) => /screen/i.test(m?.name ?? ''))) {
              found ??= mesh;
            }
            mesh.geometry.computeBoundingBox();
            const b = mesh.geometry.boundingBox!;
            const d = b.max.clone().sub(b.min);
            const thin = Math.min(d.x, d.y, d.z);
            const bulk = Math.max(d.x, d.y, d.z);
            if (
              thin / bulk < 0.01 &&
              (!fallback || bulk > fallback.thin) &&
              bulk > 3
            ) {
              fallback = { mesh, thin: bulk };
            }
          });
          const panel = found ?? fallback?.mesh;
          if (!panel) {
            this.status = 'no screen mesh found';
            resolve();
            return;
          }

          // EVERY MEASUREMENT BELOW HAPPENS WITH THE ORBIT AT REST. A
          // Box3 is world-space and axis-aligned, so measuring under a
          // rotated pivot returns the box of the ROTATED lid.
          pivot.rotation.set(0, 0, 0);
          pivot.updateMatrixWorld(true);

          /**
           * ONE WORLD UNIT IS ONE CSS PIXEL. `perspective` and the
           * camera's translateZ are written in px, so a scene authored at
           * "8 units for a laptop" projects nothing like the WebGL one.
           * Scale the model until the display is exactly as wide as the
           * DOM screen and every matrix below is in pixels.
           *
           * The width is taken from the panel's OWN geometry rather than
           * from a world box, because the lid is hinged: an axis-aligned
           * box of a tilted panel is bigger than the panel.
           */
          panel.geometry.computeBoundingBox();
          const local = panel.geometry.boundingBox!;
          const span = local.max.clone().sub(local.min);
          // the thin axis is the normal; the other two are width x height
          const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
          const normalAxis = axes.reduce((a, b) => (span[a] < span[b] ? a : b));
          const face = axes.filter((a) => a !== normalAxis);
          const wLocal = Math.max(span[face[0]!], span[face[1]!]);
          const hLocal = Math.min(span[face[0]!], span[face[1]!]);

          const worldScale = panel.getWorldScale(new T.Vector3()).x || 1;
          model.scale.multiplyScalar(SCREEN.w / (wLocal * worldScale));
          pivot.add(model);
          pivot.updateMatrixWorld(true);

          // centre the whole laptop on the origin, so a dolly closes in on
          // the device rather than drifting off it
          const bounds = new T.Box3().setFromObject(model);
          model.position.sub(bounds.getCenter(new T.Vector3()));
          pivot.updateMatrixWorld(true);

          const whole = new T.Box3()
            .setFromObject(model)
            .getSize(new T.Vector3());
          // the silhouette a turned laptop sweeps, so a yaw does not push
          // a corner out of frame
          mac = { h: whole.y, w: Math.hypot(whole.x, whole.z) };
          frame2();

          /**
           * THE ANCHOR TAKES THE LID'S OWN ORIENTATION.
           *
           * The panel's local frame is (width, normal, height) in some
           * order; the DOM wants (right, up, out). That is one fixed
           * rotation, and composing it with the panel's WORLD rotation
           * pins the plane to the glass at whatever angle the hinge left
           * it — including the degree or so this model is off vertical,
           * which is invisible head-on and a visible parallax the moment
           * the shot turns.
           */
          const q = panel.getWorldQuaternion(new T.Quaternion());
          const correct = new T.Quaternion().setFromEuler(
            normalAxis === 'y'
              ? new T.Euler(-Math.PI / 2, 0, 0)
              : normalAxis === 'x'
                ? new T.Euler(0, Math.PI / 2, 0)
                : new T.Euler(0, 0, 0)
          );
          anchor.quaternion.copy(q).multiply(correct);

          const box = new T.Box3().setFromObject(panel);
          const centre = box.getCenter(new T.Vector3());
          // FLUSH, on the face the panel actually points at. There is no
          // z-fighting to avoid — the DOM never enters the depth buffer —
          // and any offset at all is parallax the moment the lid turns.
          const out = new T.Vector3(0, 0, 1).applyQuaternion(anchor.quaternion);
          const half = (span[normalAxis]! * worldScale * model.scale.x) / 2;
          anchor.position.copy(centre).addScaledVector(out, half);

          plane.style.width = `${SCREEN.w}px`;
          plane.style.height = `${Math.round(SCREEN.w * (hLocal / wLocal))}px`;

          /**
           * THE GLASS. `blending: NoBlending` writes the material's RGB
           * *and its alpha* straight into the framebuffer, replacing the
           * opaque fragments already drawn there — so the canvas becomes
           * a hole the shape of the display and the DOM beneath shows
           * through. Whatever this alpha is, that much of the slide is
           * replaced by shaded glass: five percent of near-black is depth
           * without dimming.
           */
          panel.material = new T.MeshPhysicalMaterial({
            blending: T.NoBlending,
            clearcoat: 1,
            clearcoatRoughness: 0.04,
            color: 0x01030a,
            envMap: flagged,
            envMapIntensity: 0.85,
            metalness: 0,
            opacity: 0.05,
            roughness: 0.06,
            transparent: true,
          });

          /**
           * THE COVER GLASS — the sheet the drawing is behind, rather than
           * a surface the drawing is printed on.
           *
           * The panel above cannot do this itself. Its whole job is to
           * punch a hole: `NoBlending` writes its alpha straight into the
           * framebuffer, so everything it draws is a replacement for the
           * DOM rather than something laid over it, and a highlight strong
           * enough to read would be a highlight you look at the slides
           * THROUGH. So the reflection is a second sheet, a hair in front,
           * drawn after it and adding to what is already there.
           *
           * Custom blending, because the two channels want opposite
           * things. RGB is additive — a reflection is light arriving, and
           * light only ever brightens what it lands on. Alpha is left
           * exactly as the panel wrote it: the framebuffer's alpha is the
           * hole the DOM shows through, and an ordinary transparent
           * material would raise it right across the display and quietly
           * seal the screen over.
           *
           * It reflects the flagged room and not the bright one for the
           * same reason the panel does — a mirror pointed at a white cyc
           * comes back a white sheet. What it catches is the overhead
           * strip, and the point of it is that it MOVES: the sheen slides
           * across the drawing as the shot turns, which a painted-on
           * gradient cannot do and which is most of why glass reads as
           * glass.
           */
          const glass = new T.Mesh(
            new T.PlaneGeometry(
              SCREEN.w,
              Math.round(SCREEN.w * (hLocal / wLocal))
            ),
            new T.MeshPhysicalMaterial({
              blendDst: T.OneFactor,
              // leave the hole alone — see above
              blendDstAlpha: T.OneFactor,
              blendEquation: T.AddEquation,
              blendEquationAlpha: T.AddEquation,
              blendSrc: T.OneFactor,
              blendSrcAlpha: T.ZeroFactor,
              blending: T.CustomBlending,
              // A MIRROR, not glass — which is the opposite of what it is
              // standing in for, and the only way to get the look. A
              // dielectric reflects about four percent of what it faces;
              // four percent of a room painted almost black is nothing at
              // all, and no gain rescues it because the gain multiplies
              // the same nothing. `metalness: 1` reflects the whole room
              // instead, and the room's own darkness becomes the control:
              // its walls are #05060a, so they add no haze over the
              // drawing, and what survives is the strip and the two side
              // lamps. The Fresnel edge a real cover glass has is the one
              // thing given up, and at these angles it was never visible.
              color: new T.Color().setScalar(GLOSS),
              depthWrite: false,
              envMap: flagged,
              envMapIntensity: 1,
              metalness: 1,
              // a touch soft: a mirror-sharp strip reads as a seam in the
              // model rather than as light in the room, and a softened
              // lobe is also what stops a moving highlight from sparkling
              roughness: 0.18,
              transparent: true,
            })
          );
          // a hair proud of the panel, and drawn last: far too little to
          // read as parallax when the lid turns, far enough to sort in
          // front of the surface it is the cover for
          glass.position.z = 0.5;
          glass.renderOrder = 2;
          anchor.add(glass);
          glassMat = glass.material as THREE.MeshPhysicalMaterial;

          model.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh && mesh !== panel) {
              // every mesh joins the key light's layer EXCEPT the display
              mesh.layers.enable(EYE_LEVEL);
            }
          });

          ready = true;
          this.status =
            `MacBook Pro GLB · display "${panel.name}" · ` +
            `${SCREEN.w}×${Math.round(SCREEN.w * (hLocal / wLocal))} css px = ` +
            `${wLocal.toFixed(2)}×${hLocal.toFixed(2)} model units · 1:1`;
          resolve();
        });
      });

      tick = () => {
        raf = requestAnimationFrame(tick!);
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (renderer.domElement.width !== w || camera.aspect !== w / h) {
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          frame2();
        }
        camera.position.set(truck, pedestal + mac.h * DROP, rest * dolly);
        pivot.rotation.set(rx, ry, 0);
        pivot.updateMatrixWorld(true);
        renderer.render(scene, camera);
        if (!ready) {
          return;
        }
        // ── the whole mapping, three lines ────────────────────────────
        const focal = perspective(camera.projectionMatrix.elements, h);
        layer.style.perspective = `${focal}px`;
        cam.style.transform = cameraCss(
          camera.matrixWorldInverse.elements,
          focal,
          w,
          h
        );
        // THE SEAM. The hole is a polygon edge, and the GPU antialiases it
        // by writing partial coverage into ALPHA — which NoBlending writes
        // verbatim, so the boundary comes out in a half-transparent
        // stair-step MSAA cannot fix because MSAA is what makes it. The
        // DOM plane's own edge IS properly antialiased, so oversizing it a
        // touch lays the clean edge over the ragged one.
        plane.style.transform = objectCss(anchor.matrixWorld.elements, 1.006);
        if (!this.drawn) {
          this.drawn = true;
        }
      };

      // leaving 3D stops the loop, and a stopped canvas keeps its last
      // frame forever — a ghost laptop under the flat one. Clear it.
      clear = () => renderer.clear();
      dispose = () => {
        cancelAnimationFrame(raf);
        raf = 0;
        renderer.dispose();
      };
      built = true;
      building = false;
      (window as LongTakeWindow).__take = {
        /**
         * Dial the cover glass from the console while the shot runs, which
         * is the only way to judge it: a reflection is a thing you tune by
         * watching it move across the screen, not by reading a number.
         * `GLOSS` above is where the answer goes.
         */
        gloss: (n: number) => {
          glassMat?.color.setScalar(n);
          return glassMat?.color.r;
        },
        /**
         * REMAKE THE 2D STILL. See `captureStill()` in vite.config.mjs.
         *
         * Renders one frame at the rest pose and posts the canvas back to
         * the dev server, alpha included — so the hole where the screen
         * goes is transparent in the file exactly as it is live, and the
         * still composites over the DOM the same way the canvas does.
         *
         * It returns the three strings the tick had just written, because
         * the picture and those matrices are ONE measurement: paste them
         * into FROZEN below in the same edit that replaces the file, or
         * the flat laptop and the flat screen will disagree.
         */
        capture: async () => {
          const was = { dolly, pedestal, rx, ry, truck };
          rx = 0;
          ry = 0;
          dolly = 1;
          truck = 0;
          pedestal = 0;
          /**
           * THE SET IS NOT IN THE PLATE.
           *
           * `setPlane` is a backdrop the size of a car park sitting behind the
           * laptop, and rendering it into the still baked a dark room into the
           * file. That cost the flat state everything: the plate could not be
           * composited over anything, so light mode could not have a light
           * ground, and because the plate is narrower than the stage it left
           * bands down both sides that no background colour could hide.
           *
           * The renderer already has `alpha: true`, so with the backdrop
           * hidden every pixel the laptop does not cover comes out
           * transparent, and the flat state becomes what the 3D state always
           * was: a device standing on whatever set the page is wearing.
           *
           * It costs nothing else. The aluminium's reflections come from the
           * PMREM environment, not from this plane, and there are no shadows
           * being cast onto it — it is a picture of a wall and nothing more.
           */
          setPlane.visible = false;
          tick?.();
          // read in the same turn as the draw: without
          // preserveDrawingBuffer the buffer is not guaranteed past it
          const data = canvas.toDataURL('image/webp', 0.94);
          setPlane.visible = true;
          tick?.();
          const said = await fetch('/__capture-still', {
            body: data,
            method: 'POST',
          }).then((r) => r.json());
          Object.assign(was, {});
          rx = was.rx;
          ry = was.ry;
          dolly = was.dolly;
          truck = was.truck;
          pedestal = was.pedestal;
          return {
            ...said,
            cam: cam.style.transform,
            h: host.clientHeight,
            perspective: layer.style.perspective,
            plane: plane.style.transform,
            w: host.clientWidth,
          };
        },
        state: () => ({ built, raf, ready, running, tick: !!tick }),
        look: (x: number, y: number) => {
          rx = x;
          ry = y;
        },
        plane: () => plane.getBoundingClientRect().toJSON(),
      };
    };

    /** idempotent: safe on every entry into 3D, built or not */
    const run3d = async () => {
      running = true;
      await build();
      if (!running || raf || !tick) {
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    /**
     * DRAG THE SET TO LOOK. A drag anywhere that is not the screen orbits
     * the laptop — and it takes the film's camera, because a drag means
     * "let me look" rather than "surprise me".
     */
    let dragging = false;
    let from = { rx: 0, ry: 0, x: 0, y: 0 };
    const track = (ev: PointerEvent) => {
      if (!dragging) {
        return;
      }
      const k = 0.0045;
      this.poseHost?.({
        pitch: ((from.rx + (ev.clientY - from.y) * k) * 180) / Math.PI,
        yaw: ((from.ry + (ev.clientX - from.x) * k) * 180) / Math.PI,
      });
    };
    const release = () => {
      dragging = false;
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    const grab = (ev: PointerEvent) => {
      if ((ev.target as HTMLElement)?.closest('.lt-plane, .lt-chrome')) {
        return;
      }
      dragging = true;
      this.seizeCamera();
      from = { rx, ry, x: ev.clientX, y: ev.clientY };
      window.addEventListener('pointermove', track);
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    };
    host.addEventListener('pointerdown', grab);

    /**
     * ONE POSE, TWO RENDERERS. The film publishes a pose; this applies it
     * to three.js AND to a handful of custom properties the flat laptop
     * is transformed by. There is no second camera track to keep in sync.
     */
    const pose: Camera3DState = { dolly: 1, pitch: 0, x: 0, y: 0, yaw: 0 };
    const lean: Camera3DState = { dolly: 0, pitch: 0, x: 0, y: 0, yaw: 0 };
    const LIMIT = RANGE;
    const clamp = (v: number, span?: readonly [number, number]) =>
      span ? Math.max(span[0], Math.min(span[1], v)) : v;
    const shown = (): Camera3DState => ({
      dolly: clamp(pose.dolly + lean.dolly, LIMIT.dolly),
      pitch: clamp(pose.pitch + lean.pitch, LIMIT.pitch),
      x: clamp(pose.x + lean.x, LIMIT.pan),
      y: clamp(pose.y + lean.y, LIMIT.pan),
      yaw: clamp(pose.yaw + lean.yaw, LIMIT.yaw),
    });
    const share = (at: Camera3DState) => {
      const pct = (v: number, [lo, hi]: readonly [number, number]) =>
        Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
      host.style.setProperty('--yaw-at', String(pct(at.yaw, LIMIT.yaw)));
      host.style.setProperty('--pitch-at', String(pct(at.pitch, LIMIT.pitch)));
      host.style.setProperty('--pan-x-at', String(pct(at.x, LIMIT.pan)));
      host.style.setProperty('--pan-y-at', String(pct(at.y, LIMIT.pan)));
      host.style.setProperty('--dolly-at', String(pct(at.dolly, LIMIT.dolly)));
    };
    const apply = () => {
      const at = shown();
      // the lid faces +Z at rest (the base extends toward the viewer), so
      // unlike the phone there is no half turn to undo
      ry = (at.yaw * Math.PI) / 180;
      rx = (at.pitch * Math.PI) / 180;
      dolly = at.dolly;
      // truck and pedestal as fractions of the framed width, so the same
      // pose reads the same whatever box the demo was given
      truck = at.x * SCREEN.w;
      pedestal = at.y * SCREEN.w;
      share(at);
    };
    this.shotHost = (next) => {
      Object.assign(pose, next);
      apply();
    };
    this.resetHost = () => {
      Object.assign(pose, { dolly: 1, pitch: 0, x: 0, y: 0, yaw: 0 });
      Object.assign(lean, { dolly: 0, pitch: 0, x: 0, y: 0, yaw: 0 });
      apply();
    };
    this.leanHost = (partial) => {
      Object.assign(lean, { dolly: 0, pitch: 0, x: 0, y: 0, yaw: 0 }, partial);
      apply();
    };
    this.poseHost = (partial, relative) => {
      if (relative) {
        for (const axis of ['yaw', 'pitch', 'x', 'y', 'dolly'] as const) {
          const add = partial[axis];
          if (add === undefined) {
            continue;
          }
          const span =
            axis === 'dolly'
              ? LIMIT.dolly
              : axis === 'yaw'
                ? LIMIT.yaw
                : axis === 'pitch'
                  ? LIMIT.pitch
                  : LIMIT.pan;
          pose[axis] = clamp(pose[axis] + add, span);
        }
      } else {
        Object.assign(pose, partial);
      }
      apply();
    };
    apply();

    this.boot = run3d;
    this.holdRendering = (held) => {
      if (held) {
        running = false;
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (this.mode === '3d') {
        void run3d();
      }
    };
    this.halt = () => {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      this.drawn = false;
      // a stopped canvas keeps its last frame forever — a ghost laptop
      // under the still, at whatever angle the film had reached
      clear?.();
      freeze();
    };

    return () => {
      this.halt?.();
      this.holdRendering = undefined;
      dispose?.();
      release();
      stopTheme?.();
      ro.disconnect();
      host.removeEventListener('pointerdown', grab);
      delete (window as LongTakeWindow).__take;
      this.boot = undefined;
      this.halt = undefined;
    };
  });

  <template>
    <div class="lt-page" data-mode={{this.mode}} {{onStage this.offstage}}>
      <Choreo
        class="lt-stage"
        data-ready={{if this.drawn "yes" ""}}
        @onCamera3D={{this.shot}}
        {{this.stage}}
        as |c|
      >
        {{! THE WORLD. Flat, this is REF-sized and scaled as one piece, so
            the still and the frozen matrices stay the single measurement
            they were taken as. In 3D it is the whole stage and the tick
            does the framing. }}
        <div class="lt-world">
          {{#if (this.isMode "2d")}}
            {{! the SAME laptop, photographed. Its screen is a transparent
                hole, punched by the display mesh at capture time, so the
                drawing composites through it exactly as it does live. }}
            <img
              class="lt-still"
              src={{STILL}}
              alt="A MacBook Pro at rest, the drawing on its screen"
              width={{REF.w}}
              height={{REF.h}}
            />
          {{/if}}
          <canvas></canvas>

          <div class="lt-css">
            <div class="lt-cam">
              <div class="lt-plane">
                <div class="lt-screen">
                  {{! THE BOOST. `backdrop-filter` re-renders everything
                    BEHIND this pane, so a transparent sheet over the
                    drawing lifts the whole panel's luminance without
                    touching a colour in the markup — the closest thing
                    the platform has to turning a screen up. }}
                  <div class="lt-boost" aria-hidden="true"></div>

                  {{! THE INNER CAMERA'S WHOLE WORLD. Its own region, its
                    own frame, its own score — and the outer stage tells
                    it only two things: whether to play, and which take
                    this is. }}
                  <Board
                    @playing={{this.playing}}
                    @take={{this.take}}
                    @onRun={{this.takeBoardRun}}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {{#if this.arming}}
          <p class="lt-loading">fetching the 3D engine…</p>
        {{/if}}

        {{! THE OUTER FILM. One `c.Camera3D` per shot, and its duration is
            the shot's own `move + hold` — the same number the board's
            camera is given. Neither region owns it, which is the only
            reason they cannot drift. }}
        {{#if this.playing}}
          <div
            class="lt-clock"
            data-take={{this.take}}
            style={{this.clockStyle}}
            aria-hidden="true"
            {{motion id="clock"}}
            {{this.wire c this.take}}
            {{this.sync}}
          >{{this.take}}</div>

          <c.Sequence>
            {{#each this.shots key="@index" as |shot|}}
              <c.Camera3D
                @yaw={{shot.yaw}}
                @pitch={{shot.pitch}}
                @dolly={{shot.dolly}}
                @duration={{this.legFor shot}}
                @ease={{this.glide}}
              />
            {{/each}}
          </c.Sequence>
        {{/if}}
      </Choreo>

      {{! THE CHROME PLANE. Outside the region: the transport and the
          sticks belong to the viewer, not to the shot. }}
      <div class="lt-chrome">
        <div class="lt-seg" role="group" aria-label="Presentation">
          <button
            type="button"
            aria-pressed="{{this.isMode '2d'}}"
            {{on "click" (fn this.choose "2d")}}
          >2D</button>
          <button
            type="button"
            aria-pressed="{{this.isMode '3d'}}"
            {{on "click" (fn this.choose "3d")}}
          >{{if this.arming "3D…" "3D"}}</button>
        </div>

        {{! NOTHING TO TRANSPORT WHILE FLAT. The still does not play, so a
            pause button over it is a control with nothing behind it. }}
        {{#if (this.isMode "3d")}}
          <div class="lt-transport">
            <button
              type="button"
              data-on={{if this.cameraOn "yes" ""}}
              {{on "click" this.toggleCamera}}
            >
              {{#if this.cameraOn}}
                <svg class="lt-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              {{else}}
                <svg class="lt-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              {{/if}}
              camera
            </button>
          </div>
        {{/if}}

        {{#if this.roomy}}
          <div class="lt-pads">
            <div class="lt-pad" {{this.padDrag "orbit"}}>
              <span class="lt-pad-dot"></span>
              <span class="lt-pad-name">rotate</span>
            </div>
            <div class="lt-pad" {{this.padDrag "pan"}}>
              <span class="lt-pad-dot"></span>
              <span class="lt-pad-name">pan</span>
            </div>
            <div class="lt-zoom" {{this.padDrag "dolly"}}>
              <span class="lt-zoom-dot"></span>
              <span class="lt-pad-name">dolly</span>
            </div>
          </div>
        {{/if}}
      </div>

      <style>
        .lt-page,
        .lt-page * {
          user-select: none;
          -webkit-user-select: none;
        }
        .lt-page {
          padding: 24px;
          font:
            12px/1.4 ui-monospace,
            monospace;
        }
        .lt-stage {
          position: absolute;
          inset: 0;
          overflow: hidden;
          touch-action: none;
          background:
            radial-gradient(
              120% 90% at 50% 8%,
              #23262d 0%,
              #14161b 46%,
              #090a0d 100%
            ),
            #14161b;
        }
        :root[data-theme="light"] .lt-stage {
          background:
            radial-gradient(
              120% 90% at 50% 8%,
              #6d7481 0%,
              #5b626e 46%,
              #3f444e 100%
            ),
            #5b626e;
        }
        /* THE FLAT STATE STANDS ON THE PAGE'S SET, NOT ON ITS OWN.

           The plate used to carry the set baked into its pixels, because the
           capture rendered setPlane — a backdrop the size of a car park — into
           the frame. That cost the flat state everything downstream: it could
           not be composited over anything, so light mode could not have a light
           ground, and since the plate is narrower than the stage it left bands
           down both sides that no background colour could hide.

           The capture now hides the backdrop, so the plate is a laptop on
           transparency and nothing else. Its alpha channel went from 830 bytes
           of uniform opacity to a real silhouette, and the whole file got
           smaller. The flat state is now exactly what the 3D state always was:
           a device standing on whatever set the page is wearing — which is the
           slate the mockup has used all along, lifted for light mode, because
           a photographic subject needs somewhere photographic to stand. */
        :root[data-theme="light"] .lt-page[data-mode="2d"] .lt-stage {
          background:
            radial-gradient(120% 90% at 50% 12%, #757c88 0%, #5b626e 100%),
            #5b626e;
        }

        /* THE CANVAS SITS ABOVE THE DOM, and that is what makes the
           laptop's own body occlude the drawing.

           There is no per-pixel depth test between a canvas and the DOM —
           they are separate compositing layers — so the ordering has to do
           the work. The display mesh punches its hole with `NoBlending`,
           and the DOM underneath shows through it. But the hole is
           depth-TESTED like anything else: where the base and the keyboard
           are nearer the camera than the lid, the display's fragments fail
           that test and the aluminium stays. So the drawing disappears
           behind the bottom of the laptop exactly when it should, out of
           the depth buffer that was already there.

           With the layers the other way round the DOM paints over
           everything and the board floats in front of the keyboard — the
           giveaway that a mockup is a texture pretending to be a screen. */
        /* FLAT: the reference box, scaled as one piece. In 3D the world
           is simply the stage and the framing solver does the work. */
        .lt-world {
          position: absolute;
          inset: 0;
        }
        .lt-page[data-mode="2d"] .lt-world {
          inset: auto;
          top: 50%;
          left: 50%;
          width: 1178px;
          height: 838px;
          transform: translate(-50%, -50%) scale(var(--k, 1));
        }
        .lt-still {
          position: absolute;
          inset: 0;
          z-index: 2;
          width: 100%;
          height: 100%;
          pointer-events: none;
          /* the still already carries the set it was shot on; nothing may
             tint or scale it independently of the plane behind it */
          user-select: none;
        }
        .lt-page[data-mode="2d"] .lt-stage canvas {
          display: none;
        }
        .lt-stage canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 2;
          pointer-events: none;
        }
        .lt-css {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .lt-cam {
          position: absolute;
          inset: 0;
          transform-style: preserve-3d;
        }
        .lt-plane {
          position: absolute;
          top: 0;
          left: 0;
          transform-style: preserve-3d;
          pointer-events: auto;
        }
        .lt-screen {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background: #0a1420;
        }
        .lt-boost {
          position: absolute;
          inset: 0;
          z-index: 8;
          pointer-events: none;
          backdrop-filter: brightness(1.3) saturate(1.1);
          -webkit-backdrop-filter: brightness(1.3) saturate(1.1);
        }
        .lt-clock {
          position: absolute;
          left: -9999px;
          top: -9999px;
          opacity: 0;
          pointer-events: none;
        }
        .lt-loading {
          position: absolute;
          z-index: 3;
          left: 0;
          right: 0;
          top: 50%;
          margin: 0;
          text-align: center;
          font: 11px/1 var(--font-mono, ui-monospace, monospace);
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #ffffff8c;
        }

        /* ── the player ──────────────────────────────────────────────── */

        .lt-seg,
        .lt-transport {
          position: absolute;
          z-index: 4;
          top: 10px;
          display: flex;
          gap: 6px;
        }
        .lt-transport {
          left: 10px;
        }
        .lt-seg {
          right: 10px;
        }
        .lt-seg button,
        .lt-transport button {
          all: unset;
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          padding: 7px 12px;
          border: 1px solid #ffffff5c;
          border-radius: 999px;
          background: transparent;
          color: #ffffff;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          line-height: 1;
          white-space: nowrap;
        }
        /* 3D IS ALWAYS THE FILLED PILL, and it is the only saturated thing on
           the stage.

           It used to be an ember OUTLINE while flat and a filled pill only once
           you were already in 3D — which is backwards twice over. An outline in
           the accent colour, at 11px, on a slate set, is an invitation you have
           to go looking for; and filling it at the moment it becomes the
           current state spends the emphasis on the one press nobody needs to
           make. The filled pill marks the thing worth pressing, so it belongs
           on 3D always: flat, it is the way in; in 3D, it is where you are, and
           it is the same shape either way rather than a control that changes
           under the hand.

           2D never gets the white fill it used to have while flat. A selected
           state that outranks the primary action is a selected state arguing
           with it — and the mode is legible from the picture anyway, which is
           either a still or a room. */
        .lt-seg button:last-child {
          background: var(--ember-hot, #ff6a3a);
          border-color: var(--ember-hot, #ff6a3a);
          color: #ffffff;
          font-weight: 700;
        }
        .lt-page[data-mode="2d"] .lt-seg button:last-child {
          animation: lt-beckon 2.6s ease-in-out infinite;
        }
        @keyframes lt-beckon {
          0%,
          100% {
            box-shadow: 0 0 0 0 #ff6a3a00;
          }
          50% {
            box-shadow: 0 0 0 4px #ff6a3a26;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .lt-page[data-mode="2d"] .lt-seg button:last-child {
            animation: none;
          }
        }
        .lt-transport button[data-on="yes"] {
          border-color: #ffffff8f;
          background: #ffffff1f;
        }
        .lt-ico {
          width: 12px;
          height: 12px;
          margin-right: 5px;
          vertical-align: -1px;
          fill: currentColor;
        }

        /* GLASSMORPHIC THUMB CONTROLS: a frosted disc that sits on the
           picture rather than in a panel beside it, and a knob that rides
           a spring inside it. */
        .lt-pads {
          position: absolute;
          z-index: 5;
          right: 14px;
          bottom: 26px;
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .lt-pad,
        .lt-zoom {
          position: relative;
          touch-action: none;
          cursor: grab;
          border-radius: 999px;
          border: 1px solid #ffffff2e;
          background: linear-gradient(
            160deg,
            #ffffff26 0%,
            #ffffff0f 42%,
            #ffffff08 100%
          );
          backdrop-filter: blur(14px) saturate(1.4);
          -webkit-backdrop-filter: blur(14px) saturate(1.4);
          box-shadow:
            0 1px 0 #ffffff3d inset,
            0 8px 20px -8px #00000073;
        }
        .lt-pad:active,
        .lt-zoom:active {
          cursor: grabbing;
        }
        .lt-pad {
          width: 54px;
          height: 54px;
        }
        .lt-zoom {
          width: 32px;
          height: 54px;
        }
        /* THERE IS NOTHING TO ROTATE IN A PHOTOGRAPH. */
        .lt-page[data-mode="2d"] .lt-pads {
          display: none;
        }
        .lt-pad-name {
          position: absolute;
          left: 0;
          right: 0;
          bottom: -12px;
          text-align: center;
          font: 9px/1 var(--font-mono, ui-monospace, monospace);
          color: var(--ink-faint, #b8aea3);
          letter-spacing: 0.04em;
          pointer-events: none;
        }
        .lt-pad-dot,
        .lt-zoom-dot {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 21px;
          height: 21px;
          margin: -10.5px 0 0 -10.5px;
          border-radius: 50%;
          pointer-events: none;
          background: radial-gradient(
            120% 120% at 34% 26%,
            #ffffffe6 0%,
            #ffffff8c 40%,
            #ffffff33 100%
          );
          box-shadow:
            0 2px 6px #00000059,
            0 0 0 1px #ffffff40 inset;
          transform: translate(
            calc(var(--knob-x, 0) * 15px),
            calc(var(--knob-y, 0) * 15px)
          );
        }
        .lt-zoom-dot {
          width: 19px;
          height: 19px;
          margin: -9.5px 0 0 -9.5px;
          transform: translate(0, calc(var(--knob-y, 0) * 14px));
        }
        /* THE STICKS BELONG TO THE DEMO'S OWN PAGE, and that is a
           question about the CONTAINER, not about its height. Hiding them
           under a height threshold also hid them on a phone — where the
           demo is the page, the stage is short by definition, and turning
           the device by hand is the whole point. They are gated on the
           same fact the film is: see `onOwnPage`. */
        /* SMALLER ON A NARROW SCREEN, not absent. Three 54px discs are
           half the width of a phone; at 42 they are a control rather than
           a panel, and the demo keeps the one affordance that makes the
           device feel like an object you can turn. */
        @media (max-width: 760px) {
          .lt-pads {
            gap: 10px;
            right: 10px;
            bottom: 22px;
          }
          .lt-pad {
            width: 42px;
            height: 42px;
          }
          .lt-zoom {
            width: 26px;
            height: 42px;
          }
        }
      </style>
    </div>
  </template>
}

export default LongTake;
