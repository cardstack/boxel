import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import TextAreaField from '@cardstack/base/text-area';
import GavelIcon from '@cardstack/boxel-icons/gavel';
import { FieldContainer } from '@cardstack/boxel-ui/components';

/**
 * Governing Law (GL) — which law reads the contract, and where a dispute is
 * heard.
 *
 * Two different questions that get conflated on a term sheet: the governing
 * law says whose rules apply to the words; the venue says whose court you sit
 * in. "English law, Singapore arbitration" is a perfectly ordinary pairing,
 * which is why they are two fields rather than one.
 *
 * Deliberately a plain string pair rather than a Country link: jurisdictions
 * are sub-national ("Delaware", "England & Wales", "New South Wales") and
 * venues are often institutions ("ICC Paris", "SIAC") rather than places.
 */
export function governingLawLabel(
  jurisdiction?: string | null,
  venue?: string | null,
): string {
  let j = jurisdiction?.trim();
  let v = venue?.trim();
  if (j && v) return `${j} / ${v}`;
  return j || v || '—';
}

export class GoverningLawField extends FieldDef {
  static displayName = 'Governing Law';
  static icon = GavelIcon;

  /** Whose law reads the words — "Germany", "Delaware", "England & Wales". */
  @field jurisdiction = contains(StringField);
  /** Where a dispute is heard — a court seat or an arbitral institution. */
  @field venue = contains(StringField);
  /** Escalation ladder, arbitration rules, language of proceedings. */
  @field notes = contains(TextAreaField);

  @field label = contains(StringField, {
    computeVia: function (this: GoverningLawField) {
      return governingLawLabel(this.jurisdiction, this.venue);
    },
  });

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='gl-chip' title={{@model.notes}}>
        <GavelIcon class='gl-icon' role='presentation' />
        <span class='gl-text'>{{@model.label}}</span>
      </span>
      <style scoped>
        .gl-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.15em 0.55em;
          border-radius: 999px;
          border: 1px solid var(--border, var(--boxel-200));
          background: var(--muted, var(--boxel-100));
          color: var(--foreground, var(--boxel-dark));
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          letter-spacing: 0.01em;
          white-space: nowrap;
          max-width: 100%;
          min-width: 0;
        }
        .gl-icon {
          width: 12px;
          height: 12px;
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .gl-text {
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='gl'>
        <GavelIcon class='gl-icon' role='presentation' />
        <div class='gl-body'>
          <dl class='gl-grid'>
            <dt>Governing law</dt>
            <dd>{{if @model.jurisdiction @model.jurisdiction '—'}}</dd>
            <dt>Venue</dt>
            <dd>{{if @model.venue @model.venue '—'}}</dd>
          </dl>
          {{#if @model.notes}}
            <p class='gl-notes'>{{@model.notes}}</p>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .gl {
          display: flex;
          gap: 0.6rem;
          align-items: flex-start;
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
        }
        .gl-icon {
          width: 18px;
          height: 18px;
          flex: none;
          margin-top: 0.1rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .gl-body {
          min-width: 0;
          flex: 1;
        }
        .gl-grid {
          margin: 0;
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: 0.2rem 0.75rem;
        }
        .gl-grid dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .gl-grid dd {
          margin: 0;
          font-weight: 600;
        }
        .gl-notes {
          margin: 0.4rem 0 0;
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.5;
          white-space: pre-line;
        }
      </style>
    </template>
  };
}

/** Edit — the two questions side by side, notes below; computed `label` hidden. */
GoverningLawField.edit = class Edit extends Component<typeof GoverningLawField> {
  <template>
    <div class='gl-edit'>
      <FieldContainer @label='Governing law (whose law reads the words)' @vertical={{true}}>
        <@fields.jurisdiction />
      </FieldContainer>
      <FieldContainer @label='Venue (where a dispute is heard)' @vertical={{true}}>
        <@fields.venue />
      </FieldContainer>
      <FieldContainer @label='Dispute procedure, rules, language' @vertical={{true}}>
        <@fields.notes />
      </FieldContainer>
    </div>
    <style scoped>
      .gl-edit {
        container-type: inline-size;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-xs) var(--boxel-sp-sm);
        align-items: start;
      }
      .gl-edit > :last-child {
        grid-column: 1 / -1;
      }
      @container (max-width: 420px) {
        .gl-edit {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
};

export default GoverningLawField;
