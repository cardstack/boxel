import {
  Component,
  contains,
  field,
  StringField,
} from '@cardstack/base/card-api';
import enumField from '@cardstack/base/enum';
import { htmlSafe } from '@ember/template';
import BallFootballIcon from '@cardstack/boxel-icons/ball-football';

import { Event, datePart } from '../event';
import CountField from '../count-field';

export const HomeAwayField = enumField(StringField, {
  displayName: 'Home / Away',
  options: [
    { value: 'Home', label: 'Home' },
    { value: 'Away', label: 'Away' },
  ],
});

export const CompetitionField = enumField(StringField, {
  displayName: 'Competition',
  options: ['League', 'Cup', 'Friendly'],
});

function concatPercent(n: number): string {
  return `${n}% sold`;
}

function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function eqAway(value?: string): boolean {
  return value === 'Away';
}

function soldStats(
  model: Match,
):
  | { sold: number; total: number; percent: number; soldOut: boolean }
  | undefined {
  let total = model.capacity?.total;
  if (!total || total <= 0) {
    return undefined;
  }
  let sold = model.ticketsSold ?? 0;
  let percent = Math.min(100, Math.round((sold / total) * 100));
  return { sold, total, percent, soldOut: sold >= total };
}

/**
 * A fixture IS an Event — the club adds who we play, where we stand in the
 * tie, and the ops-maintained sales tally. `capacity` (the ceiling and its
 * allocations), venue, kickoff and status are consumed unchanged from the
 * block.
 *
 * `ticketsSold` is the box office's own running total (it includes season
 * tickets and sales outside this system), which is why it is a stored
 * baseline the ops team maintains rather than a count of Booking cards.
 */
export class Match extends Event {
  static displayName = 'Match';
  static icon = BallFootballIcon;

