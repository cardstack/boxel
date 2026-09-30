/**
 * The car, before there is a car to look at.
 *
 * `docs/drift.md` argues that the driving loop is not a Choreo score and has to
 * be written by hand. The corollary is that nothing else in the repo is
 * checking it: no region compiles it, no changeset covers it, and a bug in it
 * looks exactly like a car that needs tuning. So the model gets its own tests,
 * and they are all about the two claims the demo makes on screen — that the
 * numbers in the panel do what their labels say, and that the car can drift.
 */
import { module, test } from 'qunit';
import { TUNING } from 'test-app/components/examples/drift';
import {
  applied,
  autopilot,
  type Character,
  CHARACTERS,
  type DriftTuning,
  type DriveInput,
  forwardOf,
  makeCar,
  makeShot,
  routeOf,
  slipAngleOf,
  speedOf,
  STEP,
  stepCar,
  stepShot,
  through,
  wrap,
} from 'test-app/lib/drift';

/**
 * The track the stage actually uses, and a room with no walls in reach.
 *
 * Every straight-line assertion below runs for seconds at hundreds of px/s, so
 * on the real track the car would be into the far wall before the number being
 * measured had settled — and a wall scrubs 70% of the speed, which quietly
 * makes a terminal-velocity test measure the crash instead. `ROOM` is here so
 * that the only test that involves a wall is the one about walls.
 */
const WORLD = { h: 900, w: 1400 };
const ROOM = { h: 9000, w: 9000 };
/**
 * The same step the stage runs at, from the same constant. The driver's gains
 * are tuned to it, so a test that used its own step would be certifying a
 * controller nobody ships.
 */
const DT = STEP;

/** the stage's own defaults, which are Drifty to the number */
const BASE: DriftTuning = {
  engine: { drag: 1.1, power: 520 },
  grip: { bite: 10, release: 0.13 },
  looseness: 0.6,
  steering: { damping: 20, lock: 1, stiffness: 120 },
  yaw: { damping: 20, stiffness: 120 },
};

const tuned = (over: Partial<DriftTuning> = {}): DriftTuning => ({
  ...BASE,
  ...over,
});

/** the stage's own circuit, so the bot is tested on the track it drives */
const TRACK = { h: 900, w: 1400 };
const GATES = [
  { x: 1120, y: 210 },
  { x: 1120, y: 690 },
  { x: 280, y: 690 },
  { x: 280, y: 210 },
];

const fromCharacter = (c: Character): DriftTuning => {
  const n = (k: string) => c.values[k] as number;
  return {
    engine: { drag: n('engine.drag'), power: n('engine.power') },
    grip: { bite: n('grip.bite'), release: n('grip.release') },
    looseness: n('looseness'),
    steering: {
      damping: n('steering.damping'),
      lock: n('steering.lock'),
      stiffness: n('steering.stiffness'),
    },
    yaw: { damping: n('yaw.damping'), stiffness: n('yaw.stiffness') },
  };
};

const drive = (over: Partial<DriveInput> = {}): DriveInput => ({
  steer: 0,
  throttle: 0,
  ...over,
});

/** run the loop for `seconds` at a fixed step, the way the stage does */
function run(
  car: ReturnType<typeof makeCar>,
  input: DriveInput,
  t: DriftTuning,
  seconds: number,
  world = ROOM
) {
  const a = applied(t);
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepCar(car, input, a, DT, world);
  }
  return car;
}

