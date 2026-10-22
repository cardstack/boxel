// Pretui — IntentReceipt: what the reader picked on a card, and whether it reached the assistant.
import Component from '@glimmer/component';
import { StateGlyph } from './state-glyph';
import { on } from '@ember/modifier';

export interface IntentReceiptSignature {
  Args: {
    /** what was done: 'choose', 'reply', 'ask', 'attach' */
    kind?: string;
    /** what was picked: 'Rougui' */
    label: string;
    /** 'sent' (default), 'sending', 'failed', or, inside an MCP App:
     * 'drafted' (the host put it in the reader's composer, unsent) and
     * 'noted' (only the model's context took it) */
    delivery?: 'sending' | 'sent' | 'drafted' | 'noted' | 'failed';
    onRetry?: () => void;
    /** where it went, when not to the assistant: 'shared with Rupert' */
    note?: string;
  };
  Element: HTMLParagraphElement;
}

const VERBS: Record<string, string> = {
  choose: 'Chose',
  reply: 'Replied',
  ask: 'Asked',
  attach: 'Attached',
  tool: 'Ran',
};

/**
 * "✓ Chose Rougui · sent to the assistant", under a LiveCard once a tap on
 * it was sent: the decision in the past tense, then where it went. While
 * it is on its way it says so; if it did not arrive, "Not sent · Retry",
 * and the card is live again.
 */
export class IntentReceipt extends Component<IntentReceiptSignature> {
  get delivery() {
    return this.args.delivery ?? 'sent';
  }
  get verb(): string {
    return VERBS[this.args.kind ?? 'choose'] ?? 'Chose';
  }
  get text(): string {
    switch (this.delivery) {
      case 'sending':
        return `Sending · ${this.args.label}…`;
      case 'failed':
        return `Not sent · ${this.args.label}`;
      case 'drafted':
        return `${this.verb} ${this.args.label} · drafted in your message, send it to go on`;
      case 'noted':
        return `${this.verb} ${this.args.label} · noted for the assistant, say “go” to continue`;
      default:
        return `${this.verb} ${this.args.label} · ${this.args.note ?? 'sent to the assistant'}`;
    }
  }
  get glyph(): string {
    if (this.delivery === 'sent') {
      return 'done';
    }
    return this.delivery === 'failed' ? 'failed' : this.delivery === 'sending' ? 'note' : 'current';
  }
  get canRetry() {
    return this.delivery === 'failed' && Boolean(this.args.onRetry);
  }
  retry = () => this.args.onRetry?.();
  <template>
    <p class='pretui-intent' role='status' data-delivery={{this.delivery}} data-test-pretui-intent-receipt={{this.delivery}} ...attributes>
      <StateGlyph class='pretui-intent-glyph' @glyph={{this.glyph}} @size={{11}} />
      <span class='pretui-intent-text'>{{this.text}}</span>
      {{#if this.canRetry}}<button type='button' class='pretui-intent-retry' data-test-pretui-intent-retry {{on 'click' this.retry}}>Retry</button>{{/if}}
    </p>
    <style scoped>
      @layer PretComponent {
        .pretui-intent {
          display: flex;
          align-items: baseline;
          gap: var(--step-8, 8px);
          margin: 0;
          /* a receipt speaks sans: caption size */
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-2, var(--muted-foreground));
        }
        /* done is ink with a check, not green; a state colours only the mark */
        .pretui-intent-glyph {
          color: var(--foreground);
        }
        .pretui-intent[data-delivery='sending'] .pretui-intent-glyph {
          color: var(--state-live, var(--primary, var(--boxel-highlight)));
        }
        .pretui-intent[data-delivery='drafted'] .pretui-intent-glyph,
        .pretui-intent[data-delivery='noted'] .pretui-intent-glyph {
          color: var(
            --state-attention,
            var(--pretui-attention-ink, var(--pretui-attention, var(--boxel-fuschia)))
          );
        }
        /* failed: ink words, a red mark */
        .pretui-intent[data-delivery='failed'] {
          color: var(--foreground);
        }
        .pretui-intent[data-delivery='failed'] .pretui-intent-glyph {
          color: var(
            --state-failed,
            var(--pretui-destructive-ink, var(--boxel-danger))
          );
        }
        .pretui-intent-retry {
          padding: 0 var(--step-4, 4px);
          border: 0;
          border-radius: var(--round-chip, 4px);
          background: none;
          font: inherit;
          font-weight: 600;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-intent-retry:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-intent-retry:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
      }
    </style>
  </template>
}
