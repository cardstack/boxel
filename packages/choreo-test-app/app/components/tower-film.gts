import { array, concat, fn, get } from '@ember/helper';
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
  /**
   * THE LINEUP. Six towers were shown one at a time, which is six
   * portraits; a comparison is only paid off when they stand in the same
   * frame. The scene can only grow one tower per frame — so the lineup is
   * cut in TIME instead of space: the styles cycle on a metronome inside
   * one held shot, a second each, the kanji stamping over each. A recap
   * montage, which is what every comparison film ends on.
   */
  cycle?: { kanji: string; style: number }[];
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
  /** how the front layer is set; 'clear' is no furniture at all — the
   *  one mode whose whole job is to get out of the picture's way */
  mode: 'clear' | 'lower' | 'plate' | 'point' | 'title';
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
 * WHAT EACH READ ACTUALLY RUNS, seconds, measured with ffprobe against the
 * files in `public/towers/vo/`. The kinetic type is paced against the VOICE,
 * not against the beat: the last cue should land as the line is finishing,
 * whether the read is four seconds or thirteen. Estimating this went wrong
 * once already (see docs/towers-vo.md) — so it is measured, and a re-record
 * means re-measuring. A beat missing from here paces against its own length.
 */
const VO_SECS: Record<string, number> = {
  azuchi: 8.44,
  boro: 7.0,
  'c-cn': 7.76,
  'c-jp': 4.31,
  'c-kh': 8.59,
  'c-th': 6.11,
  'c-tr': 7.47,
  'c-vn': 7.84,
  coda: 11.36,
  detail: 3.58,
  hafu: 10.21,
  hikaku: 6.5,
  ikkoku: 8.2,
  ishi2: 7.11,
  ishigaki: 11.55,
  kawara: 9.27,
  koran: 5.85,
  noki: 8.36,
  plaster: 5.85,
  shachi: 10.63,
  shiro: 8.18,
  teppo: 7.29,
  timber: 12.8,
  title: 6.03,
  what: 5.8,
};

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
    /* the film opens from as far out as the lens goes and spends the
       whole first beat arriving — a slow push from "a landscape with
       something in it" to "this building, specifically" */
    cam: { dolly: 0.46, lookY: -1.2, ox: 0.2, pitch: 12, yaw: -46 },
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
    toCam: { dolly: 0.74, lookY: -1.0, ox: 0.2, pitch: 13, yaw: -26 },
  },
  {
    /* CUT to the ground itself — a worm's-eye from the foot of the
       stone, the lens as low as the rig goes, aimed up the whole height.
       The line says the castle is the ground, so the shot stands ON it,
       and the tower is tall because you are finally under it. */
    cam: { dolly: 2.2, lookY: 5.2, ox: -0.1, pitch: -3, yaw: -18 },
    ch: 0,
    cut: true,
    gloss: 'castle',
    id: 'shiro',
    says: ['Not the tower.', 'The ground.', 'Ditches, banks, terraces.'],
    kanji: '城',
    kicker: 'WHAT A CASTLE IS',
    vo: 'The castle is not the tower. The castle is the ground. Ditches, banks, a hill cut into shelves.',
    mode: 'lower',
    romaji: 'SHIRO',
    ticks: 5,
    toCam: { dolly: 1.85, lookY: 5.7, ox: -0.1, pitch: -3, yaw: -5 },
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
      bearing: 120,
      lines: ['石垣'],
      r: 7,
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
      bearing: 138,
      lines: ['柱梁'],
      r: 7,
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
      bearing: 155,
      lines: ['白壁'],
      r: 7,
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
      bearing: 170,
      lines: ['望楼'],
      r: 7,
      size: 1.5,
      to: 11.2,
    },
    haze: 0.38,
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
      bearing: 185,
      lines: ['瓦'],
      r: 7,
      size: 1.5,
      to: 13.5,
    },
    mode: 'lower',
    romaji: 'KAWARA',
    theme: 1,
    ticks: 6,
    toCam: { dolly: 0.72, lookY: 2.2, ox: -0.1, pitch: 12, yaw: 148 },
  },
  /**
   * THE SILENCE. The roof has just closed and the building stands finished
   * for the first time, in the brightest light the film owns — and nobody
   * says anything. No voice, no type, no scrim; the frame centres for the
   * only time in the film and the music comes back up on its own, because
   * `speak` finds no line and lifts the duck. Emotion in a documentary is
   * made of the one beat where the narrator trusts the picture. Four
   * seconds is the length of a breath taken on purpose.
   */
  {
    build: 4.4,
    cam: { dolly: 0.54, lookY: 0.9, ox: 0, pitch: 12, yaw: 149 },
    ch: 2,
    id: 'muneage',
    mode: 'clear',
    ticks: 2,
    toCam: { dolly: 0.5, lookY: 0.9, ox: 0, pitch: 13, yaw: 152 },
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
    theme: 2,
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
    haze: 0.45,
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
    theme: 0,
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
    theme: 0,
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

  /**
   * THE LINEUP — the recap montage the comparison was owed. One held
   * frame, the six towers cycling through it on a metronome, newest
   * acquaintance first and the tenshu last — so the film walks back to
   * its subject and the coda opens on a building already standing.
   */
  {
    cam: { dolly: 0.66, lookY: 1.8, ox: 0, pitch: 10, yaw: 250 },
    ch: 4,
    cycle: [
      { kanji: 'CAMİ', style: 5 },
      { kanji: 'ប្រាសាទ', style: 4 },
      { kanji: 'ปรางค์', style: 3 },
      { kanji: '佛塔', style: 2 },
      { kanji: '寶塔', style: 1 },
      { kanji: '天守', style: 0 },
    ],
    id: 'lineup',
    mode: 'clear',
    ticks: 3,
    toCam: { dolly: 0.66, lookY: 1.8, ox: 0, pitch: 10, yaw: 254 },
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
  clearTrace(id: string): void;
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
  trace(
    id: string,
    spec: { color?: string; glow?: string; pts: Pt3[]; r?: number }
  ): void;
  traceDraw(id: string, t: number): void;
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
  /**
   * THE ENDING. A film that laps back to its own first frame has no
   * ending, and the coda earns one — so when the last cue has run, the
   * run simply stops: the final pose holds, the music settles down a
   * step, and a card offers the way back in. Replay is a choice the
   * viewer makes, never something the clock does to them.
   */
  @tracked private ended = false;
  /** which tower the lineup's metronome is on; -1 between lineups */
  @tracked private cycleStep = -1;

  private film?: FilmApi;
  private frameEl?: HTMLElement;
  private lineEl?: SVGLineElement;
  private dotEl?: SVGCircleElement;
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

  /**
   * THE GATE. This film is narrated, and narration behind a mute button
   * is a film shown with the projector lamp off — so the front door asks.
   * One held frame, one choice, and the choice IS the user gesture that
   * autoplay policy wants anyway: the browser unlocks audio on the same
   * click that starts the picture. Museums have worked this way forever.
   *
   * `?from` skips it (an authoring link wants the shot, not the lobby)
   * and so does embedding.
   */
  @tracked private gate = false;
  /** the scene is loaded and seated behind the gate — the door can open */
  @tracked private ready = false;

  /**
   * One pass BEHIND `booted`, on purpose. A region's first render
   * collects no score, so anything standing in it on that pass — the
   * first beat's type, a head photo — was never inserted and never
   * animates. Content mounts on this flag instead, which flips a tick
   * later: the same render that gives the score its first real pass
   * hands the front layer a genuine insertion, and the opening beat's
   * type is DELIVERED like every other beat's instead of being found
   * already on the glass.
   */
  @tracked private rolling = false;

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

  /**
   * The pose the score OPENS on, declared to the region — without it the
   * first spline segment travels in from the library's default rig, a
   * two-second bounce every cold boot wore before its first real frame.
   */
  get openPose() {
    const c = this.beats[0]!.cam;
    return {
      dolly: c.dolly,
      look: { x: 0, y: c.lookY, z: 0 },
      pitch: c.pitch,
      x: c.ox ?? 0,
      y: 0,
      yaw: c.yaw,
    };
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

  /**
   * THE TRANSPORT — a broadcast bar, not a thermometer. One segment per
   * chapter, sized by the chapter's actual running time, filled by
   * WHOLE-film progress (the old bar measured the current cut, so a
   * skip made it lie), and clickable: the segments are the same re-cut
   * the menu and the arrows perform.
   */
  get transport() {
    const here = this.absoluteIndex;
    return this.contents.map((c) => {
      const done = here >= c.head + c.shots;
      const fill = done
        ? 100
        : here < c.head
          ? 0
          : Math.round(((here - c.head + 1) / c.shots) * 100);
      return {
        ...c,
        fillStyle: `width:${fill}%`,
        flexStyle: `flex:${c.secs}`,
      };
    });
  }

  /**
   * WHEN EACH CUE LANDS — paced against the voice, not the clock.
   *
   * The phrases used to arrive on four fixed delays, which meant a
   * fourteen-second beat finished its type with five seconds of dead air
   * and a short one crowded the read. So the cues spread themselves: the
   * first lands early, the last lands as the measured line is finishing
   * (`VO_SECS`), and a beat with no recording paces against two thirds of
   * its own length, which is where a read for it would sit anyway.
   */
  get sayAt(): number[] {
    const b = this.beat;
    const n = b.says?.length ?? 0;
    const dur = b.ticks * TICK;
    const vo = VO_SECS[b.id];
    const first = 0.5;
    /* land the last cue on the line's last breath, never inside the
       beat's own exit */
    const last = Math.max(
      first + 0.8,
      Math.min(vo ? vo - 0.4 : dur * 0.66, dur - 1.4)
    );
    return [0, 1, 2, 3].map((i) =>
      n <= 1 ? first : first + (Math.min(i, n - 1) * (last - first)) / (n - 1)
    );
  }

  /**
   * Thai and Khmer are not kanji: their ascenders, vowel marks and
   * subscripts stand far outside a CJK-tuned glyph box, so at the kanji
   * size they collide with the kicker above and the reading below. Tall
   * scripts take a reduced setting with real leading.
   */
  get glyphTone(): string {
    return /[฀-๿ក-៿]/.test(this.beat.kanji ?? '')
      ? 'is-tall'
      : '';
  }

  /** the lineup's current kanji; empty between lineups */
  get stamp(): string {
    const c = this.beat.cycle;
    return c && this.cycleStep >= 0 ? (c[this.cycleStep]?.kanji ?? '') : '';
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
    /* only ever gate a film that has not begun: a dev-mode template swap
       re-runs this modifier on the SAME instance, and resurrecting the
       door over a running film left its buttons answering to a guard
       that told them the film had already started — because it had */
    this.gate = !this.embed && this.from === 0 && !this.booted;
    const onLoad = () => {
      const w = (frame as HTMLIFrameElement).contentWindow as unknown as {
        __film?: FilmApi;
      } | null;
      if (!w?.__film) {
        return;
      }
      this.film = w.__film;
      /* a RUNNING film needs nothing from the door. This path re-fires
         whenever the modifier re-installs (it reads tracked state), and
         re-seating here yanked the lens back to the cut's head. */
      if (this.booted) {
        return;
      }
      try {
        /* the page opens on an empty site — its own clock is at zero —
           and most of this film is about a finished building. Standing it
           up before the first beat runs means a beat only ever has to say
           what it CHANGES, which is also what makes `?from` land on a
           real shot rather than on a field. */
        w.__film.time(4.4);
        /* seat the lens where the film opens, so the first frame is the
           shot and not a swing towards it */
        this.snap(this.beats[0]!.cam);
      } finally {
        /* the door unlocks NO MATTER WHAT the seating did: a gate whose
           buttons can be stranded disabled by a throw above is a locked
           theatre with the lights on */
        this.ready = true;
      }
      if (this.gate) {
        /* a click that arrived while the scene was still loading was a
           decision, not a miss — honour it now */
        if (this.wanted !== undefined) {
          this.begin(this.wanted);
        }
        return;
      }
      /* IDEMPOTENT, or nothing. This load path re-runs whenever the
         modifier does (a booted flip re-renders the stage), and an
         unconditional begin(false) here reached the already-booted
         branch and TOGGLED THE SOUND BACK OFF — the "with sound" click
         un-clicking itself one pass later. Only a film that has not
         begun may be begun on its behalf. */
      if (!this.booted) {
        this.begin(false);
      }
    };
    frame.addEventListener('load', onLoad);
    /* a cached iframe can be complete before the listener is attached —
       but never boot from inside the mount modifier itself: this runs
       during the render pass, and a `booted` flipped here renders the
       score region in the SAME pass, where the rig is not an insertion
       and the whole run resolves to nothing. A timeout puts the flip in
       its own pass, which is what the load event gives the slow path. */
    let bootTimer = 0;
    if (
      (frame as HTMLIFrameElement).contentDocument?.readyState === 'complete'
    ) {
      bootTimer = window.setTimeout(onLoad, 0);
    }
    /**
     * THE LOOP COMES BACK. This modifier reads tracked state (`from`,
     * `booted`), so it re-installs on every re-cut and on the boot
     * itself — and its own cleanup below cancels the frame loop each
     * time. The old code got away with it because the load path
     * re-booted the world wholesale; now that a running film is left
     * alone, the re-install has to hand back the one thing it took.
     */
    if (this.booted) {
      /* the cleanup nulled the bridge as well; take it straight back
         rather than waiting a tick for the load path */
      const w = (frame as HTMLIFrameElement).contentWindow as unknown as {
        __film?: FilmApi;
      } | null;
      if (w?.__film) {
        this.film = w.__film;
      }
      cancelAnimationFrame(this.raf);
      this.lastTick = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
    return () => {
      cancelAnimationFrame(this.raf);
      window.clearTimeout(bootTimer);
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
    /* softer than it was: the lens is an operator's hand, not a servo.
       Lower stiffness filters the spline's residual sway before the
       page's own chase filters it again. */
    const w = 4.4;
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

    /* the lineup's metronome: the beat divides itself evenly among its
       towers and the last one holds the remainder, so the recap ends
       standing on the film's own subject */
    if (beat.cycle?.length) {
      const step = Math.min(
        beat.cycle.length - 1,
        Math.floor(local * beat.cycle.length)
      );
      if (step !== this.cycleStep) {
        this.cycleStep = step;
        const c = beat.cycle[step]!;
        if (film.styleIndex() !== c.style) {
          film.style(c.style);
        }
        film.time(4.4);
        /* each stamp lands with the scene's own construction hit; the
           final one — the film's subject — gets the bell */
        film.ping(step < beat.cycle.length - 1 ? 0 : 99);
      }
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
    if (!p.time) {
      return;
    }
    /**
     * THE INK IS JUDGED AGAINST WHAT IS ACTUALLY ON SCREEN. The paper
     * alone lied: a noon paper under a heavy grade, a dim, and thick
     * haze is a DARK frame wearing a light theme, and dark ink on it
     * disappears. So the measured luminance is discounted by the
     * grade's own brightness, by whether this beat runs the dim, and
     * by its haze — and the type flips to light whenever the frame it
     * sits on has genuinely gone dark, not merely when the clock says
     * night.
     */
    const GB: Record<string, number> = {
      amber: 1.08,
      chalk: 1.27,
      ink: 1.0,
      iron: 0.9,
      plate: 1.09,
    };
    const beat = this.beat;
    const dimmed = beat.trace || beat.to ? 0.74 : 1;
    const eff =
      luminance(p.paper) *
      (GB[this.grade] ?? 1) *
      dimmed *
      (1 - 0.25 * (beat.haze ?? 0));
    const dark = eff < 0.42;
    const sig = `${p.time}${dark ? '#d' : '#l'}`;
    if (sig === this.wearing) {
      return;
    }
    this.wearing = sig;
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
     * hour, the ink is DERIVED — from the frame's effective luminance,
     * computed above. One rule, right for all four hours, every grade,
     * and any theme anybody adds later.
     */
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
    /* ease in over the head of the beat, then KEEP MOVING: the old curve
       saturated at half the beat and the block sat still for the rest,
       which is exactly the pasted-on look the parallax exists to kill.
       This one never stops — a slow push that lasts the whole shot. */
    const t = smooth(Math.min(1, local * 1.6)) * (0.35 + 0.65 * local);
    /**
     * A CLOSE-UP GETS LESS OF THIS. Parallax on the type exists to
     * stop a caption looking pasted onto a moving picture. On a 4× detail
     * shot the picture is barely moving and the caption is the largest
     * thing on screen, so the same amplitude stops reading as depth and
     * starts reading as drift. It has to scale with what the shot behind
     * it is actually doing.
     */
    const amp = this.beat.mode === 'point' ? 0.35 : 1;
    /* the last moments of the beat let go: the planes keep travelling
       and fade under the swap, so an exit is an exit and not a vanish */
    const out = local > 0.93 ? Math.max(0, (1 - local) / 0.07) : 1;
    for (const [i, el] of rows.entries()) {
      /* the glyph sits near the top of the block and should be the
         NEAREST plane, so depth runs down the block rather than up it —
         and each plane travels at its OWN rate, slightly detuned, so the
         stack reads as separate sheets of glass rather than one card */
      const depth = 1 - i / Math.max(1, rows.length - 1);
      const rate = 1 + 0.22 * Math.sin(i * 2.4);
      /* the x-glide is SHARED: staggering it per row shifts every text
         line's left edge differently, which the eye reads as broken
         indentation, not depth. The planes separate in y and scale,
         where the type's own alignment cannot be injured. */
      const dx = -11 * t * amp;
      const dy = -(5 + 13 * depth) * t * amp * rate;
      const sc = 1 + 0.055 * depth * t * amp;
      el.style.transform = `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0) scale(${sc.toFixed(4)})`;
      el.style.opacity = out.toFixed(3);
    }
  }

  /**
   * THE TRACES LIVE IN THE SCENE NOW. They began as SVG projected over
   * the frame — approximately right and one frame behind the lens on
   * every move. As tubes in the page's own scene they are exact: they
   * lie ON the eave because they are geometry at the eave's own
   * coordinates, the building occludes them honestly, and the draw-on
   * is the tube's index buffer revealed in path order. Each line in a
   * set starts a moment after the one before it — a hand annotating,
   * not a diagram switching on.
   */
  private traceShape(film: FilmApi, beat: Beat, local: number, dt: number) {
    const specs = beat.trace ?? [];
    let drew = 0;
    for (const [i] of specs.entries()) {
      const draw = Math.min(1, Math.max(0, (local - 0.06 - i * 0.12) / 0.16));
      drew = Math.max(drew, draw);
      film.traceDraw(`t${i}`, draw);
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
    /* the climb takes the first fifth of the beat and SETTLES — barely
       past its mark, once. The old spring bounced at the top like a
       carnival bell, which no surveyor's mark has ever done. */
    const raw = Math.min(1, Math.max(0, (local - 0.04) / 0.2));
    const c1 = 0.45;
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
    this.cycleStep = -1;
    /* the traces are the beat's own; stand this beat's up unrevealed and
       take the last beat's down */
    for (let i = 0; i < 4; i++) {
      film.clearTrace(`t${i}`);
    }
    /* the tube's thickness is a SCREEN quantity wearing world units: a
       marker line should read the same weight in a wide shot as in a 4×
       close-up, so the radius is sized against the shot's magnification */
    const mag = (beat.cam.dolly + (beat.toCam?.dolly ?? beat.cam.dolly)) / 2;
    beat.trace?.forEach((spec, i) => {
      const r = Math.max(
        0.03,
        Math.min(0.2, (spec.wide ? 0.13 : 0.085) / mag)
      );
      film.trace(`t${i}`, { pts: spec.pts, r });
    });
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
      /* the last cue has run: hold the pose, settle the music a step,
         and offer the card. Looping past your own ending is how a film
         tells the viewer it never meant any of it. */
      this.playing = false;
      this.ended = true;
      this.voice?.pause();
      this.film?.duck(0.35);
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
    /* a paused picture with a running voice is two films; hold both */
    if (!this.playing) {
      this.voice?.pause();
    } else if (this.sound && this.voice?.src && !this.voice.ended) {
      void this.voice.play().catch(() => this.film?.duck(1));
    }
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
    this.ended = false;
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
    /* at the door, one key opens it — with the sound the film was made
       with, since a keypress is as much a gesture as a click */
    if (this.gate) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.begin(true);
      }
      return;
    }
    if (this.ended && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      this.replay();
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
    /* a beat with no line is a beat that WANTS the music: lift the duck
       rather than asking the network for a file that was never recorded */
    if (!beat.vo) {
      this.film?.duck(1);
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

  /** a choice made at the door before the scene finished loading */
  private wanted?: boolean;

  /** through the gate — on the click the audio policy was waiting for */
  private begin = (withSound: boolean) => {
    if (this.booted) {
      /* a gate over a film already running is a stale door, not a
         request to boot twice — step aside and honour the sound choice */
      this.gate = false;
      if (withSound !== this.sound) {
        this.hear();
      }
      return;
    }
    if (!this.film) {
      /* the scene is still arriving: keep the choice, not the click */
      this.wanted = withSound;
      return;
    }
    this.gate = false;
    if (withSound) {
      this.sound = true;
      this.film.sound(true);
    }
    this.applyBeat(this.beats[0]!, true);
    this.booted = true;
    this.lastTick = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    /**
     * ONE MORE PASS, on purpose. A region's first render collects no
     * score — `firstRender` compiles an empty tree — so the run only
     * exists after a SECOND pass, and that pass has to be paid for by a
     * tracked write somewhere. Every cut so far happened to buy one
     * within a second (a cue firing, a cycle stepping); a cut whose head
     * beat writes nothing — one quiet beat, deep-linked — never did, and
     * the film stood at its first pose forever. Bumping the lap edits
     * the sequence's name, which is a real edit the region must collect.
     */
    window.setTimeout(() => {
      this.lap += 1;
      this.rolling = true;
    }, 0);
  };

  private beginSound = () => this.begin(true);
  private beginMute = () => this.begin(false);

  /** the whole film's running time, said the way a poster says it */
  get runtime(): string {
    const s = BEATS.reduce((n, b) => n + b.ticks, 0) * TICK;
    return `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim();
  }

  /** back in from the end card */
  private replay = () => {
    this.ended = false;
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
        {{! the traces themselves live IN the scene now (see traceShape);
        the glass keeps only what must connect DOM to world — the leader
        from a caption, the mark's tether, the ring on a named point }}
        <svg class="tf-track" aria-hidden="true" {{this.trackEls}}>
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
            {{#if this.rolling}}
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
                      <p
                        class="tf-kanji {{this.glyphTone}}"
                        {{motion id="kanji" role="glyph"}}
                      >
                        {{b.kanji}}
                      </p>
                    </div>
                  {{/if}}
                {{/unless}}
                {{#if b.romaji}}
                  <div class="tf-plane">
                    <p class="tf-read" {{motion id="read" role="read"}}>
                      <span class="tf-romaji">{{b.romaji}}</span>
                      {{#if b.gloss}}
                        <span class="tf-gloss">{{b.gloss}}</span>
                      {{/if}}
                    </p>
                  </div>
                {{/if}}
                {{! KINETIC TYPE, not a paragraph. Each phrase is its own
                sprite with its own role, because Choreo's text delivery
                splits a sprite and ladders INSIDE it — a stagger across
                four separate lines has to be four steps with four delays.
                Which is the honest way to write it anyway: these are
                cues, and a cue has a time. }}
                {{#each b.says as |say index|}}
                  <div class="tf-plane">
                    {{! the inner span is the line's BEHAVIOR: Motion owns
                    the p (delivery), the wrapper owns the plane (drift),
                    and this owns what the words themselves do — so a line
                    about flaring can flare without three writers fighting
                    over one transform. Styled per line, by address. }}
                    <p
                      class="tf-say"
                      {{motion id=(concat "say" index) role=(concat "s" index)}}
                    ><span
                        class="tf-sayx sx-{{b.id}}-{{index}}"
                      >{{say}}</span></p>
                  </div>
                {{/each}}
              </div>
              {{/each}}
            {{/if}}

            <n.Parallel>
              <n.Tween
                @of={{array
                  (n.removed "kick")
                  (n.removed "glyph")
                  (n.removed "read")
                }}
                @opacity={{array 1 0}}
                @duration={{0.3}}
                @ease="easeIn"
              />
              <n.Tween
                @of={{n.inserted "kick"}}
                @opacity={{array 0 1}}
                @duration={{0.6}}
                @ease="easeOut"
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
                @stagger={{0.09}}
                @delay={{0.12}}
                @opacity={{array 0 1}}
                @duration={{1.0}}
                @ease="easeOut"
              />
              <n.Tween
                @of={{n.inserted "read"}}
                @delay={{0.5}}
                @opacity={{array 0 1}}
                @duration={{0.7}}
                @ease="easeOut"
              />
              {{! four slots, landing ACROSS the beat rather than together —
              and paced against the measured read (see `sayAt`), so the
              last cue lands as the voice finishes whether the line runs
              four seconds or thirteen }}
              <n.Tween
                @of={{n.inserted "s0"}}
                @delay={{get this.sayAt 0}}
                @opacity={{array 0 1}}
                @duration={{0.8}}
                @ease="easeOut"
              />
              <n.Tween
                @of={{n.inserted "s1"}}
                @delay={{get this.sayAt 1}}
                @opacity={{array 0 1}}
                @duration={{0.8}}
                @ease="easeOut"
              />
              <n.Tween
                @of={{n.inserted "s2"}}
                @delay={{get this.sayAt 2}}
                @opacity={{array 0 1}}
                @duration={{0.8}}
                @ease="easeOut"
              />
              <n.Tween
                @of={{n.inserted "s3"}}
                @delay={{get this.sayAt 3}}
                @opacity={{array 0 1}}
                @duration={{0.8}}
                @ease="easeOut"
              />
              <n.Tween
                @of={{array
                  (n.removed "s0")
                  (n.removed "s1")
                  (n.removed "s2")
                  (n.removed "s3")
                }}
                @opacity={{array 1 0}}
                @duration={{0.3}}
                @ease="easeIn"
              />
            </n.Parallel>
          </Choreo>

          {{! THE STAMP. The lineup's kanji, hit onto the frame with each
          tower — a new element per step so the strike replays from its
          own first frame, exactly the wipe's trick. It is a hanko, not a
          title: it lands hard, settles at once, and is simply replaced. }}
          {{#if this.stamp}}
            {{#each (array this.cycleStep) key="@identity"}}
              <p class="tf-stamp" aria-hidden="true">{{this.stamp}}</p>
            {{/each}}
          {{/if}}

          {{! THE PHOTOGRAPH. Cut in on the side the type is not using, and
          wiped rather than faded — a fade says "meanwhile", a wipe says
          "and here it is". It carries its own credit, because a museum
          caption without one is a museum caption nobody can check. }}
          {{#if (if this.rolling this.hasPhoto false)}}
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

          {{! the transport: one segment per chapter, filled by the whole
          film's progress, and each segment is a door into its chapter }}
          <div class="tf-rail">
            <span class="tf-rail-n">{{this.chapter.n}}</span>
            <span class="tf-rail-t">{{this.chapter.title}}</span>
            <span class="tf-rail-segs">
              {{#each this.transport as |c|}}
                <button
                  type="button"
                  class="tf-rail-seg {{if c.here 'is-here'}}"
                  style={{c.flexStyle}}
                  title="{{c.n}} {{c.title}}"
                  {{on "click" (fn this.pick c.head)}}
                ><i style={{c.fillStyle}}></i></button>
              {{/each}}
            </span>
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
          <Choreo
            @onCamera3D={{this.shot}}
            @onPerform={{this.dispatch}}
            @camera3dFrom={{this.openPose}}
            as |c|
          >
            <i class="tf-rig" {{motion id="rig"}} aria-hidden="true"></i>
            {{#if this.playing}}
              <c.Sequence @name={{this.filmName}}>
                <c.Camera3D
                  @name="film"
                  @through={{this.path}}
                  @duration={{this.filmSeconds}}
                  @ease="linear"
                  @tension={{0.26}}
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

        {{! THE GATE. The film is narrated, so the front door asks — and
        the click that answers is the same gesture autoplay policy wants.
        The scene stands behind it, already seated on the opening frame. }}
        {{! FRONT MATTER. The gate runs the title package: a rule draws
        down like a hanging scroll, the kanji settle out of a blur one
        after the other, the wordmark tracks IN from letterspaced air,
        and the seal stamps last — the same seal-red the lineup stamps
        with, so the film opens and closes in one visual language. }}
        {{#if this.gate}}
          <div class="tf-gate">
            <div class="tf-gate-in tf-matter">
              <i class="tf-mg-rule" aria-hidden="true"></i>
              <p class="tf-gate-k"><span class="tf-mg-g1">天</span><span
                  class="tf-mg-g2"
                >守</span></p>
              <p class="tf-gate-t tf-mg-mark">TOWERS</p>
              <p class="tf-gate-s tf-mg-sub">A construction study ·
                {{this.runtime}}</p>
              <span class="tf-mg-seal" aria-hidden="true">普請</span>
              <div class="tf-gate-row tf-mg-row">
                <button
                  type="button"
                  class="tf-go"
                  {{on "click" this.beginSound}}
                >▶ Begin — with sound</button>
                <button
                  type="button"
                  class="tf-go is-quiet"
                  {{on "click" this.beginMute}}
                >begin muted</button>
              </div>
            </div>
          </div>
        {{/if}}

        {{! THE END CARD. It arrives a moment after the last line has
        settled, over the held final frame — the film does not loop past
        its own ending; watching again is the viewer's choice. }}
        {{#if this.ended}}
          <Choreo class="tf-end" as |m|>
            {{! BACK MATTER — the same package, run in reverse order of
            importance: the end glyph, the mark, then the credits a
            finished film owes. }}
            <div class="tf-end-in tf-matter" {{motion id="end" role="card"}}>
              <i class="tf-mg-rule" aria-hidden="true"></i>
              <p class="tf-end-k"><span class="tf-mg-g1">終</span></p>
              <p class="tf-end-t tf-mg-mark">TOWERS</p>
              <p class="tf-end-s tf-mg-sub">A construction study</p>
              <span class="tf-mg-seal" aria-hidden="true">天守</span>
              <p class="tf-mg-credits">
                <span>Scene — threeui · Meng To</span>
                <span>Voice — Calvin · ElevenLabs</span>
                <span>Cut by a score · Choreo</span>
              </p>
              <div class="tf-gate-row tf-mg-row">
                <button
                  type="button"
                  class="tf-go"
                  {{on "click" this.replay}}
                >↺ Watch again</button>
                <button
                  type="button"
                  class="tf-go is-quiet"
                  {{on "click" this.toc}}
                >☰ Chapters</button>
              </div>
            </div>
            <m.Tween
              @of={{m.inserted "card"}}
              @delay={{0.7}}
              @opacity={{array 0 1}}
              @y={{array 18 0}}
              @duration={{0.9}}
              @ease={{array 0.22 1 0.36 1}}
            />
            <m.Tween
              @of={{m.removed "card"}}
              @opacity={{array 1 0}}
              @duration={{0.2}}
              @ease="easeIn"
            />
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

        <div class="tf-controls {{if this.gate 'is-away'}}">
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
        --tf-lut: saturate(0.9) contrast(0.94) brightness(1.2);
        --tf-warm: #ffd9a8;
        --tf-cool: #b9c8e6;
        --tf-grade-a: 0.3;
        --tf-vig-a: 0.5;
      }

      .is-grade-iron {
        --tf-lut: saturate(0.72) contrast(0.98) brightness(1.12) sepia(0.1);
        --tf-warm: #e8d9c2;
        --tf-cool: #9fb0c8;
        --tf-grade-a: 0.4;
        --tf-vig-a: 0.65;
      }

      /* MIDDAY, and it is meant to be the brightest thing in the film.
         The construction chapter is the one that has to read as
         information — you are watching a building get assembled — so it
         is pushed up and opened out until it is nearly a working
         drawing, and it earns its brightness by sitting between two
         chapters that are deliberately heavier. Contrast between
         chapters is a bigger effect than contrast inside one. */
      .is-grade-chalk {
        --tf-lut: saturate(0.88) contrast(0.96) brightness(1.34);
        --tf-warm: #fffdf6;
        --tf-cool: #cfdde8;
        --tf-grade-a: 0.2;
        --tf-vig-a: 0.22;
      }

      .is-grade-ink {
        --tf-lut: saturate(0.98) contrast(1) brightness(1.16);
        --tf-warm: #ffc9a1;
        --tf-cool: #8fa0c9;
        --tf-grade-a: 0.32;
        --tf-vig-a: 0.68;
      }

      .is-grade-plate {
        --tf-lut: saturate(0.86) contrast(0.95) brightness(1.2);
        --tf-warm: #f6e8d2;
        --tf-cool: #c3c8bd;
        --tf-grade-a: 0.18;
        --tf-vig-a: 0.36;
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
          rgba(24, 18, 8, 0.16) 0%,
          rgba(24, 18, 8, 0.34) 100%
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

      /* the marker glows, and the glow is doing real work: a thin line
         over moss competes with the moss at exactly its own frequency,
         and a soft bloom gives the eye a low-frequency edge to catch
         first. (The traces on the building carry their own glow shell in
         the scene now; this dresses only what is still on the glass.) */
      .tf-leader,
      .tf-track circle {
        filter: drop-shadow(0 0 3px rgba(255, 36, 18, 0.95))
          drop-shadow(0 0 11px rgba(255, 60, 20, 0.55));
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
        /* a cue is a phrase: wide enough that most set on ONE line, and
           balanced when they must break, so a wrap is an even couplet
           and never a widowed word */
        max-width: 26ch;
        text-wrap: balance;
      }

      .tf-say:last-child {
        margin-bottom: 0;
      }

      /* tall scripts (Thai, Khmer) at kanji size collide with their
         neighbours; scale the whole set box and give the marks headroom */
      .tf-kanji.is-tall {
        zoom: 0.58;
        line-height: 1.5;
      }

      /* ---- lines that DO what they SAY ------------------------------ *
         Behavior animations on the inner span, addressed per line. They
         run the length of the beat, so whenever the delivery reveals a
         line it is already mid-behavior — never waiting, never done. */
      .tf-sayx {
        display: inline-block;
      }

      /* "Vertical at the top" — dead plumb: a rigid drop, no ease-out
         wobble, arriving like a plumb line snapping taut */
      .sx-ishi2-0 {
        animation: tf-plumb 7s cubic-bezier(0.6, 0, 0.1, 1) both;
      }

      @keyframes tf-plumb {
        0% {
          transform: translateY(-16px) scaleY(1.18);
        }

        100% {
          transform: translateY(0) scaleY(1);
        }
      }

      /* "Flaring at the foot" — the line itself flares, tracking wide
         from its left foot for the whole shot, the batter's own curve */
      .sx-ishi2-1 {
        transform-origin: 0 100%;
        animation: tf-flare 11s linear both;
      }

      @keyframes tf-flare {
        0% {
          letter-spacing: 0;
        }

        100% {
          letter-spacing: 0.13em;
        }
      }

      /* "The shock runs into the hill" — an impact that lands, digs a
         hair past its mark, and settles */
      .sx-ishi2-2 {
        animation: tf-sink 8s cubic-bezier(0.34, 1.3, 0.36, 1) both;
      }

      @keyframes tf-sink {
        0% {
          transform: translateY(-14px);
        }

        34% {
          transform: translateY(2px);
        }

        100% {
          transform: translateY(0);
        }
      }

      /* "And that weight is what steadies it" — the kawara line carries
         mass: it settles downward once, heavily, and does not move again */
      .sx-kawara-2 {
        animation: tf-sink 9s cubic-bezier(0.5, 1.2, 0.4, 1) both;
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

      .tf-rail-segs {
        display: flex;
        gap: 5px;
        width: 240px;
      }

      /* each segment is a 13px-tall click target drawing a hairline
         track with its fill on top; the current chapter's bar thickens */
      .tf-rail-seg {
        appearance: none;
        position: relative;
        border: 0;
        height: 13px;
        padding: 0;
        background: transparent;
        cursor: pointer;
        pointer-events: auto;
      }

      .tf-rail-seg::after {
        content: '';
        position: absolute;
        inset: 5px 0 auto;
        height: 3px;
        background: var(--tf-rule);
      }

      .tf-rail-seg i {
        position: absolute;
        left: 0;
        top: 5px;
        height: 3px;
        z-index: 1;
        background: var(--tf-accent);
        transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      .tf-rail-seg.is-here i {
        top: 4px;
        height: 5px;
      }

      .tf-rail-seg:hover::after {
        background: var(--tf-ink2);
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
        /* one line, one height — a pill that wraps its label reads as a
           different control from its neighbours */
        white-space: nowrap;
        flex: none;
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

      /* the transport waits outside while the front door is open; it
         keeps its height so the frame does not reflow when it returns */
      .tf-controls.is-away {
        visibility: hidden;
      }

      /* a clear beat owns nothing on the glass, the numeral included */
      .tf-clear .tf-ghost {
        display: none;
      }

      /* ---- the gate --------------------------------------------------- */
      /* the card stands BESIDE the tower, never over it: the boot pose
         seats the building left of centre, so the door takes the right
         third — the same real estate the title beat's type owns — and
         its wash leans that way too instead of dimming the whole frame */
      .tf-gate {
        position: absolute;
        inset: 0;
        z-index: 7;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        background: linear-gradient(
          100deg,
          rgba(28, 22, 10, 0.08) 32%,
          rgba(28, 22, 10, 0.62) 74%
        );
        backdrop-filter: blur(1px);
      }

      .tf-gate-in {
        text-align: center;
        font-family: var(--tf-ui);
        color: #f7f0e0;
        margin-right: clamp(24px, 8vw, 140px);
      }

      .tf-gate-k {
        margin: 0;
        font-family: var(--tf-display);
        font-size: min(17vh, 15vw);
        line-height: 1.04;
        text-shadow: 0 6px 60px rgba(20, 14, 4, 0.5);
      }

      .tf-gate-t {
        margin: 10px 0 0;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.5em;
        text-indent: 0.5em;
      }

      .tf-gate-s {
        margin: 6px 0 30px;
        font-size: 12px;
        letter-spacing: 0.14em;
        color: rgba(247, 240, 224, 0.72);
      }

      .tf-gate-row {
        display: flex;
        gap: 12px;
        justify-content: center;
      }

      .tf-go {
        appearance: none;
        font: inherit;
        font-family: var(--tf-ui);
        font-size: 13px;
        letter-spacing: 0.12em;
        cursor: pointer;
        padding: 12px 26px;
        border-radius: 999px;
        border: 1px solid #f2e9d2;
        background: #f2e9d2;
        color: #2e2515;
      }

      .tf-go:disabled {
        opacity: 0.45;
        cursor: default;
      }

      .tf-go.is-quiet {
        background: transparent;
        color: #f2e9d2;
        border-color: rgba(242, 233, 210, 0.5);
      }

      .tf-go.is-quiet:hover {
        border-color: #f2e9d2;
      }

      /* ---- the title package ---------------------------------------- *
         One motion system for front and back matter, staged like a
         broadcast title: rule, glyphs, mark, sub, seal, controls. All
         CSS — these screens live outside the score on purpose, since
         both exist precisely when the film is not running. */
      .tf-matter {
        position: relative;
      }

      .tf-mg-rule {
        display: block;
        width: 1px;
        height: 56px;
        margin: 0 auto 18px;
        background: rgba(247, 240, 224, 0.65);
        transform-origin: 50% 0;
        animation: tf-mg-rule 900ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }

      @keyframes tf-mg-rule {
        0% {
          transform: scaleY(0);
        }

        100% {
          transform: scaleY(1);
        }
      }

      .tf-mg-g1,
      .tf-mg-g2 {
        display: inline-block;
        animation: tf-mg-glyph 1300ms cubic-bezier(0.22, 1, 0.36, 1) both;
        animation-delay: 350ms;
      }

      .tf-mg-g2 {
        animation-delay: 650ms;
      }

      @keyframes tf-mg-glyph {
        0% {
          opacity: 0;
          filter: blur(16px);
          transform: translateY(10px);
        }

        100% {
          opacity: 1;
          filter: blur(0);
          transform: translateY(0);
        }
      }

      /* the wordmark tracks IN — from letterspaced air to its set width,
         the oldest move in broadcast titles because nothing else says
         "this is the name" as quietly */
      .tf-mg-mark {
        animation: tf-mg-track 1400ms cubic-bezier(0.22, 1, 0.36, 1) both;
        animation-delay: 1050ms;
      }

      @keyframes tf-mg-track {
        0% {
          opacity: 0;
          letter-spacing: 1.1em;
        }

        100% {
          opacity: 1;
          letter-spacing: 0.5em;
        }
      }

      .tf-mg-sub {
        animation: tf-mg-fade 800ms ease-out both;
        animation-delay: 1650ms;
      }

      .tf-mg-row {
        animation: tf-mg-fade 800ms ease-out both;
        animation-delay: 2250ms;
      }

      .tf-mg-credits {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0 0 22px;
        font-size: 11px;
        letter-spacing: 0.14em;
        color: rgba(247, 240, 224, 0.6);
        animation: tf-mg-fade 900ms ease-out both;
        animation-delay: 2050ms;
      }

      @keyframes tf-mg-fade {
        0% {
          opacity: 0;
          transform: translateY(6px);
        }

        100% {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* the seal: the lineup's stamp, miniature — it lands hard and
         late, canted the way a hand cants it */
      .tf-mg-seal {
        position: absolute;
        top: 8px;
        right: -34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 58px;
        writing-mode: vertical-rl;
        font-family: var(--tf-display);
        font-size: 19px;
        letter-spacing: 0.14em;
        color: #f7f0e0;
        background: var(--tf-mark);
        border-radius: 3px;
        animation: tf-mg-seal 500ms cubic-bezier(0.16, 1.2, 0.3, 1) both;
        animation-delay: 1900ms;
      }

      @keyframes tf-mg-seal {
        0% {
          opacity: 0;
          transform: rotate(-4deg) scale(1.6);
        }

        30% {
          opacity: 1;
          transform: rotate(-4deg) scale(0.97);
        }

        100% {
          opacity: 0.94;
          transform: rotate(-4deg) scale(1);
        }
      }

      /* ---- the end card ---------------------------------------------- */
      .tf-end {
        position: absolute;
        inset: 0;
        z-index: 6;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(28, 22, 10, 0.5);
        backdrop-filter: blur(2px);
      }

      .tf-end-in {
        text-align: center;
        font-family: var(--tf-ui);
        color: #f7f0e0;
      }

      .tf-end-k {
        margin: 0;
        font-family: var(--tf-display);
        font-size: min(18vh, 19vw);
        line-height: 1;
        text-shadow: 0 6px 60px rgba(20, 14, 4, 0.55);
      }

      .tf-end-t {
        margin: 12px 0 0;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0.5em;
        text-indent: 0.5em;
      }

      .tf-end-s {
        margin: 6px 0 26px;
        font-size: 12px;
        letter-spacing: 0.14em;
        color: rgba(247, 240, 224, 0.7);
      }

      /* ---- the stamp -------------------------------------------------- *
         A hanko, not a title: it strikes, settles at once, and is simply
         replaced by the next. Seal-red on purpose — it shares the
         annotation's ink because it IS an annotation, pressed over each
         tower as the lineup calls the roll. */
      .tf-stamp {
        position: absolute;
        inset: 0;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        pointer-events: none;
        font-family: var(--tf-display);
        font-weight: 700;
        font-size: min(24vh, 16vw);
        letter-spacing: 0.04em;
        color: var(--tf-mark);
        mix-blend-mode: multiply;
        animation: tf-stamp 700ms cubic-bezier(0.16, 1.3, 0.3, 1) both;
      }

      @keyframes tf-stamp {
        0% {
          opacity: 0;
          transform: rotate(-2.5deg) scale(1.5);
        }

        16% {
          opacity: 0.92;
          transform: rotate(-2.5deg) scale(0.99);
        }

        100% {
          opacity: 0.88;
          transform: rotate(-2.5deg) scale(1);
        }
      }

      /* the app's own chrome, gone: this route is a frame, not a page */
      body.tf-film .topbar,
      body.tf-film .footer {
        display: none;
      }
    </style>
  </template>
}
