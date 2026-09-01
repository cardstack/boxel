import { array, concat, fn } from '@ember/helper';
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
  /** which of the six towers stands here; overrides the chapter's grade */
  grade?: string;
  /** how thick the air is, 0 the hour's own and 1 as heavy as it goes */
  haze?: number;
  id: string;
  /** the key term, in Japanese */
  kanji?: string;
  /** the eyebrow — where we are in the argument */
  kicker?: string;
  /**
   * A LABEL THAT STANDS IN THE SCENE, not on the screen.
   *
   * The stage names belong to heights on the building, so they are placed
   * at those heights, out in the world, at a fixed bearing — and they RISE
   * to them as the stage is built, overshooting slightly and settling the
   * way a thing with mass does. Because the bearing is fixed and the
   * camera is orbiting, the mark crosses the frame on its own; it is
   * correlated with the shot without being carried by it, which is the
   * whole difference between a label in a scene and a label on a screen.
   *
   * Its facing LAGS the camera rather than tracking it: a hard billboard
   * is glued to the lens and reads as an overlay, and a fixed plane goes
   * edge-on and disappears. A damped follow does neither.
   */
  mark?: {
    /** degrees round the orbit, fixed in the world */
    bearing: number;
    lines: string[];
    /** distance from the tower's axis */
    r: number;
    /** world units tall */
    size: number;
    /** the height it climbs to */
    to: number;
  };
  /** how the front layer is set */
  mode: 'lower' | 'plate' | 'point' | 'title';
  /**
   * A PHOTOGRAPH, cut in beside the model.
   *
   * The model is a model, and there is a limit to what a film can claim
   * with one. A real keep at the moment the commentary names it — Himeji's
   * white walls, the bare hill at Azuchi — settles the claim in a way no
   * amount of procedural geometry can, which is why every architecture
   * documentary ever made cuts to a photograph.
   *
   * `src` is resolved under `public/towers/`. A missing file removes the
   * plate rather than showing a broken frame, so the film is honest with
   * an empty folder and richer with a full one.
   */
  photo?: { caption: string; credit: string; src: string };
  /** its reading */
  romaji?: string;
  /**
   * WHAT IS ACTUALLY ON SCREEN: a few short phrases, delivered one after
   * another across the beat rather than all at once. Kinetic type, not a
   * paragraph — each lands on its own delay, and four is the ceiling
   * because a fifth is a slide.
   */
  says?: string[];
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
  /**
   * WHERE THE SUN IS FOR THIS SHOT, degrees — bearing and height above the
   * horizon. The page models the sun as a property of the hour, which is
   * right for a landing page and too coarse for a film: a shot wants its
   * own raking light without changing what time it is. Omit and the hour
   * keeps it.
   */
  sun?: { az: number; el: number };
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
  /**
   * THE VOICE-OVER, and it is not drawn.
   *
   * A block of prose on screen is a thing the viewer has to read while
   * also watching, and it loses both ways: too slow to be a caption, too
   * fast to be a page. This film is narrated, so the sentence belongs to
   * the voice and the screen gets `says` instead. The text stays here
   * because it IS the script — the thing the voice is reading — and a
   * film whose narration lives in a different file from its shot list is
   * a film that will drift out of sync with itself.
   */
  vo?: string;
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

/**
 * THE GRADE — a colourist's pass over the picture, per chapter.
 *
 * The scene lights itself beautifully and evenly, and evenly is the
 * problem: five chapters that argue different things all come out the
 * same temperature, so nothing about the picture tells you the film has
 * moved on. A grade is how film has always solved this. Each one is a
 * filter on the picture plus a split tone over it — warmth pushed into
 * the highlights, coolness into the shadows, at the strength a mood
 * wants — and the whole thing crossfades over a second and a half, so a
 * chapter change is felt before it is read.
 *
 * It grades the PICTURE only. The type sits above it, ungraded, the way
 * titles sit above a graded plate on any finished film.
 */
