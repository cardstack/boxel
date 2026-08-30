/**
 * ONE SHOT LIST, TWO CAMERAS.
 *
 * Each entry is a single shot, and it carries both halves of it: what the
 * camera INSIDE the screen does to the board, and what the camera OUTSIDE
 * does to the laptop. They are one list rather than two because the moment
 * they are two, their durations have to be kept equal by hand — and the
 * first edit that forgets is a film whose two cameras have quietly drifted
 * a second apart.
 *
 * `move + hold` is the shot's length, and it is what BOTH regions are
 * given. The two scores cannot disagree about how long a shot is, because
 * neither of them owns the number.
 */
export interface Shot {
  /** the station to put the camera on — unused by a `pan`, which is relative */
  at: string;
  // ── and the same shot, from outside the laptop ──────────────────────
  /** multiples of the fitted distance. Small numbers: this is a drift. */
  dolly: number;
  /** seconds the camera sits there afterwards */
  hold: number;
  /**
   * How to get there.
   *
   *   `frame` — fit the station to the screen: the shot that changes
   *     magnification, used when arriving somewhere new.
   *   `aim`   — recentre on it with the zoom HELD. The move you cannot
   *     fake with a zoom: attention travels, scale does not.
   *   `pan`   — shift by exact pixels from wherever we stand, for a drift
   *     that is not about any one station.
   */
  kind: 'aim' | 'frame' | 'pan';
  /** seconds of travel */
  move: number;
  /**
   * How much of the FRAME the station should fill, 0..1 — `c.Frame`'s
   * `@padding`, which is a fraction and not a number of pixels. It
   * compiles straight into the zoom:
   *
   *     zoom = fill × min(frame.w / box.w, frame.h / box.h)
   *
   * so `0` is not "no padding", it is a camera zoomed to nothing, and the
   * region collapses to a point with no way back — every later
   * measurement is then taken through its own zero scale. Worth knowing
   * before you type the number you meant in pixels.
   */
  fill?: number;
  pitch: number;
  /** the push-in under the hold: `c.SlowZoom @by`. 1 is a dead hold. */
  push: number;

  /** board pixels, for a `pan` */
  x?: number;
  y?: number;
  yaw: number;
}

/** the board is authored at exactly the screen's size, so zoom 1 is the whole drawing */
export const BOARD = { h: 932, w: 1440 };

/**
 * THE FILM. It opens on the whole drawing, walks the signal path left to
 * right, drops to the desk, and pulls back out.
 *
 * The 3D numbers are deliberately tiny. Everything that tells the story
 * happens on the board; the laptop only breathes, because a device that
 * swings around while you are trying to read something is a demo talking
 * over itself.
 */
export const SHOTS: Shot[] = [
  {
    // ESTABLISH. Wide, and turned enough that the lid has a thickness —
    // a laptop shot square on is a rectangle, and a rectangle reads as a
    // picture of a screen rather than as a machine on a desk.
    at: 'board',
    dolly: 1.3,
    hold: 2.2,
    kind: 'frame',
    move: 1.4,
    fill: 1,
    pitch: -4,
    push: 1.04,
    yaw: -19,
  },
  {
    // IN on the capsule: the one big magnification change in the film,
    // and the laptop swings round WITH it. Close and flat is the worst
    // of both — you lose the drawing's context and gain no dimension for
    // it — so every push-in is paid for with a turn.
    at: 'capsule',
    dolly: 0.84,
    hold: 1.9,
    kind: 'frame',
    move: 2.0,
    fill: 0.58,
    pitch: 5,
    push: 1.05,
    yaw: -24,
  },
  {
    // ACROSS to the preamp — an AIM, so the scale is untouched and the
    // eye reads it as travel rather than as another zoom. The outer
    // camera crosses the other way, which is what keeps a held zoom from
    // feeling like a freeze.
    at: 'preamp',
    dolly: 0.82,
    hold: 1.7,
    kind: 'aim',
    move: 1.6,
    pitch: 7,
    push: 1.04,
    yaw: -6,
  },
  {
    // ...and on to the converter. Same move, same scale: a walk.
    at: 'converter',
    dolly: 0.8,
    hold: 1.6,
    kind: 'aim',
    move: 1.5,
    pitch: 9,
    push: 1.04,
    yaw: 14,
  },
  {
    // THE HIGH ANGLE. The inner camera drifts off the signal path while
    // the outer one climbs until the deck opens up — the shot where you
    // remember this is a laptop and not a poster of one. It is also the
    // only place the keyboard is worth spending two seconds on, so it
    // gets the drift rather than a station.
    at: 'board',
    dolly: 0.92,
    hold: 2.0,
    kind: 'pan',
    move: 1.6,
    pitch: 21,
    push: 1.03,
    x: 150,
    y: -40,
    yaw: 22,
  },
  {
    // DOWN to the desk — the widest block on the board, so the frame
    // pulls back out to hold it, and the laptop comes back down with it.
    at: 'desk',
    dolly: 0.82,
    hold: 2.1,
    kind: 'frame',
    move: 1.9,
    fill: 0.82,
    pitch: 8,
    push: 1.06,
    yaw: -16,
  },
  {
    // ACROSS to the monitors, scale held again, and the deepest turn of
    // the film underneath it.
    at: 'monitors',
    dolly: 0.78,
    hold: 1.7,
    kind: 'aim',
    move: 1.5,
    pitch: 4,
    push: 1.05,
    yaw: -26,
  },
  {
    // OUT. Back to the whole drawing, and the laptop settles square-ish
    // for the loop to start from somewhere calm.
    at: 'board',
    dolly: 1.28,
    hold: 1.6,
    kind: 'frame',
    move: 2.4,
    fill: 1,
    pitch: -6,
    push: 1.02,
    yaw: 10,
  },
];

/** how long the film is — the same number for both regions, by construction */
export const RUNTIME = SHOTS.reduce((n, s) => n + s.move + s.hold, 0);

export const GLIDE = [0.65, 0, 0.35, 1] as const;
