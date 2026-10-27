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
      <StateGlyph
        class='pretui-systemline-glyph'
        @glyph={{if @glyph @glyph '·'}}
        @size={{11}}
      />
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
          grid-template-columns:
            var(--pretui-toolrow-disc, 1rem) minmax(0, 1fr)
            auto auto;
          column-gap: var(--pretui-toolrow-gap, var(--boxel-sp-xs));
          align-items: baseline;
          margin: 0;
          /* on the transcript's text edge; inside a row, the row's inset */
          padding-inline: var(--pretui-toolrow-inset, 0);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--subtle-foreground);
        }
        .pretui-systemline-glyph {
          text-align: center;
        }
        .pretui-systemline-text {
          min-width: 0;
          overflow-wrap: break-word;
        }
        /* a checkpoint is a rule across the thread with its name on it. A
           flex row, not a grid, so the two rules take the slack on either
           side of whatever sits between them: the name alone, or the name
           with an action, a dismiss button or both, all on one line */
        .pretui-systemline[data-variant='checkpoint'] {
          display: flex;
          align-items: center;
          column-gap: var(--boxel-sp-xs);
        }
        .pretui-systemline[data-variant='checkpoint']::before,
        .pretui-systemline[data-variant='checkpoint']::after {
          content: '';
          flex: 1 1 var(--boxel-sp-sm);
          min-width: var(--boxel-sp-sm);
          height: 1px;
          background-color: var(--border);
        }
        .pretui-systemline[data-variant='checkpoint'] .pretui-systemline-glyph {
          display: none;
        }
        /* a 24px target (WCAG 2.5.8) inside a caption line: the negative
           block margin gives back what the height adds, so the line keeps
           its caption height */
        .pretui-systemline-act {
          --_systemline-target: 1.5rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: var(--_systemline-target);
          min-height: var(--_systemline-target);
          margin-block: calc((1lh - var(--_systemline-target)) / 2);
          padding: 0 var(--boxel-sp-4xs);
          border: 0;
          border-radius: var(--boxel-border-radius-xs);
          background-color: transparent;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          font-weight: 600;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-systemline-act:hover {
          color: var(--primary-ink);
        }
        .pretui-systemline-act:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-systemline-by {
          color: var(--muted-foreground);
        }
      }
    </style>
  </template>
}
