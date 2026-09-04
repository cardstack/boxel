/**
 * `glimmer-motion/film` — the film construct: a headless cutting room in
 * which a 3D scene takes the place of the video track. See
 * notes/film-construct.md for the two reference films it was lifted from.
 */
export { Clip } from './clip.gts';
export {
  type ClipEnd,
  type ClipKind,
  clipLanes,
  type ClipSpec,
  type ClipState,
  clipWindow,
  resolveClip,
  resolveClips,
  type ResolvedClip,
} from './clips.ts';
export { Film, type FilmContext, type FilmSignature, TICK } from './film.gts';
export {
  Adjustment,
  Build,
  Filter,
  IFRAME_PICTURE,
  Light,
  Look,
  Mix,
  Set,
  SOUND,
  Sun,
  Weather,
  Winter,
} from './graph/adjust.gts';
export {
  type AttachNode,
  type CompiledGraph,
  compileGraph,
  type EyeNode,
  type GraphNode,
  type GroupNode,
  type JoinNode,
  type Patch,
  type PatchNode,
  type ShotNode,
  type ToNode,
  type VoiceNode,
} from './graph/compile.ts';
export {
  FilmGraph,
  type FilmGraphSignature,
  type FilmVocabulary,
  VOCABULARY,
} from './graph/host.gts';
export {
  collectGraph,
  Eye,
  Freeze,
  Attach as GraphAttach,
  Chapter as GraphChapter,
  Insert as GraphInsert,
  GraphNodeComponent,
  type GraphProvider,
  Stamp as GraphStamp,
  JoinInto,
  Lineup,
  Mark,
  PatchComponent,
  Sequence,
  Shot,
  Sky,
  Spine,
  To,
  Trace,
  Type,
  Video,
  Voice,
} from './graph/nodes.gts';
export {
  Blend,
  Blur,
  Dip,
  Flash,
  inGlass,
  Iris,
  JOIN_SECS,
  Joins,
  Luma,
  Melt,
  type Presentation,
  type PresentationComponent,
  PRESENTATIONS,
  type PresentationSignature,
  retire,
  seamShape,
  STILL_JOINS,
  Wipe,
} from './joins.gts';
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
export {
  IframePicture,
  type IframePictureSignature,
  type PictureSpec,
} from './picture.gts';
export { Plate } from './plate.gts';
export {
  Burst,
  Menu,
  type MenuEntry,
  type PlaybarSegment,
  Player,
} from './player.gts';
export { Rail, type RailMark } from './rail.gts';
export {
  beatStart,
  chapterHeads,
  type Content,
  contents,
  type Cue,
  cues,
  joinInto,
  type Schedule,
  schedule,
  secsBefore,
  tailFor,
  totalSecs,
  type Waypoint,
  waypoints,
} from './schedule.ts';
export { Seam } from './seam.ts';
export { EndCard, Gate } from './titles.gts';
export type {
  Beat,
  Cam,
  Chapter,
  FilmClock,
  FilmGrade,
  FilmHandle,
  Join,
  JoinName,
  LookFx,
  Over,
  Picture,
  PlateMode,
  Pt3,
  SeamSpec,
  ShotState,
} from './types.ts';
