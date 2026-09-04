/**
 * THE GRAPH'S NODES, as components.
 *
 * Each renders a hidden marker and puts itself in a WeakMap the host walks
 * in document order — the same discovery `<Choreo>` uses for its steps —
 * so a shot's children are the markers inside its marker, a chapter's
 * shots are the markers inside its, and the template's nesting IS the
 * tree. `node()` is pure and cheap: it reads args and returns plain data;
 * the host compiles the tree to the table (`compile.ts`).
 *
 * The vocabulary is what the six sketches in docs/film-graph settled on:
 * `Spine` / `Chapter` / `Sequence` (groups, with defaults), `Shot` (the
 * head pose as its own args), `To`, `Eye`, `Join` (a sibling before the
 * shot it cuts into), `Type`, `Voice`, `Stamp`, `Sky`, `Mark`, `Trace`,
 * `Lineup`, and `Attach` around `Insert` / `Freeze` / `Video`. Adjustments
 * — the picture's own knobs — are in `adjust.gts`.
 */
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import type { ClipLook, ClipSpec } from '../clips.ts';
import type { PresentationComponent } from '../joins.gts';
import type {
  Beat,
  Cam,
  Join,
  JoinName,
  Over,
  PlateMode,
  Pt3,
} from '../types.ts';
import type {
  AttachNode,
  EyeNode,
  GraphNode,
  GroupNode,
  JoinNode,
  LookNode,
  Patch,
  PatchNode,
  ShotNode,
  ToNode,
  VoiceNode,
} from './compile.ts';

export interface GraphProvider {
  node(): GraphNode;
}

const providers = new WeakMap<Element, GraphProvider>();

/** the host a marker belongs to: the nearest `[data-film-graph]` ancestor */
export interface GraphHost {
  invalidate(): void;
}
const hosts = new WeakMap<Element, GraphHost>();

export function setGraphHost(el: Element, host: GraphHost | undefined) {
  if (host) {
    hosts.set(el, host);
  } else {
    hosts.delete(el);
  }
}

/** the nodes directly inside an element, in document order, nesting by markup */
export function collectGraph(el: Element): GraphNode[] {
  const out: GraphNode[] = [];
  for (const child of Array.from(el.children)) {
    const provider = providers.get(child);
    if (provider) {
      const node = provider.node();
      if (node.kind === 'group' || node.kind === 'shot') {
        node.children = collectGraph(child);
        if (node.kind === 'group') {
          // attachments placed directly under a group are its patches,
          // in force for every shot in it; they are not items
          const items: GraphNode[] = [];
          for (const c of node.children) {
            if (c.kind === 'patch') {
              node.patches.push(c.patch);
            } else {
              items.push(c);
            }
          }
          node.children = items;
        }
      } else if (node.kind === 'attach') {
        const inner = collectGraph(child);
        const media = inner.find((n) => n.kind === 'attach')?.media;
        if (media) {
          node.media = media;
        }
        /* a look under a clip is the CLIP's, not the beat's — the first
           adjustment in this vocabulary that belongs to something other
           than the picture */
        const look = inner
          .filter((n): n is LookNode => n.kind === 'look')
          .reduce<ClipLook | undefined>(
            (all, n) => ({ ...all, ...n.look }),
            undefined,
          );
        if (look && node.media && node.media.kind !== 'photo') {
          node.media = { ...node.media, look };
        }
      }
      out.push(node);
    } else {
      out.push(...collectGraph(child));
    }
  }
  return out;
}

/** drop undefined members so a patch says only what it says */
function tidy<T extends object>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * A node component: a hidden marker in the tree, a provider in the map.
 * Groups and shots yield, so their children's markers nest under theirs.
 * The marker re-registers when its args change, and tells the host.
 */
export abstract class GraphNodeComponent<A extends object> extends Component<{
  Args: A;
  Blocks: { default: [] };
}> {
  abstract node(): GraphNode;

  protected mark = modifier((el: Element) => {
    providers.set(el, this);
    // reading node() here makes the modifier track everything it reads, so
    // an edited arg re-runs it — and the host learns the tree changed
    void this.node();
    const host = el.parentElement?.closest('[data-film-graph]');
    (host ? hosts.get(host) : undefined)?.invalidate();
    return () => {
      providers.delete(el);
      (host ? hosts.get(host) : undefined)?.invalidate();
    };
  });

  <template>
    <span hidden data-film-node {{this.mark}}>{{yield}}</span>
  </template>
}

