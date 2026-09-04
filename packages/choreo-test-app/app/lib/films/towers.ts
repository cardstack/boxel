/**
 * THE FILM'S DATA — the shot list and everything it names, as a plain
 * module. No Ember, no DOM: this is what an agent edits, what the
 * schedule is computed from, and what `scripts/film-fixtures.mjs` reads
 * headless to write the golden fixtures. The component imports it.
 */
import type { Beat, FilmGrade, LookFx, Pt3 } from 'glimmer-motion/film';
import { hex, RAD } from 'glimmer-motion/film/math';

/**
 * TOWERS — a film, at `/towers`.
 *
 * The first reference film for the film construct (notes/film-construct.md),
 * now cut ON it: what is left here is the shot list, the script, the
 * chapters, the six climates, the traces sampled off the keep, and the
 * front and back matter in the film's own Japanese voice. The engine —
 * the chased lens, the joins, the type, the voice, the transport — is
 * `<Film>`.
 *
 * THE SUBJECT is the Japanese castle keep — the 天守 tenshu — and the film
 * is built the way an educational one is: context, then history, then
 * construction, then detail, then a comparison that puts the whole thing
 * in a wider frame. The scene it is shot in (`public/asset/towers-model.html`, Meng
 * To's construction study from threeui, vendored whole on its own pinned
 * three r149) grows six different towers out of the ground on a clock,
 * which is the rarest thing to find in a piece of web art: a subject that
 * can be taken apart on camera.
 *
 * WHAT THE POSE ARGS MEAN HERE (an orbit rig):
 *   yaw    → the orbit's azimuth, degrees
 *   pitch  → its elevation, degrees (the scene floors it near the horizon)
 *   dolly  → magnification: the scene fits the tower by solving for fov,
 *            so this scales that fit; bigger is tighter
 *   lookY  → world height minus 7.065, the rig's mid-height
 *   ox     → an off-centre frustum, fractions of the frame
 */

/** which cut of the film this is — logged at boot, shown under `?debug` */
export const BUILD =
  'towers cut-12 · the bar learns to listen, on the construct';

/**
 * THE FIVE MOODS AND THE SIX PLATES, as numbers the glass can take —
 * transcribed one for one from the CSS filters they replaced, with
 * brightness pulled back toward 1 since the pipeline went linear. The six
 * climates are the comparison's own: each lineup shot gets a different
 * afternoon, not a tint on the same one.
 */
