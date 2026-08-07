import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  linksToMany,
  StringField,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import MarkdownField from '@cardstack/base/markdown';
import enumField from '@cardstack/base/enum';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import { htmlSafe } from '@ember/template';

import { ScoreField } from './score-field';
import { DurationField } from './duration-field';
import { Employee } from './trt-employee';
import { Candidate } from './candidate';
import { stateColorOf, type StateColor } from './utils/index';

export const MEETING_TYPES = [
  'interview',
  'one-on-one',
  'standup',
  'vendor-review',
];

// Colocated with Meeting — the same map colors the type badge here and the
// event chips in components/calendar.gts. Harmonized with the Ledger
// identity: interview shares candidate.gts's "interviewing" plum, vendor
// review shares the brass seal color.
export const MEETING_TYPE_COLORS: Record<string, StateColor> = {
  interview: { bg: '#e6dde8', fg: '#4a2f52', ring: '#8a5f96' },
  'one-on-one': { bg: '#dde6da', fg: '#33452f', ring: '#5f7a54' },
  standup: { bg: '#dbe3e6', fg: '#2f4550', ring: '#5f7a85' },
  'vendor-review': { bg: '#f3e2c2', fg: '#6b4a12', ring: '#a9773a' },
};

export const MeetingTypeField = enumField(StringField, {
  options: MEETING_TYPES.map((type) => ({ value: type, label: type })),
  displayName: 'Meeting Type',
});

export class Meeting extends CardDef {
  static displayName = 'Meeting';
  static icon = CalendarIcon;

