import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import enumField from '@cardstack/base/enum';
import FolderKanbanIcon from '@cardstack/boxel-icons/folder-kanban';
import { or } from '@cardstack/boxel-ui/helpers';
import { htmlSafe } from '@ember/template';

import { DurationField } from './duration-field';
import { Employee } from './employee';
import { Team } from './team';
import { Vendor } from './vendor';
import {
  durationInDays,
  stateColor,
  stateColorOf,
  type StateColor,
} from './utils/index';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

interface ScheduleShape {
  startDate?: Date | null;
  estimatedEffort?: { value?: number | null; unit?: string | null } | null;
}

// One derivation, shared by both formats, so isolated and fitted can never
// report different progress for the same project.
function scheduleFacts(model: ScheduleShape) {
  let start = model.startDate ? new Date(model.startDate) : undefined;
  if (start && isNaN(start.getTime())) {
    start = undefined;
  }
  let days = durationInDays(
    model.estimatedEffort?.value,
    model.estimatedEffort?.unit,
  );
  let end: Date | undefined;
  if (start && days != null && days > 0) {
    end = new Date(start.getTime() + days * MS_PER_DAY);
  }
  let pct: number | undefined;
  if (start && end) {
    let span = end.getTime() - start.getTime();
    pct = Math.max(
      0,
      Math.min(100, Math.round(((Date.now() - start.getTime()) / span) * 100)),
    );
  }
  return { start, end, days, pct };
}

export const PROJECT_STATUSES = ['planned', 'active', 'done'];

// Harmonized with the Ledger identity: active shares the forest-green
// primary; planned/done stay in the muted stone/slate register.
export const PROJECT_STATUS_COLORS: Record<string, StateColor> = {
  planned: stateColor('amber'),
  active: stateColor('green'),
  done: stateColor('blue'),
};

export const ProjectStatusField = enumField(StringField, {
  options: PROJECT_STATUSES.map((status) => ({ value: status, label: status })),
  displayName: 'Project Status',
});

export class Project extends CardDef {
  static displayName = 'Project';
  static icon = FolderKanbanIcon;

  @field name = contains(StringField);
  @field description = contains(StringField);
  @field status = contains(ProjectStatusField);
  @field lead = linksTo(() => Employee);
  @field team = linksTo(() => Team);
  @field vendor = linksTo(() => Vendor);
  @field startDate = contains(DateField);
  @field estimatedEffort = contains(DurationField);

  // Denormalized for fitted — prerendered fitted does not resolve linksTo.
  @field leadName = contains(StringField, {
    computeVia: function (this: Project) {
      return this.lead?.name ?? '';
    },
  });

  @field teamName = contains(StringField, {
    computeVia: function (this: Project) {
      return this.team?.name ?? '';
    },
  });

