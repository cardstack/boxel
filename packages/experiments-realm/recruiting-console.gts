import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
  StringField,
  type BaseDef,
} from '@cardstack/base/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { eq } from '@cardstack/boxel-ui/helpers';
import BriefcaseIcon from '@cardstack/boxel-icons/briefcase';

import { Candidate, CANDIDATE_STAGES } from './candidate';
import { Employee } from './employee';
import { Meeting } from './meeting';
import { Team } from './team';
import { Project } from './project';
import { Vendor } from './vendor';
import { Position } from './position';
import { Application } from './application';
import { Offer } from './offer';
import { Calendar, type CalendarEvent } from './components/calendar';
import { OrgTree, type OrgTreeItem } from './components/org-tree';
import { buildOrgTree, type OrgNode } from './utils/index';
import { ExtractResumeCommand } from './commands/extract-resume-command';
import { GenerateInterviewQuestionsCommand } from './commands/generate-interview-questions-command';
import { ApproveOfferCommand } from './commands/approve-offer-command';
import { RejectCandidateCommand } from './commands/reject-candidate-command';

export class RecruitingConsole extends CardDef {
  static displayName = 'Recruiting Console';
  static icon = BriefcaseIcon;
  static prefersWideFormat = true;

  @field consoleName = contains(StringField);
  @field hiringLead = linksTo(() => Employee);
  @field candidates = linksToMany(() => Candidate);
  @field meetings = linksToMany(() => Meeting);
  @field employees = linksToMany(() => Employee);
  @field teams = linksToMany(() => Team);
  @field projects = linksToMany(() => Project);
  @field vendors = linksToMany(() => Vendor);
  @field positions = linksToMany(() => Position);
  @field applications = linksToMany(() => Application);
  @field offers = linksToMany(() => Offer);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: RecruitingConsole) {
      return this.consoleName?.trim()?.length
        ? this.consoleName
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static isolated = class Isolated extends Component<typeof RecruitingConsole> {
    stages = CANDIDATE_STAGES;
    @tracked busyId: string | null = null;
    @tracked notice: string | null = null;
    @tracked noticeKind: 'ok' | 'err' = 'ok';

    get candidates() {
      return (this.args.model?.candidates ?? []).filter(Boolean);
    }
    get columns() {
      return this.stages.map((stage) => ({
        stage,
        candidates: this.candidates.filter((c) => c?.status === stage),
      }));
    }
    get interviewEvents(): CalendarEvent[] {
      return (this.args.model?.meetings ?? [])
        .filter((m) => Boolean(m?.date))
        .map((m) => ({
          id: m.id,
          title: m.title ?? m.name ?? 'Meeting',
          date: new Date(m.date!),
          kind: m.meetingType,
        }));
    }
    get orgRoots(): OrgNode<OrgTreeItem>[] {
      let employees = (this.args.model?.employees ?? []).filter(Boolean);
      let items = employees.map((e) => ({
        id: e.id,
        name: e.name,
        role: e.role,
        initials: e.initials,
        photoUrl: e.photo?.resolvedUrl,
        status: e.status,
        managerId: e.manager?.id,
      }));
      return buildOrgTree(items, (item) => item.managerId);
    }
    get onboardingCount() {
      return (this.args.model?.employees ?? []).filter(
        (e) => e?.status === 'onboarding',
      ).length;
    }
    get openCount() {
      return this.candidates.filter(
        (c) => c?.status !== 'hired' && c?.status !== 'rejected',
      ).length;
    }
    get openRequisitions() {
      return (this.args.model?.positions ?? []).filter(
        (p) => p?.status === 'open',
      ).length;
    }
    get commandContext() {
      return this.args.context?.commandContext;
    }

    isBusy = (id: string | undefined | null): boolean => {
      return Boolean(id) && this.busyId === id;
    };

    async runCommand(
      candidate: Candidate,
      label: string,
      make: () => Promise<unknown>,
    ) {
      if (!this.commandContext) {
        this.noticeKind = 'err';
        this.notice = `${label} needs the interactive app (no command context here).`;
        return;
      }
      this.busyId = candidate.id ?? null;
      this.notice = null;
      try {
        await make();
        this.noticeKind = 'ok';
        this.notice = `${label} finished for ${candidate.name ?? 'candidate'}.`;
      } catch (e: unknown) {
        this.noticeKind = 'err';
        this.notice = `${label} failed: ${(e as Error).message ?? e}`;
      } finally {
        this.busyId = null;
      }
    }

    @action extractResume(candidate: Candidate) {
      void this.runCommand(candidate, 'Extract Resume', () =>
        new ExtractResumeCommand(this.commandContext!).execute({
          candidate,
        } as any),
      );
    }

    @action generateQuestions(candidate: Candidate) {
      void this.runCommand(candidate, 'Generate Questions', () =>
        new GenerateInterviewQuestionsCommand(this.commandContext!).execute({
          candidate,
        } as any),
      );
    }

    @action approveOffer(candidate: Candidate) {
      void this.runCommand(candidate, 'Approve Offer', () =>
        new ApproveOfferCommand(this.commandContext!).execute({
          candidate,
          approver: this.args.model?.hiringLead,
          salary: candidate.offer?.salary,
        } as any),
      );
    }

    @action rejectCandidate(candidate: Candidate) {
      void this.runCommand(candidate, 'Reject', () =>
        new RejectCandidateCommand(this.commandContext!).execute({
          candidate,
          reason: 'Not selected at offer review',
        } as any),
      );
    }

    @action openCard(card: { id?: string } | undefined) {
      if (!card?.id) return;
      (this.args.context?.actions as any)?.viewCard?.(new URL(card.id));
    }

    @action openEvent(event: CalendarEvent) {
      if (!event.id) return;
      (this.args.context?.actions as any)?.viewCard?.(new URL(event.id));
    }

    @action openOrgItem(item: OrgTreeItem) {
      this.openCard(item);
    }

    <template>
      <article class='console'>
        <header class='masthead'>
          <div>
            <p class='eyebrow'>Recruiting Console</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
          <dl class='stats'>
            <div><dt>Open reqs</dt><dd>{{this.openRequisitions}}</dd></div>
            <div><dt>Open candidates</dt><dd>{{this.openCount}}</dd></div>
            <div><dt>Interviews</dt><dd
              >{{this.interviewEvents.length}}</dd></div>
            <div><dt>Onboarding</dt><dd>{{this.onboardingCount}}</dd></div>
          </dl>
        </header>

        {{#if this.notice}}
          <p class='notice notice-{{this.noticeKind}}'>{{this.notice}}</p>
        {{/if}}

        <section class='board-wrap'>
          <h2>Pipeline</h2>
          <div class='board'>
            {{#each this.columns as |col|}}
              <div class='col col-{{col.stage}}'>
                <div class='col-head'>
                  <span class='col-name'>{{col.stage}}</span>
                  <span class='col-count'>{{col.candidates.length}}</span>
                </div>
                {{#each col.candidates as |candidate|}}
                  <div class='pipe-card'>
                    <button
                      type='button'
                      class='pipe-open'
                      {{on 'click' (fn this.openCard candidate)}}
                    >
                      {{#let (getComponent candidate) as |CandidateCard|}}
                        <CandidateCard @format='embedded' />
                      {{/let}}
                    </button>
                    <div class='pipe-actions'>
                      {{#if (eq col.stage 'applied')}}
                        <button
                          type='button'
                          class='act'
                          disabled={{this.isBusy candidate.id}}
                          {{on 'click' (fn this.extractResume candidate)}}
                        >{{if
                            (this.isBusy candidate.id)
                            'Extracting…'
                            'Extract resume'
                          }}</button>
                      {{/if}}
                      {{#if (eq col.stage 'interviewing')}}
                        <button
                          type='button'
                          class='act'
                          disabled={{this.isBusy candidate.id}}
                          {{on 'click' (fn this.generateQuestions candidate)}}
                        >{{if
                            (this.isBusy candidate.id)
                            'Generating…'
                            'Interview questions'
                          }}</button>
                      {{/if}}
                      {{#if (eq col.stage 'offer')}}
                        <button
                          type='button'
                          class='act act-approve'
                          disabled={{this.isBusy candidate.id}}
                          {{on 'click' (fn this.approveOffer candidate)}}
                        >Approve</button>
                        <button
                          type='button'
                          class='act act-reject'
                          disabled={{this.isBusy candidate.id}}
                          {{on 'click' (fn this.rejectCandidate candidate)}}
                        >Reject</button>
                      {{/if}}
                    </div>
                  </div>
                {{else}}
                  <p class='col-empty'>Empty</p>
                {{/each}}
              </div>
            {{/each}}
          </div>
        </section>

        <div class='split'>
          <section class='panel schedule'>
            <h2>Interview Schedule</h2>
            <Calendar
              @events={{this.interviewEvents}}
              @onSelectEvent={{this.openEvent}}
            />
          </section>

          <section class='panel org'>
            <h2>Where Hires Land</h2>
            {{#if this.orgRoots.length}}
              <OrgTree
                @roots={{this.orgRoots}}
                @onSelect={{this.openOrgItem}}
              />
            {{else}}
              <p class='col-empty'>No employees linked yet</p>
            {{/if}}
          </section>
        </div>

        <div class='split three'>
          <section class='panel'>
            <h2>Open Requisitions</h2>
            <@fields.positions />
          </section>
          <section class='panel'>
            <h2>Inbound Applications</h2>
            <@fields.applications />
          </section>
          <section class='panel'>
            <h2>Offers</h2>
            <@fields.offers />
          </section>
        </div>

        <div class='split three'>
          <section class='panel'>
            <h2>Teams</h2>
            <@fields.teams />
          </section>
          <section class='panel'>
            <h2>Staffing Projects</h2>
            <@fields.projects />
          </section>
          <section class='panel'>
            <h2>Sourcing Vendors</h2>
            <@fields.vendors />
          </section>
        </div>
      </article>
      <style scoped>
        .console {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .masthead {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1rem;
        }
        .eyebrow {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.75rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .stats {
          margin: 0;
          display: flex;
          gap: 1.5rem;
        }
        .stats div {
          text-align: right;
        }
        .stats dt {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, #6b7280);
        }
        .stats dd {
          margin: 0;
          font-size: 1.375rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .notice {
          margin: 0;
          padding: 0.625rem 0.875rem;
          border-radius: 0.5rem;
          font-size: 0.8125rem;
          border: 1px solid var(--border, #e5e7eb);
        }
        .notice-ok {
          background: #d1fae5;
          color: #065f46;
          border-color: #a7f3d0;
        }
        .notice-err {
          background: #fee2e2;
          color: #991b1b;
          border-color: #fecaca;
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .board {
          display: flex;
          gap: 0.75rem;
          overflow-x: auto;
          padding-bottom: 0.5rem;
        }
        .col {
          flex: 0 0 15.5rem;
          background: var(--muted, #f3f4f6);
          border-radius: 0.625rem;
          padding: 0.625rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          min-height: 8rem;
        }
        .col-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .col-name {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, #6b7280);
        }
        .col-count {
          font-size: 0.6875rem;
          font-weight: 700;
          background: var(--card, #ffffff);
          border-radius: 999px;
          padding: 0.0625rem 0.4375rem;
          font-variant-numeric: tabular-nums;
        }
        .col-empty {
          margin: 0;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          text-align: center;
          padding: 0.75rem 0;
        }
        .pipe-card {
          background: var(--card, #ffffff);
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          box-shadow: var(--shadow-xs, 0 1px 2px rgba(0, 0, 0, 0.05));
          overflow: hidden;
        }
        .pipe-open {
          display: block;
          width: 100%;
          border: none;
          background: none;
          padding: 0;
          text-align: left;
          cursor: pointer;
          font: inherit;
          color: inherit;
        }
        .pipe-open:focus-visible {
          outline: 2px solid var(--ring, #3b82f6);
          outline-offset: -2px;
        }
        .pipe-actions {
          display: flex;
          gap: 0.375rem;
          padding: 0 0.625rem 0.625rem;
          flex-wrap: wrap;
        }
        .pipe-actions:empty {
          display: none;
        }
        .act {
          font: inherit;
          font-size: 0.6875rem;
          font-weight: 600;
          padding: 0.25rem 0.625rem;
          border-radius: 999px;
          border: 1px solid var(--border, #e5e7eb);
          background: var(--card, #ffffff);
          cursor: pointer;
        }
        .act:hover:not(:disabled) {
          background: var(--accent, #f3f4f6);
        }
        .act:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .act-approve {
          background: var(--primary, #16a34a);
          border-color: var(--primary, #16a34a);
          color: var(--primary-foreground, #ffffff);
        }
        .act-reject {
          color: #991b1b;
          border-color: #fecaca;
        }
        .split {
          display: grid;
          grid-template-columns: 3fr 2fr;
          gap: 1rem;
          align-items: start;
        }
        .split.three {
          grid-template-columns: 1fr 1fr 1fr;
        }
        @container (max-width: 900px) {
          .split,
          .split.three {
            grid-template-columns: 1fr;
          }
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem;
          background: var(--card, #ffffff);
          min-width: 0;
        }
        .panel > :deep(.boxel-contains-many-editor) {
          padding: 0;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof RecruitingConsole> {
    <template>
      <div class='console-embedded'>
        <BriefcaseIcon class='icon' />
        <div>
          <div class='name'>{{@model.cardTitle}}</div>
          <div class='meta'>{{@model.candidates.length}}
            candidates ·
            {{@model.employees.length}}
            employees</div>
        </div>
      </div>
      <style scoped>
        .console-embedded {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
        }
        .icon {
          width: 24px;
          height: 24px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };
}

function getComponent(cardOrField: BaseDef) {
  return (cardOrField.constructor as typeof BaseDef).getComponent(cardOrField);
}
