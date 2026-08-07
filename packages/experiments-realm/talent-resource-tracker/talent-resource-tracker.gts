import {
  CardDef,
  Component,
  field,
  contains,
  linksToMany,
  realmURL,
  StringField,
} from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn, get } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
import {
  KanbanPlane,
  BoxelInput,
  type KanbanColumnConfig,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';
import { debounce } from 'lodash-es';
import { codeRef, type Query, type Filter } from '@cardstack/runtime-common';
import UsersRoundIcon from '@cardstack/boxel-icons/users-round';
import UsersIcon from '@cardstack/boxel-icons/users';
import ListChecksIcon from '@cardstack/boxel-icons/list-checks';
import ClockIcon from '@cardstack/boxel-icons/clock';
import { htmlSafe } from '@ember/template';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { Employee } from '../trt-employee';
import {
  Candidate,
  CANDIDATE_STAGES,
  CANDIDATE_STAGE_COLORS,
} from '../candidate';
import { Meeting } from '../meeting';
import { Team } from '../team';
import { Project, PROJECT_STATUS_COLORS } from '../project';
import { Vendor } from '../vendor';
import CardList from '@cardstack/base/components/card-list';
import { Calendar, type CalendarEvent } from '../components/calendar';
import { OrgTree, type OrgTreeItem } from '../components/org-tree';
import { RejectCandidateCommand } from '../commands/reject-candidate-command';
import { ApproveOfferCommand } from '../commands/approve-offer-command';
import {
  buildOrgTree,
  durationInDays,
  initialsOf,
  stateColorOf,
  type OrgNode,
} from '../utils/index';

const here: string = import.meta.url;
const employeeRef = codeRef(here, '../trt-employee', 'Employee');

const TABS = [
  'Dashboard',
  'Directory',
  'Pipeline',
  'Calendar',
  'Org Chart',
] as const;
type Tab = (typeof TABS)[number];

class Isolated extends Component<typeof TalentResourceTracker> {
  tabs = TABS;

  @tracked activeTab: Tab = 'Dashboard';
  @tracked actionError: string | undefined;
  @tracked busyCandidateId: string | undefined;
  @tracked directorySearch = '';
  @tracked directoryDept = 'all';

  get realms(): string[] {
    let url = this.args.model[realmURL]?.href;
    return url ? [url] : [];
  }

  get departments(): string[] {
    let seen = new Set<string>();
    for (let employee of this.employees) {
      if (employee.department) {
        seen.add(employee.department);
      }
    }
    return [...seen].sort();
  }

  get employeeQuery(): Query {
    let every: Filter[] = [{ type: employeeRef }];
    if (this.directorySearch) {
      every.push({ on: employeeRef, contains: { name: this.directorySearch } });
    }
    if (this.directoryDept !== 'all') {
      every.push({ on: employeeRef, eq: { department: this.directoryDept } });
    }
    return { filter: { every } };
  }

  setDirectoryDept = (dept: string) => {
    this.directoryDept = dept;
  };

  private debouncedSetDirectorySearch = debounce((value: string) => {
    this.directorySearch = value;
  }, 250);

  setDirectorySearch = (value: string) => {
    this.debouncedSetDirectorySearch(value);
  };

  get employees(): Employee[] {
    return (this.args.model.employees ?? []).filter(Boolean) as Employee[];
  }

  get candidates(): Candidate[] {
    return (this.args.model.candidates ?? []).filter(Boolean) as Candidate[];
  }

  get meetings(): Meeting[] {
    return (this.args.model.meetings ?? []).filter(Boolean) as Meeting[];
  }

  get headcount(): number {
    return this.employees.filter((e) => e.status !== 'offboarded').length;
  }

  get openPipeline(): number {
    return this.candidates.filter(
      (c) => c.status !== 'hired' && c.status !== 'rejected',
    ).length;
  }

  get avgTimeToHire(): string {
    let hired = this.candidates.filter(
      (c) => c.status === 'hired' && c.timeToHire?.value != null,
    );
    if (!hired.length) {
      return '—';
    }
    let totalDays = hired.reduce(
      (sum, c) => sum + durationInDays(c.timeToHire?.value, c.timeToHire?.unit),
      0,
    );
    return `${Math.round(totalDays / hired.length)} days`;
  }

  get todayLabel(): string {
    return new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  projectDotStyle = (status?: string | null) => {
    let color = stateColorOf(PROJECT_STATUS_COLORS, status);
    return htmlSafe(`background: ${color.ring};`);
  };

  get kanbanColumns(): KanbanColumnConfig[] {
    return CANDIDATE_STAGES.map((stage, index) => ({
      key: stage,
      label: stage,
      color: stateColorOf(CANDIDATE_STAGE_COLORS, stage).ring,
      collapsed: false,
      wipLimit: null,
      sortOrder: index,
    }));
  }

  // The board is a controlled component: it renders exactly what these
  // placements say and hands back new ones on drop. sortOrder is 1-based
  // within a column, so it is grouped per column here rather than reusing the
  // flat candidates index. Candidates with no boardOrder yet sort last, in
  // their existing link order.
  get kanbanPlacements(): KanbanPlacement[] {
    let byColumn = new Map<string, { index: number; order: number }[]>();
    this.candidates.forEach((candidate, index) => {
      let columnId = candidate.status ?? CANDIDATE_STAGES[0];
      let column = byColumn.get(columnId);
      if (!column) {
        column = [];
        byColumn.set(columnId, column);
      }
      column.push({ index, order: candidate.boardOrder ?? Infinity });
    });
    let placements: KanbanPlacement[] = [];
    for (let [columnId, entries] of byColumn) {
      entries
        .sort((a, b) => a.order - b.order || a.index - b.index)
        .forEach((entry, position) => {
          placements.push({
            columnId,
            index: entry.index,
            sortOrder: position + 1,
          });
        });
    }
    return placements;
  }

  candidateAt = (index: number): Candidate | undefined => {
    return this.candidates[index];
  };

  statusAt = (index: number): string | undefined => {
    return this.candidates[index]?.status;
  };

  canRejectAt = (index: number): boolean => {
    let status = this.candidates[index]?.status;
    return status !== 'hired' && status !== 'rejected' && status !== 'offer';
  };

  openCandidateAt = (index: number) => {
    let candidate = this.candidates[index];
    if (candidate) {
      this.openCard(candidate);
    }
  };

  handleKanbanChange = (newPlacements: KanbanPlacement[]) => {
    let reordered: Candidate[] = [];
    for (let placement of newPlacements) {
      let candidate = this.candidates[placement.index];
      if (!candidate) {
        continue;
      }
      let targetStage = placement.columnId;

      // Same column: a pure re-sort, so only the position needs persisting.
      if (candidate.status === targetStage) {
        if (candidate.boardOrder !== placement.sortOrder) {
          candidate.boardOrder = placement.sortOrder;
          reordered.push(candidate);
        }
        continue;
      }
      // Hired is terminal — leave the card where it is and let the board
      // re-render it back into its column.
      if (candidate.status === 'hired') {
        continue;
      }
      if (targetStage === 'hired' && candidate.status !== 'offer') {
        this.actionError = `Only candidates at the "offer" stage can be approved.`;
        continue;
      }
      // The stage commands below save the candidate, which carries the new
      // position along with the new status.
      candidate.boardOrder = placement.sortOrder;
      if (targetStage === 'hired') {
        void this.approve(candidate);
        continue;
      }
      if (targetStage === 'rejected') {
        void this.reject(candidate);
        continue;
      }
      void this.moveCandidateStage(candidate, targetStage);
    }
    if (reordered.length) {
      void this.saveCandidates(reordered);
    }
  };

  private async saveCandidates(candidates: Candidate[]) {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.actionError = 'Commands are unavailable in this mode';
      return;
    }
    let saveCard = new SaveCardCommand(commandContext);
    for (let candidate of candidates) {
      await saveCard.execute({ card: candidate } as any);
    }
  }

  private async moveCandidateStage(candidate: Candidate, status: string) {
    candidate.status = status as Candidate['status'];
    await this.saveCandidates([candidate]);
  }

  setTab = (tab: Tab) => {
    this.activeTab = tab;
  };

  get calendarEvents(): CalendarEvent[] {
    return this.meetings
      .filter((m) => m.date)
      .map((m) => ({
        id: m.id,
        title: m.title ?? 'Meeting',
        date: new Date(m.date!),
        kind: m.meetingType,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  get orgRoots(): OrgNode<OrgTreeItem>[] {
    let items = this.employees.map((e) => ({
      id: e.id,
      name: e.title,
      role: e.role,
      initials: initialsOf(e.name),
      photoUrl: e.photoUrl,
      status: e.status,
      managerId: e.manager?.id,
    }));
    return buildOrgTree(items, (item) => item.managerId);
  }

  openCard = (item: { id?: string }) => {
    if (!item.id) {
      return;
    }
    (this.args as any).viewCard?.(item, 'isolated');
  };

  openEvent = (event: CalendarEvent) => {
    this.openCard(event);
  };

  rescheduleEvent = async (event: CalendarEvent, newDate: Date) => {
    let meeting = this.meetings.find((m) => m.id === event.id);
    if (!meeting || !meeting.date) {
      return;
    }
    let oldDate = new Date(meeting.date);
    let updated = new Date(newDate);
    updated.setHours(
      oldDate.getHours(),
      oldDate.getMinutes(),
      oldDate.getSeconds(),
      0,
    );
    meeting.date = updated;
    this.actionError = undefined;
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.actionError = 'Commands are unavailable in this mode';
      return;
    }
    await new SaveCardCommand(commandContext).execute({
      card: meeting,
    } as any);
  };

  addMeeting = async (date: Date) => {
    this.actionError = undefined;
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.actionError = 'Commands are unavailable in this mode';
      return;
    }
    let realm = this.args.model[realmURL]?.href;
    let meeting = new Meeting({
      name: 'New Meeting',
      date,
    });
    let saved = (await new SaveCardCommand(commandContext).execute({
      card: meeting,
      realm,
    } as any)) as Meeting;
    this.args.model.meetings = [...(this.args.model.meetings ?? []), saved];
    await new SaveCardCommand(commandContext).execute({
      card: this.args.model,
    } as any);
    this.openCard(saved);
  };

  approve = async (candidate: Candidate) => {
    await this.runCommand(candidate, async (commandContext) => {
      await new ApproveOfferCommand(commandContext).execute({
        candidate,
      } as any);
    });
  };

  reject = async (candidate: Candidate) => {
    await this.runCommand(candidate, async (commandContext) => {
      await new RejectCandidateCommand(commandContext).execute({
        candidate,
      } as any);
    });
  };

  private async runCommand(
    candidate: Candidate,
    action: (commandContext: any) => Promise<void>,
  ) {
    this.actionError = undefined;
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.actionError = 'Commands are unavailable in this mode';
      return;
    }
    this.busyCandidateId = candidate.id;
    try {
      await action(commandContext);
    } catch (error: any) {
      this.actionError = error?.message ?? String(error);
    } finally {
      this.busyCandidateId = undefined;
    }
  }

  <template>
    <section class='tracker'>
      <header class='cover'>
        <div class='cover-top'>
          <div>
            <span class='cover-kicker'>Personnel Ledger</span>
            <h1 class='cover-title'>{{if
                @model.name
                @model.name
                'Talent & Resource Tracker'
              }}</h1>
          </div>
          <span class='cover-meta'>Posted through {{this.todayLabel}}</span>
        </div>
        <nav class='tabs'>
          {{#each this.tabs as |tab|}}
            <button
              type='button'
              class='tab {{if (eq tab this.activeTab) "active"}}'
              {{on 'click' (fn this.setTab tab)}}
            >{{tab}}</button>
          {{/each}}
        </nav>
      </header>

      <div class='page'>
        {{#if this.actionError}}
          <p class='error' role='alert'>{{this.actionError}}</p>
        {{/if}}

        {{#if (eq this.activeTab 'Dashboard')}}
          <div class='tab-section'>
            <p class='section-label'>Standing entries</p>
            <div class='ledger-row'>
              <div class='ledger-cell'>
                <div class='ledger-figure'>
                  <span class='seal'><UsersIcon role='presentation' /></span>
                  <span class='ledger-number'>{{this.headcount}}</span>
                </div>
                <span class='ledger-caption'>Active employees</span>
              </div>
              <div class='ledger-cell'>
                <div class='ledger-figure'>
                  <span class='seal'><ListChecksIcon
                      role='presentation'
                    /></span>
                  <span class='ledger-number'>{{this.openPipeline}}</span>
                </div>
                <span class='ledger-caption'>Open pipeline</span>
              </div>
              <div class='ledger-cell'>
                <div class='ledger-figure'>
                  <span class='seal'><ClockIcon role='presentation' /></span>
                  <span class='ledger-number'>{{this.avgTimeToHire}}</span>
                </div>
                <span class='ledger-caption'>Avg. time to hire</span>
              </div>
            </div>

            <div class='accounts'>
              <section class='account-col'>
                <h2>Teams</h2>
                {{#if @model.teams.length}}
                  <ul class='account-list'>
                    {{#each @model.teams as |team|}}
                      <li>
                        <button
                          type='button'
                          class='account-row'
                          {{on 'click' (fn this.openCard team)}}
                        >
                          <span class='account-name'>{{team.title}}</span>
                          <span class='account-meta'>{{team.headcount}}</span>
                        </button>
                      </li>
                    {{/each}}
                  </ul>
                {{else}}
                  <p class='empty-note'>No teams yet</p>
                {{/if}}
              </section>
              <section class='account-col'>
                <h2>Projects</h2>
                {{#if @model.projects.length}}
                  <ul class='account-list'>
                    {{#each @model.projects as |project|}}
                      <li>
                        <button
                          type='button'
                          class='account-row'
                          {{on 'click' (fn this.openCard project)}}
                        >
                          <span
                            class='dot'
                            style={{this.projectDotStyle project.status}}
                          ></span>
                          <span class='account-name'>{{project.title}}</span>
                          <span class='account-meta'>{{project.status}}</span>
                        </button>
                      </li>
                    {{/each}}
                  </ul>
                {{else}}
                  <p class='empty-note'>No projects yet</p>
                {{/if}}
              </section>
              <section class='account-col'>
                <h2>Vendors</h2>
                {{#if @model.vendors.length}}
                  <ul class='account-list'>
                    {{#each @model.vendors as |vendor|}}
                      <li>
                        <button
                          type='button'
                          class='account-row'
                          {{on 'click' (fn this.openCard vendor)}}
                        >
                          <span class='account-name'>{{vendor.title}}</span>
                          <span
                            class='account-meta'
                          >{{vendor.serviceCategory}}</span>
                        </button>
                      </li>
                    {{/each}}
                  </ul>
                {{else}}
                  <p class='empty-note'>No vendors yet</p>
                {{/if}}
              </section>
            </div>
          </div>
        {{/if}}

        {{#if (eq this.activeTab 'Directory')}}
          <div class='tab-section'>
            <div class='directory-filters'>
              <div class='directory-search'>
                <BoxelInput
                  @type='search'
                  @value={{this.directorySearch}}
                  @placeholder='Search employees…'
                  @onInput={{this.setDirectorySearch}}
                  aria-label='Search employees'
                />
              </div>
              <div class='directory-chips'>
                <button
                  type='button'
                  class='chip {{if (eq this.directoryDept "all") "active"}}'
                  {{on 'click' (fn this.setDirectoryDept 'all')}}
                >All</button>
                {{#each this.departments as |dept|}}
                  <button
                    type='button'
                    class='chip {{if (eq this.directoryDept dept) "active"}}'
                    {{on 'click' (fn this.setDirectoryDept dept)}}
                  >{{dept}}</button>
                {{/each}}
              </div>
            </div>
            <CardList
              class='directory'
              @query={{this.employeeQuery}}
              @realms={{this.realms}}
              @context={{@context}}
              @format='fitted'
              @viewOption='grid'
            />
          </div>
        {{/if}}

        {{#if (eq this.activeTab 'Pipeline')}}
          <div class='tab-section pipeline-section'>
            <KanbanPlane
              @boardLabel='Candidate Pipeline'
              @columns={{this.kanbanColumns}}
              @placements={{this.kanbanPlacements}}
              @onChange={{this.handleKanbanChange}}
              @onOpen={{this.openCandidateAt}}
              @cardSize='triple-strip'
            >
              <:card as |placement|>
                {{#let
                  (get @fields.candidates placement.index)
                  (this.candidateAt placement.index)
                  (this.statusAt placement.index)
                  as |CandidateField candidateModel candidateStatus|
                }}
                  {{#if CandidateField}}
                    <CandidateField
                      @format='fitted'
                      @displayContainer={{false}}
                    />
                  {{/if}}
                {{/let}}
              </:card>
              <:ghost as |dragIdx|>
                {{#let (get @fields.candidates dragIdx) as |CandidateField|}}
                  {{#if CandidateField}}
                    <CandidateField
                      @format='fitted'
                      @displayContainer={{false}}
                    />
                  {{/if}}
                {{/let}}
              </:ghost>
            </KanbanPlane>
          </div>
        {{/if}}

        {{#if (eq this.activeTab 'Calendar')}}
          <section class='tab-section'>
            <h2 class='visually-hidden'>Interview Calendar</h2>
            <Calendar
              @events={{this.calendarEvents}}
              @onSelectEvent={{this.openEvent}}
              @onRescheduleEvent={{this.rescheduleEvent}}
              @onAddMeeting={{this.addMeeting}}
            />
          </section>
        {{/if}}

        {{#if (eq this.activeTab 'Org Chart')}}
          <section class='tab-section'>
            <h2 class='visually-hidden'>Organization Chart</h2>
            <OrgTree @roots={{this.orgRoots}} @onSelect={{this.openCard}} />
          </section>
        {{/if}}
      </div>
    </section>
    <style scoped>
      .tracker {
        --tracker-radius: var(--radius, var(--boxel-border-radius));
        height: 100%;
        overflow-y: auto;
        color: var(--foreground, var(--boxel-dark));
        font-family: var(--font-sans, var(--boxel-font-family));
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
      }
      .cover {
        background: var(--cover, var(--primary, var(--boxel-highlight)));
        color: var(--cover-ink, var(--primary-foreground, var(--boxel-light)));
        padding: var(--boxel-sp) var(--boxel-sp-lg) 0;
      }
      .cover-top {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--boxel-sp);
        padding-bottom: var(--boxel-sp);
      }
      .cover-kicker {
        display: block;
        font-family: var(--font-mono, monospace);
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--secondary, var(--cover-ink));
        margin-bottom: var(--boxel-sp-5xs);
      }
      .cover-title {
        margin: 0;
        font-family: var(--font-serif, serif);
        font-weight: 600;
        font-size: var(--boxel-font-size-lg);
        color: var(--cover-ink);
      }
      .cover-meta {
        font-family: var(--font-mono, monospace);
        font-size: var(--boxel-font-size-xs);
        color: var(--secondary, var(--cover-ink));
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .tabs {
        display: flex;
        gap: 2px;
        flex-wrap: wrap;
        padding-left: var(--boxel-sp-4xs);
      }
      .tab {
        border: none;
        font-family: var(--font-sans, var(--boxel-font-family));
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        color: var(--cover-ink);
        background: color-mix(
          in srgb,
          var(--cover, var(--primary)) 65%,
          black 8%
        );
        padding: var(--boxel-sp-xs) var(--boxel-sp) var(--boxel-sp-5xs);
        clip-path: polygon(8% 0, 100% 0, 92% 100%, 0 100%);
        opacity: 0.72;
        transform: translateY(0.05rem);
        cursor: pointer;
        transition:
          opacity 0.15s ease-out,
          transform 0.15s ease-out,
          background-color 0.15s ease-out;
      }
      .tab:hover {
        opacity: 0.92;
      }
      .tab.active {
        background: var(--card, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        opacity: 1;
        transform: translateY(0);
      }
      .page {
        background: var(--card, var(--boxel-light));
        padding: var(--boxel-sp-lg);
      }
      .tab-section {
        animation: tracker-tab-fade-in 0.2s ease-out;
      }
      @keyframes tracker-tab-fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .tab-section {
          animation: none;
        }
      }
      .error {
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        border-radius: var(--tracker-radius);
        background: var(--destructive, #a3503a);
        color: var(--destructive-foreground, #f3ecda);
        font-size: var(--boxel-font-size-sm);
        margin: 0 0 var(--boxel-sp);
      }
      .section-label {
        font-family: var(--font-mono, monospace);
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--muted-foreground, var(--boxel-450));
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin: 0 0 var(--boxel-sp);
      }
      .section-label::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border, var(--boxel-200));
      }
      .ledger-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        border-top: 1px solid var(--foreground, var(--boxel-dark));
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .ledger-cell {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        border-left: 1px solid var(--border, var(--boxel-200));
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
      }
      .ledger-cell:first-child {
        border-left: none;
      }
      .ledger-figure {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
      }
      .seal {
        width: 1.6rem;
        height: 1.6rem;
        border-radius: 50%;
        border: 1.5px solid var(--secondary, var(--boxel-highlight));
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        color: var(--secondary, var(--boxel-highlight));
      }
      .seal svg {
        width: 0.85rem;
        height: 0.85rem;
      }
      .ledger-number {
        font-family: var(--font-serif, serif);
        font-size: var(--boxel-font-size-xl);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        line-height: 1;
        color: var(--foreground, var(--boxel-dark));
      }
      .ledger-caption {
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .accounts {
        margin-top: var(--boxel-sp-xl);
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: var(--boxel-sp-lg);
      }
      .account-col h2 {
        font-family: var(--font-serif, serif);
        font-size: var(--boxel-font-size);
        font-weight: 600;
        margin: 0 0 var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-5xs);
        border-bottom: 1px solid var(--foreground, var(--boxel-dark));
      }
      .account-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .account-list li {
        border-bottom: 1px dotted var(--border, var(--boxel-200));
      }
      .account-list li:last-child {
        border-bottom: none;
      }
      .account-row {
        width: 100%;
        border: none;
        background: none;
        padding: var(--boxel-sp-xs) 0;
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        font-family: inherit;
        color: inherit;
        cursor: pointer;
        text-align: left;
        transition: color 0.15s ease-out;
      }
      .account-row:hover {
        color: var(--secondary, var(--boxel-highlight));
      }
      .dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        flex: none;
        margin-top: 0.3rem;
      }
      .account-name {
        font-weight: 600;
        font-size: var(--boxel-font-size-sm);
      }
      .account-meta {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        margin-left: auto;
        white-space: nowrap;
        text-transform: capitalize;
      }
      .empty-note {
        margin: var(--boxel-sp-xs) 0 0;
        font-size: var(--boxel-font-size-sm);
        font-style: italic;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .directory-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp);
        margin-bottom: var(--boxel-sp);
      }
      .directory-search {
        flex: 1;
        min-width: 12rem;
        max-width: 20rem;
      }
      .directory-chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-4xs);
      }
      .chip {
        border: 1px solid var(--border, var(--boxel-200));
        background: var(--card, var(--boxel-light));
        color: var(--muted-foreground, var(--boxel-450));
        border-radius: 999px;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        font-family: var(--font-sans, var(--boxel-font-family));
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        cursor: pointer;
        transition:
          background-color 0.15s ease-out,
          color 0.15s ease-out,
          border-color 0.15s ease-out;
      }
      .chip:hover {
        border-color: var(--secondary, var(--boxel-highlight));
      }
      .chip.active {
        background: var(--primary, var(--boxel-highlight));
        color: var(--primary-foreground, var(--boxel-light));
        border-color: var(--primary, var(--boxel-highlight));
      }
      .directory {
        --embedded-card-min-height: 65px;
      }
      /* Portrait tiles that fill the row instead of CardList's fixed 170px
         grid columns. The descendant selector outranks the addon's own
         .grid-view rule. */
      .tab-section > .directory {
        --item-width: auto;
        --item-height: 14rem;
        grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
      }
      .pipeline-section {
        height: 640px;
        --boxel-kanban-bg: var(--muted, var(--boxel-100));
        --boxel-kanban-fg: var(--foreground, var(--boxel-dark));
        --boxel-kanban-card-bg: var(--card, var(--boxel-light));
        --boxel-kanban-card-fg: var(--foreground, var(--boxel-dark));
        --boxel-kanban-muted-fg: var(--muted-foreground, var(--boxel-450));
        --boxel-kanban-border: var(--border, var(--boxel-200));
      }
      .pipeline-section :deep(.boxel-fitted-card-container) {
        width: 100%;
        height: auto !important;
      }
      .pipeline-section :deep(.fitted-format) {
        height: 120px;
      }
      .candidate-actions {
        display: flex;
        gap: var(--boxel-sp-4xs);
        padding: 0 var(--boxel-sp-xs) var(--boxel-sp-xs);
      }
      .action {
        border: 1px solid currentColor;
        border-radius: 0;
        background: none;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        font-family: var(--font-mono, monospace);
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        cursor: pointer;
        transition:
          transform 0.1s ease-out,
          opacity 0.15s ease-out;
      }
      .action:hover:not(:disabled) {
        transform: translateY(-0.0625rem);
      }
      .action:disabled {
        cursor: wait;
        pointer-events: none;
        animation: action-busy-pulse 1s ease-in-out infinite;
      }
      @keyframes action-busy-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.55;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .action:disabled {
          animation: none;
          opacity: 0.55;
        }
      }
      .action.approve {
        color: var(--secondary, var(--boxel-highlight));
      }
      .action.reject {
        color: var(--oxblood, var(--destructive));
      }
    </style>
  </template>
}

export class TalentResourceTracker extends CardDef {
  static displayName = 'Talent & Resource Tracker';
  static icon = UsersRoundIcon;
  static prefersWideFormat = true;

  @field name = contains(StringField);
  @field employees = linksToMany(() => Employee);
  @field candidates = linksToMany(() => Candidate);
  @field meetings = linksToMany(() => Meeting);
  @field teams = linksToMany(() => Team);
  @field projects = linksToMany(() => Project);
  @field vendors = linksToMany(() => Vendor);

  @field title = contains(StringField, {
    computeVia: function (this: TalentResourceTracker) {
      return this.name?.trim() || 'Talent & Resource Tracker';
    },
  });

  static isolated = Isolated;
}
