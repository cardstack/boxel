/**
 * THE FILM'S DATA — the shot list and everything it names, as a plain
 * module. No Ember, no DOM: this is what an agent edits, what the
 * schedule is computed from, and what `scripts/film-fixtures.mjs` reads
 * headless to write the golden fixtures. The component imports it.
 */
import type {
  Beat,
  FilmClock,
  FilmGrade,
  LookFx,
  Picture,
  Pt3,
} from '@cardstack/choreo/film';
import { hex, RAD } from '@cardstack/choreo/film/math';

/**
 * SAGRADA — a film, at `/sagrada`.
 *
 * The second reference film for the film construct (notes/film-construct.md),
 * and the first one cut ON it: everything here is the shot list, the
 * script, the chapters, the year clock, the traces sampled off the model,
 * and the front and back matter. The engine — the chased lens, the joins,
 * the type, the voice, the transport — is `<Film>`.
 *
 * THE SUBJECT is the Basílica de la Sagrada Família in Barcelona, and the
 * scene it is shot in is the construction study in `~/Projects/sagrada-
 * familia`, vendored to `public/asset/sagrada-model.html` by that repo's own build
 * (`node build/build.mjs --lean <here>`) — never hand-edited. A page in an
 * iframe, on its own three r149, reached through `window.__film`.
 *
 * THE CLOCK IS IN YEARS: a beat's `build` is still in the page's seconds,
 * but the film authors it through `tAt(year)` so a shot can say "1912 to
 * 1925" and mean it — and the construct's timeline reads it back the same
 * way. The lens has a FOCUS on the ground (`fx`, `fz`): a basilica is a
 * hundred metres long with three fronts, and a shot of the Nativity front
 * aims at the Nativity front.
 *
 * WHAT THE POSE ARGS MEAN HERE (an orbit rig with a focus):
 *   yaw    → the orbit's azimuth, degrees, in the scene's own frame
 *            (the Nativity front is at +x = 90, the Passion at -90, the
 *            Glory front at 0, the apse at 180)
 *   pitch  → elevation, degrees
 *   dolly  → magnification (bigger is tighter)
 *   lookY  → world height minus 6.6, the rig's mid-height
 *   fx, fz → where on the ground the lens aims; 0,0 is the crossing
 *   ox     → an off-centre frustum, fractions of the frame
 */

/**
 * WHICH CUT OF THE FILM THIS IS. A dev server serves the app from source
 * but the motion library from its BUILT package, so an editor and a
 * browser can disagree about what is running with nothing on screen to
 * say so. The stamp is logged at boot and shown in the corner under
 * `?debug`.
 */
export const BUILD = 'sagrada cut-10 · on the construct';

/**
 * THE MOODS, as numbers the glass can take — transcribed one for one from
 * the CSS filters they replaced (saturate/contrast/brightness/sepia/hue,
 * the warm and cool ends of the split tone, its opacity, the vignette's).
 * Brightness is pulled back toward 1 since the pipeline went linear.
 */
export const GRADES: Record<string, FilmGrade> = {
  amber: {
    sat: 1,
    con: 1,
    bri: 1,
    sep: 0,
    hue: 0,
    warm: hex('#ffd9a8'),
    cool: hex('#b9c8e6'),
    gradeA: 0.14,
    vigA: 0,
  },
  iron: {
    sat: 1,
    con: 1,
    bri: 1,
    sep: 0,
    hue: 0,
    warm: hex('#e8d9c2'),
    cool: hex('#9fb0c8'),
    gradeA: 0.14,
    vigA: 0,
  },
  chalk: {
    sat: 1,
    con: 1,
    bri: 1,
    sep: 0,
    hue: 0,
    warm: hex('#fffdf6'),
    cool: hex('#cfdde8'),
    gradeA: 0.14,
    vigA: 0,
  },
  ink: {
    sat: 1,
    con: 1,
    bri: 1,
    sep: 0,
    hue: 0,
    warm: hex('#ffc9a1'),
    cool: hex('#8fa0c9'),
    gradeA: 0.14,
    vigA: 0,
  },
  wet: {
    sat: 1,
    con: 1,
    bri: 1,
    sep: 0,
    hue: -4 * (Math.PI / 180),
    warm: hex('#cfd6dd'),
    cool: hex('#7d8b9e'),
    gradeA: 0.14,
    vigA: 0,
  },
  plate: {
    sat: 1,
    con: 1,
    bri: 1,
    sep: 0,
    hue: 0,
    warm: hex('#f6e8d2'),
    cool: hex('#c3c8bd'),
    gradeA: 0.14,
    vigA: 0,
  },
};

/** the ends of the film's own timeline: the first stone, and the plan */
export const YEAR_A = 1882;
export const YEAR_B = 2034;

/**
 * THE LEVELS. One voice, one session, so the reads sit close together
 * (ffmpeg volumedetect, 2026-09-02, the Cedric session: -24.6 to -26.8 dB
 * mean, no peak above -6.4 dBFS — a tighter spread than the first voice).
 * Trimmed to meet at about -28 dB mean, the level the film was mixed at;
 * nothing goes up.
 */
export const VO_GAIN: Record<string, number> = {
  apse: 0.77,
  barnabas: 0.7,
  centenary: 0.81,
  crypt: 0.79,
  evangelists: 0.74,
  fruit: 0.79,
  gaudi: 0.68,
  gruistes: 0.72,
  jesus: 0.8,
  mary: 0.83,
  models: 0.74,
  nativity: 0.71,
  naves: 0.85,
  passion: 0.71,
  plan: 0.73,
  title: 0.75,
  war: 0.87,
};

/**
 * WHAT EACH READ ACTUALLY RUNS, seconds, measured with ffprobe against the
 * files in `public/sagrada/vo/`. The kinetic type is paced against the VOICE,
 * not against the beat: the last cue should land as the line is finishing,
 * whether the read is four seconds or thirteen. Estimating this went wrong
 * once already (see notes/towers-vo.md) — so it is measured, and a re-record
 * means re-measuring. A beat missing from here paces against its own length.
 */
