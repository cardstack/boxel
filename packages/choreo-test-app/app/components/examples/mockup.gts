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
  type ChoreoRun,
  motion,
  type PerformCommand,
} from 'glimmer-motion';
import { ClockApp } from 'test-app/components/mockup/clock';
import { MailApp } from 'test-app/components/mockup/mail';
import { MapsApp } from 'test-app/components/mockup/maps';
import { MusicApp } from 'test-app/components/mockup/music';
import { NotesApp } from 'test-app/components/mockup/notes';
import { PhotosApp } from 'test-app/components/mockup/photos';
import config from 'test-app/config/environment';
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
const PHONE = `${config.rootURL}models/iphone-15-pro.glb`;

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
/**
 * The share of the platter the phone fills. A big page can afford air
 * around the device; a gallery card cannot — at the page's framing the
 * phone in a card is a stamp. So the fraction rises as the box shrinks.
 */
const fillFor = (h: number) => (h < 520 ? 0.94 : h < 660 ? 0.86 : 0.78);

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
/**
 * The ranges every pose is clamped to — the script writes within them and
 * the sticks cannot leave them, so there is one set of limits rather than
 * two that can disagree.
 */
const RANGE = {
  dolly: [0.24, 1.9],
  pan: [-0.5, 0.5],
  // NEVER FAR ENOUGH TO SEE THE BACK. The screen is the subject; past
  // about 45 degrees it foreshortens into a sliver and then the phone
  // simply turns round, which is a different demo.
  pitch: [-28, 28],
  yaw: [-45, 45],
} as const;

/** one lock-on: where the camera goes, and how long it stays */
interface Beat {
  dolly: number;
  pitch: number;
  /** seconds */
  t: number;
  /**
   * Something to press as this beat begins, matched by its visible text.
   *
   * The composition doc calls a synthesised click a COMPATIBILITY
   * ADAPTER: legitimate, but not the durable recording format, which is a
   * semantic port on the actor. These apps were written without ports, so
   * the cue addresses what a person would address — the words on the
   * control — rather than a class name that a redesign would break.
   */
  tap?: string;
  x: number;
  y: number;
  yaw: number;
}

const SCENES: { app: string; beats: Beat[] }[] = [
  /**
   * THE SHOT LIST, and it is a list of intentions rather than numbers.
   *
   * One grammar runs through all six: TURN WIDE to introduce the object,
   * STRAIGHTEN AND PUSH to read it, ACCENT on the moment something is
   * pressed, then TURN AWAY wide to leave. Rotation is how the film
   * changes its subject — swinging left, then right, then back — and it
   * always straightens as it closes in, because nobody reads a screen
   * from forty degrees off axis. The push is never decoration: every one
   * of them lands on something there is a reason to look at.
   *
   * The same poses drive both modes. In 3D they are an orbit; flat, the
   * yaw and pitch have nowhere to go and what survives is the zoom and
   * the pan — which is why the dolly range is wide enough to read as a
   * push on its own, and why the pans are aimed at content rather than
   * at nothing in particular.
   */
  {
    // THE OPENER. Hard left and wide: meet the device before the app.
    app: 'mail',
    beats: [
      { dolly: 1.24, pitch: -12, t: 2.2, x: 0.04, y: 0.02, yaw: -30 },
      // straighten onto the header and the filter, and press Unread there
      {
        dolly: 0.94,
        pitch: -4,
        t: 2.8,
        tap: 'Unread',
        x: 0.01,
        y: 0.18,
        yaw: -8,
      },
      // then simply fall down the list that just changed
      { dolly: 0.9, pitch: -1, t: 2.6, x: 0, y: -0.08, yaw: -2 },
    ],
  },
  {
    // SWING THE OTHER WAY. A map is a surface, so come down onto it.
    app: 'maps',
    beats: [
      { dolly: 1.2, pitch: 9, t: 2.4, x: -0.02, y: 0.04, yaw: 26 },
      {
        dolly: 0.92,
        pitch: 2,
        t: 3.0,
        tap: 'Transit',
        x: 0.02,
        y: 0.02,
        yaw: 10,
      },
      // settle level on the sheet, which is where the answer is
      { dolly: 0.88, pitch: -2, t: 2.6, x: -0.05, y: -0.14, yaw: 0 },
    ],
  },
  {
    // HIGH AND LEFT, then a vertical move: art, transport, queue.
    app: 'music',
    beats: [
      { dolly: 1.18, pitch: -15, t: 2.4, x: 0.03, y: 0.12, yaw: -22 },
      { dolly: 0.9, pitch: 0, t: 2.6, tap: 'play', x: 0, y: 0.02, yaw: -4 },
      // tip down to the queue as it starts playing
      { dolly: 0.94, pitch: 7, t: 2.8, x: 0.02, y: -0.18, yaw: 7 },
    ],
  },
  {
    // A QUIET ONE. Barely moves: open a note and let it be read.
    app: 'notes',
    beats: [
      { dolly: 1.1, pitch: -7, t: 2.2, x: 0, y: 0.03, yaw: 17 },
      {
        dolly: 0.92,
        pitch: -2,
        t: 3.0,
        tap: 'Dinner, Saturday',
        x: 0.01,
        y: 0.12,
        yaw: 4,
      },
    ],
  },
  {
    // FRONT ON. You watch numbers square, not at an angle.
    app: 'clock',
    beats: [
      { dolly: 1.06, pitch: -5, t: 2.0, x: 0, y: 0.02, yaw: -13 },
      { dolly: 0.9, pitch: 0, t: 1.6, tap: 'Timer', x: 0, y: 0, yaw: -2 },
      // and hold on the dial once it is running
      { dolly: 0.88, pitch: 2, t: 2.6, tap: 'Start', x: 0, y: -0.02, yaw: 2 },
    ],
  },
  {
    // THE SIGN-OFF. Turn away and pull out; the film ends on the object.
    app: 'photos',
    beats: [
      { dolly: 1.12, pitch: -8, t: 1.6, x: 0, y: 0.06, yaw: 22 },
      { dolly: 1.32, pitch: -13, t: 2.2, x: -0.02, y: 0, yaw: 31 },
    ],
  },
];

