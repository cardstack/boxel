import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { DialConfig } from 'dialkit/store';
import { modifier } from 'ember-modifier';
import { beacon, Choreo, motion } from 'glimmer-motion';
import { DialPanel } from 'test-app/components/dial-panel';
import { Dial } from 'test-app/lib/dial';
import {
  applied,
  autopilot,
  type Car,
  CHARACTERS,
  type DriftTuning,
  type DriveInput,
  forwardOf,
  GATE_R,
  makeCar,
  makeShot,
  MARK_GAP,
  routeOf,
  type Shot,
  slipAngleOf,
  speedOf,
  STEP,
  stepCar,
  stepShot,
  through,
  wrap,
} from 'test-app/lib/drift';
import { onStage } from 'test-app/lib/onstage';
import { preventSelect } from 'test-app/lib/pointer';

/**
 * A car you tune while you are driving it.
 *
 * Every other stage that has ever had a control panel over it moves a box
 * around: you drag a number, a rectangle travels differently, and you take the
 * demo's word for it that the number mattered. This one changes what it is
 * like to be driving. That is the whole argument for the seam, and it is not
 * an argument a two-slider stage can make — you can hold `damping: 28` and
 * `stiffness: 100` in your head, and a panel over them is a convenience. You
 * cannot hold a car in your head. You tune it by driving, feeling that it
 * pushes wide, moving one number, and driving again.
 *
 * Hold the pointer anywhere on the track and the car drives at it. That is the
 * entire control scheme, and it is one continuous input you never let go of —
 * so the interruption doctrine is under load the whole time rather than once
 * per click.
 *
 * ## What is Choreo here, and what is deliberately not
 *
 * The driving loop is not a score, and `docs/drift.md` is written mostly to say
 * so before anyone builds this and discovers it halfway in. Motion's springs
 * are scalar interpolators toward a target; a drift is a velocity decomposition
 * with a friction coefficient on the sideways half. So `lib/drift.ts` is fifty
 * lines of hand-written integration, and the springs in it are hand-integrated
 * from the same `stiffness / damping` pair Motion parameterises with — which is
 * what lets one panel sit over both halves of this stage.
 *
 * The chase camera is in that loop too, for the same reason, and this is the
 * correction the note needed: `c.Camera` is a seekable CUE — a shot change with
 * a duration, compiled into a score, reconstructible under random access. A
 * chase camera is the other thing entirely, a target that moves every frame and
 * a lens that never quite arrives. Compiling a region sixty times a second to
 * express that would be a misuse of the score and a poor advertisement for it.
 *
 * So does Choreo do anything here? Yes, and it is the honest half: the lap
 * board. A lap ends, one entry is inserted, the entries below it shuffle down,
 * and the slowest lap falls off the bottom. That is a changeset — a list that
 * changed, once, at a moment, with no one having told any row where to go — and
 * it is exactly what a region is for. The rule this stage is really teaching is
 * the one no other stage says out loud: **a score for the scene change, a loop
 * for the simulation.** Reaching for the wrong one is how animation code gets
 * bad, in both directions.
 *
 * ## The skid marks are a canvas, and that is also on purpose
 *
 * `docs/drift.md` wanted them as `c.inserted` / `c.removed` over a list nobody
 * clicked to build. They are a canvas instead. A mark is laid every thirteen
 * world pixels of slide, which at speed is twenty a second, and a changeset
 * twenty times a second is not a changeset — it is a render loop wearing one.
 * The marks also want to persist: a track covered in the evidence of how you
 * have been driving is the thing you leave with, and Choreo's business is
 * elements that move, not ink that never will.
 */

const WORLD = { h: 900, w: 1400 };

/**
 * The circuit: four gates, taken in order, with the walls a long way outside
 * them.
 *
 * It was briefly six gates on an oval, on the theory that sixty-degree turns
 * are easier to carry speed through than ninety-degree ones. They are, and the
 * track was worse: a rounded circuit is one continuous turn, so the car is
 * never straight, never settled, and never doing the thing this stage exists to
 * show. A square corner is an EVENT — you arrive at it, you commit to it, and
 * either the tail comes round or it does not. Four of those with a straight
 * between them is a lap you can read.
 *
 * The run-off matters more than the shape. The corner is exactly where a car is
 * going to run wide, and a corner with no room outside it turns every overcooked
 * entry into a crash and a restart.
 */
const GATES = [
  { x: 1120, y: 210 },
  { x: 1120, y: 690 },
  { x: 280, y: 690 },
  { x: 280, y: 210 },
];

const START = { heading: 0, x: 430, y: 210 };

