import {
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';

import { Clause } from './clause';
import { StatePill } from './components/state-pill';
import { tracked } from '@glimmer/tracking';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { EditSectionNav } from './components/edit-section-nav';

// A payment-terms clause as a typed library entry. Extends the shared
// Clause additively with the numbers a finance reviewer scans for: net
// days, late-fee rate, and any early-payment discount. Instances should set
// the base `clauseType` to `payment` so type-driven views group them.
export class PaymentClause extends Clause {
  static displayName = 'Payment Clause';

  @field netDays = contains(NumberField, {
    description: 'Days to pay after invoice, e.g. 30 for Net-30',
  });
  @field lateFeePercent = contains(NumberField, {
    description: 'Monthly late fee on overdue balance, e.g. 1.5',
  });
  @field earlyPaymentDiscountPercent = contains(NumberField);
  @field earlyPaymentWindowDays = contains(NumberField);
  @field acceptedMethods = contains(StringField, {
    description: 'e.g. ACH, wire, credit card',
  });

  /**
   * Edit — a Clause plus the typed payment terms.
   * Grouped by task, not schema order; EditSectionNav is the table of
   * contents (edit-card Rule 0b, family rule: every grouped edit gets the rail).
   */
  static edit = class Edit extends Component<typeof this> {
    @tracked activeSection = 'identity';

    sections = [
      { id: 'identity', label: 'Identity' },
      { id: 'text', label: 'Approved text' },
      { id: 'guidance', label: 'Guidance & review' },
      { id: 'payment', label: 'Payment terms' },
    ];

    goTo = (id: string, event: Event) => {
      this.activeSection = id;
      let root = (event.currentTarget as HTMLElement).closest('.pclause-sub-edit');
      root
        ?.querySelector(`[data-sect='${id}']`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    <template>
      <div class='pclause-sub-edit'>
        {{! root is the container + only scroller; the responsive grid lives
            on this inner wrapper (edit-card Rule 1 corollary) }}
        <div class='edit-body'>
          <EditSectionNav
            @sections={{this.sections}}
            @activeId={{this.activeSection}}
            @onSelect={{this.goTo}}
            class='sect-nav'
          />
          <div class='sects'>
            <section
              class='sect {{if (eq this.activeSection "identity") "focused"}}'
              data-sect='identity'
            >
              <h3>Identity</h3>
              <FieldContainer @label='Clause name' @vertical={{true}}>
                <@fields.name />
              </FieldContainer>
              <div class='row cols-3'>
                <FieldContainer @label='Type' @vertical={{true}}>
                  <@fields.clauseType />
                </FieldContainer>
                <FieldContainer @label='Risk when used as written' @vertical={{true}}>
                  <@fields.riskLevel />
                </FieldContainer>
                <FieldContainer @label='Owner role (who may edit)' @vertical={{true}}>
                  <@fields.ownerRole />
                </FieldContainer>
              </div>
            </section>
            <section
              class='sect {{if (eq this.activeSection "text") "focused"}}'
              data-sect='text'
            >
              <h3>Approved text
                <span class='sect-hint'>the wording every ContractClause is measured against</span></h3>
              <FieldContainer @label='Standard text' @vertical={{true}}>
                <@fields.standardText />
              </FieldContainer>
            </section>
            <section
              class='sect {{if (eq this.activeSection "guidance") "focused"}}'
              data-sect='guidance'
            >
              <h3>Guidance & review</h3>
              <FieldContainer @label='When to use it, what must never be conceded without sign-off' @vertical={{true}}>
                <@fields.guidance />
              </FieldContainer>
              <FieldContainer @label='Last reviewed' @vertical={{true}}>
                <@fields.reviewedAt />
                <p class='hint'>approved language goes stale — Clause References pin to this date</p>
              </FieldContainer>
            </section>
            <section
              class='sect {{if (eq this.activeSection "payment") "focused"}}'
              data-sect='payment'
            >
              <h3>Payment terms</h3>
              <div class='row cols-2'>
                <FieldContainer @label='Net (days)' @vertical={{true}}>
                  <@fields.netDays />
                </FieldContainer>
                <FieldContainer @label='Late fee %' @vertical={{true}}>
                  <@fields.lateFeePercent />
                </FieldContainer>
              </div>
              <div class='row cols-2'>
                <FieldContainer @label='Early-payment discount %' @vertical={{true}}>
                  <@fields.earlyPaymentDiscountPercent />
                </FieldContainer>
                <FieldContainer @label='Early-payment window (days)' @vertical={{true}}>
                  <@fields.earlyPaymentWindowDays />
                </FieldContainer>
              </div>
              <FieldContainer @label='Accepted methods' @vertical={{true}}>
                <@fields.acceptedMethods />
              </FieldContainer>
            </section>
          </div>
        </div>
      </div>
      <style scoped>
        .pclause-sub-edit {
          container-type: inline-size;
          container-name: edit;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
        }
        .edit-body {
          display: grid;
          grid-template-columns: 9.5rem minmax(0, 1fr);
          align-items: start;
          gap: var(--boxel-sp);
        }
        /* root is the scroller, so sticky pins the rail; the legal family
           asserts no brand ink, so the rail keeps its default fg/bg pair */
        .sect-nav {
          position: sticky;
          top: 0;
        }
        .sects {
          display: grid;
          gap: var(--boxel-sp);
          min-width: 0;
        }
        .sect {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-sm);
          transition:
            outline-color 160ms ease,
            box-shadow 160ms ease;
          outline: 2px solid transparent;
          outline-offset: 2px;
        }
        .sect.focused {
          outline-color: var(--foreground, var(--boxel-dark));
          box-shadow: 0 0 0 4px
            color-mix(in oklch, var(--foreground, var(--boxel-dark)) 12%, transparent);
        }
        h3 {
          margin: 0;
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .sect-hint {
          text-transform: none;
          letter-spacing: normal;
          font-size: 0.75rem;
          font-weight: 400;
          font-style: italic;
        }
        .hint {
          margin: 0.25rem 0 0;
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .row {
          display: grid;
          gap: var(--boxel-sp-sm);
          align-items: start;
        }
        .row.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .row.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .row.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        @container edit (width < 640px) {
          .row.cols-2,
          .row.cols-3,
          .row.cols-4 {
            grid-template-columns: 1fr;
          }
          .edit-body {
            grid-template-columns: 1fr;
          }
          .sect-nav {
            position: static;
            flex-direction: row;
            flex-wrap: wrap;
          }
          .sect-nav::before {
            display: none;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get termsLabel() {
      let parts: string[] = [];
      let net = this.args.model?.netDays;
      if (net != null) {
        parts.push(`Net-${net}`);
      }
      let late = this.args.model?.lateFeePercent;
      if (late) {
        parts.push(`${late}%/mo late fee`);
      }
      let disc = this.args.model?.earlyPaymentDiscountPercent;
      let window = this.args.model?.earlyPaymentWindowDays;
      if (disc && window) {
        parts.push(`${disc}/${window} discount`);
      }
      return parts.join(' · ') || 'terms unset';
    }
    <template>
      <div class='row'>
        <div class='who'>
          <span class='name'>{{@model.name}}</span>
          <span class='meta'>{{this.termsLabel}}</span>
        </div>
        <StatePill @label='payment' @hue='green' @chrome={{true}} />
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
