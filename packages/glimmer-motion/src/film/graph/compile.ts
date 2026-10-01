/**
 * THE GRAPH, COMPILED TO THE TABLE.
 *
 * A film written as a graph — a spine of chapters and shots, a join as a
 * sibling between two shots, everything else attached under the shot it
 * belongs to — compiles to the same `Beat[]` and `Chapter[]` the engine
 * has always run. That is the whole claim of Phase 2, and it is what
 * makes the migration measurable: the graph a film writes and the table
 * it used to write produce the same rows, to the key
 * (`tests/integration/film/graph-test.gts`), and therefore the same
 * schedule (`tests/fixtures/film/*.json`).
 *
 * Pure: a tree of plain nodes in, rows out. The components in
 * `nodes.gts` build the tree from the template; nothing here knows Ember.
 */
import type { ClipLook, ClipSpec } from '../clips.ts';
import type { PresentationComponent } from '../joins.gts';
import type { Beat, Cam, Chapter, Join, JoinName, Over } from '../types.ts';

/** a patch on the row the shot compiles to: an attachment says what it adds */
export type Patch = Partial<Beat>;

export type GraphNode =
  | AttachNode
  | EyeNode
  | GroupNode
  | JoinNode
  | LookNode
  | PatchNode
  | ShotNode
  | ToNode
  | VoiceNode;

/** a spine, a chapter or a sequence: a run of items with defaults for its shots */
export interface GroupNode {
  /** a chapter's row in the chapter table; only a `chapter` group has one */
  chapter?: Chapter;
  children: GraphNode[];
  /** shot facts every shot in the group inherits unless it says otherwise (`@cut`, `@hold`, `@bob`) */
  defaults: Patch;
  /** the seam every shot in the group is entered through unless a join sibling says otherwise */
  join?: Join;
  kind: 'group';
  name?: string;
  /** how deep those seams go, unless a join sibling says otherwise */
  over?: Over;
  /** attachments placed directly under the group: in force for every shot in it */
  patches: Patch[];
  role: 'chapter' | 'sequence' | 'spine';
}

/** a sibling between two shots: the seam INTO the next one */
/** a look a clip holds: collected by its clip, never by the beat */
export interface LookNode {
  kind: 'look';
  look: ClipLook;
}

export interface JoinNode {
  dipTo?: string;
  join: JoinName;
  kind: 'join';
  /** how deep this seam goes: over the picture alone, or over the furniture too */
  over?: Over;
  /** a presentation the score brought: named for the film, registered with it */
  presentation?: PresentationComponent;
  /** seconds the seam holds the picture; a brought presentation says */
  secs?: number;
}

export interface ShotNode {
  /** the head pose */
  cam: Cam;
  children: GraphNode[];
  /** the shot's own facts: cut, lead, lift, bob, hold, follow, to, dissolve, quality */
  facts: Patch;
  id: string;
  kind: 'shot';
  ticks: number;
}

/** the tail pose */
export interface ToNode {
  cam: Cam;
  kind: 'to';
}

/** an eye-level walk */
export interface EyeNode {
  eye: NonNullable<Beat['eye']>;
  kind: 'eye';
}

/** an attachment that says what it adds to the row: type, air, a stamp, a trace */
export interface PatchNode {
  kind: 'patch';
  patch: Patch;
}

/** the narration: the line, and the measured read the film cuts to */
export interface VoiceNode {
  gain?: number;
  hush?: boolean;
  kind: 'voice';
  line?: string;
  read?: number;
}

/** a window over a region the film does not own: a photograph, a freeze, a video */
export interface AttachNode {
  at?: number;
  end?: ClipSpec['end'];
  for?: number;
  kind: 'attach';
  media?:
    | { caption: string; credit: string; kind: 'photo'; src: string }
    | {
        caption?: string;
        credit?: string;
        /** a pip's own fade, seconds */
        fade?: number;
        fit?: ClipSpec['fit'];
        in?: number;
        kind: 'freeze' | 'image' | 'video';
        look?: ClipLook;
        out?: number;
        /** a pip's corner radius, percent of its width */
        radius?: number;
        rate?: number;
        src?: string;
        volume?: number;
        /** a pip's width, percent of the frame */
        w?: number;
        /** a pip's left edge, percent of the frame */
        x?: number;
        /** a pip's top edge, percent of the frame */
        y?: number;
      };
}

export interface CompiledGraph {
  beats: Beat[];
  chapters: Chapter[];
  /** the spine's own seam: what a shot gets when nothing names one */
  defaultJoin?: Join;
  /** the spine's own depth: how deep a seam goes when nothing says */
  defaultOver?: Over;
  /** presentations the score brought, by the names its rows use */
  presentations: Record<
    string,
    { component?: PresentationComponent; over?: Over; secs: number }
  >;
  voGain: Record<string, number>;
  voSecs: Record<string, number>;
}

