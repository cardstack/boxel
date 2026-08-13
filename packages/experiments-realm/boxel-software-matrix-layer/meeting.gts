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
import { InterviewRoundField } from './interview-round-field';
import { ScorecardField } from './scorecard-field';
import { Employee } from './employee';
import { Candidate } from './candidate';
import {
  liveCount,
  stateColor,
  stateColorOf,
  type StateColor,
} from './utils/index';

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
  interview: stateColor('purple'),
  'one-on-one': stateColor('green'),
  standup: stateColor('blue'),
  'vendor-review': stateColor('orange'),
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
  // Kept as a plain field, not a computed mirror of scorecard.averageScore:
  // seed data and the tracker's overdue/rollup logic (whoseTurn,
  // avgInterviewScore) set and read this directly on meetings that have no
  // scorecard at all, and computing it away would silently blank those out.
  // The two live side by side — interviewScore is the quick one-number
  // verdict, scorecard is the optional structured breakdown.
  @field interviewScore = contains(ScoreField);
  @field roundType = contains(InterviewRoundField);
  @field scorecard = contains(ScorecardField);
  @field notes = contains(MarkdownField);

  // Denormalized for fitted — prerendered fitted does not resolve linksTo.
  @field candidateName = contains(StringField, {
    computeVia: function (this: Meeting) {
      return this.candidate?.name ?? '';
    },
  });

  // Denormalized for the same reason as candidateName, but for an id-based
  // match: the Tracker shell filters meetings by candidate in a hot getter
  // (whoseTurn, called once per candidate per render) — reading `candidate`
  // there directly races the async linksTo load the same way candidateName
  // avoids for fitted.
  @field candidateId = contains(StringField, {
    computeVia: function (this: Meeting) {
      return this.candidate?.id ?? '';
    },
  });

  @field interviewerTally = contains(StringField, {
    computeVia: function (this: Meeting) {
      let n = liveCount(this.interviewers);
      return n === 0 ? '' : String(n);
    },
  });

  // Looks up this meeting's own round in the candidate's position's
  // interview plan, so an interviewer opening a scheduled Meeting sees
  // exactly the questions written for the round they're running — without
  // having to separately open the Position's InterviewPlan. Typed as
  // MarkdownField (like `notes`) so it renders formatted, not as raw text —
  // computeVia works the same for a MarkdownField as for any other contains
  // field, it just needs to return the plain string the field stores.
  //
  // Every hop is optional-chained and read defensively (candidate?. and
  // position?. can each be an unloaded linksTo, and interviewPlan?.rounds
  // resolves only once that link itself is loaded) — same defensive style as
  // candidateName/skillMatchPct in candidate.gts, so an unloaded link
  // upstream yields '' rather than tripping an "used before loaded"
  // assertion.
  @field interviewPlanRound = contains(MarkdownField, {
    computeVia: function (this: Meeting) {
      let rounds = this.candidate?.position?.interviewPlan?.rounds ?? [];
      let match = rounds.find(
        (round) => round && round.roundType === this.roundType,
      );
      return match?.questions ?? '';
    },
  });

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

    get weekdayLabel(): string {
      return this.dateObj
        ? this.dateObj.toLocaleDateString('en-US', { weekday: 'short' })
        : '';
    }

    // Derived: the meeting is over and nobody recorded a score. This is the
    // one state a scheduling card can genuinely surface — "the ball is in our
    // court" — and it comes free from date + interviewScore.
    get scoreState(): 'scored' | 'awaiting' | 'upcoming' {
      let d = this.dateObj;
      let scored = typeof this.args.model?.interviewScore === 'number';
      if (scored) {
        return 'scored';
      }
      if (d && d.getTime() < Date.now()) {
        return 'awaiting';
      }
      return 'upcoming';
    }

    get scoreLabel(): string {
      let v = this.args.model?.interviewScore;
      if (typeof v === 'number') {
        return `${v} / 5`;
      }
      return this.scoreState === 'awaiting'
        ? 'Score overdue'
        : 'Not yet scored';
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
          photoUrl: candidate.photo?.resolvedUrl,
        });
      }
      for (let interviewer of this.args.model?.interviewers ?? []) {
        if (interviewer) {
          list.push({
            role: 'Interviewer',
            title: interviewer.title,
            initials: interviewer.initials,
            photoUrl: interviewer.photo?.resolvedUrl,
          });
        }
      }
      return list;
    }

    <template>
      <article class='meeting-isolated'>
        <header class='hero'>
          {{! A meeting's first question is always "when", so the date gets a
              block of its own rather than a line in the subtitle. }}
          <div class='datebox'>
            <span class='db-month'>{{this.dateMonth}}</span>
            <span class='db-day'>{{this.dateDay}}</span>
            <span class='db-weekday'>{{this.weekdayLabel}}</span>
          </div>
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>
              {{this.timeLabel}}
              {{#if @model.duration.label}}
                <span class='sep-dot'>&middot;</span>
                {{@model.duration.label}}
              {{/if}}
            </p>
            <div class='pill-row'>
              {{#if @model.meetingType}}
                <span class='pill' style={{this.typePillStyle}}>
                  <span class='pill-dot'></span>{{@model.meetingType}}
                </span>
              {{/if}}
              <span class='pill {{this.scoreState}}'>
                <span class='pill-dot'></span>{{this.scoreLabel}}
              </span>
            </div>
          </div>
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Attendees</h2>
            {{#if this.attendees.length}}
              <ul class='attendees'>
                {{#each this.attendees as |a|}}
                  <li>
                    {{#if a.photoUrl}}
                      <img class='av' src={{a.photoUrl}} alt='' />
                    {{else}}
                      <span class='av' aria-hidden='true'>{{a.initials}}</span>
                    {{/if}}
                    <span class='att-text'>
                      <span class='att-name'>{{a.title}}</span>
                      <span class='att-role'>{{a.role}}</span>
                    </span>
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>No attendees linked yet.</p>
            {{/if}}

            {{#if @model.notes}}
              <h2 class='panel-title spaced'>Notes</h2>
              <div class='notes'><@fields.notes /></div>
            {{else}}
              <h2 class='panel-title spaced'>Notes</h2>
              <p class='empty'>No notes recorded for this meeting.</p>
            {{/if}}

            {{#if @model.scorecard.criteria.length}}
              <h2 class='panel-title spaced'>Scorecard</h2>
              <div class='scorecard-wrap'><@fields.scorecard /></div>
            {{/if}}

            {{#if @model.interviewPlanRound}}
              <h2 class='panel-title spaced'>Interview questions (this
                round)</h2>
              <div class='markdown'><@fields.interviewPlanRound /></div>
            {{/if}}
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Score</h2>
            <div class='score-block'>
              <span class='score-num'>{{this.scoreLabel}}</span>
              {{#if @model.interviewScore}}
                <span class='score-sub'><@fields.interviewScore /></span>
              {{/if}}
            </div>

            <h2 class='panel-title spaced'>Details</h2>
            <dl class='facts stacked'>
              <dt>Type</dt>
              <dd>{{if @model.meetingType @model.meetingType '—'}}</dd>
              <dt>Round</dt>
              <dd>{{#if @model.roundType}}<@fields.roundType
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Duration</dt>
              <dd>{{#if
                  @model.duration.label
                }}{{@model.duration.label}}{{else}}&mdash;{{/if}}</dd>
              <dt>Candidate</dt>
              <dd>{{#if @model.candidate}}<@fields.candidate
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Interviewers</dt>
              <dd>{{if
                  @model.interviewerTally
                  @model.interviewerTally
                  '0'
                }}</dd>
            </dl>
          </aside>
        </div>
      </article>
      <style scoped>
        .meeting-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --meet-id: var(--primary, var(--boxel-highlight));
          --meet-strong: color-mix(
            in oklch,
            var(--meet-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .hero {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .datebox {
          flex: none;
          min-width: 4rem;
          text-align: center;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
          padding: 0.4rem 0.7rem;
          background: var(--muted, var(--boxel-100));
        }
        .db-month {
          display: block;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: 0.1em;
          font-weight: 700;
          color: var(--meet-strong);
        }
        .db-day {
          display: block;
          font-size: 1.7rem;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .db-weekday {
          display: block;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .hero-text {
          flex: 1;
          min-width: 0;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.2;
          overflow-wrap: anywhere;
          font-family: var(--font-heading, inherit);
        }
        .byline {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sep-dot {
          margin: 0 0.25rem;
        }
        .pill-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-5xs);
          margin-top: var(--boxel-sp-xs);
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.18em 0.5em;
          border-radius: 3px;
          white-space: nowrap;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        /* Score state carries semantic colour, kept separate from the type
           hue so "whose court is the ball in" never competes with "what kind
           of meeting is this". */
        .pill.awaiting {
          background: color-mix(
            in oklch,
            var(--boxel-danger) 12%,
            var(--card, var(--boxel-light))
          );
          color: color-mix(
            in oklch,
            var(--boxel-danger) 45%,
            var(--card-foreground, var(--boxel-dark))
          );
        }
        .pill.scored {
          background: color-mix(
            in oklch,
            var(--boxel-success) 12%,
            var(--card, var(--boxel-light))
          );
          color: color-mix(
            in oklch,
            var(--boxel-success) 45%,
            var(--card-foreground, var(--boxel-dark))
          );
        }
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .body {
          display: grid;
          grid-template-columns: 1fr 17rem;
          /* Fill whatever height is left so the aside's surface reaches the
             bottom edge. Without this the grid is only as tall as its content
             and the panel stops mid-card, reading as a cut-off seam. */
          flex: 1;
          min-height: 0;
          align-content: start;
        }
        .main {
          padding: var(--boxel-sp-lg);
          min-width: 0;
        }
        .side {
          padding: var(--boxel-sp-lg);
          border-left: 1px solid var(--border, var(--boxel-200));
          background: var(--muted, var(--boxel-100));
        }
        .panel-title {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
        }
        .panel-title.spaced {
          margin-top: var(--boxel-sp-lg);
        }
        .attendees {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: var(--boxel-sp-xs);
        }
        .attendees > li {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .av {
          flex: none;
          width: 1.75rem;
          height: 1.75rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          background: var(--meet-strong);
          color: var(--background, var(--boxel-light));
          object-fit: cover;
        }
        .att-text {
          min-width: 0;
        }
        .att-name {
          display: block;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
        }
        .att-role {
          display: block;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .notes {
          font-size: var(--boxel-font-size-sm);
          line-height: 1.65;
          max-height: 18rem;
          overflow-y: auto;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm);
          padding: var(--boxel-sp-xs);
        }
        .markdown {
          font-size: var(--boxel-font-size-sm);
          line-height: 1.65;
          max-height: 20rem;
          overflow-y: auto;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm);
          padding: var(--boxel-sp-xs);
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .scorecard-wrap {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm);
          padding: var(--boxel-sp-xs);
        }
        .score-block {
          padding: var(--boxel-sp-xs) 0;
        }
        .score-num {
          display: block;
          font-size: 1.5rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          line-height: 1.1;
        }
        .score-sub {
          display: block;
          margin-top: 0.15rem;
        }
        .facts {
          margin: 0;
          display: grid;
          grid-template-columns: 1fr;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
          padding-top: 0.4rem;
        }
        .facts dd {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          overflow-wrap: anywhere;
        }
        @container iso (max-width: 40rem) {
          .body {
            grid-template-columns: 1fr;
          }
          .side {
            border-left: 0;
            border-top: 1px solid var(--border, var(--boxel-200));
          }
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
      <div class='meeting-embedded' style={{this.accentBorderStyle}}>
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
          <div><dt>Duration</dt><dd><@fields.duration
                @format='atom'
                @displayContainer={{false}}
              /></dd>
          </div>
          {{#if @model.candidate}}
            <div>
              <dt>Candidate</dt>
              <dd><@fields.candidate
                  @format='atom'
                  @displayContainer={{false}}
                /></dd>
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

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='meeting-atom'>
        <CalendarIcon class='meeting-atom-icon' />
        <span class='meeting-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .meeting-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .meeting-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .meeting-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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

    get typePillStyle() {
      return htmlSafe(
        `background: ${this.typeColor.bg}; color: ${this.typeColor.fg};`,
      );
    }

    get dateObj(): Date | undefined {
      let value = this.args.model?.date;
      if (!value) {
        return undefined;
      }
      let d = new Date(value);
      return isNaN(d.getTime()) ? undefined : d;
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

    get weekdayLabel(): string {
      return this.dateObj
        ? this.dateObj.toLocaleDateString('en-US', { weekday: 'short' })
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

    // Same derivation as isolated: over and unscored means we owe an action.
    get scoreState(): 'scored' | 'awaiting' | 'upcoming' {
      let d = this.dateObj;
      if (typeof this.args.model?.interviewScore === 'number') {
        return 'scored';
      }
      return d && d.getTime() < Date.now() ? 'awaiting' : 'upcoming';
    }

    get scoreShort(): string {
      let v = this.args.model?.interviewScore;
      if (typeof v === 'number') {
        return `★ ${v}/5`;
      }
      return this.scoreState === 'awaiting' ? 'Unscored' : 'Upcoming';
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          <div class='datebox' aria-hidden='true'>
            <span class='db-month'>{{this.dateMonth}}</span>
            <span class='db-day'>{{this.dateDay}}</span>
            <span class='db-weekday'>{{this.weekdayLabel}}</span>
          </div>
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            {{#if @model.meetingType}}
              <span class='fit-eb'>{{@model.meetingType}}{{#if
                  @model.duration.label
                }}
                  &middot;
                  {{@model.duration.label}}{{/if}}</span>
            {{/if}}
          </div>
          {{! Score state survives to the smallest tier — it is the only
              signal that says whether this meeting still needs something. }}
          <span class='fit-pill {{this.scoreState}}'>
            <span class='pill-dot'></span>{{this.scoreShort}}
          </span>
        </div>

        <div class='fit-mid'>
          <span class='fit-time'>{{this.timeLabel}}</span>
          {{#if @model.candidateName}}
            <span class='fit-who'>{{@model.candidateName}}</span>
          {{/if}}
        </div>

        <dl class='fit-add'>
          {{#if @model.interviewerTally}}
            <div><dt>Panel</dt><dd>{{@model.interviewerTally}}</dd></div>
          {{/if}}
          {{#if @model.duration.label}}
            <div><dt>Length</dt><dd>{{@model.duration.label}}</dd></div>
          {{/if}}
          {{#if @model.meetingType}}
            <div><dt>Type</dt><dd>{{@model.meetingType}}</dd></div>
          {{/if}}
          <div><dt>Score</dt><dd>{{this.scoreShort}}</dd></div>
        </dl>
      </article>
      <style scoped>
        /* Four tiers, each ADDING fields. 11px floor. Pill never hidden. */
        .fit {
          height: 100%;
          /* Flex, not a three-row grid: with `minmax(0, 1fr)` in the middle
             a taller bottom block squeezed the middle row and clipped its
             text. Here the middle keeps its natural height and the extras
             block is pushed to the bottom by `margin-top: auto`. */
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --meet-id: var(--primary, var(--boxel-highlight));
          --meet-strong: color-mix(
            in oklch,
            var(--meet-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        .fit > * {
          min-height: 0;
          overflow: hidden;
        }
        .fit-top {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .datebox {
          flex: none;
          min-width: 2.3rem;
          text-align: center;
        }
        .db-month {
          display: block;
          font-size: var(--fit-small);
          font-weight: 700;
          color: var(--meet-strong);
        }
        .db-day {
          display: block;
          font-size: calc(var(--fit-name) * 1.2);
          font-weight: 800;
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }
        .db-weekday {
          display: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-head {
          flex: 1;
          min-width: 0;
        }
        .fit-name {
          margin: 0;
          font-size: var(--fit-name);
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fit-eb {
          display: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-pill {
          flex: none;
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: var(--fit-small);
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 3px;
          white-space: nowrap;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-pill.awaiting {
          background: color-mix(
            in oklch,
            var(--boxel-danger) 12%,
            var(--card, var(--boxel-light))
          );
          color: color-mix(
            in oklch,
            var(--boxel-danger) 45%,
            var(--card-foreground, var(--boxel-dark))
          );
        }
        .fit-pill.scored {
          background: color-mix(
            in oklch,
            var(--boxel-success) 12%,
            var(--card, var(--boxel-light))
          );
          color: color-mix(
            in oklch,
            var(--boxel-success) 45%,
            var(--card-foreground, var(--boxel-dark))
          );
        }
        .pill-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .fit-mid {
          flex: none;
          display: none;
          flex-direction: column;
          gap: 1px;
        }
        .fit-time {
          font-size: var(--fit-small);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .fit-who {
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-add {
          display: none;
          margin: 0;
          margin-top: auto;
          padding-top: 0.3rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
          grid-template-columns: 1fr 1fr;
          gap: 0.05rem 0.5rem;
        }
        .fit-add > div {
          display: flex;
          gap: 0.25rem;
          min-width: 0;
        }
        .fit-add dt {
          flex: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-add dd {
          margin: 0;
          font-size: var(--fit-small);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* TIER 2 — add meeting type + duration. No `or` in CQ, so two rules. */
        @container fitted-card (height > 80px) {
          .fit-eb {
            display: block;
          }
        }
        @container fitted-card (width > 240px) {
          .fit-eb {
            display: block;
          }
        }
        /* TIER 3 — add weekday, time and who it is with. */
        @container fitted-card (height > 130px) and (width > 180px) {
          .db-weekday {
            display: block;
          }
          .fit-mid {
            display: flex;
          }
        }
        /* TIER 4 — width-driven facts. Previously absent entirely. */
        @container fitted-card (height > 150px) and (width > 180px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr;
          }
        }
        @container fitted-card (width > 340px) and (height > 130px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
        }
        @container fitted-card (height <= 90px) {
          .fit {
            grid-template-rows: 1fr;
            align-content: center;
          }
          .fit-top {
            align-items: center;
            flex-wrap: nowrap;
          }
          .fit-pill {
            align-self: center;
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height <= 50px) {
          .fit-eb {
            display: none;
          }
        }
      </style>
    </template>
  };
}