  @field vendorName = contains(StringField, {
    computeVia: function (this: Project) {
      return this.vendor?.name ?? '';
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: Project) {
      return this.name?.trim() || 'Unnamed Project';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get schedule() {
      return scheduleFacts(this.args.model ?? {});
    }

    get statusSteps() {
      let current = this.args.model?.status;
      let currentIndex = PROJECT_STATUSES.indexOf(current ?? '');
      return PROJECT_STATUSES.map((status, index) => ({
        status,
        isCurrent: index === currentIndex,
        isPast: currentIndex >= 0 && index < currentIndex,
      }));
    }

    get statusPillStyle() {
      let c = stateColorOf(PROJECT_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get endLabel() {
      let { end } = this.schedule;
      return end ? end.toISOString().slice(0, 10) : undefined;
    }

    // Elapsed share of the estimate. Derived, never stored — so it cannot
    // drift away from startDate + estimatedEffort.
    get elapsedLabel() {
      let { pct } = this.schedule;
      return pct == null ? undefined : `${pct}% of estimate elapsed`;
    }

    get stepTrail() {
      return this.statusSteps
        .map((s) => (s.isPast ? `${s.status} ✓` : s.status))
        .join(' → ');
    }

    <template>
      <article class='project-isolated'>
        <header class='hero'>
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>
              {{#if @model.startDate}}from <@fields.startDate />{{/if}}
              {{#if @model.estimatedEffort.label}}
                <span class='sep-dot'>&middot;</span>
                {{@model.estimatedEffort.label}}
                estimated
              {{/if}}
            </p>
            <div class='pill-row'>
              {{#if @model.status}}
                <span class='pill' style={{this.statusPillStyle}}>
                  <span class='pill-dot'></span>{{@model.status}}
                </span>
              {{/if}}
              {{#if @model.teamName}}
                <span class='pill neutral'>{{@model.teamName}}</span>
              {{/if}}
              {{#if this.elapsedLabel}}
                <span class='pill neutral'>{{this.elapsedLabel}}</span>
              {{/if}}
            </div>
          </div>
          <div class='hero-track'>
            <div class='steps'>
              {{#each this.statusSteps as |s|}}
                <i class='{{if (or s.isPast s.isCurrent) "on"}}'></i>
              {{/each}}
            </div>
            <span class='steps-label'>{{this.stepTrail}}</span>
          </div>
        </header>

        <div class='body'>
          <div class='main'>
            {{#if @model.description}}
              <h2 class='panel-title'>Brief</h2>
              <p class='prose'>{{@model.description}}</p>
            {{/if}}
            <h2 class='panel-title spaced'>Schedule</h2>
            <dl class='facts'>
              <dt>Starts</dt>
              <dd>{{#if @model.startDate}}<@fields.startDate
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Estimate</dt>
              <dd>{{#if
                  @model.estimatedEffort.label
                }}{{@model.estimatedEffort.label}}{{else}}&mdash;{{/if}}</dd>
              <dt>Projected end</dt>
              <dd>{{if this.endLabel this.endLabel '—'}}</dd>
              <dt>Elapsed</dt>
              <dd>{{if this.elapsedLabel this.elapsedLabel '—'}}</dd>
            </dl>
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Ownership</h2>
            <dl class='facts stacked'>
              <dt>Lead</dt>
              <dd>{{#if @model.lead}}<@fields.lead
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Team</dt>
              <dd>{{#if @model.team}}<@fields.team
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Vendor</dt>
              <dd>{{#if @model.vendor}}<@fields.vendor
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash; internal only{{/if}}</dd>
            </dl>
            <h2 class='panel-title spaced'>Status</h2>
            <dl class='facts stacked'>
              <dt>Current</dt>
              <dd>{{if @model.status @model.status '—'}}</dd>
            </dl>
          </aside>
        </div>
      </article>
      <style scoped>
        .project-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --proj-id: var(--primary, var(--boxel-highlight));
          --proj-strong: color-mix(
            in oklch,
            var(--proj-id) 45%,
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
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .hero-track {
          flex: none;
          width: 12rem;
          text-align: right;
        }
        .steps {
          display: flex;
          gap: 3px;
        }
        .steps i {
          height: 5px;
          flex: 1;
          border-radius: 2px;
          background: var(--border, var(--boxel-200));
        }
        .steps i.on {
          background: var(--proj-id);
        }
        .steps-label {
          display: block;
          margin-top: 0.25rem;
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
          .hero-track {
            width: 100%;
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(PROJECT_STATUS_COLORS, this.args.model?.status);
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    <template>
      <div class='project-embedded'>
        <header>
          <h3>{{@model.title}}</h3>
          {{#if @model.status}}
            <span class='status' style={{this.statusPillStyle}}>
              {{@model.status}}
            </span>
          {{/if}}
        </header>
        {{#if @model.description}}
          <p class='description'>{{@model.description}}</p>
        {{/if}}
        <dl class='facts'>
          <div><dt>Start</dt><dd><@fields.startDate /></dd></div>
          <div><dt>Effort</dt><dd><@fields.estimatedEffort /></dd></div>
          {{#if @model.lead}}
            <div><dt>Lead</dt><dd><@fields.lead
                  @format='atom'
                  @displayContainer={{false}}
                /></dd></div>
          {{/if}}
          {{#if @model.vendor}}
            <div><dt>Vendor</dt><dd><@fields.vendor
                  @format='atom'
                  @displayContainer={{false}}
                /></dd></div>
          {{/if}}
        </dl>
      </div>
      <style scoped>
        .project-embedded {
          padding: var(--boxel-sp);
          background: var(--card, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
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
        .status {
          padding: 2px var(--boxel-sp-4xs);
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          text-transform: capitalize;
          white-space: nowrap;
        }
        .description {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .facts {
          margin: var(--boxel-sp-xs) 0 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: var(--boxel-sp-xs);
        }
        .facts > div {
          min-width: 0;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .facts dd {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          overflow-wrap: anywhere;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='project-atom'>
        <FolderKanbanIcon class='project-atom-icon' />
        <span class='project-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .project-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .project-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .project-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get schedule() {
      return scheduleFacts(this.args.model ?? {});
    }

    get statusPillStyle() {
      let c = stateColorOf(PROJECT_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get steps() {
      let current = this.args.model?.status;
      let idx = PROJECT_STATUSES.indexOf(current ?? '');
      return PROJECT_STATUSES.map((status, i) => ({
        status,
        on: idx >= 0 && i <= idx,
      }));
    }

    get pctLabel() {
      let { pct } = this.schedule;
      return pct == null ? undefined : `${pct}% elapsed`;
    }

    get startShort() {
      let { start } = this.schedule;
      return start ? start.toISOString().slice(0, 7) : undefined;
    }

    get endShort() {
      let { end } = this.schedule;
      return end ? end.toISOString().slice(0, 7) : undefined;
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            {{#if @model.leadName}}
              <span class='fit-eb'>{{@model.leadName}}{{#if @model.teamName}}
                  &middot;
                  {{@model.teamName}}{{/if}}</span>
            {{/if}}
          </div>
          {{! Status is the last thing dropped — never hidden at any tier. }}
          {{#if @model.status}}
            <span class='fit-pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{@model.status}}
            </span>
          {{/if}}
        </div>

        <div class='fit-track'>
          <div class='steps'>
            {{#each this.steps as |s|}}
              <i class='{{if s.on "on"}}'></i>
            {{/each}}
          </div>
          {{#if this.pctLabel}}
            <span class='track-label'>{{this.pctLabel}}</span>
          {{/if}}
        </div>

        {{#if @model.description}}
          <p class='fit-prose'>{{@model.description}}</p>
        {{/if}}

        <dl class='fit-add'>
          {{#if this.startShort}}
            <div><dt>From</dt><dd>{{this.startShort}}</dd></div>
          {{/if}}
          {{#if @model.estimatedEffort.label}}
            <div><dt>Est</dt><dd>{{@model.estimatedEffort.label}}</dd></div>
          {{/if}}
          {{#if this.endShort}}
            <div><dt>Until</dt><dd>{{this.endShort}}</dd></div>
          {{/if}}
          {{#if @model.vendorName}}
            <div><dt>Vendor</dt><dd>{{@model.vendorName}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        /* Four tiers; each larger one ADDS fields. 11px floor throughout. */
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --proj-id: var(--primary, var(--boxel-highlight));
          --proj-strong: color-mix(
            in oklch,
            var(--proj-id) 45%,
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
        .fit-track {
          flex: none;
          display: none;
        }
        .steps {
          display: flex;
          gap: 3px;
        }
        .steps i {
          height: 4px;
          flex: 1;
          border-radius: 2px;
          background: var(--border, var(--boxel-200));
        }
        .steps i.on {
          background: var(--proj-id);
        }
        .track-label {
          display: block;
          margin-top: 0.15rem;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-prose {
          display: none;
          margin: 0;
          font-size: var(--fit-small);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-450));
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
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

        /* TIER 2 — add lead + team. No `or` in container queries, so two rules. */
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
        /* TIER 3 — add the progress track and elapsed share. */
        @container fitted-card (height > 130px) and (width > 180px) {
          .fit-track {
            display: block;
          }
          .fit-prose {
            display: -webkit-box;
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
        /* Short strip. */
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
        /* Smallest — the status pill stays. */
        @container fitted-card (height <= 50px) {
          .fit-eb {
            display: none;
          }
        }
      </style>
    </template>
  };
}
