import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { at, Choreo, motion, type PerformCommand } from 'glimmer-motion';
import config from 'test-app/config/environment';

/**
 * TOWERS — a film, at `/_towers`.
 *
 * Sylva asked whether DOM could live INSIDE a 3D scene. This route asks a
 * different question, and it is the one a motion library has to answer
 * eventually: can a score cut a film? Not a hero loop with a caption on it —
 * a piece with chapters, a thesis, an argument that develops, titles that
 * are delivered rather than faded, and a camera that behaves like a camera
 * operator was paid to hold it.
 *
 * THE SUBJECT is the Japanese castle keep — the 天守 tenshu — and the film
 * is built the way an educational one is: context, then history, then
 * construction, then detail, then a comparison that puts the whole thing in
 * a wider frame. The scene it is shot in already grows six different towers
 * out of the ground on a clock, which is the rarest thing to find in a piece
 * of web art: a subject that can be taken apart on camera.
 *
 * THE SCENE IS AN IFRAME, deliberately. `public/towers.html` is Meng To's
 * construction study from threeui, vendored whole on its own pinned three
 * r149, and it stays a page rather than becoming a module: its own document,
 * its own compositor, its own main thread, torn down with the route. The
 * film reaches it through `window.__film`, the one block added to that file
 * — same-origin, so this is a function call and not a message queue.
 *
 * THERE ARE NO CARDS. Everything written in this film is written in the air,
 * in two layers that differ by where they stand in space:
 *
 *   THE WORLD LAYER is canvas-textured planes standing out in the scene,
 *   behind the building, put there by `film.sky()`. Giant kanji the eaves
 *   genuinely occlude, that parallax when the camera moves because they are
 *   really out there. The parent has no depth buffer; this is the only way
 *   type can be BEHIND something.
 *
 *   THE FRONT LAYER is this component's own DOM over the frame — the lower
 *   thirds, the plates, the tracking callouts — animated by Choreo's text
 *   machinery. Characters delivered centre-out on an overshoot, lines landing
 *   word by word, blocks following. That is the After Effects half, and it
 *   is all score vocabulary.
 *
 * THE CAMERA. The score authors the shot and the lens chases it, which is
 * the doctrine `docs/sylva-one-world.md` argues for at length. Here the
 * cascade falls out of the architecture for free: this component runs one
 * critically-damped stage, hands its output to the page as a GOAL, and the
 * page's own exponential chase is the second stage. Two integrators in
 * series bound the jerk, and neither of them had to be written twice.
 *
 * WHAT THE POSE ARGS MEAN HERE. `c.Camera3D` is an orbit rig and so is this
 * scene, so the mapping is nearly direct — but not quite, and pretending
 * otherwise would be the sort of lie that costs a day later:
 *
 *   yaw    → the orbit's azimuth, degrees
 *   pitch  → its elevation, degrees (the scene floors it near the horizon
 *            so the lens never ends up under the hill)
 *   dolly  → magnification. The scene's camera sits at a fixed 80 units on
 *            a long lens and FITS the tower by solving for fov, so there is
 *            nothing to dolly; this scales that fit instead. Bigger is
 *            tighter, which is the opposite of Sylva's dolly, and it is
 *            named dolly anyway because it is the argument the step has.
 *   look.y → how far up the building the lens aims. The whole of chapter
 *            three is this number climbing with the construction.
 *   x, y   → an off-centre FRUSTUM, not a truck: the tower keeps its
 *            perspective and simply sits in the third of the frame that the
 *            type is not using.
 */

/** the pose the film speaks in — see the note above on what each means */
interface Cam {
  dolly: number;
  /** how far up the tower the lens aims, world units from mid-height */
  lookY: number;
  /** the frame's off-centre, in fractions of the frame */
  ox?: number;
  pitch: number;
  yaw: number;
}

interface Beat {
  /** the construction clock: one number holds it, a pair runs it */
  build?: [number, number] | number;
  /** the pose crossed at the head of this beat */
  cam: Cam;
  /** the chapter this belongs to, for the rail at the foot of the frame */
  ch: number;
  /**
   * CUT TO IT, rather than travel to it.
   *
   * A spline through every mark is the right primitive for a sweep and the
   * wrong one for an edit: real cutting has hard cuts in it, and a lens
   * cannot fly to a 5× close-up on an eave without the trip being the shot.
   * A cut beat snaps the chaser onto its own pose at the instant its cue
   * fires — which is the same instant the path crosses that waypoint, so
   * the score and the picture still agree and nothing has been lied to.
   * Author the beat either side of a cut as a HOLD and it reads the way an
   * edit reads: still, cut, still.
   */
  cut?: boolean;
  /** the English of the kanji, set small under it */
  gloss?: string;
  id: string;
  /** the key term, in Japanese */
  kanji?: string;
  /** the eyebrow — where we are in the argument */
  kicker?: string;
  /** the sentence. This is the voice-over, written down. */
  line?: string;
  /** how the front layer is set */
  mode: 'lower' | 'plate' | 'point' | 'title';
  /** its reading */
  romaji?: string;
  /** type standing out in the world, behind the building */
  sky?: {
    /**
     * Swung this many degrees round the orbit from dead behind the tower.
     * Straight behind, a word about as wide as the building is a word you
     * never see; a few degrees off the axis and it reads past the eaves and
     * is cut by them, which is the whole reason it is out there rather than
     * in the DOM.
     */
    az?: number;
    /** how far behind the tower it stands */
    dist?: number;
    lines: string[];
    opacity?: number;
    /** world units tall */
    size: number;
    track?: number;
    /** its height in the world */
    y: number;
  };
  /** which of the six towers stands here */
  style?: number;
  /** time of day: 0 morning, 1 noon, 2 sunset, 3 night */
  theme?: number;
  /** how long it runs, in TICKS — see the note on the path */
  ticks: number;
  /**
   * A point on the BUILDING this beat is naming, world units. The front
   * layer draws a line to it and pins a dot on it — the one piece of the
   * film that has to know where the camera is pointing every frame.
   */
  to?: [number, number, number];
  /** the pose at its tail; without one the shot holds, and a hold is a hold */
  toCam?: Cam;
  /**
   * Lines drawn ON the building, in world coordinates. They draw
   * themselves on over the head of the beat and hold.
   */
  trace?: { pts: Pt3[]; wide?: boolean }[];
  /** weather: 0 clear, 1 rain, 2 storm, 3 snow */
  wx?: number;
}

/**
 * ONE TICK IS TWO SECONDS, and every beat is a whole number of them.
 *
 * `@through` splits its clock evenly between waypoints, so a beat buys the
 * screen time it wants by contributing that many waypoints to the path. This
 * sounds like a workaround and is actually the feature: a beat that wants to
 * HOLD contributes the same pose several times over, and a Catmull-Rom
 * spline through repeated points comes smoothly to rest and leaves smoothly
 * again. A pause you can author without stopping the clock is exactly what a
 * documentary wants and what Sylva's never-stopping wildlife sweep refused
 * to have.
 */
const TICK = 2;

const CHAPTERS = [
  { n: '01', title: 'CONTEXT' },
  { n: '02', title: 'HISTORY' },
  { n: '03', title: 'CONSTRUCTION' },
  { n: '04', title: 'DETAIL' },
  { n: '05', title: 'COMPARISON' },
];

const RAD = Math.PI / 180;

/* ------------------------------------------------------------------ *
 * TRACING THE BUILDING
 *
 * A line drawn ON the geometry rather than beside it: a polyline authored
 * in the scene's own world coordinates, projected through the same camera
 * that drew the tower, and stroked as SVG over the frame. It sits exactly
 * on the eave or the batter it is describing, it moves with the lens
 * because it is described in the world and not on the screen, and it can
 * be drawn on — which is what turns a diagram into a piece of film.
 *
 * The one thing it cannot do is hide behind the building: the parent has
 * no depth buffer, so a trace is always in front. That is the right
 * convention anyway — an annotation is not part of the scene, and every
 * architectural overlay ever printed sits on top of the photograph.
 * ------------------------------------------------------------------ */
type Pt3 = [number, number, number];

/** an arc at a height, swept between two bearings — an eave, a rail, a ring */
const ring = (y: number, r: number, a0: number, a1: number, n = 40): Pt3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / n) * RAD;
    return [Math.sin(a) * r, y, Math.cos(a) * r] as Pt3;
  });

/** the 扇の勾配 in section: the stone's own radius, sampled up its height */
const batter = (bearing: number, n = 22): Pt3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const y = (3.3 * i) / n;
    const f = y / 3.3;
    const r = 2.66 + (3.36 - 2.66) * Math.pow(1 - f, 1.85);
    const a = bearing * RAD;
    return [Math.sin(a) * r, y, Math.cos(a) * r] as Pt3;
  });

/** a plain segment between two points in the world */
const seg = (a: Pt3, b: Pt3): Pt3[] => [a, b];

/* the tower's own lines, in its own coordinates — see `ring`/`batter` */
const RING_EAVE1 = ring(5.02, 3.32, 60, 300);
const RING_EAVE2 = ring(7.7, 2.84, 60, 300);
const RING_EAVE3 = ring(10.16, 2.42, 60, 300);
const RAIL = ring(11.3, 1.84, 40, 320);
const RIDGE = seg([0.51, 13.72, 0.51], [-0.51, 13.72, -0.51]);
const BATTER_L = batter(128);
const BATTER_R = batter(232);