module('Unit | drift', function () {
  test('wrap takes the short way round', function (assert) {
    assert.strictEqual(wrap(0), 0);
    // 350° and -10° are the same ask; a yaw spring given the first would
    // spin the chassis all the way round the long way on screen
    assert.ok(
      Math.abs(wrap((350 * Math.PI) / 180) - (-10 * Math.PI) / 180) < 1e-9,
      '350° is -10°'
    );
    assert.ok(Math.abs(wrap(Math.PI * 4)) < 1e-9, 'full turns are nothing');
  });

  test('a car that is pointed straight goes straight', function (assert) {
    const car = makeCar(200, 450, 0);
    run(car, drive({ throttle: 1 }), tuned(), 2);

    assert.ok(car.x > 300, 'it moved down the track');
    assert.ok(Math.abs(car.y - 450) < 1e-6, 'and not sideways at all');
    assert.strictEqual(car.slip, 0, 'nothing sideways to slip with');
    assert.false(car.sliding, 'so the tyres never let go');
  });

  test('drag gives it a terminal speed, and power sets where', function (assert) {
    const slow = makeCar(0, 450, 0);
    run(
      slow,
      drive({ throttle: 1 }),
      tuned({ engine: { drag: 2, power: 660 } }),
      8
    );
    const fast = makeCar(0, 450, 0);
    run(
      fast,
      drive({ throttle: 1 }),
      tuned({ engine: { drag: 1, power: 660 } }),
      8
    );

    /**
     * `v' = power - drag·v` settles at power/drag, so 330 and 660 — but only in
     * the continuous limit. A stepped integrator overshoots that by about half
     * a frame's worth of engine, which is why this is a percentage and not an
     * equality: the claim being made is that the two labelled numbers mean what
     * they say, not that the discretisation is exact.
     */
    assert.ok(Math.abs(speedOf(slow) - 330) / 330 < 0.03, 'power/drag');
    assert.ok(Math.abs(speedOf(fast) - 660) / 660 < 0.03, 'power/drag');
    assert.ok(
      Math.abs(speedOf(fast) / speedOf(slow) - 2) < 0.02,
      'twice the drag, half the speed'
    );
  });

  test('the wheel is a spring, so it returns to centre on its own', function (assert) {
    const car = makeCar(700, 450, 0);
    run(car, drive({ steer: 1, throttle: 0.6 }), tuned(), 1.5);
    assert.ok(car.steer > 0.9, 'held over, it gets to full lock');

    run(car, drive({ throttle: 0.6 }), tuned(), 1.5);
    assert.ok(Math.abs(car.steer) < 0.02, 'let go, it comes back to centre');
  });

  test('a parked car cannot steer', function (assert) {
    const car = makeCar(700, 450, 0);
    run(car, drive({ steer: 1 }), tuned(), 2);

    assert.ok(
      Math.abs(car.heading) < 1e-9,
      'the heading only turns in proportion to forward speed — no throttle, no turn'
    );
  });

  /**
   * The assertion the whole model exists for.
   *
   * Slip is the gap between where the nose points and where the car is going.
   * If step 5 of `stepCar` turned the heading BEFORE recomposing the velocity,
   * the car's motion would rotate with its nose every frame and this number
   * would be pinned at zero for every tune, at every speed, forever. That car
   * looks fine in a screenshot and is not a drift game.
   */
  test('a hard turn at speed slides the car', function (assert) {
    const car = makeCar(200, 450, 0);
    run(car, drive({ throttle: 1 }), tuned(), 2.5);
    const straight = car.slip;
    run(car, drive({ steer: 1, throttle: 1 }), tuned(), 1.2);

    assert.strictEqual(straight, 0, 'straight line: no slip');
    assert.ok(car.slip > 0.1, `and turning hard: ${car.slip.toFixed(2)}`);
    assert.true(car.sliding, 'past the threshold, the tyres have let go');
  });

  test('grip decides whether the same turn slides', function (assert) {
    const loose = makeCar(200, 450, 0);
    const held = makeCar(200, 450, 0);
    const sticky = tuned({ grip: { bite: 14, release: 0.5 } });

    run(loose, drive({ throttle: 1 }), tuned(), 2.5);
    run(loose, drive({ steer: 1, throttle: 1 }), tuned(), 1.2);
    run(held, drive({ throttle: 1 }), sticky, 2.5);
    run(held, drive({ steer: 1, throttle: 1 }), sticky, 1.2);

    assert.ok(loose.slip > held.slip, 'more bite, less slide');
    assert.true(loose.sliding);
    assert.false(held.sliding, 'the sticky car keeps hold of it');
  });

  /**
   * Hysteresis is not a nicety here: without it the car crosses the threshold
   * back and forth every few frames at the edge of a slide, and the skid marks
   * — which are laid on `sliding` — come out as dashes rather than a line.
   */
  test('the slide has hysteresis, so it does not chatter', function (assert) {
    const t = applied(tuned());
    const car = makeCar(200, 450, 0);

    // put it into a slide, then ease off to sit just under the break-away
    // threshold: a car with no hysteresis would be gripping again by now
    for (let i = 0; i < 150; i++) {
      stepCar(car, drive({ throttle: 1 }), t, DT, ROOM);
    }
    for (let i = 0; i < 80; i++) {
      stepCar(car, drive({ steer: 1, throttle: 1 }), t, DT, ROOM);
    }
    assert.true(car.sliding, 'it is out');

    const wasSliding = car.sliding;
    let flips = 0;
    let last = wasSliding;
    for (let i = 0; i < 60; i++) {
      stepCar(car, drive({ steer: 0.42, throttle: 1 }), t, DT, ROOM);
      if (car.sliding !== last) {
        flips += 1;
        last = car.sliding;
      }
    }
    assert.ok(flips <= 1, `it recovers once or not at all, not ${flips} times`);
  });

  test('the chassis lags the nose, and the pair says how much', function (assert) {
    const soft = makeCar(200, 450, 0);
    const stiff = makeCar(200, 450, 0);
    const softT = tuned({ yaw: { damping: 8, stiffness: 40 } });
    const stiffT = tuned({ yaw: { damping: 30, stiffness: 400 } });

    run(soft, drive({ throttle: 1 }), softT, 2);
    run(stiff, drive({ throttle: 1 }), stiffT, 2);
    run(soft, drive({ steer: 1, throttle: 1 }), softT, 0.35);
    run(stiff, drive({ steer: 1, throttle: 1 }), stiffT, 0.35);

    const softLag = Math.abs(wrap(soft.heading - soft.yaw));
    const stiffLag = Math.abs(wrap(stiff.heading - stiff.yaw));
    /**
     * A spring chasing a RAMP — which is what a heading turning at a steady
     * rate is — settles at a lag of c·omega/k rather than at zero. At full
     * lock that is roughly 0.2 rad for the stiff pair and 0.5 for the soft
     * one, so the assertion is about the ratio and not about either number
     * reaching the nose.
     */
    assert.ok(
      softLag > stiffLag * 1.5,
      `the soft pair trails much further behind: ${softLag.toFixed(2)} vs ${stiffLag.toFixed(2)}`
    );
    assert.ok(stiffLag < 0.35, 'and the stiff pair stays near the nose');
  });

  test('walls stop the car and cost it its speed', function (assert) {
    const car = makeCar(WORLD.w - 200, 450, 0);
    run(car, drive({ throttle: 1 }), tuned(), 6, WORLD);

    assert.ok(car.x <= WORLD.w, 'it did not leave the track');
    assert.ok(speedOf(car) < 260, 'and it paid for the crash');
  });

  /**
   * The failure the browser found, and the one a unit test would never have
   * thought to look for: a car nose-first into a wall has no forward speed,
   * steering authority is proportional to forward speed, and the engine pushes
   * it along the nose. It cannot turn away from the thing it is being pushed
   * into. Thirty seconds of driving ended with the car motionless against the
   * top wall and no input that could free it.
   */
  test('a car can reverse off a wall it has buried its nose in', function (assert) {
    const t = applied(tuned());
    const car = makeCar(WORLD.w / 2, 40, -Math.PI / 2); // pointing at the top

    // drive it into the wall and hold it there
    for (let i = 0; i < 180; i++) {
      stepCar(car, drive({ throttle: 1 }), t, DT, WORLD);
    }
    assert.ok(car.y < 20, 'it is on the wall');
    assert.ok(Math.abs(forwardOf(car)) < 60, 'and it has no way to steer');

    // full lock forwards cannot save it — this is the deadlock
    for (let i = 0; i < 120; i++) {
      stepCar(car, drive({ steer: 1, throttle: 1 }), t, DT, WORLD);
    }
    assert.ok(car.y < 25, 'full lock and full throttle changes nothing');

    // reverse does, and the steering works while it does
    for (let i = 0; i < 120; i++) {
      stepCar(car, drive({ steer: -1, throttle: -0.6 }), t, DT, WORLD);
    }
    assert.ok(car.y > 60, `it backed off: y ${car.y.toFixed(0)}`);
    assert.ok(
      Math.abs(wrap(car.heading + Math.PI / 2)) > 0.3,
      'and swung its nose round on the way out'
    );
  });

  test('looseness moves every pair without writing to any of them', function (assert) {
    const t = tuned({ looseness: 0 });
    const planted = applied(t);
    const loose = applied({ ...t, looseness: 1 });

    assert.ok(loose.bite < planted.bite, 'less grip');
    assert.ok(loose.release < planted.release, 'and it lets go sooner');
    assert.ok(loose.yawC < planted.yawC, 'the chassis settles more slowly');
    assert.strictEqual(
      t.grip.bite,
      BASE.grip.bite,
      'and the raw value the folder shows is untouched — the macro multiplies, ' +
        'it does not write, so nothing on the panel can become a lie'
    );
  });

  test('every character is a car that drives', function (assert) {
    /**
     * A character is a flat `path -> value` map, because that is the shape the
     * store takes. Reading it back into the nested shape the loop wants is the
     * only place the two vocabularies meet, and it is worth a test on its own:
     * a typo in a path here is silent — the store ignores the update and the
     * car quietly keeps the default.
     */
    const num = (c: Character, k: string) => {
      const v = c.values[k];
      assert.strictEqual(typeof v, 'number', `${c.name} sets ${k}`);
      return v as number;
    };

    for (const c of CHARACTERS) {
      const t: DriftTuning = {
        engine: { drag: num(c, 'engine.drag'), power: num(c, 'engine.power') },
        grip: { bite: num(c, 'grip.bite'), release: num(c, 'grip.release') },
        looseness: num(c, 'looseness'),
        steering: {
          damping: num(c, 'steering.damping'),
          lock: num(c, 'steering.lock'),
          stiffness: num(c, 'steering.stiffness'),
        },
        yaw: {
          damping: num(c, 'yaw.damping'),
          stiffness: num(c, 'yaw.stiffness'),
        },
      };
      const car = makeCar(200, 450, 0);
      run(car, drive({ throttle: 1 }), t, 3);
      run(car, drive({ steer: 1, throttle: 1 }), t, 1.4);

      assert.ok(
        Number.isFinite(car.x) && Number.isFinite(car.heading),
        `${c.name}: the integrator stayed stable`
      );
      assert.ok(speedOf(car) > 60, `${c.name}: it actually moves`);
    }
  });

  /**
   * The bot is not decoration: it is what makes the panel's claim checkable.
   * Driving yourself, a change in the tune and a change in your own hands
   * arrive together — you adapt to a worse car within a lap and conclude the
   * slider did nothing. So the bot has to actually get round, in every
   * character, or the demonstration is a car going in circles near some cones.
   */
  /**
   * The bot is not decoration: it is what makes the panel's claim checkable.
   * Driving yourself, a change in the tune and a change in your own hands
   * arrive together — you adapt to a worse car within a lap and conclude the
   * slider did nothing. So the driver has to actually get round in EVERY
   * character, or handing it the wheel proves nothing.
   *
   * The threshold is per character and deliberately not an average: a driver
   * that laps beautifully in three cars and spins the fourth is the exact
   * failure this test exists to catch, and an average hides it.
   */
  /**
   * The bot is not decoration: it is what makes the panel's claim checkable.
   * Driving yourself, a change in the tune and a change in your own hands
   * arrive together — you adapt to a worse car within a lap and conclude the
   * slider did nothing. So the driver has to get round in EVERY character.
   *
   * The threshold is per character and deliberately not an average: a driver
   * that laps beautifully in three cars and spins the fourth is the exact
   * failure this test exists to catch, and an average hides it.
   *
   * It also has to get round FAST, which is the assertion two earlier drivers
   * would have passed the lap count and failed. Both lapped by braking to a
   * crawl at every corner — perfectly competent, and useless on a stage whose
   * subject is what a car does when the tyres let go. How much of the lap is
   * spent sideways is asserted separately, because the right answer differs per
   * character: Stable is meant to be hard to lose.
   */
  /**
   * Every shipped character has to get round without hitting anything.
   *
   * This is the assertion that keeps the preset row honest. A preset is a
   * promise that these numbers are a car somebody chose, and a car that spends
   * its lap scraping down the barriers is not a choice, it is a tune that was
   * never driven. It is also the cheapest possible proxy for "is this drivable"
   * — a lap time cannot tell you the car reached it by bouncing off the walls.
   */
  test('every character laps clean under the autopilot', function (assert) {
    const route = routeOf(GATES);
    const angle = new Map<string, number>();

    for (const c of CHARACTERS) {
      const t = applied(fromCharacter(c));
      const car = makeCar(430, 210, 0);
      let gate = 0;
      let laps = 0;
      let hits = 0;
      let was = false;
      let ang = 0;
      const n = Math.round(90 / DT);

      for (let i = 0; i < n; i++) {
        stepCar(car, autopilot(car, route), t, DT, TRACK);
        ang += Math.abs(slipAngleOf(car));
        if (car.walled && !was) {
          hits += 1;
        }
        was = car.walled;
        if (through(car, GATES[gate]!)) {
          gate += 1;
          if (gate === GATES.length) {
            gate = 0;
            laps += 1;
          }
        }
      }

      angle.set(c.name, (ang / n) * (180 / Math.PI));
      assert.ok(hits <= 1, `${c.name}: touched a wall ${hits} times`);
      assert.ok(laps >= 8, `${c.name}: ${laps} laps in ninety seconds`);
    }

    /**
     * And they are still four different cars, which the wall test on its own
     * would happily let you lose: the tune that never touches anything is the
     * planted one, so optimising for it collapses all four onto the same
     * numbers and leaves a preset row that presets nothing.
     */
    assert.ok(
      angle.get('Drifty')! > 20,
      `Drifty runs at ${angle.get('Drifty')!.toFixed(0)}° of drift`
    );
    assert.ok(
      angle.get('Stable')! < 10,
      `Stable runs at ${angle.get('Stable')!.toFixed(0)}° of drift`
    );
  });

  test('the autopilot laps every character, and quickly', function (assert) {
    const route = routeOf(GATES);
    const seen = new Map<string, number>();
    for (const c of CHARACTERS) {
      const t = applied(fromCharacter(c));
      const car = makeCar(430, 210, 0);
      let gate = 0;
      let laps = 0;
      let slid = 0;
      const n = Math.round(90 / DT);

      for (let i = 0; i < n; i++) {
        stepCar(car, autopilot(car, route), t, DT, TRACK);
        if (car.sliding) {
          slid += 1;
        }
        if (through(car, GATES[gate]!)) {
          gate += 1;
          if (gate === GATES.length) {
            gate = 0;
            laps += 1;
          }
        }
      }

      assert.ok(laps >= 8, `${c.name}: ${laps} laps in ninety seconds`);
      seen.set(c.name, slid / n);
    }

    /**
     * And the characters are still different cars under one driver, which is
     * the thing the stage is actually claiming. A driver good enough to lap
     * everything is a driver that might have flattened them all into the same
     * car, and that failure would look exactly like success from the lap count.
     */
    assert.ok(
      seen.get('Drifty')! > seen.get('Stable')! + 0.2,
      `Drifty is sideways for ${Math.round(seen.get('Drifty')! * 100)}% of the lap, Stable for ${Math.round(seen.get('Stable')! * 100)}%`
    );
  });

  /**
   * The line is a plan, but the gates are the rule — so the plan has to obey
   * the rule. Catmull-Rom interpolates its control points, which is the whole
   * reason it was chosen over a smoothing spline: a line that merely passes
   * NEAR the gates is a bot that drives beautifully and never scores.
   */
  test('the racing line goes through every gate', function (assert) {
    const route = routeOf(GATES);
    for (const g of GATES) {
      const near = Math.min(
        ...route.pts.map((p) => Math.hypot(p.x - g.x, p.y - g.y))
      );
      assert.ok(
        near < 1,
        `the line reaches ${g.x},${g.y} (${near.toFixed(2)}px)`
      );
    }
  });

  test('the line stays on the track', function (assert) {
    const route = routeOf(GATES);
    const out = route.pts.filter(
      (p) => p.x < 0 || p.y < 0 || p.x > TRACK.w || p.y > TRACK.h
    );
    assert.strictEqual(out.length, 0, 'no part of it leaves the world');
  });

  test('a car can reverse off a wall it has buried its nose in', function (assert) {
    const t = applied(tuned());
    const car = makeCar(WORLD.w / 2, 40, -Math.PI / 2); // pointing at the top

    // drive it into the wall and hold it there
    for (let i = 0; i < 180; i++) {
      stepCar(car, drive({ throttle: 1 }), t, DT, WORLD);
    }
    assert.ok(car.y < 20, 'it is on the wall');
    assert.ok(Math.abs(forwardOf(car)) < 60, 'and it has no way to steer');

    // full lock forwards cannot save it — this is the deadlock
    for (let i = 0; i < 120; i++) {
      stepCar(car, drive({ steer: 1, throttle: 1 }), t, DT, WORLD);
    }
    assert.ok(car.y < 25, 'full lock and full throttle changes nothing');

    // reverse does, and the steering works while it does
    for (let i = 0; i < 120; i++) {
      stepCar(car, drive({ steer: -1, throttle: -0.6 }), t, DT, WORLD);
    }
    assert.ok(car.y > 60, `it backed off: y ${car.y.toFixed(0)}`);
    assert.ok(
      Math.abs(wrap(car.heading + Math.PI / 2)) > 0.3,
      'and swung its nose round on the way out'
    );
  });

  test('looseness moves every pair without writing to any of them', function (assert) {
    const t = tuned({ looseness: 0 });
    const planted = applied(t);
    const loose = applied({ ...t, looseness: 1 });

    assert.ok(loose.bite < planted.bite, 'less grip');
    assert.ok(loose.release < planted.release, 'and it lets go sooner');
    assert.ok(loose.yawC < planted.yawC, 'the chassis settles more slowly');
    assert.strictEqual(
      t.grip.bite,
      BASE.grip.bite,
      'and the raw value the folder shows is untouched — the macro multiplies, ' +
        'it does not write, so nothing on the panel can become a lie'
    );
  });

  test('every character is a car that drives', function (assert) {
    /**
     * A character is a flat `path -> value` map, because that is the shape the
     * store takes. Reading it back into the nested shape the loop wants is the
     * only place the two vocabularies meet, and it is worth a test on its own:
     * a typo in a path here is silent — the store ignores the update and the
     * car quietly keeps the default.
     */
    const num = (c: Character, k: string) => {
      const v = c.values[k];
      assert.strictEqual(typeof v, 'number', `${c.name} sets ${k}`);
      return v as number;
    };

    for (const c of CHARACTERS) {
      const t: DriftTuning = {
        engine: { drag: num(c, 'engine.drag'), power: num(c, 'engine.power') },
        grip: { bite: num(c, 'grip.bite'), release: num(c, 'grip.release') },
        looseness: num(c, 'looseness'),
        steering: {
          damping: num(c, 'steering.damping'),
          lock: num(c, 'steering.lock'),
          stiffness: num(c, 'steering.stiffness'),
        },
        yaw: {
          damping: num(c, 'yaw.damping'),
          stiffness: num(c, 'yaw.stiffness'),
        },
      };
      const car = makeCar(200, 450, 0);
      run(car, drive({ throttle: 1 }), t, 3);
      run(car, drive({ steer: 1, throttle: 1 }), t, 1.4);

      assert.ok(
        Number.isFinite(car.x) && Number.isFinite(car.heading),
        `${c.name}: the integrator stayed stable`
      );
      assert.ok(speedOf(car) > 60, `${c.name}: it actually moves`);
    }
  });

  /**
   * The bot is not decoration: it is what makes the panel's claim checkable.
   * Driving yourself, a change in the tune and a change in your own hands
   * arrive together — you adapt to a worse car within a lap and conclude the
   * slider did nothing. So the bot has to actually get round, in every
   * character, or the demonstration is a car going in circles near some cones.
   */
  /**
   * The bot is not decoration: it is what makes the panel's claim checkable.
   * Driving yourself, a change in the tune and a change in your own hands
   * arrive together — you adapt to a worse car within a lap and conclude the
   * slider did nothing. So the driver has to actually get round in EVERY
   * character, or handing it the wheel proves nothing.
   *
   * The threshold is per character and deliberately not an average: a driver
   * that laps beautifully in three cars and spins the fourth is the exact
   * failure this test exists to catch, and an average hides it.
   */
  test('looseness makes the same input drift further', function (assert) {
    /**
     * The stage's whole argument, as a number — and measured with a SCRIPTED
     * input rather than through the autopilot.
     *
     * Measured as a mean drift ANGLE rather than as the fraction of the turn
     * over the traction threshold. The fraction was the first version and it
     * saturated the moment the shipped defaults got loose enough to be worth
     * shipping: with a break-away threshold that low, both ends of the slider
     * are past it for most of the turn, and the metric read 74% against 71%
     * while the two cars plainly looked nothing alike. A boolean cannot report
     * a difference of degree. The angle can.
     *
     * Measuring it through the bot was a second mistake, and an instructive
     * one. The bot catches slides: past a drift angle it stops aiming and gets
     * the car straight. So a looser car, which reaches that angle sooner, is
     * saved sooner, and the metric came out backwards — the loose car spent 26%
     * of the lap sideways against the planted car's 58%. Both numbers were
     * true; neither was about the car. What the panel changes is the car, so
     * the test holds the driver still and moves only the slider.
     */
    const driftAngle = (looseness: number) => {
      const t = applied(tuned({ looseness }));
      const car = makeCar(430, 210, 0);
      let ang = 0;
      const frames = Math.round(12 / DT);
      for (let i = 0; i < frames; i++) {
        // wind it up straight, then hold a steady turn: one input, both cars
        const input = drive({
          steer: i * DT > 3 ? 0.85 : 0,
          throttle: 1,
        });
        stepCar(car, input, t, DT, ROOM);
        ang += Math.abs(slipAngleOf(car));
      }
      return ((ang / frames) * 180) / Math.PI;
    };

    const planted = driftAngle(0);
    const loose = driftAngle(1);
    assert.ok(
      loose > planted * 1.4,
      `loose holds ${loose.toFixed(0)}° of drift through the turn, planted ${planted.toFixed(0)}°`
    );
  });

  test('the shot leads the car and never shows the outside', function (assert) {
    const view = { h: 420, w: 680 };
    const car = makeCar(200, 450, 0);
    const shot = makeShot(car.x, car.y);
    const t = applied(tuned());

    for (let i = 0; i < 240; i++) {
      stepCar(car, drive({ throttle: 1 }), t, DT, ROOM);
      stepShot(shot, car, DT, view, WORLD);
    }

    assert.ok(shot.zoom < 1, 'at speed the frame has pulled back');
    const halfW = view.w / 2 / shot.zoom;
    assert.ok(
      shot.x >= halfW - 0.001 && shot.x <= WORLD.w - halfW + 0.001,
      'and it is still clamped inside the track'
    );
  });
});

