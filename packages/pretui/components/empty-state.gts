// Pretui — EmptyState: the kit's zero-data surface, with one or two honest
// ways forward and the texture that marks it as intentional.
import Component from '@glimmer/component';

export interface EmptyStateSignature {
  Args: {
    title: string;
    message?: string;
    texture?: boolean;
    /** wording of the separator between the two paths (default 'or') */
    separator?: string;
  };
  Blocks: {
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
  <template>
    <div class='pretui-empty' data-test-pretui-empty ...attributes>
      {{#if this.showTexture}}<div class='pretui-empty-texture'></div>{{/if}}
      <div class='pretui-empty-title'>{{@title}}</div>
      {{#if @message}}<div class='pretui-empty-msg'>{{@message}}</div>{{/if}}
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
      .pretui-empty {
        display: grid;
        place-items: center;
        text-align: center;
        gap: var(--space-3, 8px);
        padding: var(--space-9, 45px) var(--space-6, 19px);
        position: relative;
        overflow: hidden;
        border-radius: var(--radius-surface, 10px);
        background: var(--canvas, var(--boxel-100));
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
        font-size: var(--text-heading, 19px);
      }
      .pretui-empty-msg {
        position: relative;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
        max-width: 34ch;
      }
      .pretui-empty-action {
        position: relative;
        margin-top: var(--space-2, 6px);
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
        gap: var(--space-4, 11px);
      }
      .pretui-empty-sep {
        display: flex;
        align-items: center;
        gap: var(--space-3, 8px);
        margin-top: var(--space-2, 6px);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--ink-3, var(--boxel-400));
        text-transform: lowercase;
      }
      .pretui-empty-sep::before,
      .pretui-empty-sep::after {
        content: '';
        flex: 1;
        min-inline-size: 12px;
        block-size: 1px;
        background: var(--border);
      }
      .pretui-empty-sep {
        flex: 1 1 6rem;
      }
    </style>
  </template>
}
