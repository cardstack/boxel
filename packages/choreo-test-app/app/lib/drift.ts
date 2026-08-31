/**
 * A car, as arithmetic — and the part of Drift that is deliberately not Choreo.
 *
 * `docs/drift.md` says to write this first, against hardcoded numbers, because
 * it is the fastest way to find out whether the car is fun before any of the
 * tuning surface exists. It also says, at length, why it cannot be a score:
 *
 *   Motion's springs are scalar interpolators toward a target. They are the
 *   right tool for anything with a rest position the value is chasing — the
 *   wheel returning to centre, the chassis lagging the nose, the camera
 *   settling. They are the wrong tool for the part that makes it a drift game.
 *   Lateral slide is a VELOCITY DECOMPOSITION: the sideways component of the
 *   car's motion relative to where it is pointing, bled off at a rate that is
 *   a friction coefficient and not a stiffness. No spring produces it.
 *
 * So this file is fifty lines of Euler integration and no library at all. The
 * springs below are hand-integrated from the same `stiffness / damping` pair
 * Motion parameterises with, which is what lets one dial panel sit over both
 * halves of the stage without translating between two vocabularies.
 *
 * Everything here is pure or mutates its argument in place. Nothing allocates
 * per frame, because all of it runs sixty times a second.
 */

import type { DialTune } from 'test-app/lib/dial';

const TAU = Math.PI * 2;

const clamp = (n: number, lo: number, hi: number) =>
  n < lo ? lo : n > hi ? hi : n;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** the shortest way round to an angle, in radians — never the long way */
