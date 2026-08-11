import {
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import PhoneNumberField from '@cardstack/base/phone-number';
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';
import { FileDef } from '@cardstack/base/file-api';
import InboxIcon from '@cardstack/boxel-icons/inbox';
import { htmlSafe } from '@ember/template';

import { PersonBase } from './person-base';
import { Position } from './position';
import { stateColor, stateColorOf, type StateColor } from './utils/index';
import FileDownloadLink from './components/file-download-link';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// How long this application has been sitting. Shared by both formats.
function daysWaiting(appliedDate?: Date | null): number | undefined {
  if (!appliedDate) {
    return undefined;
  }
  let d = new Date(appliedDate);
  if (isNaN(d.getTime())) {
    return undefined;
  }
  return Math.max(0, Math.round((Date.now() - d.getTime()) / MS_PER_DAY));
}

export const APPLICATION_STATUSES = [
  'new',
  'reviewing',
  'converted',
  'rejected',
];

// Colocated with Application — the front porch of the same story Candidate
// tells: "new" reuses the applied stage's brass, "reviewing" reuses
// screening's green, "converted" resolves into the hired/active forest
// green (this applicant became a Candidate), "rejected" shares the rust.
export const APPLICATION_STATUS_COLORS: Record<string, StateColor> = {
  new: stateColor('amber'),
  reviewing: stateColor('green'),
  converted: stateColor('green'),
  rejected: stateColor('red'),
};

export const ApplicationStatusField = enumField(StringField, {
  options: APPLICATION_STATUSES.map((status) => ({
    value: status,
    label: status,
  })),
  displayName: 'Application Status',
});

export class Application extends PersonBase {
  static displayName = 'Application';
  static icon = InboxIcon;

  // PersonBase already contributes name/email/photo/initials — an
  // applicant is a person, so this reuses that identity instead of
  // redeclaring it. Phone is overridden to the stricter PhoneNumberField
  // (PersonBase's own `phone` is a plain string) since that's what this
  // card always wanted.
  @field phone = contains(PhoneNumberField);
  @field position = linksTo(() => Position);
  @field positionTitle = contains(StringField, {
    description:
      "Denormalized copy of the linked position's title — fitted prerender never resolves linksTo, so fitted reads this instead of position.title",
  });
  @field source = contains(StringField, {
    description:
      'Where the application came from (LinkedIn, referral, careers page, etc.)',
  });
  @field appliedDate = contains(DateField);
  @field resumeText = contains(TextAreaField, {
    description: 'Raw resume text submitted with the application',
  });
  @field resumeFile = linksTo(FileDef, {
    searchable: true,
    description: 'The original resume file (PDF, etc.) submitted with the application',
  });
  @field coverLetterFile = linksTo(FileDef, { searchable: true });
  @field referrerName = contains(StringField, {
    description: 'Name of the person who referred this applicant, if any',
  });
  @field status = contains(ApplicationStatusField);

  @field title = contains(StringField, {
    computeVia: function (this: Application) {
      return this.name?.trim() || 'Unnamed Applicant';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(APPLICATION_STATUS_COLORS, this.args.model?.status);
    }
    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }
    get avatarRingStyle() {
      return htmlSafe(
        `box-shadow: 0 0 0 0.1875rem var(--background, var(--boxel-light)), 0 0 0 0.3125rem ${this.statusColor.ring};`,
      );
    }
    get resumeWordCount(): number | undefined {
      let text = this.args.model?.resumeText?.trim();
      if (!text) {
        return undefined;
      }
      return text.split(/\s+/).filter(Boolean).length;
    }
    get waitLabel(): string | undefined {
      let d = daysWaiting(this.args.model?.appliedDate);
      return d == null ? undefined : `${d} days in queue`;
    }

    // An application nobody has screened is the one thing this card can
    // legitimately claim needs action.
    get needsScreening(): boolean {
      let st = this.args.model?.status;
      return st === 'new' || st === 'reviewing';
    }

    <template>
      <article class='application-isolated'>
        <header class='hero'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='avatar avatar-photo'
              style={{this.avatarRingStyle}}
              src={{@model.photo.resolvedUrl}}
              alt=''
            />
          {{else}}
            <span
              class='avatar'
              style={{this.avatarRingStyle}}
            >{{@model.initials}}</span>
          {{/if}}
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>
              {{#if @model.positionTitle}}applied for
                {{@model.positionTitle}}{{else}}No position linked{{/if}}
              {{#if @model.appliedDate}}
                <span class='sep-dot'>&middot;</span>
                <@fields.appliedDate />
              {{/if}}
            </p>
            <div class='pill-row'>
              {{#if @model.status}}
                <span class='pill' style={{this.statusPillStyle}}>
                  <span class='pill-dot'></span>{{@model.status}}
                </span>
              {{/if}}
              {{#if this.needsScreening}}
                {{#if this.waitLabel}}
                  <span class='pill stale'>
                    <span class='pill-dot'></span>{{this.waitLabel}}
                  </span>
                {{/if}}
              {{else if this.waitLabel}}
                <span class='pill neutral'>{{this.waitLabel}}</span>
              {{/if}}
              {{#if @model.referrerName}}
                <span class='pill neutral'>referred by
                  {{@model.referrerName}}</span>
              {{/if}}
            </div>
          </div>
          {{#if this.resumeWordCount}}
            <div class='hero-money'>
              <span class='money'>{{this.resumeWordCount}}</span>
              <span class='money-label'>words of resume</span>
            </div>
          {{/if}}
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Resume</h2>
            {{#if @model.resumeFile}}
              <div class='attach'>
                <FileDownloadLink @file={{@model.resumeFile}} />
              </div>
            {{else}}
              <p class='empty'>No resume file attached.</p>
            {{/if}}
            {{#if @model.resumeText}}
              <p class='prose'>{{@model.resumeText}}</p>
            {{else}}
              <p class='empty'>No resume text on file — this is what a
                Screen conversion and any later AI parsing on the resulting
                Candidate both read.</p>
            {{/if}}

            <h2 class='panel-title spaced'>Cover letter</h2>
            {{#if @model.coverLetterFile}}
              <div class='attach'>
                <FileDownloadLink @file={{@model.coverLetterFile}} />
              </div>
            {{else}}
              <p class='empty'>No cover letter attached.</p>
            {{/if}}
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Applicant</h2>
            <dl class='facts stacked'>
              <dt>Email</dt>
              <dd>{{if @model.email @model.email '—'}}</dd>
              <dt>Phone</dt>
              <dd>{{#if @model.phone}}<@fields.phone
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Source</dt>
              <dd>{{if @model.source @model.source '—'}}</dd>
              <dt>Referrer</dt>
              <dd>{{if @model.referrerName @model.referrerName '—'}}</dd>
            </dl>

            <h2 class='panel-title spaced'>Requisition</h2>
            <dl class='facts stacked'>
              <dt>Position</dt>
              <dd>{{#if @model.position}}<@fields.position
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Applied</dt>
              <dd>{{#if @model.appliedDate}}<@fields.appliedDate
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>In queue</dt>
              <dd>{{if this.waitLabel this.waitLabel '—'}}</dd>
            </dl>
          </aside>
        </div>
      </article>
      <style scoped>
        .application-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --app-id: var(--primary, var(--boxel-highlight));
          --app-strong: color-mix(
            in oklch,
            var(--app-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .avatar {
          flex: none;
          width: 3.25rem;
          height: 3.25rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          background: var(--app-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-photo {
          object-fit: cover;
        }
        .attach {
          font-size: var(--boxel-font-size-sm);
        }
        .dd-note {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .hero {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
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
        }
        .pill.neutral {
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .pill.stale {
          background: color-mix(
            in oklch,
            var(--boxel-warning) 12%,
            var(--card, var(--boxel-light))
          );
          color: color-mix(
            in oklch,
            var(--boxel-warning) 45%,
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
        .hero-money {
          flex: none;
          text-align: right;
        }
        .money {
          display: block;
          font-size: 1.5rem;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .money-label {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
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
        .prose {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.65;
          max-width: 56ch;
          max-height: 16rem;
          overflow-y: auto;
        }
        .chips {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
        }
        .chips > li {
          font-size: var(--boxel-font-size-xs);
          padding: 0.15em 0.5em;
          border-radius: 3px;
          border: 1px solid var(--border, var(--boxel-200));
          background: var(--card, var(--boxel-light));
        }
        .facts {
          margin: 0;
          display: grid;
          grid-template-columns: 9rem 1fr;
        }
        .facts.stacked {
          grid-template-columns: 1fr;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
          padding: 0.45rem var(--boxel-sp-xs) 0.45rem 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .facts.stacked dt {
          border-bottom: 0;
          padding-bottom: 0;
        }
        .facts dd {
          margin: 0;
          padding: 0.45rem 0;
          font-size: var(--boxel-font-size-sm);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          overflow-wrap: anywhere;
          font-variant-numeric: tabular-nums;
        }
        .facts.stacked dd {
          padding-top: 0.1rem;
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container iso (max-width: 40rem) {
          .body {
            grid-template-columns: 1fr;
          }
          .side {
            border-left: 0;
            border-top: 1px solid var(--border, var(--boxel-200));
          }
          .hero {
            flex-wrap: wrap;
          }
          .hero-money {
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get statusStyle() {
      let c = stateColorOf(APPLICATION_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }
    <template>
      <div class='application-embedded'>
        {{#if @model.photo.resolvedUrl}}
          <img class='ae-avatar' src={{@model.photo.resolvedUrl}} alt='' />
        {{else}}
          <span
            class='ae-avatar ae-initials'
          >{{@model.initials}}</span>
        {{/if}}
        <div class='ae-main'>
          <span class='ae-name'>{{@model.title}}</span>
          {{#if @model.source}}
            <span class='ae-source'>via {{@model.source}}</span>
          {{/if}}
        </div>
        {{#if @model.status}}
          <span
            class='ae-status'
            style={{this.statusStyle}}
          >{{@model.status}}</span>
        {{/if}}
      </div>
      <style scoped>
        .application-embedded {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .ae-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          flex-shrink: 0;
          object-fit: cover;
        }
        .ae-initials {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.6875rem;
          font-weight: 700;
        }
        .ae-main {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
          min-width: 0;
          flex: 1;
        }
        .ae-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ae-source {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ae-status {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='application-atom'>
        <InboxIcon class='application-atom-icon' />
        <span class='application-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .application-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .application-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .application-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(APPLICATION_STATUS_COLORS, this.args.model?.status);
    }
    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }
    get pipelineSteps() {
      let order = ['new', 'reviewing', 'converted'];
      let status = this.args.model?.status;
      let idx = status === 'rejected' ? -1 : order.indexOf(status ?? '');
      return order.map((step, i) => ({ step, done: idx >= 0 && i <= idx }));
    }
    get waitLabel(): string | undefined {
      let d = daysWaiting(this.args.model?.appliedDate);
      return d == null ? undefined : `${d}d waiting`;
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='avatar avatar-photo'
              src={{@model.photo.resolvedUrl}}
              alt=''
            />
          {{else}}
            <span class='avatar' aria-hidden='true'>{{@model.initials}}</span>
          {{/if}}
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            {{! Reads the denormalized own-attribute, not position.title —
                a linksTo read here rendered "applying for " with nothing
                after it in prerendered fitted. }}
            {{#if @model.positionTitle}}
              <span class='fit-eb'>{{@model.positionTitle}}</span>
            {{/if}}
          </div>
          {{#if @model.status}}
            <span class='fit-pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{@model.status}}
            </span>
          {{/if}}
        </div>

        <div class='fit-mid'>
          {{#if this.waitLabel}}
            <span class='money'>{{this.waitLabel}}</span>
          {{/if}}
          {{#if @model.source}}
            <span class='fit-sub'>via {{@model.source}}</span>
          {{/if}}
        </div>

        <dl class='fit-add'>
          {{#if @model.email}}
            <div><dt>Email</dt><dd>{{@model.email}}</dd></div>
          {{/if}}
          {{#if @model.referrerName}}
            <div><dt>Ref</dt><dd>{{@model.referrerName}}</dd></div>
          {{/if}}
          {{#if @model.appliedDate}}
            <div><dt>Applied</dt><dd><@fields.appliedDate /></dd></div>
          {{/if}}
          {{#if @model.source}}
            <div><dt>Source</dt><dd>{{@model.source}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        /* Four tiers, each ADDING fields. 11px floor. Status never hidden. */
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
          --app-id: var(--primary, var(--boxel-highlight));
          --app-strong: color-mix(
            in oklch,
            var(--app-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        .avatar {
          flex: none;
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: var(--fit-small);
          font-weight: 700;
          background: var(--app-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-photo {
          object-fit: cover;
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
        .money {
          font-size: calc(var(--fit-name) * 1.15);
          font-weight: 800;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .fit-sub {
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
          font-variant-numeric: tabular-nums;
        }

        /* TIER 2 — add the secondary line. Container queries have no `or`,
           so this is reached either by height (tile) or width (strip). */
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
        /* TIER 3 — add the headline figure block. */
        @container fitted-card (height > 130px) and (width > 180px) {
          .fit-mid {
            display: flex;
          }
        }
        /* TIER 4 — width-driven extra facts. Previously absent entirely,
           which is why a 500x400 tile showed the same as a 200x140 one. */
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
        /* Short strip: horizontal, single-line name. */
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
        /* Smallest tier: secondary line goes, the status pill stays. */
        @container fitted-card (height <= 50px) {
          .fit-eb {
            display: none;
          }
        }
      </style>
    </template>
  };
}