/**
 * The line the computer drives, built once from the gates above.
 *
 * A spline rather than the gates themselves, because the gates are a scoring
 * rule and a line is a plan. See `routeOf` — the short version is that aiming
 * at the next gate is not a racing line, and every symptom of the bot driving
 * badly came from it not having one.
 */
const ROUTE = routeOf(GATES);

/** how many laps the board holds before the slowest one falls off it */
const BOARD = 5;

/**
 * The panel, as dialkit reads it.
 *
 * EVERY DEFAULT HERE IS DRIFTY'S. The first number in each tuple is what the
 * stage loads with, and the shipped characters are things you PRESS — so if
 * these two ever disagree, the car you drive on arrival is one that no preset
 * describes and no test covers. That is not a hypothetical: reducing Drifty's
 * engine in `lib/drift.ts` and not here left the suite validating 490 while
 * the stage ran 520, and the tuning note in CHARACTERS describing a car you
 * could only reach by clicking its own name. `drift-test.ts` pins the two
 * together now.
 *
 * Nested by construction, which is the reason this demo needed the panel to
 * grow folders: a macro on top, then the three pairs that make up a car, then
 * the engine. `_collapsed: true` is dialkit's own key for a folder that opens
 * shut — the store turns it into `defaultOpen: false` and drops it from the
 * values (store index.js:569), so it costs nothing at runtime.
 *
 * The ranges are the honest part of a tuning panel and the part nobody writes
 * down. Each one is set so that BOTH ends are a car you can drive: a slider
 * whose left half spins the car into the wall teaches that the number is
 * dangerous, not what it does.
 *
 * Terminal speed is `power / drag`, so the two engine sliders multiply out —
 * and the first cut of them was wrong in a way that only shows at the corners
 * of the range. Power to 1000 against drag at 0.4 is a terminal speed of 2500
 * world px a second across a track 1400 wide: half a second end to end, which
 * is not a fast car, it is an unusable one. Both ranges are pulled in so that
 * every combination of the two is still a car, which is the actual rule a
 * slider range has to satisfy.
 *
 * The DEFAULTS are `Drifty`, to the number — the stage is called Drift, and
 * opening on the forgiving car to protect the first thirty seconds gets those
 * thirty seconds wrong in the other direction: it shows you a competent car
 * going round a circuit, which is not what anyone came for. `Stable` is one
 * chip away.
 *
 * The pair doing the work is a LOW break-away threshold with a lot of bite
 * behind it: a car that steps out at the smallest provocation and hooks up hard
 * the moment you catch it. Under the autopilot it laps without touching a wall
 * once and spends the whole lap sideways. See CHARACTERS in `lib/drift.ts` for
 * why those two numbers in that combination are the entire recipe.
 */
export const TUNING = {
  looseness: [0.6, 0, 1, 0.02],
  engine: {
    _collapsed: true,
    drag: [1.1, 0.6, 2.2, 0.05],
    power: [490, 200, 700, 10],
  },
  grip: {
    _collapsed: true,
    bite: [10, 1, 14, 0.2],
    release: [0.13, 0.08, 0.6, 0.01],
  },
  steering: {
    _collapsed: true,
    damping: [20, 2, 40, 1],
    lock: [1, 0.4, 1.4, 0.02],
    stiffness: [120, 20, 400, 5],
  },
  yaw: {
    _collapsed: true,
    damping: [20, 2, 40, 1],
    stiffness: [120, 20, 400, 5],
  },
} satisfies DialConfig;

/** the entry arriving from the lap clock */
const ARRIVE = { damping: 22, stiffness: 260 } as const;
/** the rows it pushed down: a shuffle is not an arrival */
const SHUFFLE = { damping: 26, stiffness: 320 } as const;
/** and the lap that fell off the bottom */
const DROP = { damping: 24, stiffness: 190 } as const;

/** past this much of a turn, and below this much forward speed, back out */
const STUCK_ARC = 2;
const STUCK_SPEED = 40;

export interface Lap {
  id: number;
  ms: number;
}

const shownTime = (ms: number) => (ms / 1000).toFixed(2);

export class Drift extends Component {
  /**
   * `{ presets: true }` rather than a bare `true`: the store persists VALUES
   * and PRESETS through two different switches, and the default only covers
   * the first. A panel whose saved tunes vanish on reload is worse than one
   * that never offered to save them.
   */
  dial = new Dial('drift-car', 'The car', TUNING, {
    persist: { presets: true },
  });

  characters = CHARACTERS;