const CHAPTERS = [
  { grade: 'amber', n: '01', title: 'CONTEXT' },
  { grade: 'iron', n: '02', title: 'HISTORY' },
  { grade: 'chalk', n: '03', title: 'CONSTRUCTION' },
  { grade: 'ink', n: '04', title: 'DETAIL' },
  { grade: 'plate', n: '05', title: 'COMPARISON' },
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
    says: [
      'Sixteenth-century Japan',
      'Stone, timber, tile',
      'And a roof you can see for miles',
    ],
    kanji: '天守',
    kicker: 'A CONSTRUCTION STUDY',
    vo: "Tenshu. You know the shape. Almost nobody knows what is holding it up. So let us take one apart.",
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
    ticks: 5,
    toCam: { dolly: 0.64, lookY: -1.0, ox: 0.2, pitch: 13, yaw: -26 },
  },
  {
    cam: { dolly: 0.58, lookY: 2.2, ox: -0.1, pitch: 18, yaw: -18 },
    ch: 0,
    gloss: 'castle',
    id: 'shiro',
    says: ['Not the tower.', 'The ground.', 'Ditches, banks, terraces.'],
    kanji: '城',
    kicker: 'WHAT A CASTLE IS',
    vo: 'The castle is not the tower. The castle is the ground. Ditches, banks, a hill cut into shelves.',
    mode: 'lower',
    romaji: 'SHIRO',
    ticks: 5,
    toCam: { dolly: 0.6, lookY: 2.0, ox: -0.1, pitch: 15, yaw: -6 },
  },
  {
    cam: { dolly: 0.72, lookY: 1.0, ox: 0.16, pitch: 8, yaw: 2 },
    ch: 0,
    gloss: 'keep · watchtower',
    id: 'what',
    says: ['A lookout.', 'A strongroom.', 'An argument.'],
    kanji: '天守閣',
    kicker: 'ONE BUILDING, THREE JOBS',
    vo: 'A lookout. A strongroom. An advert. You can guess which one got the money.',
    mode: 'plate',
    romaji: 'TENSHUKAKU',
    ticks: 4,
  },

  /* ---------------------------------------------------------------- *
   * 02 — HISTORY: where the form comes from, and why it stopped
   * ---------------------------------------------------------------- */
  {
    cam: { dolly: 0.9, lookY: 1.4, ox: 0.14, pitch: 6, yaw: 18 },
    ch: 1,
    gloss: 'Azuchi, 1576',
    id: 'azuchi',
    says: ['1576', 'Seven storeys. Gilded.', 'Gone in six years.'],
    kanji: '安土城',
    kicker: 'THE FIRST OF ITS KIND',
    vo: 'Fifteen seventy-six. Seven gilded storeys over Lake Biwa. It burned in six years. Everything after it is a reply.',
    mode: 'plate',
    photo: {
      caption: 'Azuchi, Shiga — the keep’s stone platform',
      credit: 'photograph',
      src: 'azuchi.webp',
    },
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
    ticks: 5,
  },
  {
    cam: { dolly: 1.15, lookY: -2.6, ox: -0.1, pitch: 1, yaw: 34 },
    ch: 1,
    gloss: 'the matchlock gun',
    id: 'teppo',
    says: [
      '1543 — the gun lands',
      'Walls get lower, thicker',
      'Height becomes address',
    ],
    kanji: '鉄砲',
    kicker: 'WHY THE SHAPE CHANGED',
    vo: 'Then the guns arrive. Walls get lower, thicker, stonier. Height stops being armour and turns into an address.',
    mode: 'lower',
    romaji: 'TEPPŌ',
    ticks: 5,
    toCam: { dolly: 1.05, lookY: -1.4, ox: -0.1, pitch: 4, yaw: 44 },
  },
  {
    cam: { dolly: 0.74, lookY: 1.8, ox: 0.16, pitch: 13, yaw: 56 },
    ch: 1,
    gloss: 'one domain, one castle',
    id: 'ikkoku',
    says: ['1615', 'One castle per province', 'Twelve keeps survive'],
    kanji: '一国一城令',
    kicker: 'AND WHY IT STOPPED',
    vo: 'Sixteen fifteen. One castle per province. The rest come down. Twelve original keeps are still standing.',
    mode: 'plate',
    photo: {
      caption: 'Himeji Castle, Hyōgo — one of the twelve originals',
      credit: 'photograph',
      src: 'himeji.webp',
    },
    romaji: 'IKKOKU-ICHIJŌ-REI',
    theme: 3,
    ticks: 5,
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
    haze: 0.42,
    id: 'ishigaki',
    says: [
      'No mortar. None.',
      '扇の勾配 — the fan’s incline',
      'The wall sheds the shock',
    ],
    kanji: '石垣',
    kicker: 'STAGE ONE',
    vo: "Ishigaki. Dry stone, no mortar, stacked into a curve. A straight wall argues with an earthquake. This one passes it into the hill.",
    mark: {
      bearing: 104,
      lines: ['石垣'],
      r: 5,
      size: 1.5,
      to: 3.3,
    },
    mode: 'lower',
    photo: {
      caption: 'Dry-laid ishigaki, Kumamoto',
      credit: 'photograph',
      src: 'ishigaki.webp',
    },
    romaji: 'ISHIGAKI',
    sun: { az: -70, el: 12 },
    theme: 0,
    ticks: 7,
    to: [2.8, 1.6, 0.6],
    toCam: { dolly: 1.12, lookY: -3.2, ox: -0.12, pitch: 1, yaw: 84 },
  },
  {
    build: [1.07, 1.92],
    cam: { dolly: 1.05, lookY: -2.2, ox: -0.12, pitch: 2, yaw: 90 },
    ch: 2,
    gloss: 'post and beam',
    haze: 0.2,
    id: 'timber',
    says: ['A timber cage', 'Posts stand ON stone', 'The joints do the work'],
    kanji: '柱梁',
    kicker: 'STAGE TWO',
    vo: "Chūryō. Above the stone, a timber cage. Posts sit on footing stones, not in the ground. Nothing is bolted. The joints do the work.",
    mark: {
      bearing: 122,
      lines: ['柱梁'],
      r: 5,
      size: 1.5,
      to: 6.2,
    },
    mode: 'lower',
    romaji: 'CHŪRYŌ',
    sun: { az: -30, el: 62 },
    ticks: 7,
    toCam: { dolly: 1.0, lookY: -0.9, ox: -0.12, pitch: 4, yaw: 102 },
  },
  {
    build: [1.92, 2.79],
    cam: { dolly: 1.02, lookY: -0.4, ox: -0.12, pitch: 5, yaw: 108 },
    ch: 2,
    gloss: 'the white wall',
    id: 'plaster',
    says: [
      'Lime over bamboo lath',
      '塗籠 — wrapped up',
      'White because white will not burn',
    ],
    kanji: '白壁',
    kicker: 'STAGE THREE',
    vo: "Shirakabe. Lime plaster, thick enough to be armour. White, because white does not burn.",
    mark: {
      bearing: 139,
      lines: ['白壁'],
      r: 5,
      size: 1.5,
      to: 8.8,
    },
    mode: 'lower',
    romaji: 'SHIRAKABE',
    sun: { az: -8, el: 78 },
    ticks: 4,
    toCam: { dolly: 1.0, lookY: 0.8, ox: -0.12, pitch: 7, yaw: 118 },
  },
  {
    build: [2.79, 3.64],
    cam: { dolly: 1.0, lookY: 2.0, ox: -0.12, pitch: 10, yaw: 124 },
    ch: 2,
    gloss: 'the watch storey',
    id: 'boro',
    says: ['A room to see from', 'The reason for all the rest'],
    kanji: '望楼',
    kicker: 'STAGE FOUR',
    vo: "Bōrō. At the top, one room you can see out of. Everything below it is how you get that room into the air.",
    mark: {
      bearing: 154,
      lines: ['望楼'],
      r: 5,
      size: 1.5,
      to: 11.2,
    },
    mode: 'lower',
    romaji: 'BŌRŌ',
    ticks: 5,
    toCam: { dolly: 0.94, lookY: 2.8, ox: -0.12, pitch: 13, yaw: 133 },
  },
  {
    build: [3.64, 4.4],
    cam: { dolly: 0.88, lookY: 3.0, ox: -0.12, pitch: 15, yaw: 138 },
    ch: 2,
    gloss: 'the clay tile',
    id: 'kawara',
    says: [
      'Hung, not nailed',
      'The heaviest thing here',
      'And that weight is what steadies it',
    ],
    kicker: 'STAGE FIVE',
    kanji: '瓦',
    vo: "Kawara. Fired clay, hung, never nailed. The heaviest thing in the building, and that weight is what holds it still. The roof is ballast.",
    mark: {
      bearing: 169,
      lines: ['瓦'],
      r: 5,
      size: 1.5,
      to: 13.5,
    },
    mode: 'lower',
    romaji: 'KAWARA',
    theme: 1,
    ticks: 6,
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
    says: ['One building.', 'One moment.', 'Only the lens moves.'],
    kanji: '細部',
    kicker: 'LOOK CLOSER',
    toCam: { dolly: 0.84, lookY: 1.5, ox: 0.18, pitch: 14, yaw: 158 },
    vo: 'Same building. Same afternoon. From here, only the lens moves.',
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
    haze: 0.34,
    id: 'shachi',
    says: [
      'Tiger’s head, fish’s body',
      'Bronze, at both ends of the ridge',
      'A charm against fire',
    ],
    kanji: '鯱',
    kicker: 'ON THE RIDGE',
    toCam: { dolly: 4.35, lookY: 6.85, ox: -0.18, pitch: 7, yaw: 164 },
    vo: "Shachihoko. Tiger's head, fish's body, cast in bronze. It swallows water and spits it on the roof. That was the fire plan.",
    mode: 'point',
    photo: {
      caption: 'Shachihoko, Nagoya Castle',
      credit: 'photograph',
      src: 'shachihoko.webp',
    },
    romaji: 'SHACHIHOKO',
    sun: { az: 120, el: 26 },
    ticks: 6,
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
    says: [
      'A dormer named for a plover',
      'Light and air into a deep floor',
      'And a place to look down from',
    ],
    kanji: '千鳥破風',
    kicker: 'IN THE ROOF SLOPE',
    toCam: { dolly: 3.7, lookY: -1.2, ox: -0.18, pitch: 4, yaw: 174 },
    vo: "Chidori-hafu. Named after a plover. Light and air for a deep floor. Also somewhere to stand and look down at you.",
    mode: 'point',
    romaji: 'CHIDORI-HAFU',
    ticks: 6,
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
    says: [
      'A rail on a ledge',
      'Too narrow to walk',
      'Meant to be seen, not used',
    ],
    kanji: '高欄',
    kicker: 'AROUND THE TOP',
    toCam: { dolly: 4.0, lookY: 4.3, ox: -0.18, pitch: 8, yaw: 184 },
    vo: "Kōran. A rail on a ledge too narrow to walk. Built to be seen, not used.",
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
    haze: 0.3,
    id: 'ishi2',
    says: [
      'Vertical at the top',
      'Flaring at the foot',
      'The shock runs into the hill',
    ],
    kanji: '扇の勾配',
    kicker: 'AT THE FOOT',
    toCam: { dolly: 3.2, lookY: -5.0, ox: -0.18, pitch: 2, yaw: 192 },
    vo: 'Vertical at the top. Flaring at the foot. The shock does not stop at this wall. It runs into the hill.',
    mode: 'point',
    romaji: 'ŌGI-NO-KŌBAI',
    sun: { az: 250, el: 9 },
    ticks: 5,
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
    haze: 0.55,
    id: 'noki',
    says: [
      'A metre of overhang',
      'It keeps water off the wall',
      'Style is drainage, first',
    ],
    kanji: '軒',
    kicker: 'AND THE REASON FOR ALL OF IT',
    vo: "Noki. A metre of overhang. Every line you have admired is a way of keeping rain off earth and wood. Wait for weather; the styling explains itself.",
    mode: 'lower',
    romaji: 'NOKI',
    ticks: 6,
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
    haze: 0.12,
    id: 'hikaku',
    says: ['Six towers', 'One problem', 'Height, from what you have'],
    kanji: '比較',
    kicker: 'ONE PROBLEM',
    vo: 'Six towers. Same lens, same distance. One question. Height, out of whatever you have.',
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
    sun: { az: -35, el: 58 },
    ticks: 4,
    wx: 0,
  },
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: -0.1, pitch: 10, yaw: 212 },
    ch: 4,
    gloss: 'Japan · the keep',
    id: 'c-jp',
    says: ['Timber frame, stone skirt', 'Height by stacking roofs'],
    kanji: '天守',
    kicker: 'JAPAN',
    vo: 'Japan. A timber frame in a stone skirt. Height by stacking roofs.',
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
    says: ['斗栱 — bracket sets', 'Eaves far past the wall'],
    kanji: '寶塔',
    kicker: 'CHINA',
    vo: 'China. Tiers round a core, brackets stepping the eaves past the wall. The same timber thinking, pointed up.',
    mode: 'lower',
    romaji: 'BǍOTǍ',
    style: 1,
    ticks: 5,
  },
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: -0.1, pitch: 10, yaw: 226 },
    ch: 4,
    gloss: 'Vietnam · the tower',
    id: 'c-vn',
    says: ['A masonry body', 'A reliquary, not a lookout'],
    kanji: '佛塔',
    kicker: 'VIETNAM',
    vo: 'Vietnam. A masonry body, thin tiled eaves. You are not meant to climb it. A reliquary that reads as a tower.',
    mode: 'lower',
    romaji: 'THÁP',
    style: 2,
    ticks: 5,
  },
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: -0.1, pitch: 10, yaw: 233 },
    ch: 4,
    gloss: 'Thailand · the prang',
    id: 'c-th',
    says: ['Tapering the whole way', 'The shape is a mountain'],
    kanji: 'ปรางค์',
    kicker: 'THAILAND',
    vo: 'Thailand. Tapering the whole way up. That shape is not ambition. It is a mountain.',
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
    says: ['Corbelled, never arched', 'So it must narrow to close'],
    kanji: 'ប្រាសាទ',
    kicker: 'CAMBODIA',
    vo: 'Cambodia. Corbelled stone, never arched. With no arch, the only way to close a tower is to keep narrowing it.',
    mode: 'lower',
    romaji: 'PRASAT',
    style: 4,
    ticks: 5,
  },
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: -0.1, pitch: 10, yaw: 247 },
    ch: 4,
    gloss: 'Türkiye · the mosque',
    id: 'c-tr',
    says: [
      'Mass in compression',
      'A dome on an octagon',
      'The height goes to the minaret',
    ],
    kanji: 'CAMİ',
    kicker: 'TÜRKIYE',
    vo: 'Türkiye answers backwards. Mass in compression, a dome on an octagon, and the height handed to a minaret.',
    mode: 'lower',
    romaji: 'CAMİ',
    style: 5,
    ticks: 5,
  },

  /* ---------------------------------------------------------------- *
   * CODA
   * ---------------------------------------------------------------- */
  {
    cam: { dolly: 0.62, lookY: -0.6, ox: 0.2, pitch: 14, yaw: 256 },
    ch: 4,
    id: 'coda',
    says: ['Six materials', 'One problem', '天守'],
    kanji: '天守',
    vo: 'Six materials. One problem. Six answers. Not a fortress that happens to be beautiful. A roof, built tall enough to be seen from the fields.',
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
    ticks: 7,
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

/** perceptual luminance of a hex colour, 0 black to 1 white */
const luminance = (hex: string): number => {
  const h = hex.trim().replace('#', '');
  if (h.length !== 6) {
    return 1;
  }
  const n = parseInt(h, 16);
  return (
    (0.2126 * ((n >> 16) & 255) +
      0.7152 * ((n >> 8) & 255) +
      0.0722 * (n & 255)) /
    255
  );
};

const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/** what the vendored page publishes — see the HOST FILM BRIDGE block there */
interface FilmApi {
  duck(v: number): void;
  dur: number;
  fade(id: string, opacity: number): void;
  haze(v: null | number): void;
  height(): number;
  light(p: null | { az?: number; el?: number }): void;
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
  private tetherEl?: SVGLineElement;
  private dim?: HTMLElement;
  /** the dim's own value, chased rather than cut so it never snaps on */
  private dimNow = 0;
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

  /**
   * CAPTIONS. `?subs` seeds them on; CC toggles them.
   *
   * They are the narration, printed. That makes them two things at once
   * and both are wanted: an accessibility track for anyone who cannot or
   * would rather not hear the voice, and — before any voice exists — the
   * only reliable way to find out that a line is two seconds too long for
   * the shot it is sitting on.
   */
  @tracked private subsOn = new URLSearchParams(window.location.search).has(
    'subs'
  );

  get subs(): boolean {
    return this.subsOn;
  }

  private cc = () => {
    this.subsOn = !this.subsOn;
  };

  get grade(): string {
    return this.beat.grade ?? this.chapter.grade ?? 'amber';
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

  get photoSrc(): string {
    return `${config.rootURL}towers/${this.beat.photo?.src ?? ''}`;
  }

  /** a photograph that failed to load is no photograph — drop the plate */
  private lost = new Set<string>();
  @tracked private lostStamp = 0;

  get hasPhoto(): boolean {
    const p = this.beat.photo;
    return !!p && this.lostStamp >= 0 && !this.lost.has(p.src);
  }

  private missing = () => {
    const p = this.beat.photo;
    if (p) {
      this.lost.add(p.src);
      this.lostStamp += 1;
    }
  };

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
    this.tetherEl = el.querySelector('line.tf-tether') as SVGLineElement;
    this.dotEl = el.querySelector('circle') as SVGCircleElement;
    this.traceEls = [
      ...el.querySelectorAll('polyline'),
    ] as SVGPolylineElement[];
  });

  private dimEl = modifier((el: HTMLElement) => {
    this.dim = el;
    return () => {
      if (this.dim === el) {
        this.dim = undefined;
      }
    };
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

    this.stageMark(film, beat, local, dt);
    this.trackPoint(film, beat, local);
    this.traceShape(film, beat, local, dt);
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
    /**
     * WHEN THE GROUND GOES DARK, THE TYPE GOES LIGHT.
     *
     * The scrims are mixed from the scene's own paper, so at night they
     * are a dark wash — and dark ink on a dark wash is unreadable however
     * carefully the scrim was tuned. Rather than hand-pick a palette per
     * hour, the ink is DERIVED: measure the paper and invert below the
     * threshold. One rule, right for all four hours and for any theme
     * anybody adds later.
     */
    const dark = luminance(p.paper) < 0.42;
    el.classList.toggle('is-dark', dark);
    el.style.setProperty('--tf-ink', dark ? '#f7f0e0' : p.ink);
    el.style.setProperty('--tf-ink2', dark ? '#bdb3a0' : p.ink2);
    el.style.setProperty('--tf-ink3', dark ? '#e6dcc8' : p.ink3);
    el.style.setProperty('--tf-accent', dark ? '#f0a24a' : p.accent);
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
    /**
     * A CLOSE-UP GETS ALMOST NONE OF THIS. Parallax on the type exists to
     * stop a caption looking pasted onto a moving picture. On a 4× detail
     * shot the picture is barely moving and the caption is the largest
     * thing on screen, so the same amplitude stops reading as depth and
     * starts reading as drift. It has to scale with what the shot behind
     * it is actually doing.
     */
    const amp = this.beat.mode === 'point' ? 0.28 : 1;
    for (const [i, el] of rows.entries()) {
      /* the glyph sits near the top of the block and should be the
         NEAREST plane, so depth runs down the block rather than up it */
      const depth = 1 - i / Math.max(1, rows.length - 1);
      const dx = -14 * depth * t * amp;
      const dy = -9 * depth * t * amp;
      const sc = 1 + 0.035 * depth * t * amp;
      el.style.transform = `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0) scale(${sc.toFixed(4)})`;
    }
  }

  /**
   * Project a world polyline into the frame and stroke it, drawing it on
   * over the head of its beat. The dash pattern is the line's own measured
   * length, so the draw-on is a real pen travelling the real path rather
   * than a fade wearing a costume.
   */
  private traceShape(film: FilmApi, beat: Beat, local: number, dt: number) {
    const specs = beat.trace ?? [];
    let drew = 0;
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
      drew = Math.max(drew, draw);
      el.setAttribute('points', pts.trim());
      el.setAttribute('stroke-dasharray', String(len));
      el.setAttribute('stroke-dashoffset', String(len * (1 - draw)));
      el.setAttribute('stroke-width', spec.wide ? '3.4' : '2');
      el.style.opacity = draw > 0 ? '1' : '0';
    }
    /* the callout earns the dim too — a leader and a ring are annotation
       just as much as a traced eave is */
    if (beat.to) {
      drew = Math.max(drew, Math.min(1, Math.max(0, (local - 0.08) / 0.18)));
    }
    if (this.dim) {
      this.dimNow += (drew - this.dimNow) * Math.min(1, dt * 3.2);
      this.dim.style.opacity = this.dimNow.toFixed(3);
    }
  }

  /** the mark's facing, damped behind the camera's own bearing */
  private markFace = 0;

  /**
   * Place the stage mark: climb to its height with a settle, hold, and
   * face the camera a beat late.
   */
  private stageMark(film: FilmApi, beat: Beat, local: number, dt: number) {
    const m = beat.mark;
    const tether = this.tetherEl;
    if (!m) {
      film.fade('mark', 0);
      if (tether) {
        tether.style.opacity = '0';
      }
      return;
    }
    /* the climb takes the first fifth of the beat and overshoots once */
    const raw = Math.min(1, Math.max(0, (local - 0.04) / 0.2));
    const c1 = 1.34;
    const p = raw - 1;
    const rise = raw >= 1 ? 1 : 1 + (c1 + 1) * p * p * p + c1 * p * p;
    const y = m.to * rise;
    const a = m.bearing * RAD;
    const v = film.view();
    /* a damped follow, and wrapped so the lag never takes the long way */
    let d = v.az - this.markFace;
    while (d > Math.PI) {
      d -= Math.PI * 2;
    }
    while (d < -Math.PI) {
      d += Math.PI * 2;
    }
    this.markFace += d * Math.min(1, dt * 1.6);
    film.sky(
      'mark',
      {
        color: '#2a2110',
        lines: m.lines,
        size: m.size,
        track: 0.1,
      },
      {
        opacity: Math.min(1, raw * 2.2) * 0.92,
        ry: (this.markFace / RAD) % 360,
        x: Math.sin(a) * m.r,
        y,
        z: Math.cos(a) * m.r,
      }
    );
    /* AND IT IS TETHERED. A label floating beside a building names
       nothing; a line back to the height it is describing turns it into a
       measurement. */
    if (tether && this.frameEl) {
      const host = this.frameEl.getBoundingClientRect();
      const sx = host.width / v.w;
      const sy = host.height / v.h;
      const from = film.project(
        Math.sin(a) * m.r * 0.72,
        y,
        Math.cos(a) * m.r * 0.72
      );
      const to = film.project(0, y, 0);
      tether.setAttribute('x1', String(from.x * sx));
      tether.setAttribute('y1', String(from.y * sy));
      tether.setAttribute('x2', String(to.x * sx));
      tether.setAttribute('y2', String(to.y * sy));
      tether.style.opacity = raw > 0.4 ? '0.55' : '0';
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
    /* both are shot properties, so both are released when a beat does not
       ask — otherwise one raking close-up would light the rest of the film */
    film.light(
      beat.sun ? { az: beat.sun.az * RAD, el: beat.sun.el * RAD } : null
    );
    film.haze(beat.haze ?? null);
    if (beat.wx !== undefined) {
      film.wx(beat.wx, instant);
    }
    this.hush();
    this.speak(beat);
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
    } else if (e.key === 'v' || e.key === 'V') {
      this.cc();
    }
  };

  /**
   * THE NARRATION, one file per beat.
   *
   * `public/towers/vo/<id>.mp3`, played on the beat's entrance and stopped
   * when the beat changes. Per beat rather than one long track because
   * chapter skip RE-CUTS the film: a single track would have to be sought,
   * and a sought track against a re-cut score drifts inside a chapter.
   *
   * A missing file is silence, not an error. The film ships before the
   * voice does, and the score has to be right either way. While a line
   * plays the scene's own music ducks under it, which is the one piece of
   * mixing that cannot wait for a mix.
   */
  private voice?: HTMLAudioElement;

  private speak(beat: Beat) {
    if (!this.sound) {
      return;
    }
    const el = (this.voice ??= new Audio());
    el.pause();
    el.src = `${config.rootURL}towers/vo/${beat.id}.mp3`;
    el.volume = 1;
    /**
     * THE MIX. Narration is the foreground and the scene's music is a
     * bed, so the bed goes properly out of the way rather than politely
     * down — to a tenth while a line runs, and back up slowly, since a
     * duck that returns as fast as it left reads as a pump. It lifts on
     * `ended` rather than on a timer: the reads vary by six seconds
     * across the film, and a timed release would breathe wrong on nearly
     * every one of them.
     */
    el.onended = () => this.film?.duck(1);
    void el.play().then(
      () => this.film?.duck(0.1),
      () => this.film?.duck(1)
    );
  }

  private hush() {
    this.voice?.pause();
    this.film?.duck(1);
  }

  /** the scene brought its own score — six of them, one per tower */
  private hear = () => {
    this.sound = !this.sound;
    this.film?.sound(this.sound);
    /* turning sound on mid-beat should speak the line you are LOOKING at,
       not wait for the next one — otherwise the first thing anybody hears
       is a chapter they have already read */
    if (this.sound) {
      this.speak(this.beat);
    } else {
      this.hush();
    }
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
      <div
        class="tf-stage is-grade-{{this.grade}} {{if this.subsOn 'has-subs'}}"
        {{this.mount}}
      >
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

        {{! THE GRADE, over the picture and under everything else. }}
        <div class="tf-grade" aria-hidden="true"></div>

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

        {{! THE DIM. A wash that comes in WITH the annotation and lifts
        with it, because a line drawn over a picture is only as readable
        as the picture lets it be — and this scene is a bright ochre wash
        corner to corner, which is the worst possible ground for a thin
        red line. Dimming the plate is what a lecturer does when the
        slide goes up. It sits under the traces and over the grade, so
        the lines and the type stay at full strength and only the
        photograph steps back. }}
        <div class="tf-dim" aria-hidden="true" {{this.dimEl}}></div>

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
          <line class="tf-tether" x1="0" y1="0" x2="0" y2="0" />
          <circle cx="0" cy="0" r="7" />
        </svg>

        {{#if this.booted}}
          {{! THE FRONT LAYER. Keyed on the beat, so every hand-off replays
          the delivery: the kicker types in, the kanji lands centre-out on
          an overshoot, the reading and the gloss follow, and the sentence
          arrives word by word. A beat change drops the old type in one
          quick fall. All of it is score vocabulary. }}
          <Choreo class="tf-type tf-{{this.beat.mode}}" as |n|>
            {{! the chapter's number, set enormous and nearly out of ink
            behind the plate. It is the oldest device in editorial layout
            and it is here for the oldest reason: a slab of type in the
            corner of a frame needs something behind it or it reads as a
            subtitle that has wandered. Not a plane — the host's drift
            would move it, and the whole job of a ghost numeral is to sit
            perfectly still while everything in front of it does not. }}
            <span class="tf-ghost" aria-hidden="true">{{this.chapter.n}}</span>
            {{#each (array this.beat) key="id" as |b|}}
              {{! EACH ROW IS A PLANE, and the nesting is load-bearing: the
              wrapper is the plane and the host's loop drifts it, the
              paragraph inside is the type and Motion delivers it. One
              writer each. Put both on one element and the entrance and
              the drift overwrite each other's transform every frame —
              which is the same bug the beacon in Sylva was, and it looks
              exactly as bad. }}
              <div class="tf-block" {{this.plate}}>
                {{#if b.kicker}}
                  <div class="tf-plane">
                    <p class="tf-kicker" {{motion id="kicker" role="kick"}}>
                      <span>{{b.kicker}}</span>
                    </p>
                  </div>
                {{/if}}
                {{! When the beat has a MARK, the term is already standing
                out in the scene at the height it names — so the front
                layer does not set it a second time. Two copies of the
                same word, one in the world and one on the glass, is the
                doubled-logo problem in another costume. }}
                {{#unless b.mark}}
                  {{#if b.kanji}}
                    <div class="tf-plane is-glyph">
                      <p class="tf-kanji" {{motion id="kanji" role="glyph"}}>
                        {{b.kanji}}
                      </p>
                    </div>
                  {{/if}}
                {{/unless}}
                <div class="tf-plane">
                  <p class="tf-read" {{motion id="read" role="read"}}>
                    <span class="tf-romaji">{{b.romaji}}</span>
                    {{#if b.gloss}}
                      <span class="tf-gloss">{{b.gloss}}</span>
                    {{/if}}
                  </p>
                </div>
                {{! KINETIC TYPE, not a paragraph. Each phrase is its own
                sprite with its own role, because Choreo's text delivery
                splits a sprite and ladders INSIDE it — a stagger across
                four separate lines has to be four steps with four delays.
                Which is the honest way to write it anyway: these are
                cues, and a cue has a time. }}
                {{#each b.says as |say index|}}
                  <div class="tf-plane">
                    <p
                      class="tf-say"
                      {{motion id=(concat "say" index) role=(concat "s" index)}}
                    >{{say}}</p>
                  </div>
                {{/each}}
              </div>
            {{/each}}

            <n.Parallel>
              <n.Tween
                @of={{array
                  (n.removed "kick")
                  (n.removed "glyph")
                  (n.removed "read")
                }}
                @opacity={{array 1 0}}
                @y={{array 0 -14}}
                @duration={{0.2}}
                @ease="easeIn"
              />
              <n.Tween
                @of={{n.inserted "kick"}}
                @clipPath={{array "inset(0 100% 0 0)" "inset(0 -2% 0 0)"}}
                @opacity={{array 0 1}}
                @duration={{0.44}}
                @ease={{array 0.3 0.9 0.2 1}}
              />
              {{! THE HERO MOMENT, and it is a mask rather than a fade: each
              character rises out of its own baseline behind a clip that
              opens upward, centre-out, and settles straight. The
              overshoot is deliberately small. A springy landing is fine
              under a wide shot and unbearable under a 4× close-up, where
              the type is the biggest thing on screen and has nothing
              moving behind it to absorb the motion. }}
              <n.Tween
                @of={{n.inserted "glyph"}}
                @by="character"
                @order="center"
                @stagger={{0.07}}
                @delay={{0.12}}
                @clipPath={{array
                  "inset(110% 0 -14% 0)"
                  "inset(-14% 0 -14% 0)"
                }}
                @y={{array 34 0}}
                @scale={{array 1.06 1}}
                @opacity={{array 0 1}}
                @duration={{0.76}}
                @ease={{array 0.2 1.06 0.3 1}}
              />
              <n.Tween
                @of={{n.inserted "read"}}
                @delay={{0.5}}
                @clipPath={{array "inset(0 100% 0 0)" "inset(0 -2% 0 0)"}}
                @y={{array 8 0}}
                @opacity={{array 0 1}}
                @duration={{0.52}}
                @ease={{array 0.22 1 0.36 1}}
              />
              {{! four slots, landing ACROSS the beat rather than together:
              the film is narrated, so the type keeps pace with a voice
              instead of arriving as a wall }}
              <n.Tween
                @of={{n.inserted "s0"}}
                @delay={{0.5}}
                @clipPath={{array "inset(0 100% 0 0)" "inset(0 -2% 0 0)"}}
                @y={{array 16 0}}
                @opacity={{array 0 1}}
                @duration={{0.56}}
                @ease={{array 0.2 1 0.32 1}}
              />
              <n.Tween
                @of={{n.inserted "s1"}}
                @delay={{2.2}}
                @clipPath={{array "inset(0 100% 0 0)" "inset(0 -2% 0 0)"}}
                @y={{array 16 0}}
                @opacity={{array 0 1}}
                @duration={{0.56}}
                @ease={{array 0.2 1 0.32 1}}
              />
              <n.Tween
                @of={{n.inserted "s2"}}
                @delay={{3.9}}
                @clipPath={{array "inset(0 100% 0 0)" "inset(0 -2% 0 0)"}}
                @y={{array 16 0}}
                @opacity={{array 0 1}}
                @duration={{0.56}}
                @ease={{array 0.2 1 0.32 1}}
              />
              <n.Tween
                @of={{n.inserted "s3"}}
                @delay={{5.6}}
                @clipPath={{array "inset(0 100% 0 0)" "inset(0 -2% 0 0)"}}
                @y={{array 16 0}}
                @opacity={{array 0 1}}
                @duration={{0.56}}
                @ease={{array 0.2 1 0.32 1}}
              />
              <n.Tween
                @of={{array
                  (n.removed "s0")
                  (n.removed "s1")
                  (n.removed "s2")
                  (n.removed "s3")
                }}
                @opacity={{array 1 0}}
                @y={{array 0 -16}}
                @duration={{0.2}}
                @ease="easeIn"
              />
            </n.Parallel>
          </Choreo>

          {{! THE PHOTOGRAPH. Cut in on the side the type is not using, and
          wiped rather than faded — a fade says "meanwhile", a wipe says
          "and here it is". It carries its own credit, because a museum
          caption without one is a museum caption nobody can check. }}
          {{#if this.hasPhoto}}
            <Choreo class="tf-photo" as |g|>
              {{#each (array this.beat) key="id" as |b|}}
                <figure {{motion id="photo" role="shot"}}>
                  <img
                    src={{this.photoSrc}}
                    alt=""
                    {{on "error" this.missing}}
                  />
                  <figcaption>
                    <span class="tf-photo-cap">{{b.photo.caption}}</span>
                    <span class="tf-photo-cr">{{b.photo.credit}}</span>
                  </figcaption>
                </figure>
              {{/each}}
              <g.Tween
                @of={{g.inserted "shot"}}
                @clipPath={{array "inset(0 100% 0 0)" "inset(0 0% 0 0)"}}
                @duration={{0.62}}
                @ease={{array 0.22 1 0.36 1}}
              />
              <g.Tween
                @of={{g.removed "shot"}}
                @opacity={{array 1 0}}
                @duration={{0.24}}
                @ease="easeIn"
              />
            </Choreo>
          {{/if}}

          {{#if this.subs}}
            <p class="tf-subs">{{this.beat.vo}}</p>
          {{/if}}

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
              <p class="tf-menu-keys">← → chapter · space play · M sound · V
                captions · C close</p>
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
          <button
            type="button"
            class="tf-btn {{if this.subsOn 'is-on'}}"
            title="captions"
            {{on "click" this.cc}}
          >CC</button>
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
        /* THE ANNOTATION RED, and it is a different colour from the
           editorial accent on purpose. The accent is ink — it belongs to
           the page and takes the page's palette. This is a marker: it is
           not in the scene, it never was, and it should look like
           somebody drew on the photograph. Muted burnt orange over ochre
           moss reads as part of the picture, which is exactly what an
           annotation must not do. */
        --tf-mark: #ff2412;
        --tf-rule: #c2b18c;
        /* The sun, in two numbers: tf-rake is the angle its light makes
           across the frame, tf-shx/tf-shy the direction away from it.
           They dress the things that are PHYSICALLY on the frame — the
           photograph's own plate, the rake of a rule — and deliberately
           not the type. An offset shadow behind a headline is a sticker
           effect: it claims the letters are objects lying on the picture,
           which they are not, and getting the angle right does not rescue
           it. Type here earns its contrast from the scrim. */
        /* TYPE. The display face is a serif on purpose. This film is set
           beside mincho kanji and stands in front of a building, and a
           wide-tracked geometric sans fights both — it is also the first
           thing every deck reaches for, which is reason enough to leave
           it alone. A warm old-style serif sits with the kanji instead of
           arguing with it. The sans is kept for small mechanical labels
           only, and its tracking is pulled well back from the point where
           letterspaced caps start reading as a logo. */
        --tf-display:
          "Iowan Old Style", "Charter", "Palatino Linotype", Palatino,
          "Book Antiqua", Georgia, serif;
        --tf-ui:
          "Helvetica Neue", "Franklin Gothic Medium", Inter, system-ui,
          sans-serif;
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
        /* the primary: contrast, saturation and lift, per grade */
        filter: var(--tf-lut);
        transition: filter 1500ms ease;
      }

      /* ---- the grade ------------------------------------------------- *
         Two passes, the way a colourist works: a primary on the picture
         itself (above), then a split tone laid over it — warmth into the
         highlights on one diagonal, coolness into the shadows on the
         other. Soft-light rather than overlay, because overlay crushes this scene's
         mid-tones and the whole point is to keep the moss and the plaster
         legible while moving the mood underneath them.
         ---------------------------------------------------------------- */
      .tf-grade {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        mix-blend-mode: soft-light;
        opacity: var(--tf-grade-a);
        background: linear-gradient(
          var(--tf-rake),
          var(--tf-warm) 0%,
          transparent 46%,
          transparent 58%,
          var(--tf-cool) 100%
        );
        transition:
          background 1500ms ease,
          opacity 1500ms ease;
      }

      /* the five moods. CONTEXT opens warm and open; HISTORY is archival —
         desaturated, cool, contrastier, the look of a document rather than
         a day; CONSTRUCTION goes clean and bright, nearly a blueprint;
         DETAIL is rich and close; COMPARISON is a museum plate, flat and
         even, because a comparison that flatters one subject is not one. */
      .is-grade-amber {
        --tf-lut: saturate(1.06) contrast(1.02) brightness(1.02);
        --tf-warm: #ffbe6a;
        --tf-cool: #2c4a6b;
        --tf-grade-a: 0.5;
        --tf-vig-a: 0.9;
      }

      .is-grade-iron {
        --tf-lut: saturate(0.58) contrast(1.2) brightness(0.9) sepia(0.14);
        --tf-warm: #d8c39a;
        --tf-cool: #1d2f45;
        --tf-grade-a: 0.78;
        --tf-vig-a: 1.15;
      }

      /* MIDDAY, and it is meant to be the brightest thing in the film.
         The construction chapter is the one that has to read as
         information — you are watching a building get assembled — so it
         is pushed up and opened out until it is nearly a working
         drawing, and it earns its brightness by sitting between two
         chapters that are deliberately heavier. Contrast between
         chapters is a bigger effect than contrast inside one. */
      .is-grade-chalk {
        --tf-lut: saturate(0.9) contrast(1.05) brightness(1.22);
        --tf-warm: #fffdf4;
        --tf-cool: #6f92a6;
        --tf-grade-a: 0.3;
        --tf-vig-a: 0.4;
      }

      .is-grade-ink {
        --tf-lut: saturate(1.16) contrast(1.18) brightness(0.93);
        --tf-warm: #ffab52;
        --tf-cool: #17222f;
        --tf-grade-a: 0.7;
        --tf-vig-a: 1.2;
      }

      .is-grade-plate {
        --tf-lut: saturate(0.94) contrast(1.01) brightness(1.03);
        --tf-warm: #f0e2c4;
        --tf-cool: #55564a;
        --tf-grade-a: 0.28;
        --tf-vig-a: 0.62;
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
        /* the vignette is part of the grade: a bright chapter wants it
           nearly off, a heavy one wants it leaning in */
        opacity: var(--tf-vig-a, 1);
        transition: opacity 1500ms ease;
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

      .tf-dim {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        opacity: 0;
        background: radial-gradient(
          76% 66% at 50% 48%,
          rgba(24, 18, 8, 0.24) 0%,
          rgba(24, 18, 8, 0.46) 100%
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

      /* the marker glows, and the glow is doing real work: a 2px line laid
         over moss competes with the moss at exactly its own frequency, and
         a soft bloom around it gives the eye a low-frequency edge to catch
         first. Two shadows rather than one — a tight hot core and a wide
         faint halo — because a single wide blur reads as a mistake and a
         single tight one is invisible at this scale. */
      .tf-trace,
      .tf-leader,
      .tf-track circle {
        filter: drop-shadow(0 0 3px rgba(255, 36, 18, 0.95))
          drop-shadow(0 0 11px rgba(255, 60, 20, 0.55));
      }

      .tf-trace {
        stroke: var(--tf-mark);
        stroke-linecap: round;
        stroke-linejoin: round;
        opacity: 0;
        transition: opacity 260ms ease;
      }

      .tf-tether {
        stroke: var(--tf-accent);
        stroke-width: 1.4;
        stroke-dasharray: 3 5;
        opacity: 0;
        transition: opacity 500ms ease;
      }

      .tf-leader {
        stroke: var(--tf-mark);
        stroke-width: 1.8;
        stroke-dasharray: 5 4;
        opacity: 0;
        transition: opacity 400ms ease;
      }

      .tf-track circle {
        fill: none;
        stroke: var(--tf-mark);
        stroke-width: 2.6;
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
        font-family: var(--tf-display);
      }

      .tf-block {
        position: absolute;
        max-width: min(40ch, 44vw);
      }

      /* a kicker rides a rule that draws itself out of the type — the
         diagonal is the sun's, so the graphic furniture rakes the same
         way the shadows do */
      .tf-kicker {
        font-family: var(--tf-ui);
        font-size: clamp(11px, 0.92vw, 14px);
        font-weight: 700;
        letter-spacing: 0.17em;
        color: var(--tf-ink3);
        margin: 0 0 14px;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      /* the rule draws itself out of the kicker. It is a pseudo-element,
         so Motion cannot own it — but the whole block is rebuilt on every
         beat, which means a plain CSS animation runs from its first frame
         each time and needs no retriggering. */
      .tf-kicker::after {
        content: "";
        flex: 1;
        height: 2px;
        background: var(--tf-accent);
        transform-origin: left center;
        animation: tf-rule 760ms 300ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }

      .tf-title .tf-kicker::after {
        transform-origin: right center;
      }

      @keyframes tf-rule {
        from {
          transform: scaleX(0);
        }

        to {
          transform: scaleX(1);
        }
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

      /* on a marked beat the reading is the largest thing in the block,
         because the term itself is out in the scene */
      .tf-block:not(:has(.is-glyph)) .tf-romaji {
        font-size: clamp(17px, 1.5vw, 24px);
        letter-spacing: 0.2em;
      }

      .tf-block:not(:has(.is-glyph)) .tf-gloss {
        font-size: clamp(15px, 1.2vw, 19px);
      }

      .tf-romaji {
        font-family: var(--tf-ui);
        font-size: clamp(12px, 1.02vw, 15px);
        font-weight: 700;
        letter-spacing: 0.15em;
      }

      .tf-gloss {
        font-family: var(--tf-display);
        font-size: clamp(13px, 1.06vw, 16px);
        letter-spacing: 0.01em;
        color: var(--tf-ink3);
        font-style: italic;
      }

      /* the planes are the host's to move; the type on them is Motion's */
      .tf-plane {
        will-change: transform;
      }

      /* a phrase is a HEADLINE, not body copy: it is on screen for two
         seconds and read at a glance, so it is set at the size a glance
         needs and it never runs past two lines */
      .tf-say {
        margin: 0 0 12px;
        font-family: var(--tf-display);
        font-size: clamp(20px, 2.15vw, 37px);
        font-weight: 400;
        line-height: 1.24;
        color: var(--tf-ink);
        max-width: 21ch;
      }

      .tf-say:last-child {
        margin-bottom: 0;
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

      /* captions take the foot of the frame, so the settings that live
         down there move up out of their way rather than sit under them */
      .has-subs .tf-lower .tf-block {
        bottom: 21%;
      }

      .has-subs .tf-title .tf-block {
        bottom: 24%;
      }

      /* THE PLATE, which is the one setting that is a designed object
         rather than a caption. Two columns: the term set VERTICALLY down
         the right edge, the way it would be on a museum label or a
         hanging scroll, and the reading and the phrases in a column
         beside it. A rule between them draws itself down as the plate
         lands. Ranged type in a corner was never wrong exactly — it was
         just nothing, and this chapter's beats are the ones that hold
         longest, so they are the ones that can least afford nothing. */
      .tf-plate .tf-block {
        right: 5.5%;
        top: 50%;
        transform: translateY(-50%);
        display: grid;
        grid-template-columns: 1fr auto;
        column-gap: clamp(18px, 2vw, 34px);
        align-items: start;
        max-width: min(46ch, 46vw);
      }

      .tf-plate .tf-plane {
        grid-column: 1;
      }

      .tf-plate .tf-plane.is-glyph {
        grid-column: 2;
        grid-row: 1 / -1;
        border-right: 2px solid var(--tf-accent);
        padding-right: clamp(14px, 1.5vw, 26px);
        transform-origin: top center;
        animation: tf-rule-down 820ms 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }

      @keyframes tf-rule-down {
        from {
          clip-path: inset(0 0 100% 0);
        }

        to {
          clip-path: inset(0 0 -4% 0);
        }
      }

      .tf-plate .tf-kanji {
        writing-mode: vertical-rl;
        margin: 0;
        font-size: clamp(44px, 5.4vw, 88px);
        letter-spacing: 0.1em;
        line-height: 1;
      }

      .tf-plate .tf-kicker {
        margin-bottom: 18px;
      }

      /* the ghost is only ever behind a plate — everywhere else the frame
         is already carrying the building */
      .tf-ghost {
        display: none;
      }

      .tf-plate .tf-ghost {
        display: block;
        position: absolute;
        right: 3%;
        top: 50%;
        transform: translateY(-50%);
        font-family: var(--tf-ui);
        font-size: clamp(180px, 30vw, 460px);
        font-weight: 700;
        line-height: 0.8;
        letter-spacing: -0.04em;
        color: var(--tf-ink);
        opacity: 0.07;
        pointer-events: none;
        z-index: -1;
      }

      .tf-point .tf-block {
        left: 5.5%;
        top: 18%;
        max-width: min(30ch, 34vw);
      }

      .tf-point .tf-kanji {
        font-size: clamp(48px, 6.6vw, 104px);
      }

      /* ---- the photograph -------------------------------------------- */
      .tf-photo {
        position: absolute;
        z-index: 4;
        pointer-events: none;
      }

      .tf-lower .tf-photo,
      .tf-title .tf-photo,
      .tf-point .tf-photo {
        right: 5.5%;
        top: 12%;
      }

      .tf-plate .tf-photo {
        left: 5.5%;
        top: 12%;
      }

      .tf-photo figure {
        margin: 0;
        width: min(30vw, 340px);
        background: var(--tf-paper);
        padding: 10px 10px 8px;
        border: 1px solid var(--tf-rule);
        box-shadow: calc(var(--tf-shx) * 4) calc(var(--tf-shy) * 4) 26px
          rgba(38, 28, 10, 0.26);
      }

      .tf-photo img {
        display: block;
        width: 100%;
        height: auto;
        filter: saturate(0.86) contrast(1.04);
      }

      .tf-photo figcaption {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-top: 8px;
        font-family: var(--tf-ui);
      }

      .tf-photo-cap {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: var(--tf-ink);
      }

      .tf-photo-cr {
        font-size: 10px;
        letter-spacing: 0.06em;
        color: var(--tf-ink2);
      }

      .is-dark .tf-subs {
        color: #1a1408;
        background: rgba(238, 228, 204, 0.82);
      }

      .tf-subs {
        position: absolute;
        left: 50%;
        bottom: 3%;
        transform: translateX(-50%);
        z-index: 5;
        margin: 0;
        max-width: 66ch;
        text-align: center;
        font-family: var(--tf-ui);
        font-size: 15px;
        line-height: 1.5;
        color: #f7efdd;
        background: rgba(20, 15, 6, 0.66);
        padding: 9px 18px;
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
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.17em;
        color: var(--tf-ink3);
        font-family: var(--tf-ui);
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
        font-family: var(--tf-ui);
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
        font-family: var(--tf-ui);
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
