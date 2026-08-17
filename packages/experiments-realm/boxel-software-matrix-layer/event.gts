import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import DateTimeField from '@cardstack/base/datetime';
import MarkdownField from '@cardstack/base/markdown';
import CalendarEventIcon from '@cardstack/boxel-icons/calendar-event';

import { Location } from './location';
import CapacityField from './capacity-field';
import { statusField } from './status-field';

/**
 * Event lifecycle. Draft is unannounced planning; Scheduled is public;
 * Live only matters to consumers that render "happening now"; Cancelled can
 * be reinstated (postponements do exactly this), Completed cannot un-happen.
 */
export const EventStatusField = statusField({
  displayName: 'Event Status',
  options: [
    { value: 'Draft', hue: 'slate', meaning: 'Being planned — not public' },
    { value: 'Scheduled', hue: 'teal', meaning: 'Announced and upcoming' },
    { value: 'Live', hue: 'green', meaning: 'Happening now' },
    {
      value: 'Completed',
      hue: 'slate',
      meaning: 'Took place',
      terminal: true,
      holds: true,
    },
    {
      value: 'Cancelled',
      hue: 'red',
      meaning: 'Called off — can be reinstated',
      holds: true,
    },
  ],
  transitions: {
    Draft: ['Scheduled', 'Cancelled'],
    Scheduled: ['Live', 'Completed', 'Cancelled'],
    Live: ['Completed'],
    Cancelled: ['Scheduled'],
  },
});

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function datePart(value?: Date | null): { day: string; month: string } | null {
  if (!value) {
    return null;
  }
  let d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return { day: String(d.getDate()), month: MONTHS[d.getMonth()] };
}

/**
 * Something that happens at a time, usually at a place, usually with an
 * audience — the generic block. What KIND of happening (a match, a gig, an
 * open day) is the consumer's `kind` label; the domain's extras (opponent,
 * headliner, home/away) live on the consumer's extending card.
 *
 * `capacity` is the configured ceiling and its named slices (see the
 * Capacity spec); how much is booked against it is live Booking data the
 * consumer queries. `startsAt`/`endsAt` are instants (DateTimeFields) — an
 * all-day event is one whose consumer chose not to render the times.
 */
export class Event extends CardDef {
  static displayName = 'Event';
  static icon = CalendarEventIcon;

