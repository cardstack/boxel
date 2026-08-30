import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import {
  beacon,
  type Camera3DState,
  Choreo,
  type ChoreoContext,
  motion,
  type PerformCommand,
} from 'glimmer-motion';
import { ClockApp } from 'test-app/components/mockup/clock';
import { MailApp } from 'test-app/components/mockup/mail';
import { MapsApp } from 'test-app/components/mockup/maps';
import { MusicApp } from 'test-app/components/mockup/music';
import { NotesApp } from 'test-app/components/mockup/notes';
import { PhotosApp } from 'test-app/components/mockup/photos';
import { cameraCss, objectCss, perspective } from 'test-app/lib/css3d';
import type * as THREE from 'three';

/**
 * SPIKE 2 — mockup-studio's GLB in WebGL, and the phone's SCREEN as live
 * DOM, mapped onto the mesh by the one piece of ember-lume /
 * CSS3DRenderer worth taking: the coordinate mapping (`app/lib/css3d.ts`).
 *
 * mockup-studio paints its screen into a canvas and uploads it as a
 * texture, so the UI is pixels. Here the same mesh is rendered by WebGL
 * and the screen is real DOM — clickable, animating, and the same markup
 * in both 2D and 3D. That is the whole claim, and the segmented control
 * exists so the two can be put side by side.
 *
 * The icon-to-app flight names both poses rather than measuring them —
 * see `panel` — but the FILM is Choreo through and through: `c.Perform`
 * cues open and close the apps, `c.Camera3D` flies the shot in 3D, and
 * `c.Camera` zooms the platter in 2D. One score, two lenses.
 */

/** the DOM screen is authored at a real iPhone's logical resolution */
const SCREEN = { h: 844, w: 390 };
/** the home screen, in that resolution's own pixels */
const TILE = 82;
const RADIUS = { app: 46, tile: 20 };
/** 36 is the one pad that makes the gutter equal it: 390 = 2·36 + 2·36 + 3·82 */
const PAD = 36;
const GAP = (SCREEN.w - PAD * 2 - TILE * 3) / 2;
/** a cell is 82 tile + 9 gap + 18 label = 109, so 146 apart is a 37px
 *  gutter — the same air between the rows as between the columns */
const ROW = [104, 250];

/**
 * The grid is AUTHORED, not measured. Every tile's box is a constant in
 * the screen's own coordinates, so the panel that grows out of a tile
 * reads its from-box from arithmetic — no `getBoundingClientRect`, and
 * therefore nothing a camera, a perspective or a 54° tilt can make
 * wrong. It is also why the home screen never moves: the icons are
 * placed absolutely and the app is an overlay, so opening one changes no
 * other element's layout at all.
 */
const APPS = [
  { Ui: MailApp, hue: 8, id: 'mail', label: 'Mail' },
  { Ui: NotesApp, hue: 140, id: 'notes', label: 'Notes' },
  { Ui: MapsApp, hue: 210, id: 'maps', label: 'Maps' },
  { Ui: MusicApp, hue: 275, id: 'music', label: 'Music' },
  { Ui: PhotosApp, hue: 32, id: 'photos', label: 'Photos' },
  { Ui: ClockApp, hue: 190, id: 'clock', label: 'Clock' },
].map((app, i) => ({
  ...app,
  x: PAD + (i % 3) * (TILE + GAP),
  y: ROW[Math.floor(i / 3)]!,
}));
type App = (typeof APPS)[number];

/**
 * Quick out, long settle, no overshoot to wobble the type — and opacity
 * on its own much shorter clock. Faded across the whole growth the panel
 * is a ghost with the home screen showing through it for half a second;
 * opaque by the time it has left the tile, it reads as the tile itself
 * getting bigger.
 */
/** what the home screen throws onto the rails: a cool, dim wash */
const HOME_GLOW = 0x9fb4d6;