  @tracked laps: Lap[] = [];
  @tracked gate = 0;
  /**
   * Whether the stage is driving itself.
   *
   * The reason this button exists is that you cannot feel a tuning change while
   * you are also the driver: a worse car and a better driver arrive together,
   * you adapt inside one lap, and you conclude the slider did nothing. A driver
   * that never adapts turns the panel into an instrument. Tune while it laps.
   */
  @tracked auto = false;
  @tracked note = 'hold anywhere on the track — the car drives at your finger';

  private car: Car = makeCar(START.x, START.y, START.heading);
  private shot: Shot = makeShot(START.x, START.y);
  private input: DriveInput = { brake: 0, steer: 0, throttle: 0 };

  private raf = 0;
  private last = 0;
  private acc = 0;

  /** where the finger is, in WORLD coordinates; null when nobody is driving */
  private aim: { x: number; y: number } | null = null;

  private lapStart = 0;
  private lapMs = 0;
  /** nothing is timed until the first press: a clock that ran while you read
      the page is not a lap time */
  private rolling = false;
  private nextId = 1;
  private laid = { x: START.x, y: START.y };
  /**
   * Where the two rear tyres were last time a mark was laid, so a mark can be
   * a LINE from there to here rather than a dot at here.
   *
   * Null whenever the car is not laying rubber, which is what stops a slide
   * that ends on one corner and starts on the next from being joined by a
   * straight chord across the middle of the track.
   */
  private tyres: { lx: number; ly: number; rx: number; ry: number } | null =
    null;
  private frames = 0;

  /** the human has the pointer down — the panel gets out of the way */
  @tracked driving = false;
  /**
   * And the panel can be put away by hand, which matters most in exactly the
   * case the automatic rule does not cover: while the computer is driving, the
   * finger is never down, so the panel never withdraws on its own — and that is
   * the one time you want to watch the car uninterrupted.
   */
  @tracked showPanel = true;

  /**
   * Whether anyone can see this. The loop does not run when nobody can.
   *
   * A fixed-step integrator at 120Hz with a canvas under it is the most
   * expensive thing in the gallery, and forty-two stages share one main thread.
   * Scrolled away it stops entirely rather than ticking quietly — the car stays
   * exactly where it was, which is the right answer for a stage whose whole
   * point is the state you built up in it.
   */
  @tracked private seen = true;

  /** the scale currently written, so an unchanged answer writes nothing */
  private fitted = 1;
  private railEl: HTMLElement | null = null;
  private fitEl: HTMLElement | null = null;
  private viewEl: HTMLElement | null = null;
  private worldEl: HTMLElement | null = null;
  private carEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private dashEl: HTMLElement | null = null;
  private ink: CanvasRenderingContext2D | null = null;

  gates = GATES.map((g, i) => ({
    n: i + 1,
    style: `left:${g.x}px;top:${g.y}px;width:${GATE_R * 2}px;height:${GATE_R * 2}px`,
  }));

  worldStyle = `width:${WORLD.w}px;height:${WORLD.h}px`;

  /**
   * The board: fastest first, and only the top few.
   *
   * Recomputed from `laps` rather than maintained, because the whole point is
   * that nothing tells a row it moved. A new time is pushed, this sorts, and
   * the region works out from the DOM that row three is now row four — which is
   * the difference between a list that animates and a list of animations.
   */
  get board() {
    return [...this.laps]
      .sort((a, b) => a.ms - b.ms)
      .slice(0, BOARD)
      .map((lap, i) => ({
        best: i === 0,
        id: lap.id,
        rank: i + 1,
        shown: shownTime(lap.ms),
      }));
  }

  get bestMs() {
    return this.laps.length ? Math.min(...this.laps.map((l) => l.ms)) : null;
  }

  get tuning(): DriftTuning {
    return this.dial.values as unknown as DriftTuning;
  }

  /**
   * Scale the rail's contents to whatever room the card gave it.
   *
   * A stage is rendered at two very different sizes — a gallery card is around
   * 350px tall, its own page more than 600 — and the panel is the same panel in
   * both. Scrolling alone is not an answer at the small size: a tuning panel
   * you have to scroll to see is a tuning panel whose second half nobody knows
   * exists.
   *
   * `transform: scale` rather than a font-size ladder, because the panel is
   * dialkit's design and everything in it — the groove heights, the handle, the
   * gaps — is specified in pixels against that design. Scaling keeps the
   * proportions dialkit chose; re-specifying eight sizes at two breakpoints
   * would not, and would drift the moment the package changed.
   *
   * The wrapper's width is divided by the same factor so the scaled result
   * still fills the rail: transforms do not affect layout, so without it the
   * panel would shrink away from the right edge.
   */
  private fit = () => {
    const rail = this.railEl;
    const inner = this.fitEl;
    if (!rail || !inner) {
      return;
    }
    const natural = inner.scrollHeight;
    const room = rail.clientHeight;
    // there is a floor, and below it the rail scrolls instead. A panel that has
    // scaled itself illegible to avoid a scrollbar has made the wrong trade
    const k = natural > 0 ? Math.min(1, Math.max(0.72, room / natural)) : 1;
    // and a deadband on top of the fixed-width arrangement in the stylesheet:
    // two guards against the same feedback, because a resize loop does not
    // announce itself as a loop — it announces itself as a dropped frame here
    // and a failed assertion three files away
    if (Math.abs(k - this.fitted) < 0.01) {
      return;
    }
    this.fitted = k;
    rail.style.setProperty('--fit', String(k));
  };

