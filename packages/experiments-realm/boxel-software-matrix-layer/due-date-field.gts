import { Component } from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import CalendarClockIcon from '@cardstack/boxel-icons/calendar-clock';

import { StatePill } from './components/state-pill';
import type { Hue } from './utils/index';

/**
 * A calendar day something is expected by. The block states calendar facts —
 * how far away the day is, whether it has passed — and nothing else: it cannot
 * know the record completed, was paid, or was cancelled, so a consumer whose
 * lifecycle ends (a paid invoice, a done task) renders the raw date itself
 * instead of mounting these templates, or lives with a truthful "overdue" on a
 * finished record. Serializes exactly like DateField (`YYYY-MM-DD`), so an
 * existing `dueDate: DateField` upgrades in place.
 */
export type Dueness = 'overdue' | 'today' | 'soon' | 'later';

const SOON_DAYS = 7;

/** Whole calendar days from today; negative = past. Local calendar, not UTC instants. */
export function dueDays(value: Date | null | undefined): number | undefined {
  if (!value || Number.isNaN(value.getTime())) {
    return undefined;
  }
  let now = new Date();
  let today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let due = Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return Math.round((due - today) / 86400000);
}

export function dueness(value: Date | null | undefined): Dueness | undefined {
  let days = dueDays(value);
  if (days === undefined) {
    return undefined;
  }
  if (days < 0) {
    return 'overdue';
  }
  if (days === 0) {
    return 'today';
  }
  return days <= SOON_DAYS ? 'soon' : 'later';
}

const DUENESS_HUE: Record<Dueness, Hue> = {
  overdue: 'red',
  today: 'orange',
  soon: 'amber',
  later: 'slate',
};

function phrase(days: number): string {
  if (days < 0) {
    let n = -days;
    return n === 1 ? '1 day overdue' : `${n} days overdue`;
  }
  if (days === 0) {
    return 'due today';
  }
  if (days === 1) {
    return 'due tomorrow';
  }
  return `due in ${days} days`;
}

function shortDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(value);
}

function longDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value);
}

export class DueDateField extends DateField {
  static displayName = 'Due Date';
  static icon = CalendarClockIcon;

  static embedded = class Embedded extends Component<typeof this> {
    get days() {
      return dueDays(this.args.model);
    }
    get date() {
      return this.args.model ? longDate(this.args.model) : undefined;
    }
    get phrase() {
      return this.days === undefined ? undefined : phrase(this.days);
    }
    get hue() {
      let state = dueness(this.args.model);
      return state ? DUENESS_HUE[state] : undefined;
    }
    get isQuiet() {
      // A far-off date is information, not a signal — no pill fill.
      return dueness(this.args.model) === 'later';
    }
    <template>
      {{#if this.date}}
        <span class='due'>
          <span class='date'>{{this.date}}</span>
          <StatePill
            @label={{this.phrase}}
            @hue={{this.hue}}
            @chrome={{this.isQuiet}}
          />
        </span>
      {{else}}
        <span class='unset' aria-label='No due date'>—</span>
      {{/if}}
      <style scoped>
        .due {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .date {
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
        }
        .unset {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get label() {
      return this.args.model ? shortDate(this.args.model) : undefined;
    }
    get title() {
      let days = dueDays(this.args.model);
      return days === undefined ? undefined : phrase(days);
    }
    get hue() {
      let state = dueness(this.args.model);
      return state ? DUENESS_HUE[state] : undefined;
    }
    get isQuiet() {
      return dueness(this.args.model) === 'later';
    }
    <template>
      {{#if this.label}}
        <span title={{this.title}}>
          <StatePill
            @label={{this.label}}
            @hue={{this.hue}}
            @chrome={{this.isQuiet}}
          />
        </span>
      {{else}}
        <span class='unset' aria-label='No due date'>—</span>
      {{/if}}
      <style scoped>
        .unset {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

export default DueDateField;