/** drop undefined members, so a row compares equal to one that never had the key */
function tidy<T extends object>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export function compileGraph(root: GroupNode): CompiledGraph {
  const beats: Beat[] = [];
  const chapters: Chapter[] = [];
  const voSecs: Record<string, number> = {};
  const voGain: Record<string, number> = {};
  const presentations: CompiledGraph['presentations'] = {};
  let ch = 0;

  const walk = (
    group: GroupNode,
    inherited: Patch[],
    joinDefault?: Join,
    overDefault?: Over,
  ) => {
    if (group.role === 'chapter' && group.chapter) {
      chapters.push(tidy(group.chapter));
      ch = chapters.length - 1;
    }
    const scope = [...inherited, group.defaults, ...group.patches];
    const seam =
      group.role === 'spine' ? undefined : (group.join ?? joinDefault);
    /* the spine's own `@over` is the film's default, the way its `@join`
       is: carried on the compiled graph and resolved by the film, never
       baked into the rows — so a table-fed film and a graph-fed one give
       the same table, and the fixtures stay honest. A chapter's or a
       sequence's `@over` IS baked, because it is not the default. */
    const deep =
      group.role === 'spine' ? undefined : (group.over ?? overDefault);
    let pending: JoinNode | undefined;
    for (const node of group.children) {
      if (node.kind === 'group') {
        walk(node, scope, seam, deep);
        pending = undefined;
      } else if (node.kind === 'join') {
        if (!node.presentation && node.secs !== undefined) {
          /* `<f.Join @presentation="ridged-burn" @secs={{0.8}} />` — a
             length for a seam the film does not know, which is how a
             picture-declared one gets its clock. It also lets a score
             retime one of the film's own. */
          presentations[node.join] = { secs: node.secs };
          pending = node;
        } else if (node.presentation) {
          // a brought presentation is named for the film by its place in
          // the score, so the row can carry a string like any other seam
          const name = `presentation:${Object.keys(presentations).length + 1}`;
          presentations[name] = {
            component: node.presentation,
            over: node.over,
            secs: node.secs ?? 1,
          };
          pending = { ...node, join: name };
        } else {
          pending = node;
        }
      } else if (node.kind === 'shot') {
        beats.push(row(node, scope, pending ?? seam, deep, ch, voSecs, voGain));
        pending = undefined;
      }
    }
  };
  walk(root, []);
  return {
    beats,
    chapters,
    defaultJoin: root.join,
    defaultOver: root.over,
    presentations,
    voGain,
    voSecs,
  };
}

function row(
  shot: ShotNode,
  scope: Patch[],
  seam: JoinNode | Join | undefined,
  deep: Over | undefined,
  ch: number,
  voSecs: Record<string, number>,
  voGain: Record<string, number>,
): Beat {
  let beat: Beat = {
    cam: shot.cam,
    ch,
    id: shot.id,
    mode: 'clear',
    ticks: shot.ticks,
  };
  const merge = (p: Patch) => {
    beat = { ...beat, ...tidy(p) };
  };
  for (const p of scope) {
    merge(p);
  }
  merge(shot.facts);
  if (seam) {
    if (typeof seam === 'string') {
      merge({ join: seam, over: deep });
    } else {
      merge({
        dipTo: seam.dipTo,
        join: seam.join,
        over: seam.over ?? deep,
      });
    }
  }
  const traces: NonNullable<Beat['trace']> = [];
  const clips: NonNullable<Beat['clips']> = [];
  for (const node of shot.children) {
    switch (node.kind) {
      case 'patch':
        if (node.patch.trace) {
          traces.push(...node.patch.trace);
          const { trace: _trace, ...rest } = node.patch;
          merge(rest);
        } else {
          merge(node.patch);
        }
        break;
      case 'to':
        merge({ toCam: node.cam });
        break;
      case 'eye':
        merge({ eye: node.eye });
        break;
      case 'voice':
        merge({ hush: node.hush, vo: node.line });
        if (node.read !== undefined) {
          voSecs[shot.id] = node.read;
        }
        if (node.gain !== undefined) {
          voGain[shot.id] = node.gain;
        }
        break;
      case 'attach':
        if (node.media?.kind === 'photo') {
          const { kind: _kind, ...photo } = node.media;
          merge({ photo });
        } else if (node.media) {
          const { kind, ...rest } = node.media;
          /* ACCUMULATED, not merged. A beat used to carry one clip, so a
             second attachment on the same shot overwrote the first
             silently; they are lanes now, and a clip that names none takes
             its own position among them. */
          clips.push(
            tidy({
              ...rest,
              at: node.at,
              end: node.end,
              for: node.for,
              kind,
            }),
          );
        }
        break;
      default:
        break;
    }
  }
  if (clips.length) {
    merge({ clips });
  }
  if (traces.length) {
    merge({ trace: traces });
  }
  return tidy(beat);
}
