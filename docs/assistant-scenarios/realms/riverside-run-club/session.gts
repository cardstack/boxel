import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateField from '@cardstack/base/date';
import CalendarDaysIcon from '@cardstack/boxel-icons/calendar-days';
import { Route } from './route';
import { Runner } from './runner';
import { RouteLine, accentStyle, dateParts, kmLabel } from './shared';

export class Session extends CardDef {
  static displayName = 'Session';
  static icon = CalendarDaysIcon;
  @field date = contains(DateField);
  // "Tempo", "Long run", "Hills", "Easy social"
  @field kind = contains(StringField);
  @field startTime = contains(StringField);
  @field route = linksTo(() => Route);
  @field attendees = linksToMany(() => Runner);
  @field weather = contains(StringField);
  @field note = contains(StringField);
  @field turnout = contains(NumberField, {
    computeVia: function (this: Session) {
      return this.attendees?.length ?? 0;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Session) {
      let parts = dateParts(this.date);
      return [this.kind, parts ? `${parts.weekday} ${parts.month} ${parts.day}` : undefined]
        .filter(Boolean)
        .join(' · ');
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: Session) {
      return [
        this.route?.name,
        this.route?.distanceKm != null ? `${kmLabel(this.route.distanceKm)} km` : undefined,
        `${this.attendees?.length ?? 0} ran`,
        this.weather,
      ]
        .filter(Boolean)
        .join(' · ');
    },
  });

