import {
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';

import { Clause } from './clause';
import { StatePill } from './components/state-pill';

// A termination clause as a typed library entry. Extends the shared Clause
// additively with the exit mechanics a reviewer compares: notice period,
// whether either party can leave without cause ("for convenience"), how
// long a breaching party has to cure, and any early-exit fee. Instances
// should set the base `clauseType` to `termination`.
export class TerminationClause extends Clause {
  static displayName = 'Termination Clause';

  @field noticeDays = contains(NumberField, {
    description: 'Days of written notice required',
  });
  @field forConvenience = contains(BooleanField, {
    description: 'Either party may terminate without cause',
  });
  @field curePeriodDays = contains(NumberField, {
    description: 'Days a breaching party has to fix the breach',
  });
  @field earlyExitFeeText = contains(StringField, {
    description: 'e.g. "3 months of remaining fees", "none"',
  });

  static embedded = class Embedded extends Component<typeof this> {
    get termsLabel() {
      let parts: string[] = [];
      let notice = this.args.model?.noticeDays;
      if (notice != null) {
        parts.push(`${notice}-day notice`);
      }
      if (this.args.model?.forConvenience) {
        parts.push('for convenience');
      }
      let cure = this.args.model?.curePeriodDays;
      if (cure != null) {
        parts.push(`${cure}-day cure`);
      }
      return parts.join(' · ') || 'terms unset';
    }
    <template>
      <div class='row'>
        <div class='who'>
          <span class='name'>{{@model.name}}</span>
          <span class='meta'>{{this.termsLabel}}</span>
        </div>
        <StatePill @label='termination' @hue='red' @chrome={{true}} />
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .who {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
        }
        .meta {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };
}
