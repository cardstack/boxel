import {
  Component,
  FieldDef,
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import CalendarClockIcon from '@cardstack/boxel-icons/calendar-clock';

// A delivery date is a calendar day, not an instant. Reading it back with
// toISOString() shifts it a day west of UTC, so every day here is read with
// getFullYear/getMonth/getDate and formatted locally.
function dayLabel(d: Date | undefined | null, withYear = false) {
  if (!d) {
    return undefined;
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toLocaleDateString(
    undefined,
    {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    },
  );
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Delivery Window (DW) — the promise made to the customer, as a range rather
// than a single date, because that is what carriers actually quote ("2–3 days").
// A single-day promise is expressed by setting only `latest`.
export class DeliveryWindowField extends FieldDef {
  static displayName = 'Delivery Window';
  static icon = CalendarClockIcon;

  @field earliest = contains(DateField);
  @field latest = contains(DateField);
  // The carrier's own name for the promise — "Tracked 48", "NextDay". The block
  // does not know any service names; the consumer stamps this on.
  @field commitment = contains(StringField);

  @field label = contains(StringField, {
    computeVia: function (this: DeliveryWindowField) {
      let from = dayLabel(this.earliest);
      let to = dayLabel(this.latest);
      if (from && to && from !== to) {
        return `${from} – ${to}`;
      }
      return to ?? from;
    },
  });

  // Days remaining is deliberately a getter, not a computed field: it depends
  // on today, and a field that silently changes value every midnight would make
  // the index disagree with itself.
  get daysRemaining(): number | undefined {
    let target = this.latest ?? this.earliest;
    if (!target) {
      return undefined;
    }
    let today = startOfDay(new Date());
    return Math.round((startOfDay(target) - today) / 86400000);
  }

  get isToday() {
    return this.daysRemaining === 0;
  }

  get isOverdue() {
    let d = this.daysRemaining;
    return d != null && d < 0;
  }

  // Short form for a fitted card's meta row, where "Wed 15 Mar" does not fit.
  get relativeLabel(): string | undefined {
    let d = this.daysRemaining;
    if (d == null) {
      return undefined;
    }
    if (d === 0) {
      return 'Today';
    }
    if (d === 1) {
      return 'Tomorrow';
    }
    if (d < 0) {
      return `${Math.abs(d)}d overdue`;
    }
    return `in ${d}d`;
  }

  static atom = class Atom extends Component<typeof DeliveryWindowField> {
    <template>
      {{#if @model.label}}
        <span class='dw-atom {{if @model.isOverdue "dw-overdue"}}'>
          {{@model.relativeLabel}}
        </span>
      {{else}}
        <span class='dw-atom dw-empty'>No ETA</span>
      {{/if}}

      <style scoped>
        .dw-atom {
          font-size: 0.85em;
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          white-space: nowrap;
        }
        .dw-empty {
          font-weight: 400;
          color: var(--muted-foreground, var(--boxel-400));
        }
        /* Overdue is the one state worth colouring: it is the only one that
           needs someone to do something. */
        .dw-overdue {
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 62%,
            var(--foreground, var(--boxel-dark))
          );
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<
    typeof DeliveryWindowField
  > {
    <template>
      {{#if @model.label}}
        <div class='dw'>
          <span class='dw-label'>{{@model.label}}</span>
          {{#if @model.relativeLabel}}
            <span
              class='dw-rel {{if @model.isOverdue "dw-overdue"}}'
            >{{@model.relativeLabel}}</span>
          {{/if}}
          {{#if @model.commitment}}
            <span class='dw-commit'>{{@model.commitment}}</span>
          {{/if}}
        </div>
      {{else}}
        <span class='dw-empty'>No delivery window quoted</span>
      {{/if}}

      <style scoped>
        .dw {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xxs);
        }
        .dw-label {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .dw-rel {
          font-size: 0.8rem;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .dw-overdue {
          font-weight: 700;
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 62%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .dw-commit {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.7rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 1px 6px;
          border-radius: 3px;
          color: var(--muted-foreground, var(--boxel-500));
          background: color-mix(
            in oklch,
            var(--muted-foreground, var(--boxel-500)) 12%,
            transparent
          );
        }
        .dw-empty {
          color: var(--muted-foreground, var(--boxel-400));
          font-size: 0.85rem;
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof DeliveryWindowField> {
    <template>
      <div class='dw-edit'>
        <FieldContainer @label='Earliest' @vertical={{true}}>
          <@fields.earliest />
        </FieldContainer>
        <FieldContainer @label='Latest' @vertical={{true}}>
          <@fields.latest />
        </FieldContainer>
        <FieldContainer @label='Service' @vertical={{true}}>
          <@fields.commitment />
        </FieldContainer>
      </div>

      <style scoped>
        .dw-edit {
          display: grid;
          gap: var(--boxel-sp-xs);
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        }
      </style>
    </template>
  };
}

export default DeliveryWindowField;
