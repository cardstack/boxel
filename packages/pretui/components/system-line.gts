// Pretui — SystemLine: a change to the conversation itself, said once in the thread.
import Component from '@glimmer/component';
import { StateGlyph } from './state-glyph';
import { on } from '@ember/modifier';

export interface SystemLineSignature {
  Args: {
    /** what changed: 'Model set to GPT-5.6 Terra', 'Skills on: Showcase' */
    text: string;
    /** one character before it. Default '·' */
    glyph?: string;
    /** who changed it, when it was not the reader: 'the assistant',
     * 'Rupert' */
    by?: string;
    /** 'line' (default), or 'checkpoint': a rule across the thread with
     * the point's name on it, a place the session can go back to */
    variant?: 'line' | 'checkpoint';
    /** one verb on the line: Restore (a checkpoint), Switch back (a model
     * fallback), Fix (a broken skill) */
    action?: string;
    onAction?: () => void;
    /** dismiss a notice the reader has seen */
    onDismiss?: () => void;
  };
  Element: HTMLParagraphElement;
}

/**
 * A model switch, a skill turned on, someone joining: facts about the
 * room, not work, so they read as one caption line on the transcript's text
 * edge between turns, never as a row.
 */
export class SystemLine extends Component<SystemLineSignature> {
  act = () => this.args.onAction?.();
  dismiss = () => this.args.onDismiss?.();
  <template>
    <p
      class='pretui-systemline'
      data-variant={{if @variant @variant 'line'}}
      data-test-pretui-system-line
      ...attributes
    >
      <StateGlyph class='pretui-systemline-glyph' @glyph={{if @glyph @glyph '·'}} @size={{11}} />
      <span class='pretui-systemline-text'>{{@text}}{{#if @by}}<span
            class='pretui-systemline-by'
          > · by {{@by}}</span>{{/if}}</span>
      {{#if @onAction}}<button
          type='button'
          class='pretui-systemline-act'
          data-test-pretui-system-line-action
          {{on 'click' this.act}}
        >{{if @action @action 'Restore'}}</button>{{/if}}
      {{#if @onDismiss}}<button
          type='button'
          class='pretui-systemline-act'
          aria-label='Dismiss'
          data-test-pretui-system-line-dismiss
          {{on 'click' this.dismiss}}
        ><StateGlyph @glyph='failed' @size={{11}} /></button>{{/if}}
    </p>
    <style scoped>
      @layer PretComponent {
        .pretui-systemline {
          display: grid;
          grid-template-columns: var(--pretui-toolrow-disc, 16px) minmax(0, 1fr) auto auto;
          column-gap: var(--pretui-toolrow-gap, 8px);
          align-items: baseline;
          margin: 0;
          /* on the transcript's text edge; inside a row, the row's inset */
          padding-inline: var(--pretui-toolrow-inset, 0px);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        .pretui-systemline-glyph {
          text-align: center;
        }
        .pretui-systemline-text {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        /* a checkpoint is a rule across the thread with its name on it */
        .pretui-systemline[data-variant='checkpoint'] {
          grid-template-columns:
            minmax(var(--step-12, 12px), 1fr) auto auto
            minmax(var(--step-12, 12px), 1fr);
          column-gap: var(--step-8, 8px);
        }
        .pretui-systemline[data-variant='checkpoint']::before,
        .pretui-systemline[data-variant='checkpoint']::after {
          content: '';
          height: 1px;
          align-self: center;
          background: var(--border);
        }
        .pretui-systemline[data-variant='checkpoint']::before {
          grid-column: 1;
          grid-row: 1;
        }
        .pretui-systemline[data-variant='checkpoint']::after {
          grid-column: 4;
          grid-row: 1;
        }
        .pretui-systemline[data-variant='checkpoint'] .pretui-systemline-glyph {
          display: none;
        }
        .pretui-systemline-act {
          padding: 0 var(--step-4, 4px);
          border: 0;
          border-radius: var(--round-chip, 4px);
          background: none;
          font: inherit;
          font-weight: 600;
          color: var(--ink-2, var(--muted-foreground));
          cursor: pointer;
        }
        .pretui-systemline-act:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-systemline-act:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-systemline-by {
          color: var(--ink-2, var(--muted-foreground));
        }
      }
    </style>
  </template>
}
