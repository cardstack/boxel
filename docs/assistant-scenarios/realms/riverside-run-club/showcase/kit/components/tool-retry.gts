// Pretui — ToolRetry: a transient failure that will try again by itself.
import Component from '@glimmer/component';
import { StateGlyph } from './state-glyph';
import { on } from '@ember/modifier';

export interface ToolRetrySignature {
  Args: {
    /** what failed, in a few words: "rate limited by the search service" */
    reason: string;
    /** seconds until the next try. The caller owns the clock and updates
     * this; the component keeps none (no timers) */
    seconds?: number;
    /** which try comes next and of how many: "2 of 3" */
    attempt?: string;
    /** try now instead of waiting */
    onRetry?: () => void;
    /** the button's words. Default 'Retry now' */
    retryLabel?: string;
  };
  Element: HTMLDivElement;
}

/**
 * "✕ rate limited · retry in 8s · Retry now": a failure the call will
 * recover from on its own, said as a line on the row's rail, not as a red
 * stop. When the countdown ends the caller moves the row on; this part
 * only says when.
 */
export class ToolRetry extends Component<ToolRetrySignature> {
  get when(): string {
    let s = this.args.seconds;
    if (s === undefined) {
      return 'retrying';
    }
    return s <= 0 ? 'retrying now' : `retry in ${Math.ceil(s)}s`;
  }
  retry = () => this.args.onRetry?.();
  <template>
    <div class='pretui-toolretry' data-test-pretui-tool-retry ...attributes>
      <StateGlyph class='pretui-toolretry-glyph' @glyph='retry' />
      <span class='pretui-toolretry-text'>
        <span class='pretui-toolretry-reason'>{{@reason}}</span>
        <span class='pretui-toolretry-when' data-test-pretui-tool-retry-when>
          ·
          {{this.when}}{{#if @attempt}} · try {{@attempt}}{{/if}}</span>
        {{#if @onRetry}}
          <button
            type='button'
            class='pretui-toolretry-now'
            data-test-pretui-tool-retry-now
            {{on 'click' this.retry}}
          >{{if @retryLabel @retryLabel 'Retry now'}}</button>
        {{/if}}
      </span>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-toolretry {
          display: grid;
          grid-template-columns: var(--pretui-toolrow-disc, 16px) minmax(0, 1fr);
          column-gap: var(--pretui-toolrow-gap, 8px);
          align-items: baseline;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-toolretry-glyph {
          text-align: center;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-ui, 18px);
          color: var(
            --state-attention,
            var(
              --pretui-attention-ink,
              var(--pretui-attention, var(--boxel-fuschia))
            )
          );
        }
        .pretui-toolretry-text {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .pretui-toolretry-reason {
          color: var(--pretui-toolrow-settled-ink, var(--foreground));
        }
        /* the count changes each second: fixed-width digits keep the line
           still while it does */
        .pretui-toolretry-when {
          font-variant-numeric: tabular-nums;
        }
        /* its own line under the reason, its padding hung outside so the
           word starts on the text edge: the same place at every width,
           never wrapped in after the countdown */
        .pretui-toolretry-now {
          display: block;
          margin-block-start: 2px;
          margin-inline-start: calc(-1 * var(--step-4, 4px));
          padding: 0 var(--step-4, 4px);
          border: 0;
          border-radius: var(--round-chip, 4px);
          background: none;
          font: inherit;
          font-weight: 600;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-toolretry-now:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-toolretry-now:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
      }
    </style>
  </template>
}
