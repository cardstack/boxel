import { Component, field, contains } from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import MarkdownField from '@cardstack/base/markdown';

import { Clause } from './clause';
import { StatePill } from './components/state-pill';

// A confidentiality (NDA) clause as a typed library entry. Extends the
// shared Clause additively — the base card owns text, risk, and review
// bookkeeping; this subclass adds the terms a lawyer actually compares NDAs
// by: how long, whether it binds both parties, what falls outside it, and
// whether the duty outlives the contract. Instances should set the base
// `clauseType` to `confidentiality` so type-driven views group them.
export class ConfidentialityClause extends Clause {
  static displayName = 'Confidentiality Clause';

  @field termYears = contains(NumberField, {
    description: 'How many years the duty runs; 0 = perpetual',
  });
  @field isMutual = contains(BooleanField, {
    description: 'Binds both parties, not just the receiving one',
  });
  @field survivesTermination = contains(BooleanField);
  @field carveOuts = contains(MarkdownField, {
    description:
      'What is NOT confidential: public knowledge, independently developed, legally compelled…',
  });

  static embedded = class Embedded extends Component<typeof this> {
    get termLabel() {
      let y = this.args.model?.termYears;
      if (y == null) {
        return 'term unset';
      }
      return y === 0 ? 'perpetual' : `${y}-year term`;
    }
    <template>
      <div class='row'>
        <div class='who'>
          <span class='name'>{{@model.name}}</span>
          <span class='meta'>{{this.termLabel}}
            · {{if @model.isMutual 'mutual' 'one-way'}}
            {{if @model.survivesTermination '· survives termination'}}</span>
        </div>
        <StatePill @label='confidentiality' @hue='blue' @chrome={{true}} />
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
        }
      </style>
    </template>
  };
}
