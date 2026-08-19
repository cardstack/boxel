import {
  BooleanField,
  CardDef,
  Component,
  contains,
  field,
  NumberField,
  StringField,
} from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import RepeatIcon from '@cardstack/boxel-icons/repeat';

import {
  CadenceField,
  PlatformField,
  cadenceStyle,
  platformStyle,
} from './content-fields';

export const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const DayOfWeekField = enumField(NumberField, {
  options: WEEKDAYS,
  displayName: 'Day of Week',
});

export function weekdayLabel(day?: number | null): string | undefined {
  return WEEKDAYS.find((d) => d.value === day)?.label;
}

// "07:30" → [7, 30]; anything unparseable posts at 09:00 rather than midnight,
// which would read as "the day before" in most timezones.
function parseTimeOfDay(value?: string | null): [number, number] {
  let match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) {
    return [9, 0];
  }
  let hours = Math.min(23, Number(match[1]));
  let minutes = Math.min(59, Number(match[2]));
  return [hours, minutes];
}

export interface SeriesShape {
  cadence?: string | null;
  dayOfWeek?: number | null;
  timeOfDay?: string | null;
}

/**
 * The next `count` slots at or after `from`. Materialization is bounded by the
 * caller because there is no scheduler in the platform — each occurrence is a
 * real card, so an unbounded horizon would mint hundreds.
 */
export function nextOccurrences(
  series: SeriesShape,
  from: Date,
  count: number,
): Date[] {
  let style = cadenceStyle(series.cadence);
  if (!style || count <= 0) {
    return [];
  }
  let [hours, minutes] = parseTimeOfDay(series.timeOfDay);
  let cursor = new Date(from);
  cursor.setHours(hours, minutes, 0, 0);

  if (style.everyDays > 0) {
    let target = series.dayOfWeek ?? cursor.getDay();
    let delta = (target - cursor.getDay() + 7) % 7;
    cursor.setDate(cursor.getDate() + delta);
    if (cursor.getTime() < from.getTime()) {
      cursor.setDate(cursor.getDate() + style.everyDays);
    }
    let out: Date[] = [];
    for (let i = 0; i < count; i++) {
      out.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + style.everyDays);
    }
    return out;
  }

  // Monthly keeps the day-of-month of `from` and steps whole months, so a
  // series never drifts the way a fixed 30-day step does.
  let out: Date[] = [];
  if (cursor.getTime() < from.getTime()) {
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (let i = 0; i < count; i++) {
    out.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

export class ContentSeries extends CardDef {
  static displayName = 'Content Series';
  static icon = RepeatIcon;

  @field title = contains(StringField);
  @field platform = contains(PlatformField);
  @field cadence = contains(CadenceField);
  @field dayOfWeek = contains(DayOfWeekField);
  @field timeOfDay = contains(StringField);
  @field active = contains(BooleanField);

  @field rhythm = contains(StringField, {
    computeVia: function (this: ContentSeries) {
      let cadence = cadenceStyle(this.cadence)?.label;
      if (!cadence) {
        return 'No cadence set';
      }
      let day = weekdayLabel(this.dayOfWeek);
      let time = this.timeOfDay?.trim();
      let parts = [cadence];
      if (day) {
        parts.push(`${day}s`);
      }
      if (time) {
        parts.push(time);
      }
      return parts.join(' · ');
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ContentSeries) {
      return this.title?.trim()?.length ? this.title : 'Untitled series';
    },
  });

  static atom = class Atom extends Component<typeof ContentSeries> {
    <template>
      <span class='series-atom'>
        <RepeatIcon class='sa-icon' />
        <span class='sa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .series-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .sa-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof ContentSeries> {
    get platform() {
      return platformStyle(this.args.model?.platform);
    }
    <template>
      <div class='series-row'>
        <span class='marker'><RepeatIcon class='m-icon' /></span>
        <div class='body'>
          <div class='head'>
            <span class='title'>{{@model.cardTitle}}</span>
            {{#unless @model.active}}
              <span class='paused'>Paused</span>
            {{/unless}}
          </div>
          <div class='meta'>
            <span>{{this.platform.label}}</span>
            <span>· {{@model.rhythm}}</span>
          </div>
        </div>
      </div>
      <style scoped>
        .series-row {
          display: flex;
          align-items: flex-start;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
          color: var(--foreground, var(--boxel-dark));
        }
        .marker {
          display: grid;
          place-items: center;
          width: 1.5rem;
          height: 1.5rem;
          flex: none;
          border-radius: 50%;
          background: var(--muted, var(--boxel-100));
        }
        .m-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .body {
          display: grid;
          gap: 0.2rem;
          min-width: 0;
        }
        .head {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
        }
        .title {
          font-weight: 600;
          font-size: 0.8125rem;
        }
        .paused {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof ContentSeries> {
    get platform() {
      return platformStyle(this.args.model?.platform);
    }
    <template>
      <div class='fitted'>
        <div class='top'>
          <RepeatIcon class='icon' />
          <span class='plat'>{{this.platform.short}}</span>
        </div>
        <span class='title'>{{@model.cardTitle}}</span>
        <span class='meta line-rhythm'>{{@model.rhythm}}</span>
      </div>
      <style scoped>
        .fitted {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.25rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--foreground, var(--boxel-dark));
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .icon {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .plat {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .title {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-rhythm {
          display: none;
        }
        @container fitted-card (min-height: 65px) {
          .line-rhythm {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof ContentSeries> {
    get platform() {
      return platformStyle(this.args.model?.platform);
    }
    <template>
      <article class='series-page'>
        <header class='sh'>
          <span class='marker'><RepeatIcon class='m-icon' /></span>
          <div class='sh-text'>
            <p class='kind'>Recurring series</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
        </header>
        <dl class='facts'>
          <div class='fact'>
            <dt>Platform</dt>
            <dd>{{this.platform.label}}</dd>
          </div>
          <div class='fact'>
            <dt>Rhythm</dt>
            <dd>{{@model.rhythm}}</dd>
          </div>
          <div class='fact'>
            <dt>State</dt>
            <dd>{{if @model.active 'Active' 'Paused'}}</dd>
          </div>
        </dl>
      </article>
      <style scoped>
        .series-page {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .sh {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .marker {
          display: grid;
          place-items: center;
          width: 2.25rem;
          height: 2.25rem;
          flex: none;
          border-radius: 50%;
          background: var(--muted, var(--boxel-100));
        }
        .m-icon {
          width: 18px;
          height: 18px;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .kind {
          margin: 0;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: 0;
          font-size: 1.25rem;
          line-height: 1.25;
        }
        .facts {
          display: grid;
          gap: 0.75rem;
          margin: 0;
          padding-top: var(--boxel-sp);
          border-top: 1px solid var(--border, var(--boxel-200));
        }
        .fact {
          display: grid;
          gap: 0.2rem;
        }
        dt {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        dd {
          margin: 0;
          font-size: 0.875rem;
        }
      </style>
    </template>
  };
}

export default ContentSeries;
