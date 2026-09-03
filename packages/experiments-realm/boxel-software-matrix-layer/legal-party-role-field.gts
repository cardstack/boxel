import {
  FieldDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import BuildingIcon from '@cardstack/boxel-icons/building-2';
import { FieldContainer } from '@cardstack/boxel-ui/components';

import { LegalEntity } from './legal-entity';
import { StatePill } from './components/state-pill';

/**
 * Legal Party Role (LP) — one side of an agreement: WHICH legal person, in
 * WHAT capacity.
 *
 * A contract is not "between Acme and us"; it is between Acme GmbH as
 * Customer and Cardstack Inc. as Supplier. The capacity is what the clauses
 * refer to ("the Supplier shall…"), so it is stored beside the entity rather
 * than inferred from which side of the table we sit on. The same entity can
 * be Licensor on one agreement and Licensee on the next.
 *
 * The role vocabulary is the standard transactional set. Pairs are listed
 * together on purpose: a Discloser needs a Recipient, a Licensor a Licensee.
 */
export const LEGAL_PARTY_ROLES = [
  'customer',
  'supplier',
  'licensor',
  'licensee',
  'discloser',
  'recipient',
  'guarantor',
  'other',
];

export const LEGAL_PARTY_ROLE_LABELS: Record<string, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  licensor: 'Licensor',
  licensee: 'Licensee',
  discloser: 'Discloser',
  recipient: 'Recipient',
  guarantor: 'Guarantor',
  other: 'Party',
};

export function legalPartyRoleLabel(value?: string | null): string {
  return LEGAL_PARTY_ROLE_LABELS[value ?? ''] ?? value ?? 'Party';
}

export const LegalPartyRoleEnum = enumField(StringField, {
  options: LEGAL_PARTY_ROLES.map((value) => ({
    value,
    label: LEGAL_PARTY_ROLE_LABELS[value],
  })),
  displayName: 'Party Role',
});

export class LegalPartyRoleField extends FieldDef {
  static displayName = 'Legal Party Role';
  static icon = BuildingIcon;

  @field role = contains(LegalPartyRoleEnum);
  @field entity = linksTo(() => LegalEntity);
  /** How the clauses name this party — "the Supplier", "Licensee". */
  @field definedTerm = contains(StringField);

  @field roleLabel = contains(StringField, {
    computeVia: function (this: LegalPartyRoleField) {
      return this.definedTerm?.trim() || legalPartyRoleLabel(this.role);
    },
  });

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='lp-atom'>
        {{#if @model.entity}}
          <span class='lp-name'>{{@model.entity.legalName}}</span>
        {{else}}
          <span class='lp-name lp-missing'>Entity not set</span>
        {{/if}}
        <StatePill @label={{@model.roleLabel}} @chrome={{true}} />
      </span>
      <style scoped>
        .lp-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          min-width: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
        }
        .lp-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lp-missing {
          font-weight: 400;
          font-style: italic;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='lp'>
        <div class='lp-role'>
          <BuildingIcon class='lp-icon' role='presentation' />
          <span class='lp-role-label'>{{@model.roleLabel}}</span>
        </div>
        {{#if @model.entity}}
          {{! Attribute-only on purpose: mounting the linked card's own
              embedded format here nests a themed card container inside a
              prerendered isolated view, which trips Glimmer's backtracking
              assertion (hasTheme) during indexing. The party line needs
              four facts, not a component. }}
          <div class='lp-entity'>
            <span class='lp-name'>{{@model.entity.legalName}}</span>
            <span class='lp-meta'>
              {{#if @model.entity.entityType}}{{@model.entity.entityType}}{{/if}}
              {{#if @model.entity.jurisdiction}}· {{@model.entity.jurisdiction}}{{/if}}
            </span>
            {{#if @model.entity.registrationNumber}}
              <span class='lp-reg'>{{@model.entity.registrationNumber}}</span>
            {{/if}}
          </div>
        {{else}}
          <p class='lp-missing'>No legal entity linked — the clauses have a
            role with nobody behind it.</p>
        {{/if}}
      </div>
      <style scoped>
        .lp {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          min-width: 0;
        }
        .lp-role {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .lp-icon {
          width: 14px;
          height: 14px;
          flex: none;
        }
        .lp-entity {
          min-width: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.1rem 0.75rem;
          padding: 0.55rem 0.7rem;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm, 4px);
          background: var(--muted, var(--boxel-100));
        }
        .lp-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lp-meta {
          grid-column: 1;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          text-transform: capitalize;
        }
        .lp-reg {
          grid-column: 2;
          grid-row: 1 / span 2;
          align-self: center;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .lp-missing {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-style: italic;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

/** Edit — capacity first, then who; the defined term as an aside. Computed
 *  `roleLabel` is not shown (the default edit would print it read-only). */
LegalPartyRoleField.edit = class Edit extends Component<typeof LegalPartyRoleField> {
  <template>
    <div class='lp-edit'>
      <FieldContainer @label='Capacity' @vertical={{true}}>
        <@fields.role />
      </FieldContainer>
      <FieldContainer @label='Legal entity' @vertical={{true}}>
        <@fields.entity />
      </FieldContainer>
      <FieldContainer @label='Defined term in the clauses (optional)' @vertical={{true}}>
        <@fields.definedTerm />
      </FieldContainer>
    </div>
    <style scoped>
      .lp-edit {
        container-type: inline-size;
        display: grid;
        grid-template-columns: minmax(8rem, 1fr) minmax(0, 2fr);
        gap: var(--boxel-sp-xs) var(--boxel-sp-sm);
        align-items: start;
      }
      .lp-edit > :last-child {
        grid-column: 1 / -1;
      }
      @container (max-width: 420px) {
        .lp-edit {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
};

export default LegalPartyRoleField;