/**
 * The panel's defaults and the Drifty character are ONE car, and nothing but
 * this test says so.
 *
 * The stage loads from the dial config — `this.dial.values`, resolved from the
 * first number of each tuple in TUNING. The shipped characters are buttons you
 * press. So the two can drift apart silently, and when they do the car you get
 * on arrival is one no preset describes and no test covers: every assertion in
 * this file runs `fromCharacter`, so a suite that is entirely green can be
 * green about a car nobody drives.
 *
 * That happened. Drifty's engine was taken from 520 to 490 in `lib/drift.ts`
 * alone; the tests went on passing at 490 while the stage kept starting at 520,
 * and the tuning note in CHARACTERS described a car you could only reach by
 * clicking its own name.
 */
module('Unit | drift | the default car', function () {
  test('the panel loads the Drifty character exactly', function (assert) {
    const drifty = CHARACTERS[0]!;
    assert.strictEqual(drifty.name, 'Drifty', 'Drifty is still the first');

    /** the first entry of a dialkit tuple is the value the panel starts on */
    const defaults: Record<string, number> = {};
    const walk = (node: Record<string, unknown>, prefix: string) => {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('_')) {
          continue;
        }
        const path = prefix ? `${prefix}.${key}` : key;
        if (Array.isArray(value)) {
          defaults[path] = value[0] as number;
        } else if (typeof value === 'object' && value !== null) {
          walk(value as Record<string, unknown>, path);
        }
      }
    };
    walk(TUNING as unknown as Record<string, unknown>, '');

    assert.deepEqual(
      defaults,
      drifty.values as Record<string, number>,
      'every dial default is the value Drifty ships'
    );
  });
});
