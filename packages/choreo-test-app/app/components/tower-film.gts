import { array, concat, fn, get } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { at, Choreo, motion, type PerformCommand } from 'glimmer-motion';
import TowersNotes from 'test-app/components/notes/towers';
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
  /**
   * HOW THE SEAM PLAYS, for a cut beat (docs/choreo-splices.md):
   * 'wipe' (default) — clean splice plus the raked paper flash;
   * 'cut' — the splice alone;
   * 'whip' — no snap: the chaser races a stiff spring across the jump,
   * a fast smooth tween that never glides;
   * 'blend' — a freeze-blend dissolve (the crossfade): the outgoing
   * frame is captured the instant before the snap and fades over the
   * live incoming shot;
   * 'dip' — fade through a colour: the freeze holds the old shot while
   * a veil covers it, the snap happens under the veil, and the veil
   * lifts on the new shot. `dipTo` picks the colour;
   * 'iris' — the old shot closes in a circle onto the new shot's named
   * point (`to`), handing the eye straight to the subject;
   * 'blur' — a blur dissolve: the old frame defocuses as it thins;
   * 'luma' — an optical dissolve: the old frame fades in lighten blend,
   * so its highlights linger longest, the way film stock dissolved;
   * 'flash' — a two-breath white pop, no freeze: the gun-crack join;
   * 'defocus' — a rack: the old frame blurs away while the incoming
   * shot arrives soft and pulls itself sharp;
   * 'sweep' — the sun itself flares across the seam and settles.
   */
  dipTo?: string;
  /** the English of the kanji, set small under it */
  gloss?: string;
  /** which of the six towers stands here; overrides the chapter's grade */
  grade?: string;
  /** how thick the air is, 0 the hour's own and 1 as heavy as it goes */
  haze?: number;

  /**
   * A DRONE DOES NOT HOLD PERFECTLY STILL. Degrees of vertical sway
   * added on top of whatever the shot is already doing — a slow rise
   * and settle through the beat, which is what a camera in the air
   * actually does and what makes a locked-off orbit read as flown
   * rather than rendered.
   */
  bob?: number;

  /**
   * THE BUILDING LEAVES BY FADING, not by sinking. Running the build
   * clock backwards moves the tower down out of its own frame, and
   * since the film builds it straight back afterwards, that movement is
   * a journey to nowhere. A dissolve says "gone" and leaves the shot
   * composed exactly as it was.
   */
  dissolve?: boolean;

  /**
   * A BACKLIGHT, standing opposite the lens. For the night beats: a
   * dark building against a dark sky is a rectangle of nothing, and
   * every night exterior ever shot cheats exactly this way.
   */
  rim?: number;

  /**
   * HOW HARD IT RAINS, over and above the weather preset. The scene's
   * rain is mixed for its own wide landing shot and all but vanishes on
   * a long lens — and a beat whose whole argument is that the roof
   * exists to shed water has to SHOW the water.
   */
  rain?: number;
  /**
   * A DESIGNED SILENCE. By default a beat with no line of its own is an
   * L-CUT: the outgoing narration finishes across the seam and fades on
   * its own clock, the way every editor lets a sentence land over the
   * next shot. A beat that is ABOUT silence sets this, and the boundary
   * fades whatever is still speaking.
   */
  hush?: boolean;
  id: string;
  join?:
    | 'blend'
    | 'blur'
    | 'cut'
    | 'defocus'
    | 'dip'
    | 'flash'
    | 'iris'
    | 'luma'
    | 'melt'
    | 'sweep'
    | 'whip'
    | 'wipe';
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
    /**
     * WHEN THE WORD ARRIVES, as a fraction of the beat. A word naming a
     * thing that is still being built has to wait for the thing: the
     * stone base beat opens on bare ground, and 石垣 turning up over an
     * empty field names nothing. Default is early (0.14); the first
     * stage waits until its wall is properly out of the ground.
     */
    at?: number;
    /** degrees round the orbit, fixed in the world */
    bearing: number;
    /**
     * HOW LONG IT STAYS, as a fraction of the beat. Not every word owes
     * the same time: the first stage is one of five and can get out of
     * the way, the last one is the building topping out and can hold
     * while the roof lands.
     */
    hold?: number;
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
   * TICKS SPENT ARRIVING, before this beat's own first waypoint.
   *
   * A cut is the right join inside a passage and the wrong one between
   * passages: chapters change the sun, the air and the argument at once,
   * and the sweep that carries the lens from one to the next is the
   * thing this engine is actually good at. A beat with a lead is not cut
   * in — the path flies to its pose over `lead` ticks first, the sky
   * crossfades across that flight (an `air` cue fires at its start), and
   * the beat's own type lands when the lens does.
   */
  lead?: number;
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
 * WHICH CUT OF THE FILM THIS IS.
 *
 * A dev server serves the app from source but the motion library from
 * its BUILT package, so an editor and a browser can disagree about what
 * is running with nothing on screen to say so — an afternoon was spent
 * arguing about a fix that was never loaded. The stamp is logged at
 * boot and shown in the corner under `?debug`, so "is my page current?"
 * is a glance rather than a theory.
 */