export const GRADES: Record<string, FilmGrade> = {
  /* THE NIGHT. The chapter grades all lift the picture a little, which
     is right for daylight and wrong for the one night shot: a night that
     has been lifted is dusk. This one pulls the black down, cools the
     shadows and leaves the rim light to do the drawing. */
  night: {
    sat: 0.78,
    con: 1.12,
    /* a moonlit night, not a black one: the dark is the stock's job */
    bri: 0.8,
    sep: 0,
    hue: 0,
    warm: hex('#c9c2b4'),
    cool: hex('#8193b8'),
    gradeA: 0.5,
    vigA: 0,
  },
  amber: {
    sat: 0.9,
    con: 0.968,
    bri: 1.07,
    sep: 0,
    hue: 0,
    warm: hex('#ffd9a8'),
    cool: hex('#b9c8e6'),
    gradeA: 0.3,
    vigA: 0,
  },
  iron: {
    sat: 0.72,
    con: 1.009,
    bri: 1.04,
    sep: 0.1,
    hue: 0,
    warm: hex('#e8d9c2'),
    cool: hex('#9fb0c8'),
    gradeA: 0.4,
    vigA: 0,
  },
  chalk: {
    sat: 0.88,
    con: 0.989,
    bri: 1.12,
    sep: 0,
    hue: 0,
    warm: hex('#fffdf6'),
    cool: hex('#cfdde8'),
    gradeA: 0.2,
    vigA: 0,
  },
  ink: {
    sat: 0.98,
    con: 1.03,
    bri: 1.06,
    sep: 0,
    hue: 0,
    warm: hex('#ffc9a1'),
    cool: hex('#8fa0c9'),
    gradeA: 0.32,
    vigA: 0,
  },
  wet: {
    sat: 0.72,
    con: 0.948,
    bri: 0.98,
    sep: 0,
    hue: -4 * (Math.PI / 180),
    warm: hex('#cfd6dd'),
    cool: hex('#7d8b9e'),
    gradeA: 0.44,
    vigA: 0,
  },
  plate: {
    sat: 0.86,
    con: 0.978,
    bri: 1.07,
    sep: 0,
    hue: 0,
    warm: hex('#f6e8d2'),
    cool: hex('#c3c8bd'),
    gradeA: 0.18,
    vigA: 0,
  },
  'c-jp': {
    sat: 0.84,
    con: 0.978,
    bri: 1.08,
    sep: 0,
    hue: 0,
    warm: hex('#f6e8d2'),
    cool: hex('#bcc6bb'),
    gradeA: 0.2,
    vigA: 0,
  },
  /* THE SIX COUNTRIES ARE SIX CLIMATES, and the grade is where the film
     says so. Each lineup shot gets its own colourist's pass — not a
     tint on the same afternoon, a different afternoon. */
  /* the north, in snow: colour drained to steel, the split-tone all cool,
     the whites lifted — the eye should feel the temperature drop at the
     cut before the flakes register */
  'c-cn': {
    sat: 0.62,
    con: 1.051,
    bri: 1.06,
    sep: 0,
    hue: 0,
    warm: hex('#e8e6e0'),
    cool: hex('#9fb3cc'),
    gradeA: 0.4,
    vigA: 0,
  },
  /* the humid south: saturated, soft contrast (wet air), a jade cool
     and a lime warm, the hue turned a touch toward green */
  'c-vn': {
    sat: 1.0,
    con: 0.948,
    bri: 1.05,
    sep: 0,
    hue: -8 * (Math.PI / 180),
    warm: hex('#e6f0c8'),
    cool: hex('#7fb59a'),
    gradeA: 0.34,
    vigA: 0,
  },
  /* the hot plain: bright, gold in both ends of the tone, the vignette
     nearly gone — a noon with nowhere to hide */
  'c-th': {
    sat: 1.12,
    con: 0.989,
    bri: 1.1,
    sep: 0.04,
    hue: 0,
    warm: hex('#ffd77a'),
    cool: hex('#d9b56a'),
    gradeA: 0.34,
    vigA: 0,
  },
  /* laterite and monsoon haze: sepia into the stone's own rust, the
     corners closed down, the light heavier than anywhere else */
  'c-kh': {
    sat: 0.86,
    con: 1.051,
    bri: 1.04,
    sep: 0.2,
    hue: 0,
    warm: hex('#e9b98a'),
    cool: hex('#9c8a70'),
    gradeA: 0.4,
    vigA: 0,
  },
  /* dressed limestone under a hard clear sky: the warm end nearly white,
     the cool end İznik blue, contrast up — Mediterranean light */
  'c-tr': {
    sat: 0.8,
    con: 1.082,
    bri: 1.11,
    sep: 0,
    hue: 0,
    warm: hex('#fff6e8'),
    cool: hex('#86a8cc'),
    gradeA: 0.34,
    vigA: 0,
  },
};

/**
 * THE LEVELS. The reads were recorded across sessions and their mean
 * loudness spreads seven decibels (ffmpeg volumedetect, 2026-09-02: -24.6
 * to -31.9 dB). An element's volume cannot go above 1, so the loud ones
 * come down to meet the quiet ones at about -29 dB mean; the three
 * quietest stay where they are. Peaks never clip (all under -3.8 dBFS),
 * so this is a trim, not a limiter.
 */
export const VO_GAIN: Record<string, number> = {};

/**
 * WHAT EACH READ ACTUALLY RUNS, seconds, measured with ffprobe against the
 * files in `public/towers/vo/`. The kinetic type is paced against the VOICE,
 * not against the beat: the last cue should land as the line is finishing,
 * whether the read is four seconds or thirteen. Estimating this went wrong
 * once already (see notes/towers-vo.md) — so it is measured, and a re-record
 * means re-measuring. A beat missing from here paces against its own length.
 */
