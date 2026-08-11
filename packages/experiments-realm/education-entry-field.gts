import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';

// One school/degree line from a resume. Composed as `containsMany` on
// Candidate — see candidate.gts's `education` field and
// work-history-entry-field.gts for the sibling employment-history entry.
export class EducationEntryField extends FieldDef {
  static displayName = 'Education Entry';

  @field school = contains(StringField);
  @field degree = contains(StringField);
  @field fieldOfStudy = contains(StringField);
  @field graduationYear = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    get degreeLine(): string | undefined {
      let degree = this.args.model?.degree;
      let study = this.args.model?.fieldOfStudy;
      if (degree && study) {
        return `${degree}, ${study}`;
      }
      return degree || study || undefined;
    }

    <template>
      <li class='ed-row'>
        <div class='ed-head'>
          <span class='ed-school'>{{if
              @model.school
              @model.school
              'Unnamed school'
            }}</span>
          {{#if @model.graduationYear}}
            <span class='ed-year'>{{@model.graduationYear}}</span>
          {{/if}}
        </div>
        {{#if this.degreeLine}}
          <span class='ed-degree'>{{this.degreeLine}}</span>
        {{/if}}
      </li>
      <style scoped>
        .ed-row {
          padding: var(--boxel-sp-xs) 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .ed-row:last-child {
          border-bottom: 0;
        }
        .ed-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.3rem;
        }
        .ed-school {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
        }
        .ed-year {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
        .ed-degree {
          display: block;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}
