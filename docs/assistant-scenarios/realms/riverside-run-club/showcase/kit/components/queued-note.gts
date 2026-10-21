// Pretui — QueuedNote: a message the reader sent while a run works, held for the run's next step.
import Component from '@glimmer/component';
import { StateGlyph } from './state-glyph';
import { on } from '@ember/modifier';

export interface QueuedNoteSignature {
  Args: {
    /** what the reader wrote */
    text: string;
    /** 'queued' (default): waiting for the step boundary; 'delivered': the
     * run has read it */
    state?: 'queued' | 'delivered';
    /** where it lands: 'step 3', 'the next step' */
    arrivesAt?: string;
    /** take the note back before the run reads it */
    onCancel?: () => void;
  };
  Element: HTMLDivElement;
}

/**
 * "↳ Your note arrives at step 3": steering, said where the run is. A
 * message sent mid-run does not interrupt the step under way; the run
 * reads it when that step ends, and the line says which step that is.
 */
export class QueuedNote extends Component<QueuedNoteSignature> {
  get state() {
    return this.args.state ?? 'queued';
  }
  get isQueued() {
    return this.state === 'queued';
  }
  get where(): string {
    let at = this.args.arrivesAt ?? 'the next step';
    return this.isQueued
      ? `Your note arrives at ${at}`
      : `Your note was read at ${at}`;
  }
  cancel = () => this.args.onCancel?.();
  <template>
    <div
      class='pretui-queuednote'
      data-state={{this.state}}
      role='status'
      data-test-pretui-queued-note={{this.state}}
      ...attributes
    >
      <StateGlyph class='pretui-queuednote-glyph' @glyph='steer' />
      <span class='pretui-queuednote-body'>
        <span class='pretui-queuednote-where'>{{this.where}}</span>
        <q class='pretui-queuednote-text'>{{@text}}</q>
      </span>
      {{#if (if this.isQueued @onCancel)}}
        <button
          type='button'
          class='pretui-queuednote-cancel'
          data-test-pretui-queued-note-cancel
          {{on 'click' this.cancel}}
        >Take back</button>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-queuednote {
          display: grid;
          grid-template-columns: var(--pretui-toolrow-disc, 16px) minmax(0, 1fr) auto;
          column-gap: var(--pretui-toolrow-gap, var(--step-8, 8px));
          align-items: baseline;
          /* on the transcript's text edge; inside a row, the row's inset */
          padding-inline: var(--pretui-toolrow-inset, 0px);
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--ink-2, var(--muted-foreground));
        }
        /* queued, riding the live run: the mark takes the live state; read,
           it settles to ink (done is ink, not a colour) */
        .pretui-queuednote-glyph {
          text-align: center;
          color: var(--state-live, var(--pretui-attention-ink, var(--pretui-attention)));
        }
        .pretui-queuednote[data-state='delivered'] .pretui-queuednote-glyph {
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-queuednote-body {
          display: grid;
          min-width: 0;
        }
        .pretui-queuednote-where {
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        .pretui-queuednote-text {
          color: var(--foreground);
          overflow-wrap: anywhere;
          quotes: '“' '”';
        }
        .pretui-queuednote[data-state='delivered'] .pretui-queuednote-text {
          color: var(--pretui-toolrow-settled-ink, var(--ink-2, var(--muted-foreground)));
        }
        .pretui-queuednote-cancel {
          padding: 0 var(--step-4, 4px);
          border: 0;
          border-radius: var(--round-chip, 4px);
          background: none;
          font: inherit;
          font-weight: 600;
          color: var(--ink-2, var(--muted-foreground));
          cursor: pointer;
        }
        .pretui-queuednote-cancel:hover {
          color: var(--foreground);
        }
        .pretui-queuednote-cancel:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
      }
    </style>
  </template>
}