/** where the camera passes through while the home screen is up */
const HOME_SHOT = { dolly: 1.02, pitch: -8, x: 0, y: -0.05, yaw: 4 } as const;
/** the hallway is short on purpose */
const TRAVEL = 0.5;
const RETURN = 0.3;
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
  private region?: { run: ChoreoRun | null };
  private shotHost?: (state: Camera3DState) => void;
  /** drag a pad: hand the host a pose directly, and stop the film's camera */
  private poseHost?: (
    partial: Partial<Camera3DState>,
    relative?: boolean
  ) => void;
  /** the stick's temporary pull, layered on whatever the film is doing */
  private leanHost?: (partial: Partial<Camera3DState>) => void;
  /** discard every manual edit and hand the shot back to the score */
  private resetHost?: () => void;
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

  /** pressed 3D, engine still downloading: stay flat until it can draw */
  @tracked arming = false;
  /**
   * The 3D scene has drawn a frame and may be shown.
   *
   * THIS IS TRACKED STATE, NOT A dataset WRITE. It used to be set with
   * `host.dataset.ready = 'yes'` while `data-mode` came from the
   * template — and every re-render re-applied the template's attributes
   * and dropped the imperative one, which left the canvas matching
   * `opacity: 0` forever. The engine, the model and the render loop were
   * all healthy; the picture was simply invisible. Anything the
   * stylesheet keys off belongs to the template.
   */
  @tracked drawn = false;

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
    // after meant a second and a half of stage with no phone on it, then
    // a pop — a flash where a transition should be. The flat phone stays
    // up, the button says so, and the swap happens when the model has
    // landed and the first frame is mapped.
    this.arming = true;
    void this.boot?.().then(() => {
      this.arming = false;
      this.mode = '3d';
      // ENTERING 3D IS ASKING FOR THE FILM. Nobody presses 3D to look at
      // a still phone, and asking them to press play afterwards is asking
      // twice for one thing.
      this.cameraOn = true;
      this.syncOn = true;
      this.ended = false;
      requestAnimationFrame(() => {
        this.take += 1;
      });
    });
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
      if (command.action === 'tap') {
        // find it the way a person would: by what it says
        const want = String(command.payload ?? '').toLowerCase();
        const ui = document.querySelector('.mg-app-ui');
        const hit = [
          ...(ui?.querySelectorAll<HTMLElement>('button, [role="button"]') ??
            []),
        ]
          .filter((el) => {
            const text = (el.textContent ?? '').trim().toLowerCase();
            const label = (el.getAttribute('aria-label') ?? '').toLowerCase();
            return text.startsWith(want) || label.includes(want);
          })
          // the SHORTEST match: a note card contains its own title plus a
          // date and a snippet, and a whole list contains every card
          .sort(
            (a, b) =>
              (a.textContent ?? '').length - (b.textContent ?? '').length
          )[0];
        // THE FILM MUST NOT DESYNC ITSELF. A synthesised click bubbles to
        // the stage exactly like a real one, where the "someone touched
        // the screen" guard is waiting — so the film's own tap would stop
        // the film. Flagged for the duration of the dispatch.
        this.selfTap = true;
        hit?.click();
        this.selfTap = false;
      } else if (command.action === 'open' && app) {
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

  /**
   * A stick moved. What that MEANS depends on whether the film is running,
   * and the difference is the whole design.
   *
   * With the camera playing, a stick is a NUDGE: a temporary pull away
   * from wherever the film currently is, layered on top of it. The film
   * never stops, the knob springs back to centre on release, and the pull
   * unwinds with it — so you can lean in to read something and simply let
   * go to be handed back to the shot. Taking the camera away from the
   * film to look at one thing, and then having to give it back by hand, is
   * the friction this avoids.
   *
   * With the camera off, there is no film to lean on, so the same stick
   * INTEGRATES: it drives the pose itself, from wherever you left it.
   */
  nudge = (kind: string, x: number, y: number, dt: number) => {
    const lean = this.cameraOn;
    const k = lean ? 1 : dt;
    const move =
      kind === 'orbit'
        ? { pitch: y * (lean ? 30 : 90), yaw: x * (lean ? 52 : 150) }
        : kind === 'pan'
          ? { x: x * (lean ? 0.38 : 0.9), y: -y * (lean ? 0.38 : 0.9) }
          : { dolly: -y * (lean ? 0.7 : 1.5) };
    const scaled = Object.fromEntries(
      Object.entries(move).map(([key, v]) => [key, v * k])
    ) as Partial<Camera3DState>;
    if (lean) {
      this.leanHost?.(scaled);
    } else {
      this.poseHost?.(scaled, true);
    }
  };

  /**
   * A DRAG MEANS "LET ME LOOK", and that stops the whole film — not just
   * the camera. Leaving the app cues running while the camera is parked
   * means the phone keeps opening and closing things under someone who
   * has just taken hold of it, which is the demo talking over them.
   * Stopping one stops both; resync brings both back.
   */
  seizeCamera = () => {
    if (this.cameraOn || this.syncOn) {
      this.cameraOn = false;
      this.syncOn = false;
      this.stopFilm();
    }
  };

  /**
   * STOP MEANS STOP. Swapping the camera steps for waits of the same
   * length keeps the timing honest, but it also means the score is still
   * RUNNING — a clock ticking through a film nobody can see, looping
   * forever. Two parallel tracks are a convenience of authoring, not a
   * reason that turning one off cannot end the whole thing. So the run
   * itself is paused, and pressing play compiles a fresh one.
   */

  stopFilm = () => {
    this.region?.run?.pause();
  };

  /** a TAP on the screen means "let me use it": the app cues stop */
  seizeApps = () => {
    if (this.selfTap) {
      return;
    }
    if (this.syncOn) {
      this.syncOn = false;
    }
  };

  /** the run reached its end: resuming has to compile a fresh one */
  private ended = false;

  toggleCamera = () => {
    const next = !this.cameraOn;
    this.cameraOn = next;
    this.syncOn = next;
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

  toggleSync = () => {
    this.syncOn = !this.syncOn;
    if (this.syncOn) {
      this.take += 1;
    }
  };

  /** hand the whole thing back to the film: both tracks, from the top */
  /** resync is a deliberate RESTART — "from the top" — not a resume */
  resync = () => {
    this.cameraOn = true;
    this.syncOn = true;
    this.ended = false;
    this.take += 1;
  };

  get running() {
    return this.cameraOn || this.syncOn;
  }

  /** true only while the film is pressing something itself */
  private selfTap = false;

  /**
   * THE CAMERA TRACK IS A 3D THING. Flat, the phone faces you and there
   * is nowhere to move to — a zoom on a flat mockup is just a resize, and
   * it fought the app's own layout. So 2D plays the app interactions and
   * leaves the camera alone.
   */
  get cameraTrack() {
    return this.cameraOn;
  }

  /**
   * Whether the film may drive the PHONE. In 3D a stopped camera means
   * someone is looking at something and the demo should not open apps
   * under them; flat, there is no camera to stop, so being synced is the
   * whole condition — which is why 2D starts playing the moment the page
   * does.
   */
  get autoplay() {
    return this.syncOn && (this.mode === '2d' || this.cameraOn);
  }

  /**
   * Drag a pad. Each maps its box to a pair of pose values — the orbit
   * pad to yaw and pitch, the pan pad to truck and pedestal, the rail to
   * dolly — and writes straight through to the host.
   */
  /**
   * THUMBSTICKS, not sliders.
   *
   * Three things make a stick feel like a stick rather than a dot you
   * drag. It RESISTS — the further out you pull, the more travel each
   * pixel of finger buys you less of, so the edge of the pad is somewhere
   * you have to mean to reach. It is DAMPED — the knob chases the finger
   * on a spring rather than teleporting under it, the way
   * `follow-pointer` chases. And it SNAPS HOME on release, slightly
   * under-damped, so letting go reads as elastic rather than as a slide
   * back to zero.
   *
   * The camera integrates the stick's offset: a held stick keeps turning,
   * it does not jump. That is what makes centring on release sensible —
   * the stick is a rate, not a position, and the camera keeps whatever
   * the stick gave it.
   */
  padDrag = modifier((el: HTMLElement, [kind]: [string]) => {
    /** where the finger is asking the knob to be, -1..1 on each axis */
    /** where the knob actually is: a spring chasing `want` */
    const knob = { vx: 0, vy: 0, x: 0, y: 0 };
    let held = false;
    let raf = 0;

    /**
     * Progressive resistance. A linear pad hits its limit the moment you
     * leave the middle; this spends the first half of the travel on fine
     * control and makes the outer reaches cost real distance.
     */
    const resist = (t: number) =>
      Math.sign(t) * Math.min(1, Math.abs(t)) ** 1.7;

    const read = (ev: PointerEvent) => {
      const b = el.getBoundingClientRect();
      const half = Math.min(b.width, b.height) / 2 || 1;
      const raw = {
        x: (ev.clientX - (b.left + b.width / 2)) / half,
        y: (ev.clientY - (b.top + b.height / 2)) / half,
      };
      want = { x: resist(raw.x), y: resist(raw.y) };
    };

    // the spring the knob rides: chasing while held, homing when let go
    const CHASE = { k: 340, c: 26 };
    const HOME = { k: 150, c: 15 };
    let last = 0;

    let want = { x: 0, y: 0 };
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
      // THE STICK IS A RATE. A held stick keeps turning the camera, which
      // is why it can spring home without undoing what it did.
      // THE NUDGE IS NOT EASED. While the film is playing the stick is a
      // modifier laid on top of a moving pose, so it follows the FINGER
      // directly — running it through the knob's spring would add a
      // second easing on top of the camera's own and the shot would
      // wobble. The knob still springs; only what it looks like is
      // damped. Stopped, there is no film to fight, so the damped value
      // is the nicer one to integrate.
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
      // a stick is a control, not a scroll surface: hold it and drag as
      // far as you like without the page moving under your thumb
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
      if (this.running) {
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
    // START CLEAN. An inline transform is how the 3D tick drives the
    // plane, and anything left on it — from a previous mount, or an HMR
    // swap — beats the 2D stylesheet and leaves a flat phone wearing a
    // 3D matrix with no bezel.
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
     * mistaken for a card — and on a PHONE, where the demo IS the page and
     * the stage is short by definition, it classified the real thing as a
     * card and the demo arrived stopped. The page and the card have
     * different containers; ask which one this is.
     */
    const onOwnPage = !!host.closest('.stage-wrap');
    this.roomy = onOwnPage;
    if (!onOwnPage) {
      this.cameraOn = false;
      this.syncOn = false;
    } else {
      // a region does not collect its score on the pass that first renders
      // it, so the film needs one more pass before it exists at all
      requestAnimationFrame(() => {
        this.take += 1;
      });
    }

    const fitFlat = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      const fill = fillFor(h);
      const k = Math.min((h * fill) / SCREEN.h, (w * fill) / SCREEN.w);
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
    let stopTheme: (() => void) | undefined;
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
        const fill = fillFor(h);
        const dV = phone.h / fill / 2 / Math.tan(vFov / 2);
        const dH = phone.w / fill / 2 / Math.tan(hFov / 2);
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

      /**
       * THE FLOOR BOUNCE. Wide, low and BEHIND — a big soft source coming
       * up off the table at the back of the phone. It never lights the
       * face; what it does is catch the bottom and rear edges of the
       * titanium and draw a bright hairline all the way round the
       * silhouette, which is the thing that separates a device from its
       * background in every product shot ever lit.
       */
      const bounceUp = new T.RectAreaLight(0xdfe7f5, 3.6, 1500, 620);
      bounceUp.position.set(0, -880, -640);
      bounceUp.lookAt(0, 0, 0);
      scene.add(bounceUp);

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
      const cycCanvas = document.createElement('canvas');
      cycCanvas.width = 512;
      cycCanvas.height = 512;
      const cycCtx = cycCanvas.getContext('2d')!;
      const cycTex = (() => {
        const c = cycCanvas;
        const g = cycCtx;
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
      /**
       * THE SET FOLLOWS THE PAGE. The backdrop is painted from the
       * gallery's own `--bg`, so the shot sits in light and dark without
       * a second palette — and it is repainted when the visitor flips the
       * theme, because a dark cyc behind a light page reads as a hole.
       */
      const dressSet = () => {
        // TWO SETS, NOT ONE TINTED. A product shot needs the device to be
        // the brightest thing in frame, so neither set is the page colour:
        // dark mode gets a near-black warm cyc, light mode a medium slate
        // that is clearly darker than the paper around it but visibly its
        // own tone rather than the dark set reused.
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
        const spot = g.createRadialGradient(256, 322, 8, 256, 322, 200);
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
      setPlane.position.set(0, 0, -2600);
      scene.add(setPlane);

      /** everything the pointer orbits */
      const pivot = new T.Object3D();
      scene.add(pivot);
      /** the screen's own frame: what the DOM plane is pinned to */
      const anchor = new T.Object3D();
      pivot.add(anchor);

      const draco = new DRACOLoader().setDecoderPath(DRACO);
      const loader = new GLTFLoader().setDRACOLoader(draco);
      await new Promise<void>((resolve) => {
        loader.load(PHONE, (gltf) => {
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
          // NOT alphaTest. It discards fragments below the threshold, and
          // this material's whole point is a uniform 0.05 alpha — every
          // fragment fails, the display mesh disappears, and you are left
          // looking through the front of the phone at the inside of its
          // own back shell. The seam is handled on the DOM side instead:
          // see the scale passed to objectCss.
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

          let biggest: { bulk: number; mesh: THREE.Mesh | null } = {
            bulk: 0,
            mesh: null,
          };
          model.traverse((child) => {
            if (!(child as THREE.Mesh).isMesh) {
              return;
            }
            const mesh = child as THREE.Mesh;
            // every mesh joins the key light's layer EXCEPT the display
            if (mesh !== found.mesh) {
              mesh.layers.enable(EYE_LEVEL);
            }
            // THE LOGO IS COPLANAR WITH THE BACK SHELL, and two surfaces
            // at the same depth is a coin toss per pixel per frame — the
            // stripes tearing through the mark as the phone turns.
            //
            // A polygon offset breaks the tie by biasing one surface in
            // DEPTH ONLY, and it has to be ONE: applying it to every
            // material moves both by the same amount and changes nothing,
            // which is what the first attempt did. Identifying the decal
            // is fiddly — a logo may be flat or extruded, its own mesh or
            // a submesh — but identifying the SHELL is trivial: it is the
            // biggest thing in the model. So the shell is pushed back and
            // everything sitting on it wins the tie by default.
            const vol = new T.Box3()
              .setFromObject(mesh)
              .getSize(new T.Vector3());
            const bulk = vol.x * vol.y * vol.z;
            if (bulk > biggest.bulk) {
              biggest = { bulk, mesh };
            }
          });

          // ...applied after the walk, once the biggest is actually known
          const shove = (m: THREE.Material) => {
            const p = m as THREE.Material & {
              polygonOffset?: boolean;
              polygonOffsetFactor?: number;
              polygonOffsetUnits?: number;
            };
            p.polygonOffset = true;
            p.polygonOffsetFactor = 6;
            p.polygonOffsetUnits = 6;
          };
          if (biggest.mesh) {
            const mat = biggest.mesh.material;
            if (Array.isArray(mat)) {
              mat.forEach(shove);
            } else {
              shove(mat);
            }
          }

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
        // THE SEAM ROUND THE SCREEN. The hole is a polygon edge, and the
        // GPU antialiases it by writing partial coverage into ALPHA —
        // which NoBlending then writes verbatim, so the boundary pixels
        // come out half-transparent in a stair-step that MSAA cannot fix
        // because MSAA is what makes it. The DOM plane's own rounded rect
        // IS properly antialiased, so oversizing it a touch lays that
        // clean edge over the ragged one and only one edge is ever seen.
        plane.style.transform = objectCss(anchor.matrixWorld.elements, 1.008);
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
      this.drawn = Boolean(mapped);
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
    /** the stick's pull, ADDED to the film's pose and unwound on release */
    const lean: Camera3DState = { dolly: 0, pitch: 0, x: 0, y: 0, yaw: 0 };
    /**
     * The limits, held locally. They are the module's RANGE, captured
     * once — a destructure of a missing binding throws inside the render
     * loop, and a camera that throws every frame leaves the phone facing
     * whichever way it happened to be pointing.
     */
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
      const pose = at;
      host.style.setProperty('--yaw-at', String(pct(pose.yaw, LIMIT.yaw)));
      host.style.setProperty(
        '--pitch-at',
        String(pct(pose.pitch, LIMIT.pitch))
      );
      host.style.setProperty('--pan-x-at', String(pct(pose.x, LIMIT.pan)));
      host.style.setProperty('--pan-y-at', String(pct(pose.y, LIMIT.pan)));
      host.style.setProperty(
        '--dolly-at',
        String(pct(pose.dolly, LIMIT.dolly))
      );
      host.style.setProperty('--yaw-n', pose.yaw.toFixed(0));
      host.style.setProperty('--pitch-n', pose.pitch.toFixed(0));
      host.style.setProperty('--dolly-n', pose.dolly.toFixed(2));
    };
    const apply = () => {
      const at = shown();
      ry = Math.PI + (at.yaw * Math.PI) / 180;
      rx = (at.pitch * Math.PI) / 180;
      dolly = at.dolly;
      // truck and pedestal: fractions of the framed height, so the same
      // pose reads the same whatever box the demo was given
      truck = at.x * SCREEN.h;
      pedestal = at.y * SCREEN.h;
      // THE FLAT PHONE HAS NO THREE.JS CAMERA. In 2D everything above
      // writes to a renderer that is not running, so the same pose is
      // also published as plain custom properties and the CSS plane is
      // transformed by them — one pose, two renderers. Moving the camera
      // right is the subject moving left, hence the sign.
      host.style.setProperty('--zoom-mul', (1 / at.dolly).toFixed(4));
      host.style.setProperty(
        '--pan-x-px',
        `${(-at.x * SCREEN.h).toFixed(1)}px`
      );
      host.style.setProperty('--pan-y-px', `${(at.y * SCREEN.h).toFixed(1)}px`);
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
        // a stick's contribution ADDS, and every axis is clamped to the
        // same range the script writes within
        if (partial.yaw !== undefined) {
          pose.yaw = clamp(pose.yaw + partial.yaw, LIMIT.yaw);
        }
        if (partial.pitch !== undefined) {
          pose.pitch = clamp(pose.pitch + partial.pitch, LIMIT.pitch);
        }
        if (partial.x !== undefined) {
          pose.x = clamp(pose.x + partial.x, LIMIT.pan);
        }
        if (partial.y !== undefined) {
          pose.y = clamp(pose.y + partial.y, LIMIT.pan);
        }
        if (partial.dolly !== undefined) {
          pose.dolly = clamp(pose.dolly + partial.dolly, LIMIT.dolly);
        }
      } else {
        Object.assign(pose, partial);
      }
      apply();
    };
    apply();
    this.boot = run3d;
    this.halt = () => {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      this.drawn = false;
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
      stopTheme?.();
      ro.disconnect();
      host.removeEventListener('pointerdown', grab);
      host.removeEventListener('click', swallow, true);
      host.removeEventListener('click', touched, true);
      delete (window as SpikeWindow).__glb;
      this.boot = undefined;
      this.halt = undefined;
    };
  });

  <template>
    <div class="mg-page" data-mode={{this.mode}}>
      <Choreo
        class="mg-stage"
        data-mode={{this.mode}}
        data-ready={{if this.drawn "yes" ""}}
        style="--glow:{{this.shown.hue}}"
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
            style="width:{{this.take}}px"
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
              {{! HOME, WITHOUT GOING BACK TO THE BEGINNING.
                  This beat is RELATIVE: it pulls back far enough to see
                  the whole home screen, and that is all it does. An
                  absolute home pose meant every app switch yanked the
                  phone to the same front-on posture, so the film kept
                  re-introducing a device you had been watching for half a
                  minute. Relative, the hallway keeps whatever angle the
                  last scene left it at and only the distance changes. }}
              {{#if this.cameraTrack}}
                <c.Camera3D
                  @by={{true}}
                  @dolly={{1.22}}
                  @y={{-0.03}}
                  @duration={{this.travel}}
                  @ease={{this.glide}}
                />
              {{else}}
                <c.Wait @duration={{this.travel}} />
              {{/if}}

              {{! ONLY WHEN BOTH ARE ON. A stopped camera means someone is
                  looking at something; opening and closing apps under them
                  is the demo talking over them. And a desynced phone is
                  theirs to drive. }}
              {{#if this.autoplay}}
                <c.Perform @action="open" @target={{scene.app}} />
              {{/if}}

              {{! THE BEATS — one lock-on per thing worth looking at.
                  ONE STEP DRIVES BOTH MODES: in 3D the host applies the
                  pose to three.js, in 2D to the CSS plane. There is no
                  second camera track to keep in sync. }}
              {{#each scene.beats as |beat|}}
                {{#if beat.tap}}
                  {{#if this.autoplay}}
                    <c.Perform
                      @action="tap"
                      @target={{scene.app}}
                      @payload={{beat.tap}}
                    />
                  {{/if}}
                {{/if}}
                {{#if this.cameraTrack}}
                  <c.Camera3D
                    @yaw={{beat.yaw}}
                    @pitch={{beat.pitch}}
                    @dolly={{beat.dolly}}
                    @x={{beat.x}}
                    @y={{beat.y}}
                    @duration={{beat.t}}
                    @ease={{this.glide}}
                  />
                {{else}}
                  <c.Wait @duration={{beat.t}} />
                {{/if}}
              {{/each}}

              {{#if this.autoplay}}
                <c.Perform @action="close" @target={{scene.app}} />
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
          >{{if this.arming "3D…" "3D"}}</button>
        </div>

        <div class="mg-transport">
          <button
            type="button"
            data-on={{if this.cameraOn "yes" ""}}
            {{on "click" this.toggleCamera}}
          >
            {{#if this.cameraOn}}
              <svg class="mg-ico" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            {{else}}
              <svg class="mg-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            {{/if}}
            camera
          </button>

          {{! NO BUTTON WHILE IT IS SYNCED. A control that only ever says
              "on" is furniture; this one appears the moment you take the
              phone over, which is also the moment it means something. }}
          {{! shown whenever the film is NOT fully driving — a stopped
              camera leaves the phone just as out of sync as a tapped
              screen does, and both want the same way back }}
          {{#unless this.autoplay}}
            <button type="button" class="mg-resync" {{on "click" this.resync}}>
              <svg class="mg-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                />
                <path d="M19.6 3.6v5.2h-5.2z" />
              </svg>
              resync
            </button>
          {{/unless}}
        </div>

        {{! THE POSE, SHOWN AND SETTABLE. Every dot is positioned from a
            custom property the adapter writes each frame, so the film
            moves them; dragging one writes the same pose back and takes
            the camera over. One pose, two ways to set it. }}
        {{#if this.roomy}}
          <div class="mg-pads">
            <div class="mg-pad mg-pad-orbit" {{this.padDrag "orbit"}}>
              <span class="mg-pad-dot mg-dot-orbit"></span>
              <span class="mg-pad-name">rotate</span>
            </div>
            <div class="mg-pad" {{this.padDrag "pan"}}>
              <span class="mg-pad-dot mg-dot-pan"></span>
              <span class="mg-pad-name">pan</span>
            </div>
            <div class="mg-rail" {{this.padDrag "dolly"}}>
              <span class="mg-rail-dot"></span>
              <span class="mg-pad-name">zoom</span>
            </div>
          </div>
        {{/if}}
      </div>

      <style>
        /* A DEMO IS NOT A DOCUMENT. Nothing here is text to select, and a
           drag on a stick must not scroll the page out from under it. */
        .mg-page,
        .mg-page * {
          user-select: none;
          -webkit-user-select: none;
        }
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
        /* Shown whenever the scene is up, hidden otherwise. This was an
           opacity cross-fade keyed on two data attributes, and the canvas
           sat at opacity 0 with a live renderer painting behind it: the
           engine, the model and the loop were all healthy and the picture
           was simply invisible. A dissolve is not worth that. */
        .mg-stage canvas {
          position: absolute;
          inset: 0;
          z-index: 2;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }
        .mg-stage[data-mode="2d"] canvas {
          display: none;
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
          /* the pan and zoom sit INSIDE the scale, so they are expressed
             in the screen's own 390x844 pixels and read identically at
             any container size */
          transform: translate(-50%, -50%)
            scale(calc(var(--k, 0.6) * var(--zoom-mul, 1)))
            translate(var(--pan-x-px, 0px), var(--pan-y-px, 0px));
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
        /* an open app is opaque: several of these screens have their own
           translucent grounds, and the home screen was reading straight
           through them */
        .mg-app-ui {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: inherit;
          background: #0b0d12;
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
          /* above the home screen, which stays mounted underneath so it
             never reflows — without this the icons paint over the app */
          z-index: 6;
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
        /* an open app is opaque: several of these screens have their own
           translucent grounds, and the home screen was reading straight
           through them */
        .mg-app-ui {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: inherit;
          background: #0b0d12;
        }
        .mg-app-name {
          color: #fff;
          font-size: 40px;
          font-weight: 600;
          font-family: ui-sans-serif, system-ui;
        }
        /* THE MARKER MUST MOVE, NOT JUST CHANGE. A region declines a pass
           in which no participant's box changed, so a marker with a fixed
           off-screen box let the loop's bump be thrown away and the film
           never started. Its width is the take, so every bump is a real
           layout change. */
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
        /* the SELECTED half is filled, the other is an outline — a pair
           of outlines makes the switch read as two links */

        /* CLIP THE EXPANDING PANEL. The app grows from an 82px tile to the
           full 390x844 screen, and mid-flight its rounded box does not yet
           match the screen's — so without a second clip on the plane
           itself the corners paint over the mockup's chin. The bezel is
           drawn with rings OUTSIDE the box, and overflow does not clip an
           element's own shadow, so this costs the bezel nothing. */
        .mg-plane {
          overflow: hidden;
        }
        .mg-pad-dot,
        /* THE DOTS ARE THE CAMERA. Positioned from the properties the
           adapter writes every frame, so they travel with the film and
           sit wherever a drag last put them. */
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

        /* THE ISLAND IS HARDWARE. It is cut into the panel, so it paints
           over whatever the app is drawing — and the app's own content
           starts below it rather than sliding underneath. Every screen
           gets the same safe area, so no app has to know about it. */
        .mg-island {
          z-index: 9;
        }
        /* The apps already lay their own status bars out around the
           island; pushing their content down as well only exposed a band
           of app background above it. The island paints on top and that
           is enough. */

        /* GLASSMORPHIC THUMB CONTROLS, the way a game overlays them on an
           iPad: a frosted disc that sits on the picture rather than in a
           panel beside it, and a knob that rides a spring inside it. */
        .mg-pads {
          position: absolute;
          z-index: 5;
          right: 14px;
          /* room for the labels, which hang below each disc */
          bottom: 26px;
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .mg-pad,
        .mg-rail {
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
        .mg-pad:active,
        .mg-rail:active {
          cursor: grabbing;
        }
        .mg-pad {
          width: 54px;
          height: 54px;
        }
        .mg-rail {
          width: 32px;
          height: 54px;
          border-radius: 999px;
        }
        /* THERE IS NOTHING TO ROTATE IN 2D. The flat phone faces you by
           definition, so a rotate stick there is a control that does
           nothing — worse than one that is missing. */
        .mg-page[data-mode="2d"] .mg-pad-orbit {
          display: none;
        }
        .mg-pad-name {
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
        /* the knob: pushed by --knob-x/y, which the spring writes each
           frame while the stick is held and unwinds when it is let go */
        .mg-pad-dot,
        .mg-rail-dot {
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
        /* zoom runs UP AND DOWN, and the same height as the sticks beside
           it — a horizontal slider among two round pads reads as a
           different kind of control than it is */
        .mg-rail-dot {
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
           same fact the film is: see onOwnPage. */
        /* SMALLER ON A NARROW SCREEN, not absent. Three 54px discs are
           half the width of a phone; at 42 they are a control rather than
           a panel, and the demo keeps the one affordance that makes the
           device feel like an object you can turn. */
        @media (max-width: 760px) {
          .mg-pads {
            gap: 10px;
            right: 10px;
            bottom: 22px;
          }
          .mg-pad {
            width: 42px;
            height: 42px;
          }
          .mg-rail {
            width: 26px;
            height: 42px;
          }
        }

        .mg-ico {
          width: 12px;
          height: 12px;
          margin-right: 5px;
          vertical-align: -1px;
          fill: currentColor;
        }
        .mg-seg button,
        .mg-transport button {
          display: inline-flex;
          align-items: center;
        }
        /* 3D IS THE POINT, and 2D is only the default because the engine
           is a megabyte and a half. So the switch says so: while you are
           flat, the other half of it is drawn as the live option. */

        /* the flat set, in the same two tones the WebGL cyc uses, so
           switching 2D/3D does not change the room */
        .mg-stage {
          background:
            radial-gradient(
              120% 90% at 50% 8%,
              #23262d 0%,
              #14161b 46%,
              #090a0d 100%
            ),
            #14161b;
        }
        :root[data-theme="light"] .mg-stage {
          background:
            radial-gradient(
              120% 90% at 50% 8%,
              #6d7481 0%,
              #5b626e 46%,
              #3f444e 100%
            ),
            #5b626e;
        }

        /* THE SWITCH READS AT A GLANCE. Both halves stay legible white on
           the set; the selected one is the only thing that changes. 3D is
           the ember pill because it is the thing worth pressing; 2D is the
           white outline, which is a state rather than an invitation. */
        .mg-seg button {
          color: #ffffff;
          border-color: #ffffff5c;
          background: transparent;
        }
        .mg-seg button:last-child[aria-pressed="true"] {
          background: var(--ember-hot, #ff6a3a);
          border-color: var(--ember-hot, #ff6a3a);
          color: #ffffff;
          font-weight: 700;
        }
        .mg-seg button:first-child[aria-pressed="true"] {
          background: #ffffff;
          border-color: #ffffff;
          color: #16181d;
          font-weight: 700;
        }
        /* while flat, the other half is tinted to say it is worth a press */
        .mg-page[data-mode="2d"] .mg-seg button:last-child {
          color: var(--ember-hot, #ff6a3a);
          border-color: var(--ember-hot, #ff6a3a);
        }
        .mg-transport button[data-on="yes"] {
          border-color: #ffffff8f;
          background: #ffffff1f;
          color: #ffffff;
        }
      </style>
    </div>
  </template>
}

export default Mockup;