  /**
   * The loop is started and stopped from here rather than by the modifier that
   * owns it, so that coming back on screen resumes rather than restarts: `last`
   * is reset to now, so the first frame after a long absence is one frame long
   * and not one minute long. Without that the accumulator would try to catch up
   * on every step it missed and the car would teleport.
   */
  private watch = (visible: boolean) => {
    if (visible === this.seen) {
      return;
    }
    this.seen = visible;
    if (visible) {
      this.last = performance.now();
      this.acc = 0;
      this.raf = requestAnimationFrame(this.loop);
    } else {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  };

  bindRail = modifier((el: HTMLElement) => {
    this.railEl = el;
    const ro = new ResizeObserver(this.fit);
    ro.observe(el);
    return () => {
      ro.disconnect();
      this.railEl = null;
    };
  });

  /**
   * Observed as well as the rail, because the thing that changes the panel's
   * natural height most often is not the window — it is a folder opening.
   */
  bindFit = modifier((el: HTMLElement) => {
    this.fitEl = el;
    const ro = new ResizeObserver(this.fit);
    ro.observe(el);
    return () => {
      ro.disconnect();
      this.fitEl = null;
    };
  });

  bindView = modifier((el: HTMLElement) => {
    this.viewEl = el;
    return () => {
      this.viewEl = null;
    };
  });

  bindWorld = modifier((el: HTMLElement) => {
    this.worldEl = el;
    return () => {
      this.worldEl = null;
    };
  });

  bindCar = modifier((el: HTMLElement) => {
    this.carEl = el;
    return () => {
      this.carEl = null;
    };
  });

  bindClock = modifier((el: HTMLElement) => {
    this.clockEl = el;
    return () => {
      this.clockEl = null;
    };
  });

  bindDash = modifier((el: HTMLElement) => {
    this.dashEl = el;
    return () => {
      this.dashEl = null;
    };
  });

  /**
   * The skid canvas is world-sized and never cleared.
   *
   * `alpha: false` is wrong here — the marks have to composite over the track
   * under them — but a `willReadFrequently` hint is also wrong, because nothing
   * ever reads it back. The default context is the right one; this comment
   * exists so nobody adds either flag on a hunch.
   */
  bindInk = modifier((el: HTMLCanvasElement) => {
    el.width = WORLD.w;
    el.height = WORLD.h;
    this.ink = el.getContext('2d');
    return () => {
      this.ink = null;
    };
  });

  /**
   * One rAF loop for the car, the camera, the ink and the two numbers on the
   * dashboard — and NOT one tracked property among them.
   *
   * Everything this writes goes straight onto a DOM node. A tracked `x` and `y`
   * would put a Glimmer revalidation between the integrator and the screen
   * sixty times a second, and — worse in this app — would invalidate the
   * `<Choreo>` region wrapping the lap board on every frame, so the region
   * would fingerprint and decline a pass sixty times a second forever. The
   * tracked state here is the lap board and the gate counter: things that
   * change a few times a minute, which is what tracked state is for.
   */
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    // a tab that was in the background does not get to teleport the car
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.acc += dt;

    const t = applied(this.tuning);
    // measured once a frame, not once a step: `clientWidth` is a layout read
    // and there are up to forty steps behind one frame
    const view = this.viewSize();
    let steps = 0;
    while (this.acc >= STEP && steps < 40) {
      this.advance(t, STEP, view);
      this.acc -= STEP;
      steps += 1;
    }
    this.paint(now, view);
  };

  start = modifier(() => {
    this.last = performance.now();
    this.lapStart = this.last;
    this.raf = requestAnimationFrame(this.loop);
    return () => cancelAnimationFrame(this.raf);
  });