/** an app's tile colour as a flat hex, for the light it spills */
const hsl = (hue: number): number => {
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = 0.62 * Math.min(0.7, 1 - 0.7);
    return Math.round(
      255 * (0.7 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
    );
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
};

/** the share of the platter the phone fills once framed */
const FILL = 0.76;

/** the layer the eye-level key light lives on, and the screen does not */
const EYE_LEVEL = 1;

const SWELL = {
  duration: 0.5,
  ease: [0.22, 1, 0.36, 1],
  // opacity on its own much shorter clock: faded across the whole growth
  // the panel is a ghost with the home screen showing through it
  opacity: { duration: 0.12, ease: 'linear' },
} as const;
const FADE = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;
/** while a finger is on it, the pose is not animated — it IS the finger */
const LIVE = { duration: 0.001, ease: 'linear' } as const;

/**
 * THE SHOT LIST. One score, two cameras.
 *
 * The beats are identical in both modes — the same apps open and close on
 * the same counts — and only the camera differs: `c.Camera3D` hands an
 * orbit pose to three.js in 3D, `c.Camera` moves the region's own frame
 * in 2D. That is the argument for making the 3D camera a step rather than
 * a callback: the direction reads the same either way, and both are
 * seekable because both are sampled from the clock.
 */
const SCENES = [
  /**
   * THE SHOT LIST, written as a shoot would write it.
   *
   * Every scene is APPROACH → OPEN → READ → CLOSE, and between scenes the
   * camera returns to HOME. That return is not decoration: an app that
   * cuts straight to the next app never shows you where it came from, and
   * the whole point of a phone film is that the home screen is the hub.
   *
   * `read` is where the money is. It pushes in — often very close — and
   * PANS at the same time, because dolly alone crops a tall subject: push
   * on a phone and its top leaves frame. `x` and `y` are fractions of the
   * framed height, so a positive `y` lifts the camera and brings the top
   * of the screen back down into the picture.
   *
   * Dwell is earned, not equal. Maps and Music have things to look at and
   * get five and a half seconds with a slow drift across them. Photos is
   * not what this demo is about and gets two and a half — long enough to
   * register, short enough not to sit there.
   */
  {
    app: 'mail',
    approach: { dolly: 1.0, pitch: -9, x: 0, y: 0, yaw: -18 },
    hold: 4.4,
    read: { dolly: 0.62, pitch: -4, x: 0.02, y: 0.2, yaw: -7 },
    zoom: { x: 6, y: 96, z: 1.6 },
  },
  {
    app: 'maps',
    approach: { dolly: 1.02, pitch: -7, x: 0, y: 0, yaw: 14 },
    hold: 5.6,
    read: { dolly: 0.56, pitch: -2, x: -0.04, y: -0.12, yaw: 9 },
    zoom: { x: -10, y: -70, z: 1.8 },
  },
  {
    app: 'music',
    approach: { dolly: 0.98, pitch: -11, x: 0, y: 0, yaw: 22 },
    hold: 5.6,
    read: { dolly: 0.54, pitch: -3, x: 0.05, y: 0.14, yaw: 11 },
    zoom: { x: 8, y: 74, z: 1.85 },
  },
  {
    app: 'notes',
    approach: { dolly: 1.0, pitch: -8, x: 0, y: 0, yaw: -12 },
    hold: 4.2,
    read: { dolly: 0.66, pitch: -4, x: 0.02, y: 0.17, yaw: -5 },
    zoom: { x: 6, y: 84, z: 1.55 },
  },
  {
    app: 'clock',
    approach: { dolly: 1.0, pitch: -6, x: 0, y: 0, yaw: 8 },
    hold: 3.6,
    read: { dolly: 0.7, pitch: -2, x: 0, y: 0.04, yaw: 4 },
    zoom: { x: 0, y: 18, z: 1.45 },
  },
  {
    // not the feature: seen, not studied
    app: 'photos',
    approach: { dolly: 1.02, pitch: -7, x: 0, y: 0, yaw: -6 },
    hold: 2.5,
    read: { dolly: 0.84, pitch: -5, x: 0, y: 0.08, yaw: -2 },
    zoom: { x: 0, y: 34, z: 1.2 },
  },
] as const;

/**
 * The ranges the manual controls span. They are the same numbers the
 * script writes, so the dots the film moves and the dots you drag are the
 * same dots — there is one pose, and two ways to set it.
 */
const RANGE = {
  dolly: [0.45, 1.3],
  pan: [-0.5, 0.5],
  pitch: [-35, 35],
  yaw: [-70, 70],
} as const;

/** where the camera waits while the home screen is up, between scenes */
const HOME_SHOT = { dolly: 1.06, pitch: -8, x: 0, y: -0.05, yaw: 4 } as const;
/** the camera travels to the approach in this long */
const TRAVEL = 1.8;
/** and comes home in this long, which IS the home-screen beat */
const RETURN = 1.5;
/** the editorial curve: recorded motion glides where a UI snaps */
const GLIDE = [0.65, 0, 0.35, 1] as const;

interface SpikeWindow extends Window {
  __glb?: unknown;
}

export class Mockup extends Component {
  @tracked open: App | null = null;
  /**
   * How far the swipe-up has carried the app back toward its tile, 0..1.
   * The gesture drives this directly, so the panel is under the finger
   * rather than playing a canned animation at it — which is the whole
   * difference between a phone gesture and a button.
   */
  @tracked swipe = 0;
  /** which tile the panel is parked on while closed */
  @tracked parked: App = APPS[0]!;
  /** 2D by default: the 3D engine is not downloaded until it is asked for */
  @tracked mode: '2d' | '3d' = '2d';
  @tracked status = 'flat — the same DOM, no engine loaded';

  /**
   * TWO TRACKS, TWO SWITCHES.
   *
   * The film drives two independent things: the CAMERA (where the shot
   * stands) and the APP INTERACTION (which app is open). They are stopped
   * by different gestures because they answer to different intents — a
   * drag means "let me look", a tap on the screen means "let me use it" —
   * and either can be handed back without disturbing the other.
   */
  @tracked cameraOn = true;
  @tracked syncOn = true;
  /**
   * A GALLERY CARD DOES NOT RUN A FILM.
   *
   * The film loops by design, so on the demo's own page it simply plays.
   * In the grid that is thirty-odd cards each holding a WebGL context and
   * re-rendering the page forever — expensive, distracting, and it kept
   * the gallery's own entrance animation from ever settling. So a stage
   * shorter than a card's worth of room opens paused, with the controls
   * right there to start it.
   */
  @tracked roomy = true;
  /** bumped to recompile the score, which is how the film loops */
  @tracked take = 0;
  private region?: { run: { finished: Promise<void> } | null };
  private shotHost?: (state: Camera3DState) => void;
  /** drag a pad: hand the host a pose directly, and stop the film's camera */
  private poseHost?: (partial: Partial<Camera3DState>) => void;
  private boot?: () => Promise<void>;
  private halt?: () => void;
  private tint?: (hex: number) => void;

  readonly apps = APPS;
  readonly screen = SCREEN;

  choose = (app: App) => {
    // TWO STEPS, ON PURPOSE. `{{motion}}` animates from where the element
    // actually IS, and while closed the panel is parked on whichever tile
    // it last came out of. Flipping `parked` and `open` in one render
    // makes it grow out of the OLD icon on its way to the screen. So the
    // panel is planted on the tapped tile first — a render with `open`
    // still false, which is instant because the pose it is moving to is
    // the pose it is already drawn at — and only then told to open.
    this.parked = app;
    this.tint?.(hsl(app.hue));
    if (this.open) {
      this.open = app; // already up: a straight swap, nothing to plant
      return;
    }
    requestAnimationFrame(() => {
      if (this.parked === app) {
        this.open = app;
      }
    });
  };

  close = () => {
    this.open = null;
    this.swipe = 0;
    this.tint?.(HOME_GLOW);
  };

  /**
   * THE HOME GESTURE. A swipe up from the bottom edge sends the app back
   * to its icon; anything short of the threshold falls back into place.
   *
   * It has to stop the pointer reaching the stage, or the same drag would
   * also be orbiting the phone — the gesture starts inside the screen,
   * which is otherwise a place you turn the device from.
   */
  swiper = modifier((el: HTMLElement) => {
    const TRAVEL = 150;
    const COMMIT = 0.4;
    let from: number | null = null;
    const move = (ev: PointerEvent) => {
      if (from === null) {
        return;
      }
      this.swipe = Math.max(0, Math.min(1, (from - ev.clientY) / TRAVEL));
    };
    const done = () => {
      if (from === null) {
        return;
      }
      from = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      if (this.swipe >= COMMIT) {
        this.close();
      } else {
        this.swipe = 0;
      }
    };
    const start = (ev: PointerEvent) => {
      if (!this.open) {
        return;
      }
      ev.stopPropagation(); // this drag is a gesture, not an orbit
      from = ev.clientY;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', done);
      window.addEventListener('pointercancel', done);
    };
    el.addEventListener('pointerdown', start);
    return () => {
      el.removeEventListener('pointerdown', start);
      done();
    };
  });

  setMode = (mode: '2d' | '3d') => {
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    if (mode === '3d') {
      void this.boot?.();
    } else {
      this.halt?.();
      this.status = 'flat — the same DOM, no engine loaded';
    }
  };

  isMode = (mode: '2d' | '3d') => this.mode === mode;

  readonly scenes = SCENES;
  readonly travel = TRAVEL;
  readonly returnFor = RETURN;
  readonly home = HOME_SHOT;
  readonly glide = GLIDE;

  /**
   * The film's cues arrive here. `c.Perform` is the construct for exactly
   * this: a semantic command on the timeline that the host executes, so
   * the score says "open mail" rather than remembering a click.
   *
   * The write is deferred a frame ON PURPOSE. A command is dispatched
   * during the region's own pass, and a tracked write there re-renders
   * the region, replays the pass, and cancels the run that was
   * dispatching — the trap `examples/fold.gts` documents. A frame later
   * the pass is over and the write is an ordinary one.
   */
  dispatch = (command: PerformCommand) => {
    const app = APPS.find((a) => a.id === command.target);
    requestAnimationFrame(() => {
      if (command.action === 'open' && app) {
        this.parked = app;
        this.open = app;
        this.tint?.(hsl(app.hue));
      } else if (command.action === 'close') {
        this.open = null;
        this.tint?.(HOME_GLOW);
      }
    });
  };

  /** a seek backwards cannot un-execute a command; it re-derives from zero */
  reset = () => {
    requestAnimationFrame(() => {
      this.open = null;
    });
  };

  /** the shot, straight from the score, applied to whatever is drawing */
  shot = (state: Camera3DState) => {
    this.shotHost?.(state);
  };

  /**
   * A pad was dragged. Taking hold of the camera stops the film's camera
   * track — the same rule a drag on the phone follows — and the pose goes
   * straight to the host.
   */
  grabPose = (partial: Partial<Camera3DState>) => {
    this.seizeCamera();
    this.poseHost?.(partial);
  };

  /** a DRAG means "let me look": the camera stops, the apps carry on */
  seizeCamera = () => {
    if (this.cameraOn) {
      this.cameraOn = false;
    }
  };

  /** a TAP on the screen means "let me use it": the app cues stop */
  seizeApps = () => {
    if (this.syncOn) {
      this.syncOn = false;
    }
  };

  toggleCamera = () => {
    this.cameraOn = !this.cameraOn;
    if (this.cameraOn) {
      this.take += 1;
    }
  };

  toggleSync = () => {
    this.syncOn = !this.syncOn;
    if (this.syncOn) {
      this.take += 1;
    }
  };

  get running() {
    return this.cameraOn || this.syncOn;
  }

  /**
   * Drag a pad. Each maps its box to a pair of pose values — the orbit
   * pad to yaw and pitch, the pan pad to truck and pedestal, the rail to
   * dolly — and writes straight through to the host.
   */
  padDrag = modifier((el: HTMLElement, [kind]: [string]) => {
    const at = (ev: PointerEvent) => {
      const b = el.getBoundingClientRect();
      return {
        u: Math.max(0, Math.min(1, (ev.clientX - b.left) / (b.width || 1))),
        v: Math.max(0, Math.min(1, (ev.clientY - b.top) / (b.height || 1))),
      };
    };
    const lerp = ([lo, hi]: readonly [number, number], t: number) =>
      lo + (hi - lo) * t;
    const write = (ev: PointerEvent) => {
      const { u, v } = at(ev);
      if (kind === 'orbit') {
        this.grabPose({
          pitch: lerp(RANGE.pitch, v),
          yaw: lerp(RANGE.yaw, u),
        });
      } else if (kind === 'pan') {
        this.grabPose({ x: lerp(RANGE.pan, u), y: lerp(RANGE.pan, 1 - v) });
      } else {
        this.grabPose({ dolly: lerp(RANGE.dolly, 1 - u) });
      }
    };
    let down = false;
    const move = (ev: PointerEvent) => {
      if (down) {
        write(ev);
      }
    };
    const up = () => {
      down = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    const start = (ev: PointerEvent) => {
      ev.stopPropagation();
      down = true;
      write(ev);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    el.addEventListener('pointerdown', start);
    return () => {
      el.removeEventListener('pointerdown', start);
      up();
    };
  });

  /** hold the region so the film can loop when its score finishes */
  wire = modifier((_el: HTMLElement, [c]: [ChoreoContext, number]) => {
    this.region = c as unknown as { run: { finished: Promise<void> } | null };
    const run = this.region.run;
    if (!run) {
      return;
    }
    let live = true;
    void run.finished.then(() => {
      if (live && this.running) {
        this.take += 1;
      }
    });
    return () => {
      live = false;
    };
  });

  /**
   * THE APP, as two named poses again.
   *
   * The beacon version of this flight was exact in 2D and head-on, and
   * wrong by 42px at a 54° tilt — and it landed on a MEASURED box rather
   * than the CSS one, so the panel jumped at the end of every open. Both
   * are the same fact: a beacon is a page-space measurement, the page is
   * behind a 3D camera, and a projection is not a scale. The tiles still
   * carry their beacons — they cost nothing and the moment beacons are
   * measured in plane-local space this can go straight back.
   *
   * Named poses have no such error at any angle, because there is nothing
   * to measure: open is the screen, closed is the tile, and both are
   * arithmetic on the authored grid.
   */
  get panel() {
    const tile = {
      borderRadius: RADIUS.tile,
      height: TILE,
      left: this.parked.x,
      opacity: 0,
      top: this.parked.y,
      width: TILE,
    };
    if (!this.open) {
      return tile;
    }
    const full = {
      borderRadius: RADIUS.app,
      height: SCREEN.h,
      left: 0,
      opacity: 1,
      top: 0,
      width: SCREEN.w,
    };
    const p = this.swipe;
    if (p === 0) {
      return full;
    }
    // mid-gesture: the app rides between the two poses. iOS only takes it
    // PART of the way home while the finger is down — the last of the
    // journey belongs to the release — so the drag is scaled to 0.55 and
    // opacity is left alone, because a card you can still let go of has
    // not started disappearing.
    const k = p * 0.55;
    const at = (a: number, b: number) => a + (b - a) * k;
    return {
      borderRadius: at(full.borderRadius, tile.borderRadius),
      height: at(full.height, tile.height),
      left: at(full.left, tile.left),
      opacity: 1,
      top: at(full.top, tile.top),
      width: at(full.width, tile.width),
    };
  }

  /** under the finger the pose must be immediate; released, it springs */
  get swell() {
    return this.swipe > 0 ? LIVE : SWELL;
  }

  /** the app's own title: it FADES. It is never the icon's label morphed. */
  get title() {
    return { opacity: this.open ? 1 : 0 };
  }

  get shown() {
    return this.open ?? this.parked;
  }

  stage = modifier((host: HTMLElement) => {
    const canvas = host.querySelector('canvas')!;
    const layer = host.querySelector<HTMLElement>('.mg-css')!;
    const cam = host.querySelector<HTMLElement>('.mg-cam')!;
    const plane = host.querySelector<HTMLElement>('.mg-plane')!;

    /**
     * ONE FIT, TWO CONSUMERS. The 3D camera solves its distance so the
     * phone fills FILL of the box; the flat phone must land at exactly
     * the same size or the 2D/3D switch resizes the device under you.
     * So the same fraction is written out as `--k` and the flat phone is
     * scaled by it — continuously, at any container size, rather than at
     * a handful of breakpoints.
     */
    // decided once, on mount: is there room to play a film here?
    this.roomy = host.clientHeight >= 460;
    if (!this.roomy) {
      this.cameraOn = false;
      this.syncOn = false;
    }

    const fitFlat = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      const k = Math.min((h * FILL) / SCREEN.h, (w * FILL) / SCREEN.w);
      host.style.setProperty('--k', String(k));
    };
    fitFlat();
    const ro = new ResizeObserver(fitFlat);
    ro.observe(host);

    let raf = 0;
    let running = false;
    let built = false;
    let building = false;
    let ready = false;
    /** set once the scene exists; re-entry restarts THIS, not the build */
    let tick: (() => void) | undefined;
    let clear: (() => void) | undefined;
    let mapped = '';
    let rx = -0.12;
    let ry = Math.PI + 0.3;
    /** the score's push-in, as a multiple of the fitted distance */
    let dolly = 1;
    /** the score's truck and pedestal, in world px */
    let truck = 0;
    let pedestal = 0;
    let dispose: (() => void) | undefined;
    let keyLight: THREE.Object3D | undefined;
    let screenGlow: THREE.RectAreaLight | undefined;

    /**
     * Everything 3D lives behind this. `three` plus a GLTF loader, a
     * DRACO decoder and an environment is a megabyte and a half of
     * JavaScript and another of model and decoder — none of which a
     * visitor looking at the flat screen has any use for. It is fetched
     * on the first press of "3D" and never again.
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
      // five sources clip to white without it; this is the curve product
      // footage is graded on
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const scene = new T.Scene();
      const pmrem = new T.PMREMGenerator(renderer);

      /**
       * THE ROOM, built rather than borrowed — and there are two of them,
       * for the same reason a real set has flags.
       *
       * A phone is two materials with opposite needs. The titanium wants
       * a BRIGHT room: metal is nothing but the reflection of its
       * surroundings, and in a dark room it reads as painted plastic.
       * The glass wants a DARK one: it is a mirror, so a bright room
       * comes back as a white sheet over the UI and no amount of light
       * tuning fixes it.
       *
       * `RoomEnvironment` is one bright box for everything, which is why
       * it forced a choice between a milky screen and a dead body. On a
       * set you do not choose — you light the product and flag the
       * screen. `scene.environment` is the lit set; the display carries
       * its OWN `envMap`, the same room with the lamps down and a flag
       * across the lens azimuth.
       *
       * Both are painted in equirectangular space: u is the compass with
       * 0 at the lens, v is elevation, top of the canvas is up.
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

      // THE SET, for the body: mid-grey walls so the titanium has
      // something to be, a broad overhead, a tall book light camera-left
      // for the streak down the rail, a warm kicker behind-right, and a
      // table bounce underneath.
      scene.environment = cyc('#3a4049', [
        [0.0, 0.08, 0.5, 0.16, '#ffffff', 1],
        [-0.22, 0.44, 0.16, 0.72, '#e8f0ff', 0.95],
        [0.34, 0.4, 0.14, 0.6, '#ffdcb4', 0.85],
        [0.05, 0.94, 0.4, 0.12, '#aab2c0', 0.6],
      ]);

      // THE FLAGGED ROOM, for the glass: the same set with the lamps
      // down, near-black walls, and NOTHING at the lens azimuth — so the
      // middle of the screen, where the UI is, reflects darkness and the
      // only highlight it carries is the overhead strip near the top.
      const flagged = cyc('#05060a', [
        [0.0, 0.07, 0.34, 0.07, '#ffffff', 0.95],
        [-0.26, 0.4, 0.07, 0.5, '#9fb4d6', 0.5],
        [0.36, 0.38, 0.06, 0.4, '#c9a27a', 0.4],
      ]);

      const camera = new T.PerspectiveCamera(38, 1, 1, 20000);
      camera.position.set(0, 0, 1500);
      /**
       * FIT THE PHONE TO THE PLATTER. World units are CSS pixels here, so
       * framing is arithmetic: the height a perspective camera shows at
       * distance d is 2·d·tan(fov/2), and the same in width once the
       * aspect is folded in. Solve both for d, take whichever is further
       * away, and the phone fills its share of whatever box the demo is
       * given — a gallery card, a full page, a phone in portrait.
       */
      let phone = { h: 900, w: 420 };
      let rest = 1500;
      /** the phone sits slightly low in frame, so the control bar across
       *  the top has air above the device instead of crowding it */
      const DROP = 0.045;
      const frame2 = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        const vFov = (camera.fov * Math.PI) / 180;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (w / h));
        const dV = phone.h / FILL / 2 / Math.tan(vFov / 2);
        const dH = phone.w / FILL / 2 / Math.tan(hFov / 2);
        rest = Math.max(dV, dH);
      };

      /**
       * THE RIG. A product shoot, not a scene: big soft sources for the
       * long specular that runs down a metal rail, a warm kicker to lift
       * the silhouette off the background, and one small hard source for
       * a glint on the camera bump. RectAreaLight is what makes a
       * softbox a softbox — a point light gives a dot, an area light
       * gives the streak.
       */
      RectAreaLightUniformsLib.init();
      /**
       * THE UNITS, on top of the room. The cyc above does the ambient
       * work — what these add is the crisp, directional specular that
       * an image-based light cannot: the hard streak down a rail, the
       * glint off the camera ring.
       */
      scene.add(new T.AmbientLight(0xffffff, 0.18));

      /**
       * KEY, at eye level — and the ONE unit the screen may not see.
       *
       * A source level with the lens reflects off the glass straight back
       * down it, which is a white sheet over the UI rather than a
       * highlight. three.js filters lights per object by LAYER: a light
       * lights an object only when they share one. This one lives alone
       * on layer 1 and every mesh joins layer 1 EXCEPT the display — so
       * it models the body and the glass never sees it. It is the direct
       * equivalent of the black flag painted into the room.
       */
      const key = new T.RectAreaLight(0xffffff, 4.6, 1250, 1650);
      key.position.set(-760, 80, 1120);
      key.lookAt(0, 0, 0);
      key.layers.set(EYE_LEVEL);
      scene.add(key);

      /** overhead strip: the one highlight a glossy screen SHOULD carry.
       *  Long, shallow, high and only just in front, so it mirrors as a
       *  band near the top edge instead of a sheet over the icons. */
      const top = new T.RectAreaLight(0xffffff, 2.4, 1500, 320);
      top.position.set(90, 1950, 240);
      top.lookAt(0, 0, 0);
      scene.add(top);

      /** book light camera-left: the long specular down the titanium */
      const book = new T.RectAreaLight(0xd6e6ff, 2.2, 420, 1500);
      book.position.set(-1150, 380, 520);
      book.lookAt(0, 0, 0);
      scene.add(book);

      /** warm kicker behind-right: the rim that cuts it off the page */
      const kick = new T.RectAreaLight(0xffe0b8, 4.4, 560, 1450);
      kick.position.set(880, 560, -980);
      kick.lookAt(0, 0, 0);
      scene.add(kick);

      /** bounce card low and in front — a big dim source standing in for
       *  the table, so the bottom third is modelled rather than black */
      const bounce = new T.RectAreaLight(0xbfc7d4, 1.1, 1600, 700);
      bounce.position.set(0, -1150, 700);
      bounce.lookAt(0, 0, 0);
      bounce.layers.set(EYE_LEVEL);
      scene.add(bounce);

      /** one hard source for the glint on the camera ring. three counts
       *  point lights in candela, so reaching this far with decay 2 is a
       *  large number by construction, not by taste. */
      const glint = new T.PointLight(0xffffff, 750_000, 0, 2);
      glint.position.set(-360, 1000, 720);
      scene.add(glint);

      /**
       * SCREEN GLOW — the tell that a display is actually on.
       *
       * A lit panel throws its own colour onto everything around it, and
       * on a phone that means the inner bezel and the top of the rails
       * pick up whatever is on screen. So: a source the size of the
       * display, just in front of it, facing back at the phone, tinted
       * by the app that is open. It is on the flagged layer, because the
       * one surface it must NOT light is the glass it is standing on.
       */
      const glow = new T.RectAreaLight(0xffffff, 1.6, SCREEN.w, 843);
      glow.position.set(0, 0, -560);
      glow.lookAt(0, 0, 0);
      glow.layers.set(EYE_LEVEL);
      scene.add(glow);
      screenGlow = glow;
      keyLight = key;

      /**
       * THE SET. A backdrop the phone stands in front of, so the eye can
       * tell the two motions apart: when the SHOT moves, the set slides
       * and the horizon shifts; when the DEVICE turns, the set holds
       * still and only the phone rotates. Without it a yaw and an orbit
       * are the same picture, which makes `c.Camera3D` impossible to
       * read — and impossible to demo.
       *
       * It is deliberately plain: a sweep from wall to floor with a soft
       * pool of light where the phone stands, the way a cyc is painted.
       * Nothing recognisable, because it must not compete with the
       * screen.
       */
      const cycTex = (() => {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        const g = c.getContext('2d')!;
        const wall = g.createLinearGradient(0, 0, 0, 512);
        wall.addColorStop(0, '#080a0e');
        wall.addColorStop(0.42, '#141922');
        wall.addColorStop(0.58, '#242c39'); // the horizon: wall meets floor
        wall.addColorStop(0.63, '#171d26');
        wall.addColorStop(1, '#07080b');
        g.fillStyle = wall;
        g.fillRect(0, 0, 512, 512);
        const pool = g.createRadialGradient(256, 322, 8, 256, 322, 200);
        pool.addColorStop(0, '#3d4757');
        pool.addColorStop(1, '#3d475700');
        g.fillStyle = pool;
        g.fillRect(0, 0, 512, 512);
        const t = new T.CanvasTexture(c);
        // A canvas is authored in sRGB. Without saying so, three treats it
        // as linear and converts on output, which lifts every dark value —
        // a near-black cyc comes out as a pale grey wall.
        t.colorSpace = T.SRGBColorSpace;
        return t;
      })();
      const setPlane = new T.Mesh(
        new T.PlaneGeometry(6200, 6200),
        new T.MeshBasicMaterial({ map: cycTex })
      );
      setPlane.position.set(0, 0, -2600);
      scene.add(setPlane);

      /** everything the pointer orbits */
      const pivot = new T.Object3D();
      scene.add(pivot);
      /** the screen's own frame: what the DOM plane is pinned to */
      const anchor = new T.Object3D();
      pivot.add(anchor);

      const draco = new DRACOLoader().setDecoderPath('/draco/');
      const loader = new GLTFLoader().setDRACOLoader(draco);
      await new Promise<void>((resolve) => {
        loader.load('/models/iphone-15-pro.glb', (gltf) => {
          const model = gltf.scene;
          model.updateMatrixWorld(true);

          // THE SCREEN, found by geometry — this GLB's node names are
          // obfuscated (`xXDHkMplTIDAXLN`), so mockup-studio's own name
          // list never matches it either and it falls back to a heuristic
          // too. The display is the flattest large panel whose aspect is
          // a phone's: 2.510 / 1.162 = 2.161, against the iPhone 15 Pro's
          // 2556/1179 = 2.168. The glass cover sits just in front of it
          // and is a shade wider, which is what the ratio separates.
          const PHONE_ASPECT = 2556 / 1179;
          const whole = new T.Box3()
            .setFromObject(model)
            .getSize(new T.Vector3());
          let best: { box: THREE.Box3; mesh: THREE.Mesh; miss: number } | null =
            null;
          model.traverse((child) => {
            if (!(child as THREE.Mesh).isMesh) {
              return;
            }
            const mesh = child as THREE.Mesh;
            const box = new T.Box3().setFromObject(mesh);
            const v = box.getSize(new T.Vector3());
            if (v.z > whole.z * 0.08 || v.x < whole.x * 0.7) {
              return;
            }
            const miss = Math.abs(v.y / v.x - PHONE_ASPECT);
            if (!best || miss < best.miss) {
              best = { box, mesh, miss };
            }
          });
          if (!best) {
            this.status = 'no screen mesh found';
            resolve();
            return;
          }
          const found = best as {
            box: THREE.Box3;
            mesh: THREE.Mesh;
            miss: number;
          };

          // EVERY MEASUREMENT BELOW HAPPENS WITH THE ORBIT AT REST. A
          // Box3 is world-space and axis-aligned, so measuring the
          // display under a rotated pivot returns the bounding box of the
          // ROTATED panel — centre and front face both wrong, and wrong
          // by more the further the phone is turned.
          pivot.rotation.set(0, 0, 0);
          pivot.updateMatrixWorld(true);

          // ONE WORLD UNIT IS ONE CSS PIXEL. `perspective` and the
          // camera's translateZ are written in px, so a scene authored at
          // "2.6 units for a whole phone" projects nothing like the WebGL
          // one. It looks nearly right at small angles, which is the
          // trap. Scale the model until the display is exactly as wide as
          // the DOM screen and every matrix below is in pixels.
          const raw = found.box.getSize(new T.Vector3());
          model.scale.multiplyScalar(SCREEN.w / raw.x);
          pivot.add(model);
          pivot.updateMatrixWorld(true);
          const bounds = new T.Box3().setFromObject(model);
          model.position.sub(bounds.getCenter(new T.Vector3()));
          pivot.updateMatrixWorld(true);
          const whole2 = new T.Box3()
            .setFromObject(model)
            .getSize(new T.Vector3());
          // the silhouette a turned phone sweeps, so a yaw does not push
          // a corner out of frame
          phone = { h: whole2.y, w: Math.hypot(whole2.x, whole2.z) };
          frame2();

          const box = new T.Box3().setFromObject(found.mesh);
          const dims = box.getSize(new T.Vector3());
          const centre = box.getCenter(new T.Vector3());
          // FLUSH: exactly ON the display's front face (this model faces
          // -Z). There is no z-fighting to avoid — the DOM is on the CSS
          // layer and never enters the depth buffer — and any offset at
          // all is parallax you see the moment the phone turns.
          anchor.position.set(centre.x, centre.y, box.min.z);
          anchor.rotation.y = Math.PI;
          plane.style.width = `${SCREEN.w}px`;
          plane.style.height = `${Math.round(dims.y)}px`;

          // THE GLASS. Lume's `<lume-mixed-plane>` is a
          // MeshPhysicalMaterial with `blending: NoBlending` — the whole
          // trick, because NoBlending writes the material's RGB *and its
          // alpha* straight into the framebuffer, replacing the opaque
          // body fragments already drawn there. The canvas becomes a hole
          // the shape of the display and the DOM beneath shows through.
          // With NoBlending the alpha written IS this opacity, uniformly,
          // so every point of tint is a point of haze over the UI: clear
          // glass wants it near zero.
          // GLOSSY. The face is smooth glass again — the fix for the
          // white-out was never to sand it down, it was to keep the one
          // eye-level source off it. Everything else in the rig is above,
          // beside or behind, so what it reflects reads as a highlight.
          found.mesh.material = new T.MeshPhysicalMaterial({
            blending: T.NoBlending,
            clearcoat: 1,
            clearcoatRoughness: 0.03,
            color: 0x010206,
            // The glass reflects the room, because that is what glass
            // does — but the room is now a dark cyc with a flag where the
            // lens is, so what comes back is the overhead strip and not a
            // white sheet. Killing the reflection outright (intensity 0)
            // reads like a screen in a void.
            envMap: flagged,
            envMapIntensity: 0.9,
            metalness: 0,
            // AN OLED EMITS; IT IS NOT LIT. Whatever this alpha is, that
            // much of the DOM is replaced by shaded glass — so a tint
            // heavy enough to look like a filter is also a screen with
            // its brightness turned down. Five percent of near-black is
            // depth without dimming.
            opacity: 0.05,
            roughness: 0.05,
            transparent: true,
          });

          model.traverse((child) => {
            if (!(child as THREE.Mesh).isMesh) {
              return;
            }
            const mesh = child as THREE.Mesh;
            // every mesh joins the key light's layer EXCEPT the display
            if (mesh !== found.mesh) {
              mesh.layers.enable(EYE_LEVEL);
            }
            // THE LOGO IS COPLANAR WITH THE BACK GLASS. Two surfaces at the
            // same depth is a coin toss per pixel per frame, which reads as
            // the mark tearing through the panel as the phone turns. A
            // polygon offset biases the decal toward the camera in DEPTH
            // ONLY — nothing moves, the tie is just broken the same way
            // every frame. It is the standard fix for a decal, and cheaper
            // and safer than nudging geometry.
            const paint = (m: THREE.Material) => {
              const p = m as THREE.Material & {
                polygonOffset?: boolean;
                polygonOffsetFactor?: number;
                polygonOffsetUnits?: number;
              };
              p.polygonOffset = true;
              p.polygonOffsetFactor = -2;
              p.polygonOffsetUnits = -2;
            };
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(paint);
            } else {
              paint(mesh.material);
            }
          });

          ready = true;
          mapped =
            `iPhone 15 Pro GLB · screen "${found.mesh.name}" · ` +
            `${SCREEN.w}×${Math.round(dims.y)} css px = ` +
            `${dims.x.toFixed(1)}×${dims.y.toFixed(1)} world · 1:1`;
          this.status = mapped;
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
        camera.position.set(truck, pedestal + phone.h * DROP, rest * dolly);
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
        plane.style.transform = objectCss(anchor.matrixWorld.elements);
      };

      // leaving 3D stops the loop, and a stopped canvas keeps its last
      // frame forever — a ghost phone under the flat bezel. Clear it.
      clear = () => renderer.clear();
      dispose = () => {
        cancelAnimationFrame(raf);
        raf = 0;
        renderer.dispose();
      };
      built = true;
      building = false;
      (window as SpikeWindow).__glb = {
        close: () => {
          this.open = null;
        },
        look: (x: number, y: number) => {
          rx = x;
          ry = y;
        },
        open: (id: string) => {
          const app = APPS.find((a) => a.id === id);
          if (app) {
            this.choose(app);
          }
        },
        plane: () => plane.getBoundingClientRect().toJSON(),
        /** A/B the exclusion: 1 = off the screen (default), 0 = on it */
        keyLayer: (n: number) => keyLight?.layers.set(n),
      };
    };

    /** idempotent: safe on every entry into 3D, built or not */
    const run3d = async () => {
      running = true;
      await build();
      if (!running || raf || !tick) {
        return;
      }
      host.dataset['ready'] = mapped ? 'yes' : '';
      if (mapped) {
        this.status = mapped;
      }
      tick();
    };

    /**
     * ORBIT, INCLUDING ACROSS THE SCREEN ITSELF. A phone you can only
     * turn by grabbing its bezel is a phone with a dead face, so the
     * whole plane drags — and a press that never moves is still a tap.
     * Four pixels is the whole rule: under it the press was a click and
     * the icon gets it, over it the press was a rotation and the click
     * that follows is swallowed.
     */
    const SLOP = 4;
    let press: { lx: number; ly: number; ox: number; oy: number } | null = null;
    let dragged = false;

    /**
     * NO POINTER CAPTURE, ANYWHERE.
     *
     * Capture was the obvious way to keep a drag alive outside the stage,
     * and it is a trap here twice over. It retargets the `click` that
     * follows to the capture element, so capturing on pointerdown means
     * an icon never hears its own tap. And if the matching `pointerup` is
     * ever missed — the pointer leaves the window, the gesture is
     * cancelled, a drag ends off-target — the host keeps the pointer
     * FOREVER, every later event retargets to it, and no click can reach
     * an icon again for the life of the page. That is the failure this
     * demo actually hit, and it looks exactly like "the glass is eating
     * my clicks" when the glass is innocent.
     *
     * Window listeners give the same reach with none of it: the target of
     * a click stays whatever the pointer is really over.
     */
    const track = (ev: PointerEvent) => {
      if (!press) {
        return;
      }
      if (
        !dragged &&
        Math.hypot(ev.clientX - press.ox, ev.clientY - press.oy) < SLOP
      ) {
        return;
      }
      if (!dragged) {
        dragged = true;
        host.dataset['dragging'] = 'yes';
        // the gesture that means "let me look"
        this.seizeCamera();
      }
      ry += (ev.clientX - press.lx) * 0.008;
      rx += (ev.clientY - press.ly) * 0.008;
      rx = Math.max(-0.9, Math.min(0.9, rx));
      press.lx = ev.clientX;
      press.ly = ev.clientY;
    };
    const release = () => {
      press = null;
      delete host.dataset['dragging'];
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    const grab = (ev: PointerEvent) => {
      if (!running) {
        return; // 2D has nothing to orbit
      }
      if ((ev.target as Element).closest('.mg-seg')) {
        return; // the switch is a control, not the scene
      }
      release(); // whatever the last gesture left behind, it ends here
      press = {
        lx: ev.clientX,
        ly: ev.clientY,
        ox: ev.clientX,
        oy: ev.clientY,
      };
      dragged = false;
      window.addEventListener('pointermove', track);
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    };
    // the click arrives AFTER pointerup, so `dragged` is still standing
    // here; swallow it on the way down, before any icon can hear it
    const swallow = (ev: MouseEvent) => {
      if (!dragged) {
        return;
      }
      dragged = false;
      ev.stopPropagation();
      ev.preventDefault();
    };
    host.addEventListener('pointerdown', grab);
    host.addEventListener('click', swallow, true);
    // a tap that lands anywhere on the SCREEN is someone using the phone,
    // so the film stops opening and closing apps underneath them. The
    // cues never dispatch DOM clicks, so this cannot fire on itself.
    const touched = (ev: Event) => {
      if ((ev.target as Element).closest('.mg-screen')) {
        this.seizeApps();
      }
    };
    host.addEventListener('click', touched, true);

    this.tint = (hex: number) => screenGlow?.color.setHex(hex);
    // THE ADAPTER. Choreo owns the clock and the easing; this is the four
    // lines that turn its pose into a picture. Degrees to radians, and a
    // dolly that multiplies whatever distance the framing solved for.
    /**
     * THE POSE IS PAINTED, NOT TRACKED.
     *
     * The film moves the camera every frame, and the control dots have to
     * move with it. A tracked write here would re-render the component,
     * which re-renders the region, which replays the pass and cancels the
     * very run that is dispatching — the trap `examples/fold.gts`
     * documents. So the pose is written to custom properties and the dots
     * are positioned by CSS from them. No render, no cancellation, and
     * the readouts still track the shot frame by frame.
     */
    const pose: Camera3DState = { dolly: 1, pitch: 0, x: 0, y: 0, yaw: 0 };
    const share = () => {
      const pct = (v: number, [lo, hi]: readonly [number, number]) =>
        Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
      host.style.setProperty('--yaw-at', String(pct(pose.yaw, RANGE.yaw)));
      host.style.setProperty(
        '--pitch-at',
        String(pct(pose.pitch, RANGE.pitch))
      );
      host.style.setProperty('--pan-x-at', String(pct(pose.x, RANGE.pan)));
      host.style.setProperty('--pan-y-at', String(pct(pose.y, RANGE.pan)));
      host.style.setProperty(
        '--dolly-at',
        String(pct(pose.dolly, RANGE.dolly))
      );
      host.style.setProperty('--yaw-n', pose.yaw.toFixed(0));
      host.style.setProperty('--pitch-n', pose.pitch.toFixed(0));
      host.style.setProperty('--dolly-n', pose.dolly.toFixed(2));
    };
    const apply = () => {
      ry = Math.PI + (pose.yaw * Math.PI) / 180;
      rx = (pose.pitch * Math.PI) / 180;
      dolly = pose.dolly;
      // truck and pedestal: fractions of the framed height, so the same
      // pose reads the same whatever box the demo was given
      truck = pose.x * SCREEN.h;
      pedestal = pose.y * SCREEN.h;
      share();
    };
    this.shotHost = (next) => {
      Object.assign(pose, next);
      apply();
    };
    this.poseHost = (partial) => {
      Object.assign(pose, partial);
      apply();
    };
    share();
    this.boot = run3d;
    this.halt = () => {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      delete host.dataset['ready'];
      clear?.();
      // hand the plane back to CSS: in 2D it is an ordinary centred box
      layer.style.perspective = '';
      cam.style.transform = '';
      plane.style.transform = '';
    };

    return () => {
      this.halt?.();
      dispose?.();
      release();
      host.removeEventListener('pointerdown', grab);
      host.removeEventListener('click', swallow, true);
      host.removeEventListener('click', touched, true);
      delete (window as SpikeWindow).__glb;
      this.boot = undefined;
      this.halt = undefined;
    };
  });

  <template>
    <div class="mg-page">
      <Choreo
        class="mg-stage"
        data-mode={{this.mode}}
        style="--glow:{{this.shown.hue}}"
        @quiet={{true}}
        @onCamera3D={{this.shot}}
        @onPerform={{this.dispatch}}
        @onPerformReset={{this.reset}}
        {{this.stage}}
        as |c|
      >
        {{! THE SPILL. A panel that emits throws light on the room around
            it, and nothing sells "this is on" like the backdrop picking
            up its colour. Behind everything, tinted by the open app. }}
        <div class="mg-bloom" data-lit={{if this.open "yes" ""}}></div>
        <canvas></canvas>

        <div class="mg-css">
          <div class="mg-cam">
            <div class="mg-plane">
              <div class="mg-screen">
                {{! THE BOOST. `backdrop-filter` re-renders everything
                    BEHIND this pane, so a transparent sheet laid over the
                    UI lifts the whole panel's luminance and saturation
                    without touching a single colour in the markup. It is
                    the closest thing the platform has to turning a screen
                    up, and unlike brightening the CSS by hand it also
                    lifts whatever a real app would render here. }}
                <div class="mg-boost" aria-hidden="true"></div>
                {{#if (this.isMode "2d")}}
                  <span class="mg-island" aria-hidden="true"></span>
                {{/if}}

                {{! the home screen. Absolutely placed at authored
                    coordinates, so it never reflows and never moves —
                    opening an app changes no other element's box. Each
                    tile still claims a beacon under its own name. }}
                {{#each this.apps as |app|}}
                  <button
                    type="button"
                    class="mg-icon"
                    data-app={{app.id}}
                    style="--hue:{{app.hue}};left:{{app.x}}px;top:{{app.y}}px"
                    {{on "click" (fn this.choose app)}}
                  >
                    <span class="mg-tile" {{beacon app.id}}></span>
                    <span class="mg-icon-name">{{app.label}}</span>
                  </button>
                {{/each}}

                {{! page one of one, said the way a home screen says it }}
                <div class="mg-dots" aria-hidden="true">
                  <span class="mg-dot" data-on="yes"></span>
                  <span class="mg-dot"></span>
                </div>

                {{! ONE element, two named poses, the corner radius
                    travelling with the box }}
                <div
                  class="mg-app"
                  data-open={{if this.open "yes" ""}}
                  style="--hue:{{this.shown.hue}}"
                  {{motion animate=this.panel transition=this.swell}}
                >
                  {{! THE APP ITSELF. Each one is an ordinary Glimmer
                      component with its own Choreo region inside — real
                      UI you can tap while the shot is moving, which is
                      the entire claim this demo exists to make. It is
                      only rendered while open: parked, the panel is
                      82x82 and a phone screen squeezed into an icon is
                      just an expensive way to draw a coloured square. }}
                  {{#if this.open}}
                    <div
                      class="mg-app-ui"
                      {{motion animate=this.title transition=FADE}}
                    >
                      <this.open.Ui />
                    </div>
                  {{else}}
                    <span class="mg-app-name">{{this.shown.label}}</span>
                  {{/if}}

                  {{! CLOSING IS A GESTURE ON THE HOME BAR, not a tap
                      anywhere on the app. A full-screen close target
                      meant the click that opened an app could be
                      followed by any stray click and the app would shut
                      again before you saw it — which reads exactly like
                      "tapping icons does not work". }}
                  <div class="mg-swipe" {{this.swiper}}>
                    <button
                      type="button"
                      class="mg-home"
                      aria-label="Close {{this.shown.label}}"
                      {{on "click" this.close}}
                    ></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {{! THE FILM. A hidden marker whose only job is to change on every
            take, because a region does not compile a score for a pass in
            which nothing moved — bumping it is what makes the loop a
            loop. }}
        {{#if this.running}}
          <div
            class="mg-clock"
            data-take={{this.take}}
            aria-hidden="true"
            {{motion id="clock"}}
            {{this.wire c this.take}}
          >{{this.take}}</div>

          {{! ONE SEQUENCE, NOT TWO.
              The cues and the camera used to be parallel sequences whose
              Waits had to add up to the same total by hand — one edit and
              they drift. `c.Perform` takes no time, so interleaving them
              in a single sequence makes the alignment structural: the app
              opens exactly when the approach lands, and closes exactly
              when the read ends. Each track is switched off by swapping
              its step for a Wait of the same length, so the timing does
              not change when you stop one of them. }}
          <c.Sequence>
            {{#each this.scenes as |scene|}}
              {{! APPROACH — wide enough that the home screen still reads }}
              {{#if this.cameraOn}}
                <c.Camera3D
                  @yaw={{scene.approach.yaw}}
                  @pitch={{scene.approach.pitch}}
                  @dolly={{scene.approach.dolly}}
                  @x={{scene.approach.x}}
                  @y={{scene.approach.y}}
                  @duration={{this.travel}}
                  @ease={{this.glide}}
                />
              {{else}}
                <c.Wait @duration={{this.travel}} />
              {{/if}}

              {{#if this.syncOn}}
                <c.Perform @action="open" @target={{scene.app}} />
              {{/if}}

              {{! READ — in close, and PANNING, so the part being read
                  stays in frame instead of the push cropping it away }}
              {{#if this.cameraOn}}
                <c.Camera3D
                  @yaw={{scene.read.yaw}}
                  @pitch={{scene.read.pitch}}
                  @dolly={{scene.read.dolly}}
                  @x={{scene.read.x}}
                  @y={{scene.read.y}}
                  @duration={{scene.hold}}
                  @ease={{this.glide}}
                />
              {{else}}
                <c.Wait @duration={{scene.hold}} />
              {{/if}}

              {{#if this.syncOn}}
                <c.Perform @action="close" @target={{scene.app}} />
              {{/if}}

              {{! HOME — the return IS the home-screen beat. Every app is
                  entered from the hub and left back to it. }}
              {{#if this.cameraOn}}
                <c.Camera3D
                  @yaw={{this.home.yaw}}
                  @pitch={{this.home.pitch}}
                  @dolly={{this.home.dolly}}
                  @x={{this.home.x}}
                  @y={{this.home.y}}
                  @duration={{this.returnFor}}
                  @ease={{this.glide}}
                />
              {{else}}
                <c.Wait @duration={{this.returnFor}} />
              {{/if}}
            {{/each}}
          </c.Sequence>
        {{/if}}
      </Choreo>

      {{! THE CHROME PLANE. Deliberately OUTSIDE the region: in 2D the
          film's `c.Camera` zooms the region's own frame, and anything
          inside it is zoomed and cropped along with the phone. The
          switch, the transport and the caption belong to the viewer, not
          to the shot, so they sit above the camera and never move. }}
      <div class="mg-chrome">
        <div class="mg-seg" role="group" aria-label="Presentation">
          <button
            type="button"
            aria-pressed="{{this.isMode '2d'}}"
            {{on "click" (fn this.setMode "2d")}}
          >2D</button>
          <button
            type="button"
            aria-pressed="{{this.isMode '3d'}}"
            {{on "click" (fn this.setMode "3d")}}
          >3D</button>
        </div>

        <div class="mg-transport">
          <button
            type="button"
            data-on={{if this.cameraOn "yes" ""}}
            {{on "click" this.toggleCamera}}
          >{{if this.cameraOn "❚❚" "▶"}} camera</button>

          {{! NO BUTTON WHILE IT IS SYNCED. A control that only ever says
              "on" is furniture; this one appears the moment you take the
              phone over, which is also the moment it means something. }}
          {{#unless this.syncOn}}
            <button
              type="button"
              class="mg-resync"
              {{on "click" this.toggleSync}}
            >↺ resync</button>
          {{/unless}}
        </div>

      </div>

      <style>
        .mg-page {
          padding: 24px;
          font:
            12px/1.4 ui-monospace,
            monospace;
        }
        /* THE PLATTER IS THE APP'S OWN SURFACE. --bg is the recessed
           canvas the gallery already uses for a camera stage, so the demo
           sits in light and dark without a second palette — and the WebGL
           set fades in over it rather than replacing it. */
        .mg-stage {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background: var(--bg, #2a2521);
          touch-action: none;
        }
        .mg-bloom {
          position: absolute;
          z-index: 0;
          inset: 0;
          pointer-events: none;
          opacity: 0;
          transition: opacity 420ms ease;
          background: radial-gradient(
            38% 42% at 50% 50%,
            hsl(var(--glow) 95% 62% / 0.5) 0%,
            hsl(var(--glow) 95% 58% / 0.18) 40%,
            transparent 72%
          );
          filter: blur(52px);
        }
        .mg-bloom[data-lit="yes"] {
          opacity: 0.85;
        }
        .mg-stage[data-mode="3d"] {
          cursor: grab;
        }
        /* THE SWITCH IS A DISSOLVE, not a cut. `display:none` made 3D
           snap in the moment the engine finished downloading and snap out
           again on the way back; an opacity pair means the set and the
           device arrive over the flat phone and leave the same way. The
           canvas stays mounted either way — tearing down a WebGL context
           to toggle a control is far more expensive than compositing a
           transparent one. */
        .mg-stage canvas {
          position: absolute;
          inset: 0;
          z-index: 2;
          width: 100%;
          height: 100%;
          pointer-events: none;
          opacity: 0;
          transition: opacity 420ms ease;
        }
        .mg-stage[data-mode="3d"][data-ready="yes"] canvas {
          opacity: 1;
        }
        .mg-css {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .mg-cam {
          position: absolute;
          inset: 0;
          transform-style: preserve-3d;
        }
        .mg-plane {
          position: absolute;
          top: 0;
          left: 0;
          transform-style: preserve-3d;
          pointer-events: auto;
        }
        /* 2D: no camera, no matrices — the same plane, centred by CSS,
           inside a plain bezel so the comparison is like for like */
        /* THE SCREEN IS 390x844 IN BOTH MODES. It has to be: the icons
           are placed at authored coordinates in that space, so any inset
           here would put them somewhere else than the 3D phone puts them.
           The rim is therefore drawn OUTSIDE the box with rings, never as
           padding — padding here plus the screen's own inset was insetting
           it twice, and the flat screen came out 368x821, a different
           shape from the one the GLB displays.

           0.656 is not a taste: it is 554/844, the height the 3D plane
           projects to at the default camera, so the switch does not
           resize the phone under you. */
        .mg-stage[data-mode="2d"] .mg-plane {
          transition: opacity 300ms ease;
          top: 54%;
          left: 50%;
          width: 390px;
          height: 844px;
          transform: translate(-50%, -50%) scale(var(--k, 0.6));
          border-radius: 46px;
          box-shadow:
            0 0 0 12px #212429,
            0 0 0 13px #71767f,
            0 0 0 15px #2b2e34,
            0 34px 60px -18px #00000088;
        }
        .mg-screen {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: 46px;
          background: #16203a;
        }
        .mg-stage[data-mode="2d"] .mg-screen {
          inset: 0;
          border-radius: 46px;
        }
        /* the island, so the flat phone is recognisably the same device
           the GLB draws over the DOM in 3D. It needs a wallpaper behind
           it or it is black type on a black page. */
        .mg-screen {
          background-image:
            radial-gradient(110% 72% at 50% -8%, #3d4c7a 0%, #16203a00 64%),
            radial-gradient(82% 56% at 18% 108%, #26365c 0%, #16203a00 70%);
        }
        /* 3D ONLY. Behind the glass the panel is composited under a
           tinted, reflective surface and needs a lift to read as lit;
           flat, there is nothing over it and the same boost is just an
           oversaturated picture. Gentle on purpose — enough that the
           screen is the brightest thing in frame, not so much that the
           icons go neon. */
        .mg-boost {
          position: absolute;
          z-index: 3;
          inset: 0;
          pointer-events: none;
          border-radius: inherit;
        }
        .mg-stage[data-mode="3d"] .mg-boost {
          backdrop-filter: brightness(1.16) saturate(1.06) contrast(1.02);
          -webkit-backdrop-filter: brightness(1.16) saturate(1.06)
            contrast(1.02);
          /* if the display has headroom and anything here is ever HDR,
             let it use it; on an SDR panel this is a no-op */
          dynamic-range-limit: no-limit;
        }
        .mg-island {
          position: absolute;
          z-index: 2;
          left: 50%;
          top: 13px;
          width: 118px;
          height: 35px;
          border-radius: 18px;
          background: #05070a;
          transform: translateX(-50%);
          pointer-events: none;
        }
        /* it is a phone screen, not a document: a drag across it is a
           gesture, never a text selection */
        .mg-icon,
        .mg-icon-name,
        .mg-app,
        .mg-app-name {
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
        }
        /* THE LAYERS THAT FILL THEIR PARENT'S BOX — and ONLY those. An
           icon's label is not one of them: swallowed into this list it
           gets `position:absolute; inset:0` and lands on top of its own
           tile at the corner, instead of sitting under it in the grid. */
        .mg-plane,
        .mg-screen,
        .mg-app,
        .mg-app-ui {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: inherit;
        }
        .mg-icon {
          all: unset;
          cursor: pointer;
          position: absolute;
          width: 82px;
          display: grid;
          justify-items: center;
          gap: 9px;
        }
        /* icons carry the panel's luminance: an OLED is bright BECAUSE
           its content is, not because a filter over it is lighter */
        .mg-tile {
          display: block;
          width: 82px;
          height: 82px;
          border-radius: 20px;
          background: linear-gradient(
            150deg,
            hsl(var(--hue) 84% 66%),
            hsl(var(--hue) 78% 47%)
          );
          /* a tile is a lit square on a wallpaper, not a neon sign: it
             drops a shadow DOWNWARD in its own darkened hue, rather than
             throwing a halo out in every direction */
          box-shadow: 0 5px 12px -6px hsl(var(--hue) 55% 18% / 0.5);
        }
        .mg-icon-name {
          display: block;
          max-width: 100%;
          color: #ffffff;
          font:
            15px/1.2 ui-sans-serif,
            system-ui,
            sans-serif;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          /* the wallpaper is dark, but not everywhere: a tight shadow
             keeps the type legible wherever the label lands */
          text-shadow: 0 1px 2px #000000a6;
        }
        /* PAGE DOTS. Two, the first one lit — the smallest mark that
           says "this is page one of a home screen" rather than a grid
           of squares. Above the home-bar area, and never a target. */
        .mg-dots {
          position: absolute;
          z-index: 1;
          left: 0;
          right: 0;
          bottom: 54px;
          display: flex;
          justify-content: center;
          gap: 9px;
          pointer-events: none;
        }
        .mg-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #ffffff40;
        }
        .mg-dot[data-on="yes"] {
          background: #ffffffd9;
        }
        .mg-app:not([data-open="yes"]) {
          pointer-events: none;
        }
        .mg-app {
          position: absolute;
          overflow: hidden;
          display: grid;
          place-items: center;
          display: grid;
          place-items: center;
          background: linear-gradient(
            150deg,
            hsl(var(--hue) 78% 62%),
            hsl(var(--hue) 70% 42%)
          );
        }
        /* the bottom edge, where the home gesture lives */
        .mg-swipe {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 132px;
          touch-action: none;
          cursor: grab;
        }
        /* the home bar: tap it, or swipe up anywhere along the edge */
        /* a demo needs a target you can hit: the bar LOOKS like an iOS
           home indicator and hits like a button, with the padding doing
           the work rather than the ink */
        .mg-home {
          all: unset;
          cursor: pointer;
          position: absolute;
          bottom: 10px;
          left: 50%;
          width: 210px;
          height: 46px;
          transform: translateX(-50%);
          border-radius: 24px;
          background:
            linear-gradient(#ffffffe6, #ffffffe6) center / 150px 6px no-repeat,
            #ffffff14;
          box-shadow: 0 0 16px #ffffff40;
        }
        .mg-app-ui {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: inherit;
        }
        .mg-app-name {
          color: #fff;
          font-size: 40px;
          font-weight: 600;
          font-family: ui-sans-serif, system-ui;
        }
        .mg-clock {
          position: absolute;
          left: -9999px;
          top: 0;
          opacity: 0;
          pointer-events: none;
        }
        /* TOP LEFT, NOT BOTTOM RIGHT. The stage is min(78vh,720px) tall and
           the page has a header above it, so anything pinned to the
           stage's bottom edge sits below the fold — which is exactly what
           "the buttons don't work" looks like. */
        @container (max-height: 460px) {
          .mg-transport button,
          .mg-seg button {
            padding: 4px 8px;
            font-size: 11px;
          }
        }

        /* ONE HOME STRIP, NOT TWO. Every app screen draws its own home
           indicator, and the phone draws the real one — the swipe target
           that actually closes the app. The app's is decoration sitting on
           top of a control, so the control stays and the decoration goes.
           Appended at the END of the block on purpose: an insertion
           anywhere else in this stylesheet has silently spliced itself
           into a neighbouring selector list more than once. */
        .mg-app-ui .mail-home-indicator,
        .mg-app-ui .maps-home-indicator,
        .mg-app-ui .clock-home,
        .mg-app-ui .notes-home,
        .mg-app-ui .photos-home {
          display: none !important;
        }

        /* ONE CONTROL STYLE, and it is the site's own: the pill, the hairline
           and the mono 11px that the top nav and the speed control already
           use (--line / --ink-dim / --bg-spot). A demo that invents its own
           buttons reads as a different product bolted into the page. */
        .mg-seg,
        .mg-transport {
          position: absolute;
          z-index: 4;
          top: 10px;
          display: flex;
          gap: 6px;
        }
        .mg-seg {
          right: 10px;
        }
        .mg-transport {
          left: 10px;
        }
        .mg-seg button,
        .mg-transport button {
          all: unset;
          cursor: pointer;
          padding: 7px 12px;
          border: 1px solid var(--line, #ffffff17);
          border-radius: 999px;
          background: var(--bg-elev, #00000066);
          color: var(--ink-dim, #d2c9bf);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          line-height: 1;
          white-space: nowrap;
        }
        .mg-seg button[aria-pressed="true"],
        .mg-transport button[data-on="yes"] {
          border-color: var(--line-strong, #ffffff2e);
          background: var(--bg-spot, #443c35);
          color: var(--ink, #f3ece3);
        }

        /* CLIP THE EXPANDING PANEL. The app grows from an 82px tile to the
           full 390x844 screen, and mid-flight its rounded box does not yet
           match the screen's — so without a second clip on the plane
           itself the corners paint over the mockup's chin. The bezel is
           drawn with rings OUTSIDE the box, and overflow does not clip an
           element's own shadow, so this costs the bezel nothing. */
        .mg-plane {
          overflow: hidden;
        }

        .mg-pads {
          position: absolute;
          z-index: 4;
          left: 10px;
          bottom: 10px;
          display: flex;
          gap: 8px;
          align-items: flex-end;
        }
        .mg-pad,
        .mg-rail {
          position: relative;
          cursor: crosshair;
          border: 1px solid var(--line, #ffffff17);
          border-radius: 10px;
          background: var(--bg-elev, #00000066);
          touch-action: none;
        }
        .mg-pad {
          width: 66px;
          height: 66px;
        }
        .mg-rail {
          width: 96px;
          height: 66px;
        }
        .mg-pad-name {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 4px;
          text-align: center;
          font: 9px/1 var(--font-mono, ui-monospace, monospace);
          color: var(--ink-faint, #b8aea3);
          pointer-events: none;
        }
        .mg-pad-dot,
        .mg-rail-dot {
          position: absolute;
          width: 9px;
          height: 9px;
          margin: -4.5px 0 0 -4.5px;
          border-radius: 50%;
          background: var(--ember-hot, #ff6a3a);
          box-shadow: 0 0 8px #ff6a3a80;
          pointer-events: none;
        }
        /* THE DOTS ARE THE CAMERA. Positioned from the properties the
           adapter writes every frame, so they travel with the film and
           sit wherever a drag last put them. */
        .mg-dot-orbit {
          left: calc(var(--yaw-at, 50) * 1%);
          top: calc(var(--pitch-at, 50) * 1%);
        }
        .mg-dot-pan {
          left: calc(var(--pan-x-at, 50) * 1%);
          top: calc(100% - var(--pan-y-at, 50) * 1%);
        }
        .mg-rail-dot {
          top: 50%;
          left: calc(100% - var(--dolly-at, 50) * 1%);
        }
        /* 2D is the default because 3D is a megabyte and a half; this is
           the nudge that says the other one is worth the wait */
        .mg-stage[data-mode="2d"] .mg-seg button:last-child {
          border-color: var(--ember-hot, #ff6a3a);
          color: var(--ember-hot, #ff6a3a);
          animation: mg-beckon 2.6s ease-in-out infinite;
        }
        @keyframes mg-beckon {
          0%,
          100% {
            box-shadow: 0 0 0 0 #ff6a3a00;
          }
          50% {
            box-shadow: 0 0 0 4px #ff6a3a26;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .mg-stage[data-mode="2d"] .mg-seg button:last-child {
            animation: none;
          }
        }
      </style>
    </div>
  </template>
}

export default Mockup;