export const VO_SECS: Record<string, number> = {
  apse: 8.54,
  barnabas: 8.62,
  centenary: 8.59,
  crypt: 7.42,
  evangelists: 9.14,
  fruit: 10.71,
  gaudi: 9.46,
  gruistes: 9.46,
  jesus: 14.65,
  mary: 11.52,
  models: 8.07,
  nativity: 8.78,
  naves: 10.29,
  passion: 10.4,
  plan: 9.2,
  title: 7.97,
  war: 10.29,
};

/**
 * THE CHAPTERS, and the colour each one is set in.
 *
 * ONE ACCENT FOR THE WHOLE FILM, and it is the red the basilica letters
 * itself in. A colour per chapter was a system announcing itself, and five
 * colours in five minutes is a brand guideline rather than a film.
 *
 * The film's information layer follows the basilica's own 2026 identity:
 * flat colour on stone paper, headings in heavy grotesque capitals, a
 * timeline of coloured dots. Each chapter takes one colour and everything
 * that is TYPE in that chapter takes it — the eyebrow, the word, the rule,
 * the dot on the rail — so the film is colour-coded the way the programme
 * is. `tint` is for a light frame, `tintD` for a dark one, because a
 * cobalt that sings on stone disappears against a night sky.
 */
export const CHAPTERS = [
  {
    grade: 'amber',
    lut: 'sandstone',
    n: '01',
    tint: '#d8232a',
    tintD: '#ff6b5e',
    title: 'THE SITE',
  },
  {
    grade: 'iron',
    lut: 'iron',
    n: '02',
    tint: '#d8232a',
    tintD: '#ff6b5e',
    title: 'SILENCE',
  },
  {
    grade: 'chalk',
    lut: 'chalk',
    n: '03',
    tint: '#d8232a',
    tintD: '#ff6b5e',
    title: 'THE LONG BUILD',
  },
  {
    grade: 'ink',
    lut: 'ink',
    n: '04',
    tint: '#d8232a',
    tintD: '#ff6b5e',
    title: 'THE TOWERS',
  },
  {
    grade: 'plate',
    lut: 'plate',
    n: '05',
    tint: '#d8232a',
    tintD: '#ff6b5e',
    title: 'THE PLAN',
  },
];
/** the page's clock back into years — the inverse of tAt */
export const yearAt = (t: number): number => {
  for (let i = 1; i < KEYS.length; i++) {
    if (t <= KEYS[i]![1]) {
      const a = KEYS[i - 1]!;
      const b = KEYS[i]!;
      return a[0] + ((b[0] - a[0]) * (t - a[1])) / (b[1] - a[1]);
    }
  }
  return KEYS[KEYS.length - 1]![0];
};

/**
 * THE CAMERA OF THE DAY. This is an architectural record, so each beat
 * wears the film a photograph of the site would have been on in its
 * year: albumen plates, then silver gelatin, Agfa, Ektachrome, Kodak
 * Gold, early digital, and from 2016 a clean 4K HD with the full gamut
 * (ACES tone curve, no grain, no vignette). The plan is a render.
 * Chosen by the beat's opening year; `Beat.look` overrides.
 */
export const ERAS: [number, string][] = [
  [1882, 'albumen'],
  [1913, 'silver'],
  [1939, 'agfa'],
  [1960, 'ekta'],
  [1980, 'kodak'],
  [2000, 'digital'],
  [2016, 'hd'],
  [2026.76, 'render'],
];
export const LOOK_FX: Record<string, LookFx> = {
  agfa: {
    amount: 0.72,
    ca: 0.0022,
    grain: 0.06,
    lift: 0.05,
    tone: 0,
    vig: 0.22,
  },
  albumen: {
    amount: 0.88,
    ca: 0.003,
    grain: 0.09,
    lift: 0.08,
    tone: 0,
    vig: 0.35,
  },
  digital: {
    amount: 0.6,
    ca: 0.0008,
    grain: 0.02,
    lift: 0.03,
    tone: 0.2,
    vig: 0.04,
  },
  ekta: {
    amount: 0.72,
    ca: 0.002,
    grain: 0.055,
    lift: 0.06,
    tone: 0,
    vig: 0.16,
  },
  /* the night: no milk in the blacks, the city goes under, the church stays lit */
  floodlit: {
    amount: 0.85,
    ca: 0.0012,
    grain: 0.03,
    lift: 0,
    tone: 0.3,
    vig: 0.15,
  },
  hd: { amount: 0.6, ca: 0, grain: 0, lift: 0.015, tone: 0.85, vig: 0 },
  kodak: {
    amount: 0.72,
    ca: 0.0016,
    grain: 0.045,
    lift: 0.04,
    tone: 0.1,
    vig: 0.1,
  },
  render: { amount: 0.6, ca: 0, grain: 0, lift: 0.02, tone: 0.5, vig: 0 },
  /* the finale: the whole gamut, pushed */
  vivid: { amount: 0.72, ca: 0, grain: 0, lift: 0.01, tone: 0.9, vig: 0.05 },
  silver: {
    amount: 0.88,
    ca: 0.002,
    grain: 0.08,
    lift: 0.05,
    tone: 0,
    vig: 0.3,
  },
};
/* kept as the record of which stock each decade was actually shot on —
   see LUT_AMOUNT for why the film no longer wears them */

export const eraLook = (year: number): string => {
  let look = ERAS[0]![1];
  for (const [y, l] of ERAS) {
    if (year >= y) {
      look = l;
    }
  }
  return look;
};
/** how much of the stock the picture wears when a beat names one directly */
/**
 * HOW MUCH OF THE STOCK.
 *
 * The era looks — an albumen plate for 1900, orthochromatic silver for the
 * thirties, faded Ektachrome for the seventies — were a costume. Wearing
 * the decade's own film stock announces the decade instead of showing it,
 * and over a building whose whole subject is CONTINUITY it made the film
 * look like five films. The chapter's own look is what colours a shot now
 * (sandstone, iron, chalk, ink, plate), a beat can still name a stock when
 * it genuinely wants one — the floodlit night does — and the amount comes
 * down so the grade sits under the picture instead of on it.
 */