/* ---- groups ---------------------------------------------------------- */

interface GroupArgs {
  /** the same hand for every shot in the group, unless the shot says otherwise */
  bob?: number;
  cut?: boolean;
  hold?: boolean | 'top';
  /** the seam every shot in the group is entered through, unless a join sibling says otherwise */
  join?: Join;
  lead?: number;
  name?: string;
  /** how deep those seams go: over the picture alone, or over the type and the inserts too */
  over?: Over;
}

function groupDefaults(args: GroupArgs): Patch {
  return tidy({
    bob: args.bob,
    cut: args.cut,
    hold: args.hold,
    lead: args.lead,
  });
}

/** the film's spine: a sequence of chapters and shots; `@join` is what a shot gets when nothing names one */
export class Spine extends GraphNodeComponent<GroupArgs> {
  node(): GroupNode {
    return {
      children: [],
      defaults: groupDefaults(this.args),
      join: this.args.join,
      kind: 'group',
      name: this.args.name,
      over: this.args.over,
      patches: [],
      role: 'spine',
    };
  }
}

/** a chapter: a named sequence the menu and the rail read; its grade and stock are the chapter's, not its shots' */
export class Chapter extends GraphNodeComponent<
  GroupArgs & {
    grade?: string;
    lut?: string;
    n: string;
    tint?: string;
    tintD?: string;
    title: string;
  }
> {
  node(): GroupNode {
    const { grade, lut, n, tint, tintD, title } = this.args;
    return {
      chapter: tidy({ grade, lut, n, tint, tintD, title }),
      children: [],
      defaults: groupDefaults(this.args),
      join: this.args.join,
      kind: 'group',
      name: this.args.name,
      over: this.args.over,
      patches: [],
      role: 'chapter',
    };
  }
}

/** a group of shots inside a chapter: `c.Sequence` wearing the film's defaults */
export class Sequence extends GraphNodeComponent<GroupArgs> {
  node(): GroupNode {
    return {
      children: [],
      defaults: groupDefaults(this.args),
      join: this.args.join,
      kind: 'group',
      name: this.args.name,
      over: this.args.over,
      patches: [],
      role: 'sequence',
    };
  }
}

/* ---- the shot -------------------------------------------------------- */

/** the pose the film speaks in, as flat arguments */
interface PoseArgs {
  dolly: number;
  fx?: number;
  fz?: number;
  lookY: number;
  ox?: number;
  pitch: number;
  yaw: number;
}

function cam(a: PoseArgs): Cam {
  return tidy({
    dolly: a.dolly,
    fx: a.fx,
    fz: a.fz,
    lookY: a.lookY,
    ox: a.ox,
    pitch: a.pitch,
    yaw: a.yaw,
  });
}

/** one shot: its head pose as its own args, its facts, and everything attached under it */
export class Shot extends GraphNodeComponent<
  PoseArgs & {
    bob?: number;
    cut?: boolean;
    dissolve?: boolean;
    follow?: false | string;
    hold?: boolean | 'top';
    lead?: number;
    lift?: number;
    name: string;
    quality?: number;
    ticks: number;
    /** a point on the subject this shot is naming — the callout's leader and ring */
    to?: Pt3;
  }
> {
  node(): ShotNode {
    const a = this.args;
    return {
      cam: cam(a),
      children: [],
      facts: tidy({
        bob: a.bob,
        cut: a.cut,
        dissolve: a.dissolve,
        follow: a.follow,
        hold: a.hold,
        lead: a.lead,
        lift: a.lift,
        quality: a.quality,
        to: a.to,
      }),
      id: a.name,
      kind: 'shot',
      ticks: a.ticks,
    };
  }
}

/** the pose at the shot's tail; without one the shot holds */
export class To extends GraphNodeComponent<PoseArgs> {
  node(): ToNode {
    return { cam: cam(this.args), kind: 'to' };
  }
}