/**
 * THE SCRIPT.
 *
 * Written to be true. The dates, the terms and the readings are the ordinary
 * consensus of castle history — Azuchi in 1576, the arquebus in 1543, the One
 * Castle Per Province edict of 1615, twelve surviving original keeps — and
 * where the model departs from a real keep the commentary says so rather than
 * flattering the geometry. A museum caption that is wrong is worse than no
 * caption, and this one is going on a wall.
 */
const BEATS: Beat[] = [
  /* ---------------------------------------------------------------- *
   * 01 — CONTEXT: what the thing in front of you actually is
   * ---------------------------------------------------------------- */
  {
    build: 4.4,
    cam: { dolly: 0.62, lookY: -1.2, ox: 0.2, pitch: 12, yaw: -34 },
    ch: 0,
    gloss: 'the keep',
    id: 'title',
    kanji: '天守',
    kicker: 'A CONSTRUCTION STUDY',
    line: 'A Japanese castle tower — what it is, where it came from, and how it stands up.',
    mode: 'title',
    romaji: 'TENSHU',
    /* 普請 fushin, the old word for a building works — the scene's own
       title, and the one word that should be behind everything */
    sky: {
      az: 16,
      dist: 26,
      lines: ['普請'],
      opacity: 0.4,
      size: 4.2,
      track: 0.2,
      y: 7.5,
    },
    theme: 0,
    ticks: 4,
    toCam: { dolly: 0.64, lookY: -1.0, ox: 0.2, pitch: 13, yaw: -26 },
  },
  {
    cam: { dolly: 0.58, lookY: 2.2, ox: -0.1, pitch: 18, yaw: -18 },
    ch: 0,
    gloss: 'castle',
    id: 'shiro',
    kanji: '城',
    kicker: 'WHAT A CASTLE IS',
    line: 'A Japanese castle is not the tower. It is the ground — ditches, banks, and a hill cut into terraces. The tower is the last thing built on it, and the first thing you see.',
    mode: 'lower',
    romaji: 'SHIRO',
    ticks: 4,
    toCam: { dolly: 0.6, lookY: 2.0, ox: -0.1, pitch: 15, yaw: -6 },
  },
  {
    cam: { dolly: 0.72, lookY: 1.0, ox: 0.16, pitch: 8, yaw: 2 },
    ch: 0,
    gloss: 'keep · watchtower',
    id: 'what',
    kanji: '天守閣',
    kicker: 'ONE BUILDING, THREE JOBS',
    line: 'A lookout, a strongroom, and an argument. Most keeps were fought over rarely and looked at daily — which tells you which job the design was really serving.',
    mode: 'plate',
    romaji: 'TENSHUKAKU',
    ticks: 3,
  },

  /* ---------------------------------------------------------------- *
   * 02 — HISTORY: where the form comes from, and why it stopped
   * ---------------------------------------------------------------- */
  {
    cam: { dolly: 0.9, lookY: 1.4, ox: 0.14, pitch: 6, yaw: 18 },
    ch: 1,
    gloss: 'Azuchi, 1576',
    id: 'azuchi',
    kanji: '安土城',
    kicker: 'THE FIRST OF ITS KIND',
    line: 'Oda Nobunaga raises a tower nobody has seen before above Lake Biwa: seven storeys, gilded, decorated inside like a palace. It burns six years later and never gets rebuilt — and every keep after it is a reply to it.',
    mode: 'plate',
    romaji: 'AZUCHI-JŌ',
    sky: {
      az: -14,
      dist: 28,
      lines: ['安土'],
      opacity: 0.34,
      size: 3.6,
      track: 0.18,
      y: 11,
    },
    theme: 2,
    ticks: 4,
  },
  {
    cam: { dolly: 1.15, lookY: -2.6, ox: -0.1, pitch: 1, yaw: 34 },
    ch: 1,
    gloss: 'the matchlock gun',
    id: 'teppo',
    kanji: '鉄砲',
    kicker: 'WHY THE SHAPE CHANGED',
    line: 'Firearms reach Japan in 1543. Within a generation the walls that matter get lower, thicker and stony, and height stops being defence. What height becomes is address.',
    mode: 'lower',
    romaji: 'TEPPŌ',
    ticks: 4,
    toCam: { dolly: 1.05, lookY: -1.4, ox: -0.1, pitch: 4, yaw: 44 },
  },
  {
    cam: { dolly: 0.74, lookY: 1.8, ox: 0.16, pitch: 13, yaw: 56 },
    ch: 1,
    gloss: 'one domain, one castle',
    id: 'ikkoku',
    kanji: '一国一城令',
    kicker: 'AND WHY IT STOPPED',
    line: 'In 1615 the Tokugawa allow each domain a single castle and pull the rest down. Building keeps essentially ends. Twelve original towers survive today; the famous white one at Himeji is one of them.',
    mode: 'plate',
    romaji: 'IKKOKU-ICHIJŌ-REI',
    ticks: 4,
  },

  /* ---------------------------------------------------------------- *
   * 03 — CONSTRUCTION: the tower comes apart, bottom to top
   *
   * The scene's own build clock does the work here. Each beat runs it
   * across the span the stage occupies, and the lens climbs with it —
   * the pose's look height and the clip plane rise together, which is
   * the only reason this chapter reads as one continuous act.
   * ---------------------------------------------------------------- */
  {
    build: [0, 1.07],
    cam: { dolly: 1.24, lookY: -4.4, ox: -0.12, pitch: -1, yaw: 72 },
    ch: 2,
    gloss: 'the stone base',
    id: 'ishigaki',
    kanji: '石垣',
    kicker: 'STAGE ONE',
    line: 'It begins with a slope. Dry-laid stone, no mortar, battered into a curve the masons called 扇の勾配 — the fan’s incline. A wall that curves sheds a shock into the hill instead of arguing with it.',
    mode: 'lower',
    romaji: 'ISHIGAKI',
    theme: 1,
    ticks: 5,
    to: [2.8, 1.6, 0.6],
    toCam: { dolly: 1.12, lookY: -3.2, ox: -0.12, pitch: 1, yaw: 84 },
  },
  {
    build: [1.07, 1.92],
    cam: { dolly: 1.05, lookY: -2.2, ox: -0.12, pitch: 2, yaw: 90 },
    ch: 2,
    gloss: 'post and beam',
    id: 'timber',
    kanji: '柱梁',
    kicker: 'STAGE TWO',
    line: 'Above the stone the keep is a timber cage. Posts stand on footing stones rather than in the ground, tied by beams, and the joints do the work that bolts would do — a frame that can be shaken and stay standing.',
    mode: 'lower',
    romaji: 'CHŪRYŌ',
    ticks: 5,
    toCam: { dolly: 1.0, lookY: -0.9, ox: -0.12, pitch: 4, yaw: 102 },
  },
  {
    build: [1.92, 2.79],
    cam: { dolly: 1.02, lookY: -0.4, ox: -0.12, pitch: 5, yaw: 108 },
    ch: 2,
    gloss: 'the white wall',
    id: 'plaster',
    kanji: '白壁',
    kicker: 'STAGE THREE',
    line: 'Lime plaster over a bamboo lath, laid on thick enough to be armour — 塗籠, nurigome, the wrapped-up wall. It is white because white does not burn, and fire was the likelier enemy.',
    mode: 'lower',
    romaji: 'SHIRAKABE',
    ticks: 4,
    toCam: { dolly: 1.0, lookY: 0.8, ox: -0.12, pitch: 7, yaw: 118 },
  },
  {
    build: [2.79, 3.64],
    cam: { dolly: 1.0, lookY: 2.0, ox: -0.12, pitch: 10, yaw: 124 },
    ch: 2,
    gloss: 'the watch storey',
    id: 'boro',
    kanji: '望楼',
    kicker: 'STAGE FOUR',
    line: 'The top storey is the reason for all the rest: a room to see from, railed on the outside, small enough that the roofs below can carry it.',
    mode: 'lower',
    romaji: 'BŌRŌ',
    ticks: 4,
    toCam: { dolly: 0.94, lookY: 2.8, ox: -0.12, pitch: 13, yaw: 133 },
  },
  {
    build: [3.64, 4.4],
    cam: { dolly: 0.88, lookY: 3.0, ox: -0.12, pitch: 15, yaw: 138 },
    ch: 2,
    gloss: 'the clay tile',
    id: 'kawara',
    kicker: 'STAGE FIVE',
    kanji: '瓦',
    line: 'Fired clay, hung on battens rather than nailed. The roof is the heaviest thing in the building — and that weight, pressing down through the frame, is part of what holds it steady.',
    mode: 'lower',
    romaji: 'KAWARA',
    ticks: 5,
    toCam: { dolly: 0.72, lookY: 2.2, ox: -0.1, pitch: 12, yaw: 148 },
  },

  /* ---------------------------------------------------------------- *
   * 04 — DETAIL: cut in hard, hold, trace it, cut again
   *
   * This chapter is CUT rather than flown. Each shot holds still, the
   * next one snaps to a much longer lens, and lines draw themselves onto
   * the geometry while it holds — which is how an architecture film
   * actually behaves, and impossible to fake with one continuous sweep.
   * ---------------------------------------------------------------- */
  {
    build: 4.4,
    cam: { dolly: 0.8, lookY: 1.4, ox: 0.18, pitch: 12, yaw: 152 },
    ch: 3,
    gloss: 'four things worth naming',
    id: 'detail',
    kanji: '細部',
    kicker: 'LOOK CLOSER',
    line: 'Everything from here is one building at one moment. Only the lens moves — and it moves by cutting.',
    mode: 'plate',
    romaji: 'SAIBU',
    ticks: 3,
    trace: [
      { pts: RING_EAVE1, wide: true },
      { pts: RING_EAVE2 },
      { pts: BATTER_L },
      { pts: BATTER_R },
    ],
  },
  {
    build: 4.4,
    cam: { dolly: 4.6, lookY: 6.8, ox: -0.18, pitch: 4, yaw: 156 },
    ch: 3,
    cut: true,
    gloss: 'the roof-ridge fish',
    id: 'shachi',
    kanji: '鯱',
    kicker: 'ON THE RIDGE',
    line: 'A fish with a tiger’s head, tail in the air, cast in bronze at both ends of the main ridge. It is a charm against fire — the story says it swallows water and spits it over the roof.',
    mode: 'point',
    romaji: 'SHACHIHOKO',
    ticks: 4,
    to: [-0.51, 13.85, -0.51],
    trace: [{ pts: RIDGE, wide: true }],
  },
  {
    build: 4.4,
    cam: { dolly: 3.9, lookY: -1.4, ox: -0.18, pitch: 1, yaw: 166 },
    ch: 3,
    cut: true,
    gloss: 'the plover gable',
    id: 'hafu',
    kanji: '千鳥破風',
    kicker: 'IN THE ROOF SLOPE',
    line: 'The triangular dormer set into the roof, named for a plover. It lets light into a deep floor and gives someone a place to look down from — ornament that is also a firing position.',
    mode: 'point',
    romaji: 'CHIDORI-HAFU',
    ticks: 4,
    to: [1.59, 5.5, -1.59],
    trace: [{ pts: RING_EAVE1, wide: true }],
  },
  {
    build: 4.4,
    cam: { dolly: 4.2, lookY: 4.25, ox: -0.18, pitch: 5, yaw: 176 },
    ch: 3,
    cut: true,
    gloss: 'the balcony rail',
    id: 'koran',
    kanji: '高欄',
    kicker: 'AROUND THE TOP',
    line: 'The railed walk around the watch storey. On a good many keeps it is a fiction — a rail on a ledge too narrow to walk — because what it is really for is to be seen from the town below.',
    mode: 'point',
    romaji: 'KŌRAN',
    ticks: 4,
    to: [0.13, 11.3, -1.84],
    trace: [{ pts: RAIL, wide: true }],
  },
  {
    build: 4.4,
    cam: { dolly: 3.4, lookY: -5.2, ox: -0.18, pitch: -1, yaw: 184 },
    ch: 3,
    cut: true,
    gloss: 'the fan’s incline',
    id: 'ishi2',
    kanji: '扇の勾配',
    kicker: 'AT THE FOOT',
    line: 'The curve is the whole argument of the base: vertical where it meets the timber, flaring where it meets the ground, so a shock runs down it into the hill instead of trying to stop at a wall.',
    mode: 'point',
    romaji: 'ŌGI-NO-KŌBAI',
    ticks: 4,
    to: [2.8, 1.6, 0.6],
    trace: [
      { pts: BATTER_L, wide: true },
      { pts: BATTER_R, wide: true },
    ],
  },
  {
    build: 4.4,
    cam: { dolly: 1.9, lookY: -1.9, ox: -0.12, pitch: 0, yaw: 190 },
    ch: 3,
    gloss: 'the eave',
    id: 'noki',
    kanji: '軒',
    kicker: 'AND THE REASON FOR ALL OF IT',
    line: 'The eaves overhang by a metre and more, and every line you have been reading as style is first a way of keeping water off an earth, timber and plaster wall. Watch what the building is for.',
    mode: 'lower',
    romaji: 'NOKI',
    ticks: 5,
    to: [-0.46, 4.98, -3.29],
    toCam: { dolly: 1.6, lookY: -1.2, ox: -0.12, pitch: 3, yaw: 200 },
    trace: [
      { pts: RING_EAVE1, wide: true },
      { pts: RING_EAVE2 },
      { pts: RING_EAVE3 },
    ],
    wx: 1,
  },

  /* ---------------------------------------------------------------- *
   * 05 — COMPARISON: the same lens, six answers
   *
   * The framing is deliberately IDENTICAL across the six. A comparison
   * shot that re-frames for each subject is not a comparison, it is six
   * portraits — so the pose only drifts, slowly, and the thing that
   * changes in the frame is the building.
   * ---------------------------------------------------------------- */
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: 0.16, pitch: 10, yaw: 206 },
    ch: 4,
    gloss: 'comparison',
    id: 'hikaku',
    kanji: '比較',
    kicker: 'ONE PROBLEM',
    line: 'Every tower here is an answer to the same question: how do you get height out of the material you happen to have? Same lens, same distance, same clock — only the building changes.',
    mode: 'plate',
    romaji: 'HIKAKU',
    sky: {
      az: -14,
      dist: 28,
      lines: ['比較'],
      opacity: 0.32,
      size: 3.4,
      track: 0.2,
      y: 11,
    },
    theme: 0,
    ticks: 3,
    wx: 0,
  },
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: -0.1, pitch: 10, yaw: 212 },
    ch: 4,
    gloss: 'Japan · the keep',
    id: 'c-jp',
    kanji: '天守',
    kicker: 'JAPAN',
    line: 'A timber frame in a stone skirt, gaining height by stacking roofs. The weight goes straight down the posts; the roofs do the expressing.',
    mode: 'lower',
    romaji: 'TENSHU',
    style: 0,
    ticks: 4,
  },
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: -0.1, pitch: 10, yaw: 219 },
    ch: 4,
    gloss: 'China · the pagoda',
    id: 'c-cn',
    kanji: '寶塔',
    kicker: 'CHINA',
    line: 'Tiers around a core, with bracket sets — 斗栱, dougong — stepping the eaves far out past the wall. The same timber logic, taken upward instead of outward.',
    mode: 'lower',
    romaji: 'BǍOTǍ',
    style: 1,
    ticks: 4,
  },
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: -0.1, pitch: 10, yaw: 226 },
    ch: 4,
    gloss: 'Vietnam · the tower',
    id: 'c-vn',
    kanji: '佛塔',
    kicker: 'VIETNAM',
    line: 'A masonry body with thin tiled eaves marking each storey. You are not meant to go up it: it is a reliquary that reads as a tower, not a lookout that reads as a shrine.',
    mode: 'lower',
    romaji: 'THÁP',
    style: 2,
    ticks: 4,
  },
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: -0.1, pitch: 10, yaw: 233 },
    ch: 4,
    gloss: 'Thailand · the prang',
    id: 'c-th',
    kanji: 'ปรางค์',
    kicker: 'THAILAND',
    line: 'A tall rounded tower over a stepped base, tapering the whole way. The shape is not structural ambition but cosmology — it is a mountain, and the base is the world it stands in.',
    mode: 'lower',
    romaji: 'PRANG',
    style: 3,
    ticks: 4,
  },
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: -0.1, pitch: 10, yaw: 240 },
    ch: 4,
    gloss: 'Cambodia · the sanctuary',
    id: 'c-kh',
    kanji: 'ប្រាសាទ',
    kicker: 'CAMBODIA',
    line: 'Laterite terraces carrying dressed sandstone, corbelled rather than arched. With no true arch the only way to close a tower is to keep narrowing it — so the silhouette is the structure admitting its limit.',
    mode: 'lower',
    romaji: 'PRASAT',
    style: 4,
    ticks: 4,
  },
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: -0.1, pitch: 10, yaw: 247 },
    ch: 4,
    gloss: 'Türkiye · the mosque',
    id: 'c-tr',
    kanji: 'CAMİ',
    kicker: 'TÜRKIYE',
    line: 'The opposite answer. Mass in compression: a dome on an octagon over a stone hall, the interior kept as one room — and the height taken out of the building altogether and given to a separate minaret.',
    mode: 'lower',
    romaji: 'CAMİ',
    style: 5,
    ticks: 4,
  },

  /* ---------------------------------------------------------------- *
   * CODA
   * ---------------------------------------------------------------- */
  {
    cam: { dolly: 0.62, lookY: -0.6, ox: 0.2, pitch: 14, yaw: 256 },
    ch: 4,
    id: 'coda',
    kanji: '天守',
    line: 'Six towers, one problem, six materials. Come back to the first one and it reads differently: not a fortress that happens to be beautiful, but a roof structure tall enough to be seen from the fields.',
    mode: 'title',
    romaji: 'TENSHU',
    sky: {
      az: 16,
      dist: 26,
      lines: ['天守'],
      opacity: 0.36,
      size: 4,
      track: 0.2,
      y: 7.5,
    },
    style: 0,
    theme: 2,
    ticks: 5,
    toCam: { dolly: 0.6, lookY: -0.4, ox: 0.2, pitch: 16, yaw: 264 },
  },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** '#ecdcbc' → 'rgba(236,220,188,a)', for a scrim that has to be a gradient */