  /** one physics step, plus the three things that watch it */
  private advance(
    t: ReturnType<typeof applied>,
    dt: number,
    view: { h: number; w: number }
  ) {
    const car = this.car;

    if (this.auto && !this.aim) {
      // the bot reads the same tune, off the same dial, on the same frame — so
      // a slider moved mid-lap changes the car under a driver who does not
      // flinch, which is the whole point of handing the wheel over
      const bot = autopilot(car, ROUTE);
      this.input.steer = bot.steer;
      this.input.throttle = bot.throttle;
      this.input.brake = bot.brake ?? 0;
    } else if (this.aim) {
      const dx = this.aim.x - car.x;
      const dy = this.aim.y - car.y;
      const err = wrap(Math.atan2(dy, dx) - car.heading);
      // let off near the finger, so it settles instead of circling it forever
      const away = Math.hypot(dx, dy) > 70;

      if (
        away &&
        (car.pinned || Math.abs(err) > STUCK_ARC) &&
        forwardOf(car) < STUCK_SPEED
      ) {
        /**
         * Backing out, and the reason this is not optional.
         *
         * Steering authority is proportional to forward speed, so a car that
         * has buried its nose in a wall cannot turn — and the engine pushes it
         * along the nose, which is into the wall it cannot turn away from.
         * Without this branch the only escape is the restart button, and a
         * driving demo whose failure state is a button is not a driving demo.
         *
         * `car.pinned` is the model's own answer to "am I in a wall", and it
         * matters more than the heading test beside it: a car wedged at an
         * angle is just as stuck as one square on, and the angle test misses it
         * every time.
         *
         * The steer term is negated because the heading turns the other way in
         * reverse: swinging the nose toward the target means asking for the
         * opposite lock, the same inversion as backing a trailer.
         */
        this.input.throttle = -0.6;
        this.input.brake = 0;
        this.input.steer = Math.max(-1, Math.min(1, -err * 2.4));
      } else {
        // a proportional term is all a car chasing a point needs; the wheel
        // spring in the loop is the rest of the controller
        this.input.steer = Math.max(-1, Math.min(1, err * 2.4));
        this.input.throttle = away ? 1 : 0;
        // arriving at the finger is a stop, not a coast: the pointer is where
        // you want the car to BE, so it should be shedding speed by the time it
        // gets there rather than sailing past and coming back
        this.input.brake = away ? 0 : 1;
      }
    } else {
      /**
       * Nobody is driving, so the brakes are on.
       *
       * Letting go used to coast, and coasting is the wrong answer for a
       * one-input control scheme: lifting your finger is the only way to say
       * stop, and a car that keeps going for another three seconds after you
       * have said stop is a car that does not answer. It also makes the pointer
       * a throttle as well as a wheel, which is most of what makes this
       * playable with one finger.
       */
      this.input.steer = 0;
      this.input.throttle = 0;
      this.input.brake = 1;
    }

    stepCar(car, this.input, t, dt, WORLD);
    stepShot(this.shot, car, dt, view, WORLD);

    /**
     * Gated on the drift ANGLE, not on `car.sliding`.
     *
     * `sliding` is a traction flag, and on the tunes this stage ships it is
     * true for most of the lap — so marks laid on it are laid constantly and
     * say nothing. The angle is what a person can see, so it is what the ink
     * should record: a car a few degrees out leaves nothing, and one properly
     * sideways leaves a stripe.
     */
    if (Math.abs(slipAngleOf(car)) > 0.22 && speedOf(car) > 75) {
      const dx = car.x - this.laid.x;
      const dy = car.y - this.laid.y;
      if (dx * dx + dy * dy > MARK_GAP * MARK_GAP) {
        this.lay();
        this.laid = { x: car.x, y: car.y };
      }
    } else {
      this.tyres = null;
    }

    if (through(car, GATES[this.gate]!)) {
      const next = this.gate + 1;
      if (next === GATES.length) {
        this.finishLap();
      } else {
        this.gate = next;
      }
    }
  }

