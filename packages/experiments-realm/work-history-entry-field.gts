import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import TextAreaField from '@cardstack/base/text-area';

// One prior job, as reported on a resume (by a human or transcribed by the
// Extract Resume command). Composed as `containsMany` on Candidate so a
// resume's whole employment history round-trips without a linked card per
// job — see candidate.gts's `workHistory` field.
export class WorkHistoryEntryField extends FieldDef {
  static displayName = 'Work History Entry';

  @field company = contains(StringField);
  @field title = contains(StringField);
  @field startDate = contains(DateField);
  @field endDate = contains(DateField);
  @field description = contains(TextAreaField);

  static embedded = class Embedded extends Component<typeof this> {
    get rangeLabel(): string | undefined {
      let start = this.args.model?.startDate;
      let end = this.args.model?.endDate;
      if (!start && !end) {
        return undefined;
      }
      let fmt = (d: Date) =>
        d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      let startLabel = start ? fmt(new Date(start)) : '—';
      let endLabel = end ? fmt(new Date(end)) : 'Present';
      return `${startLabel}–${endLabel}`;
    }

    <template>
      <li class='wh-row'>
        <div class='wh-head'>
          <span class='wh-title'>{{if
              @model.title
              @model.title
              'Untitled role'
            }}</span>
          {{#if @model.company}}
            <span class='wh-at'>at
              {{@model.company}}</span>
          {{/if}}
        </div>
        {{#if this.rangeLabel}}
          <span class='wh-range'>{{this.rangeLabel}}</span>
        {{/if}}
        {{#if @model.description}}
          <p class='wh-desc'>{{@model.description}}</p>
        {{/if}}
      </li>
      <style scoped>
        .wh-row {
          padding: var(--boxel-sp-xs) 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .wh-row:last-child {
          border-bottom: 0;
        }
        .wh-head {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 0.3rem;
        }
        .wh-title {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
        }
        .wh-at {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .wh-range {
          display: block;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
        .wh-desc {
          margin: var(--boxel-sp-4xs) 0 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.5;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
      </style>
    </template>
  };
}