const rgba = (hex: string, a: number): string => {
  const h = hex.trim().replace('#', '');
  if (h.length !== 6) {
    return `rgba(236,220,188,${a})`;
  }
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/** what the vendored page publishes — see the HOST FILM BRIDGE block there */
interface FilmApi {
  dur: number;
  fade(id: string, opacity: number): void;
  height(): number;
  palette(): {
    accent: string;
    ink: string;
    ink2: string;
    ink3: string;
    paper: string;
    rule: string;
    time: string;
  };
  ping(i: number): void;
  pose(p: {
    az?: number;
    el?: number;
    lookY?: number;
    ox?: number;
    oy?: number;
    snap?: boolean;
    zoom?: number;
  }): void;
  project(
    x: number,
    y: number,
    z: number
  ): { on: boolean; x: number; y: number; z: number };
  rewind(): void;
  sky(id: string, spec: object, place: object): void;
  sound(on: boolean): void;
  style(i: number): number;
  styleIndex(): number;
  sun(): { h: number; on: boolean; w: number; x: number; y: number };
  theme(i: number, instant?: boolean): void;
  time(v: number): void;
  view(): {
    az: number;
    el: number;
    fov: number;
    h: number;
    w: number;
    zoom: number;
  };
  wx(i: number, instant?: boolean): void;
}

export default class TowerFilm extends Component<{
  Args: { embed?: boolean };
}> {
  /** the beat on screen; the score names it, the front layer renders it */
  @tracked private beatIndex = 0;
  @tracked private playing = true;
  /** bumping this edits the score, which is how a finite film loops */
  @tracked private lap = 0;
  @tracked private booted = false;
  /** bumped on every jump cut; keying on it restarts the wipe */
  @tracked private cutStamp = 0;

  private film?: FilmApi;
  private frameEl?: HTMLElement;
  private lineEl?: SVGLineElement;
  private dotEl?: SVGCircleElement;
  private traceEls: SVGPolylineElement[] = [];
  private plateEl?: HTMLElement;
  private rowEls: HTMLElement[] = [];
  private raf = 0;
  private lastTick = 0;
  /** when the current beat was entered, for the clocks it owns */
  private beatAt = 0;

  /* the score's goal, and the two stages that chase it */
  private goal: Cam = { ...BEATS[0]!.cam };
  private mid: Cam = { ...BEATS[0]!.cam };
  private midV = { dolly: 0, lookY: 0, ox: 0, pitch: 0, yaw: 0 };
  private now: Cam = { ...BEATS[0]!.cam };
  private nowV = { dolly: 0, lookY: 0, ox: 0, pitch: 0, yaw: 0 };

  /** the world-layer plane's own fade, so a chapter's type breathes in */
  private skyOn = 0;
  /** the time of day the furniture is currently dressed for */
  private wearing = '';
  /** the cast-shadow offset the type is currently wearing, px */
  private shadow = { x: 0, y: 0 };
  private pageEl?: HTMLElement;

  /**
   * WHERE THE CUT STARTS — the arrow keys' one piece of state.
   *
   * A film this long is unwatchable without chapter skip, and seeking a run
   * that carries an integrator is not honest (the chaser's pose depends on
   * its history, which is the price Drift's doctrine names out loud). So
   * skipping RE-CUTS instead of seeking: the beat list is sliced here, the
   * path and the cues are both derived from that list, and the score the
   * region sees is a different, shorter film. An edited timeline replays
   * from its own head, which is exactly the behaviour wanted — and it is
   * the same move Sylva's lap makes to loop.
   *
   * `?from=N` seeds it, so a shot can be linked to.
   */
  @tracked private from = (() => {
    const q = new URLSearchParams(window.location.search).get('from');
    const n = q ? Number(q) : 0;
    return Number.isFinite(n) && n > 0 ? Math.min(n, BEATS.length - 1) : 0;
  })();

  /** sound is off until asked for: nobody's first second should be音 */
  @tracked private sound = false;

  get beats(): Beat[] {
    return this.from > 0 ? BEATS.slice(this.from) : BEATS;
  }

  /** the first beat of each chapter, in whole-film indices */
  get chapterHeads(): number[] {
    const heads: number[] = [];
    BEATS.forEach((b, i) => {
      if (heads.length === 0 || BEATS[heads[heads.length - 1]!]!.ch !== b.ch) {
        heads.push(i);
      }
    });
    return heads;
  }

  /** where we are in the WHOLE film, not the current cut */
  get absoluteIndex(): number {
    return this.from + this.beatIndex;
  }

  get beat(): Beat {
    return this.beats[this.beatIndex] ?? this.beats[0]!;
  }

  get chapter() {
    return CHAPTERS[this.beat.ch] ?? CHAPTERS[0]!;
  }

  get embed(): boolean {
    return this.args.embed ?? false;
  }

  get src(): string {
    return `${config.rootURL}towers.html?host`;
  }

  /** a fresh name per lap: an edited score replays, a restarted one fights */
  get filmName(): string {
    return `film-${this.lap}`;
  }

  get filmSeconds(): number {
    return this.beats.reduce((n, b) => n + b.ticks, 0) * TICK;
  }

  /**
   * THE WHOLE FILM IS ONE CAMERA STEP.
   *
   * Every beat contributes `ticks` waypoints: a moving beat is sampled from
   * its head pose to its tail, a holding beat repeats its pose, and the
   * spline runs through the lot on one clock. So the shot list is a path
   * rather than a playlist, the camera crosses each mark with velocity
   * instead of arriving at it, and a hold is genuinely still without
   * anything having stopped.
   */
  get path() {
    const pts: {
      dolly: number;
      look: { x: number; y: number; z: number };
      pitch: number;
      x: number;
      y: number;
      yaw: number;
    }[] = [];
    for (const b of this.beats) {
      for (let k = 0; k < b.ticks; k++) {
        const f = b.ticks === 1 ? 0 : k / (b.ticks - 1);
        const to = b.toCam ?? b.cam;
        pts.push({
          dolly: lerp(b.cam.dolly, to.dolly, f),
          look: { x: 0, y: lerp(b.cam.lookY, to.lookY, f), z: 0 },
          pitch: lerp(b.cam.pitch, to.pitch, f),
          x: lerp(b.cam.ox ?? 0, to.ox ?? 0, f),
          y: 0,
          yaw: lerp(b.cam.yaw, to.yaw, f),
        });
      }
    }
    return pts;
  }

  /** each beat's entrance, as a delay into the one camera step */
  get cues() {
    let t = 0;
    return this.beats.map((b, i) => {
      const at = t;
      t += b.ticks * TICK;
      /* a Perform target is a NAME, and a beat's name is its place in the
         script — the index, as a string, so the cue and the array agree */
      return { delay: at, index: String(i) };
    });
  }

  get railStyle(): string {
    return `width:${Math.round(((this.beatIndex + 1) / this.beats.length) * 100)}%`;
  }

  private mount = modifier((el: HTMLElement) => {
    this.frameEl = el;
    this.pageEl = el.closest('.tf-page') as HTMLElement;
    window.addEventListener('keydown', this.key);
    const frame = el.querySelector('iframe');
    if (!frame) {
      return;
    }
    /* a film owns the whole frame: the app's bar and footer step out
       entirely rather than fading, because unlike Sylva's theater there
       is no lockup here that wants to stay superimposed */
    if (!this.embed) {
      document.body.classList.add('tf-film');
    }
    const onLoad = () => {
      const w = (frame as HTMLIFrameElement).contentWindow as unknown as {
        __film?: FilmApi;
      } | null;
      if (!w?.__film) {
        return;
      }
      this.film = w.__film;
      /* the page opens on an empty site — its own clock is at zero — and
         most of this film is about a finished building. Standing it up
         before the first beat runs means a beat only ever has to say what
         it CHANGES, which is also what makes `?from` land on a real shot
         rather than on a field. */
      w.__film.time(4.4);
      /* seat the lens where the film opens, so the first frame is the
         shot and not a swing towards it */
      this.snap(this.beats[0]!.cam);
      this.applyBeat(this.beats[0]!, true);
      this.booted = true;
      this.lastTick = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    };
    frame.addEventListener('load', onLoad);
    /* a cached iframe can be complete before the listener is attached */
    if (
      (frame as HTMLIFrameElement).contentDocument?.readyState === 'complete'
    ) {
      onLoad();
    }
    return () => {
      cancelAnimationFrame(this.raf);
      window.removeEventListener('keydown', this.key);
      frame.removeEventListener('load', onLoad);
      document.body.classList.remove('tf-film');
      this.film = undefined;
    };
  });

  private trackEls = modifier((el: SVGSVGElement) => {
    this.lineEl = el.querySelector('line.tf-leader') as SVGLineElement;
    this.dotEl = el.querySelector('circle') as SVGCircleElement;
    this.traceEls = [
      ...el.querySelectorAll('polyline'),
    ] as SVGPolylineElement[];
  });

  private plate = modifier((el: HTMLElement) => {
    this.plateEl = el;
    /* the rows, nearest plane last — the big glyph is the near one */
    this.rowEls = [...el.children] as HTMLElement[];
    return () => {
      if (this.plateEl === el) {
        this.plateEl = undefined;
        this.rowEls = [];
      }
    };
  });

  private snap(c: Cam) {
    this.goal = { ...c };
    this.mid = { ...c };
    this.now = { ...c };
    for (const k of ['dolly', 'lookY', 'ox', 'pitch', 'yaw'] as const) {
      this.midV[k] = 0;
      this.nowV[k] = 0;
    }
    this.film?.pose({
      az: c.yaw * RAD,
      el: c.pitch * RAD,
      lookY: c.lookY,
      ox: c.ox ?? 0,
      snap: true,
      zoom: c.dolly,
    });
  }

  /**
   * One critically-damped stage. The page's own chase is the second, which
   * is the whole cascade argument getting made for free by the fact that the
   * scene lives in another document.
   */
  private chase(dt: number) {
    const w = 6.5;
    for (const k of ['dolly', 'lookY', 'ox', 'pitch', 'yaw'] as const) {
      const g = k === 'ox' ? (this.goal.ox ?? 0) : this.goal[k];
      const m = k === 'ox' ? (this.mid.ox ?? 0) : this.mid[k];
      const v = this.midV[k] + (w * w * (g - m) - 2 * w * this.midV[k]) * dt;
      this.midV[k] = v;
      const next = m + v * dt;
      if (k === 'ox') {
        this.mid.ox = next;
        this.now.ox = next;
      } else {
        this.mid[k] = next;
        this.now[k] = next;
      }
    }
  }

  private frame = (stamp: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const film = this.film;
    if (!film) {
      return;
    }
    const dt = Math.min(
      0.08,
      this.lastTick ? (stamp - this.lastTick) / 1000 : 0
    );
    this.lastTick = stamp;

    this.chase(dt);
    /* a chaser lands on a millionth of a pixel rather than on zero, and an
       off-centre frustum that is never quite centred keeps the projection
       matrix rebuilt every frame for nothing — so zero means zero */
    const ox = Math.abs(this.now.ox ?? 0) < 1e-4 ? 0 : this.now.ox!;
    film.pose({
      az: this.now.yaw * RAD,
      el: this.now.pitch * RAD,
      lookY: this.now.lookY,
      ox,
      zoom: this.now.dolly,
    });

    const beat = this.beat;
    /**
     * The beat's own local clock. It is re-based at every beat entrance, so
     * whatever it drifts is bounded by one beat rather than by the film —
     * the same seek-unsafe-but-self-correcting bargain the chaser makes,
     * and for the same reason: these are simulations, not tweens.
     */
    const local = Math.min(
      1,
      (stamp - this.beatAt) / (beat.ticks * TICK * 1000)
    );

    if (Array.isArray(beat.build)) {
      film.time(lerp(beat.build[0], beat.build[1], smooth(local)));
    }

    /* the world layer fades with the beat rather than cutting with it */
    if (beat.sky) {
      const v = film.view();
      const d = beat.sky.dist ?? 30;
      const a = v.az + (beat.sky.az ?? 0) * RAD;
      this.skyOn += (1 - this.skyOn) * Math.min(1, dt * 1.6);
      film.sky(
        'chapter',
        {
          color: '#2e2515',
          lines: beat.sky.lines,
          size: beat.sky.size,
          track: beat.sky.track ?? 0.16,
        },
        {
          billboard: true,
          opacity: this.skyOn * (beat.sky.opacity ?? 0.4) * smooth(local * 3),
          x: -Math.sin(a) * d,
          y: beat.sky.y,
          z: -Math.cos(a) * d,
        }
      );
    } else if (this.skyOn > 0.001) {
      this.skyOn += (0 - this.skyOn) * Math.min(1, dt * 2.4);
      film.fade('chapter', this.skyOn);
    }

    this.trackPoint(film, beat, local);
    this.traceShape(film, beat, local);
    this.parallax(local);
    this.follow(film);
    this.wear(film);
  };

  /**
   * TYPE THROWS ITS SHADOW WHERE THE BUILDING THROWS ITS OWN.
   *
   * The scene lights itself from a key whose position is a property of the
   * hour, and the tower's cast shadow lies along the ground at whatever
   * diagonal that produces. Type set over the frame with a shadow offset
   * down and right — the default of every drop shadow ever shipped — is
   * lit by a different sun than everything behind it, and the eye reads
   * the mismatch long before it can name it. So the key's own screen
   * position comes back from the scene and the offset is simply the
   * direction away from it. At night, or with the sun behind the lens,
   * there is no honest cast shadow and the type wears none.
   */
  private follow(film: FilmApi) {
    const el = this.pageEl;
    if (!el) {
      return;
    }
    const s = film.sun();
    const cx = s.w / 2;
    const cy = s.h * 0.55;
    const dx = cx - s.x;
    const dy = cy - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const throwPx = s.on ? 3.2 : 0;
    const nx = (dx / len) * throwPx;
    const ny = (dy / len) * throwPx;
    /* a whole pixel is enough to read and small enough never to smear */
    const q = (v: number) => Math.round(v * 10) / 10;
    if (q(nx) !== this.shadow.x || q(ny) !== this.shadow.y) {
      this.shadow = { x: q(nx), y: q(ny) };
      el.style.setProperty('--tf-shx', `${this.shadow.x}px`);
      el.style.setProperty('--tf-shy', `${this.shadow.y}px`);
      /* the same diagonal, longer, for the graphic rules */
      el.style.setProperty(
        '--tf-rake',
        `${q(Math.atan2(ny, nx) * 57.2958)}deg`
      );
    }
  }

  /**
   * THE FURNITURE WEARS THE SCENE'S PALETTE.
   *
   * The page carries four times of day and swings its whole palette between
   * them, so a scrim and a caption painted in one fixed ochre are correct in
   * exactly one chapter and wrong in the other four — at noon the film's
   * warm paper sits on a cool scene like a sticker. The scene already
   * publishes its ink as CSS variables, so the film simply reads them and
   * dresses itself the same, once per change rather than once per frame.
   */
  private wear(film: FilmApi) {
    const p = film.palette();
    if (!p.time || p.time === this.wearing) {
      return;
    }
    this.wearing = p.time;
    const el = this.pageEl;
    if (!el) {
      return;
    }
    el.style.setProperty('--tf-paper', p.paper);
    el.style.setProperty('--tf-paper-a', rgba(p.paper, 0.94));
    el.style.setProperty('--tf-paper-b', rgba(p.paper, 0.76));
    el.style.setProperty('--tf-paper-c', rgba(p.paper, 0));
    el.style.setProperty('--tf-ink', p.ink);
    el.style.setProperty('--tf-ink2', p.ink2);
    el.style.setProperty('--tf-ink3', p.ink3);
    el.style.setProperty('--tf-accent', p.accent);
    el.style.setProperty('--tf-rule', p.rule);
  }

  /**
   * PLANES, MOVING AT THEIR OWN RATES.
   *
   * The world layer parallaxes because it is genuinely out in the scene at
   * different distances. The front layer has no depth to borrow, so it is
   * given one: over the life of a beat each row drifts and scales on its
   * own rate, the big glyph fastest and nearest, the small print slowest
   * and furthest, so the type reads as a set of planes rather than a
   * sheet. It is the oldest trick in motion graphics and it is here for
   * the oldest reason — a still caption over a moving picture looks
   * pasted on, and a caption that moves WITH the picture looks composited
   * into it.
   *
   * It runs on the beat's own clock rather than Motion's, deliberately:
   * the entrances belong to the score and this belongs to the shot, and
   * putting the two on one timeline would mean the drift restarting every
   * time a word did.
   */
  private parallax(local: number) {
    const rows = this.rowEls;
    if (!rows.length) {
      return;
    }
    /* ease the whole thing in so a cut does not start mid-drift */
    const t = smooth(Math.min(1, local * 1.15));
    for (const [i, el] of rows.entries()) {
      /* the glyph sits near the top of the block and should be the
         NEAREST plane, so depth runs down the block rather than up it */
      const depth = 1 - i / Math.max(1, rows.length - 1);
      const dx = -14 * depth * t;
      const dy = -9 * depth * t;
      const sc = 1 + 0.035 * depth * t;
      el.style.transform = `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0) scale(${sc.toFixed(4)})`;
    }
  }

  /**
   * Project a world polyline into the frame and stroke it, drawing it on
   * over the head of its beat. The dash pattern is the line's own measured
   * length, so the draw-on is a real pen travelling the real path rather
   * than a fade wearing a costume.
   */
  private traceShape(film: FilmApi, beat: Beat, local: number) {
    const specs = beat.trace ?? [];
    const host = this.frameEl?.getBoundingClientRect();
    const v = film.view();
    for (const [i, el] of this.traceEls.entries()) {
      const spec = specs[i];
      if (!spec || !host) {
        el.style.opacity = '0';
        continue;
      }
      const sx = host.width / v.w;
      const sy = host.height / v.h;
      let pts = '';
      let len = 0;
      let px = 0;
      let py = 0;
      let on = false;
      for (const [n, p] of spec.pts.entries()) {
        const q = film.project(p[0], p[1], p[2]);
        const x = q.x * sx;
        const y = q.y * sy;
        if (q.on) {
          on = true;
        }
        if (n > 0) {
          len += Math.hypot(x - px, y - py);
        }
        px = x;
        py = y;
        pts += `${x.toFixed(1)},${y.toFixed(1)} `;
      }
      if (!on) {
        el.style.opacity = '0';
        continue;
      }
      /* the beat's first fifth draws the line; after that it simply is */
      const draw = Math.min(1, Math.max(0, (local - 0.06) / 0.16));
      el.setAttribute('points', pts.trim());
      el.setAttribute('stroke-dasharray', String(len));
      el.setAttribute('stroke-dashoffset', String(len * (1 - draw)));
      el.setAttribute('stroke-width', spec.wide ? '2.6' : '1.4');
      el.style.opacity = draw > 0 ? '1' : '0';
    }
  }

  /**
   * THE TRACKING LINE — the one piece of the front layer that has to know
   * where the camera is pointing this frame. The caption stays where the
   * layout put it and a line reaches from it to the actual point on the
   * building, redrawn every frame, so the label is attached to the thing
   * rather than merely near it.
   */
  private trackPoint(film: FilmApi, beat: Beat, local: number) {
    const line = this.lineEl;
    const dot = this.dotEl;
    if (!line || !dot) {
      return;
    }
    if (!beat.to || !this.frameEl || !this.plateEl) {
      line.style.opacity = '0';
      dot.style.opacity = '0';
      return;
    }
    /* nothing is worth pointing at before it is built: the clip plane is
       the honest test, since the point may be above it for most of a beat */
    if (beat.to[1] > film.height() + 0.15) {
      line.style.opacity = '0';
      dot.style.opacity = '0';
      return;
    }
    const p = film.project(...beat.to);
    const v = film.view();
    const host = this.frameEl.getBoundingClientRect();
    const box = this.plateEl.getBoundingClientRect();
    /* the page renders at its own size; the frame may be laid out at another */
    const sx = host.width / v.w;
    const sy = host.height / v.h;
    const x2 = p.x * sx;
    const y2 = p.y * sy;
    /* leave from the edge of the caption that faces the point */
    const cx = box.left - host.left + box.width / 2;
    const cy = box.top - host.top + box.height / 2;
    const x1 = x2 > cx ? box.right - host.left : box.left - host.left;
    const y1 = cy;
    const on = p.on && local > 0.12 ? 1 : 0;
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    dot.setAttribute('cx', String(x2));
    dot.setAttribute('cy', String(y2));
    line.style.opacity = String(on * 0.75);
    dot.style.opacity = String(on);
  }

  /** everything a beat changes in the world, done once on entry */
  private applyBeat(beat: Beat, instant = false) {
    const film = this.film;
    if (!film) {
      return;
    }
    this.beatAt = performance.now();
    if (beat.cut) {
      this.snap(beat.cam);
      /* a hard cut needs a piece of punctuation or it reads as a dropped
         frame. One wipe, in the paper the whole film is printed on, raked
         to the same diagonal the sun throws — over in a fifth of a second,
         which is long enough to say "that was deliberate" and too short to
         be a transition anybody has to sit through. */
      this.cutStamp += 1;
    }
    if (beat.style !== undefined && film.styleIndex() !== beat.style) {
      film.style(beat.style);
      /* a new tower is built at t=0; this film always wants it finished
         unless the beat is explicitly running the construction */
      film.time(
        Array.isArray(beat.build) ? beat.build[0] : (beat.build ?? 4.4)
      );
    }
    if (typeof beat.build === 'number') {
      film.time(beat.build);
    } else if (Array.isArray(beat.build)) {
      film.time(beat.build[0]);
    }
    if (beat.theme !== undefined) {
      film.theme(beat.theme, instant);
    }
    if (beat.wx !== undefined) {
      film.wx(beat.wx, instant);
    }
  }

  private shot = (state: {
    dolly: number;
    look?: { x: number; y: number; z: number };
    pitch: number;
    x: number;
    y: number;
    yaw: number;
  }) => {
    this.goal = {
      dolly: state.dolly,
      lookY: state.look?.y ?? 0,
      ox: state.x,
      pitch: state.pitch,
      yaw: state.yaw,
    };
  };

  private dispatch = (command: PerformCommand) => {
    if (command.action === 'lap') {
      if (this.playing) {
        this.lap += 1;
        this.beatIndex = 0;
        this.applyBeat(this.beats[0]!);
      }
      return;
    }
    if (command.action === 'beat') {
      const i = Number(command.target);
      if (Number.isFinite(i) && this.beats[i]) {
        this.beatIndex = i;
        this.applyBeat(this.beats[i]!);
      }
    }
  };

  private toggle = () => {
    this.playing = !this.playing;
  };

  /**
   * SKIP A CHAPTER — by re-cutting, never by seeking.
   *
   * `from` moves to a chapter head, which changes the beat list, which
   * changes the path, the cues and the sequence's name all at once. The
   * region sees a different score and plays it from its head. Seeking the
   * existing run would be the obvious alternative and it would be wrong:
   * the lens is an integrator whose pose depends on where it has been, so
   * a run dropped into the middle of itself arrives with the wrong
   * velocity — the same reason `docs/sylva-one-world.md` calls the chaser
   * seek-unsafe and means it.
   */
  private goChapter = (delta: number) => {
    const heads = this.chapterHeads;
    const here = this.absoluteIndex;
    let i = heads.findIndex(
      (h, n) => here >= h && (heads[n + 1] ?? Infinity) > here
    );
    if (i < 0) {
      i = 0;
    }
    /* back, from more than a moment into a chapter, means this chapter's
       head — the behaviour every transport control in the world has */
    const restart = delta < 0 && here > heads[i]!;
    const next = restart
      ? i
      : Math.max(0, Math.min(heads.length - 1, i + delta));
    this.cutTo(heads[next]!);
  };

  private cutTo(index: number) {
    this.from = index;
    this.beatIndex = 0;
    this.playing = true;
    this.lap += 1;
    this.applyBeat(BEATS[index]!, true);
    this.snap(BEATS[index]!.cam);
  }

  private prev = () => this.goChapter(-1);
  private next = () => this.goChapter(1);

  private key = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.prev();
    } else if (e.key === ' ') {
      e.preventDefault();
      this.toggle();
    } else if (e.key === 'm' || e.key === 'M') {
      this.hear();
    } else if (e.key === 'c' || e.key === 'C' || e.key === 'Escape') {
      this.toc();
    }
  };

  /** the scene brought its own score — six of them, one per tower */
  private hear = () => {
    this.sound = !this.sound;
    this.film?.sound(this.sound);
  };

  private restart = () => {
    this.cutTo(0);
  };

  /** the chapter menu. The film keeps running behind it, blurred: a
   * menu that freezes the picture makes the picture feel like a file, and
   * this one is meant to feel like a broadcast you are stepping around in */
  @tracked private menu = false;

  private toc = () => {
    this.menu = !this.menu;
  };

  /** every chapter, with the beat it starts at and whether we are in it */
  get contents() {
    const here = this.absoluteIndex;
    return this.chapterHeads.map((head, i) => {
      const nextHead = this.chapterHeads[i + 1] ?? BEATS.length;
      const ch = CHAPTERS[BEATS[head]!.ch] ?? CHAPTERS[0]!;
      return {
        head,
        here: here >= head && here < nextHead,
        n: ch.n,
        shots: nextHead - head,
        title: ch.title,
        /* the chapter's own running time, from the beats it owns */
        secs:
          BEATS.slice(head, nextHead).reduce((t, b) => t + b.ticks, 0) * TICK,
      };
    });
  }

  private pick = (head: number) => {
    this.menu = false;
    this.cutTo(head);
  };

  <template>
    <div class="tf-page {{if this.embed 'is-embed'}}">
      <div class="tf-stage" {{this.mount}}>
        <iframe
          class="tf-frame"
          src={{this.src}}
          title="Towers"
          loading="eager"
        ></iframe>

        {{! A scrim, not a box. The scene is a bright ochre wash and the
        type is dark, which is the wrong way round for legibility — so
        each setting gets a soft directional lift under it. It reads as
        light falling off, not as a panel, which is the difference
        between a documentary and a slide. }}
        <div
          class="tf-scrim tf-scrim-{{this.beat.mode}}"
          aria-hidden="true"
        ></div>

        {{! THE CUT. A new element per cut, so the wipe plays from its own
        first frame every time rather than being re-triggered. }}
        {{#each (array this.cutStamp) key="@identity" as |c|}}
          {{#if c}}
            <i class="tf-wipe" aria-hidden="true"></i>
          {{/if}}
        {{/each}}

        {{! A VIGNETTE, which is a lens and not a decoration: the scene is
        an even wash corner to corner, and an even frame has no centre.
        It darkens at the same diagonal the sun throws, so the corner
        away from the light is the heavier one. }}
        <div class="tf-vig" aria-hidden="true"></div>

        {{! THE OVERLAY. The traces are polylines authored in the scene's
        own coordinates and projected every frame, so they lie ON the
        eave and the batter rather than near them; they draw themselves
        on at the head of a beat. Then the callout: a leader from the
        caption to a point on the building, and a ring on the point. }}
        <svg class="tf-track" aria-hidden="true" {{this.trackEls}}>
          <polyline class="tf-trace" points="" fill="none" />
          <polyline class="tf-trace" points="" fill="none" />
          <polyline class="tf-trace" points="" fill="none" />
          <polyline class="tf-trace" points="" fill="none" />
          <line class="tf-leader" x1="0" y1="0" x2="0" y2="0" />
          <circle cx="0" cy="0" r="7" />
        </svg>

        {{#if this.booted}}
          {{! THE FRONT LAYER. Keyed on the beat, so every hand-off replays
          the delivery: the kicker types in, the kanji lands centre-out on
          an overshoot, the reading and the gloss follow, and the sentence
          arrives word by word. A beat change drops the old type in one
          quick fall. All of it is score vocabulary. }}
          <Choreo class="tf-type tf-{{this.beat.mode}}" as |n|>
            {{#each (array this.beat) key="id" as |b|}}
              <div class="tf-block" {{this.plate}}>
                {{#if b.kicker}}
                  <p class="tf-kicker" {{motion id="kicker" role="kick"}}>
                    {{b.kicker}}
                  </p>
                {{/if}}
                {{#if b.kanji}}
                  <p class="tf-kanji" {{motion id="kanji" role="glyph"}}>
                    {{b.kanji}}
                  </p>
                {{/if}}
                <p class="tf-read" {{motion id="read" role="read"}}>
                  <span class="tf-romaji">{{b.romaji}}</span>
                  {{#if b.gloss}}
                    <span class="tf-gloss">{{b.gloss}}</span>
                  {{/if}}
                </p>
                {{#if b.line}}
                  <p
                    class="tf-line"
                    {{motion id="line" role="line"}}
                  >{{b.line}}</p>
                {{/if}}
              </div>
            {{/each}}

            <n.Parallel>
              <n.Tween
                @of={{array
                  (n.removed "kick")
                  (n.removed "glyph")
                  (n.removed "read")
                  (n.removed "line")
                }}
                @opacity={{array 1 0}}
                @y={{array 0 -14}}
                @duration={{0.2}}
                @ease="easeIn"
              />
              <n.Tween
                @of={{n.inserted "kick"}}
                @by="character"
                @stagger={{0.014}}
                @opacity={{array 0 1}}
                @duration={{0.28}}
                @ease="easeOut"
              />
              {{! the term itself gets the overshoot: characters out of the
              centre, up and settling, which is the one moment per beat
              the type is allowed to perform }}
              <n.Tween
                @of={{n.inserted "glyph"}}
                @by="character"
                @order="center"
                @stagger={{0.06}}
                @delay={{0.14}}
                @y={{array 34 0}}
                @scale={{array 1.28 1}}
                @opacity={{array 0 1}}
                @duration={{0.72}}
                @ease={{array 0.24 1.42 0.4 1}}
              />
              <n.Tween
                @of={{n.inserted "read"}}
                @by="word"
                @stagger={{0.05}}
                @delay={{0.42}}
                @y={{array 10 0}}
                @opacity={{array 0 1}}
                @duration={{0.5}}
                @ease={{array 0.22 1 0.36 1}}
              />
              <n.Tween
                @of={{n.inserted "line"}}
                @by="word"
                @stagger={{0.028}}
                @delay={{0.6}}
                @y={{array 12 0}}
                @opacity={{array 0 1}}
                @filter={{array "blur(5px)" "blur(0px)"}}
                @duration={{0.62}}
                @ease={{array 0.22 1 0.36 1}}
              />
            </n.Parallel>
          </Choreo>

          {{! the chapter rail: where we are in the argument }}
          <div class="tf-rail" aria-hidden="true">
            <span class="tf-rail-n">{{this.chapter.n}}</span>
            <span class="tf-rail-t">{{this.chapter.title}}</span>
            <span class="tf-rail-bar"><i style={{this.railStyle}}></i></span>
          </div>
        {{/if}}

        {{! THE SCORE. One camera step for the whole film, and one clipped
        cue per beat — so the shot list and the script are the same
        object, and the film is a pure function of one clock.

        It waits for the scene, and not only out of politeness. A region
        collects its score from the CHANGE between two render passes, so
        a rig that has been on screen since the component's first pass was
        never inserted into anything and the camera step resolves to no
        subject at all — the run compiles, emits one pose and ends. Mounted
        behind the boot flag the rig is a genuine insertion, which is also
        the moment the film should begin. }}
        {{#if this.booted}}
          <Choreo @onCamera3D={{this.shot}} @onPerform={{this.dispatch}} as |c|>
            <i class="tf-rig" {{motion id="rig"}} aria-hidden="true"></i>
            {{#if this.playing}}
              <c.Sequence @name={{this.filmName}}>
                <c.Camera3D
                  @name="film"
                  @through={{this.path}}
                  @duration={{this.filmSeconds}}
                  @ease="linear"
                  @tension={{0.55}}
                />
                {{#each this.cues as |cue|}}
                  <c.Perform
                    @at={{at "film"}}
                    @delay={{cue.delay}}
                    @action="beat"
                    @target={{cue.index}}
                  />
                {{/each}}
                <c.Perform @action="lap" />
              </c.Sequence>
            {{/if}}
          </Choreo>
        {{/if}}
      </div>

      {{#unless this.embed}}
        {{! THE DISC MENU. A film with chapters owes the viewer a way into
        them, and the arrow keys alone are a secret. Picking one re-cuts
        the score from that chapter's head — the same move the arrows
        make, because a skip here is an edit and never a seek. }}
        {{#if this.menu}}
          <Choreo class="tf-menu" as |m|>
            <div class="tf-menu-in" {{motion id="menu" role="sheet"}}>
              <p class="tf-menu-head">TOWERS</p>
              <p class="tf-menu-sub">A construction study · chapters</p>
              <ol class="tf-menu-list">
                {{#each this.contents as |c|}}
                  <li>
                    <button
                      type="button"
                      class="tf-menu-item {{if c.here 'is-here'}}"
                      {{on "click" (fn this.pick c.head)}}
                    >
                      <span class="tf-menu-n">{{c.n}}</span>
                      <span class="tf-menu-t">{{c.title}}</span>
                      <span class="tf-menu-d">{{c.shots}} shots</span>
                    </button>
                  </li>
                {{/each}}
              </ol>
              <p class="tf-menu-keys">← → chapter · space play · M sound · C
                close</p>
            </div>
            <m.Tween
              @of={{m.inserted "sheet"}}
              @y={{array 26 0}}
              @scale={{array 0.97 1}}
              @opacity={{array 0 1}}
              @duration={{0.42}}
              @ease={{array 0.22 1 0.36 1}}
            />
            <m.Tween
              @of={{m.removed "sheet"}}
              @y={{array 0 18}}
              @opacity={{array 1 0}}
              @duration={{0.2}}
              @ease="easeIn"
            />
          </Choreo>
        {{/if}}

        <div class="tf-controls">
          <button
            type="button"
            class="tf-btn tf-icon"
            title="previous chapter"
            {{on "click" this.prev}}
          >←</button>
          <button
            type="button"
            class="tf-btn {{if this.playing 'is-on'}}"
            {{on "click" this.toggle}}
          >{{if this.playing "❙❙ playing" "▶ play"}}</button>
          <button
            type="button"
            class="tf-btn tf-icon"
            title="next chapter"
            {{on "click" this.next}}
          >→</button>
          <button
            type="button"
            class="tf-btn {{if this.menu 'is-on'}}"
            {{on "click" this.toc}}
          >☰ chapters</button>
          <button
            type="button"
            class="tf-btn {{if this.sound 'is-on'}}"
            {{on "click" this.hear}}
          >{{if this.sound "♪ sound" "♪ muted"}}</button>
          <button type="button" class="tf-btn" {{on "click" this.restart}}>↺
            from the top</button>
          <span class="tf-credit">Scene:
            <a
              href="https://threeui.com/browse"
              target="_blank"
              rel="noopener"
            >threeui</a>
            by
            <a href="https://x.com/MengTo" target="_blank" rel="noopener">Meng
              To</a></span>
        </div>
      {{/unless}}
    </div>

    <style>
      .tf-page {
        /* the film's ink, replaced per chapter from the scene's own
           time-of-day palette by `wear` — these are the morning values,
           which is also what the page opens on. `--tf-shx/y` is the cast
           shadow's offset, written every frame from where the scene's key
           light actually is (see `follow`). */
        --tf-paper: #ecdcbc;
        --tf-paper-a: rgba(236, 220, 188, 0.94);
        --tf-paper-b: rgba(236, 220, 188, 0.76);
        --tf-paper-c: rgba(236, 220, 188, 0);
        --tf-ink: #2e2515;
        --tf-ink2: #8b7c5c;
        --tf-ink3: #3f3520;
        --tf-accent: #a8621f;
        --tf-rule: #c2b18c;
        --tf-shx: 2px;
        --tf-shy: 2px;
        --tf-rake: 35deg;

        position: fixed;
        inset: 0;
        background: var(--tf-paper);
        display: flex;
        flex-direction: column;
        transition: background 900ms ease;
      }

      .tf-stage {
        position: relative;
        flex: 1;
        overflow: hidden;
      }

      .tf-frame {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
      }

      .tf-wipe {
        position: absolute;
        inset: -30%;
        z-index: 5;
        pointer-events: none;
        background: linear-gradient(
          100deg,
          transparent 0%,
          var(--tf-paper) 34%,
          var(--tf-paper) 66%,
          transparent 100%
        );
        transform: translateX(-140%) rotate(calc(var(--tf-rake) * 0.16));
        animation: tf-wipe 340ms cubic-bezier(0.5, 0, 0.3, 1) forwards;
      }

      @keyframes tf-wipe {
        to {
          transform: translateX(140%) rotate(calc(var(--tf-rake) * 0.16));
        }
      }

      /* ---- the lens ------------------------------------------------- */
      .tf-vig {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background: radial-gradient(
          82% 74% at 50% 46%,
          transparent 0%,
          transparent 52%,
          rgba(48, 38, 18, 0.1) 78%,
          rgba(40, 31, 14, 0.26) 100%
        );
      }

      /* ---- scrims: anchored to the caption, never banded across the
         frame. A band wide enough to carry a lower third also washes out
         whatever is standing in the middle of the shot — which on this
         route is the building. ------------------------------------------ */
      .tf-scrim {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        transition: background 700ms ease;
      }

      .tf-scrim-lower {
        background: radial-gradient(
          128% 82% at 0% 112%,
          var(--tf-paper-a) 0%,
          var(--tf-paper-b) 36%,
          var(--tf-paper-c) 72%
        );
      }

      .tf-scrim-title {
        background: radial-gradient(
          112% 108% at 112% 116%,
          var(--tf-paper-a) 0%,
          var(--tf-paper-b) 34%,
          var(--tf-paper-c) 70%
        );
      }

      .tf-scrim-plate {
        background: radial-gradient(
          84% 104% at 110% 50%,
          var(--tf-paper-a) 0%,
          var(--tf-paper-b) 34%,
          var(--tf-paper-c) 72%
        );
      }

      .tf-scrim-point {
        background: radial-gradient(
          88% 92% at -10% 26%,
          var(--tf-paper-a) 0%,
          var(--tf-paper-b) 38%,
          var(--tf-paper-c) 74%
        );
      }

      /* ---- traces and callouts -------------------------------------- */
      .tf-track {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2;
      }

      .tf-trace {
        stroke: var(--tf-accent);
        stroke-linecap: round;
        stroke-linejoin: round;
        opacity: 0;
        filter: drop-shadow(
          var(--tf-shx) var(--tf-shy) 0 rgba(52, 40, 16, 0.28)
        );
        transition: opacity 260ms ease;
      }

      .tf-leader {
        stroke: var(--tf-ink3);
        stroke-width: 1.5;
        stroke-dasharray: 5 4;
        opacity: 0;
        transition: opacity 400ms ease;
      }

      .tf-track circle {
        fill: none;
        stroke: var(--tf-accent);
        stroke-width: 2.2;
        opacity: 0;
        transition: opacity 400ms ease;
      }

      /* ---- the front layer ------------------------------------------ */
      .tf-type {
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
        color: var(--tf-ink);
        font-family: "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;
        text-shadow: var(--tf-shx) var(--tf-shy) 0 rgba(52, 40, 16, 0.22);
      }

      .tf-block {
        position: absolute;
        max-width: min(40ch, 44vw);
      }

      /* a kicker rides a rule that draws itself out of the type — the
         diagonal is the sun's, so the graphic furniture rakes the same
         way the shadows do */
      .tf-kicker {
        font-size: clamp(12px, 1vw, 15px);
        font-weight: 800;
        letter-spacing: 0.3em;
        color: var(--tf-ink3);
        margin: 0 0 14px;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .tf-kicker::after {
        content: "";
        flex: 1;
        height: 2px;
        background: var(--tf-accent);
        transform: skewX(calc(var(--tf-rake) * -0.22));
        transform-origin: left center;
      }

      .tf-point .tf-kicker::after,
      .tf-lower .tf-kicker::after {
        max-width: 120px;
      }

      .tf-kanji {
        font-family:
          "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP",
          "Songti SC", serif;
        font-size: clamp(56px, 8.4vw, 132px);
        line-height: 0.94;
        letter-spacing: 0.04em;
        margin: 0 0 18px;
      }

      .tf-read {
        margin: 0 0 20px;
        display: flex;
        gap: 16px;
        align-items: baseline;
        flex-wrap: wrap;
      }

      .tf-romaji {
        font-size: clamp(13px, 1.15vw, 17px);
        font-weight: 800;
        letter-spacing: 0.26em;
      }

      .tf-gloss {
        font-size: clamp(12px, 1vw, 15px);
        letter-spacing: 0.05em;
        color: var(--tf-ink3);
        font-style: italic;
      }

      .tf-line {
        margin: 0;
        font-size: clamp(15px, 1.4vw, 21px);
        line-height: 1.55;
        color: var(--tf-ink3);
        max-width: 34ch;
      }

      /* the four ways a beat is set. A title is ranged right against the
         frame's edge with the tower in the other half; a lower third sits
         bottom-left; a plate is a slab in the right third; a point is a
         caption with a leader running out of it. */
      .tf-title .tf-block {
        right: 6%;
        bottom: 15%;
        text-align: right;
        max-width: min(40ch, 46vw);
      }

      .tf-title .tf-read {
        justify-content: flex-end;
      }

      .tf-title .tf-kicker {
        flex-direction: row-reverse;
      }

      .tf-title .tf-line {
        margin-left: auto;
      }

      .tf-title .tf-kanji {
        font-size: clamp(72px, 11vw, 190px);
      }

      .tf-lower .tf-block {
        left: 5.5%;
        bottom: 11%;
      }

      .tf-plate .tf-block {
        right: 5.5%;
        top: 50%;
        transform: translateY(-50%);
      }

      .tf-point .tf-block {
        left: 5.5%;
        top: 18%;
        max-width: min(30ch, 34vw);
      }

      .tf-point .tf-kanji {
        font-size: clamp(48px, 6.6vw, 104px);
      }

      /* ---- the rail -------------------------------------------------- */
      .tf-rail {
        position: absolute;
        left: 5.5%;
        top: 6%;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 14px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.28em;
        color: var(--tf-ink3);
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        text-shadow: var(--tf-shx) var(--tf-shy) 0 rgba(52, 40, 16, 0.18);
      }

      .tf-rail-n {
        font-size: 22px;
        letter-spacing: 0.08em;
        color: var(--tf-accent);
      }

      .tf-rail-bar {
        display: block;
        width: 132px;
        height: 2px;
        background: var(--tf-rule);
      }

      .tf-rail-bar i {
        display: block;
        height: 2px;
        background: var(--tf-accent);
        transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      .tf-rig {
        position: absolute;
        width: 0;
        height: 0;
      }

      /* ---- the disc menu --------------------------------------------- */
      .tf-menu {
        position: absolute;
        inset: 0;
        z-index: 6;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(28, 22, 10, 0.44);
        backdrop-filter: blur(3px);
      }

      .tf-menu-in {
        background: var(--tf-paper);
        border: 1px solid var(--tf-rule);
        padding: 34px 40px 26px;
        min-width: min(460px, 84vw);
        box-shadow: 0 30px 70px rgba(30, 22, 8, 0.34);
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      .tf-menu-head {
        margin: 0;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.42em;
        color: var(--tf-ink);
      }

      .tf-menu-sub {
        margin: 4px 0 22px;
        font-size: 12px;
        color: var(--tf-ink2);
        letter-spacing: 0.06em;
      }

      .tf-menu-list {
        list-style: none;
        margin: 0 0 18px;
        padding: 0;
      }

      .tf-menu-item {
        appearance: none;
        background: transparent;
        border: 0;
        border-top: 1px solid var(--tf-rule);
        width: 100%;
        display: flex;
        align-items: baseline;
        gap: 16px;
        padding: 13px 4px;
        font: inherit;
        color: var(--tf-ink);
        cursor: pointer;
        text-align: left;
      }

      .tf-menu-item:hover {
        color: var(--tf-accent);
      }

      .tf-menu-item.is-here {
        color: var(--tf-accent);
        font-weight: 700;
      }

      .tf-menu-n {
        font-size: 12px;
        letter-spacing: 0.16em;
        color: var(--tf-accent);
        min-width: 2.4em;
      }

      .tf-menu-t {
        font-size: 17px;
        letter-spacing: 0.16em;
        flex: 1;
      }

      .tf-menu-d {
        font-size: 11px;
        letter-spacing: 0.1em;
        color: var(--tf-ink2);
      }

      .tf-menu-keys {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.1em;
        color: var(--tf-ink2);
      }

      /* ---- controls -------------------------------------------------- */
      .tf-controls {
        flex: none;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 5.5%;
        background: #e3d2ae;
        border-top: 1px solid #cbb992;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-size: 11px;
        letter-spacing: 0.14em;
      }

      .tf-btn {
        appearance: none;
        border: 1px solid #c2b18c;
        background: transparent;
        color: #3f3520;
        padding: 6px 12px;
        border-radius: 999px;
        font: inherit;
        cursor: pointer;
      }

      .tf-icon {
        padding: 6px 11px;
        font-size: 13px;
        line-height: 1;
      }

      .tf-btn.is-on {
        background: #332a17;
        color: #f6eed8;
        border-color: #332a17;
      }

      .tf-credit {
        margin-left: auto;
        color: #8b7c5c;
      }

      .tf-credit a {
        color: #96551b;
      }

      .is-embed .tf-controls {
        display: none;
      }

      /* the app's own chrome, gone: this route is a frame, not a page */
      body.tf-film .topbar,
      body.tf-film .footer {
        display: none;
      }
    </style>
  </template>
}