export const LUT_AMOUNT = 0.52;

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

/** an arc at a height about a point on the plan */
export const ringAt = (
  cx: number,
  cz: number,
  y: number,
  r: number,
  a0: number,
  a1: number,
  n = 40
): Pt3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / n) * RAD;
    return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r] as Pt3;
  });

/* the plan, in the scene's own units (1 = 12.3 m): the crossing, the
   apse, the two fronts, the tower tops */
export const CRZ = -0.95;
export const APSE_Z = -2.08;
export const NAT_X = 2.05;
/** a ring whose radius follows the wall: [bearing, radius] pairs, interpolated */
export const ringR = (
  cx: number,
  cz: number,
  y: number,
  prof: [number, number][],
  n = 40
): Pt3[] => {
  const a0 = prof[0]![0];
  const a1 = prof[prof.length - 1]![0];
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    let r = prof[prof.length - 1]![1];
    for (let k = 1; k < prof.length; k++) {
      if (a <= prof[k]![0]) {
        const [pa, pr] = prof[k - 1]!;
        const [qa, qr] = prof[k]!;
        r = pr + ((qr - pr) * (a - pa)) / (qa - pa);
        break;
      }
    }
    return [cx + Math.sin(a * RAD) * r, y, cz + Math.cos(a * RAD) * r] as Pt3;
  });
};
/* every line below was sampled off the built model (the bridge's dbg()
   scene, vertices within a hand of the line's height), then given a
   finger of air so it sits ON the stone rather than in it */
/* the star of Mary: a ring just under the star's points, r 0.24 at 10.6 */
export const MARY_STAR = ringAt(0, APSE_Z, 10.6, 0.3, 0, 360, 48);
/* the cross: a ring round the arms at their height, r 0.63 at 13.4 */
export const JESUS_CROSS = ringAt(0, CRZ, 13.4, 0.72, 0, 360, 48);
/* Barnabas alone: his finial, r 0.27 at 7.5, centred on his own axis */
export const NAT_TOWERS = ringAt(2.05, -2.0, 7.5, 0.34, 0, 360, 40);
/* the apse wall at the chapel height, centred on the apse's own centre
   (APSE_Z — it was drawn 0.42 behind it, which put the traced ring and the
   working disc under it visibly out of register), the pinnacles' spikes
   capped so the line stays on the wall */
export const APSE_WALL = ringR(0, APSE_Z, 3.3, [
  [100, 1.6],
  [110, 1.57],
  [120, 1.51],
  [130, 1.5],
  [140, 1.4],
  [150, 1.33],
  [160, 1.34],
  [170, 1.33],
  [180, 1.4],
  [190, 1.33],
  [200, 1.34],
  [210, 1.4],
  [220, 1.4],
  [230, 1.5],
  [240, 1.51],
  [250, 1.57],
  [260, 1.6],
]);

/**
 * THE CLOCK, IN YEARS. The page runs its build on seconds and maps them
 * to years through this same table (see 08_layout_timeline.js in the
 * scene's source); it is copied here so a beat can be authored in years
 * without asking the page. Keep the two in step.
 */
export const KEYS: [number, number][] = [
  [1882, 0],
  [1889, 1.6],
  [1895, 3.2],
  [1901, 4.4],
  [1925, 9.4],
  [1930, 10.8],
  [1936.55, 12.0],
  [1939.5, 14.2],
  [1954, 15.8],
  [1976, 20.0],
  [1996, 23.4],
  [2010, 26.2],
  [2016, 28.0],
  [2021.9, 30.6],
  [2023.9, 32.0],
  [2026.13, 33.8],
  [2026.75, 35.0],
  [2040, 41.5],
];
export const tAt = (y: number): number => {
  if (y <= KEYS[0]![0]) {
    return 0;
  }
  for (let i = 1; i < KEYS.length; i++) {
    if (y <= KEYS[i]![0]) {
      const a = KEYS[i - 1]!;
      const b = KEYS[i]!;
      return a[1] + ((b[1] - a[1]) * (y - a[0])) / (b[0] - a[0]);
    }
  }
  return KEYS[KEYS.length - 1]![1];
};
/** the page's clock at the present day: the building as it stands */
export const T_TODAY = tAt(2026.75);
/** how much of the frosted city a film frame can carry: the page's own
    0.30 is right for a landing page and foam in a long lens */
