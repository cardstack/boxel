// Pretui — EmptyState: the kit's zero-data surface, with one or two honest
// ways forward and the texture that marks it as intentional.
import Component from '@glimmer/component';
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
        <div class='pretui-empty-paths'>
          <div class='pretui-empty-action'>{{yield to='action'}}</div>
          <div class='pretui-empty-sep' aria-hidden='true'>{{this.separator}}</div>
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
          font-size: var(--boxel-font-size-xs);
          max-width: 34ch;
        }
        .pretui-empty-action {
          position: relative;
          margin-top: var(--boxel-sp-2xs);
        }
        /* Two equal paths with a rule between. The rule is drawn on the
           separator itself so it stretches to whatever the row/column is —
           no measurement, and it flips axis with the fold. */
        /* flex-wrap rather than a container query: EmptyState is often an auto
           -sized grid/flex item, and `container-type: inline-size` would apply
           inline-size containment to it and collapse that case. Wrapping folds
           the two paths into a stack at exactly the width where they stop
           fitting, with no containment side effect. */
        .pretui-empty-paths {
          position: relative;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: var(--boxel-sp-sm);
        }
        .pretui-empty-sep {
          display: flex;
          align-items: center;
          flex: 1 1 6rem;
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