/** a ground-level eye with a wide lens: standing at `@from`, walking to `@to` */
export class Eye extends GraphNodeComponent<{
  fov: number;
  from: Pt3;
  to?: Pt3;
}> {
  node(): EyeNode {
    return {
      eye: tidy({ at: this.args.from, fov: this.args.fov, to: this.args.to }),
      kind: 'eye',
    };
  }
}

/**
 * The seam INTO the shot that follows it: one of the film's twelve by
 * name, or a presentation component the score brings — given the still,
 * told how long it has (`@secs`), and known to the film by nothing else.
 */
export class JoinInto extends GraphNodeComponent<{
  /** how deep this seam goes: over the picture alone, or over the furniture too */
  over?: Over;
  presentation: JoinName | PresentationComponent;
  /** seconds a brought presentation holds the picture */
  secs?: number;
  to?: string;
}> {
  node(): JoinNode {
    const p = this.args.presentation;
    if (typeof p === 'string') {
      /* `@secs` counts for a NAMED seam too: it is how a seam the film
         does not know — one the picture declared — gets its length, and
         how a score retimes one of the film's own. Without it a
         picture-declared seam compiled to a length of zero and ended on
         the frame it began. */
      return {
        dipTo: this.args.to,
        join: p,
        kind: 'join',
        over: this.args.over,
        secs: this.args.secs,
      };
    }
    return {
      dipTo: this.args.to,
      join: '',
      kind: 'join',
      over: this.args.over,
      presentation: p,
      secs: this.args.secs,
    };
  }
}

/* ---- the film's own attachments --------------------------------------- */

/** a patch node: an attachment that says what it adds to the row */
export abstract class PatchComponent<
  A extends object,
> extends GraphNodeComponent<A> {
  abstract patch(): Patch;
  node(): PatchNode {
    return { kind: 'patch', patch: tidy(this.patch()) };
  }
}

/** the type: the lower third, the title, the plate and the point */
export class Type extends PatchComponent<{
  bare?: boolean;
  gloss?: string;
  kicker?: string;
  mode?: PlateMode;
  reading?: string;
  says?: string[];
  word?: string;
}> {
  patch(): Patch {
    const a = this.args;
    return {
      bare: a.bare,
      gloss: a.gloss,
      kanji: a.word,
      kicker: a.kicker,
      mode: a.mode,
      romaji: a.reading,
      says: a.says,
    };
  }
}

/** the narration: the line, the measured read it was cut to, and the level it was mixed to */
export class Voice extends GraphNodeComponent<{
  gain?: number;
  hush?: boolean;
  line?: string;
  read?: number;
}> {
  node(): VoiceNode {
    const { gain, hush, line, read } = this.args;
    return tidy({ gain, hush, kind: 'voice', line, read }) as VoiceNode;
  }
}

/** the year the voice says, written enormous in the scene */
export class Stamp extends PatchComponent<{ at?: number; year: number }> {
  patch(): Patch {
    return { stamp: tidy({ at: this.args.at, y: this.args.year }) };
  }
}

/** type standing out in the world, behind the subject */
export class Sky extends PatchComponent<{
  az?: number;
  dist?: number;
  lines: string[];
  opacity?: number;
  size: number;
  track?: number;
  y: number;
}> {
  patch(): Patch {
    const a = this.args;
    return {
      sky: tidy({
        az: a.az,
        dist: a.dist,
        lines: a.lines,
        opacity: a.opacity,
        size: a.size,
        track: a.track,
        y: a.y,
      }),
    };
  }
}

/** a label that stands in the scene at the height it names */
export class Mark extends PatchComponent<{
  at?: number;
  bearing: number;
  hold?: number;
  lines: string[];
  r: number;
  size: number;
  to: number;
}> {
  patch(): Patch {
    const a = this.args;
    return {
      mark: tidy({
        at: a.at,
        bearing: a.bearing,
        hold: a.hold,
        lines: a.lines,
        r: a.r,
        size: a.size,
        to: a.to,
      }),
    };
  }
}

/** a line drawn ON the subject, in world coordinates; several add up */
export class Trace extends PatchComponent<{ pts: Pt3[]; wide?: boolean }> {
  patch(): Patch {
    return { trace: [tidy({ pts: this.args.pts, wide: this.args.wide })] };
  }
}