  /**
   * Two rear tyres, as a line from where they were to where they are.
   *
   * This was a pair of filled circles per mark, and after two laps the track
   * looked like static: at speed the car lays twenty a second, each one a
   * separate blob, and blobs at that density read as noise rather than as
   * rubber. A stroked segment with a round cap is the same information drawn as
   * the thing it represents — one continuous line per tyre, which is what a
   * skid actually leaves.
   *
   * Weight follows the drift angle, so a car that is barely out leaves a hint
   * and a car sideways leaves a stripe. That is the whole readout: you can see
   * from the marks alone which corner you overcooked.
   */
  private lay() {
    const ink = this.ink;
    if (!ink) {
      return;
    }
    const car = this.car;
    const fx = Math.cos(car.yaw);
    const fy = Math.sin(car.yaw);
    const now = {
      lx: car.x - fx * 9 + fy * 7.5,
      ly: car.y - fy * 9 - fx * 7.5,
      rx: car.x - fx * 9 - fy * 7.5,
      ry: car.y - fy * 9 + fx * 7.5,
    };

    const was = this.tyres;
    if (was) {
      const angle = Math.abs(slipAngleOf(car));
      ink.strokeStyle = `rgba(22,19,17,${0.16 + Math.min(0.4, angle * 0.5)})`;
      ink.lineCap = 'round';
      ink.lineWidth = 5;
      ink.beginPath();
      ink.moveTo(was.lx, was.ly);
      ink.lineTo(now.lx, now.ly);
      ink.moveTo(was.rx, was.ry);
      ink.lineTo(now.rx, now.ry);
      ink.stroke();
    }
    this.tyres = now;
  }

  /**
   * And they fade, which the first version did not.
   *
   * Marks that last forever sound like the right answer — the track keeps a
   * record of how you have been driving, which is the thing you leave with. In
   * practice ninety seconds of it covers every inch of the circuit and the
   * record stops being readable at all. The rate is set so that roughly the
   * last two laps are legible and everything before them has gone: enough to
   * compare this corner with the one you took last time round, which is the
   * only comparison anyone actually makes. Erasing a little each frame with
   * `destination-out` rather than washing over it with a translucent fill is
   * what keeps the track its own colour: a wash would tint everything under it
   * toward the wash, and after a minute the asphalt would have drifted.
   */
  private age() {
    const ink = this.ink;
    if (!ink) {
      return;
    }
    ink.globalCompositeOperation = 'destination-out';
    ink.fillStyle = 'rgba(0,0,0,0.02)';
    ink.fillRect(0, 0, WORLD.w, WORLD.h);
    ink.globalCompositeOperation = 'source-over';
  }

  private finishLap() {
    const ms = performance.now() - this.lapStart;
    this.lapStart = performance.now();
    this.gate = 0;
    // the one tracked write per lap, and the one Choreo pass
    const best = this.bestMs;
    this.laps = [...this.laps, { id: this.nextId++, ms }];
    this.note =
      best === null
        ? `first lap: ${shownTime(ms)}s — now go and find a second faster`
        : ms < best
          ? `${shownTime(ms)}s — a new best by ${shownTime(best - ms)}s`
          : `${shownTime(ms)}s — ${shownTime(ms - best)}s off your best`;
  }

  private viewSize() {
    const el = this.viewEl;
    return el ? { h: el.clientHeight, w: el.clientWidth } : { h: 420, w: 680 };
  }

  /** the only place this component touches the screen per frame */
  private paint(now: number, view: { h: number; w: number }) {
    const { car, shot } = this;
    // a sixth of a second between erasures: often enough to be smooth, rare
    // enough that clearing a 1400x900 canvas is not a per-frame cost
    this.frames += 1;
    if (this.frames % 10 === 0) {
      this.age();
    }

    if (this.worldEl) {
      this.worldEl.style.transform =
        `translate(${view.w / 2}px, ${view.h / 2}px) ` +
        `scale(${shot.zoom}) translate(${-shot.x}px, ${-shot.y}px)`;
    }
    if (this.carEl) {
      this.carEl.style.transform = `translate(${car.x}px, ${car.y}px) rotate(${car.yaw}rad)`;
      this.carEl.dataset['slide'] = car.sliding ? 'yes' : 'no';
      this.carEl.dataset['brake'] = car.braking ? 'yes' : 'no';
    }
    if (this.clockEl) {
      this.lapMs = this.rolling ? now - this.lapStart : 0;
      this.clockEl.textContent = shownTime(this.lapMs);
    }
    if (this.dashEl) {
      this.dashEl.textContent = String(Math.round(speedOf(car)));
    }
  }

  /* ---- the whole control scheme ---- */

  private toWorld(event: PointerEvent) {
    const el = this.viewEl;
    if (!el) {
      return null;
    }
    const r = el.getBoundingClientRect();
    // undo the camera: the view's centre is the shot's centre, and the world
    // is scaled about it. Reading the element's own transform back would work
    // too and would be a live-DOM read of something we already know.
    return {
      x: (event.clientX - r.left - r.width / 2) / this.shot.zoom + this.shot.x,
      y: (event.clientY - r.top - r.height / 2) / this.shot.zoom + this.shot.y,
    };
  }

