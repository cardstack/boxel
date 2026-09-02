import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';

// Generic Records-lane block: the lifecycle stamps any record card carries —
// when it was created, activated, suspended, archived, last reviewed. Each
// stamp is an event fact written once by whatever command owns that
// transition; the computed `latestTransition` gives list rows a one-liner
// ("activated Aug 12") without every consumer re-deriving which stamp is
// most recent. Deliberately domain-neutral: nothing here knows what kind of
// record it sits on.

const STAMPS: { key: keyof LifecycleDatesField & string; label: string }[] = [
  { key: 'createdAt', label: 'created' },
  { key: 'activatedAt', label: 'activated' },
  { key: 'suspendedAt', label: 'suspended' },
  { key: 'archivedAt', label: 'archived' },
  { key: 'lastReviewedAt', label: 'reviewed' },
];

function fmt(d?: Date | null): string {
  return d
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
}

export class LifecycleDatesField extends FieldDef {
  static displayName = 'Lifecycle Dates';

  @field createdAt = contains(DateTimeField);
  @field activatedAt = contains(DateTimeField);
  @field suspendedAt = contains(DateTimeField);
  @field archivedAt = contains(DateTimeField);
  @field lastReviewedAt = contains(DateTimeField);

  @field latestTransition = contains(StringField, {
    computeVia: function (this: LifecycleDatesField) {
      let latest: { label: string; at: Date } | undefined;
      for (let s of STAMPS) {
        let at = this[s.key] as Date | undefined;
        if (at && (!latest || at > latest.at)) {
          latest = { label: s.label, at };
        }
      }
      return latest ? `${latest.label} ${fmt(latest.at)}` : '';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get stamps() {
      let m = this.args.model;
      return STAMPS.map((s) => ({
        label: s.label,
        value: fmt(m?.[s.key] as Date | undefined),
      })).filter((s) => s.value);
    }
    <template>
      <div class='lifecycle'>
        {{#each this.stamps as |s|}}
          <span class='stamp'><span class='stamp-label'>{{s.label}}</span>
            {{s.value}}</span>
        {{else}}
          <span class='empty'>no lifecycle events yet</span>
        {{/each}}
      </div>
      <style scoped>
        .lifecycle {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
          font-size: 0.8125rem;
          font-variant-numeric: tabular-nums;
        }
        .stamp-label {
          color: var(--muted-foreground, var(--boxel-450));
          margin-right: 3px;
        }
        .empty {
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='lifecycle-atom'>{{@model.latestTransition}}</span>
      <style scoped>
        .lifecycle-atom {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };
}

export default LifecycleDatesField;