const BUILD = 'cut-6 · no join outlives its own play';

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
    cam: { dolly: 0.46, lookY: -1.2, ox: 0.3, pitch: 12, yaw: -46 },
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
    /* THE SECOND SHOT SETS THE PACE. The title crawls on purpose; if the
       shot after it crawls too, a viewer concludes the whole film does.
       This one moves: the lens falls away from the stone by nearly half
       while the ground swings twenty degrees under it — a scale change
       reads faster than any orbit, and it lands exactly on the next
       shot's pose so the cut is still forward. */
    toCam: { dolly: 1.2, lookY: 4.2, ox: -0.1, pitch: 6, yaw: 2 },
  },
  {
    cam: { dolly: 0.72, lookY: 1.0, ox: 0.16, pitch: 8, yaw: 2 },
    ch: 0,
    /* out of the worm's-eye and into the argument on the long, soft
       one: two shots of the same thought, so the seam should be felt
       and not seen (nearly two seconds, no push, no colour) */
    cut: true,
    gloss: 'keep · watchtower',
    id: 'what',
    join: 'melt',
    says: ['A lookout.', 'A strongroom.', 'An argument.'],
    kanji: '天守閣',
    kicker: 'ONE BUILDING, THREE JOBS',
    vo: 'A lookout. A strongroom. An advert. You can guess which one got the money.',
    mode: 'plate',
    romaji: 'TENSHUKAKU',
    ticks: 4,
    /* the line is "the castle is the ground": the lens has to let go of
       the building and show the ditches and shelves it sits in, so the
       shot ends a good deal wider than it began */
    toCam: { dolly: 0.44, lookY: 0.2, ox: 0.16, pitch: 11, yaw: 13 },
  },

  /* ---------------------------------------------------------------- *
   * 02 — HISTORY: where the form comes from, and why it stopped
   * ---------------------------------------------------------------- */
  {
    cam: { dolly: 0.9, lookY: 1.4, ox: 0.14, pitch: 6, yaw: 18 },
    ch: 1,
    /* HISTORY does not open through black any more. A CHAPTER changes
       the sun, the air and the argument at once, and the sweep that
       carries the lens there is the connective tissue a cut throws
       away — so chapter heads fly in over two ticks and the sky turns
       under them (Beat.lead). Quick cuts belong INSIDE a passage. */
    lead: 2,
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
    toCam: { dolly: 0.82, lookY: 1.9, ox: 0.14, pitch: 8, yaw: 31 },
  },
  {
    cam: { dolly: 1.15, lookY: -2.6, ox: -0.1, pitch: 1, yaw: 34 },
    ch: 1,
    /* the guns arrive the way guns arrive */
    cut: true,
    gloss: 'the matchlock gun',
    id: 'teppo',
    join: 'flash',
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
    /* the edict is the film's one night shot: without a light behind
       it the keep is a silhouette of nothing */
    rim: 1.15,
    romaji: 'IKKOKU-ICHIJŌ-REI',
    theme: 3,
    ticks: 5,
    toCam: { dolly: 0.8, lookY: 1.4, ox: 0.16, pitch: 10, yaw: 65 },
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
    /* out of the edict's night into the building morning — swept, not
       cut: the night lifts across the flight (Beat.lead). The standing
       keep is then WIPED off the field, because the next four minutes
       are about putting one up and it cannot already be there. */
    join: 'wipe',
    lead: 2,
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
      /* the wall has to be out of the ground before it has a name —
         and then it is one stage of five, so it gets out of the way */
      at: 0.42,
      bearing: 120,
      hold: 0.2,
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
    /* a building site is a DAYTIME place: the stone goes down in real
       light, not in the last of it — the low sun here made the whole
       construction chapter look like an evening */
    sun: { az: -70, el: 36 },
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
      /* the last one is the building topping out: let it stand while
         the roof lands */
      hold: 0.5,
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
    /* the breath is entered on a dissolve, not a step */
    cut: true,
    hush: true,
    id: 'muneage',
    join: 'blend',
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
    lead: 2,
    /* raking, not overhead: a profile is only visible when the light
       crosses it, and this whole chapter is about profiles */
    sun: { az: -88, el: 23 },
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
    /* THE DETAIL CHAPTER USES ONE JOIN. Five different transitions
       between five views of the same roof read as five different films;
       an editor picks one grammar for a passage and keeps it. The push
       dissolve is the quiet one — it moves, so the cut is felt, and it
       carries no colour of its own. */
    join: 'blend',
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
    join: 'blend',
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
    join: 'blend',
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
    join: 'blend',
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
    /* the weather beat arrives through its own mist */
    cut: true,
    gloss: 'the eave',
    id: 'noki',
    join: 'blend',
    says: [
      'A metre of overhang',
      'It keeps water off the wall',
      'Style is drainage, first',
    ],
    kanji: '軒',
    kicker: 'AND THE REASON FOR ALL OF IT',
    vo: "Noki. A metre of overhang. Every line you have admired is a way of keeping rain off earth and wood. Wait for weather; the styling explains itself.",
    mode: 'lower',
    /* an overcast grade for an overcast shot: the sky comes down, the
       warmth goes out of it, and the vignette closes a little — rain
       under a bright even sky is a particle effect, not weather */
    grade: 'wet',
    haze: 0.62,
    rain: 1.15,
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
    /* the museum plate arrives through paper — a light dip, not a dark
       one: the gallery wall, not the passage of time */
    lead: 2,
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
    toCam: { dolly: 0.66, lookY: 1.8, ox: 0.02, pitch: 10, yaw: 211 },
    wx: 0,
  },
  {
    cam: { dolly: 0.78, lookY: -3.6, ox: -0.2, pitch: 2, yaw: 210 },
    ch: 4,
    /* the first of the six enters the way the other five do — and a
       seam here lets the plate shot ahead of it carry a real drift */
    cut: true,
    gloss: 'Japan · the keep',
    bob: 1.5,
    grade: 'c-jp',
    id: 'c-jp',
    toCam: { dolly: 1.58, lookY: 4.4, ox: -0.16, pitch: 15, yaw: 238 },
    join: 'blend',
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
    cam: { dolly: 1.62, lookY: 4.6, ox: -0.16, pitch: 16, yaw: 238 },
    ch: 4,
    gloss: 'China · the pagoda',
    cut: true,
    bob: 1.5,
    grade: 'c-cn',
    id: 'c-cn',
    toCam: { dolly: 0.84, lookY: -2.8, ox: -0.22, pitch: 3, yaw: 214 },
    join: 'blend',
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
    cam: { dolly: 1.66, lookY: 5.2, ox: -0.16, pitch: 15, yaw: 250 },
    ch: 4,
    gloss: 'Vietnam · the tower',
    cut: true,
    bob: 1.5,
    grade: 'c-vn',
    id: 'c-vn',
    toCam: { dolly: 0.82, lookY: -3.2, ox: -0.22, pitch: 2, yaw: 276 },
    join: 'blend',
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
    cam: { dolly: 0.92, lookY: -5.4, ox: -0.22, pitch: -6, yaw: 276 },
    ch: 4,
    gloss: 'Thailand · the prang',
    cut: true,
    bob: 1.5,
    grade: 'c-th',
    id: 'c-th',
    toCam: { dolly: 1.6, lookY: 3.6, ox: -0.15, pitch: 14, yaw: 300 },
    join: 'blend',
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
    cam: { dolly: 1.2, lookY: -2.2, ox: -0.26, pitch: 5, yaw: 300 },
    ch: 4,
    gloss: 'Cambodia · the sanctuary',
    cut: true,
    bob: 1.5,
    grade: 'c-kh',
    id: 'c-kh',
    toCam: { dolly: 1.48, lookY: 2.4, ox: 0.02, pitch: 11, yaw: 278 },
    join: 'blend',
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
    cam: { dolly: 1.42, lookY: 5.6, ox: -0.16, pitch: 17, yaw: 278 },
    ch: 4,
    gloss: 'Türkiye · the mosque',
    cut: true,
    bob: 1.5,
    grade: 'c-tr',
    id: 'c-tr',
    toCam: { dolly: 0.9, lookY: -4.6, ox: -0.22, pitch: 1, yaw: 306 },
    join: 'blend',
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
    /* ---------------------------------------------------------------- *
     * THE UN-BUILD.
     *
     * The film ends by taking the tower apart. The scene's build clock
     * is a function of time and nothing stops it running backwards, so
     * the roof lifts, the plaster goes, the timber cage comes down and
     * the stone follows — the scaffolding returning around it as it
     * goes — while the lens pulls back to the frame the film opened on.
     * No other four minutes of this could end this way, and it says the
     * argument (a building is a stack of answers, and every one of them
     * comes apart in the order it went up) without a word of summary.
     * ---------------------------------------------------------------- */
    build: 4.4,
    cam: { dolly: 1.05, lookY: 2.6, ox: -0.02, pitch: 9, yaw: 300 },
    dissolve: true,
    ch: 4,
    cut: true,
    gloss: 'in the order it went up',
    hush: true,
    id: 'unbuild',
    join: 'blend',
    /* GOLDEN HOUR, and it is a decision rather than a mood: the film's
       poster stands in the late light, so ending there closes the loop
       — and a low raking sun is the only light that makes a building
       coming apart read as silhouette rather than as parts. The middle
       chapters stay bright and even because they are explaining; the
       ending is allowed to be beautiful. */
    sun: { az: -104, el: 15 },
    theme: 2,
    kanji: '解体',
    kicker: 'AND BACK DOWN',
    mode: 'lower',
    romaji: 'KAITAI',
    says: ['Nothing here was bolted', 'Every joint was cut to fit'],
    ticks: 7,
    toCam: { dolly: 0.5, lookY: 1.2, ox: -0.02, pitch: 13, yaw: 316 },
  },

  /* ---------------------------------------------------------------- *
   * CODA
   * ---------------------------------------------------------------- */
  {
    cam: { dolly: 0.62, lookY: -0.6, ox: 0.2, pitch: 14, yaw: 256 },
    ch: 4,
    /* the last frame is the empty ground the film started on. The
       closing thought is WRITTEN, not read: the un-build has just made
       the point, and a voice arriving to explain it would be the film
       not trusting its own ending. */
    cut: true,
    id: 'coda',
    join: 'blend',
    /* the last of the same light the door stood in */
    sun: { az: -100, el: 12 },
    theme: 2,
    says: ['A roof', 'built tall enough', 'to be seen from the fields'],
    kanji: '天守',
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
  snapshot(): string;
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

  /** fade a drawn line out where it stands */
  traceFade(id: string, k: number): void;
  view(): {
    az: number;
    el: number;
    fov: number;
    h: number;
    w: number;
    zoom: number;
  };
  wx(i: number, instant?: boolean): void;

  /** scale the rain field the weather preset draws; null hands it back */
  rain(k: number | null): void;

  /** the backlight: intensity, and whether it stands opposite the lens */
  rim(k: number | null, back?: boolean): void;

  /** 1 is the building, 0 is gone — without moving the frame */
  modelFade(k: number | null): void;
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
  /** the captured outgoing frame every freeze-based join plays with */
  @tracked private freeze = '';
  @tracked private blendStamp = 0;
  /** the slow one: a pure crossfade, no push, no colour */
  @tracked private meltStamp = 0;
  /** the 'dip' join's veil colour, and the key that replays the dip */
  @tracked private dipColor = '#0d0905';
  @tracked private dipStamp = 0;
  /** where the iris closes to, as inline custom properties */
  @tracked private irisAt = '';
  @tracked private irisStamp = 0;
  @tracked private blurStamp = 0;
  /** dev beacon: the first uncaught error, worn on the sleeve */
  @tracked private fault = '';
  @tracked private lumaStamp = 0;
  @tracked private flashStamp = 0;
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

  /** where the beat's sky word was planted, in world azimuth */
  private skyAz = 0;

  /** the azimuth the mark word is planted on, behind the building */
  private markAz = 0;
  /** a sideways nudge in world units, for a word too short to centre */
  private markOff = 0;
  /** the height the word rises FROM — set when it actually arrives */
  private markFrom = 2.6;
  private markSeated = false;

  /** the light in force, and the light the beat asked for */
  private sunNow: { az: number; el: number } | null = null;
  private sunGoal: { az: number; el: number } | null = null;

  /* ---- the player ------------------------------------------------- *
   * A film owes its viewer the controls every other film has: a
   * playhead you can put your hand on, chapters you can see coming, a
   * clock, and a way to make it the whole screen. It also owes them the
   * PICTURE — so the whole apparatus stands down when nobody is
   * touching it and comes back on the first movement.
   * ------------------------------------------------------------------ */
  @tracked private idle = false;
  /** the fraction the hand is holding while scrubbing, else null */
  @tracked private scrubAt: number | null = null;
  @tracked private clock = '0:00';
  @tracked private full = false;
  private idleTimer = 0;
  private shownSec = -1;

  /** the whole film, in seconds, leads included */
  private get totalSecs(): number {
    return (
      BEATS.reduce((n, b, i) => n + b.ticks + (i === 0 ? 0 : (b.lead ?? 0)), 0) *
      TICK
    );
  }

  private secsBefore(index: number): number {
    return (
      BEATS.slice(0, index).reduce(
        (n, b, i) => n + b.ticks + (i === 0 ? 0 : (b.lead ?? 0)),
        0
      ) * TICK
    );
  }

  /** one segment per chapter, sized and placed in whole-film fractions */
  get playbar() {
    const total = this.totalSecs;
    return this.chapterHeads.map((head, i) => {
      const end = this.chapterHeads[i + 1] ?? BEATS.length;
      const ch = CHAPTERS[BEATS[head]!.ch] ?? CHAPTERS[0]!;
      const s0 = this.secsBefore(head) / total;
      const sl = (this.secsBefore(end) - this.secsBefore(head)) / total;
      return {
        head,
        n: ch.n,
        style: `flex:${sl};--s0:${s0.toFixed(5)};--sl:${sl.toFixed(5)}`,
        title: ch.title,
      };
    });
  }

  private static mmss(s: number): string {
    const m = Math.floor(Math.max(0, s) / 60);
    return `${m}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  }

  get duration(): string {
    return TowerFilm.mmss(this.totalSecs);
  }

  /** what the hand is pointing at while it drags: the shot it will cut to */
  get scrubLabel(): string {
    if (this.scrubAt === null) {
      return '';
    }
    const want = this.scrubAt * this.totalSecs;
    let i = 0;
    while (i + 1 < BEATS.length && this.secsBefore(i + 1) <= want) {
      i += 1;
    }
    const ch = CHAPTERS[BEATS[i]!.ch] ?? CHAPTERS[0]!;
    return `${ch.n} ${ch.title} · ${TowerFilm.mmss(want)}`;
  }

  private wake = () => {
    if (this.idle) {
      this.idle = false;
    }
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      /* never hide the controls out from under a hand that is using them */
      if (this.scrubAt === null && !this.menu && this.playing) {
        this.idle = true;
      }
    }, 2600);
  };

  private scrubFrom(e: PointerEvent): number {
    const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - el.left) / el.width));
  }

  private scrubDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.scrubAt = this.scrubFrom(e);
  };

  private scrubMove = (e: PointerEvent) => {
    if (this.scrubAt !== null) {
      this.scrubAt = this.scrubFrom(e);
    }
  };

  /**
   * THE PLAYHEAD SNAPS TO A SHOT, because this film cannot seek: the
   * lens is an integrator and a run dropped into its own middle arrives
   * with the wrong velocity (docs/choreo-splices.md). So the drag reads
   * as time, the label names the shot under the hand, and the release
   * RE-CUTS from that shot's head — which is the same edit the chapter
   * buttons and the arrow keys make.
   */
  private scrubUp = (e: PointerEvent) => {
    const at = this.scrubAt ?? this.scrubFrom(e);
    this.scrubAt = null;
    const want = at * this.totalSecs;
    let i = 0;
    while (i + 1 < BEATS.length && this.secsBefore(i + 1) <= want) {
      i += 1;
    }
    this.cutTo(i);
  };

  private screen = () => {
    const el = this.pageEl ?? this.frameEl;
    if (!el) {
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen?.();
    }
  };

  private fullChange = () => {
    this.full = !!document.fullscreenElement;
  };

  /**
   * THE POINTER MOVES THE WORLD A LITTLE.
   *
   * A film that cannot be touched is a video, and the whole argument
   * here is that this is a scene. So the cursor gets a few degrees of
   * lean: the lens takes a fraction of it (real parallax — the building
   * and the hills separate) and the type planes take more of it in the
   * other direction, each layer by its own depth. It is small enough to
   * be felt rather than played with, and damped, so it never fights the
   * shot the score is composing.
   */
  private lean = { x: 0, y: 0 };
  private leanTo = { x: 0, y: 0 };

  private aim = (e: PointerEvent) => {
    const el = this.pageEl ?? this.frameEl;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    this.leanTo.x = Math.max(
      -1,
      Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)
    );
    this.leanTo.y = Math.max(
      -1,
      Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)
    );
  };

  /** the haze the beat asked for — the weather drift breathes around it */
  private hazeBase: number | null = null;

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
    /* the demo page mounts the theater route in an iframe with ?embed —
       Sylva's pattern: the gate, the transport and the dive stand down
       and the film begins muted */
    return (
      (this.args.embed ?? false) || /[?&]embed\b/.test(window.location.search)
    );
  }

  /** `?debug` puts the build stamp in the corner — see BUILD */
  get debug(): boolean {
    return /[?&]debug\b/.test(window.location.search);
  }

  get build(): string {
    return BUILD;
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
    return (
      this.beats.reduce(
        (n, b, i) => n + b.ticks + (i === 0 ? 0 : (b.lead ?? 0)),
        0
      ) * TICK
    );
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
  /**
   * WHERE A SHOT ENDS — the beat's authored tail, floored so it always
   * reads as a move, and clamped so it never travels past the pose the
   * next shot begins on. Shared by the path (which lerps its waypoints
   * across it) and by the LAUNCH: a cut hands the chaser this shot's own
   * speed, so the lens is already travelling when the cut lands rather
   * than easing up from a standstill.
   */
  private tailFor(bi: number): Cam {
    const beats = this.beats;
    const b = beats[bi]!;
    const drift = b.toCam ?? {
      ...b.cam,
      dolly: b.cam.dolly * 1.05,
      pitch: b.cam.pitch + 1.4,
      yaw: b.cam.yaw + 6,
    };
    /**
     * A SHOT MUST MOVE ON SCREEN, not on paper.
     *
     * Frame-differencing a screen capture of the cut said it plainly:
     * outside the seams, whole minutes of this film change by about
     * 5/255 per SECOND — 0.08 per frame, which is nothing at all. The
     * authored tails looked like moves in the score (four to eight
     * degrees of orbit, three per cent of push) and read as STILLS in
     * the picture, because an orbit barely displaces the subject it is
     * aimed at and two chase stages low-pass whatever is left.
     *
     * So a tail is a DIRECTION and a floor, not a distance: what the
     * beat asks for is honoured, and anything slower than a real slow
     * move is stretched up to one. The floors are per second, so a
     * long hold travels further than a short one and every shot drifts
     * at the same speed. The push does most of the work — a scale
     * change moves every pixel and the aim keeps the subject centred —
     * and the orbit gives the background its parallax.
     *
     * A shot that ENDS AT A SEAM may be stretched freely: nothing
     * crosses a cut, so the far side is a different shot and cannot be
     * bounced into. Inside a continuous run the next beat's head is
     * this same lens still travelling, so the stretch stops there —
     * landing exactly on the next head is the smoothest tail there is
     * (the spline crosses it without a corner), and passing it is what
     * makes the camera arrive, back up and go again.
     *
     * Pitch carries a floor too, because orbit alone can fail to READ:
     * the worm's-eye on the stone base moves two degrees a second and
     * changes almost nothing on screen, since a flat wall aimed at
     * from a fixed height looks the same from either side of it. A
     * little tilt moves the whole frame.
     */
    const next = beats[bi + 1];
    const secs = b.ticks * TICK;
    const sgn = (d: number) => (d < 0 ? -1 : 1);
    const stretch = (
      key: 'dolly' | 'ox' | 'pitch' | 'yaw',
      floor: number
    ): number => {
      const head = b.cam[key] ?? 0;
      const d = (drift[key] ?? 0) - head;
      const nose = next ? (next.cam[key] ?? 0) - head : 0;
      /* the direction is the beat's own, or the next shot's if the
         beat asked for nothing at all */
      const way = d !== 0 ? sgn(d) : nose !== 0 ? sgn(nose) : 1;
      /**
       * NEVER TRAVEL PAST WHERE THE NEXT SHOT BEGINS. Inside a run
       * that would make the camera arrive, back up and go again. At a
       * CUT it is worse, and it is what chapter four was doing: the
       * details sit eight or ten degrees apart, the floor asked for
       * twenty-two, so every shot orbited past its successor's pose
       * and the cut jumped BACKWARDS into it — a film that appears to
       * be running one section behind its own captions.
       */
      const reach = !next
        ? Infinity
        : sgn(nose) === way && nose !== 0
          ? Math.abs(nose)
          : 0;
      const want = Math.min(
        Math.max(Math.abs(d), floor),
        Math.max(Math.abs(d), reach)
      );
      return head + way * want;
    };
    /**
     * AND A PAN. Orbit, push and tilt all move the camera AROUND the
     * subject; a lateral drift moves the subject across the frame,
     * which is the one Ken Burns move the others cannot fake — it
     * changes the composition rather than the view. A few hundredths of
     * the frustum over a shot is enough to feel: the building leaves
     * the middle, or arrives in it, while everything else is happening.
     */
    const to = {
      ...drift,
      dolly: stretch(
        'dolly',
        b.cam.dolly * Math.min(0.22, 0.022 * secs)
      ),
      ox: stretch('ox', Math.min(0.07, 0.008 * secs)),
      pitch: stretch('pitch', Math.min(6, 0.45 * secs)),
      yaw: stretch('yaw', Math.min(22, 2 * secs)),
    };
    return {
      dolly: to.dolly,
      lookY: to.lookY,
      ox: to.ox,
      pitch: to.pitch,
      yaw: to.yaw,
    };
  }

  get path() {
    const pts: {
      cut?: boolean;
      dolly: number;
      look: { x: number; y: number; z: number };
      pitch: number;
      x: number;
      y: number;
      yaw: number;
    }[] = [];
    const beats = this.beats;
    for (const [bi, b] of beats.entries()) {
      /**
       * A CUT BEAT'S HEAD IS A SPLICE. The library samples each side as
       * its own clamped shot and steps across the seam at this waypoint's
       * own instant (docs/choreo-splices.md) — no enforced holds, no
       * ticks spent parked, no glide across the jump. A re-cut score
       * (chapter skip) splices its very first waypoint too, so a skip
       * opens inside its shot instead of travelling in from wherever the
       * last run left the lens.
       */
      const splice = b.cut === true || (bi === 0 && this.from > 0);
      const to = this.tailFor(bi);
      /**
       * A HOLD BREATHES. Before the splices, every "held" shot secretly
       * lived on the one spline's residual sway; clamped shots took that
       * away and the holds went DEAD — three static slides in the first
       * minute. A shot with no authored tail now drifts on its own: a
       * few degrees of orbit and a whisper of push over its whole
       * length, too slow to read as a move and just enough that the
       * frame is alive. An authored toCam always wins.
       */
      /* THE ARRIVAL. A lead spends its ticks travelling from wherever
         the last shot finished to this beat's own head, so a chapter
         change is a move rather than a jump. It cannot apply to the
         first beat of a cut: there is nothing behind it to leave. */
      const lead = bi === 0 ? 0 : (b.lead ?? 0);
      const prev = pts[pts.length - 1];
      if (lead > 0 && prev) {
        for (let k = 1; k <= lead; k++) {
          const f = k / (lead + 1);
          pts.push({
            dolly: lerp(prev.dolly, b.cam.dolly, f),
            look: { x: 0, y: lerp(prev.look.y, b.cam.lookY, f), z: 0 },
            pitch: lerp(prev.pitch, b.cam.pitch, f),
            x: lerp(prev.x, b.cam.ox ?? 0, f),
            y: 0,
            yaw: lerp(prev.yaw, b.cam.yaw, f),
          });
        }
      }
      for (let k = 0; k < b.ticks; k++) {
        /**
         * EASED ACROSS THE SHOT, not stepped evenly through it. The
         * waypoints used to be spaced linearly, which asks the spline
         * to hold a constant speed from the first frame to the last —
         * so a long drone move starts and stops abruptly and every
         * waypoint is a small correction. Spacing them on a smoothstep
         * puts the shot's speed in the middle, where a flown camera
         * keeps it, and leaves the ends calm.
         */
        const t = b.ticks === 1 ? 0 : k / (b.ticks - 1);
        const f = t * t * (3 - 2 * t);
        pts.push({
          cut: splice && k === 0 ? true : undefined,
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

  /**
   * Each beat's entrance, as a delay into the one camera step — offset
   * one tick, because the pose-in-force seed occupies the spline's first
   * slot: waypoint k is crossed at (k+1) slots, not k. The old uniform
   * skew was invisible (camera and cues equally late, a constant the
   * chaser's own lag swallowed); a SPLICE made it audible — the snap
   * fired two seconds before the goal stepped, and the chaser spent the
   * gap dragged back toward the old shot. Cue 0 stays at zero: the boot
   * and every re-cut apply their head beat by hand, and its immediate
   * re-fire has always been the first cue's job.
   */
  get cues() {
    let t = 0;
    const out: { action: string; delay: number; index: string }[] = [];
    this.beats.forEach((b, i) => {
      const lead = i === 0 ? 0 : (b.lead ?? 0);
      /**
       * The sky turns while the lens is still travelling: the air cue
       * fires as the sweep BEGINS and the beat's own cue when it lands.
       *
       * (It was briefly moved two ticks earlier, so the hour changed
       * under the end of the previous passage. It reads badly — the
       * light goes while you are still looking at a shot composed for
       * the old light, which is not anticipation, just a mismatch. The
       * change belongs to the move.)
       */
      if (lead > 0) {
        out.push({
          action: 'air',
          delay: t + TICK,
          index: String(i),
        });
      }
      const at = t + lead * TICK;
      t = at + b.ticks * TICK;
      /* a Perform target is a NAME, and a beat's name is its place in the
         script — the index, as a string, so the cue and the array agree */
      out.push({
        action: 'beat',
        delay: at === 0 ? 0 : at + TICK,
        index: String(i),
      });
    });
    return out;
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
  /**
   * HOW MANY CHARACTERS HAVE TO FIT. A vertical setting is as tall as
   * its string, and 一国一城令 is five glyphs — at the plate's own size
   * that column runs off the top of the frame and the film crops its
   * own title. The count goes to CSS, which sizes the column to the
   * height available rather than to a number somebody typed once while
   * looking at a three-glyph word.
   */
  get glyphFit(): string {
    return `--tf-glyphs:${Math.max(2, [...(this.beat.kanji ?? '')].length)}`;
  }

  get glyphTone(): string {
    return /[฀-๿ក-៿]/.test(this.beat.kanji ?? '')
      ? 'is-tall'
      : '';
  }

  get dipVeil(): string {
    return `background:${this.dipColor}`;
  }

  /** the lineup's current kanji; empty between lineups */
  get stamp(): string {
    const c = this.beat.cycle;
    return c && this.cycleStep >= 0 ? (c[this.cycleStep]?.kanji ?? '') : '';
  }

  private mount = modifier((el: HTMLElement) => {
    /* which cut is actually in the browser, said out loud once */
    console.info(`towers: ${BUILD}`);
    this.frameEl = el;
    this.pageEl = el.closest('.tf-page') as HTMLElement;
    window.addEventListener('keydown', this.key);
    window.addEventListener('pointermove', this.aim);
    window.addEventListener('pointermove', this.wake);
    window.addEventListener('wheel', this.wake, { passive: true });
    document.addEventListener('fullscreenchange', this.fullChange);
    /* NOT this.wake() — a modifier runs INSIDE the render pass, and
       `idle` is read by the template in that same computation; writing
       it here is a backtracking rerender, which Ember asserts on and
       which takes the whole pass (and the film) down with it. The timer
       is armed from a timeout instead, which is outside it. */
    window.setTimeout(() => {
      if (this.booted) {
        this.wake();
      }
    }, 0);
    window.addEventListener('error', this.trip);
    window.addEventListener('unhandledrejection', this.trip);
    const frame = el.querySelector('iframe');
    if (!frame) {
      return;
    }
    /* a film owns the whole frame: the app's bar and footer step out
       entirely rather than fading, because unlike Sylva's theater there
       is no lockup here that wants to stay superimposed */
    document.body.classList.add(this.embed ? 'tf-embedded' : 'tf-film');
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
        /* THE POSTER IS AN EVENING. The film proper opens in the morning
           — so the door stands in the last of the light, and pressing it
           turns the day over: the sky crossfades to nine o'clock while
           the lens flies out of the poster's circuit. Two things the
           viewer did not ask for, both answering the same click. */
        w.__film.theme(2, true);
        /* LATE AFTERNOON, not dusk. Sunset light is beautiful and casts
           almost nothing; a poster wants the building to throw a long
           hard shadow across the empty half of the frame, which means
           the sun stays up (about twenty degrees) and comes from the
           side the type is not on. */
        w.__film.light({ az: -105 * RAD, el: 21 * RAD });
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
          return;
        }
        this.posterAt = 0;
        this.posterRaf ??= requestAnimationFrame(this.poster);
        return;
      }
      /* IDEMPOTENT, or nothing. This load path re-runs whenever the
         modifier does (a booted flip re-renders the stage), and an
         unconditional begin(false) here reached the already-booted
         branch and TOGGLED THE SOUND BACK OFF — the "with sound" click
         un-clicking itself one pass later. Only a film that has not
         begun may be begun on its behalf. */
      /**
       * ONLY A FILM WITH NO DOOR STARTS ITSELF. The embed has no gate by
       * design and a deep link has already chosen its shot; the theater
       * route at the top has a front door, and a door that opens itself
       * on a fast (or cached) load is a film that started without being
       * asked — which is how the poster's own circuit got two seconds
       * and then vanished.
       */
      if (!this.booted && (this.embed || this.from > 0)) {
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
      window.removeEventListener('error', this.trip);
      window.removeEventListener('unhandledrejection', this.trip);
      window.removeEventListener('pointermove', this.aim);
      window.removeEventListener('pointermove', this.wake);
      window.removeEventListener('wheel', this.wake);
      document.removeEventListener('fullscreenchange', this.fullChange);
      window.clearTimeout(this.idleTimer);
      frame.removeEventListener('load', onLoad);
      document.body.classList.remove('tf-film', 'tf-embedded');
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

  /**
   * A JOIN OVERLAY LIVES EXACTLY AS LONG AS ITS ANIMATION.
   *
   * Every join paints the outgoing frame over the film and gets out of
   * the way — and "gets out of the way" was left to each overlay's own
   * last keyframe. The wipe's is a swept MASK, not an opacity, so when
   * it finished the element stayed at opacity 1 with a mask that did
   * not, in fact, hide it: a full-screen still of the previous shot sat
   * on top of the picture for the rest of the chapter. The camera went
   * on moving underneath, the captions went on changing, and the film
   * looked frozen one section behind itself — which is exactly what it
   * was. (It also explains a whole afternoon of "these shots barely
   * move": some of those frames were photographs.)
   *
   * So the overlay retires itself the moment its animation ends, and
   * the next cut builds a fresh one. No join can outlive its own play.
   */
  private retire = modifier((el: HTMLElement) => {
    const done = () => {
      el.style.display = 'none';
    };
    el.addEventListener('animationend', done);
    el.addEventListener('animationcancel', done);
    /* a still that never animates at all (reduced motion, a dropped
       stylesheet) must not become a permanent lid either */
    const failsafe = window.setTimeout(done, 1400);
    return () => {
      window.clearTimeout(failsafe);
      el.removeEventListener('animationend', done);
      el.removeEventListener('animationcancel', done);
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

  private snap(c: Cam, launch?: Cam, secs?: number) {
    this.goal = { ...c };
    this.mid = { ...c };
    this.now = { ...c };
    /**
     * A CUT LANDS ON A MOVING CAMERA.
     *
     * Snapping used to zero the chaser's velocity, so every cut arrived
     * at a standstill and eased up into its move — the one thing a cut
     * must never do, because the ease-in is the join announcing itself.
     * An operator does not stop between shots; the next shot is already
     * running when the frame changes. So the chaser is handed the
     * incoming shot's OWN speed (its whole travel over its whole
     * length) and starts at pace.
     */
    for (const k of ['dolly', 'lookY', 'ox', 'pitch', 'yaw'] as const) {
      const a = k === 'ox' ? (c.ox ?? 0) : c[k];
      const b = launch ? (k === 'ox' ? (launch.ox ?? 0) : launch[k]) : a;
      /* BOTH stages of the cascade get the shot's own speed. Handing it
         only to the first one left the second accelerating from rest,
         which reads as a short ease-in at every cut — and reads worst
         where the new shot orbits the OTHER WAY, because the lens
         appears to hesitate before changing its mind. */
      this.midV[k] = secs ? (b - a) / secs : 0;
      this.nowV[k] = this.midV[k];
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
   * THE WHIP. A 'whip' join does not snap: the goal steps across the
   * seam (the splice does that) and the chaser races it on a briefly
   * stiff spring — a fast, smooth tween between the shots that is over
   * in a third of a second and never reads as a glide. While it runs,
   * the spring is ~3× its documentary stiffness; then the hand relaxes.
   */
  private whipUntil = 0;

  /**
   * One critically-damped stage. The page's own chase is the second, which
   * is the whole cascade argument getting made for free by the fact that the
   * scene lives in another document.
   */
  private chase(dt: number) {
    /* softer than it was: the lens is an operator's hand, not a servo.
       Lower stiffness filters the spline's residual sway before the
       page's own chase filters it again — except mid-whip, when the
       hand is deliberately fast (see whipUntil). */
    const w = this.whipUntil > performance.now() ? 13 : 5.2;
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

  /**
   * THE POSTER TURNS.
   *
   * A still frame behind a title is indistinguishable from a JPEG, and
   * this whole film's argument is that it is not one. So while the door
   * is up the lens makes a slow circuit of the opening pose — a few
   * degrees either side, breathing in and out — which says "live 3D"
   * before a word is read and costs one rAF. It hands over on the
   * click: the film does not snap away from the poster, it flies from
   * wherever the circuit had reached.
   */
  private poster = (stamp: number) => {
    if (!this.gate || this.booted) {
      this.posterRaf = undefined;
      return;
    }
    this.posterRaf = requestAnimationFrame(this.poster);
    const film = this.film;
    if (!film) {
      return;
    }
    if (!this.posterAt) {
      this.posterAt = stamp;
    }
    const t = (stamp - this.posterAt) / 1000;
    const c = this.beats[0]!.cam;
    /* THREE-QUARTERS ON, and swinging. Dead in front of a building is
       an elevation drawing; the corner is where a tower shows you that
       it has depth — two faces, two eave lines, and a shadow that
       reads. The swing is slow and even, side to side, so the frame is
       never still and never travelling anywhere either. */
    /* THE POSTER IS CLOSE. The film's opening frame is as wide as the
       lens goes, which is right for a first shot and wrong for a
       poster: the door should show the building at a size worth
       pressing play for, and the press then RECOILS — a fast pull back
       out to the wide opening frame, from which the film's own slow
       push begins. */
    const pose = {
      dolly: c.dolly * (2.25 + 0.09 * Math.sin(t * 0.11 + 1.1)),
      lookY: c.lookY + 1.4 + 0.6 * Math.sin(t * 0.15),
      /* the two halves of the poster lean back toward the middle: the
         building comes in off the left edge, the wordmark off the right,
         and the gap between them is the composition */
      ox: (c.ox ?? 0) * 0.66,
      pitch: c.pitch + 2.4 + 1.4 * Math.sin(t * 0.13),
      yaw: c.yaw + 34 + 11 * Math.sin(t * 0.2),
    };
    film.pose({
      az: pose.yaw * RAD,
      el: pose.pitch * RAD,
      lookY: pose.lookY,
      ox: pose.ox,
      zoom: pose.dolly,
    });
    this.posterPose = pose;
  };

  private posterRaf?: number;
  private posterAt = 0;
  /** where the poster's circuit had reached when the door was answered */
  private posterPose?: Cam;

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
    const k = Math.min(1, dt * 1.8);
    this.lean.x += (this.leanTo.x - this.lean.x) * k;
    this.lean.y += (this.leanTo.y - this.lean.y) * k;
    /* the air the shot is flown in (see Beat.bob) */
    const air = this.beat.bob ?? 0;
    const flown = Math.min(
      1,
      Math.max(0, (stamp - this.beatAt) / (this.beat.ticks * TICK * 1000))
    );
    /* ONE breath across the shot, faded in and out at the ends so the
       sway never starts or stops abruptly. Three half-cycles of it (the
       first attempt) is not a drone in the air, it is a hand shaking —
       and on top of a move that is already covering ground it reads as
       the whole shot being unsteady. */
    const bob =
      air *
      Math.sin(flown * Math.PI * 1.6) *
      smooth(Math.min(1, flown / 0.18)) *
      smooth(Math.min(1, (1 - flown) / 0.18));
    const ox = Math.abs(this.now.ox ?? 0) < 1e-4 ? 0 : this.now.ox!;
    film.pose({
      /* the lens leans into the cursor: a couple of degrees of orbit and
         a hand's width of height, which is enough for the hills to move
         against the building and nowhere near enough to fight the shot */
      az: (this.now.yaw + this.lean.x * 1.1) * RAD,
      el: (this.now.pitch - this.lean.y * 0.75 + bob) * RAD,
      lookY: this.now.lookY + this.lean.y * 0.35 + bob * 0.3,
      ox: ox - this.lean.x * 0.012,
      zoom: this.now.dolly,
    });
    /* walk the key light to the shot's own sun — the short way round,
       over about a second and a half */
    const goal = this.sunGoal;
    if (goal && this.sunNow) {
      /**
       * AT A RATE, not on a time constant. An eased approach takes the
       * same second and a half whether the sun moves two degrees or
       * fifty-five — and fifty-five degrees in a second and a half is
       * the jarring relight between the construction chapter (near
       * overhead) and the detail chapter (raking). Capping the angular
       * speed makes a small change quick and a big one a proper move,
       * which the chapter's own flight has time for.
       */
      const cap = 0.3 * dt;
      const ease = Math.min(1, dt * 1.6);
      const walk = (from: number, to: number) => {
        const d = (to - from) * ease;
        return from + (Math.abs(d) > cap ? Math.sign(d) * cap : d);
      };
      let d = goal.az - this.sunNow.az;
      while (d > Math.PI) {
        d -= Math.PI * 2;
      }
      while (d < -Math.PI) {
        d += Math.PI * 2;
      }
      this.sunNow.az = walk(this.sunNow.az, this.sunNow.az + d);
      this.sunNow.el = walk(this.sunNow.el, goal.el);
      film.light(this.sunNow);
    }
    this.pageEl?.style.setProperty('--tf-lx', this.lean.x.toFixed(3));
    this.pageEl?.style.setProperty('--tf-ly', this.lean.y.toFixed(3));
    /* THE PLAYHEAD, as a custom property rather than tracked state: it
       changes sixty times a second and nothing about the template's
       shape changes with it, so it must never cause a re-render. */
    const at =
      this.secsBefore(this.absoluteIndex) +
      Math.min(this.beat.ticks * TICK, (stamp - this.beatAt) / 1000);
    const total = this.totalSecs;
    this.pageEl?.style.setProperty(
      '--tf-prog',
      (this.scrubAt ?? Math.min(1, at / total)).toFixed(5)
    );
    const sec = Math.floor(at);
    if (sec !== this.shownSec) {
      this.shownSec = sec;
      this.clock = TowerFilm.mmss(at);
    }

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
    /* THE CHAPTER'S NUMERAL LEAVES WITH THE CHAPTER. It is furniture
       for the passage, not for the beat, so it holds across the shots
       inside a chapter and fades out over the tail of the last one —
       an 02 still sitting in the corner while 03 arrives is the film
       forgetting which chapter it is in. */
    const here = this.absoluteIndex;
    const tail = (BEATS[here + 1]?.ch ?? -1) !== beat.ch;
    this.pageEl?.style.setProperty(
      '--tf-ghost-a',
      tail ? (1 - smooth(Math.max(0, (local - 0.72) / 0.22))).toFixed(3) : '1'
    );
    if (beat.dissolve) {
      /* the building goes, the frame stays */
      film.modelFade(1 - smooth(Math.max(0, (local - 0.12) / 0.72)));
    }

    /**
     * WEATHER CROSSES THE SHOT. The scene lights itself beautifully and
     * then holds that light for four minutes, which is the one thing
     * daylight never does. So every beat long enough to notice gets a
     * cloud: the air thickens, a cool shadow passes over the picture,
     * and it clears again before the beat is out. It is one pass, phased
     * off the beat's own place in the script so no two land alike, and
     * it never touches the grade — a chapter's colour is an argument,
     * this is only the sky.
     */
    if (beat.ticks * TICK >= 8) {
      const phase = ((this.beatIndex * 0.37) % 1) * 0.25;
      const w = Math.max(0, Math.min(1, (local - 0.12 - phase) / 0.62));
      const cloud = Math.sin(Math.PI * w) ** 2;
      film.haze((this.hazeBase ?? 0) + 0.17 * cloud);
      this.pageEl?.style.setProperty('--tf-cloud', cloud.toFixed(3));
    } else {
      this.pageEl?.style.setProperty('--tf-cloud', '0');
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
      const d = beat.sky.dist ?? 30;
      /**
       * PARALLAX. This used to be placed at `view().az + offset`, which
       * pins the word to the LENS: the camera orbits, the glyph orbits
       * with it, and a hundred feet of type sits perfectly still in the
       * frame — the one thing that tells an eye it is looking at a
       * sticker rather than a place. The angle is now taken once, when
       * the beat lands, and the word stays where it was put: the shot
       * moves past it.
       */
      const a = this.skyAz;
      this.skyOn += (1 - this.skyOn) * Math.min(1, dt * 1.6);
      film.sky(
        'chapter',
        {
          /* HOLLOW, HUGE, AND NEARLY GONE. A filled glyph sharing air
             with the building is a stain on the lens; a hard outline is
             a diagram drawn on the sky. What the shot wants is a word
             the WEATHER is holding — twice the size, a hairline, and
             faint enough that the hill reads straight through it. */
          color: 'rgba(252,247,236,0.34)',
          lines: beat.sky.lines,
          shadow: 'rgba(40,30,14,0.34)',
          shadowBlur: 0.16,
          size: beat.sky.size * 3.4,
          /* LIGHT, not ink. Drawn in the same warm white the front door
             uses, at a hairline: over this film's grounds a pale
             outline reads as a word held in the air, where a dark one
             reads as a diagram printed on the sky. */
          track: beat.sky.track ?? 0.16,
        },
        {
          billboard: true,
          opacity:
          this.skyOn *
          (beat.sky.opacity ?? 0.4) *
          0.78 *
          smooth(Math.max(0, Math.min(1, (local - 0.16) / 0.16))) *
          (1 - smooth(Math.max(0, Math.min(1, (local - 0.52) / 0.16)))),
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
    /* AND THEY LEAVE. A hand that annotates a drawing also takes the
       annotation away; a red line that survives to the cut reads as
       something the film forgot. The whole set fades over the last
       fifth of the beat, in the order it was drawn. */
    const gone = Math.min(1, Math.max(0, (local - 0.78) / 0.16));
    for (const [i] of specs.entries()) {
      const draw = Math.min(1, Math.max(0, (local - 0.06 - i * 0.12) / 0.16));
      drew = Math.max(drew, draw * (1 - gone));
      film.traceDraw(`t${i}`, draw);
      film.traceFade(`t${i}`, 1 - Math.min(1, gone * (1 + i * 0.25)));
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
    /* THE CLIMB BELONGS TO THE WORD, NOT TO THE BEAT. A word that waits
       for its wall to be built must still ENTER low — otherwise it
       arrives at whatever height a ramp running since the top of the
       beat has carried it to, which for the stone base meant appearing
       halfway up the sky it was supposed to rise into. The rise is
       measured from the moment it shows up. */
    if (!m) {
      film.fade('mark', 0);
      if (tether) {
        tether.style.opacity = '0';
      }
      return;
    }
    /**
     * IT COMES IN BEHIND THE BUILDING, EVERY TIME. The entry height is
     * read off the structure at the moment the word arrives — a little
     * under the top of whatever has been built so far — so the thing on
     * screen always hides the word's first frames and hands it over as
     * it climbs. Taken once per beat, because reading it every frame
     * would make the word ride the build instead of rising past it.
     */
    if (!this.markSeated && local >= (m.at ?? 0.14)) {
      this.markSeated = true;
      this.markFrom = Math.max(0.4, film.height() - 3.4);
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
        /* BIG, WHITE, SOFT, AND BEHIND. A dark label pasted over the
           scaffolding is a sticker; a big pale word standing further out
           than the structure — soft-edged, its own glow holding it
           against the hills, the building crossing in FRONT of it — is
           part of the place. */
        /* white OUTLINE, on its own plane behind the building, and
           smaller than the sky word: this one names a part rather than
           the chapter, so it stands at the height of the thing it names
           and keeps climbing with it. */
        /* BIGGER, FAINTER, AND IN THE SAME PLACE EVERY TIME. A word
           that lands somewhere new each beat is a caption chasing the
           building; one that always stands in the same spot behind it
           becomes a fixture of the film — you stop reading it as an
           annotation and start reading it as the name of what you are
           watching. Big enough to be architecture, faint enough that
           the timber crossing it always wins. */
        /* TINTED, not outlined. An outline is a drawing of a word; a
           tint is the word itself, standing in the same air as
           everything else and taking the same light. Grey because the
           sky it stands in is nearly white, and faint enough that the
           building crossing it always wins. */
        color: 'rgba(78,71,56,0.3)',
        lines: m.lines,
        shadow: 'rgba(255,252,244,0.28)',
        shadowBlur: 0.14,
        size: m.size * 2.7,
        track: 0.12,
      },
      {
        /* IN LATE, OUT EARLY. The word arrives after the shot has been
         running long enough to be about something, names the stage, and
         is gone before the middle — a title that outstays the moment it
         titles becomes furniture. */
      opacity:
        0.62 *
        smooth(Math.max(0, Math.min(1, (local - (m.at ?? 0.14)) / 0.16))) *
        (1 -
          smooth(
            Math.max(
              0,
              Math.min(
                1,
                (local - ((m.at ?? 0.14) + (m.hold ?? 0.34))) / 0.2
              )
            )
          )),
        ry: (this.markFace / RAD) % 360,
        /**
         * IT RISES OUT FROM BEHIND THE BUILDING. The word starts low
         * enough that the structure stands in front of it, fades up
         * while it is still half hidden, climbs past the frame the
         * carpenters are raising, and is gone before it reaches the top
         * of the picture — so the BUILDING reveals it, rather than a
         * caption appearing beside the building. Planted on one azimuth
         * so the camera moves PAST it, and nudged back toward the lens
         * if the orbit carries it out of frame (below).
         */
        x: Math.sin(this.markAz) * 26 + Math.cos(this.markAz) * this.markOff,
        /* a short climb, not a launch: the word should read as drifting
           up out of the structure over its whole life, not crossing the
           frame — same time on screen, a third of the distance */
        y: this.markFrom + Math.max(0, local - (m.at ?? 0.14)) * 7,
        z: Math.cos(this.markAz) * 26 - Math.sin(this.markAz) * this.markOff,
      }
    );
    /**
     * KEEP IT ON SCREEN — WHILE IT IS ON SCREEN. A planted word
     * parallaxes, which is the point, but the shot can orbit far enough
     * to carry it out of the picture, so the anchor is nudged back
     * toward the lens when what it projects to leaves the safe area.
     *
     * Two things this must NOT do. It must not correct a word that has
     * already faded out — the first mark used to slide sideways as it
     * left, because the correction was still hunting a glyph nobody
     * could see. And it must not treat the TOP edge as a failure: this
     * word is supposed to rise out of frame. Only the sides count, and
     * only while it is visible.
     */
    const seen = film.project(
      Math.sin(this.markAz) * 26 + Math.cos(this.markAz) * this.markOff,
      this.markFrom + Math.max(0, local - (m.at ?? 0.14)) * 7,
      Math.cos(this.markAz) * 26 - Math.sin(this.markAz) * this.markOff
    );
    const lit =
      local > (m.at ?? 0.14) - 0.02 &&
      local < (m.at ?? 0.14) + (m.hold ?? 0.34) + 0.02;
    const outside =
      lit && (!seen.on || seen.x < v.w * 0.12 || seen.x > v.w * 0.88);
    if (outside) {
      let d = v.az + Math.PI - this.markAz;
      while (d > Math.PI) {
        d -= Math.PI * 2;
      }
      while (d < -Math.PI) {
        d += Math.PI * 2;
      }
      this.markAz += d * Math.min(1, dt * 0.9);
    }

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
    /**
     * A JOIN WITHOUT A CUT. Most seams are cuts, but not all of them:
     * the construction chapter FLIES in and then has to clear the
     * standing building off the ground before it can build one, and a
     * tower blinking out of existence mid-sweep is a glitch. So a beat
     * may name a join without being a cut — the overlay plays over the
     * arriving shot and the camera is left alone.
     */
    if (beat.cut || beat.join) {
      const join = beat.join ?? 'wipe';
      if (join === 'whip') {
        this.whipUntil = performance.now() + 360;
      } else {
        /**
         * Every remaining join works the same way: capture the OUTGOING
         * frame first — the bridge renders one on demand and reads it
         * back synchronously — then snap, then run the join's overlay on
         * the still while the live incoming shot plays underneath.
         * 'wipe' sweeps it off along the sun's diagonal with a feathered
         * edge; 'blend' is a push dissolve (it fades AND travels);
         * 'iris' closes a circle onto the new shot's own subject; 'dip'
         * covers the seam with a colour. A failed capture (zero-sized
         * surface) degrades to a clean cut — a dip still gets its veil.
         */
        if (join !== 'cut') {
          const shot = film.snapshot();
          this.freeze = shot.length > 64 ? shot : '';
        }
        if (beat.cut) {
          this.snap(beat.cam, this.tailFor(this.beatIndex), beat.ticks * TICK);
        }
        if (join === 'dip') {
          this.dipColor = beat.dipTo ?? '#0d0905';
          this.dipStamp += 1;
        } else if (join === 'flash') {
          this.flashStamp += 1;
        } else if (join === 'sweep') {
          this.lightSweep(film, beat);
        } else if (join === 'defocus') {
          /* the rack: the freeze blurs away above while the live frame
             arrives soft and pulls itself sharp underneath */
          if (this.freeze) {
            this.blurStamp += 1;
          }
          this.liveEl
            ?.animate(
              [{ filter: 'blur(9px)' }, { filter: 'blur(0px)' }],
              { duration: 700, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' }
            );
        } else if (this.freeze) {
          if (join === 'wipe') {
            this.cutStamp += 1;
          } else if (join === 'blur') {
            this.blurStamp += 1;
          } else if (join === 'luma') {
            this.lumaStamp += 1;
          } else if (join === 'melt') {
            this.meltStamp += 1;
          } else if (join === 'blend') {
            this.blendStamp += 1;
          } else if (join === 'iris') {
            /* the circle closes ON the incoming shot's named point —
               projected now, with the camera already snapped — so the
               iris hands the eye directly to the subject */
            const v = film.view();
            const p = beat.to ? film.project(...beat.to) : undefined;
            const cx = p ? Math.max(12, Math.min(88, (p.x / v.w) * 100)) : 50;
            const cy = p ? Math.max(12, Math.min(88, (p.y / v.h) * 100)) : 50;
            this.irisAt = `--ix:${cx.toFixed(1)}%;--iy:${cy.toFixed(1)}%`;
            this.irisStamp += 1;
          }
        }
      }
    }
    /**
     * WHICH BUILDING THIS BEAT IS ABOUT — asserted, never inherited.
     *
     * This used to run only when a beat NAMED a style, so every beat
     * that did not name one (all of chapters one to four) simply kept
     * whatever tower was standing. Straight through from the top that is
     * invisible, because the film opens on the keep and only the
     * comparison names anything else. Come back the other way — the
     * comparison or the lineup, then a chapter skip back into DETAIL —
     * and the film narrates the Japanese keep over a Chinese pagoda: the
     * shot called "at the foot" frames somebody else's balcony, and the
     * traces, which are computed from the keep's own level table, point
     * at empty air. That is the "off by one section" and the second
     * building in the frame, and it is not a motion problem at all: it
     * is a beat inheriting state it never asked for. The subject of this
     * film is the keep, so a beat that says nothing means style zero.
     */
    /* whatever the last beat did to the model, this one starts whole */
    if (!beat.dissolve) {
      film.modelFade(1);
    }
    const style = beat.style ?? 0;
    if (film.styleIndex() !== style) {
      film.style(style);
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
    if (beat.sky) {
      /* plant the word where the shot can see it, once */
      this.skyAz = (this.film?.view().az ?? 0) + (beat.sky.az ?? 0) * RAD;
    }
    if (beat.mark) {
      /* AND THE MARK STANDS BEHIND THE BUILDING. Taken once, along the
         lens axis at the moment the beat lands, so the word is directly
         behind the subject — the structure crosses it, the camera moves
         PAST it, and it never reads as a caption stuck on the glass. */
      this.markAz = (this.film?.view().az ?? 0) + Math.PI;
      /**
       * A ONE-CHARACTER WORD IS NOT A TWO-CHARACTER WORD. 瓦 centred on
       * the same anchor as 石垣 reads as sitting too far left — an eye
       * centres a line of type on its mass, not on its box. So a lone
       * glyph is nudged toward the right of frame, and which way THAT
       * is depends on where the lens is standing: both candidates are
       * projected and the one further right wins.
       */
      const lone = (beat.mark.lines[0] ?? '').length <= 1;
      this.markOff = 0;
      if (lone && this.film) {
        const a = this.markAz;
        const at = (k: number) =>
          this.film!.project(
            Math.sin(a) * 26 + Math.cos(a) * k,
            9,
            Math.cos(a) * 26 - Math.sin(a) * k
          ).x;
        this.markOff = at(3.6) > at(-3.6) ? 3.6 : -3.6;
      }
      /* the entry height is taken when the word ARRIVES, not here —
         by then the building has grown and the word has to enter
         behind whatever is standing (see stageMark) */
      this.markSeated = false;
      this.markFrom = (beat.mark.to ?? 8) * 0.34 - 1.6;
    }
    this.applyAir(beat, instant);
    /**
     * THE VOICE CROSSES ON ITS OWN CLOCK. Tracks are linked by the seam
     * but independent across it: a beat with its own line fades the old
     * one under (~120ms) and speaks; a beat with none is an L-CUT — the
     * outgoing sentence finishes over the new shot and the duck lifts
     * when it lands, exactly as an editor would lay it. A designed
     * silence (`hush`) is the exception that asks for quiet.
     */
    if (beat.vo || beat.hush) {
      this.hush();
      this.speak(beat);
    } else if (
      !this.sound ||
      !this.voice ||
      this.voice.paused ||
      this.voice.ended
    ) {
      /* nothing is actually speaking: the silent beat gets its music */
      this.film?.duck(1);
    }
  }

  /**
   * THE AIR OF A SHOT: grade, sun, haze, weather. Split out of the beat
   * so a chapter's sky can begin turning while the lens is still flying
   * into it — the `air` cue fires at the head of a lead, the beat's own
   * cue when it lands, and applying it twice is harmless because every
   * one of these is a set, not a step.
   */
  private applyAir(beat: Beat, instant = false) {
    const film = this.film;
    if (!film) {
      return;
    }
    if (beat.theme !== undefined) {
      film.theme(beat.theme, instant);
    }
    /**
     * THE SUN MOVES, it does not switch on. Both sun and haze are shot
     * properties, released when a beat does not ask — otherwise one
     * raking close-up lights the rest of the film. But a beat that DOES
     * ask used to get its light in a single frame, which in the
     * construction chapter (side light at twelve degrees, then sixty,
     * then near-overhead) read as somebody flipping a switch. The goal
     * is set here and the frame loop walks the light to it.
     */
    const want = beat.sun
      ? { az: beat.sun.az * RAD, el: beat.sun.el * RAD }
      : null;
    this.sunGoal = want;
    if (instant || !this.sunNow || !want) {
      this.sunNow = want ? { ...want } : null;
      film.light(this.sunNow);
    }
    this.hazeBase = beat.haze ?? null;
    film.haze(this.hazeBase);
    if (beat.wx !== undefined) {
      film.wx(beat.wx, instant);
    }
    /* the weather preset draws rain for the page's own wide shot; a beat
       that is ABOUT the rain asks for more of it (Beat.rain) */
    film.rain(beat.rain ?? null);
    film.rim(beat.rim ?? null, true);
  }

  /**
   * THE HOUR A CUT INHERITS.
   *
   * Theme and weather are stated where they CHANGE, so a beat halfway
   * through the film usually says nothing about either — which is right
   * for a film played from the top and wrong for one dropped into. A
   * deep link (or a chapter skip) would open in whatever sky was last
   * set, which since the front door became an evening meant the
   * construction chapter got built at dusk. So a cut resolves its own
   * hour first: walk back to the last beat that named one, and take it.
   */
  private settleAir(index: number) {
    const film = this.film;
    if (!film) {
      return;
    }
    for (let i = index; i >= 0; i -= 1) {
      const t = BEATS[i]?.theme;
      if (t !== undefined) {
        film.theme(t, true);
        break;
      }
    }
    for (let i = index; i >= 0; i -= 1) {
      const w = BEATS[i]?.wx;
      if (w !== undefined) {
        film.wx(w, true);
        break;
      }
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
      /* the last cue has run: hold the pose, settle the music a step,
         and offer the card. Looping past your own ending is how a film
         tells the viewer it never meant any of it. */
      this.playing = false;
      this.ended = true;
      this.hushVoice(200);
      this.film?.duck(0.35);
      return;
    }
    if (command.action === 'air') {
      const i = Number(command.target);
      if (Number.isFinite(i) && this.beats[i]) {
        this.applyAir(this.beats[i]!);
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
    /* a paused picture with a running voice is two films; hold both —
       and let the voice down gently rather than mid-cycle */
    if (!this.playing) {
      this.hushVoice(90);
    } else if (this.sound && this.voice?.src && !this.voice.ended) {
      this.revive(this.voice);
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

  private cutTo(index: number, hard = false) {
    this.from = index;
    this.beatIndex = 0;
    this.ended = false;
    this.playing = true;
    this.lap += 1;
    this.settleAir(index);
    this.applyBeat(BEATS[index]!, true);
    /* the re-cut score opens on a spliced first waypoint, so the goal
       steps straight to this pose; the snap lands the lens beside it,
       already carrying that shot's own speed */
    this.snap(
      BEATS[index]!.cam,
      hard ? undefined : this.tailFor(0),
      hard ? undefined : BEATS[index]!.ticks * TICK
    );
  }

  /** an uncaught error anywhere becomes a visible line — a film that
   *  dies silently mid-reel cannot be debugged from a chair */
  private trip = (e: Event) => {
    if (this.fault) {
      return;
    }
    const err = e as ErrorEvent & PromiseRejectionEvent;
    this.fault = String(
      err.message ?? err.reason ?? 'unknown fault'
    ).slice(0, 200);
  };

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

  /**
   * A BOUNDARY NEVER CLIPS THE VOICE — and every line has its own
   * throat. One shared element made politeness impossible: however
   * gently the old line was being faded, the new line's src swap
   * guillotined it mid-word. So an interrupted line keeps its OWN
   * element and fades there (~120ms, fast enough to read as a stop,
   * slow enough that no waveform is cut mid-cycle) while the new line
   * starts clean on a fresh one — the game-dialogue barge-in, which is
   * what a chapter skip actually is. ("Stop at the next word" is the
   * refinement this is built to take: an analyser watching for the
   * inter-word trough before the fade — see docs/choreo-splices.md.)
   */
  private fades = new WeakMap<HTMLAudioElement, number>();

  private fadeEl(el: HTMLAudioElement | undefined, ms = 120) {
    if (!el || el.paused) {
      return;
    }
    const prior = this.fades.get(el);
    if (prior !== undefined) {
      window.clearInterval(prior);
    }
    const v0 = el.volume;
    const t0 = performance.now();
    const timer = window.setInterval(() => {
      const f = (performance.now() - t0) / ms;
      if (f >= 1) {
        el.volume = 0;
        el.pause();
        window.clearInterval(timer);
        this.fades.delete(el);
      } else {
        el.volume = v0 * (1 - f);
      }
    }, 16);
    this.fades.set(el, timer);
  }

  /** the wrapper the live picture sits in, for rack-defocus */
  private liveEl?: HTMLElement;

  private liveWrap = modifier((el: HTMLElement) => {
    this.liveEl = el;
    return () => {
      if (this.liveEl === el) {
        this.liveEl = undefined;
      }
    };
  });

  /**
   * THE LIGHT SWEEP: the sun itself flares across the seam — swings
   * high and past, then settles back onto whatever light the beat
   * actually asked for. Fire-and-forget; the restore hands the key
   * back to the beat's own sun (or the hour's).
   */
  private lightSweep(film: FilmApi, beat: Beat) {
    const t0 = performance.now();
    const dur = 950;
    const base = beat.sun
      ? { az: beat.sun.az * RAD, el: beat.sun.el * RAD }
      : null;
    const step = () => {
      const f = (performance.now() - t0) / dur;
      if (f >= 1 || !this.film) {
        film.light(base);
        return;
      }
      const swing = Math.sin(f * Math.PI);
      film.light({
        az: (base?.az ?? 0.4) + (1 - f) * 2.2 - 1.1,
        el: (base?.el ?? 0.4) + swing * 0.3,
      });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /**
   * THE DEMO STRIP under the film triggers any join as a pure overlay
   * on whatever is playing — no beat change, no snap: the transition
   * itself, exhibited on the living picture.
   */
  private previewJoin = (join: string) => {
    const film = this.film;
    if (!film || !this.booted) {
      return;
    }
    if (join !== 'flash' && join !== 'sweep' && join !== 'whip') {
      const shot = film.snapshot();
      this.freeze = shot.length > 64 ? shot : '';
      if (!this.freeze && join !== 'dip') {
        return;
      }
    }
    switch (join) {
      case 'blend':
        this.blendStamp += 1;
        break;
      case 'blur':
        this.blurStamp += 1;
        break;
      case 'defocus':
        this.blurStamp += 1;
        this.liveEl?.animate(
          [{ filter: 'blur(9px)' }, { filter: 'blur(0px)' }],
          { duration: 700, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' }
        );
        break;
      case 'dip':
        this.dipColor = '#0d0905';
        this.dipStamp += 1;
        break;
      case 'flash':
        this.flashStamp += 1;
        break;
      case 'iris': {
        const v = film.view();
        const b = this.beat;
        const pt = b.to ? film.project(...b.to) : undefined;
        const cx = pt ? Math.max(12, Math.min(88, (pt.x / v.w) * 100)) : 50;
        const cy = pt ? Math.max(12, Math.min(88, (pt.y / v.h) * 100)) : 46;
        this.irisAt = `--ix:${cx.toFixed(1)}%;--iy:${cy.toFixed(1)}%`;
        this.irisStamp += 1;
        break;
      }
      case 'luma':
        this.lumaStamp += 1;
        break;
      case 'sweep':
        this.lightSweep(film, this.beat);
        break;
      case 'whip':
        this.whipUntil = performance.now() + 360;
        break;
      case 'wipe':
        this.cutStamp += 1;
        break;
    }
  };

  /** cancel a fade mid-flight and stand the line back up (resume) */
  private revive(el: HTMLAudioElement) {
    const timer = this.fades.get(el);
    if (timer !== undefined) {
      window.clearInterval(timer);
      this.fades.delete(el);
    }
    el.volume = 1;
  }

  private hushVoice(ms = 120) {
    this.fadeEl(this.voice, ms);
  }

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
    /* barge-in: the outgoing line fades on its own element while the
       new one starts clean on a fresh throat */
    this.fadeEl(this.voice);
    const el = new Audio();
    this.voice = el;
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
    el.onended = () => {
      if (this.voice === el) {
        this.film?.duck(1);
      }
    };
    void el.play().then(
      () => this.film?.duck(0.1),
      () => this.film?.duck(1)
    );
  }

  private hush() {
    this.hushVoice();
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
    if (this.posterRaf !== undefined) {
      cancelAnimationFrame(this.posterRaf);
      this.posterRaf = undefined;
    }
    if (withSound) {
      this.sound = true;
      this.film.sound(true);
    }
    this.settleAir(this.from);
    this.applyBeat(this.beats[0]!, true);
    /* ...and the sky comes with it, NOT instantly: the evening of the
       poster crossfades into the film's own morning across the launch */
    this.applyAir(this.beats[0]!, false);
    /**
     * THE CLICK IS ANSWERED IN THE SAME FRAME — and answered with the
     * biggest move in the film. The lens does not cut to the opening
     * shot; it FLIES there from wherever the poster's circuit had
     * reached, on the stiff spring, so the first thing the viewer sees
     * after pressing the button is the camera taking off. A door that
     * opens onto a still frame reads as a page that did not hear you.
     */
    if (this.posterPose) {
      this.now = { ...this.posterPose };
      this.mid = { ...this.posterPose };
      this.goal = { ...this.beats[0]!.cam };
      this.whipUntil = performance.now() + 1200;
      for (const k of ['dolly', 'lookY', 'ox', 'pitch', 'yaw'] as const) {
        this.midV[k] = 0;
        this.nowV[k] = 0;
      }
    } else {
      this.snap(
        this.beats[0]!.cam,
        this.tailFor(0),
        this.beats[0]!.ticks * TICK
      );
    }
    this.booted = true;
    this.wake();
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

  /**
   * BACK IN FROM THE END CARD — a dissolve, not a flight.
   *
   * The film ends three hundred degrees around the building from where
   * it opened, so tweening the lens home spins it like a globe. The
   * ending cross-fades into the opening frame instead: the last frame
   * is held as a still, the camera is PLACED at the opening pose behind
   * it, and the still fades away.
   */
  private replay = () => {
    const film = this.film;
    if (film) {
      const shot = film.snapshot();
      this.freeze = shot.length > 64 ? shot : '';
    }
    this.ended = false;
    this.cutTo(0, true);
    if (this.freeze) {
      this.blendStamp += 1;
    }
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
        {{! the live picture's own wrapper, so a rack-defocus can blur
        the scene without touching the grade riding the iframe itself }}
        <div class="tf-live" {{this.liveWrap}}>
          <iframe
            class="tf-frame"
            src={{this.src}}
            title="Towers"
            loading="eager"
          ></iframe>
        </div>

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

        {{! THE WIPE. The outgoing frame itself, swept off along the
        sun's diagonal behind a feathered edge — a true editorial wipe,
        keyed per cut so it plays from its own first frame. }}
        {{#each (array this.cutStamp) key="@identity" as |c|}}
          {{#if c}}
            {{#if this.freeze}}
              <img
                class="tf-swipe"
                src={{this.freeze}}
                alt=""
                aria-hidden="true"
                {{this.retire}}
              />
            {{/if}}
          {{/if}}
        {{/each}}

        {{! THE FREEZE-BLEND. The outgoing frame, held as a still and
        faded over the live incoming shot — keyed per blend so each
        dissolve plays from its own first frame. It sits under the
        grade, so both frames wear the same colourist's pass. }}
        {{! THE MELT. The long, soft one: the outgoing frame simply
        leaves, over nearly two seconds, with no push and no colour —
        for a seam between two shots that are the same THOUGHT. }}
        {{#each (array this.meltStamp) key="@identity" as |ms|}}
          {{#if ms}}
            <img
              class="tf-melt"
              src={{this.freeze}}
              alt=""
              aria-hidden="true"
              {{this.retire}}
            />
          {{/if}}
        {{/each}}

        {{#each (array this.blendStamp) key="@identity" as |bs|}}
          {{#if bs}}
            <img
              class="tf-blend"
              src={{this.freeze}}
              alt=""
              aria-hidden="true"
              {{this.retire}}
            />
          {{/if}}
        {{/each}}

        {{! THE IRIS. The old shot closes in a circle onto the incoming
        subject; the centre rides inline custom properties. }}
        {{#each (array this.irisStamp) key="@identity" as |is|}}
          {{#if is}}
            <img
              class="tf-iris"
              src={{this.freeze}}
              style={{this.irisAt}}
              alt=""
              aria-hidden="true"
              {{this.retire}}
            />
          {{/if}}
        {{/each}}

        {{! blur and luma dissolves, and the flash — the last of the
        junction vocabulary's overlays }}
        {{#each (array this.blurStamp) key="@identity" as |bl|}}
          {{#if bl}}
            <img
              class="tf-blurout"
              src={{this.freeze}}
              alt=""
              aria-hidden="true"
              {{this.retire}}
            />
          {{/if}}
        {{/each}}
        {{#each (array this.lumaStamp) key="@identity" as |lu|}}
          {{#if lu}}
            <img
              class="tf-luma"
              src={{this.freeze}}
              alt=""
              aria-hidden="true"
              {{this.retire}}
            />
          {{/if}}
        {{/each}}
        {{#each (array this.flashStamp) key="@identity" as |fl|}}
          {{#if fl}}
            <i class="tf-flash" aria-hidden="true" {{this.retire}}></i>
          {{/if}}
        {{/each}}

        {{! THE DIP. Freeze under, veil over: the old shot holds while
        the colour closes, the seam passes in the dark (or the light),
        and the veil lifts on the new shot. }}
        {{#each (array this.dipStamp) key="@identity" as |ds|}}
          {{#if ds}}
            <span class="tf-dip" aria-hidden="true" {{this.retire}}>
              {{#if this.freeze}}
                <img src={{this.freeze}} alt="" />
              {{/if}}
              <i style={{this.dipVeil}}></i>
            </span>
          {{/if}}
        {{/each}}

        {{! A VIGNETTE, which is a lens and not a decoration: the scene is
        an even wash corner to corner, and an even frame has no centre.
        It darkens at the same diagonal the sun throws, so the corner
        away from the light is the heavier one. }}
        {{! THE CLOUD. Driven per frame from --tf-cloud: a cool shadow
        crossing the picture on a diagonal while the air thickens under
        it, so a four-minute afternoon is not one unbroken light. }}
        <div class="tf-cloud" aria-hidden="true"></div>

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
              {{! the mode rides ON the block, not on the shared container: a
              leaver keeps its own layout while it fades, instead of
              teleporting to wherever the NEXT beat's mode puts blocks }}
              <div class="tf-block is-{{b.mode}}" {{this.plate}}>
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
                    <div class="tf-plane is-glyph" style={{this.glyphFit}}>
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

            {{! THE TYPE IS ITS OWN SCENE.
            Every element in this block enters and leaves on ONE
            vocabulary — a short rise, a fade, the same curve — and in
            one order: kicker, glyph, reading, then the lines against
            the voice. It leaves as a wave in reverse, the lines first
            and the kicker last, so the block reads as a thing that
            arrived and departed rather than as four unrelated fades
            that happened to share a corner. Randomness in type is
            almost never timing; it is a vocabulary nobody agreed on. }}
            <n.Parallel>
              {{! ONE BLOCK AT A TIME. The old set leaves over about
              half a second (lines, reading, glyph, kicker, in that
              order); the new one waits for the corner to be empty
              before it starts. Two settings dissolving through each
              other is the one thing type must never do — it is
              unreadable for the length of the overlap and it looks like
              a mistake, because it is one. }}
              <n.Tween
                @of={{n.inserted "kick"}}
                @delay={{0.5}}
                @opacity={{array 0 1}}
                @y={{array 10 0}}
                @duration={{0.55}}
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
                @stagger={{0.07}}
                @delay={{0.62}}
                @opacity={{array 0 1}}
                @y={{array 16 0}}
                @duration={{0.9}}
                @ease="easeOut"
              />
              <n.Tween
                @of={{n.inserted "read"}}
                @delay={{0.86}}
                @opacity={{array 0 1}}
                @y={{array 8 0}}
                @duration={{0.62}}
                @ease="easeOut"
              />
              {{! four slots, landing ACROSS the beat rather than together —
              and paced against the measured read (see `sayAt`), so the
              last cue lands as the voice finishes whether the line runs
              four seconds or thirteen. Same rise, same curve, every
              time: the WHEN belongs to the voice, the HOW belongs to
              the block. }}
              <n.Tween
                @of={{n.inserted "s0"}}
                @delay={{get this.sayAt 0}}
                @opacity={{array 0 1}}
                @y={{array 8 0}}
                @duration={{0.7}}
                @ease="easeOut"
              />
              <n.Tween
                @of={{n.inserted "s1"}}
                @delay={{get this.sayAt 1}}
                @opacity={{array 0 1}}
                @y={{array 8 0}}
                @duration={{0.7}}
                @ease="easeOut"
              />
              <n.Tween
                @of={{n.inserted "s2"}}
                @delay={{get this.sayAt 2}}
                @opacity={{array 0 1}}
                @y={{array 8 0}}
                @duration={{0.7}}
                @ease="easeOut"
              />
              <n.Tween
                @of={{n.inserted "s3"}}
                @delay={{get this.sayAt 3}}
                @opacity={{array 0 1}}
                @y={{array 8 0}}
                @duration={{0.7}}
                @ease="easeOut"
              />
              {{! and out, in reverse: the sentence goes first, the name
              of the thing goes last }}
              <n.Tween
                @of={{array
                  (n.removed "s0")
                  (n.removed "s1")
                  (n.removed "s2")
                  (n.removed "s3")
                }}
                @opacity={{array 1 0}}
                @y={{array 0 -7}}
                @duration={{0.3}}
                @ease="easeIn"
              />
              <n.Tween
                @of={{n.removed "read"}}
                @delay={{0.05}}
                @opacity={{array 1 0}}
                @y={{array 0 -7}}
                @duration={{0.3}}
                @ease="easeIn"
              />
              <n.Tween
                @of={{n.removed "glyph"}}
                @delay={{0.1}}
                @opacity={{array 1 0}}
                @y={{array 0 -9}}
                @duration={{0.34}}
                @ease="easeIn"
              />
              <n.Tween
                @of={{n.removed "kick"}}
                @delay={{0.16}}
                @opacity={{array 1 0}}
                @y={{array 0 -7}}
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
                <figure class="is-{{b.mode}}" {{motion id="photo" role="shot"}}>
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

          {{#if this.fault}}
          <p class="tf-fault">⚠ {{this.fault}}</p>
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
                  @tension={{0.34}}
                />
                {{#each this.cues as |cue|}}
                  <c.Perform
                    @at={{at "film"}}
                    @delay={{cue.delay}}
                    @action={{cue.action}}
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
            {{! the museum frame: a hairline border drawn just inside the
            screen, the way a plate is matted — it makes the scene behind
            it an exhibit before a word has landed }}
            <i class="tf-gate-frame" aria-hidden="true"></i>
            {{! the spine: the film's name written down the right edge in
            its own language, the poster's quiet second voice }}
            <span class="tf-gate-vert" aria-hidden="true">天守 — 構造の研究</span>
            <div class="tf-gate-in tf-matter">
              <i class="tf-mg-rule" aria-hidden="true"></i>
              <p class="tf-gate-k">
                {{! the ghost: the same word, enormous and hollow, standing
                behind itself — depth from one glyph repeated at two
                weights }}
                <span class="tf-gate-ghost" aria-hidden="true">天守</span>
                <span class="tf-mg-g1">天</span><span
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
            {{! the index: five chapters in a strip along the foot, the
            way a museum plate lists its figures }}
            <p class="tf-gate-index" aria-hidden="true">
              <span>壱 — CONTEXT</span>
              <span>弐 — HISTORY</span>
              <span>参 — CONSTRUCTION</span>
              <span>肆 — DETAIL</span>
              <span>伍 — COMPARISON</span>
            </p>
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

      {{! the menu and the transport belong to the film, embedded or not —
      only the door back to the demo page and the dive below are the
      full page's own }}
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

        {{! THE PLAYER, floating on the picture. The playhead is
        chaptered, scrubbable and honest: the film cannot seek, so the
        drag reads as time and the release RE-CUTS from the shot under
        the hand. }}
        <div class="tf-player {{if this.idle 'is-idle'}}">
        <div
          class="tf-scrub {{if this.gate 'is-away'}}"
          role="slider"
          aria-label="playhead"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="0"
          tabindex="0"
          {{on "pointerdown" this.scrubDown}}
          {{on "pointermove" this.scrubMove}}
          {{on "pointerup" this.scrubUp}}
        >
          <span class="tf-scrub-track">
            {{#each this.playbar as |c|}}
              <span class="tf-scrub-ch" style={{c.style}} title={{c.title}}>
                <i></i>
              </span>
            {{/each}}
          </span>
          <span class="tf-scrub-head"></span>
          {{#if this.scrubAt}}
            <span class="tf-scrub-tip">{{this.scrubLabel}}</span>
          {{/if}}
        </div>

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
          {{#unless this.embed}}
            <LinkTo
              @route="demo"
              @model="towers"
              class="tf-btn"
            >⛶ How This Is Built</LinkTo>
          {{/unless}}
          <span class="tf-time">{{this.clock}}
            <i>/</i>
            {{this.duration}}</span>
          <button
            type="button"
            class="tf-btn tf-icon"
            title="fullscreen"
            {{on "click" this.screen}}
          >{{if this.full "⤡" "⛶"}}</button>
          <span class="tf-credit">Scene:
            <a
              href="https://threeui.com/browse"
              target="_blank"
              rel="noopener"
            >threeui</a>
            by
            <a href="https://x.com/MengTo" target="_blank" rel="noopener">Meng
              To</a></span>
          {{#if this.debug}}
            <span class="tf-build">{{this.build}}</span>
          {{/if}}
        </div>
        </div>

        {{! THE CUTTING ROOM — the wall plate under the exhibit, set in
        the house dive template like every other demo's deep dive. The
        film hands it one thing: the live junction trigger. }}
        {{#unless this.embed}}
          <div id="cutting-room" class="tf-notes">
            <TowersNotes @preview={{this.previewJoin}} />
          </div>
        {{/unless}}
    </div>

    <style>
      /* THE FLAG, as an accent system. Two colours and nothing else:
         the red of the hinomaru for the one thing that is happening NOW
         — the playhead, the current chapter, the seal, the point a line
         is drawn to — and a full white for type that has to win over a
         picture. Everything else stays in the scene's own inks, so the
         red never becomes decoration; it only ever means "here". */
      .tf-page {
        --tf-red: #bc002d;
        --tf-white: #fffdf8;
      }

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

        position: relative;
        min-height: 100svh;
        background: var(--tf-paper);
        display: flex;
        flex-direction: column;
        transition: background 900ms ease;
      }

      .tf-stage {
        position: relative;
        height: 100svh;
        flex: none;
        overflow: hidden;
      }

      .tf-live {
        position: absolute;
        inset: 0;
      }

      /* THE SCENE DOES NOT TAKE THE POINTER. It is a picture: it has no
         controls of its own in film mode, and while it swallowed events
         the wheel went to the iframe's document instead of this page —
         so the film filled the viewport and the wall plate underneath
         could not be reached. */
      .tf-frame {
        pointer-events: none;
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

      /* WET. Rain is not simply the clear grade with drops in it: the
         light comes from a lid rather than a source, so the picture
         loses its warmth and most of its contrast, and the corners
         close in. */
      .is-grade-wet {
        --tf-lut: saturate(0.72) contrast(0.92) brightness(0.94)
          hue-rotate(-4deg);
        --tf-warm: #cfd6dd;
        --tf-cool: #7d8b9e;
        --tf-grade-a: 0.44;
        --tf-vig-a: 0.8;
      }

      .is-grade-plate {
        --tf-lut: saturate(0.86) contrast(0.95) brightness(1.2);
        --tf-warm: #f6e8d2;
        --tf-cool: #c3c8bd;
        --tf-grade-a: 0.18;
        --tf-vig-a: 0.36;
      }

      /* SIX COUNTRIES, SIX LIGHTS. The comparison holds the framing and
         the lens still so the BUILDING is the variable — but six towers
         under one identical sky read as six models on one lawn, which
         is a diorama, not a comparison. Each gets the tone its own
         country is remembered in, at a strength you feel and cannot
         quite name: the plate grade, bent a few degrees. */
      .is-grade-c-jp {
        --tf-lut: saturate(0.84) contrast(0.95) brightness(1.22);
        --tf-warm: #f6e8d2;
        --tf-cool: #bcc6bb;
        --tf-grade-a: 0.2;
        --tf-vig-a: 0.36;
      }

      .is-grade-c-cn {
        --tf-lut: saturate(0.95) contrast(0.97) brightness(1.16) sepia(0.06);
        --tf-warm: #ffd9a0;
        --tf-cool: #c0a68e;
        --tf-grade-a: 0.28;
        --tf-vig-a: 0.44;
      }

      .is-grade-c-vn {
        --tf-lut: saturate(0.92) contrast(0.94) brightness(1.18) hue-rotate(-6deg);
        --tf-warm: #eef0cd;
        --tf-cool: #a7bda8;
        --tf-grade-a: 0.26;
        --tf-vig-a: 0.4;
      }

      .is-grade-c-th {
        --tf-lut: saturate(1.02) contrast(0.93) brightness(1.3);
        --tf-warm: #ffe9ad;
        --tf-cool: #d3c6a0;
        --tf-grade-a: 0.24;
        --tf-vig-a: 0.3;
      }

      .is-grade-c-kh {
        --tf-lut: saturate(0.9) contrast(0.99) brightness(1.14) sepia(0.12);
        --tf-warm: #f2cfa4;
        --tf-cool: #b9a184;
        --tf-grade-a: 0.3;
        --tf-vig-a: 0.5;
      }

      .is-grade-c-tr {
        --tf-lut: saturate(0.8) contrast(0.96) brightness(1.26);
        --tf-warm: #fdf3e2;
        --tf-cool: #a9bacd;
        --tf-grade-a: 0.22;
        --tf-vig-a: 0.34;
      }

      /* the outgoing frame, swept off along the sun's diagonal behind a
         FEATHERED edge — a mask, not a clip, because a wipe with a hard
         edge is a screen transition and a wipe with a soft one is film */
      .tf-swipe {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        filter: var(--tf-lut);
        mask-image: linear-gradient(
          calc(var(--tf-rake, 35deg) + 72deg),
          #000 44%,
          transparent 56%
        );
        mask-size: 300% 300%;
        mask-repeat: no-repeat;
        -webkit-mask-image: linear-gradient(
          calc(var(--tf-rake, 35deg) + 72deg),
          #000 44%,
          transparent 56%
        );
        -webkit-mask-size: 300% 300%;
        -webkit-mask-repeat: no-repeat;
        /* Star Wars speed: a wipe is a STATEMENT, and at two-thirds of a
           second it reads as a glitch rather than a decision */
        animation: tf-swipe 1150ms cubic-bezier(0.42, 0, 0.28, 1) forwards;
      }

      /* the sweep is the mask; the last breath of opacity is a SEAL. A
         mask that ends up not covering what you assumed leaves the
         still on screen forever, and a wipe that fails should fail to
         nothing rather than to a photograph of the last shot. */
      @keyframes tf-swipe {
        0% {
          mask-position: 0% 0%;
          -webkit-mask-position: 0% 0%;
          opacity: 1;
        }

        88% {
          opacity: 1;
        }

        100% {
          mask-position: 100% 100%;
          -webkit-mask-position: 100% 100%;
          opacity: 0;
        }
      }

      .tf-melt {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        filter: var(--tf-lut);
        animation: tf-melt 1900ms cubic-bezier(0.4, 0, 0.5, 1) forwards;
      }

      @keyframes tf-melt {
        0% {
          opacity: 1;
        }

        22% {
          opacity: 0.92;
        }

        100% {
          opacity: 0;
        }
      }

      .tf-blend {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        /* the still wears the same primary as the live frame under it,
           so the dissolve is between two graded pictures — and it is a
           PUSH dissolve: the old frame travels gently forward as it
           thins, so the transition has a direction, not just a mix */
        filter: var(--tf-lut);
        animation: tf-blend 520ms ease-out forwards;
      }

      @keyframes tf-blend {
        0% {
          opacity: 1;
          transform: scale(1);
        }

        100% {
          opacity: 0;
          transform: scale(1.055);
        }
      }

      /* the blur dissolve — and the freeze half of the rack-defocus */
      .tf-blurout {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        animation: tf-blurout 640ms ease-out forwards;
      }

      @keyframes tf-blurout {
        0% {
          opacity: 1;
          filter: var(--tf-lut) blur(0);
        }

        100% {
          opacity: 0;
          filter: var(--tf-lut) blur(13px);
        }
      }

      /* the optical dissolve: lighten blend, so highlights linger */
      .tf-luma {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        filter: var(--tf-lut);
        mix-blend-mode: lighten;
        animation: tf-blend 700ms ease-in forwards;
      }

      /* two breaths of white, no freeze — the gun-crack */
      .tf-flash {
        position: absolute;
        inset: 0;
        z-index: 4;
        pointer-events: none;
        background: #fff8ec;
        animation: tf-flash 300ms ease-out forwards;
      }

      @keyframes tf-flash {
        0%,
        22% {
          opacity: 0.92;
        }

        100% {
          opacity: 0;
        }
      }

      /* the old shot closes in a circle onto the new shot's subject */
      .tf-iris {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        pointer-events: none;
        filter: var(--tf-lut);
        clip-path: circle(150% at var(--ix, 50%) var(--iy, 50%));
        animation: tf-iris 680ms cubic-bezier(0.45, 0, 0.3, 1) forwards;
      }

      @keyframes tf-iris {
        0% {
          clip-path: circle(150% at var(--ix, 50%) var(--iy, 50%));
          opacity: 1;
        }

        92% {
          opacity: 1;
        }

        100% {
          clip-path: circle(0% at var(--ix, 50%) var(--iy, 50%));
          opacity: 0;
        }
      }

      .tf-dip {
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
      }

      .tf-dip img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        filter: var(--tf-lut);
        animation: tf-dip-frame 760ms linear forwards;
      }

      /* the freeze holds until the veil has fully closed, then drops
         under cover — the incoming shot is never seen before the dip */
      @keyframes tf-dip-frame {
        0%,
        38% {
          opacity: 1;
        }

        42%,
        100% {
          opacity: 0;
        }
      }

      .tf-dip i {
        position: absolute;
        inset: 0;
        opacity: 0;
        animation: tf-dip-veil 760ms ease-in-out forwards;
      }

      @keyframes tf-dip-veil {
        0% {
          opacity: 0;
        }

        32%,
        48% {
          opacity: 1;
        }

        100% {
          opacity: 0;
        }
      }

      /* ---- the lens ------------------------------------------------- */
      /* THE CLOUD IS A CAST SHADOW, not a filter over the lens. A band
         swept across the whole frame reads as somebody dimming the
         picture; what a cloud actually does is drop a soft, uneven
         shape onto the land and the building, keep its edges out of
         focus, and move. Two overlapping blobs on a wide plate,
         multiplied over the scene and travelling with the sun's rake. */
      .tf-cloud {
        position: absolute;
        inset: -35% -45%;
        z-index: 1;
        pointer-events: none;
        opacity: calc(var(--tf-cloud, 0) * 0.62);
        background:
          radial-gradient(
            62% 40% at 32% 44%,
            rgba(72, 84, 108, 0.42) 0%,
            rgba(78, 92, 116, 0.26) 46%,
            rgba(96, 108, 128, 0) 72%
          ),
          radial-gradient(
            48% 32% at 68% 58%,
            rgba(66, 78, 102, 0.34) 0%,
            rgba(84, 96, 120, 0.18) 52%,
            rgba(96, 108, 128, 0) 78%
          );
        mix-blend-mode: multiply;
        filter: blur(26px);
        transform: rotate(calc(var(--tf-rake, 35deg) * 0.4))
          translate3d(
            calc(var(--tf-cloud, 0) * -16%),
            calc(var(--tf-cloud, 0) * 7%),
            0
          );
      }

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

      .is-title .tf-kicker::after {
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

      .is-point .tf-kicker::after,
      .is-lower .tf-kicker::after {
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
      .tf-block.is-title {
        right: 6%;
        bottom: 15%;
        text-align: right;
        max-width: min(40ch, 46vw);
      }

      .is-title .tf-read {
        justify-content: flex-end;
      }

      .is-title .tf-kicker {
        flex-direction: row-reverse;
      }

      .is-title .tf-line {
        margin-left: auto;
      }

      .is-title .tf-kanji {
        font-size: clamp(72px, 11vw, 190px);
      }

      .tf-block.is-lower {
        left: 5.5%;
        bottom: 11%;
      }

      /* captions take the foot of the frame, so the settings that live
         down there move up out of their way rather than sit under them */
      .has-subs .tf-block.is-lower {
        bottom: 21%;
      }

      .has-subs .tf-block.is-title {
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
      .tf-block.is-plate {
        right: 5.5%;
        top: 50%;
        transform: translateY(-50%);
        display: grid;
        grid-template-columns: 1fr auto;
        column-gap: clamp(18px, 2vw, 34px);
        align-items: start;
        max-width: min(46ch, 46vw);
      }

      .is-plate .tf-plane {
        grid-column: 1;
      }

      .is-plate .tf-plane.is-glyph {
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

      .is-plate .tf-kanji {
        writing-mode: vertical-rl;
        margin: 0;
        /* the column never grows past the frame: whichever is smaller,
           the designed size or the height each glyph can have and still
           leave the set inside the picture */
        font-size: min(
          clamp(44px, 5.4vw, 88px),
          calc(62svh / var(--tf-glyphs, 3))
        );
        letter-spacing: 0.1em;
        line-height: 1;
      }

      .is-plate .tf-kicker {
        margin-bottom: 18px;
      }

      /* the ghost is only ever behind a plate — everywhere else the frame
         is already carrying the building */
      .tf-ghost {
        display: none;
      }

      /* THE PLANES LEAN. Each layer takes the pointer at its own depth —
         the ghost furthest, the big glyph next, the reading lines least
         — so the type stack has air in it rather than being one sheet
         of glass in front of a picture. */
      .tf-block {
        transform: translate3d(
          calc(var(--tf-lx, 0) * -9px),
          calc(var(--tf-ly, 0) * -5px),
          0
        );
      }

      .tf-plate .tf-ghost {
        transform: translateY(-50%)
          translate3d(
            calc(var(--tf-lx, 0) * -26px),
            calc(var(--tf-ly, 0) * -14px),
            0
          );
      }

      .tf-kanji {
        transform: translate3d(
          calc(var(--tf-lx, 0) * -15px),
          calc(var(--tf-ly, 0) * -8px),
          0
        );
      }

      /* the ghost NUMERAL keeps its old treatment: a filled slab of ink
         at a whisper of opacity, behind the plate. It is a page
         furniture mark, not type in the world — the hollow treatment
         belongs to the glyphs that share air with the building. */
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
        opacity: calc(0.07 * var(--tf-ghost-a, 1));
        pointer-events: none;
        z-index: -1;
      }

      .tf-block.is-point {
        left: 5.5%;
        top: 18%;
        max-width: min(30ch, 34vw);
      }

      .is-point .tf-kanji {
        font-size: clamp(48px, 6.6vw, 104px);
      }

      /* ---- the photograph -------------------------------------------- */
      .tf-photo {
        position: absolute;
        z-index: 4;
        pointer-events: none;
      }

      .tf-photo figure.is-lower,
      .tf-photo figure.is-title,
      .tf-photo figure.is-point {
        position: absolute;
        right: 5.5%;
        top: 12%;
      }

      .tf-photo figure.is-plate {
        position: absolute;
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
        color: var(--tf-red);
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

      .tf-fault {
        position: absolute;
        left: 5.5%;
        bottom: 4%;
        z-index: 9;
        margin: 0;
        padding: 8px 12px;
        background: #2a0a06;
        color: #ffb4a0;
        font: 12px/1.4 ui-monospace, monospace;
        border-radius: 8px;
        max-width: 80%;
      }

      .tf-rig {
        position: absolute;
        width: 0;
        height: 0;
      }

      /* ---- the disc menu --------------------------------------------- */
      /* the sheet belongs to the picture: it scrims the scene and its
         transport, and leaves the wall plate below the film alone —
         a menu that dims an article is a modal, not a disc menu */
      .tf-menu {
        position: absolute;
        inset: 0 0 auto 0;
        height: 100svh;
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
      /* ---- the player ------------------------------------------------ *
       * A chaptered playhead in the film's own materials: gaps between
       * the chapters, seal red for what has played, and a head you can
       * take hold of. It sits ON the picture, above the transport, and
       * both stand down when the hand goes away.
       * ------------------------------------------------------------- */
      /* THE PLAYER FLOATS ON THE PICTURE, the way every player does —
         a paper bar under the frame costs fifty pixels of film and
         announces that this is a document with a video in it. */
      .tf-player {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5;
        padding-bottom: 4px;
        background: linear-gradient(
          to top,
          rgba(18, 13, 5, 0.74),
          rgba(18, 13, 5, 0.32) 62%,
          rgba(18, 13, 5, 0) 100%
        );
        transition: opacity 340ms ease;
      }

      /* IDLE HIDES THE CHROME, NOT THE FILM'S PLACE IN ITSELF. The
         controls go; the playhead stays as a hairline, which is both
         the progress and the thing you reach for to bring the rest
         back. A player that vanishes completely reads as a player that
         was never there. */
      .tf-player.is-idle {
        background: none;
      }

      .tf-player.is-idle .tf-controls {
        opacity: 0;
        pointer-events: none;
      }

      .tf-player.is-idle .tf-scrub-track {
        height: 3px;
        opacity: 0.5;
      }

      .tf-scrub {
        position: relative;
        flex: none;
        height: 26px;
        padding: 10px 5.5% 0;
        display: flex;
        align-items: center;
        cursor: pointer;
        touch-action: none;
        transition: opacity 320ms ease;
      }

      .tf-scrub.is-away {
        opacity: 0;
        pointer-events: none;
      }

      .tf-scrub-track {
        display: flex;
        gap: 4px;
        width: 100%;
        height: 4px;
        transition: height 160ms ease;
      }

      .tf-scrub:hover .tf-scrub-track {
        height: 7px;
      }

      .tf-scrub-ch {
        position: relative;
        overflow: hidden;
        background: rgba(247, 240, 224, 0.3);
        border-radius: 2px;
      }

      /* each chapter fills with the part of the whole-film playhead that
         falls inside it — one custom property, updated per frame, and no
         re-render anywhere */
      .tf-scrub-ch i {
        position: absolute;
        inset: 0 auto 0 0;
        display: block;
        background: var(--tf-red);
        width: calc(
          clamp(0, (var(--tf-prog, 0) - var(--s0)) / var(--sl), 1) * 100%
        );
      }

      .tf-scrub-head {
        position: absolute;
        top: 50%;
        left: calc(5.5% + var(--tf-prog, 0) * 89%);
        width: 11px;
        height: 11px;
        margin: -5.5px 0 0 -5.5px;
        border-radius: 50%;
        background: var(--tf-red);
        box-shadow: 0 0 0 2px var(--tf-white);
        transform: scale(0);
        transition: transform 160ms ease;
      }

      .tf-scrub:hover .tf-scrub-head,
      .tf-scrub:focus-visible .tf-scrub-head {
        transform: scale(1);
      }

      .tf-scrub-tip {
        position: absolute;
        bottom: 24px;
        left: calc(5.5% + var(--tf-prog, 0) * 89%);
        transform: translateX(-50%);
        white-space: nowrap;
        background: rgba(24, 18, 8, 0.9);
        color: #fff;
        font-family: var(--tf-ui);
        font-size: 10px;
        letter-spacing: 0.12em;
        padding: 5px 9px;
        border-radius: 3px;
      }

      .tf-time {
        margin-left: auto;
        font-variant-numeric: tabular-nums;
        color: rgba(247, 240, 224, 0.82);
      }

      .tf-time i {
        opacity: 0.5;
        font-style: normal;
        padding: 0 3px;
      }

      /* nobody is touching it: the apparatus gets out of the way of the
         picture, the way every player made since 2010 does */


      .tf-controls {
        transition: opacity 340ms ease;
        flex: none;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 5.5% 12px;
        color: #f3ead6;
        font-family: var(--tf-ui);
        font-size: 11px;
        letter-spacing: 0.14em;
      }

      .tf-btn {
        appearance: none;
        border: 1px solid rgba(247, 240, 224, 0.32);
        background: transparent;
        color: #f3ead6;
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

      /* only ever under ?debug: which cut of the film the browser has */
      .tf-build {
        margin-left: 14px;
        color: #a8621f;
        font:
          10px/1 ui-monospace,
          monospace;
        letter-spacing: 0.06em;
      }

      /* embedded, the iframe wraps the film AND its transport directly;
         the app's own chrome inside the iframe stands down instead */
      body.tf-embedded .topbar,
      body.tf-embedded .footer {
        display: none;
      }

      /* THE FILM ESCAPES THE APP'S PAGE CONTAINER. `.page` centres a
         measured column with gutters and a top offset — right for every
         demo page, and a pink-tinted mat around a film that owns its
         frame. Both film bodies flatten it; the film's own layout is the
         page. (This mattered only once tf-page left position: fixed —
         fixed elements never felt the container.) */
      body.tf-film .page,
      body.tf-embedded .page {
        width: 100%;
        margin: 0;
        padding: 0;
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
      /* THE DOOR DOES NOT BLUR THE BUILDING. A poster's job is to make
         the subject look like the reason to press play; a blur makes it
         look like a placeholder. The scene stays sharp and keeps
         turning (see the poster orbit) — the only thing over it is a
         ground for the type, raked away from the tower. */
      .tf-gate {
        position: absolute;
        inset: 0;
        z-index: 7;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        background: linear-gradient(
          100deg,
          rgba(24, 18, 8, 0) 26%,
          rgba(24, 18, 8, 0.28) 52%,
          rgba(22, 16, 7, 0.72) 82%
        );
      }

      .tf-gate-in {
        position: relative;
        text-align: center;
        font-family: var(--tf-ui);
        color: #f7f0e0;
        /* hard right: the poster is a two-column composition — building
           in one half, wordmark in the other — and the wordmark drifting
           toward the middle closes the gap that makes it one */
        margin-right: clamp(34px, 7vw, 132px);
      }

      /* the museum frame: hairline, inset like a mat, above the scene
         and under the type */
      .tf-gate-frame {
        position: absolute;
        inset: clamp(14px, 2.4vw, 30px);
        border: 1px solid rgba(247, 240, 224, 0.34);
        pointer-events: none;
        animation: tf-mg-fade 1200ms ease-out both;
      }

      /* the spine: vertical Japanese down the inside of the frame */
      .tf-gate-vert {
        position: absolute;
        top: 50%;
        left: clamp(30px, 4.6vw, 58px);
        transform: translateY(-50%);
        writing-mode: vertical-rl;
        font-family: var(--tf-display);
        font-size: clamp(13px, 1.3vw, 18px);
        letter-spacing: 0.42em;
        color: rgba(247, 240, 224, 0.66);
        animation: tf-mg-fade 900ms ease-out both;
        animation-delay: 2050ms;
      }

      .tf-gate-k {
        position: relative;
        margin: 0;
        font-family: var(--tf-display);
        font-size: min(22vh, 17vw);
        line-height: 1.02;
        text-shadow: 0 8px 70px rgba(20, 14, 4, 0.55);
      }

      /* the ghost: the title again, enormous and hollow, standing behind
         itself — the poster's depth comes from one word at two weights */
      .tf-gate-ghost {
        position: absolute;
        left: 50%;
        top: 44%;
        transform: translate(-50%, -50%) scale(1.9);
        font-size: 1em;
        line-height: 1;
        color: transparent;
        -webkit-text-stroke: 1px rgba(247, 240, 224, 0.2);
        white-space: nowrap;
        pointer-events: none;
        animation: tf-mg-ghost 2400ms ease-out both;
        animation-delay: 700ms;
      }

      @keyframes tf-mg-ghost {
        0% {
          opacity: 0;
          transform: translate(-50%, -50%) scale(2.05);
        }

        100% {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1.9);
        }
      }

      /* the index strip along the foot of the frame */
      .tf-gate-index {
        position: absolute;
        left: clamp(40px, 7vw, 90px);
        right: clamp(40px, 7vw, 90px);
        bottom: clamp(30px, 5.4vh, 56px);
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px clamp(12px, 2.2vw, 36px);
        margin: 0;
        font-family: var(--tf-ui);
        font-size: clamp(9px, 0.8vw, 11px);
        font-weight: 700;
        letter-spacing: 0.22em;
        color: rgba(247, 240, 224, 0.62);
        animation: tf-mg-fade 900ms ease-out both;
        animation-delay: 2500ms;
      }

      .tf-gate-index span {
        white-space: nowrap;
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
        font-weight: 600;
        letter-spacing: 0.14em;
        cursor: pointer;
        padding: 14px 30px;
        border-radius: 999px;
        border: 1px solid #f2e9d2;
        background: #f2e9d2;
        color: #2e2515;
        box-shadow: 0 10px 34px rgba(20, 14, 4, 0.35);
        transition:
          transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
          box-shadow 220ms ease;
      }

      .tf-go:hover {
        transform: translateY(-2px);
        box-shadow: 0 16px 44px rgba(20, 14, 4, 0.42);
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

      /* ---- the cutting room ------------------------------------------ *
         The dive itself is the app's own template (.dive/.dd, app.css);
         this wrapper just seats it on the app's page ground below the
         film, and the joins strip is the one film-only element. */
      .tf-notes {
        background: var(--bg-page);
        border-top: 1px solid var(--line);
        padding: 10px clamp(20px, 5vw, 60px) 80px;
      }

      .tf-notes .dive {
        max-width: 1080px;
        margin: 0 auto;
      }

      .dd-joins {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .dd-joins button {
        appearance: none;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        border: 1px solid var(--line);
        background: transparent;
        color: var(--ink);
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
        padding: 8px 13px;
        border-radius: 10px;
        cursor: pointer;
        transition:
          transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
          border-color 180ms ease;
      }

      .dd-joins button:hover {
        transform: translateY(-2px);
        border-color: var(--ember);
      }

      .dd-joins button i {
        font-style: normal;
        font-size: 10px;
        font-weight: 500;
        color: color-mix(in srgb, var(--ink) 60%, var(--bg-page));
      }

      /* the app's own chrome, gone: this route is a frame, not a page */
      body.tf-film .topbar,
      body.tf-film .footer {
        display: none;
      }
    </style>
  </template>
}
