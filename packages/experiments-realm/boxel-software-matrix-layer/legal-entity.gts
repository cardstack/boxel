import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import EmailField from '@cardstack/base/email';
import TextAreaField from '@cardstack/base/text-area';
import AddressField from '@cardstack/base/address';
import enumField from '@cardstack/base/enum';

import { StatePill } from './components/state-pill';
import { EditSectionNav } from './components/edit-section-nav';

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

  // Edit grouped the way the record gets filled in: who is this entity →
  // where and how is it registered → who signs for it → anything else.
  // 4 real sections, so the EditSectionNav rail applies (edit-card Rule 0b).
  // Computed fields (maskedTaxId, cardTitle) are deliberately excluded.
  static edit = class Edit extends Component<typeof this> {
    // Left section nav: clicking anchors that section to the top of the
    // form's own scroller (the root, per edit-card Rule 1 — never a nested
    // scroller). Scoped through the event's own root so several open edit
    // panels never cross-scroll each other.
    @tracked activeSection = 'identity';

    sections = [
      { id: 'identity', label: 'Identity' },
      { id: 'registration', label: 'Registration' },
      { id: 'signatory', label: 'Signatory' },
      { id: 'notes', label: 'Notes' },
    ];

    goTo = (id: string, event: Event) => {
      this.activeSection = id;
      let root = (event.currentTarget as HTMLElement).closest('.entity-edit');
      root
        ?.querySelector(`[data-sect='${id}']`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    <template>
      <div class='entity-edit'>
        {{! the container element cannot be restyled by its own query
            (edit-card Rule 1 corollary) — the responsive grid lives on
            this inner wrapper instead }}
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
              <h3>Entity Identity</h3>
              <div class='row identity'>
                <FieldContainer @label='Registered legal name' @vertical={{true}}>
                  <@fields.legalName />
                </FieldContainer>
                <FieldContainer @label='Entity type' @vertical={{true}}>
                  <@fields.entityType />
                </FieldContainer>
              </div>
            </section>

            <section
              class='sect
                {{if (eq this.activeSection "registration") "focused"}}'
              data-sect='registration'
            >
              <h3>Registration &amp; Jurisdiction</h3>
              <div class='row three'>
                <FieldContainer @label='Jurisdiction' @vertical={{true}}>
                  <@fields.jurisdiction />
                </FieldContainer>
                <FieldContainer @label='Registration number' @vertical={{true}}>
                  <@fields.registrationNumber />
                </FieldContainer>
                <FieldContainer @label='Tax ID' @vertical={{true}}>
                  <@fields.taxId />
                </FieldContainer>
              </div>
              <FieldContainer @label='Registered address' @vertical={{true}}>
                <@fields.registeredAddress />
              </FieldContainer>
            </section>

            <section
              class='sect {{if (eq this.activeSection "signatory") "focused"}}'
              data-sect='signatory'
            >
              <h3>Authorized Signatory
                <span class='sect-hint'>the person who signs contracts on
                  this entity's behalf</span></h3>
              <div class='row three'>
                <FieldContainer @label='Name' @vertical={{true}}>
                  <@fields.signatoryName />
                </FieldContainer>
                <FieldContainer @label='Title' @vertical={{true}}>
                  <@fields.signatoryTitle />
                </FieldContainer>
                <FieldContainer @label='Email' @vertical={{true}}>
                  <@fields.signatoryEmail />
                </FieldContainer>
              </div>
            </section>

            <section
              class='sect {{if (eq this.activeSection "notes") "focused"}}'
              data-sect='notes'
            >
              <h3>Notes</h3>
              <FieldContainer @label='Internal notes' @vertical={{true}}>
                <@fields.notes />
              </FieldContainer>
            </section>
          </div>
        </div>
      </div>
      <style scoped>
        .entity-edit {
          container-type: inline-size;
          container-name: edit;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          /* the legal family asserts no brand hue in CSS — the theme's own
             foreground/background pair is the accent (boxel-theming §4a) */
          --le-ink: var(--foreground, var(--boxel-dark));
          --le-ink-fg: var(--background, var(--boxel-light));
        }
        .edit-body {
          display: grid;
          grid-template-columns: 9.5rem minmax(0, 1fr);
          align-items: start;
          gap: var(--boxel-sp);
        }
        /* the root is the scroller, so sticky pins the nav to its top */
        .sect-nav {
          position: sticky;
          top: 0;
          /* hand the family ink pair to the rail's published knobs */
          --edit-section-nav-ink: var(--le-ink);
          --edit-section-nav-ink-fg: var(--le-ink-fg);
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
        /* the section the rail points at mirrors the rail's active state,
           same ink, diluted for the halo */
        .sect.focused {
          outline-color: var(--le-ink);
          box-shadow: 0 0 0 4px
            color-mix(in oklch, var(--le-ink) 12%, transparent);
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
        .row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--boxel-sp-sm);
          align-items: start;
        }
        .row.three {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .identity {
          grid-template-columns: 2fr 1fr;
        }
        @container edit (width < 640px) {
          .row,
          .row.three,
          .identity {
            grid-template-columns: 1fr;
          }
          /* narrow panel: nav becomes a horizontal chip row above the form */
          .edit-body {
            grid-template-columns: 1fr;
          }
          /* narrow: the rail flips horizontal (consumer's scope attribute
             rides ...attributes onto the component root, so these apply) */
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
}
