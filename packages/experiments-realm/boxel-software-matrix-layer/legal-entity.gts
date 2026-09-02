import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import EmailField from '@cardstack/base/email';
import TextAreaField from '@cardstack/base/text-area';
import AddressField from '@cardstack/base/address';
import enumField from '@cardstack/base/enum';

import { StatePill } from './components/state-pill';

export const LEGAL_ENTITY_TYPES = [
  'corporation',
  'llc',
  'gmbh',
  'ltd',
  'partnership',
  'sole-proprietorship',
  'nonprofit',
];

export const LEGAL_ENTITY_TYPE_LABELS: Record<string, string> = {
  corporation: 'Corporation',
  llc: 'LLC',
  gmbh: 'GmbH',
  ltd: 'Ltd',
  partnership: 'Partnership',
  'sole-proprietorship': 'Sole Proprietorship',
  nonprofit: 'Nonprofit',
};

export const LegalEntityTypeField = enumField(StringField, {
  options: LEGAL_ENTITY_TYPES.map((value) => ({
    value,
    label: LEGAL_ENTITY_TYPE_LABELS[value],
  })),
  displayName: 'Legal Entity Type',
});

function maskTail(value?: string | null): string {
  let v = (value ?? '').replace(/\s/g, '');
  return v.length ? `••••${v.slice(-4)}` : '';
}

// The formal contracting party: the registered legal person behind a
// commercial relationship. An Account is who you SELL to; a Legal Entity is
// who actually signs — registered name, form, jurisdiction, registration
// number, and the authorized signatory. Contracts today link Account;
// pointing Contract at its party entities is deliberately left as additive
// future wiring (see readMe non-goals) so this card ships without touching
// the shared Contract block.
export class LegalEntity extends CardDef {
  static displayName = 'Legal Entity';
  static headerColor = '#41337a';

  @field legalName = contains(StringField);
  @field entityType = contains(LegalEntityTypeField);
  @field jurisdiction = contains(StringField, {
    description: 'e.g. Delaware, England & Wales, Singapore',
  });
  @field registrationNumber = contains(StringField);
  @field taxId = contains(StringField);
  @field registeredAddress = contains(AddressField);
  @field signatoryName = contains(StringField);
  @field signatoryTitle = contains(StringField);
  @field signatoryEmail = contains(EmailField);
  @field notes = contains(TextAreaField);

  @field maskedTaxId = contains(StringField, {
    computeVia: function (this: LegalEntity) {
      return maskTail(this.taxId);
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: LegalEntity) {
      return this.legalName?.trim()?.length
        ? this.legalName
        : 'Untitled Entity';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get typeLabel() {
      return (
        LEGAL_ENTITY_TYPE_LABELS[this.args.model?.entityType ?? ''] ?? '—'
      );
    }
    <template>
      <article class='entity'>
        <header class='head'>
          <div>
            <p class='kicker'>Legal Entity</p>
            <h1>{{@model.legalName}}</h1>
            <p class='sub'>{{this.typeLabel}} · {{@model.jurisdiction}}</p>
          </div>
          <StatePill @label={{this.typeLabel}} @hue='slate' @emphatic={{true}} />
        </header>
        <div class='grid'>
          <section class='panel'>
            <h2>Registration</h2>
            <dl>
              <div><dt>Reg. number</dt><dd
                  class='mono'
                >{{@model.registrationNumber}}</dd></div>
              <div><dt>Tax ID</dt><dd class='mono'>{{@model.maskedTaxId}}</dd></div>
              <div><dt>Jurisdiction</dt><dd>{{@model.jurisdiction}}</dd></div>
              <div><dt>Registered at</dt><dd
                >{{@model.registeredAddress.fullAddress}}</dd></div>
            </dl>
          </section>
          <section class='panel'>
            <h2>Authorized Signatory</h2>
            <dl>
              <div><dt>Name</dt><dd>{{@model.signatoryName}}</dd></div>
              <div><dt>Title</dt><dd>{{@model.signatoryTitle}}</dd></div>
              <div><dt>Email</dt><dd>{{#if @model.signatoryEmail}}<@fields.signatoryEmail
                    />{{/if}}</dd></div>
            </dl>
          </section>
          {{#if @model.notes}}
            <section class='panel span'>
              <h2>Notes</h2>
              <p class='notes'>{{@model.notes}}</p>
            </section>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .entity {
          container-type: inline-size;
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          padding-bottom: var(--boxel-sp);
          margin-bottom: var(--boxel-sp);
        }
        .kicker {
          margin: 0;
          font-size: 0.6875rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: var(--boxel-sp-5xs) 0;
          font-family: var(--font-heading, inherit);
          font-size: 1.5rem;
        }
        .sub {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        .panel.span {
          grid-column: 1 / -1;
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        dl {
          margin: 0;
          display: grid;
          gap: var(--boxel-sp-xxs);
        }
        dl > div {
          display: grid;
          grid-template-columns: 7.5rem 1fr;
          gap: var(--boxel-sp-xs);
          align-items: baseline;
        }
        dt {
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.8125rem;
        }
        dd {
          margin: 0;
          font-size: 0.875rem;
        }
        .mono {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .notes {
          margin: 0;
          white-space: pre-wrap;
          font-size: 0.875rem;
        }
        @container (max-width: 560px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .head {
            flex-direction: column;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get typeLabel() {
      return (
        LEGAL_ENTITY_TYPE_LABELS[this.args.model?.entityType ?? ''] ?? '—'
      );
    }
    <template>
      <div class='row'>
        <div class='who'>
          <span class='name'>{{@model.legalName}}</span>
          <span class='meta'>{{this.typeLabel}} ·
            {{@model.jurisdiction}}</span>
        </div>
        <span class='reg mono'>{{@model.registrationNumber}}</span>
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
        .mono {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.legalName}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
          font-weight: 600;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get typeLabel() {
      return (
        LEGAL_ENTITY_TYPE_LABELS[this.args.model?.entityType ?? ''] ?? '—'
      );
    }
    <template>
      <div class='fit'>
        <span class='fit-name'>{{@model.legalName}}</span>
        <span class='fit-sub'>{{this.typeLabel}} ·
          {{@model.jurisdiction}}</span>
      </div>
      <style scoped>
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          padding: var(--boxel-sp-xs);
          overflow: hidden;
        }
        .fit-name {
          font-weight: 600;
          font-size: 0.9375rem;
          line-height: 1.2;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .fit-sub {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @container fitted-card (height <= 65px) {
          .fit {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-xs);
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
      </style>
    </template>
  };
}
