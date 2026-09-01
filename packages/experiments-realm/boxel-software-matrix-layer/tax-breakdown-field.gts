import {
  FieldDef,
  Component,
  contains,
  field,
  linksTo,
  NumberField,
} from '@cardstack/base/card-api';
import { TaxJurisdiction } from './tax-jurisdiction';
import { formatMoney } from './money';

// Tax Breakdown — a compound field capturing the taxable amount, the tax
// amount, and the rate ACTUALLY APPLIED at calculation time.
//
// `rateApplied` IS A SNAPSHOT, NOT A LIVE JOIN to `TaxJurisdiction.rate` —
// same principle as this realm's Order ("fees are snapshots, not rates"): a
// later change to the jurisdiction's rate must never rewrite a past
// invoice's tax line. `jurisdiction` is kept as a link for traceability
// (which lookup produced this number), but the number itself does not move
// if that lookup's rate later changes.

export class TaxBreakdownField extends FieldDef {
  static displayName = 'Tax Breakdown';

  @field jurisdiction = linksTo(TaxJurisdiction);
  @field taxableAmount = contains(NumberField);
  @field taxAmount = contains(NumberField);
  @field rateApplied = contains(NumberField);

  static embedded = class Embedded extends Component<typeof TaxBreakdownField> {
    get taxDisplay() {
      return formatMoney(this.args.model?.taxAmount, undefined);
    }
    <template>
      {{#if @model.taxAmount}}
        <span class='tax-breakdown'>
          Tax ({{@model.rateApplied}}%): {{this.taxDisplay}}
        </span>
      {{/if}}
      <style scoped>
        .tax-breakdown {
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };
}