  press = (event: PointerEvent) => {
    // captured on the VIEW rather than on whatever child the finger landed on:
    // the world scrolls under the pointer as the camera moves, so the element
    // beneath it changes constantly during a single drive
    this.viewEl?.setPointerCapture(event.pointerId);
    this.aim = this.toWorld(event);
    this.driving = true;
    if (!this.rolling) {
      this.rolling = true;
      this.lapStart = performance.now();
    }
  };

  steer = (event: PointerEvent) => {
    if (this.aim) {
      this.aim = this.toWorld(event);
    }
  };

  release = () => {
    this.aim = null;
    this.driving = false;
  };

  /**
   * Taking the wheel back is pressing the button, not touching the track: a
   * pointer that stole control on contact would make every attempt to point at
   * something a crash.
   */
  toggleAuto = () => {
    this.auto = !this.auto;
    if (this.auto) {
      this.aim = null;
      this.driving = false;
      if (!this.rolling) {
        this.rolling = true;
        this.lapStart = performance.now();
      }
      this.note = 'the computer is driving — now move a slider and watch';
    } else {
      this.note = 'you have it — hold anywhere on the track';
    }
  };

  togglePanel = () => {
    this.showPanel = !this.showPanel;
  };

  get panelLabel() {
    return this.showPanel ? 'hide' : 'tune';
  }

  /** short, because it sits over a moving picture in a card 550px wide */
  get autoLabel() {
    return this.auto ? 'take the wheel' : 'let it drive';
  }

  reset = () => {
    this.car = makeCar(START.x, START.y, START.heading);
    this.shot = makeShot(START.x, START.y);
    this.laid = { x: START.x, y: START.y };
    this.tyres = null;
    this.gate = 0;
    this.rolling = false;
    this.lapStart = performance.now();
    this.ink?.clearRect(0, 0, WORLD.w, WORLD.h);
  };

  clearBoard = () => {
    this.laps = [];
    this.note = 'board cleared — the track keeps its marks';
  };

  get gateLabel() {
    return `gate ${this.gate + 1}/${GATES.length}`;
  }

  gateClass = (n: number) =>
    n === this.gate + 1 ? 'drift-gate is-next' : 'drift-gate';

  rowClass = (best: boolean) => (best ? 'drift-lap is-best' : 'drift-lap');

  willDestroy() {
    super.willDestroy();
    cancelAnimationFrame(this.raf);
    this.dial.teardown();
  }

  <template>
    <div class="ex drift-ex no-select" {{on "selectstart" preventSelect}}>
      {{! The rail sits OVER the track rather than beside it, and it is a
          sibling of the view rather than a child of it. Both of those are
          load-bearing.

          Over, because a gallery card is about 550px wide: a 280px panel
          beside the track leaves half a track, and the stage's whole subject
          is what the car is doing. Sibling, because the view turns every
          pointerdown into a steering input — a panel nested inside it would
          make every attempt to grab a slider also a lunge of the car. }}
      <div class="drift-area">
        {{! `touch-action: none` on this element in the stylesheet is what stops
            a phone treating the drive as a page scroll. Pointer capture on the
            press is what stops the car being abandoned when the finger leaves
            the track — which, given the camera moves under it, it does often. }}
        <div
          class="drift-view"
          {{this.bindView}}
          {{this.start}}
          {{onStage this.watch}}
          {{on "pointerdown" this.press}}
          {{on "pointermove" this.steer}}
          {{on "pointerup" this.release}}
          {{on "pointercancel" this.release}}
        >
          <div class="drift-world" style={{this.worldStyle}} {{this.bindWorld}}>
            {{! Ground well beyond the walls. The camera pulls back as the car
                speeds up, and at the far end of that it can frame more than the
                world is wide — without this you watch the track end and the
                page show through, which turns a place into a platter. It is a
                child rather than a background on the world because the world's
                own surface is the TRACK, and the two want different colours. }}
            <i class="drift-bleed"></i>
            {{! and the track as its own layer on top of it, because a
                positioned child paints OVER its parent's background — leaving
                the surface on `.drift-world` would have put the apron over the
                whole circuit rather than around it }}
            <i class="drift-track"></i>
            <canvas class="drift-ink" {{this.bindInk}}></canvas>