  @field opponent = contains(StringField);
  @field homeAway = contains(HomeAwayField);
  @field competition = contains(CompetitionField);
  @field ticketsSold = contains(CountField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Match) {
      if (this.opponent?.trim()?.length) {
        return `${this.homeAway === 'Away' ? 'at' : 'v'} ${this.opponent}`;
      }
      return this.title?.trim()?.length ? this.title : 'Untitled Match';
    },
  });

  static atom = class Atom extends Component<typeof Match> {
    <template>
      <span class='ma-atom'>
        <BallFootballIcon class='ma-icon' />
        <span class='ma-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .ma-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.8125rem;
          font-weight: 500;
        }
        .ma-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: var(--muted-foreground, #6b7280);
        }
        .ma-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Match> {
    get date() {
      return datePart(this.args.model.startsAt);
    }
    get sold() {
      return soldStats(this.args.model as Match);
    }
    <template>
      <div class='ma'>
        <div class='ma-date'>
          {{#if this.date}}
            <span class='ma-day'>{{this.date.day}}</span>
            <span class='ma-month'>{{this.date.month}}</span>
          {{else}}
            <span class='ma-day ma-tbd'>?</span>
            <span class='ma-month'>TBD</span>
          {{/if}}
        </div>
        <div class='ma-info'>
          <span class='ma-title'>{{@model.cardTitle}}</span>
          <span class='ma-meta'>
            {{#if @model.homeAway}}<span
                class='ha ha-{{@model.homeAway}}'
              >{{@model.homeAway}}</span>{{/if}}
            {{#if @model.competition}}{{@model.competition}}{{/if}}
            {{#if @model.venue.name}}· {{@model.venue.name}}{{/if}}
          </span>
        </div>
        {{#if this.sold}}
          <span class='ma-sold {{if this.sold.soldOut "out"}}'>{{if
              this.sold.soldOut
              'SOLD OUT'
              (concatPercent this.sold.percent)
            }}</span>
        {{/if}}
      </div>
      <style scoped>
        .ma {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.875rem;
        }
        .ma-date {
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
        .ma-day {
          font-size: 1rem;
          font-weight: 700;
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
        }
        .ma-tbd {
          color: var(--muted-foreground, #6b7280);
        }
        .ma-month {
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, #6b7280);
        }
        .ma-info {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .ma-title {
          font-weight: 600;
          font-size: 0.875rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ma-meta {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          white-space: nowrap;
        }
        .ha {
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.0625rem 0.375rem;
          border-radius: 999px;
        }
        .ha-Home {
          background: var(--tier-gold-bg, #fef3c7);
          color: var(--tier-gold-fg, #92400e);
        }
        .ha-Away {
          background: var(--muted, #ede9fe);
          color: var(--muted-foreground, #5b21b6);
        }
        .ma-sold {
          font-size: 0.6875rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .ma-sold.out {
          color: var(--destructive, #b91c1c);
          letter-spacing: 0.04em;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Match> {
    get date() {
      return datePart(this.args.model.startsAt);
    }
    get sold() {
      return soldStats(this.args.model as Match);
    }
    get soldBarStyle() {
      return htmlSafe(`width: ${this.sold?.percent ?? 0}%`);
    }
    <template>
      <div class='fitted'>
        <div class='ma-date'>
          {{#if this.date}}
            <span class='ma-day'>{{this.date.day}}</span>
            <span class='ma-month'>{{this.date.month}}</span>
          {{else}}
            <span class='ma-day ma-tbd'>?</span>
            <span class='ma-month'>TBD</span>
          {{/if}}
        </div>
        <div class='info'>
          <span class='title'>{{@model.cardTitle}}</span>
          <span class='meta line-comp'>
            {{#if @model.homeAway}}{{@model.homeAway}}{{/if}}
            {{#if @model.competition}}· {{@model.competition}}{{/if}}
          </span>
          <span class='meta line-when'>
            {{#if @model.startsAt}}<@fields.startsAt />{{/if}}
          </span>
          {{#if this.sold}}
            <span class='line-sold'>
              <span class='sold-bar'><span
                  class='sold-fill {{if this.sold.soldOut "out"}}'
                  style={{this.soldBarStyle}}
                ></span></span>
              <span class='sold-label'>
                {{if
                  this.sold.soldOut
                  'SOLD OUT'
                  (concatPercent this.sold.percent)
                }}
              </span>
            </span>
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
        .ma-date {
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
        .ma-day {
          font-size: 0.9375rem;
          font-weight: 700;
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
        }
        .ma-tbd {
          color: var(--muted-foreground, #6b7280);
        }
        .ma-month {
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
        .line-comp,
        .line-when,
        .line-sold {
          display: none;
        }
        /* Badge degradation: at strip height there is only room for the
           date anchor and the opponent. */
        @container fitted-card (max-height: 50px) {
          .fitted {
            padding: 0.25rem 0.5rem;
            gap: 0.5rem;
          }
          .ma-date {
            width: 2rem;
            height: 2rem;
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
          .line-comp {
            display: block;
          }
          .line-sold {
            display: flex;
            align-items: center;
            gap: 0.375rem;
            width: 100%;
          }
        }
        .sold-bar {
          flex: 1;
          height: 0.3125rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          overflow: hidden;
          display: inline-block;
        }
        .sold-fill {
          display: block;
          height: 100%;
          border-radius: 999px;
          background: var(--primary, #16a34a);
        }
        .sold-fill.out {
          background: var(--destructive, #b91c1c);
        }
        .sold-label {
          font-size: 0.625rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Match> {
    get sold() {
      return soldStats(this.args.model as Match);
    }
    get soldBarStyle() {
      return htmlSafe(`width: ${this.sold?.percent ?? 0}%`);
    }
    <template>
      <article class='ma-page'>
        <header class='mh'>
          <div class='mh-id'>
            <p class='doc-kind'>
              {{if @model.competition @model.competition 'Fixture'}}
              {{#if @model.homeAway}}·
                <span
                  class='ha ha-{{@model.homeAway}}'
                >{{@model.homeAway}}</span>{{/if}}
            </p>
            <h1 class='duel'>
              {{#if @model.opponent}}
                <span class='duel-vs'>{{if
                    (eqAway @model.homeAway)
                    'at'
                    'v'
                  }}</span>
                {{@model.opponent}}
              {{else}}
                {{@model.cardTitle}}
              {{/if}}
            </h1>
            <p class='mh-when'>
              {{#if @model.startsAt}}
                <@fields.startsAt />
                {{#if @model.endsAt}}&nbsp;–&nbsp;<@fields.endsAt />{{/if}}
              {{else}}
                Kickoff to be announced
              {{/if}}
            </p>
          </div>
          {{#if @model.status}}
            <span class='mh-status'><@fields.status @format='embedded' /></span>
          {{/if}}
        </header>

        {{#if this.sold}}
          <section class='panel sales'>
            <h2>Box office</h2>
            <div class='sold-row'>
              <span class='sold-big {{if this.sold.soldOut "out"}}'>
                {{if
                  this.sold.soldOut
                  'SOLD OUT'
                  (concatPercent this.sold.percent)
                }}
              </span>
              <span class='sold-detail'>{{formatCount this.sold.sold}}
                of
                {{formatCount this.sold.total}}
                {{if @model.capacity.unit @model.capacity.unit 'seats'}}
                sold</span>
            </div>
            <div class='sold-bar'>
              <div
                class='sold-fill {{if this.sold.soldOut "out"}}'
                style={{this.soldBarStyle}}
              ></div>
            </div>
            {{#if @model.capacity.total}}
              <div class='alloc'>
                <@fields.capacity @format='embedded' />
              </div>
            {{/if}}
          </section>
        {{else if @model.capacity.total}}
          <section class='panel'>
            <h2>Capacity</h2>
            <@fields.capacity @format='embedded' />
          </section>
        {{/if}}

        {{#if @model.venue}}
          <section class='panel'>
            <h2>Venue</h2>
            <div class='venue'><@fields.venue @format='embedded' /></div>
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
        .ma-page {
          max-width: 44rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .mh {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .mh-id {
          flex: 1;
          min-width: 0;
        }
        .doc-kind {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        .ha {
          font-size: 0.5625rem;
          font-weight: 700;
          padding: 0.0625rem 0.4375rem;
          border-radius: 999px;
          letter-spacing: 0.06em;
        }
        .ha-Home {
          background: var(--tier-gold-bg, #fef3c7);
          color: var(--tier-gold-fg, #92400e);
        }
        .ha-Away {
          background: var(--muted, #ede9fe);
          color: var(--muted-foreground, #5b21b6);
        }
        .duel {
          margin: 0;
          font-size: 2rem;
          line-height: 1.05;
          font-family: var(--font-heading, inherit);
        }
        .duel-vs {
          font-size: 1.125rem;
          font-weight: 500;
          color: var(--muted-foreground, #6b7280);
          margin-right: 0.25rem;
        }
        .mh-when {
          margin: 0.375rem 0 0;
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .mh-status {
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
        .sold-row {
          display: flex;
          align-items: baseline;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }
        .sold-big {
          font-size: 1.75rem;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }
        .sold-big.out {
          color: var(--destructive, #b91c1c);
          letter-spacing: 0.03em;
        }
        .sold-detail {
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
        }
        .sold-bar {
          height: 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          overflow: hidden;
          margin-bottom: 0.875rem;
        }
        .sold-fill {
          height: 100%;
          border-radius: 999px;
          background: var(--primary, #16a34a);
          transition: width 0.4s ease-out;
        }
        .sold-fill.out {
          background: var(--destructive, #b91c1c);
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