  @field title = contains(StringField);
  @field kind = contains(StringField);
  @field startsAt = contains(DateTimeField);
  @field endsAt = contains(DateTimeField);
  @field venue = linksTo(Location);
  @field capacity = contains(CapacityField);
  @field status = contains(EventStatusField);
  @field description = contains(MarkdownField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Event) {
      return this.title?.trim()?.length
        ? this.title
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Event> {
    <template>
      <span class='ev-atom'>
        <CalendarEventIcon class='ev-icon' />
        <span class='ev-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .ev-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.8125rem;
          font-weight: 500;
        }
        .ev-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: var(--muted-foreground, #6b7280);
        }
        .ev-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Event> {
    get date() {
      return datePart(this.args.model.startsAt);
    }
    <template>
      <div class='ev'>
        <div class='ev-date'>
          {{#if this.date}}
            <span class='ev-day'>{{this.date.day}}</span>
            <span class='ev-month'>{{this.date.month}}</span>
          {{else}}
            <span class='ev-day ev-tbd'>?</span>
            <span class='ev-month'>TBD</span>
          {{/if}}
        </div>
        <div class='ev-info'>
          <span class='ev-title'>{{@model.cardTitle}}</span>
          <span class='ev-meta'>
            {{#if @model.startsAt}}<@fields.startsAt />{{/if}}
            {{#if @model.venue.name}}· {{@model.venue.name}}{{/if}}
          </span>
        </div>
        <span class='ev-status'>
          {{#if @model.status}}<@fields.status @format='atom' />{{/if}}
        </span>
      </div>
      <style scoped>
        .ev {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.875rem;
        }
        /* The date block is the row's anchor: events are found by date
           first, name second. */
        .ev-date {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 2.75rem;
          height: 2.75rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          background: var(--muted, #f3f4f6);
          flex-shrink: 0;
        }
        .ev-day {
          font-size: 1rem;
          font-weight: 700;
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
        }
        .ev-tbd {
          color: var(--muted-foreground, #6b7280);
        }
        .ev-month {
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, #6b7280);
        }
        .ev-info {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .ev-title {
          font-weight: 600;
          font-size: 0.875rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ev-meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Constant-width slot so event rows column-align whether or not a
           status is set. */
        .ev-status {
          width: 5.75rem;
          display: inline-flex;
          justify-content: flex-end;
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Event> {
    get date() {
      return datePart(this.args.model.startsAt);
    }
    <template>
      <div class='fitted'>
        <div class='ev-date'>
          {{#if this.date}}
            <span class='ev-day'>{{this.date.day}}</span>
            <span class='ev-month'>{{this.date.month}}</span>
          {{else}}
            <span class='ev-day ev-tbd'>?</span>
            <span class='ev-month'>TBD</span>
          {{/if}}
        </div>
        <div class='info'>
          <span class='title'>{{@model.cardTitle}}</span>
          {{#if @model.kind}}
            <span class='meta line-kind'>{{@model.kind}}</span>
          {{/if}}
          {{#if @model.startsAt}}
            <span class='meta line-when'><@fields.startsAt /></span>
          {{/if}}
          {{#if @model.status}}
            <span class='line-status'><@fields.status @format='atom' /></span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .fitted {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
        }
        .ev-date {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 2.5rem;
          height: 2.5rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          background: var(--muted, #f3f4f6);
          flex-shrink: 0;
        }
        .ev-day {
          font-size: 0.9375rem;
          font-weight: 700;
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
        }
        .ev-tbd {
          color: var(--muted-foreground, #6b7280);
        }
        .ev-month {
          font-size: 0.5rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, #6b7280);
        }
        .info {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
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
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-kind,
        .line-when,
        .line-status {
          display: none;
        }
        /* Badge degradation: strip height keeps only the first line. */
        @container fitted-card (max-height: 50px) {
          .fitted {
            padding: 0.25rem 0.5rem;
            gap: 0.125rem;
          }
        }
        @container fitted-card (min-height: 65px) {
          .line-when {
            display: block;
          }
        }
        @container fitted-card (min-height: 170px) {
          .fitted {
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            padding: 0.875rem;
          }
          .line-kind {
            display: block;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .line-status {
            display: inline-flex;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Event> {
    <template>
      <article class='ev-page'>
        <header class='eh'>
          <div class='eh-id'>
            <p class='doc-kind'>{{if @model.kind @model.kind 'Event'}}</p>
            <h1>{{@model.cardTitle}}</h1>
            <p class='eh-when'>
              {{#if @model.startsAt}}
                <@fields.startsAt />
                {{#if @model.endsAt}}&nbsp;–&nbsp;<@fields.endsAt />{{/if}}
              {{else}}
                Date to be announced
              {{/if}}
            </p>
          </div>
          {{#if @model.status}}
            <span class='eh-status'><@fields.status @format='embedded' /></span>
          {{/if}}
        </header>
        {{#if @model.venue}}
          <section class='panel'>
            <h2>Venue</h2>
            <div class='venue'><@fields.venue @format='embedded' /></div>
          </section>
        {{/if}}
        {{#if @model.capacity.total}}
          <section class='panel'>
            <h2>Capacity</h2>
            <@fields.capacity @format='embedded' />
          </section>
        {{/if}}
        {{#if @model.description}}
          <section class='panel'>
            <h2>About</h2>
            <div class='about'><@fields.description /></div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .ev-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .eh {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .eh-id {
          flex: 1;
          min-width: 0;
        }
        .doc-kind {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.625rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .eh-when {
          margin: 0.25rem 0 0;
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .eh-status {
          flex-shrink: 0;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .venue {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
        }
        .about {
          font-size: 0.875rem;
          line-height: 1.6;
        }
      </style>
    </template>
  };
}