            {{#each this.gates key="n" as |g|}}
              <span
                class={{this.gateClass g.n}}
                style={{g.style}}
              >{{g.n}}</span>
            {{/each}}

            <div
              class="drift-car"
              data-slide="no"
              data-brake="no"
              {{this.bindCar}}
            >
              <i class="drift-roof"></i>
              <i class="drift-lights"></i>
            </div>
          </div>

        </div>

        {{! The HUD, the button and the note are siblings of the view rather
            than children of it, for the same reason the rail is: the view
            turns every pointerdown into steering, so a control inside it
            would drive the car every time you pressed it. They are also
            inside the frame rather than under it, because a gallery card
            clips at the bottom of the track — anything below it is furniture
            nobody in the gallery can reach. }}
        <div class="drift-hud">
          <span class="drift-read">
            <b {{this.bindClock}}>0.00</b>
            <small>lap</small>
          </span>
          <span class="drift-read">
            <b {{this.bindDash}}>0</b>
            <small>px/s</small>
          </span>
          {{! the beacon a finished lap flies FROM. A place on the dashboard
              rather than an element per lap, because the running clock is not
              a row — it is where a row comes from. }}
          <span class="drift-flag" {{beacon "clock"}}>{{this.gateLabel}}</span>
        </div>

        {{! Bottom left, on its own, and kept clear of the rail by the
            stylesheet. It was in the HUD row with the readouts, where a card
            narrow enough ran it under the panel and clipped the label off. }}
        <button
          type="button"
          class="drift-race {{if this.auto 'is-on' ''}}"
          {{on "click" this.toggleAuto}}
        >{{this.autoLabel}}</button>

        <p class="drift-note">{{this.note}}</p>
        {{! It withdraws while your finger is on the track and comes back the
            moment you let go. Not while the COMPUTER drives, which is the one
            time you want it under your hand — that is the whole reason the
            button is there. }}
        <button
          type="button"
          class="drift-tab"
          {{on "click" this.togglePanel}}
        >{{this.panelLabel}}</button>

        <aside
          class="drift-rail
            {{if this.driving 'is-away' ''}}
            {{unless this.showPanel 'is-shut' ''}}"
          {{this.bindRail}}
        >
          <div class="drift-rail-fit" {{this.bindFit}}>
            <DialPanel @dial={{this.dial}} @characters={{this.characters}} />

            {{! The honest half of the stage. A lap ends, ONE tracked write happens,
            and this region works the rest out of the DOM: the new time was
            inserted, the rows under it moved because it pushed them, and the
            slowest lap was removed because the board only holds five. Nothing
            below is told where to go. }}
            <Choreo class="drift-board" as |c|>
              <header class="drift-board-head">
                <span>best laps</span>
                <button
                  type="button"
                  class="dial-spike-btn"
                  {{on "click" this.clearBoard}}
                >clear</button>
                <button
                  type="button"
                  class="dial-spike-btn"
                  {{on "click" this.reset}}
                >restart</button>
              </header>

              <ol class="drift-laps">
                {{#each this.board key="id" as |lap|}}
                  <li
                    class={{this.rowClass lap.best}}
                    {{motion id=(concat "lap-" lap.id) role="lap"}}
                  >
                    <b>{{lap.rank}}</b>
                    <span>{{lap.shown}}</span>
                  </li>
                {{/each}}
              </ol>

              {{#unless this.board.length}}
                <p class="drift-empty">take a lap through the four gates, in
                  order</p>
              {{/unless}}

              {{! a place, not a row: the lap that falls off the bottom has no
              element to become, which is exactly when a beacon is the answer }}
              <span class="drift-bin" {{beacon "bin"}}>off the board</span>

              <c.Parallel>
                {{! the arrival, out of the running clock it was measured by }}
                <c.Move
                  @of={{c.inserted "lap"}}
                  @from={{c.beacon "clock"}}
                  @spring={{ARRIVE}}
                  @size={{false}}
                />

                {{! and the rows it pushed down. A different spring on purpose:
                being shoved is not the same event as arriving, and one spring
                for both is how a list stops telling you what happened. }}
                <c.Move
                  @of={{c.moved "lap"}}
                  @spring={{SHUFFLE}}
                  @size={{false}}
                />

                {{! the slowest lap, which nobody removed — the board is five long
                and a sixth time pushed it out }}
                <c.Move
                  @of={{c.removed "lap"}}
                  @to={{c.beacon "bin"}}
                  @spring={{DROP}}
                />
                <c.Tween
                  @of={{c.removed "lap"}}
                  @opacity={{0}}
                  @duration={{0.32}}
                />

                {{! a lap that beat nothing changes no row but its own. Dimming what
                the pass did NOT touch is what makes that legible — freeze the
                board and you cannot tell whether the list reordered. }}
                <c.Hold
                  @of={{c.still "lap"}}
                  @opacity={{0.42}}
                  @duration={{0.5}}
                />
              </c.Parallel>
            </Choreo>
          </div>
        </aside>
      </div>

    </div>
  </template>
}

export default Drift;
