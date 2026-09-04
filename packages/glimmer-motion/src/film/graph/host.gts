/**
 * THE GRAPH'S HOST. Yields the vocabulary (`f.Spine`, `f.Shot`, …), walks
 * its markers after each render, compiles the tree to the table, and hands
 * the rows up. `<Film>` wraps its default block in one of these; a test can
 * render one bare and read what a template compiles to.
 *
 * Collection is scheduled, never done in the render pass: a marker's
 * modifier calls `invalidate()` during render, and a tracked write there
 * would be a backtracking re-render. One frame later the tree is walked
 * once, however many markers moved.
 */
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import { IFRAME_PICTURE, SOUND } from './adjust.gts';
import { type CompiledGraph, compileGraph, type GroupNode } from './compile.ts';
import {
  Attach,
  Chapter,
  collectGraph,
  Eye,
  Freeze,
  type GraphHost,
  Insert,
  Inset,
  JoinInto,
  Lineup,
  Mark,
  Sequence,
  setGraphHost,
  Shot,
  Sky,
  Spine,
  Stamp,
  To,
  Trace,
  Type,
  Video,
  Voice,
} from './nodes.gts';

/** what `<Film as |f|>` and `<FilmGraph as |f|>` yield: the vocabulary */
export interface FilmVocabulary {
  Attach: typeof Attach;
  Chapter: typeof Chapter;
  Eye: typeof Eye;
  Freeze: typeof Freeze;
  Insert: typeof Insert;
  Inset: typeof Inset;
  Join: typeof JoinInto;
  Lineup: typeof Lineup;
  Mark: typeof Mark;
  Sequence: typeof Sequence;
  Shot: typeof Shot;
  Sky: typeof Sky;
  Spine: typeof Spine;
  Stamp: typeof Stamp;
  To: typeof To;
  Trace: typeof Trace;
  Type: typeof Type;
  Video: typeof Video;
  Voice: typeof Voice;
  /** the picture's adjustments, as the picture declares them */
  picture: typeof IFRAME_PICTURE;
  /** the sound actor's */
  sound: typeof SOUND;
}

export const VOCABULARY: FilmVocabulary = {
  Attach,
  Chapter,
  Eye,
  Freeze,
  Insert,
  Inset,
  Join: JoinInto,
  Lineup,
  Mark,
  Sequence,
  Shot,
  Sky,
  Spine,
  Stamp,
  To,
  Trace,
  Type,
  Video,
  Voice,
  picture: IFRAME_PICTURE,
  sound: SOUND,
};

export interface FilmGraphSignature {
  Args: {
    /** the compiled table, a frame after the markers settle; null when the block holds no spine */
    onCompile: (compiled: CompiledGraph | null) => void;
  };
  Blocks: { default: [FilmVocabulary] };
}

export class FilmGraph
  extends Component<FilmGraphSignature>
  implements GraphHost
{
  private element?: Element;
  private pending = 0;

  invalidate() {
    if (this.pending || !this.element) {
      return;
    }
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.args.onCompile(this.compile());
    });
  }

  /** the tree under the host, compiled; null without a spine */
  compile(): CompiledGraph | null {
    if (!this.element) {
      return null;
    }
    const spine = collectGraph(this.element).find(
      (n): n is GroupNode => n.kind === 'group' && n.role === 'spine',
    );
    return spine ? compileGraph(spine) : null;
  }

  host = modifier((el: Element) => {
    this.element = el;
    setGraphHost(el, this);
    this.invalidate();
    return () => {
      if (this.pending) {
        cancelAnimationFrame(this.pending);
        this.pending = 0;
      }
      setGraphHost(el, undefined);
      this.element = undefined;
    };
  });

  <template>
    {{! contents, not a box: the film page lays out what the block
        renders, and the host must not stand between them }}
    <div data-film-graph style='display:contents' {{this.host}}>
      {{yield VOCABULARY}}
    </div>
  </template>
}