export const VO_SECS: Record<string, number> = {
  azuchi: 8.44,
  boro: 7.0,
  'c-cn': 7.76,
  'c-jp': 4.31,
  'c-kh': 8.59,
  'c-th': 6.11,
  'c-tr': 7.47,
  'c-vn': 7.84,
  kaitai: 16.12,
  muneage: 4.02,
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
/* each chapter's stock rides beside its grade: the same five looks the
   page bakes, by the same names, under the grade at a lighter amount
   than the second film's — this picture was tuned bright */
export const CHAPTERS = [
  { grade: 'amber', lut: 'sandstone', n: '01', title: 'CONTEXT' },
  { grade: 'iron', lut: 'iron', n: '02', title: 'HISTORY' },
  { grade: 'chalk', lut: 'chalk', n: '03', title: 'CONSTRUCTION' },
  { grade: 'ink', lut: 'ink', n: '04', title: 'DETAIL' },
  { grade: 'plate', lut: 'plate', n: '05', title: 'COMPARISON' },
];
export const LUT_AMOUNT = 0.4;

/* A LOOK'S OWN TEXTURE, where the chapter's amount is wrong for it. The
   night: the edict is the film's one night shot, and the pass's milk lift
   (a warm fog into every black, right for a bright day) turned its ground
   white. The floodlit stock crushes the ground and keeps the lit keep's
   whites; the lift goes to nothing and the corners close a little. */
export const LOOK_FX: Record<string, LookFx> = {
  /* at 0.85 the keep went under with the ground; 0.6 keeps the ground
     dark and the keep readable, and a breath of lift is the moonlight */
  floodlit: { amount: 0.6, lift: 0.025, vig: 0.12 },
};

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

/** an arc at a height, swept between two bearings — an eave, a rail, a ring */
export const ring = (
  y: number,
  r: number,
  a0: number,
  a1: number,
  n = 40
): Pt3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / n) * RAD;
    return [Math.sin(a) * r, y, Math.cos(a) * r] as Pt3;
  });

/** the 扇の勾配 in section: the stone's own radius, sampled up its height */
export const batter = (bearing: number, n = 22): Pt3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const y = (3.3 * i) / n;
    const f = y / 3.3;
    const r = 2.66 + (3.36 - 2.66) * Math.pow(1 - f, 1.85);
    const a = bearing * RAD;
    return [Math.sin(a) * r, y, Math.cos(a) * r] as Pt3;
  });

/** a plain segment between two points in the world */
export const seg = (a: Pt3, b: Pt3): Pt3[] => [a, b];

