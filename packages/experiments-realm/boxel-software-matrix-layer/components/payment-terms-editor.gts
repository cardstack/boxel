import GlimmerComponent from '@glimmer/component';
import { FieldContainer } from '@cardstack/boxel-ui/components';

// Payment Terms Editor — the form for one PaymentTermsField, laid out the
// way the terms are spoken: the net period first, the early-pay discount as
// one visual pair ("2 % if paid within 10 days"), the rail last. Consumed
// by PaymentTermsField's own edit format; render-only over the field's
// @fields, no realm access.

interface Signature {
  Args: {
    fields: any;
    shorthand?: string | null;
  };
  Element: HTMLElement;
}

export class PaymentTermsEditor extends GlimmerComponent<Signature> {
  <template>
    <div class='terms-editor' ...attributes>
      {{#if @shorthand}}
        <p class='preview'><span class='preview-label'>reads as</span>
          {{@shorthand}}</p>
      {{/if}}
      <div class='row'>
        <FieldContainer @label='Net days' @vertical={{true}}>
          <@fields.netDays />
        </FieldContainer>
        <FieldContainer @label='Preferred method' @vertical={{true}}>
          <@fields.method />
        </FieldContainer>
      </div>
      <div class='discount'>
        <span class='discount-label'>Early-payment discount</span>
        <div class='row'>
          <FieldContainer @label='Discount %' @vertical={{true}}>
            <@fields.discountPct />
          </FieldContainer>
          <FieldContainer @label='…if paid within (days)' @vertical={{true}}>
            <@fields.discountDays />
          </FieldContainer>
        </div>
      </div>
      <FieldContainer @label='Notes' @vertical={{true}}>
        <@fields.notes />
      </FieldContainer>
    </div>
    <style scoped>
      .terms-editor {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .preview {
        margin: 0;
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        font-size: 1.0625rem;
      }
      .preview-label {
        font-weight: 400;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, var(--boxel-450));
        margin-right: var(--boxel-sp-xs);
      }
      .row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--boxel-sp-sm);
        align-items: start;
      }
      .discount {
        border: 1px dashed var(--border, var(--boxel-300));
        border-radius: var(--radius, var(--boxel-border-radius));
        padding: var(--boxel-sp-sm);
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .discount-label {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>
}