export const CITY_GLASS = 0.16;

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
   * 01 — THE SITE: a field, a cornerstone, one man's forty years
   * ---------------------------------------------------------------- */
  {
    build: tAt(1882.3),
    cam: {
      dolly: 0.5,
      fx: 0,
      fz: 0,
      lookY: -2.4,
      ox: 0.28,
      pitch: 14,
      yaw: 35,
    },
    ch: 0,
    city: 'glass',
    gloss: 'Barcelona, 19 March 1882',
    grass: true,
    id: 'title',
    kanji: 'Obra',
    kicker: 'A CONSTRUCTION STUDY',
    mode: 'title',
    romaji: 'THE WORKS',
    says: [
      'A field at the edge of the grid',
      'One cornerstone',
      'A plan nobody alive would finish',
    ],
    theme: 0,
    ticks: 5,
    toCam: {
      dolly: 0.74,
      fx: 0,
      fz: -1,
      lookY: -2.0,
      ox: 0.2,
      pitch: 14,
      yaw: 52,
    },
    vo: 'March, eighteen eighty-two. A field at the edge of the grid, a cornerstone, and a plan nobody alive would finish.',
    wx: 1,
  },
  {
    build: [tAt(1882.3), tAt(1889)],
    cam: {
      dolly: 2.4,
      fx: 0,
      fz: APSE_Z,
      lookY: -5.4,
      ox: 0.1,
      pitch: 9,
      yaw: 205,
    },
    ch: 0,
    city: 'off',
    cut: true,
    gloss: 'the crypt, 1882–1889',
    grass: true,
    id: 'crypt',
    kanji: 'Cripta',
    kicker: 'BELOW THE GROUND',
    mode: 'lower',
    romaji: 'CRYPT',
    says: [
      'Villar draws a Gothic church',
      'He quits over the cost',
      'Gaudí is thirty-one',
    ],
    ticks: 5,
    toCam: {
      dolly: 2.1,
      fx: 0,
      fz: APSE_Z,
      lookY: -5.0,
      ox: 0.1,
      pitch: 11,
      yaw: 228,
    },
    vo: 'Villar draws a neo-Gothic church and leaves over the cost of the stone. The man who takes over is thirty-one.',
    wx: 1,
  },
  {
    build: [tAt(1891), tAt(1895)],
    buildBy: 0.6,
    follow: 'apse',
    cam: {
      dolly: 1.5,
      fx: 0,
      fz: APSE_Z,
      lookY: -4.6,
      ox: 0.12,
      pitch: 12,
      yaw: 160,
    },
    ch: 0,
    city: 'off',
    gloss: 'the apse, 1891–1895',
    grass: true,
    id: 'apse',
    kanji: 'Absis',
    kicker: 'THE LAST GOTHIC THING',
    mode: 'lower',
    romaji: 'APSE',
    says: [
      'Seven chapels',
      'Pinnacles like ears of corn',
      'Gothic, for the last time',
    ],
    theme: 0,
    ticks: 6,
    to: [1.35, 3.6, APSE_Z - 0.9],
    trace: [{ pts: APSE_WALL }],
    toCam: {
      dolly: 1.35,
      fx: 0,
      fz: APSE_Z,
      lookY: -3.6,
      ox: 0.12,
      pitch: 12,
      yaw: 176,
    },
    vo: 'The apse. Seven chapels, pinnacles like ears of corn. Gothic, and the last Gothic thing he built.',
    wx: 0,
  },
  {
    build: [tAt(1894), tAt(1925)],
    buildBy: 0.85,
    follow: 'nativity',
    cam: {
      dolly: 1.1,
      fx: NAT_X,
      fz: CRZ,
      lookY: -4.2,
      ox: 0.14,
      pitch: 6,
      yaw: 96,
    },
    ch: 0,
    city: 'off',
    gloss: 'the Nativity front, 1894–1930',
    haze: 0.18,
    id: 'nativity',
    kanji: 'Naixement',
    kicker: 'THE FRONT THAT FACES SUNRISE',
    mode: 'lower',
    romaji: 'NATIVITY',
    says: [
      'Stone melted into figures',
      'A cypress full of doves',
      'Thirty-one years',
    ],
    ticks: 8,
    toCam: {
      dolly: 1.0,
      fx: NAT_X,
      fz: CRZ,
      lookY: -2.6,
      ox: 0.14,
      pitch: 8,
      yaw: 82,
    },
    vo: 'The Nativity front, facing the sunrise. Stone melted into figures, a cypress full of doves. Thirty-one years of it.',
    wx: 0,
  },
  {
    build: tAt(1931),
    cam: {
      dolly: 4.2,
      fx: 2.35,
      fz: CRZ,
      lookY: -5.0,
      ox: 0.08,
      pitch: 3,
      yaw: 88,
    },
    ch: 0,
    city: 'off',
    cut: true,
    follow: false,
    gloss: 'the Portal of Charity',
    id: 'portal',
    join: 'blend',
    kanji: 'Caritat',
    kicker: 'THE MIDDLE DOOR',
    mode: 'point',
    romaji: 'CHARITY',
    says: ['The cypress, the doves', 'The family under it'],
    ticks: 3,
    to: [2.4, 2.1, CRZ],
    toCam: {
      dolly: 3.8,
      fx: 2.35,
      fz: CRZ,
      lookY: -4.6,
      ox: 0.08,
      pitch: 5,
      yaw: 96,
    },
    wx: 0,
  },
  {
    build: [tAt(1912), tAt(1925.9)],
    buildBy: 0.6,
    follow: 'barnabas',
    cam: {
      dolly: 4.5,
      fx: 2.05,
      fz: -2.0,
      lookY: 0.9,
      ox: -0.1,
      pitch: 6,
      yaw: 62,
    },
    ch: 0,
    city: 'off',
    cut: true,
    gloss: 'Saint Barnabas, 1925',
    hold: true,
    id: 'barnabas',
    kanji: 'Bernabé',
    kicker: 'THE ONLY ONE HE SAW',
    mode: 'point',
    romaji: 'BARNABAS',
    says: ['One tower finished', 'Ninety-eight metres', 'November 1925'],
    ticks: 6,
    to: [NAT_X, 7.9, CRZ - 1.05],
    trace: [{ pts: NAT_TOWERS }],
    toCam: {
      dolly: 4.2,
      fx: 2.05,
      fz: -2.0,
      lookY: 1.0,
      ox: -0.1,
      pitch: 9,
      yaw: 74,
    },
    vo: 'One tower finished. Ninety-eight metres, November nineteen twenty-five. The only one Gaudí ever saw complete.',
    wx: 1,
  },
  {
    build: tAt(1926),
    cam: {
      dolly: 0.55,
      fx: 0,
      fz: 0,
      lookY: -1.6,
      ox: 0.16,
      pitch: 11,
      yaw: 70,
    },
    bob: 0.9,
    ch: 0,
    city: 'glass',
    cut: true,
    follow: false,
    id: 'barnabas-wide',
    mode: 'clear',
    ticks: 3,
    toCam: {
      dolly: 0.48,
      fx: 0,
      fz: 0,
      lookY: -1.0,
      ox: 0.16,
      pitch: 17,
      yaw: 98,
    },
    wx: 1,
  },

  /* ---------------------------------------------------------------- *
   * 02 — SILENCE: a death, a war, twenty years of plaster
   * ---------------------------------------------------------------- */
  {
    build: tAt(1926.5),
    cam: {
      dolly: 0.9,
      fx: 1.5,
      fz: -1.5,
      lookY: -3.4,
      ox: 0.14,
      pitch: 7,
      yaw: 122,
    },
    ch: 1,
    city: 'glass',
    dipTo: '#0d0905',
    gloss: '10 June 1926',
    id: 'gaudi',
    join: 'dip',
    kanji: 'Gaudí',
    kicker: 'THE ARCHITECT DIES',
    lead: 2,
    mode: 'plate',
    rim: 0.9,
    romaji: 'ANTONI GAUDÍ',
    says: [
      'A tram on the Gran Via',
      'Nobody recognises him',
      'Buried in his own crypt',
    ],
    sun: { az: -100, el: 14 },
    theme: 2,
    ticks: 6,
    toCam: {
      dolly: 0.86,
      fx: 1.5,
      fz: -1.5,
      lookY: -3.0,
      ox: 0.14,
      pitch: 9,
      yaw: 134,
    },
    vo: 'June nineteen twenty-six. A tram on the Gran Via. Nobody recognises him. Three days later he is buried in his own crypt.',
    wx: 2,
  },
  {
    build: [tAt(1936.5), tAt(1939.2)],
    cam: {
      dolly: 1.1,
      fx: 0,
      fz: APSE_Z,
      lookY: -4.0,
      ox: -0.1,
      pitch: 6,
      yaw: 152,
    },
    ch: 1,
    city: 'off',
    cut: true,
    /* dipping to black rather than flashing white: the white pop needed a
       still read back out of the canvas, and against a night fire a dip is
       the better join anyway — the frame goes dark and comes back burning */
    dipTo: '#080604',
    gloss: 'the night of 20 July 1936',
    id: 'war',
    join: 'dip',
    kanji: 'Guerra',
    kicker: 'THE CRYPT BURNS',
    /* the storm is already over the city when it starts */
    lightning: 1.4,
    mode: 'lower',
    rim: 1.2,
    romaji: 'CIVIL WAR',
    says: [
      'The workshop is torched',
      'Plans and photographs burn',
      'The plaster models are smashed',
    ],
    /* A FIRE IS A NIGHT SUBJECT. Burning stone at four in the afternoon
       is an orange smudge on a lit building; the same fire against a
       night sky is the only light in the frame, which is what it was. */
    theme: 3,
    ticks: 6,
    toCam: {
      dolly: 1.0,
      fx: 0,
      fz: APSE_Z,
      lookY: -3.4,
      ox: -0.1,
      pitch: 8,
      yaw: 166,
    },
    vo: 'July nineteen thirty-six. The workshop is torched. The plans burn, the photographs burn, and the plaster models are smashed to pieces.',
    wx: 4,
  },
  {
    /* THE MORNING AFTER. The llevantada blew itself out over the fire and
       the film does not say so — it shows the same wall in the first grey
       light with nothing coming off it. No line: the previous beat said
       everything, and a silence here is the twelve years that follow. */
    build: tAt(1938.4),
    cam: {
      dolly: 0.9,
      fx: 0,
      fz: APSE_Z,
      lookY: -3.2,
      ox: -0.06,
      pitch: 6,
      yaw: 158,
    },
    ch: 1,
    city: 'off',
    cut: true,
    gloss: 'the morning after',
    haze: 0.5,
    id: 'ashes',
    join: 'dip',
    kanji: 'Cendra',
    kicker: 'WHAT THE FIRE LEFT',
    look: 'silver',
    mode: 'lower',
    romaji: 'ASHES',
    says: ['The rain put it out', 'Nothing rises for twelve years'],
    theme: 0,
    ticks: 4,
    toCam: {
      dolly: 0.72,
      fx: 0,
      fz: APSE_Z,
      lookY: -2.6,
      ox: 0.04,
      pitch: 11,
      yaw: 146,
    },
    /* the storm is going out to sea */
    wx: 3,
  },
  {
    build: [tAt(1940), tAt(1952)],
    cam: {
      dolly: 0.7,
      fx: 0.6,
      fz: -0.6,
      lookY: -2.6,
      ox: 0.18,
      pitch: 14,
      yaw: 40,
    },
    ch: 1,
    city: 'glass',
    gloss: '1940–1952',
    id: 'models',
    kanji: 'Models',
    kicker: 'PIECED BACK TOGETHER',
    lead: 2,
    mode: 'plate',
    romaji: 'THE PLASTER MODELS',
    says: [
      'From the fragments',
      'From published photographs',
      'The plan survives the man',
    ],
    theme: 1,
    ticks: 5,
    toCam: {
      dolly: 0.74,
      fx: 0.6,
      fz: -0.6,
      lookY: -2.2,
      ox: 0.18,
      pitch: 14,
      yaw: 52,
    },
    vo: 'For twelve years nothing rises. The models are pieced back together from fragments and photographs. The plan survives the man.',
    wx: 3,
  },

  /* ---------------------------------------------------------------- *
   * 03 — THE LONG BUILD: concrete, cranes, and a consecration
   * ---------------------------------------------------------------- */
  {
    build: [tAt(1954), tAt(1976)],
    cam: {
      dolly: 1.0,
      fx: -NAT_X,
      fz: CRZ,
      lookY: -3.6,
      ox: -0.14,
      pitch: 5,
      yaw: -96,
    },
    ch: 2,
    city: 'off',
    gloss: 'the Passion front, 1954–1976',
    id: 'passion',
    kanji: 'Passió',
    kicker: 'THE OTHER FRONT',
    lead: 2,
    mode: 'lower',
    romaji: 'PASSION',
    says: [
      'Concrete, and the first crane',
      'Columns like bones',
      'Four more towers by 1976',
    ],
    sun: { az: -120, el: 22 },
    theme: 1,
    /* NO STAMP HERE. The enormous 1954 stood exactly where the first
       crane does, and this is the shot whose whole line is the crane —
       the year was covering the thing it was dating. */
    ticks: 6,
    toCam: {
      dolly: 0.95,
      fx: -NAT_X,
      fz: CRZ,
      lookY: -2.2,
      ox: -0.14,
      pitch: 7,
      yaw: -82,
    },
    vo: 'Nineteen fifty-four. Concrete, and the first tower crane. The Passion front, bare as bone, and four more towers by seventy-six.',
    wx: 0,
  },
  {
    build: tAt(1978),
    cam: {
      dolly: 4.0,
      fx: -2.35,
      fz: CRZ,
      lookY: -5.2,
      ox: -0.08,
      pitch: 3,
      yaw: -88,
    },
    ch: 2,
    city: 'off',
    cut: true,
    follow: false,
    gloss: 'the Passion portico',
    id: 'portico',
    join: 'blend',
    kanji: 'Ossos',
    kicker: 'COLUMNS LIKE BONES',
    mode: 'point',
    romaji: 'THE BONES',
    says: ['Six columns, leaning', 'Tendons for capitals'],
    ticks: 3,
    to: [-2.5, 1.4, CRZ],
    toCam: {
      dolly: 3.6,
      fx: -2.35,
      fz: CRZ,
      lookY: -4.8,
      ox: -0.08,
      pitch: 5,
      yaw: -96,
    },
    wx: 0,
  },
  {
    build: [tAt(1978), tAt(2010)],
    cam: {
      dolly: 0.85,
      fx: 0,
      fz: 1.4,
      lookY: -3.2,
      ox: 0.14,
      pitch: 10,
      yaw: 24,
    },
    ch: 2,
    city: 'glass',
    gloss: 'the naves, 1978–2010',
    hold: true,
    id: 'naves',
    kanji: 'Naus',
    kicker: 'A FOREST OF COLUMNS',
    mode: 'lower',
    romaji: 'THE NAVES',
    says: [
      'Side naves, then the crossing',
      'Vaults at forty-five metres',
      'Consecrated, November 2010',
    ],
    theme: 0,
    ticks: 6,
    toCam: {
      dolly: 0.8,
      fx: 0,
      fz: 1.0,
      lookY: -2.4,
      ox: 0.14,
      pitch: 11,
      yaw: 46,
    },
    vo: 'Thirty years for the naves. Side naves, then the crossing, vaults at forty-five metres. Consecrated in November twenty-ten.',
    wx: 1,
  },
  {
    build: T_TODAY,
    cam: {
      dolly: 3.6,
      fx: 1.85,
      fz: 1.6,
      lookY: -3.3,
      ox: 0,
      pitch: 6,
      yaw: 60,
    },
    ch: 2,
    city: 'glass',
    cut: true,
    gloss: 'the baskets on the gables',
    id: 'fruit',
    join: 'blend',
    kanji: 'Fruita',
    kicker: 'THE HARVEST ON THE ROOF',
    mode: 'point',
    romaji: 'THE FRUIT',
    says: [
      'Spring fruit on the Nativity side',
      'Autumn fruit on the Passion side',
      'Bread and wine on the nave',
    ],
    theme: 1,
    ticks: 7,
    to: [1.85, 3.3, 1.6],
    toCam: {
      dolly: 3.1,
      fx: 1.85,
      fz: 1.6,
      lookY: -3.1,
      ox: -0.08,
      pitch: 8,
      yaw: 70,
    },
    vo: 'The gables are crowned with baskets of fruit. Spring and summer on the Nativity side, autumn and winter on the Passion side, and bread and wine over the nave.',
    wx: 0,
  },
  {
    build: T_TODAY,
    cam: {
      dolly: 0.55,
      fx: 0,
      fz: 0,
      lookY: -1.6,
      ox: 0.16,
      pitch: 11,
      yaw: 30,
    },
    bob: 0.9,
    ch: 2,
    city: 'glass',
    cut: true,
    follow: false,
    id: 'fruit-wide',
    mode: 'clear',
    ticks: 3,
    toCam: {
      dolly: 0.48,
      fx: 0,
      fz: 0,
      lookY: -1.0,
      ox: 0.16,
      pitch: 17,
      yaw: 62,
    },
    wx: 0,
  },

  /* ---------------------------------------------------------------- *
   * 04 — THE TOWERS: the central six, and a hundred years to the day
   * ---------------------------------------------------------------- */
  {
    build: [tAt(2016), tAt(2021.96)],
    buildBy: 0.6,
    follow: 'mary',
    cam: {
      dolly: 4.2,
      fx: 0,
      fz: APSE_Z,
      lookY: 3.6,
      ox: -0.12,
      pitch: 8,
      yaw: 150,
    },
    ch: 3,
    city: 'glass',
    gloss: 'the tower of Mary, 2016–2021',
    id: 'mary',
    kanji: 'Maria',
    kicker: 'THE SECOND TALLEST',
    lead: 2,
    mode: 'point',
    rim: 1.1,
    romaji: 'THE VIRGIN MARY',
    says: ['138 metres', 'A twelve-pointed star', 'Lit on 8 December 2021'],
    theme: 1,
    ticks: 8,
    to: [0, 10.9, APSE_Z],
    trace: [{ pts: MARY_STAR }],
    toCam: {
      dolly: 4.0,
      fx: 0,
      fz: APSE_Z,
      lookY: 4.0,
      ox: -0.12,
      pitch: 12,
      yaw: 166,
    },
    vo: 'The tower of the Virgin Mary. A hundred and thirty-eight metres, a twelve-pointed star, lit for the first time on the eighth of December, twenty twenty-one.',
    wx: 0,
  },
  {
    build: tAt(2022),
    cam: {
      dolly: 0.55,
      fx: 0,
      fz: 0,
      lookY: -1.6,
      ox: 0.16,
      pitch: 9,
      yaw: 150,
    },
    bob: 0.9,
    ch: 3,
    city: 'glass',
    cut: true,
    follow: false,
    id: 'mary-wide',
    mode: 'clear',
    theme: 0,
    ticks: 3,
    toCam: {
      dolly: 0.48,
      fx: 0,
      fz: 0,
      lookY: -1.0,
      ox: 0.16,
      pitch: 14,
      yaw: 186,
    },
    wx: 0,
  },
  {
    build: [tAt(2016), tAt(2023.9)],
    buildBy: 0.8,
    follow: 'evang2',
    cam: {
      dolly: 1.4,
      fx: 0,
      fz: CRZ,
      lookY: 3.6,
      ox: 0.12,
      pitch: 9,
      yaw: 300,
    },
    ch: 3,
    city: 'glass',
    cut: true,
    gloss: 'the Evangelists, 2022–2023',
    id: 'evangelists',
    join: 'blend',
    kanji: 'Evangelistes',
    kicker: 'FOUR, ROUND THE CENTRE',
    mode: 'lower',
    romaji: 'THE EVANGELISTS',
    says: [
      'Luke and Mark, 2022',
      'Matthew and John, 2023',
      'Each crowned with its figure',
    ],
    theme: 0,
    ticks: 6,
    toCam: {
      dolly: 1.3,
      fx: 0,
      fz: CRZ,
      lookY: 4.2,
      ox: 0.12,
      pitch: 11,
      yaw: 322,
    },
    vo: 'Four towers round the centre. Luke and Mark in twenty twenty-two, Matthew and John the year after, each crowned with its own figure.',
    wx: 0,
  },
  {
    build: tAt(2024.5),
    cam: {
      dolly: 1.5,
      fx: -1.2,
      fz: CRZ + 2.6,
      lookY: 5.8,
      ox: 0.12,
      pitch: 4,
      yaw: -20,
    },
    ch: 3,
    city: 'glass',
    cut: true,
    gloss: 'the crane crew, 200 metres up',
    /**
     * A CLIP, as an example of the model: three seconds in, the picture
     * is read back and stands as an inset for eight seconds while the
     * live shot goes on underneath — a freeze frame in the editor's
     * sense. A video is the same field with `kind: 'video'`, a `src`
     * under public/sagrada/, and `in`/`out` on the source.
     */
    clips: [
      {
        at: 3,
        caption: 'FREEZE FRAME · 200 M',
        credit: 'the picture, read back and held',
        fit: 'inset',
        for: 8,
        kind: 'freeze',
      },
    ],
    id: 'gruistes',
    join: 'whip',
    kanji: 'Gruistes',
    kicker: 'THE PEOPLE AT THE TOP',
    mode: 'lower',
    romaji: 'THE CRANE DRIVERS',
    says: [
      'The tallest crane in Spain',
      '330 tonnes, with a black box',
      'Three men, every day',
    ],
    theme: 0,
    ticks: 6,
    toCam: {
      dolly: 1.4,
      fx: -1.2,
      fz: CRZ + 2.6,
      lookY: 6.6,
      ox: 0.12,
      pitch: 6,
      yaw: -8,
    },
    vo: 'Two hundred metres up, the tallest crane in Spain, three hundred and thirty tonnes with a black box. Three men drive it, every day.',
    wx: 1,
  },
  {
    build: [tAt(2016), tAt(2026.14)],
    buildBy: 0.6,
    follow: 'jesus',
    cam: {
      dolly: 4.4,
      fx: 0,
      fz: CRZ,
      lookY: 6.8,
      ox: -0.1,
      pitch: 10,
      yaw: 36,
    },
    ch: 3,
    city: 'glass',
    cut: true,
    gloss: 'the tower of Jesus, 2016–2026',
    hold: true,
    id: 'jesus',
    join: 'blend',
    kanji: 'Jesucrist',
    kicker: 'THE TALLEST CHURCH ON EARTH',
    mode: 'point',
    romaji: 'JESUS CHRIST',
    says: [
      '172.5 metres',
      '17 m of white ceramic and glass',
      'Lit from the towers round it',
    ],
    theme: 1,
    ticks: 10,
    to: [0, 13.4, CRZ],
    trace: [{ pts: JESUS_CROSS, wide: true }],
    toCam: {
      dolly: 4.2,
      fx: 0,
      fz: CRZ,
      lookY: 6.8,
      ox: -0.1,
      pitch: 12,
      yaw: 54,
    },
    vo: 'And the tower of Jesus Christ. A hundred and seventy-two and a half metres, the tallest church on earth, its cross seventeen metres of white glazed ceramic and glass, lit at night from the towers round it.',
    wx: 0,
  },
  {
    build: tAt(2026.2),
    cam: {
      dolly: 0.55,
      fx: 0,
      fz: 0,
      lookY: -1.6,
      ox: 0.16,
      pitch: 11,
      yaw: 20,
    },
    bob: 0.9,
    ch: 3,
    city: 'glass',
    cut: true,
    follow: false,
    id: 'jesus-wide',
    look: 'vivid',
    mode: 'clear',
    ticks: 3,
    toCam: {
      dolly: 0.48,
      fx: 0,
      fz: 0,
      lookY: -1.0,
      ox: 0.16,
      pitch: 17,
      yaw: 52,
    },
    wx: 0,
  },
  {
    build: tAt(2026.2),
    /* the aim starts at the doors — eye level for someone on the
       pavement — and ends on the finial; `lift` keeps the two apart */
    cam: { dolly: 1, fx: 0, fz: CRZ, lookY: -4.9, ox: 0, pitch: 8, yaw: 96 },
    ch: 3,
    city: 'off',
    cut: true,
    /* sixteen metres of pavement in the first three seconds: a walking
       pace at this scale, not a dolly */
    eye: { at: [6.0, 0.16, 0.6], fov: 96, to: [4.8, 0.16, -0.2] },
    follow: false,
    gloss: 'up the street, then the head goes back',
    id: 'tourist',
    kanji: 'Amunt',
    kicker: 'LOOK UP',
    lift: 0.55,
    mode: 'point',
    romaji: 'UP',
    says: ['A hundred and seventy-two metres', 'From the pavement'],
    ticks: 6,
    toCam: { dolly: 1, fx: 0, fz: CRZ, lookY: 7.4, ox: 0, pitch: 8, yaw: 96 },
    wx: 0,
  },
  {
    bob: 1.0,
    build: tAt(2026.3),
    cam: {
      dolly: 0.46,
      fx: 0,
      fz: 0,
      lookY: -0.6,
      ox: 0.1,
      pitch: 16,
      yaw: 20,
    },
    ch: 3,
    city: 'glass',
    cut: true,
    follow: false,
    gloss: 'the whole of it, at the hour it was built for',
    id: 'aerial',
    join: 'blend',
    kanji: 'Temple',
    kicker: 'THE WHOLE OF IT',
    look: 'vivid',
    mode: 'lower',
    quality: 2,
    romaji: 'THE TEMPLE',
    says: [
      'Eighteen towers planned',
      'Thirteen standing',
      'One hundred and forty-four years',
    ],
    theme: 2,
    ticks: 8,
    toCam: {
      dolly: 0.42,
      fx: 0,
      fz: 0,
      lookY: -0.2,
      ox: 0.1,
      pitch: 24,
      yaw: 112,
    },
    wx: 0,
  },
  {
    build: tAt(2026.6),
    cam: {
      dolly: 0.7,
      fx: 0,
      fz: CRZ,
      lookY: 0.4,
      ox: 0.14,
      pitch: 9,
      yaw: 60,
    },
    ch: 3,
    city: 'glass',
    cut: true,
    dipTo: '#0d0905',
    gloss: '10 June 2026',
    id: 'centenary',
    join: 'dip',
    kanji: 'Centenari',
    kicker: 'A HUNDRED YEARS TO THE DAY',
    look: 'floodlit',
    mode: 'plate',
    rim: 1.2,
    romaji: 'THE CENTENARY',
    says: [
      'Leo XIV says the mass',
      'The cross is lit',
      'Gaudí, a hundred years dead',
    ],
    theme: 3,
    ticks: 6,
    toCam: {
      dolly: 0.74,
      fx: 0,
      fz: CRZ,
      lookY: 1.0,
      ox: 0.14,
      pitch: 11,
      yaw: 76,
    },
    vo: 'The tenth of June, twenty twenty-six. A hundred years to the day. The pope says the mass, and the cross is lit.',
    wx: 0,
  },
  {
    build: tAt(2026.6),
    cam: { dolly: 1, fx: 0, fz: CRZ, lookY: -4.6, ox: 0, pitch: 8, yaw: -100 },
    ch: 3,
    city: 'off',
    cut: true,
    eye: { at: [-5.6, 0.14, 0.9], fov: 92, to: [-4.4, 0.14, 0.2] },
    follow: false,
    gloss: 'the street, that night',
    id: 'street',
    lift: 0.55,
    look: 'floodlit',
    mode: 'clear',
    rim: 1.2,
    theme: 3,
    ticks: 5,
    toCam: { dolly: 1, fx: 0, fz: CRZ, lookY: 7.6, ox: 0, pitch: 8, yaw: -100 },
    wx: 0,
  },
  {
    bob: 1.0,
    build: tAt(2026.6),
    cam: {
      dolly: 0.5,
      fx: 0,
      fz: 0,
      lookY: -0.8,
      ox: 0.1,
      pitch: 14,
      yaw: -100,
    },
    ch: 3,
    city: 'glass',
    cut: true,
    follow: false,
    gloss: 'the night it was lit',
    id: 'aerial-night',
    join: 'blend',
    look: 'floodlit',
    mode: 'clear',
    quality: 2,
    rim: 1.2,
    theme: 3,
    ticks: 5,
    toCam: {
      dolly: 0.46,
      fx: 0,
      fz: 0,
      lookY: -0.4,
      ox: 0.1,
      pitch: 21,
      yaw: -22,
    },
    wx: 0,
  },

  /* ---------------------------------------------------------------- *
   * 05 — THE PLAN: what the record does not yet contain
   * ---------------------------------------------------------------- */
  {
    build: [tAt(2026.8), tAt(2034.6)],
    cam: {
      dolly: 0.85,
      fx: 0,
      fz: 3.2,
      lookY: -1.6,
      ox: -0.12,
      pitch: 8,
      yaw: -18,
    },
    ch: 4,
    city: 'glass',
    gloss: 'the Glory front, projected',
    id: 'plan',
    kanji: 'Glòria',
    kicker: 'WHAT FOLLOWS IS THE PLAN',
    lead: 2,
    mode: 'lower',
    romaji: 'GLORY',
    says: [
      'A forest of lanterns',
      'Four more towers',
      'A stair over the street',
    ],
    theme: 0,
    ticks: 6,
    toCam: {
      dolly: 0.9,
      fx: 0,
      fz: 3.2,
      lookY: -0.4,
      ox: -0.12,
      pitch: 10,
      yaw: 6,
    },
    vo: 'What follows is the plan. The Glory front: a forest of lanterns, four more towers, and a stair over the street below.',
    wx: 1,
  },
  {
    build: tAt(2036),
    cam: {
      dolly: 0.5,
      fx: 0,
      fz: 0,
      lookY: -1.6,
      ox: 0.2,
      pitch: 10,
      yaw: 165,
    },
    ch: 4,
    city: 'glass',
    cut: true,
    gloss: 'Antoni Gaudí',
    id: 'coda',
    join: 'blend',
    kanji: 'Obra',
    look: 'floodlit',
    mode: 'title',
    rim: 1.1,
    romaji: 'THE WORKS',
    says: ['“My client is not in a hurry.”'],
    sun: { az: -100, el: 12 },
    theme: 3,
    ticks: 6,
    toCam: {
      dolly: 0.48,
      fx: 0,
      fz: 0,
      lookY: -1.4,
      ox: 0.2,
      pitch: 13,
      yaw: 178,
    },
    wx: 0,
  },
];

/** the film's clock, as the construct reads it: years both ways */
export const CLOCK: FilmClock = { span: [YEAR_A, YEAR_B], tAt, yearAt };

/** what the picture is told once, before the door: the building as it
 *  stands, no wireframe of the plan, the city as frosted glass */
export const seat = (film: Picture) => {
  film.plan?.('off');
  film.city?.('glass');
};