  static atom = class Atom extends Component<typeof Session> {
    get date() {
      return dateParts(this.args.model.date);
    }
    <template>
      <span class='session-atom'>
        {{#if this.date}}<span class='date'>{{this.date.month}} {{this.date.day}}</span>{{/if}}
        <span class='kind'>{{@model.kind}}</span>
      </span>
      <style scoped>
        .session-atom {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          max-width: 100%;
        }
        .date {
          flex: none;
          padding: 0 4px;
          border-radius: 3px;
          background: #0d1522;
          color: #f4f1ea;
          font: 600 9px/14px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
        }
        .kind {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Session> {
    get date() {
      return dateParts(this.args.model.date);
    }
    get dots() {
      return Array.from({ length: Math.min(this.args.model.turnout ?? 0, 12) });
    }
    <template>
      <div class='fit-frame'>
        <div class='session-fit' style={{accentStyle 'accent' @model.route.accent '#7fd4b8'}}>
        <div class='when'>
          {{#if this.date}}
            <span class='weekday'>{{this.date.weekday}}</span>
            <span class='day'>{{this.date.day}}</span>
            <span class='month'>{{this.date.month}}</span>
          {{/if}}
        </div>
        <div class='what'>
          <span class='kind'>{{@model.kind}}</span>
          <span class='route'>{{@model.route.name}}{{#if @model.startTime}} · {{@model.startTime}}{{/if}}</span>
          <span class='dots' aria-label='{{@model.turnout}} ran'>
            {{#each this.dots}}<i></i>{{/each}}
            <b>{{@model.turnout}}</b>
          </span>
        </div>
        <RouteLine class='line' @path={{@model.route.path}} @weight={{2}} />
      </div>
      </div>
      <style scoped>
        .fit-frame {
          container: session-fit / size;
          height: 100%;
        }
        .session-fit {
          height: 100%;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: stretch;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }
        .when {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-width: 52px;
          padding: 6px 8px;
          background: #0d1522;
          color: #f4f1ea;
        }
        .weekday,
        .month {
          font: 600 9px/12px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: var(--accent);
        }
        .day {
          font: 900 24px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 75%;
        }
        .what {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
          min-width: 0;
          padding: 8px 10px;
        }
        .kind {
          font-weight: 700;
          font-size: 14px;
          line-height: 18px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .route {
          font-size: 11px;
          line-height: 15px;
          color: #67707d;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dots {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-top: 2px;
        }
        .dots i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #0d1522;
        }
        .dots b {
          margin-inline-start: 4px;
          font: 600 10px/1 'JetBrains Mono', ui-monospace, monospace;
        }
        .line {
          width: 72px;
          padding: 8px 10px 8px 0;
          color: #0d1522;
        }
        @container session-fit (width < 260px) {
          .line {
            display: none;
          }
        }
        /* a tall tile: the date across the top, the session under it */
        @container session-fit (width < 260px) and (height >= 140px) {
          .session-fit {
            grid-template: auto 1fr auto / 1fr;
          }
          .line {
            display: block;
            grid-row: 2;
            width: auto;
            min-height: 0;
            padding: 12px;
          }
          .what {
            grid-row: 3;
          }
          .when {
            flex-direction: row;
            justify-content: flex-start;
            align-items: baseline;
            gap: 6px;
            padding: 10px 12px;
          }
          .day {
            font-size: 30px;
          }
          .what {
            justify-content: flex-end;
          }
          .route {
            white-space: normal;
          }
        }
        @container session-fit (height < 48px) {
          .line,
          .route {
            display: none;
          }
          .when {
            min-width: 40px;
            padding: 4px 6px;
          }
        }
        @container session-fit (height < 60px) {
          .dots,
          .weekday,
          .month {
            display: none;
          }
          .day {
            font-size: 18px;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Session> {
    get date() {
      return dateParts(this.args.model.date);
    }
    <template>
      <article class='session-row' style={{accentStyle 'accent' @model.route.accent '#7fd4b8'}}>
        <div class='when'>
          {{#if this.date}}
            <span class='weekday'>{{this.date.weekday}}</span>
            <span class='day'>{{this.date.day}}</span>
            <span class='month'>{{this.date.month}}</span>
          {{/if}}
        </div>
        <div class='body'>
          <h3>{{@model.kind}}<span>{{@model.startTime}}</span></h3>
          <p class='route'>{{@model.route.name}} · {{kmLabel @model.route.distanceKm}} km{{#if @model.weather}} · {{@model.weather}}{{/if}}</p>
          <div class='who'>
            <span class='count'>{{@model.turnout}} ran</span>
            <@fields.attendees @format='atom' />
          </div>
        </div>
      </article>
      <style scoped>
        .session-row {
          display: grid;
          grid-template-columns: 72px 1fr;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        .when {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 10px;
          background: #0d1522;
          color: #f4f1ea;
        }
        .weekday,
        .month {
          font: 600 10px/14px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: var(--accent);
        }
        .day {
          font: 900 32px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 75%;
        }
        .body {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        h3 {
          margin: 0;
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 16px;
          line-height: 20px;
          font-weight: 700;
        }
        h3 span {
          font: 500 12px 'JetBrains Mono', ui-monospace, monospace;
          color: #67707d;
        }
        .route {
          margin: 0;
          font-size: 12px;
          color: #67707d;
        }
        .who {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px 8px;
          margin-top: 4px;
          font-size: 12px;
        }
        .count {
          font-weight: 700;
        }
        .who :deep(.linksToMany-field) {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 10px;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Session> {
    get date() {
      return dateParts(this.args.model.date);
    }
    <template>
      <article class='session-page' style={{accentStyle 'accent' @model.route.accent '#7fd4b8'}}>
        <header>
          <div class='when'>
            {{#if this.date}}
              <span class='weekday'>{{this.date.weekday}}</span>
              <span class='day'>{{this.date.day}}</span>
              <span class='month'>{{this.date.month}}</span>
            {{/if}}
          </div>
          <div>
            <span class='eyebrow'>Riverside Run Club · Session</span>
            <h1>{{@model.kind}}</h1>
            <p class='meta'>{{@model.startTime}}{{#if @model.weather}} · {{@model.weather}}{{/if}} · {{@model.turnout}} ran</p>
          </div>
        </header>
        {{#if @model.note}}<p class='note'>{{@model.note}}</p>{{/if}}
        {{#if @model.route}}
          <section>
            <h2>Route</h2>
            <div class='framed'><@fields.route @format='embedded' /></div>
          </section>
        {{/if}}
        <section>
          <h2>Who ran</h2>
          <div class='grid'><@fields.attendees @format='fitted' /></div>
        </section>
      </article>
      <style scoped>
        .session-page {
          min-height: 100%;
          box-sizing: border-box;
          padding: 40px 44px;
          display: flex;
          flex-direction: column;
          gap: 26px;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        header {
          display: flex;
          align-items: center;
          gap: 22px;
        }
        .when {
          flex: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 96px;
          height: 108px;
          border-radius: 12px;
          background: #0d1522;
          color: #f4f1ea;
        }
        .weekday,
        .month {
          font: 600 12px/16px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: var(--accent);
        }
        .day {
          font: 900 48px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 70%;
        }
        .eyebrow {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #67707d;
        }
        h1 {
          margin: 4px 0;
          font-family: 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 70%;
          font-weight: 900;
          font-size: 52px;
          line-height: 0.95;
          text-transform: uppercase;
        }
        .meta {
          margin: 0;
          font-size: 14px;
          color: #67707d;
        }
        .note {
          margin: 0;
          max-width: 60ch;
          font-size: 17px;
          line-height: 26px;
        }
        h2 {
          margin: 0 0 8px;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #67707d;
        }
        .framed {
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 0 0 1px #d9d3c7;
        }
        .grid :deep(.linksToMany-field) {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 8px;
        }
        .grid :deep(.field-component-card.fitted-format) {
          height: 56px;
          border-radius: 10px;
          overflow: hidden;
        }
      </style>
    </template>
  };
}
