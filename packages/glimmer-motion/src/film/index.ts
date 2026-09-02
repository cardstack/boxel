/**
 * `glimmer-motion/film` — the film construct: a headless cutting room in
 * which a 3D scene takes the place of the video track. See
 * docs/film-construct.md for the two reference films it was lifted from.
 */
export { Clip } from './clip.gts';
export {
  type ClipEnd,
  type ClipKind,
  type ClipSpec,
  type ClipState,
  clipWindow,
  resolveClip,
  type ResolvedClip,
} from './clips.ts';
export { Film, type FilmSignature, TICK } from './film.gts';
export { JOIN_SECS, Joins, retire, STILL_JOINS } from './joins.gts';
export {
  clamp01,
  hex,
  lerp,
  luminance,
  mmss,
  RAD,
  rgba,
  smooth,
} from './math.ts';
export { Captions, Insert, Stamp, Track } from './overlays.gts';
export { Plate } from './plate.gts';
export {
  Burst,
  Menu,
  type MenuEntry,
  type PlaybarSegment,
  Player,
} from './player.gts';
export { Rail, type RailMark } from './rail.gts';
export { EndCard, Gate } from './titles.gts';
export type {
  Beat,
  Cam,
  Chapter,
  FilmClock,
  FilmGrade,
  FilmHandle,
  Join,
  LookFx,
  Picture,
  PlateMode,
  Pt3,
  ShotState,
} from './types.ts';
