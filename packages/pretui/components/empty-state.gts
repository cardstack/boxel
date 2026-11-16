// Pretui — EmptyState: the kit's zero-data surface, with one or two honest
// ways forward and the texture that marks it as intentional.
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { resolveSize, type PretuiSizeArg } from '../pretui-primitives';

/** The two steps an EmptyState paints: 's' is the compact well, 'm' the page-section default. */
export type EmptyStateSize = 's' | 'm';
const EMPTY_STATE_SIZES: Record<string, EmptyStateSize> = {
  xs: 's',
  s: 's',
  m: 'm',
  l: 'm',
  xl: 'm',
};

export interface EmptyStateSignature {
  Args: {
    title: string;
    message?: string;
    texture?: boolean;
    /** wording of the separator between the two paths (default 'or') */
    separator?: string;
    /** 's' is the compact well for an empty note inside a card section; 'm' (default) sizes for a page section */
    size?: PretuiSizeArg;
  };
  Blocks: {
    /** The message with markup in it (a Token, a link, emphasis); wins over @message when both are given. */
    default: [];
    action: [];
    /**
     * The SECOND way in. An empty state usually has two honest answers —
     * "choose an existing one" / "paste a URL", "import" / "start blank",
     * "connect an account" / "upload a CSV" — and burying one of them makes
     * the reader guess which is the real path. Both get equal billing with a
     * separator between, folding to a stack at narrow container widths.
     */
    altAction: [];
  };
  Element: HTMLDivElement;
}

function px(v: string | undefined): number {
  return parseFloat(v ?? '') || 0;
}

// The row the two paths need: each action's own content, the separator's
// word plus its two shortest rules, and the gaps between the three.
function rowNeed(paths: HTMLElement): number {
  let cs = getComputedStyle(paths);
  let need = px(cs.columnGap) * 2;
  for (let item of Array.from(paths.children) as HTMLElement[]) {
    if (item.hasAttribute('data-empty-sep')) {
      let rule = px(getComputedStyle(item, '::before').minInlineSize);
      let word = item.firstElementChild?.getBoundingClientRect().width ?? 0;
      need += word + 2 * (rule + px(getComputedStyle(item).columnGap));
    } else {
      let rects = Array.from(item.children).map((c) => c.getBoundingClientRect());
      if (rects.length) {
        need += Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
      }
    }
  }
  return need;
}

// Folds the two paths all at once: one row while they fit, a stack the moment
// they don't. Measured rather than a container query, because containment
// would collapse an auto-sized EmptyState and a fixed threshold can't know
// the label widths. Both observers are disconnected on cleanup.
const foldPaths = modifier((paths: HTMLElement) => {
  let apply = () => {
    paths.dataset.fold = rowNeed(paths) > paths.clientWidth + 0.5 ? 'stack' : 'row';
  };
  if (typeof ResizeObserver === 'undefined') return;
  let observer = new ResizeObserver(apply);
  // A yielded block can swap its element ({{#if}}), so re-observe on change.
  let observeAll = () => {
    observer.disconnect();
    observer.observe(paths);
    for (let item of Array.from(paths.children)) {
      for (let c of Array.from(item.children)) observer.observe(c);
    }
    apply();
  };
  let mutations = new MutationObserver(observeAll);
  mutations.observe(paths, { childList: true, subtree: true });
  observeAll();
  return () => {
    mutations.disconnect();
    observer.disconnect();
  };
});

// The one place texture lives (Law 6).
export class EmptyState extends Component<EmptyStateSignature> {
  get showTexture() {
    return this.args.texture ?? true;
  }
  get separator() {
    return this.args.separator ?? 'or';
  }
  // data-size is always set, 'm' included, as on every sized component in the kit.
  get size(): EmptyStateSize {
    return EMPTY_STATE_SIZES[resolveSize(this.args.size)] ?? 'm';
  }
  <template>
    <div
      class='pretui-empty'
      data-size={{this.size}}
      data-test-pretui-empty
      ...attributes
    >
      {{#if this.showTexture}}<div class='pretui-empty-texture'></div>{{/if}}
      <div class='pretui-empty-title'>{{@title}}</div>
      {{#if (has-block)}}
        {{! A div, not a p: the caller's markup may contain block elements. }}
        <div class='pretui-empty-msg'>{{yield}}</div>
      {{else if @message}}
        <p class='pretui-empty-msg'>{{@message}}</p>
      {{/if}}
      {{#if (has-block 'altAction')}}
        <div class='pretui-empty-paths' data-fold='row' {{foldPaths}}>
          <div class='pretui-empty-action'>{{yield to='action'}}</div>
          <div class='pretui-empty-sep' data-empty-sep aria-hidden='true'><span>{{this.separator}}</span></div>
          <div class='pretui-empty-action'>{{yield to='altAction'}}</div>
        </div>
      {{else if (has-block 'action')}}
        <div class='pretui-empty-action'>{{yield to='action'}}</div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-empty {
          display: grid;
          place-items: center;
          text-align: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-3xl) var(--boxel-sp-lg);
          position: relative;
          overflow: hidden;
          border-radius: var(--radius);
          background-color: var(--canvas);
          color: var(--foreground);
        }
        /* compact: the well an empty note sits in inside a card section */
        .pretui-empty[data-size='s'] {
          padding: var(--boxel-sp);
        }
        .pretui-empty-texture {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: radial-gradient(
            ellipse 60% 45% at 50% 42%,
            color-mix(in oklch, var(--primary) 8%, transparent),
            transparent 70%
          );
        }
        .pretui-empty-title {
          position: relative;
          font-family: var(--font-serif);
          font-size: var(--boxel-heading-font-size);
          font-weight: var(--boxel-heading-font-weight);
        }
        .pretui-empty[data-size='s'] .pretui-empty-title {
          font-size: var(--boxel-font-size);
        }
        .pretui-empty-msg {
          position: relative;
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          max-width: 34ch;
        }
        .pretui-empty-action {
          position: relative;
          margin-top: var(--boxel-sp-2xs);
        }
        /* Two equal paths with a rule drawn on the separator itself, so it
           stretches across the row or the stack. foldPaths sets data-fold;
           the separator shrinks first, then the whole row folds at once. */
        .pretui-empty-paths {
          position: relative;
          justify-self: stretch;
          /* the row's own width must not widen the EmptyState, or it never folds */
          min-inline-size: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--boxel-sp-sm);
        }
        .pretui-empty-paths[data-fold='stack'] {
          flex-direction: column;
          align-items: stretch;
        }
        .pretui-empty-paths > .pretui-empty-action {
          display: flex;
          flex: none;
          justify-content: center;
        }
        .pretui-empty-sep {
          display: flex;
          flex: 1 1 auto;
          align-items: center;
          gap: var(--boxel-sp-xs);
          margin-top: var(--boxel-sp-2xs);
          font-size: var(--boxel-font-size-2xs);
          text-transform: lowercase;
        }
        .pretui-empty-sep::before,
        .pretui-empty-sep::after {
          content: '';
          flex: 1;
          min-inline-size: var(--boxel-sp-sm);
          block-size: 1px;
          background-color: var(--border);
        }
      }
    </style>
  </template>
}