export function wrap(a: number) {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/**
 * One semi-implicit Euler step of `mx'' = -k(x - target) - cx'`, mass 1.
 *
 * Semi-implicit rather than explicit: the position is advanced with the NEW
 * velocity, which is what keeps a stiff spring from gaining energy every frame
 * and walking off the screen. The cost is one line and the difference is the
 * difference between a tunable panel and a panel where half the range explodes.
 */
function spring(
  pos: number,
  vel: number,
  target: number,
  k: number,
  c: number,
  dt: number
): [number, number] {
  const v = vel + (-k * (pos - target) - c * vel) * dt;
  return [pos + v * dt, v];
}

/* ---------------------------------------------------------------- tuning */

/** the shape the dial panel produces, and the only shape the loop reads */
export interface DriftTuning {
  engine: { drag: number; power: number };
  grip: { bite: number; release: number };
  /** the macro: one slider that walks every pair below along one line */
  looseness: number;
  steering: { damping: number; lock: number; stiffness: number };
  yaw: { damping: number; stiffness: number };
}

/**
 * The two numbers nobody gets a slider for.
 *
 * `TURN` is the car's peak yaw rate in radians per second at full lock, and
 * `REF` is the speed it takes to reach it — so `REF` has to move whenever the
 * engine's range does. Pulling the power range down without it left every car
 * permanently short of full steering authority, which reads as a car that has
 * gone vague rather than one that has gone slower. They are excluded from the panel on
 * purpose: they set what the car IS rather than how it handles, and a panel
 * that can change everything is a panel nobody can find their way back through.
 */
const TURN = 3.1;
const REF = 170;

/**
 * `looseness` applied — the second tier of the panel, resolved.
 *
 * A two-tier tuning UI needs the top tier to be honest, and there are two ways
 * to do it. The tempting one is to have the macro WRITE the raw values, so the
 * folders below visibly move as you drag it. That reads well for about ten
 * seconds and then lies: touch any raw slider afterwards and the macro is
 * showing a number that no longer describes the car.
 *
 * So looseness is its own parameter and multiplies. The raw pairs stay exactly
 * what you set them to, the macro stays exactly what you set it to, and the car
 * is the product. Nothing on screen can become untrue.
 */
export function applied(t: DriftTuning) {
  const l = clamp(t.looseness, 0, 1);
  return {
    /** the sideways bleed, per second, with the tyres holding */
    bite: t.grip.bite * lerp(1.55, 0.4, l),
    drag: t.engine.drag,
    lock: t.steering.lock,
    power: t.engine.power,
    /** the slip fraction at which they stop holding */
    release: t.grip.release * lerp(1.3, 0.62, l),
    steerC: t.steering.damping * lerp(1.15, 0.8, l),
    steerK: t.steering.stiffness,
    yawC: t.yaw.damping * lerp(1.3, 0.62, l),
    yawK: t.yaw.stiffness,
  };
}

/* ------------------------------------------------------------------- car */

export interface Car {
  /** on the brakes and still moving forward — what the lights are wired to */
  braking: boolean;
  heading: number;
  /**
   * Nose in a wall, with the engine pushing it further in.
   *
   * Steering authority is proportional to forward speed, so a car in this state
   * cannot turn away from the thing it is being pushed into — it is stuck, and
   * only reverse gets it out. It is set here rather than inferred by whoever is
   * driving because the geometry is already in hand at the moment the wall
   * clamps the position, and every driver would otherwise have to guess at it
   * from the outside. The autopilot guessed with a heading-error threshold, and
   * missed every case where the car ended up merely angled into a wall rather
   * than square on to it.
   */
  pinned: boolean;
  /** true once the tyres have let go, and it STAYS true down to `release`×0.55 */
  sliding: boolean;
  /** 0..1 — how much of the car's motion is sideways */
  slip: number;
  steer: number;
  steerV: number;
  vx: number;
  vy: number;
  /**
   * A wall clamped the car's position this step.
   *
   * Distinct from `pinned`, which is the stuck state: this is any contact at
   * all, including a fast scrape down the outside of a corner that the car
   * drives straight out of. It exists to be counted — how often a tune puts the
   * car into the barriers is the most legible single measure of whether that
   * tune is drivable, and it is not something you can see from a lap time.
   */
  walled: boolean;
  x: number;
  y: number;
  /** the chassis, lagging the nose. Drawn; never simulated against */
  yaw: number;
  yawV: number;
}

export interface DriveInput {
  /**
   * 0..1, and a separate pedal from the throttle on purpose.
   *
   * Braking used to be negative throttle, and it was the source of the worst
   * bug in this file: negative thrust pushes the forward component through zero
   * and out the other side, so a car asked to slow down accelerated backwards
   * instead — and a controller reading `speedOf`, which is a magnitude, saw a
   * car that was still too fast and braked harder. A brake that cannot push you
   * past a standstill is what a brake actually is, and it makes that whole
   * class of mistake unrepresentable.
   */
  brake?: number;
  /** -1..1: the wheel the driver is asking for, not the wheel the car has */
  steer: number;
  /** -1..1 — negative is REVERSE, not braking. See `brake`. */
  throttle: number;
}

export interface World {
  h: number;
  w: number;
}

export function makeCar(x: number, y: number, heading = 0): Car {
  return {
    braking: false,
    heading,
    pinned: false,
    sliding: false,
    walled: false,
    slip: 0,
    steer: 0,
    steerV: 0,
    vx: 0,
    vy: 0,
    x,
    y,
    yaw: heading,
    yawV: 0,
  };
}

/** half the car's long axis, in world px — what the walls are measured against */
export const CAR_R = 17;

/**
 * One frame. Mutates `car`; returns nothing.
 *
 * The order of the last three steps is the whole model, and getting it wrong
 * produces a car that cannot drift at all:
 *
 *   1. decompose the velocity in the frame the car is pointing in NOW
 *   2. do the engine, the drag and the grip on those two components
 *   3. recompose in that SAME (old) frame, and only then turn the heading
 *
 * Turn the heading first and the velocity gets recomposed in the new frame,
 * which rotates the car's motion with its nose — every frame, exactly, for
 * free. That car is on rails and no amount of tuning will slide it. Turning
 * last is what leaves the velocity pointing where it was: the gap between
 * where the nose looks and where the car is going IS the drift.
 */
export function stepCar(
  car: Car,
  input: DriveInput,
  t: ReturnType<typeof applied>,
  dt: number,
  world: World
) {
  // 1. the wheel: a spring toward the angle being asked for. Legitimately a
  //    spring — it has a rest position (centre) and it is chasing a target.
  [car.steer, car.steerV] = spring(
    car.steer,
    car.steerV,
    clamp(input.steer, -1, 1) * t.lock,
    t.steerK,
    t.steerC,
    dt
  );

  // 2. the body frame: forward, and its right-hand normal
  const fx = Math.cos(car.heading);
  const fy = Math.sin(car.heading);
  const rx = -fy;
  const ry = fx;
  let vf = car.vx * fx + car.vy * fy;
  let vr = car.vx * rx + car.vy * ry;

  /**
   * 3. The engine, along the nose and only along the nose — and drag that goes
   * with the SQUARE of speed rather than with speed.
   *
   * The difference is the whole character of the acceleration. Linear drag
   * gives an exponential approach to terminal: the car is losing most of its
   * push almost immediately, so it feels like it is easing off from the moment
   * it starts. Quadratic drag is nearly free at low speed and bites hard at the
   * top, so the car holds its acceleration and then runs into a ceiling. That
   * is what a car does, and it is the only version of this where flooring it
   * out of a corner feels like anything.
   *
   * The coefficient is written as `drag² / power` so that the terminal speed is
   * still exactly `power / drag`. Both numbers on the panel keep meaning what
   * their labels say; only the shape of the curve between them changed.
   */
  vf += (input.throttle * t.power - ((t.drag * t.drag) / t.power) * vf * Math.abs(vf)) * dt; // prettier-ignore

  /**
   * The brake, which is not reverse. It sheds speed toward a standstill and
   * stops there — pressing harder can never turn the car around.
   */
  const brake = input.brake ?? 0;
  car.braking = brake > 0 && vf > 8;
  if (brake > 0) {
    const bite = brake * t.power * 1.6 * dt;
    vf = vf > 0 ? Math.max(0, vf - bite) : Math.min(0, vf + bite);
  }

  // 4. grip. An exponential bleed of the sideways component — a friction
  //    coefficient, not a stiffness — and a threshold with hysteresis, so the
  //    car does not chatter in and out of a slide at the boundary.
  const speed = Math.hypot(vf, vr);
  car.slip = speed > 16 ? Math.abs(vr) / speed : 0;
  car.sliding = car.sliding
    ? car.slip > t.release * 0.55
    : car.slip > t.release;
  vr *= Math.exp(-(car.sliding ? t.bite * 0.16 : t.bite) * dt);

  // 5. recompose in the OLD frame — see the note above — then turn
  car.vx = fx * vf + rx * vr;
  car.vy = fy * vf + ry * vr;
  // SIGNED, not `Math.abs(vf)`. Steering authority comes from moving, and a
  // car reversing turns its nose the other way for the same wheel — the same
  // reason backing a trailer feels inverted. Using the magnitude here makes a
  // reversing car steer forwards, which is unusable exactly when reverse is
  // the only thing that can help.
  car.heading += car.steer * TURN * clamp(vf / REF, -1, 1) * dt;

  car.x += car.vx * dt;
  car.y += car.vy * dt;

  // 6. walls. A crash scrubs most of the speed, which is what makes the track
  //    a track rather than a suggestion.
  car.walled = false;
  if (car.x < CAR_R) {
    car.walled = true;
    car.x = CAR_R;
    car.vx = Math.abs(car.vx) * 0.3;
    car.vy *= 0.6;
  } else if (car.x > world.w - CAR_R) {
    car.walled = true;
    car.x = world.w - CAR_R;
    car.vx = -Math.abs(car.vx) * 0.3;
    car.vy *= 0.6;
  }
  if (car.y < CAR_R) {
    car.walled = true;
    car.y = CAR_R;
    car.vy = Math.abs(car.vy) * 0.3;
    car.vx *= 0.6;
  } else if (car.y > world.h - CAR_R) {
    car.walled = true;
    car.y = world.h - CAR_R;
    car.vy = -Math.abs(car.vy) * 0.3;
    car.vx *= 0.6;
  }

  // and the state that comes out of that: nose in a wall, and no speed left to
  // turn away from it with
  const nx = Math.cos(car.heading);
  const ny = Math.sin(car.heading);
  car.pinned =
    (car.x <= CAR_R && nx < 0) ||
    (car.x >= world.w - CAR_R && nx > 0) ||
    (car.y <= CAR_R && ny < 0) ||
    (car.y >= world.h - CAR_R && ny > 0);

  // 7. the chassis, lagging the nose. The most satisfying number in the panel
  //    and the one that changes nothing about where the car ends up.
  const d = wrap(car.heading - car.yaw);
  car.yawV += (t.yawK * d - t.yawC * car.yawV) * dt;
  car.yaw += car.yawV * dt;
}

/** how fast it is going, in world px per second */
export const speedOf = (car: Car) => Math.hypot(car.vx, car.vy);

/**
 * How fast it is going ALONG ITS OWN NOSE. Negative is backwards.
 *
 * This is the number that decides whether a car is stuck. A car nose-first
 * into a wall has velocity near zero, and steering authority is proportional
 * to forward speed, so it cannot turn — while the engine keeps pushing it into
 * the wall it cannot turn away from. Nothing recovers from that but reverse.
 */
export const forwardOf = (car: Car) =>
  car.vx * Math.cos(car.heading) + car.vy * Math.sin(car.heading);

/**
 * Where the car is actually going, minus where it is pointing.
 *
 * Positive means it is travelling to the RIGHT of its own nose. This is the
 * drift angle — the number a driver is reading with their hands, and the one
 * the autopilot below countersteers against.
 */
export const slipAngleOf = (car: Car) =>
  speedOf(car) > 28 ? wrap(Math.atan2(car.vy, car.vx) - car.heading) : 0;

/* ---------------------------------------------------------------- the shot */

/**
 * The chase camera, which IS a spring and is not a Choreo camera.
 *
 * `c.Camera` is a seekable cue: a shot change with a duration, compiled into a
 * score and reconstructible under random access. A chase camera is the other
 * thing entirely — a target that moves every frame and a lens that never gets
 * there. Compiling a region sixty times a second to express that would be a
 * misuse of the score and a bad advertisement for it, so the shot lives here,
 * with the physics it is chasing. `docs/drift.md` names the split; this is it.
 *
 * The lead is what makes it read as a camera operator rather than a leash: the
 * target is not the car, it is where the car will be in `LEAD` seconds, so the
 * frame opens into the corner before the car arrives in it.
 */
export interface Shot {
  vx: number;
  vy: number;
  vz: number;
  x: number;
  y: number;
  zoom: number;
}

const LEAD = 0.42;
/** the shot's own pair. Not on the panel: a camera you can detune is a bug */
const SHOT_K = 42;
const SHOT_C = 12;

export function makeShot(x: number, y: number): Shot {
  return { vx: 0, vy: 0, vz: 0, x, y, zoom: 1 };
}

export function stepShot(
  shot: Shot,
  car: Car,
  dt: number,
  view: World,
  world: World
) {
  const tx = car.x + car.vx * LEAD;
  const ty = car.y + car.vy * LEAD;
  // Pull back as it goes faster: the frame earns its speed rather than
  // announcing it with a number. Both ends of that range are below 1 because
  // the track is a good deal bigger than the card it is being watched in, and
  // a chase camera that cannot show you the next corner is a camera that is
  // hiding the game from you.
  const tz = lerp(0.86, 0.6, Math.min(1, speedOf(car) / 330));

  [shot.x, shot.vx] = spring(shot.x, shot.vx, tx, SHOT_K, SHOT_C, dt);
  [shot.y, shot.vy] = spring(shot.y, shot.vy, ty, SHOT_K, SHOT_C, dt);
  [shot.zoom, shot.vz] = spring(shot.zoom, shot.vz, tz, SHOT_K, SHOT_C, dt);

  // never show the outside of the track. Clamped after the spring rather than
  // before it, so the shot stops dead at the edge instead of easing into a
  // wall it is not allowed to reach.
  const halfW = view.w / 2 / shot.zoom;
  const halfH = view.h / 2 / shot.zoom;
  shot.x =
    world.w <= halfW * 2 ? world.w / 2 : clamp(shot.x, halfW, world.w - halfW);
  shot.y =
    world.h <= halfH * 2 ? world.h / 2 : clamp(shot.y, halfH, world.h - halfH);
}

/* ----------------------------------------------------------------- marks */

export interface Mark {
  a: number;
  id: number;
  x: number;
  y: number;
}

/**
 * World px between one pair of skid marks and the next.
 *
 * Short, because a mark is now a stroked segment from the last pair of tyre
 * positions to this one rather than a dot: sampling finely is what makes the
 * line follow the curve instead of cutting across it.
 */
export const MARK_GAP = 6;

/* ----------------------------------------------------------------- gates */

export interface Gate {
  x: number;
  y: number;
}

/** how close the middle of the car has to pass, in world px */
export const GATE_R = 62;

export function through(car: Car, gate: Gate) {
  const dx = car.x - gate.x;
  const dy = car.y - gate.y;
  return dx * dx + dy * dy < GATE_R * GATE_R;
}

/* ----------------------------------------------------------- the route */

export interface Route {
  /** curvature at each point, in 1/px */
  k: number[];
  /** the line itself, closed */
  pts: Gate[];
  /** spacing to the next point, so a lookahead can be walked in arc length */
  step: number[];
}

/**
 * A racing line, built once from the gates.
 *
 * This is the fix for the thing that was actually wrong with the driver, and
 * it is worth being precise about what that was. Aiming at the next gate is not
 * a line — it is a sequence of points, some of them seven hundred pixels away
 * and some of them already behind the car. Everything the bot did badly came
 * out of that: it turned in late because it had nothing to turn in TOWARD until
 * the gate was close, and every attempt to fix the lateness by blending the
 * target toward the next gate destabilised it, because a blended target
 * accelerates sideways exactly when the car commits.
 *
 * A path removes the question. The aim point is somewhere on a line that was
 * decided before the car started moving, so it rounds the corner because the
 * LINE rounds the corner, and it never moves except by the car advancing along
 * it. Anticipation stops being a term in a controller and becomes geometry.
 *
 * Centripetal Catmull-Rom, which interpolates its control points — so the line
 * still goes through every gate, and a car following it still scores.
 */
export function routeOf(gates: Gate[], per = 60): Route {
  const n = gates.length;
  const pts: Gate[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = gates[(i - 1 + n) % n]!;
    const p1 = gates[i]!;
    const p2 = gates[(i + 1) % n]!;
    const p3 = gates[(i + 2) % n]!;
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      // the standard uniform Catmull-Rom basis, at tension 0.5
      pts.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }

  const m = pts.length;
  const k: number[] = [];
  const step: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = pts[(i - 1 + m) % m]!;
    const b = pts[i]!;
    const c = pts[(i + 1) % m]!;
    step.push(Math.hypot(c.x - b.x, c.y - b.y));
    // curvature as the reciprocal of the circumradius of three consecutive
    // points: 4·area / (product of the side lengths)
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const area = Math.abs(
      (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
    );
    k.push(ab * bc * ca === 0 ? 0 : area / (ab * bc * ca));
  }
  return { k, pts, step };
}

/** the point on the line the car is nearest to */
export function nearestOn(route: Route, x: number, y: number) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.pts.length; i++) {
    const p = route.pts[i]!;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** walk `dist` further along the line, and say where that lands */
export function walkOn(route: Route, from: number, dist: number) {
  let i = from;
  let left = dist;
  for (let hop = 0; hop < route.pts.length; hop++) {
    const s = route.step[i]!;
    if (left <= s) {
      break;
    }
    left -= s;
    i = (i + 1) % route.pts.length;
  }
  return i;
}

/** the tightest the line gets between here and `dist` further on */
export function worstAhead(route: Route, from: number, dist: number) {
  let i = from;
  let left = dist;
  let worst = 0;
  for (let hop = 0; hop < route.pts.length; hop++) {
    worst = Math.max(worst, route.k[i]!);
    const s = route.step[i]!;
    if (left <= s) {
      break;
    }
    left -= s;
    i = (i + 1) % route.pts.length;
  }
  return worst;
}

/* ---------------------------------------------------------------- the bot */

/**
 * The fixed physics step, exported because the driver below is TUNED TO IT.
 *
 * A controller's gains are only meaningful against the rate it runs at, and
 * these were swept rather than derived. The stage stepped at 1/120 while the
 * sweep ran at 1/60 for a while, which is a way to ship a driver nobody tested;
 * one constant, used by both, closes that.
 */
export const STEP = 1 / 120;

/**
 * The driver's own numbers, which are NOT on the panel.
 *
 * Deliberately: the stage's claim is that the panel changes the car, and a
 * panel that could also change the driver would make every observation
 * ambiguous. These were swept rather than guessed — see the note on `corner`.
 */
export interface Driver {
  /** the speed it will take a square corner at */
  corner: number;
  /** wheel per radian of drift angle — the countersteer */
  counter: number;
  /** the throttle it keeps while catching one */
  hold: number;
  /** how far along the line it looks, standing still */
  look: number;
  /** and how much further per px/s it is going */
  lookV: number;
  /**
   * How much of the car's theoretical cornering it is willing to spend.
   *
   * Below one for safety, and swept rather than picked. It is a narrow ridge:
   * 0.7 loses one character every lap it had, and 0.55 makes another too timid
   * to reach the lap threshold. A driver spending nearly all of the car is
   * fragile in the loose cars; one spending too little never gets round.
   */
  margin: number;
  /** wheel per radian of course error */
  p: number;
  /** the drift angle past which it stops aiming and starts catching */
  spin: number;
  /** and the speed it will run down a straight at */
  top: number;
}

/**
 * Swept, not guessed, against all four characters for ninety seconds each.
 *
 * The ranking is the interesting part, and it took three attempts to get right.
 * Ranking on TOTAL laps picks a driver that is brilliant in a planted car and
 * cannot hold a loose one — precisely the driver this stage must not have,
 * since the point is that it drives whatever the panel hands it. So the worst
 * character's lap count comes first, as a gate.
 *
 * But laps alone still picked a bad driver twice. A timid one laps perfectly
 * well: slowly, squarely, braking to a crawl at every corner and never once
 * putting the tail out. It scores respectably and it is dull to watch, which
 * for THIS stage is the actual failure — a driver that never slides shows you
 * nothing when you move the grip slider. So once every car is getting round,
 * the ranking is on speed carried and time spent sideways.
 *
 * This one gets 11, 12, 13 and 18 laps, at a mean 508 px/s, with 65% of the lap
 * over the traction threshold.
 */
export const DRIVER: Driver = {
  corner: 150,
  counter: 1.3,
  hold: 0.35,
  look: 90,
  lookV: 0.45,
  margin: 0.75,
  p: 2.4,
  spin: 0.85,
  top: 480,
};

/**
 * A driver, so you can watch the tune instead of fighting it.
 *
 * This is what makes the stage's claim checkable rather than merely arguable.
 * Driving it yourself, a change in the panel and a change in your own hands
 * arrive together and you cannot tell them apart — you adapt to a worse car
 * within a lap and conclude the slider did nothing. Hand the wheel to something
 * that never adapts, and the number is the only thing that moved.
 *
 * Three terms, and each one was put in because the version without it failed in
 * the browser in a way worth recording:
 *
 *   - **Aim the VELOCITY at the target, not the nose.** A sliding car is going
 *     somewhere other than where it points, and a controller that aims the nose
 *     spirals: it corrects toward the target, the slide carries it past, it
 *     corrects harder.
 *   - **Countersteer.** Add the drift angle back in, so the wheel goes INTO the
 *     slide. Without it no gain on the first term is stable once the tail is
 *     out.
 *   - **Brake for the corner.** This was the missing one, and the symptom was
 *     odd enough to be worth naming: the LOOSE cars lapped and the planted ones
 *     went round for ninety seconds without scoring. At full throttle every car
 *     arrived at a square corner faster than its own turning circle could
 *     answer, and orbited the gate it was aiming at — a target inside the
 *     minimum radius is a target you circle forever. The loose cars only got
 *     round because sliding wide happened to drag them across the gate. Adding
 *     a speed limit that falls with the sharpness of the corner ahead fixed
 *     every character at once, which is how you know it was the real cause and
 *     not another gain that happened to help.
 */
export function autopilot(
  car: Car,
  route: Route,
  d0: Driver = DRIVER
): DriveInput {
  /**
   * Everything below is in terms of FORWARD speed, and the bug that taught
   * that lesson is worth keeping.
   *
   * The brake was once negative throttle, and negative thrust pushes the
   * forward component through zero and out the other side. A car reversing at
   * 300 has a `speedOf` of 300, so a controller reading the magnitude saw a car
   * that was still too fast and braked harder. It accelerated backwards, at
   * full lock, for ninety seconds; two of the four characters never reached the
   * first gate. `brake` is now its own pedal and cannot do that, and this reads
   * `forwardOf` rather than `speedOf` so it could not see it if it did.
   *
   * `slip` is gated on the same number: the angle between where a car points
   * and where it is going is ±180° when it is reversing, and feeding that into
   * a countersteer term is how a controller ends up chasing its own tail.
   */
  const vf = forwardOf(car);
  const slip = vf > 40 ? slipAngleOf(car) : 0;
  const course = car.heading + slip;

  // look further along the line the faster it is going. THIS is the
  // anticipation, and it is geometry rather than a special case: the aim point
  // is already round the corner because the line is.
  const here = nearestOn(route, car.x, car.y);
  const look = d0.look + Math.max(0, vf) * d0.lookV;
  const at = route.pts[walkOn(route, here, look)]!;
  const err = wrap(Math.atan2(at.y - car.y, at.x - car.x) - course);

  // buried in a wall, or facing away from the line with no speed to turn on
  if ((car.pinned || Math.abs(err) > 2) && vf < 80) {
    // reverse, which IS negative throttle — the one place it belongs
    return { brake: 0, steer: clamp(-err * 2.4, -1, 1), throttle: -0.6 };
  }

  /**
   * Catching it, which comes before aiming it.
   *
   * Past this much drift angle the car is not cornering, it is spinning, and a
   * controller that keeps aiming at the line makes it worse: it asks for lock
   * in the direction the car is already rotating and holds it there. The traces
   * were unmistakable — heading winding through -1.2, -2.5, -4.0, -5.9 with the
   * wheel pinned at full lock and a drift angle stuck at 63 degrees, for the
   * whole run.
   *
   * Blended rather than switched. A hard threshold makes the bot twitch on the
   * boundary, flicking between "aim at the line" and "forget the line" several
   * times a corner; easing the line's authority out over the last quarter of a
   * radian looks like a driver holding a slide instead.
   */
  const panic = clamp((Math.abs(slip) - d0.spin) / 0.25, 0, 1);

  /**
   * The speed the line itself allows, which is where the braking comes from
   * now — and it is derived rather than tuned.
   *
   * The model turns at `TURN · min(1, vf/REF)` radians a second, so on a curve
   * of curvature k the fastest it can hold is `TURN / k`. Looking that up along
   * the stretch of line it is about to drive gives a limit that falls before a
   * corner rather than during it, which is the difference between a car that
   * brakes for a bend and a car that discovers one.
   */
  const worst = worstAhead(route, here, look * 1.5);
  const able = worst > 1e-6 ? (TURN * d0.margin) / worst : Infinity;
  const limit = clamp(able, d0.corner, d0.top);
  const over = vf - limit;

  return {
    // eased rather than bang-bang: a car that snaps between full brakes and
    // full throttle at a threshold does not look like anything is driving it
    /**
     * No brake at all while catching a slide, and this one is not a style
     * choice. Braking sheds forward speed; steering authority in this model is
     * proportional to forward speed; so a car braking mid-slide is a car losing
     * the very thing it needs to catch the slide with. Allowing even half
     * authority here cost one character every one of its laps.
     */
    brake: clamp(over / 110, 0, 1) * (1 - panic),
    steer: clamp(
      err * d0.p * (1 - panic) + slip * (d0.counter + panic * 0.7),
      -1,
      1
    ),
    throttle: panic > 0 ? d0.hold : over < 0 ? clamp(-over / 90, 0, 1) : 0,
  };
}

/* --------------------------------------------------------- personalities */

/**
 * The four characters, from `docs/drift.md`.
 *
 * These are constants and not saved presets on purpose. A character is a thing
 * the stage ships and can always be got back to; a preset is a thing you made.
 * dialkit's store holds the second kind — `savePreset` / `loadPreset` — and it
 * persists them, which means seeding it with these would put four editable
 * copies of the source in localStorage and no way home. So: characters here,
 * presets in the store, one row of chips over both.
 *
 * ## Two numbers do the work, and they are not the two you would guess
 *
 * Every one of these drives ninety seconds under the autopilot without touching
 * a wall once, and three of the four spend most of that lap sideways. Those
 * sound like opposite requirements and they are not — the pair that decides it
 * is `grip.release` and `grip.bite`, and they pull in different directions:
 *
 *   - `release` is the slip fraction at which the tyres let go. LOW breaks
 *     traction easily. This is the one that makes a car slide.
 *   - `bite` is how hard the sideways component is bled off while they still
 *     have hold. HIGH catches the car once it comes back under the threshold.
 *
 * Low release with high bite is the drift-car recipe: it steps out at the
 * smallest provocation and hooks up hard the moment the angle comes off. The
 * first cut of these had it backwards — high release, moderate bite — which is
 * a car that will not slide at all and, when it finally does, will not stop.
 *
 * The numbers below are the RAW values, and `applied` scales both by looseness
 * before the car sees them (`bite × lerp(1.55, 0.4, l)`, `release ×
 * lerp(1.3, 0.62, l)`). They were solved backwards from the effective values
 * rather than tuned by hand, which is why they are not round.
 */
export type Character = DialTune;

export const CHARACTERS: Character[] = [
  {
    name: 'Drifty',
    note: 'breaks away early and stays out there',
    /**
     * The default car, and the one the stage is named after.
     *
     * The damping is the part worth reading twice. It is 20 on both springs,
     * where the note that planned this demo had Drifty at 12 — because the
     * power went up and 12 could not hold it: the same tune that lapped
     * cleanly at 450 managed one lap in ninety seconds at 520, spinning at
     * every corner. More engine needs more damping, not less grip; dropping the
     * power back would have been the easy fix and the wrong one, since a drift
     * car with no power cannot get the tail out in the first place.
     */
    values: {
      looseness: 0.6,
      'engine.drag': 1.1,
      'engine.power': 520,
      'grip.bite': 10,
      'grip.release': 0.13,
      'steering.damping': 20,
      'steering.lock': 1,
      'steering.stiffness': 120,
      'yaw.damping': 20,
      'yaw.stiffness': 120,
    },
  },
  {
    name: 'Floaty',
    note: 'slow to answer, slow to settle — a boat',
    values: {
      looseness: 0.55,
      'engine.drag': 1.2,
      'engine.power': 380,
      'grip.bite': 10,
      'grip.release': 0.18,
      'steering.damping': 8,
      'steering.lock': 0.9,
      'steering.stiffness': 70,
      'yaw.damping': 8,
      'yaw.stiffness': 70,
    },
  },
  {
    name: 'Snappy',
    note: 'steps out instantly and snaps back just as fast',
    values: {
      looseness: 0.5,
      'engine.drag': 1.25,
      'engine.power': 490,
      'grip.bite': 9.8,
      'grip.release': 0.115,
      'steering.damping': 16,
      'steering.lock': 1,
      'steering.stiffness': 220,
      'yaw.damping': 16,
      'yaw.stiffness': 220,
    },
  },
  {
    name: 'Stable',
    note: 'planted and quick, and it will not slide for you',
    values: {
      looseness: 0.25,
      'engine.drag': 1.3,
      'engine.power': 480,
      'grip.bite': 9.6,
      'grip.release': 0.25,
      'steering.damping': 28,
      'steering.lock': 0.86,
      'steering.stiffness': 220,
      'yaw.damping': 28,
      'yaw.stiffness': 220,
    },
  },
];

/**
 * The character a fresh panel opens on, and the first chip in the row.
 *
 * Drifty, because the stage is called Drift. The forgiving car was the default
 * for a while on the theory that the first thirty seconds decide whether anyone
 * touches a slider — which is true, and was still the wrong call here: what
 * decides it is whether the first thirty seconds show you the thing the stage
 * is about. `Stable` is one click away for anyone who wants it.
 */
export const OPENING = CHARACTERS[0]!;