/* the tower's own lines, in its own coordinates — see `ring`/`batter` */
export const RING_EAVE1 = ring(5.02, 3.32, 60, 300);
export const RING_EAVE2 = ring(7.7, 2.84, 60, 300);
export const RING_EAVE3 = ring(10.16, 2.42, 60, 300);
export const RAIL = ring(11.3, 1.84, 40, 320);
export const RIDGE = seg([0.51, 13.72, 0.51], [-0.51, 13.72, -0.51]);
export const BATTER_L = batter(128);
export const BATTER_R = batter(232);

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
export const BEATS: Beat[] = [
  /* ---------------------------------------------------------------- *
   * 01 — CONTEXT: what the thing in front of you actually is
   * ---------------------------------------------------------------- */
  {
    build: 4.4,
    /* the film opens from as far out as the lens goes and spends the
       whole first beat arriving — a slow push from "a landscape with
       something in it" to "this building, specifically" */
    cam: { dolly: 0.5, lookY: -1.2, ox: 0.3, pitch: 12, yaw: -46 },
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
    vo: 'Tenshu. You know the shape. Almost nobody knows what is holding it up. So let us take one apart.',
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
    /* four ticks: the line is six seconds and the cut to the ground
       should land on its last word, not after a breath of dead air */
    ticks: 4,
    /* and the push ARRIVES: the beat ends on the building, not on a
       field with a building in it */
    toCam: { dolly: 0.98, lookY: -0.3, ox: 0.2, pitch: 13, yaw: -26 },
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
       it the keep is a silhouette of nothing — and it wears the night
       grade, since the chapter's own would lift it back to dusk */
    grade: 'night',
    /* and the night's own stock: the ground goes dark, the keep stays lit */
    lut: 'floodlit',
    /* and a stronger backlight, so the keep glows against its own night */
    rim: 1.7,
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
    /* out of the edict's night into the building morning under a DIP:
       the standing keep has to leave the field before the next four
       minutes put one up, and a building cannot be wiped away in the
       open — the black takes it, and the morning is already there when
       the black lifts. A cut under the dip, so the lens is seated on
       the stone before anything is seen. */
    cut: true,
    join: 'dip',
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
    vo: 'Ishigaki. Dry stone, no mortar, stacked into a curve. A straight wall argues with an earthquake. This one passes it into the hill.',
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
    vo: 'Chūryō. Above the stone, a timber cage. Posts sit on footing stones, not in the ground. Nothing is bolted. The joints do the work.',
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
    vo: 'Shirakabe. Lime plaster, thick enough to be armour. White, because white does not burn.',
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
    vo: 'Bōrō. At the top, one room you can see out of. Everything below it is how you get that room into the air.',
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
    vo: 'Kawara. Fired clay, hung, never nailed. The heaviest thing in the building, and that weight is what holds it still. The roof is ballast.',
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
    /* graded like the chapter that follows: the carpenters leave in
       the same late warmth the close-ups are cut in, so the seam into
       04 changes the lens and nothing else */
    grade: 'ink',
    id: 'muneage',
    join: 'blend',
    mode: 'clear',
    ticks: 2,
    toCam: { dolly: 0.5, lookY: 0.9, ox: 0, pitch: 13, yaw: 152 },
    vo: 'Muneage. The ridge goes on, and the carpenters stop for the day.',
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
    says: ['One building.', 'One moment.', 'Only the lens moves.'],
    kanji: '細部',
    kicker: 'LOOK CLOSER',
    /* and the lens does move: a medium push up to the roof across the
       beat, so the cut to the ridge fish lands where the eye already is */
    toCam: { dolly: 1.55, lookY: 4.6, ox: 0.12, pitch: 15, yaw: 158 },
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
    /* the fish is found from a step back and pushed into: the eye reads
       the ridge first, then the creature on it */
    cam: { dolly: 3.6, lookY: 6.8, ox: -0.18, pitch: 4, yaw: 156 },
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
    toCam: { dolly: 4.75, lookY: 6.85, ox: -0.18, pitch: 7, yaw: 164 },
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
    vo: 'Chidori-hafu. Named after a plover. Light and air for a deep floor. Also somewhere to stand and look down at you.',
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
    vo: 'Kōran. A rail on a ledge too narrow to walk. Built to be seen, not used.',
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
    vo: 'Noki. A metre of overhang. Every line you have admired is a way of keeping rain off earth and wood. Wait for weather; the styling explains itself.',
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
    /* THE STORM, not rain. This is the beat the whole chapter is for —
       "wait for weather; the styling explains itself" — and rain under
       an overcast sky illustrates the sentence where a storm makes the
       argument: the eave is a metre of overhang because water arrives
       with force behind it, not because it drizzles. */
    wx: 2,
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
    /* the comparison is a clear day: the rain stops at the plate, it
       does not thaw across the flight into it */
    wxCut: true,
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
    /* clear. Weather is a sentence, not wallpaper: the storm belongs to
       the eaves (noki) and the snow to the north (c-cn); the question is
       asked in plain air. (`lightning` is a separate cue, still unspent
       — a flash is an event, and no beat has earned one yet.) */
    wx: 0,
  },
  {
    cam: { dolly: 0.64, lookY: -3.6, ox: -0.2, pitch: 2, yaw: 210 },
    ch: 4,
    /* the first of the six enters the way the other five do — and a
       seam here lets the plate shot ahead of it carry a real drift */
    cut: true,
    gloss: 'Japan · the keep',
    bob: 0.85,
    grade: 'c-jp',
    mix: { wx: 0 },
    hold: true,
    id: 'c-jp',
    toCam: { dolly: 1.05, lookY: 4.4, ox: -0.16, pitch: 15, yaw: 238 },
    /* the storm was the question; the lineup is answered in clear air */
    wx: 0,
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
    cam: { dolly: 1.05, lookY: 4.6, ox: -0.16, pitch: 16, yaw: 238 },
    ch: 4,
    gloss: 'China · the pagoda',
    cut: true,
    bob: 0.85,
    grade: 'c-cn',
    mix: { wx: 0 },
    hold: true,
    id: 'c-cn',
    toCam: { dolly: 0.689, lookY: -2.8, ox: -0.22, pitch: 3, yaw: 214 },
    /* the north: it is snowing, the ground has taken it, and the wind is
       up enough to streak the flakes — cold on the first frame */
    winter: { gust: 0.55, pack: 1 },
    wx: 3,
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
    cam: { dolly: 1.05, lookY: 5.2, ox: -0.16, pitch: 15, yaw: 250 },
    ch: 4,
    gloss: 'Vietnam · the tower',
    cut: true,
    bob: 0.85,
    grade: 'c-vn',
    mix: { wx: 0 },
    hold: true,
    id: 'c-vn',
    toCam: { dolly: 0.672, lookY: -3.2, ox: -0.22, pitch: 2, yaw: 276 },
    /* south again: the snow goes with the cut, not on the page's
       thirteen-second thaw */
    winter: null,
    wx: 0,
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
    cam: { dolly: 0.754, lookY: -5.4, ox: -0.22, pitch: -6, yaw: 276 },
    ch: 4,
    gloss: 'Thailand · the prang',
    cut: true,
    bob: 0.85,
    grade: 'c-th',
    mix: { wx: 0 },
    hold: true,
    id: 'c-th',
    toCam: { dolly: 1.05, lookY: 3.6, ox: -0.15, pitch: 14, yaw: 300 },
    /* the slow one: a prang arrives, it is not cut to */
    join: 'melt',
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
    /* THE ONE SHOT THAT PULLS ITS PUNCH. This model does not hold up
       close — its corbelling reads as steps at any distance a drone
       would want — so the shot stands back, keeps a FACE rather than a
       corner in front of it, and moves about a quarter as far as its
       neighbours. A comparison is only fair if every subject is shown
       at its best, and "its best" is not the same lens for all six. */
    /* the prasat reads from eye level or below — its terraces and the
       redented corners are the point, and from above it is a heap. Both
       ends of the move stay at or under the horizon. */
    cam: { dolly: 0.74, lookY: -3.4, ox: -0.21, pitch: -4, yaw: 278 },
    ch: 4,
    gloss: 'Cambodia · the sanctuary',
    cut: true,
    bob: 0.5,
    grade: 'c-kh',
    mix: { wx: 0 },
    hold: true,
    id: 'c-kh',
    /* and it goes round: the redented corners and the other face are
       the point, so the move is an orbit, not a step */
    toCam: { dolly: 0.8, lookY: -1.6, ox: -0.17, pitch: -1, yaw: 326 },
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
    cam: { dolly: 1.05, lookY: 5.6, ox: -0.16, pitch: 17, yaw: 278 },
    ch: 4,
    gloss: 'Türkiye · the mosque',
    cut: true,
    bob: 0.85,
    grade: 'c-tr',
    mix: { wx: 0 },
    hold: true,
    id: 'c-tr',
    toCam: { dolly: 0.738, lookY: -4.6, ox: -0.22, pitch: 1, yaw: 306 },
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
    /* THE ENDING, in one breath: the tower comes down in the order it went
       up while the day runs out, the lens pulls back the whole way, and
       the end card arrives on the last stone. One beat, one line — the
       voice runs under the takedown and the night. */
    build: [4.4, 0],
    cam: { dolly: 0.95, lookY: 1.8, ox: -0.04, pitch: 8, yaw: 300 },
    ch: 4,
    cut: true,
    gloss: 'in the order it went up',
    grade: 'ink',
    /* the aim rides the cut line, so the takedown stays in the centre of
       the frame while the lens pulls back (zoom is a field-of-view
       divisor: smaller is wider) */
    bare: true,
    hold: 'top',
    hours: [0, 1, 2, 3],
    /* the day runs out early and the night holds: dusk lands at half the
       beat, night at three-quarters, and the last stones come down in it */
    hoursOver: 0.72,
    id: 'kaitai',
    join: 'blend',
    kanji: '解体',
    kicker: 'AND BACK DOWN',
    mode: 'lower',
    romaji: 'KAITAI',
    /* a second standing still before the first tile moves */
    settle: 1,
    says: [
      'Tile, plaster, timber',
      'Stone last',
      'A hill with a shape in it',
      'Enough to see from the fields',
    ],
    theme: 0,
    ticks: 10,
    toCam: { dolly: 0.4, lookY: -0.6, ox: -0.02, pitch: 12, yaw: 336 },
    vo: 'Take it down in the order it went up. Tile, plaster, timber. Stone last — the stone was never the building. It was the ground, raised. What is left is a hill with a shape in it. And the shape is enough to see from the fields.',
  },
];

/** the page's clock at which the keep stands whole */
export const STANDING = 4.4;

/** the keep's world type keeps the page's own face: kanji, in the page's mincho */
export const WORLD_TYPE = { track: 0.16 };