/** the lineup: cycle through subjects inside one held shot */
export class Lineup extends PatchComponent<{
  steps: NonNullable<Beat['cycle']>;
}> {
  patch(): Patch {
    return { cycle: this.args.steps };
  }
}

/* ---- windows over regions the film does not own ------------------------ */

/** a window on the shot's clock over a photograph, a freeze or a video */
export class Attach extends GraphNodeComponent<{
  at?: number;
  end?: ClipSpec['end'];
  for?: number;
  lane?: number;
}> {
  node(): AttachNode {
    return tidy({
      at: this.args.at,
      end: this.args.end,
      for: this.args.for,
      kind: 'attach',
    }) as AttachNode;
  }
}

/** a photograph cut in beside the model; `@src` resolves under the film's assets */
export class Insert extends GraphNodeComponent<{
  caption: string;
  credit: string;
  src: string;
}> {
  node(): AttachNode {
    const { caption, credit, src } = this.args;
    return { kind: 'attach', media: { caption, credit, kind: 'photo', src } };
  }
}

/** a freeze of the picture itself, read back and held */
export class Freeze extends GraphNodeComponent<{
  caption?: string;
  credit?: string;
  fit?: ClipSpec['fit'];
}> {
  node(): AttachNode {
    const { caption, credit, fit } = this.args;
    return {
      kind: 'attach',
      media: tidy({ caption, credit, fit, kind: 'freeze' as const }),
    };
  }
}

/**
 * A LOOK HELD ON A CLIP — `f.clip.Look`. The clip actor's own adjustment,
 * declared by the film because the film draws the clip layer, in the same
 * shape as `f.picture.Look`: a value held on an actor for the window it
 * is attached to, applying to everything under it.
 *
 * ```hbs
 * <f.Inset @src="b-roll.mp4" @x={{62}} @y={{14}} @w={{30}}>
 *   <f.clip.Look @sat={{0.15}} @con={{1.2}} @blur={{1}} />
 * </f.Inset>
 * ```
 */
export class ClipLookNode extends GraphNodeComponent<ClipLook> {
  node(): LookNode {
    const a = this.args;
    return {
      kind: 'look',
      look: tidy({
        blur: a.blur,
        bri: a.bri,
        con: a.con,
        gray: a.gray,
        hue: a.hue,
        opacity: a.opacity,
        sat: a.sat,
        sepia: a.sepia,
      }),
    };
  }
}

/**
 * A PICTURE IN THE PICTURE: a video or a still placed as a LAYER, sized
 * and positioned in percent of the frame, with its own fade in and out.
 * Not the editorial photograph (`Insert`), which is a paper card in a
 * fixed corner — this one is a layer the score places.
 */
export class Inset extends GraphNodeComponent<{
  at?: number;
  end?: ClipSpec['end'];
  fade?: number;
  for?: number;
  in?: number;
  out?: number;
  radius?: number;
  rate?: number;
  src: string;
  still?: boolean;
  volume?: number;
  w?: number;
  x?: number;
  y?: number;
}> {
  node(): AttachNode {
    const a = this.args;
    return {
      at: a.at,
      end: a.end,
      for: a.for,
      kind: 'attach',
      media: tidy({
        fade: a.fade,
        fit: 'pip' as const,
        in: a.in,
        kind: a.still ? ('image' as const) : ('video' as const),
        out: a.out,
        radius: a.radius,
        rate: a.rate,
        src: a.src,
        volume: a.volume,
        w: a.w,
        x: a.x,
        y: a.y,
      }),
    };
  }
}

/** a video or a still, over the frame for the window */
export class Video extends GraphNodeComponent<{
  caption?: string;
  credit?: string;
  fit?: ClipSpec['fit'];
  in?: number;
  out?: number;
  rate?: number;
  src: string;
  still?: boolean;
  volume?: number;
}> {
  node(): AttachNode {
    const a = this.args;
    return {
      kind: 'attach',
      media: tidy({
        caption: a.caption,
        credit: a.credit,
        fit: a.fit,
        in: a.in,
        kind: a.still ? ('image' as const) : ('video' as const),
        out: a.out,
        rate: a.rate,
        src: a.src,
        volume: a.volume,
      }),
    };
  }
}
