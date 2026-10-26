// Pretui — CollapsedTurn: a settled conversation turn folded to a one-line receipt.
import Component from '@glimmer/component';
import { StateGlyph } from './state-glyph';
import { on } from '@ember/modifier';

export interface CollapsedTurnSignature {
  Args: {
    summary: string;
    /** called when the reader presses the line */
    onExpand?: () => void;
    /** the line is a toggle: set while the turn's work is shown, so the
     * line says it can fold again (aria-expanded, a turned chevron) */
    expanded?: boolean;
    /** the element the line shows and hides, for aria-controls */
    controls?: string;
    /** 'pill' (default): a capsule. 'row': a line on ToolRow's grid, its
     * check in the disc column and its words on the row's text edge, so a
     * folded turn reads as one more row in a transcript of rows */
    variant?: 'pill' | 'row';
  };
  Element: HTMLButtonElement;
}

// Settled history earns its quiet: a receipt of counts, not content.
export class CollapsedTurn extends Component<CollapsedTurnSignature> {
  expand = () => this.args.onExpand?.();
  get isToggle() {
    return this.args.expanded !== undefined;
  }
  get expandedState() {
    if (!this.isToggle) {
      return undefined;
    }
    return this.args.expanded ? 'true' : 'false';
  }
  <template>
    <button
      type='button'
      class='pretui-collapsed'
      data-variant={{if @variant @variant 'pill'}}
      aria-expanded={{this.expandedState}}
      aria-controls={{@controls}}
      data-test-pretui-collapsed-turn
      {{on 'click' this.expand}}
      ...attributes
    >
      <StateGlyph class='pretui-collapsed-check' @glyph='done' />
      <span class='pretui-collapsed-summary'>{{@summary}}</span>
      {{#if this.isToggle}}
        <span
          class='pretui-collapsed-chevron'
          data-open={{if @expanded 'true'}}
          aria-hidden='true'
        ></span>
      {{/if}}
    </button>
    <style scoped>
      @layer PretComponent {
        .pretui-collapsed {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          max-width: 100%;
          min-height: 24px;
          padding: 0
            calc(
              5px * var(--pretui-capsule-base, 1.35) +
                var(--boxel-border-radius-sm) *
                var(--pretui-radius-encroach, 0.35)
            );
          border-radius: var(--boxel-border-radius-sm);
          border: 0;
          background: var(--inset, var(--boxel-100));
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          font: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--muted-foreground);
          cursor: pointer;
          font-variant-numeric: tabular-nums;
          text-align: start;
        }
        .pretui-collapsed:hover {
          background: var(--hover, var(--boxel-100));
          color: var(--foreground);
        }
        .pretui-collapsed:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        /* done is ink with a check, not green */
        .pretui-collapsed-check {
          flex: none;
          color: var(--foreground);
        }
        .pretui-collapsed-summary {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* points right while folded, down while the work shows */
        .pretui-collapsed-chevron {
          flex: none;
          width: 5px;
          height: 5px;
          margin-inline-start: 1px;
          border-inline-end: 1.5px solid currentColor;
          border-block-end: 1.5px solid currentColor;
          transform: rotate(-45deg);
          transition: transform 160ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        .pretui-collapsed-chevron[data-open] {
          transform: rotate(45deg);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-collapsed-chevron {
            transition: none;
          }
        }
        /* the row form: ToolRow's grid (inset, disc, gap), its height, and
           the receipt's quiet caption voice (sans, tabular), with no capsule
           around it */
        /* the row form keeps a hover pad but hangs it outside the text
           edge, so its check lines up with every other mark in the thread */
        .pretui-collapsed[data-variant='row'] {
          display: flex;
          box-sizing: content-box;
          width: 100%;
          min-height: 26px;
          gap: var(--pretui-toolrow-gap, 8px);
          margin-inline: calc(-1 * var(--pretui-toolrow-inset, 8px));
          padding: 0 var(--pretui-toolrow-inset, 8px);
          border-radius: var(--boxel-border-radius-sm);
          background: none;
          box-shadow: none;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--subtle-foreground);
        }
        .pretui-collapsed[data-variant='row']:hover {
          background: var(--inset, var(--boxel-100));
          color: var(--muted-foreground);
        }
        .pretui-collapsed[data-variant='row'] .pretui-collapsed-check {
          width: var(--pretui-toolrow-disc, 16px);
          text-align: center;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
        }
      }
    </style>
  </template>
}