  @field name = contains(StringField);
  @field meetingType = contains(MeetingTypeField);
  @field date = contains(DateTimeField);
  @field duration = contains(DurationField);
  @field candidate = linksTo(() => Candidate);
  @field interviewers = linksToMany(() => Employee);
  @field interviewScore = contains(ScoreField);
  @field notes = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: Meeting) {
      return this.name?.trim() || 'Untitled Meeting';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get typeColor() {
      return stateColorOf(MEETING_TYPE_COLORS, this.args.model?.meetingType);
    }

    get typePillStyle() {
      return htmlSafe(
        `background: ${this.typeColor.bg}; color: ${this.typeColor.fg};`,
      );
    }

    get accentBarStyle() {
      return htmlSafe(`background: ${this.typeColor.ring};`);
    }

    get dateObj(): Date | undefined {
      let value = this.args.model?.date;
      if (!value) {
        return undefined;
      }
      let date = new Date(value);
      return isNaN(date.getTime()) ? undefined : date;
    }

    get dateDay(): string {
      return this.dateObj ? String(this.dateObj.getDate()) : '–';
    }

    get dateMonth(): string {
      return this.dateObj
        ? this.dateObj
            .toLocaleDateString('en-US', { month: 'short' })
            .toUpperCase()
        : '';
    }

    get timeLabel(): string {
      return this.dateObj
        ? this.dateObj.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })
        : '—';
    }

    get attendees(): Array<{
      role: string;
      title?: string | null;
      initials?: string;
      photoUrl?: string | null;
    }> {
      let list = [];
      let candidate = this.args.model?.candidate;
      if (candidate) {
        list.push({
          role: 'Candidate',
          title: candidate.title,
          initials: candidate.initials,
          photoUrl: candidate.photoUrl,
        });
      }
      for (let interviewer of this.args.model?.interviewers ?? []) {
        if (interviewer) {
          list.push({
            role: 'Interviewer',
            title: interviewer.title,
            initials: interviewer.initials,
            photoUrl: interviewer.photoUrl,
          });
        }
      }
      return list;
    }

    <template>
      <article
        class='meeting-isolated'
      >
        <div class='accent-bar' style={{this.accentBarStyle}}></div>
        <div class='meeting-body'>
          <header class='meeting-header'>
            <div class='date-tile'>
              <span class='date-day'>{{this.dateDay}}</span>
              <span class='date-month'>{{this.dateMonth}}</span>
            </div>
            <div class='header-main'>
              <h1>{{@model.title}}</h1>
              {{#if @model.meetingType}}
                <span class='type' style={{this.typePillStyle}}>
                  {{@model.meetingType}}
                </span>
              {{/if}}
              <p class='time-line'>{{this.timeLabel}}
                ·
                <@fields.duration @format='atom' /></p>
            </div>
            {{#if @model.interviewScore}}
              <div class='score-badge'><@fields.interviewScore /></div>
            {{/if}}
          </header>
          {{#if this.attendees.length}}
            <section class='attendees'>
              <h2>Attendees</h2>
              <ul class='attendee-row'>
                {{#each this.attendees as |person|}}
                  <li class='attendee-chip'>
                    {{#if person.photoUrl}}
                      <img
                        class='attendee-avatar'
                        src={{person.photoUrl}}
                        alt=''
                      />
                    {{else}}
                      <span
                        class='attendee-avatar initials'
                      >{{person.initials}}</span>
                    {{/if}}
                    <span class='attendee-info'>
                      <span class='attendee-name'>{{person.title}}</span>
                      <span class='attendee-role'>{{person.role}}</span>
                    </span>
                  </li>
                {{/each}}
              </ul>
            </section>
          {{/if}}
          {{#if @model.notes}}
            <section>
              <h2>Notes</h2>
              <@fields.notes />
            </section>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .meeting-isolated {
          display: grid;
          grid-template-columns: 0.25rem 1fr;
          height: 100%;
          overflow-y: auto;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          animation: meeting-fade-in 0.2s ease-out;
        }
        @keyframes meeting-fade-in {
          from {
            opacity: 0;
            transform: translateY(0.25rem);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .meeting-isolated {
            animation: none;
          }
        }
        .accent-bar {
          border-radius: var(--boxel-border-radius-sm) 0 0
            var(--boxel-border-radius-sm);
        }
        .meeting-body {
          padding: var(--boxel-sp-lg);
        }
        .meeting-header {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp);
        }
        .date-tile {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 4rem;
          height: 4rem;
          flex: none;
          border-radius: var(--boxel-border-radius);
          background: var(--muted, var(--boxel-100));
          border: 1px solid var(--border, var(--boxel-200));
        }
        .date-day {
          font-family: var(--font-serif, serif);
          font-size: var(--boxel-font-size-lg);
          font-weight: 600;
          line-height: 1;
        }
        .date-month {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .header-main {
          flex: 1;
          min-width: 0;
        }
        h1 {
          margin: 0 0 var(--boxel-sp-5xs);
          font-family: var(--font-serif, serif);
          font-weight: 600;
          font-size: var(--boxel-font-size-lg);
        }
        .type {
          display: inline-block;
          padding: 2px var(--boxel-sp-xs);
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          text-transform: capitalize;
        }
        .time-line {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .score-badge {
          flex: none;
        }
        section {
          margin-top: var(--boxel-sp-lg);
        }
        h2 {
          font-size: var(--boxel-font-size-sm);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
          margin: 0 0 var(--boxel-sp);
        }
        .attendee-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp);
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .attendee-chip {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .attendee-avatar {
          width: 2.25rem;
          height: 2.25rem;
          border-radius: 50%;
          flex: none;
          object-fit: cover;
        }
        .attendee-avatar.initials {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-serif, serif);
          font-weight: 600;
          font-size: var(--boxel-font-size-xs);
          color: var(--primary-foreground, var(--boxel-light));
          background: var(--primary, var(--boxel-highlight));
        }
        .attendee-info {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .attendee-name {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
        }
        .attendee-role {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get typeColor() {
      return stateColorOf(MEETING_TYPE_COLORS, this.args.model?.meetingType);
    }

    get typePillStyle() {
      return htmlSafe(
        `background: ${this.typeColor.bg}; color: ${this.typeColor.fg};`,
      );
    }

    get accentBorderStyle() {
      return htmlSafe(`border-left-color: ${this.typeColor.ring};`);
    }

    <template>
      <div
        class='meeting-embedded'
        style={{this.accentBorderStyle}}
      >
        <header>
          <h3>{{@model.title}}</h3>
          {{#if @model.meetingType}}
            <span class='type' style={{this.typePillStyle}}>
              {{@model.meetingType}}
            </span>
          {{/if}}
        </header>
        <dl class='meta-list'>
          <div><dt>When</dt><dd><@fields.date /></dd></div>
          <div><dt>Duration</dt><dd><@fields.duration @format='atom' /></dd>
          </div>
          {{#if @model.candidate}}
            <div>
              <dt>Candidate</dt>
              <dd><@fields.candidate @format='atom' /></dd>
            </div>
          {{/if}}
          {{#if @model.interviewScore}}
            <div><dt>Score</dt><dd><@fields.interviewScore /></dd></div>
          {{/if}}
        </dl>
      </div>
      <style scoped>
        .meeting-embedded {
          padding: var(--boxel-sp);
          background: var(--card, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          border-left: 0.1875rem solid;
          transition: box-shadow 0.15s ease-out;
        }
        header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        h3 {
          margin: 0;
          font-size: var(--boxel-font-size);
        }
        .type {
          padding: 2px var(--boxel-sp-4xs);
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          text-transform: capitalize;
          white-space: nowrap;
        }
        .meta-list {
          margin: var(--boxel-sp-xs) 0 0;
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp);
        }
        .meta-list > div {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-5xs);
        }
        .meta-list dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .meta-list dd {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get typeColor() {
      return stateColorOf(MEETING_TYPE_COLORS, this.args.model?.meetingType);
    }

    get iconStyle() {
      return htmlSafe(`color: ${this.typeColor.ring};`);
    }

    <template>
      <div
        class='meeting-fitted'
      >
        <CalendarIcon
          class='meeting-icon'
          role='presentation'
          style={{this.iconStyle}}
        />
        <div class='info'>
          <span class='name'>{{@model.title}}</span>
          <span class='meta'><@fields.date @format='atom' /></span>
        </div>
      </div>
      <style scoped>
        .meeting-fitted {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs);
          height: 100%;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          transition: background-color 0.15s ease-out;
        }
        .meeting-fitted:hover {
          background: var(--muted, var(--boxel-100));
        }
        .meeting-icon {
          width: 1.5rem;
          height: 1.5rem;
          flex: none;
          transition: color 0.15s ease-out;
        }
        .info {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .name {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @container fitted-card (height <= 80px) {
          .meeting-fitted {
            align-items: center;
          }
        }
        @container fitted-card (height <= 40px) {
          .meta {
            display: none;
          }
        }
      </style>
    </template>
  };
}
