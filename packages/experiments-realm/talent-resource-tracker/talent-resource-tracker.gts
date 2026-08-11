import {
  CardDef,
  Component,
  field,
  contains,
  linksToMany,
  realmURL,
  StringField,
  type Format,
  type ViewCardFn,
  type CreateCardFn,
} from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn, get } from '@ember/helper';
import { eq, or } from '@cardstack/boxel-ui/helpers';
import {
  KanbanPlane,
  BoxelInput,
  FilterList,
  DateRangePicker,
  Button,
  IconButton,
  type KanbanColumnConfig,
  type KanbanPlacement,
  type Filter as NavFilter,
} from '@cardstack/boxel-ui/components';
import type { NormalizeRangeActionValue } from 'ember-power-calendar/utils';
import { debounce } from 'lodash-es';
import {
  codeRef,
  type Query,
  type Filter,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import UsersRoundIcon from '@cardstack/boxel-icons/users-round';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import ListIcon from '@cardstack/boxel-icons/list';
import TableIcon from '@cardstack/boxel-icons/table';
import { htmlSafe } from '@ember/template';
import { restartableTask } from 'ember-concurrency';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { Employee } from '../employee';
import {
  Candidate,
  CANDIDATE_STAGES,
  CANDIDATE_STAGE_COLORS,
} from '../candidate';
import { Meeting } from '../meeting';
import { Team } from '../team';
import { Project, PROJECT_STATUS_COLORS } from '../project';
import { Vendor } from '../vendor';
import { Contractor } from '../contractor';
import { JobRequisition } from '../job-requisition';
import { OnboardingChecklist } from '../onboarding-checklist';
import CardList from '@cardstack/base/components/card-list';
import { Calendar, type CalendarEvent } from '../components/calendar';
import { OrgTree, type OrgTreeItem } from '../components/org-tree';
import { BarChart } from '../components/bar-chart';
import { Position, POSITION_STATUS_COLORS } from '../position';
import { Application, APPLICATION_STATUS_COLORS } from '../application';
import { Offer, offerStatusLabel } from '../offer';
import { RejectCandidateCommand } from '../commands/reject-candidate-command';
import { ApproveOfferCommand } from '../commands/approve-offer-command';
import { ExtractResumeCommand } from '../commands/extract-resume-command';
import { ScreenApplicationCommand } from '../commands/screen-application-command';
import { ExtendOfferCommand } from '../commands/extend-offer-command';
import { AdvanceToOfferCommand } from '../commands/advance-to-offer-command';
import { RejectCandidateDialog } from '../components/reject-candidate-dialog';
import { REJECTION_REASON_LABELS } from '../rejection-reason-field';
import {
  buildOrgTree,
  daysBetween,
  durationInDays,
  initialsOf,
  stateColorOf,
  type OrgNode,
} from '../utils/index';

const here: string = import.meta.url;
const employeeRef = codeRef(here, '../employee', 'Employee');
const meetingRef = codeRef(here, '../meeting', 'Meeting');

const TABS = [
  'Dashboard',
  'Positions',
  'Applications',
  'Pipeline',
  'Offers',
  'Requisitions',
  'Onboarding',
  'Contractors',
  'Directory',
  'Calendar',
  'Org Chart',
] as const;
type Tab = (typeof TABS)[number];

interface PositionNavFilter extends NavFilter {
  positionId?: string;
}

class Isolated extends Component<typeof TalentResourceTracker> {
  tabs = TABS;

  @tracked activeTab: Tab = 'Dashboard';
  @tracked actionError: string | undefined;
  @tracked busyCandidateId: string | undefined;
  // The candidate currently targeted by the reject dialog. One dialog
  // instance renders near the top of the template rather than one per
  // Kanban card — see RejectCandidateDialog.
  @tracked rejectDialogCandidate: Candidate | undefined;
  @tracked busyApplicationId: string | undefined;
  @tracked directorySearch = '';
  @tracked directoryDept = 'all';
  @tracked directoryView: 'grid' | 'strip' = 'strip';
  @tracked positionsSearch = '';
  @tracked positionsView: 'grid' | 'strip' | 'table' = 'table';
  @tracked applicationsSearch = '';
  @tracked applicationsView: 'grid' | 'strip' | 'table' = 'grid';
  @tracked offersSearch = '';
  @tracked offersView: 'grid' | 'strip' = 'grid';
  @tracked requisitionsSearch = '';
  @tracked requisitionStatusFilter = 'all';
  @tracked onboardingSearch = '';
  @tracked contractorSearch = '';
  @tracked contractorStatusFilter = 'all';
  @tracked reviewMode = false;
  @tracked reviewIndex = 0;
  @tracked reviewedCount = 0;
  // Transient UI-only filter for the Dashboard tab — never persisted to the
  // model. Undefined on both ends means "show everything", exactly like
  // before this filter existed.
  @tracked dashboardRange: { start: Date | undefined; end: Date | undefined } =
    { start: undefined, end: undefined };
  @tracked dashboardFilterOpen = false;

  setDirectoryView = (view: 'grid' | 'strip') => {
    this.directoryView = view;
  };
  setPositionsView = (view: 'grid' | 'strip' | 'table') => {
    this.positionsView = view;
  };
  setApplicationsView = (view: 'grid' | 'strip' | 'table') => {
    this.applicationsView = view;
  };
  setOffersView = (view: 'grid' | 'strip') => {
    this.offersView = view;
  };

  private debouncedSetPositionsSearch = debounce((value: string) => {
    this.positionsSearch = value;
  }, 250);

  setPositionsSearch = (value: string) => {
    this.debouncedSetPositionsSearch(value);
  };

  private debouncedSetApplicationsSearch = debounce((value: string) => {
    this.applicationsSearch = value;
  }, 250);

  setApplicationsSearch = (value: string) => {
    this.debouncedSetApplicationsSearch(value);
  };

  private debouncedSetOffersSearch = debounce((value: string) => {
    this.offersSearch = value;
  }, 250);

  setOffersSearch = (value: string) => {
    this.debouncedSetOffersSearch(value);
  };

  get filteredPositions(): { item: Position; index: number }[] {
    let q = this.positionsSearch.trim().toLowerCase();
    return this.positions
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          !q ||
          item.title?.toLowerCase().includes(q) ||
          item.department?.toLowerCase().includes(q),
      );
  }

  get filteredApplications(): { item: Application; index: number }[] {
    let q = this.applicationsSearch.trim().toLowerCase();
    return this.applications
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          !q ||
          item.name?.toLowerCase().includes(q) ||
          item.position?.title?.toLowerCase().includes(q),
      );
  }

  get filteredOffers(): { item: Offer; index: number }[] {
    let q = this.offersSearch.trim().toLowerCase();
    // Offers are time-sensitive — the one expiring in 3 days matters more
    // than the one from last month, regardless of when either was created.
    return this.offers
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          !q ||
          item.title?.toLowerCase().includes(q) ||
          item.position?.title?.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // Drafts first: those wait on US to send them, while an extended
        // offer waits on the candidate. For a work queue, "whose turn is it"
        // orders better than "when was it made".
        let aDraft = a.item.status === 'draft' ? 0 : 1;
        let bDraft = b.item.status === 'draft' ? 0 : 1;
        if (aDraft !== bDraft) {
          return aDraft - bDraft;
        }
        let aExp = a.item.expirationDate
          ? new Date(a.item.expirationDate).getTime()
          : Infinity;
        let bExp = b.item.expirationDate
          ? new Date(b.item.expirationDate).getTime()
          : Infinity;
        return aExp - bExp;
      });
  }

  get acceptRateLabel(): string {
    let decided = this.offers.filter(
      (o) => o.status === 'accepted' || o.status === 'declined',
    );
    if (!decided.length) {
      return '—';
    }
    let accepted = decided.filter((o) => o.status === 'accepted').length;
    return `${Math.round((accepted / decided.length) * 100)}%`;
  }

  get medianTimeToOfferLabel(): string {
    let days = this.offers
      .filter((o) => o.candidate?.appliedDate && o.extendedDate)
      .map((o) =>
        daysBetween(
          new Date(o.candidate!.appliedDate!),
          new Date(o.extendedDate!),
        ),
      )
      .filter((d): d is number => d != null && d >= 0)
      .sort((a, b) => a - b);
    if (!days.length) {
      return '—';
    }
    let mid = Math.floor(days.length / 2);
    let median =
      days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2);
    return `${median} days`;
  }

  get topRejectionReasonLabel(): string {
    let rejected = this.candidates.filter(
      (c) => c.status === 'rejected' && c.rejectionReason,
    );
    if (!rejected.length) {
      return '—';
    }
    let counts = new Map<string, number>();
    for (let c of rejected) {
      let reason = c.rejectionReason!;
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    let [topReason, topCount] = [...counts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0];
    let label = REJECTION_REASON_LABELS[topReason] ?? topReason;
    return `${label} · ${topCount}/${rejected.length}`;
  }

  get expiringOfferCount(): number {
    let now = Date.now();
    let sevenDays = 7 * 24 * 60 * 60 * 1000;
    return this.offers.filter(
      (o) =>
        o.status === 'extended' &&
        o.expirationDate &&
        new Date(o.expirationDate).getTime() - now <= sevenDays &&
        new Date(o.expirationDate).getTime() - now >= 0,
    ).length;
  }

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
    // Scoped to exactly this tracker's own linked employees — the same
    // source `departments` reads from — so the chip list and the search
    // results can never disagree about who's in the directory.
    let ids = this.employees.map((e) => e.id).filter(Boolean) as string[];
    let every: Filter[] = [
      { type: employeeRef },
      { on: employeeRef, in: { id: ids } },
    ];
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

  get positions(): Position[] {
    return (this.args.model.positions ?? []).filter(Boolean) as Position[];
  }

  // Deleting a card does not rewrite the cards that link to it, so a
  // linksToMany can hold a reference whose target is gone. A dead slot reads
  // as `undefined`, which would otherwise render as an empty row here.
  get teams(): Team[] {
    return (this.args.model.teams ?? []).filter(Boolean) as Team[];
  }

  get projects(): Project[] {
    return (this.args.model.projects ?? []).filter(Boolean) as Project[];
  }

  get vendors(): Vendor[] {
    return (this.args.model.vendors ?? []).filter(Boolean) as Vendor[];
  }

  // Positions need horizontal comparison, not a card grid — which is open
  // longest, which has gone quiet. "Stalled" is computed, not a status
  // anyone sets by hand: open 30+ days with zero new applicants this week.
  get positionsTableRows(): Array<{
    position: Position;
    openDays: number | null;
    applicantCount: number;
    weeklyNew: number;
    interviewingCount: number;
    trendPoints: string;
    stalled: boolean;
    tone: 'red' | 'green' | 'mute';
  }> {
    let now = new Date();
    return this.positions.map((position) => {
      let apps = this.applications.filter(
        (a) => a.position?.id === position.id,
      );
      let openDays = position.postedDate
        ? daysBetween(new Date(position.postedDate), now)
        : null;
      let weeklyNew = apps.filter(
        (a) =>
          a.appliedDate &&
          (daysBetween(new Date(a.appliedDate), now) ?? 99) <= 7,
      ).length;
      let interviewingCount = this.candidates.filter(
        (c) => c.position?.id === position.id && c.status === 'interviewing',
      ).length;
      let buckets = [0, 0, 0, 0];
      for (let a of apps) {
        if (!a.appliedDate) continue;
        let age = daysBetween(new Date(a.appliedDate), now);
        if (age == null || age < 0 || age > 28) continue;
        buckets[3 - Math.min(3, Math.floor(age / 7))] += 1;
      }
      let maxBucket = Math.max(1, ...buckets);
      let trendPoints = buckets
        .map((v, i) => {
          let x = Math.round((i / (buckets.length - 1)) * 76) + 2;
          let y = 18 - Math.round((v / maxBucket) * 14);
          return `${x},${y}`;
        })
        .join(' ');
      let stalled =
        position.status === 'open' && (openDays ?? 0) >= 30 && weeklyNew === 0;
      let tone: 'red' | 'green' | 'mute' =
        position.status !== 'open' ? 'mute' : stalled ? 'red' : 'green';
      return {
        position,
        openDays,
        applicantCount: apps.length,
        weeklyNew,
        interviewingCount,
        trendPoints,
        stalled,
        tone,
      };
    });
  }

  get applications(): Application[] {
    return (this.args.model.applications ?? []).filter(
      Boolean,
    ) as Application[];
  }

  get offers(): Offer[] {
    return (this.args.model.offers ?? []).filter(Boolean) as Offer[];
  }

  get requisitions(): JobRequisition[] {
    return (this.args.model.requisitions ?? []).filter(Boolean) as JobRequisition[];
  }

  get contractors(): Contractor[] {
    return (this.args.model.contractors ?? []).filter(Boolean) as Contractor[];
  }

  get activeChecklists(): OnboardingChecklist[] {
    let all = (this.args.model.onboardingChecklists ?? []).filter(Boolean) as OnboardingChecklist[];
    return all.filter((c) => c.status !== 'complete');
  }

  isRequisitionStatus = (req: JobRequisition, status: string): boolean => {
    return (req.requisitionStatus ?? 'draft') === status;
  };

  // True when `date` falls inside `dashboardRange`, or when no range is set
  // (both ends undefined) — the Dashboard's unfiltered, show-everything
  // default. `end` is treated as inclusive of its whole day so picking the
  // same start/end date still matches same-day records.
  inDashboardRange = (date?: Date | string | null): boolean => {
    let { start, end } = this.dashboardRange;
    if (!start && !end) {
      return true;
    }
    if (!date) {
      return false;
    }
    let d = new Date(date);
    if (isNaN(d.getTime())) {
      return false;
    }
    if (start && d < start) {
      return false;
    }
    if (end) {
      let endOfDay = new Date(end);
      endOfDay.setHours(23, 59, 59, 999);
      if (d > endOfDay) {
        return false;
      }
    }
    return true;
  };

  get dashboardRangeSelected(): { start: Date | null; end: Date | null } {
    return {
      start: this.dashboardRange.start ?? null,
      end: this.dashboardRange.end ?? null,
    };
  }

  onDashboardRangeSelect = (selected: NormalizeRangeActionValue) => {
    this.dashboardRange = {
      start: selected.date.start ?? undefined,
      end: selected.date.end ?? undefined,
    };
  };

  clearDashboardRange = () => {
    this.dashboardRange = { start: undefined, end: undefined };
    this.dashboardFilterOpen = false;
  };

  toggleDashboardFilter = () => {
    this.dashboardFilterOpen = !this.dashboardFilterOpen;
  };

  get dashboardRangeLabel(): string {
    let { start, end } = this.dashboardRange;
    if (!start && !end) {
      return 'All time';
    }
    let fmt = (d?: Date) =>
      d
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '…';
    return `${fmt(start)} – ${fmt(end)}`;
  }

  // Application → Candidate has no persisted link (converting an
  // application creates an independent Candidate — see
  // ScreenApplicationCommand). Matching on email, falling back to name,
  // mirrors the only correlation that command itself establishes.
  matchedCandidateFor = (app: Application): Candidate | undefined => {
    let email = app.email?.trim().toLowerCase();
    if (email) {
      let found = this.candidates.find(
        (c) => c.email?.trim().toLowerCase() === email,
      );
      if (found) {
        return found;
      }
    }
    let name = app.name?.trim().toLowerCase();
    if (!name) {
      return undefined;
    }
    return this.candidates.find((c) => c.name?.trim().toLowerCase() === name);
  };

  // Applications grouped by their free-text `source`, with a hire
  // conversion rate per source. Sourced from `appliedDate`-filtered
  // applications so the Dashboard date range narrows this like every other
  // panel.
  get sourceEffectiveness(): Array<{
    source: string;
    applied: number;
    hired: number;
    conversionPct: number;
  }> {
    let applications = this.applications.filter((a) =>
      this.inDashboardRange(a.appliedDate),
    );
    if (!applications.length) {
      return [];
    }
    let groups = new Map<string, Application[]>();
    for (let app of applications) {
      let key = app.source?.trim() || 'Unknown';
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(app);
    }
    return Array.from(groups.entries())
      .map(([source, apps]) => {
        let applied = apps.length;
        let hired = apps.filter(
          (a) => this.matchedCandidateFor(a)?.status === 'hired',
        ).length;
        let conversionPct =
          applied > 0 ? Math.round((hired / applied) * 100) : 0;
        return { source, applied, hired, conversionPct };
      })
      .sort((a, b) => b.applied - a.applied);
  }

  // BarChart data for the Source Effectiveness panel — bar length is the
  // conversion rate, the trailing label spells out the counts behind it.
  get sourceEffectivenessChartData(): Array<{ label: string; value: number }> {
    return this.sourceEffectiveness.map((row) => ({
      label: row.source,
      value: row.conversionPct,
    }));
  }

  formatSourceEffectiveness = (value: number, label: string): string => {
    let row = this.sourceEffectiveness.find((r) => r.source === label);
    if (!row) {
      return `${value}%`;
    }
    return `${row.applied} applied · ${row.hired} hired · ${value}%`;
  };

  get headcount(): number {
    return this.employees.filter((e) => e.status !== 'offboarded').length;
  }

  get openPipeline(): number {
    return this.candidates.filter(
      (c) => c.status !== 'hired' && c.status !== 'rejected',
    ).length;
  }

  get openReqs(): number {
    return this.positions.filter((p) => p.status === 'open').length;
  }

  get dashboardPipelinePreview(): {
    key: string;
    label: string;
    candidates: Candidate[];
  }[] {
    let previewStages = ['applied', 'screening', 'interviewing', 'offer'];
    return previewStages.map((stage) => ({
      key: stage,
      label: stage,
      candidates: this.candidates.filter((c) => c.status === stage),
    }));
  }

  get avgTimeToHire(): string {
    let candidates = this.candidates.filter((c) =>
      this.inDashboardRange(c.decisionDate ?? c.appliedDate),
    );
    let hired = candidates.filter(
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

  // Whose turn is it — a candidate's own status tells you WHERE they are;
  // this tells you WHO needs to act next. Dashboard's "needs us" count and
  // Pipeline's card badges both read from this single source of truth.
  whoseTurn = (
    candidate: Candidate,
  ): { tone: 'red' | 'amber' | 'green'; label: string } => {
    let status = candidate.status;
    // Matches on the denormalized candidateId scalar, not `m.candidate?.id`
    // — this runs once per candidate on every Dashboard render, and reading
    // the `candidate` linksTo there races the async link load the same way
    // it did for the `offer` linksTo above.
    let meetings = this.meetings.filter((m) => m.candidateId === candidate.id);
    if (status === 'applied') {
      return { tone: 'red', label: 'Needs screening' };
    }
    if (status === 'screening') {
      let hasUpcoming = meetings.some(
        (m) => m.date && new Date(m.date).getTime() > Date.now(),
      );
      return hasUpcoming
        ? { tone: 'green', label: 'Interview scheduled' }
        : { tone: 'red', label: 'Needs interview scheduled' };
    }
    if (status === 'interviewing') {
      let overdue = meetings.filter(
        (m) =>
          m.date &&
          new Date(m.date).getTime() < Date.now() &&
          m.interviewScore == null,
      ).length;
      if (overdue > 0) {
        return {
          tone: 'red',
          label: `${overdue} feedback${overdue > 1 ? 's' : ''} overdue`,
        };
      }
      let hasUpcoming = meetings.some(
        (m) => m.date && new Date(m.date).getTime() > Date.now(),
      );
      return hasUpcoming
        ? { tone: 'green', label: 'Interview scheduled' }
        : { tone: 'amber', label: 'Awaiting next step' };
    }
    if (status === 'offer') {
      // The board only answers "whose turn is it". The offer's own
      // lifecycle — terms, dates, draft vs sent — belongs on the Offer
      // card; mirroring it here produced five labels for two situations.
      // Reads the scalar, never the linksTo: resolving a link in this
      // getter (it runs per candidate per render) races the async load
      // and trips Ember's "updated after use" assertion.
      return candidate.offerState === 'extended'
        ? { tone: 'amber', label: 'Awaiting candidate reply' }
        : { tone: 'red', label: 'Offer not sent' };
    }
    return { tone: 'green', label: status ?? '' };
  };

  get needsUsCount(): number {
    return this.candidates.filter(
      (c) =>
        c.status !== 'hired' &&
        c.status !== 'rejected' &&
        this.whoseTurn(c).tone === 'red',
    ).length;
  }

  get overdueFeedbackCount(): number {
    let now = Date.now();
    return this.meetings.filter(
      (m) =>
        m.date && new Date(m.date).getTime() < now && m.interviewScore == null,
    ).length;
  }

  // A simplified funnel over CURRENT candidate state (this app has no
  // stage-transition history to build a true historical cohort funnel from):
  // each stage counts candidates who have reached that stage or further,
  // excluding anyone rejected. Pass-through % is the ratio to the stage
  // before it; dwell is the average days-since-applied for whoever is
  // sitting AT that exact stage right now.
  get funnelStages(): Array<{
    key: string;
    label: string;
    count: number;
    barPct: number;
    passThroughPct: number | null;
    dwellDays: number | null;
  }> {
    let applications = this.applications.filter((a) =>
      this.inDashboardRange(a.appliedDate),
    );
    let candidates = this.candidates.filter((c) =>
      this.inDashboardRange(c.appliedDate),
    );
    let order: { key: string; label: string }[] = [
      { key: 'applied', label: 'Applied' },
      { key: 'screening', label: 'Screening' },
      { key: 'interviewing', label: 'Interviewing' },
      { key: 'offer', label: 'Offer' },
      { key: 'hired', label: 'Hired' },
    ];
    let reached = (statuses: string[]) =>
      candidates.filter((c) => statuses.includes(c.status ?? '')).length;
    let counts: Record<string, number> = {
      applied: applications.length,
      screening: candidates.length,
      interviewing: reached(['interviewing', 'offer', 'hired']),
      offer: reached(['offer', 'hired']),
      hired: reached(['hired']),
    };
    let maxCount = Math.max(1, ...Object.values(counts));
    let prev: number | null = null;
    return order.map(({ key, label }) => {
      let count = counts[key];
      let passThroughPct =
        prev != null && prev > 0 ? Math.round((count / prev) * 100) : null;
      prev = count;
      let atStage =
        key === 'applied'
          ? applications.filter((a) => a.status !== 'converted')
          : candidates.filter((c) => c.status === key);
      let days = atStage
        .map((item) =>
          item.appliedDate
            ? daysBetween(new Date(item.appliedDate), new Date())
            : null,
        )
        .filter((d): d is number => d != null && d >= 0);
      let dwellDays = days.length
        ? Math.round(days.reduce((a, b) => a + b, 0) / days.length)
        : null;
      let barPct = Math.max(4, Math.round((count / maxCount) * 100));
      return { key, label, count, barPct, passThroughPct, dwellDays };
    });
  }

  // BarChart data for the funnel panel — count per stage.
  get funnelChartData(): Array<{ label: string; value: number }> {
    return this.funnelStages.map((stage) => ({
      label: stage.label,
      value: stage.count,
    }));
  }

  // Trailing label for the funnel BarChart — folds pass-through and dwell
  // time into the same line the hand-rolled funnel used to show underneath
  // each bar.
  formatFunnelStage = (value: number, label: string): string => {
    let stage = this.funnelStages.find((s) => s.label === label);
    if (!stage) {
      return String(value);
    }
    let parts = [String(value)];
    if (stage.passThroughPct != null) {
      parts.push(`${stage.passThroughPct}% pass-through`);
    }
    if (stage.dwellDays != null) {
      parts.push(`${stage.dwellDays}d median`);
    }
    return parts.join(' · ');
  };

  get slowestFunnelStage(): { label: string; dwellDays: number } | undefined {
    let candidates = this.funnelStages.filter(
      (s) => s.dwellDays != null && s.key !== 'hired',
    );
    if (!candidates.length) {
      return undefined;
    }
    let slowest = candidates.reduce((a, b) =>
      (b.dwellDays as number) > (a.dwellDays as number) ? b : a,
    );
    return { label: slowest.label, dwellDays: slowest.dwellDays as number };
  }

  get offerRatioLabel(): string {
    let applied = this.applications.length;
    let hired = this.funnelStages.find((s) => s.key === 'hired')?.count ?? 0;
    if (!applied || !hired) {
      return '—';
    }
    return `${Math.round(applied / hired)}:1`;
  }

  // Interviewer load — sum of this-week interview meeting duration per
  // interviewer, against each employee's own capacity (falls back to 5h/wk
  // when unset).
  get interviewerLoad(): Array<{
    employee: Employee;
    hours: number;
    capacityHours: number;
    tone: 'red' | 'amber' | 'green';
  }> {
    let meetings = this.meetings.filter((m) => this.inDashboardRange(m.date));
    let now = new Date();
    let weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    let weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    let thisWeekMeetings = meetings.filter((m) => {
      if (!m.date) return false;
      let d = new Date(m.date);
      return d >= weekStart && d < weekEnd;
    });
    return this.employees
      .filter((e) => e.status !== 'offboarded')
      .map((employee) => {
        let hours = thisWeekMeetings
          .filter((m) =>
            (m.interviewers ?? []).some((i) => i?.id === employee.id),
          )
          .reduce(
            (sum, m) =>
              sum + durationInDays(m.duration?.value, m.duration?.unit) * 24,
            0,
          );
        let capacityHours = employee.weeklyInterviewCapacityHours ?? 5;
        let tone: 'red' | 'amber' | 'green' =
          hours >= capacityHours
            ? 'red'
            : hours >= capacityHours * 0.8
              ? 'amber'
              : 'green';
        return {
          employee,
          hours: Math.round(hours * 10) / 10,
          capacityHours,
          tone,
        };
      })
      .filter((row) => row.hours > 0)
      .sort((a, b) => b.hours - a.hours);
  }

  // Calibration — average score an interviewer gives, and how it compares
  // to the app-wide average across everyone else's scored interviews. This
  // surfaces systematically loose or harsh graders, not just busy ones.
  get calibration(): Array<{
    employee: Employee;
    avgScore: number;
    count: number;
    tone: 'amber' | 'green';
    label: string;
  }> {
    let meetings = this.meetings.filter((m) => this.inDashboardRange(m.date));
    let scored = meetings.filter((m) => m.interviewScore != null);
    let overallAvg =
      scored.reduce((sum, m) => sum + (m.interviewScore ?? 0), 0) /
      (scored.length || 1);
    return this.employees
      .filter((e) => e.status !== 'offboarded')
      .map((employee) => {
        let given = scored.filter((m) =>
          (m.interviewers ?? []).some((i) => i?.id === employee.id),
        );
        if (!given.length) {
          return undefined;
        }
        let avgScore =
          given.reduce((sum, m) => sum + (m.interviewScore ?? 0), 0) /
          given.length;
        let delta = avgScore - overallAvg;
        let tone: 'amber' | 'green' =
          Math.abs(delta) >= 0.8 ? 'amber' : 'green';
        let label =
          delta >= 0.8
            ? 'Runs loose'
            : delta <= -0.8
              ? 'Runs harsh'
              : 'On benchmark';
        return { employee, avgScore, count: given.length, tone, label, delta };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
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
        this.approveOrReviewChain(candidate);
        continue;
      }
      if (targetStage === 'rejected') {
        void this.reject(candidate);
        continue;
      }
      // Dropping into `offer` runs the same command the button does, so the
      // draft Offer gets created either way — the three meaningful drops are
      // symmetric now instead of two running commands and one not.
      if (targetStage === 'offer' && candidate.status === 'interviewing') {
        void this.advanceToOffer(candidate);
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

  // The Positions rail item expands to list each open requisition — clicking
  // the row itself (not the arrow) still goes to the Positions tab; clicking
  // a child jumps straight to that Position's own card.
  get positionsNavFilters(): PositionNavFilter[] {
    return [
      {
        displayName: 'Positions',
        filters: this.positions.map((position) => ({
          displayName: position.title ?? 'Untitled Position',
          positionId: position.id,
        })),
      },
    ];
  }

  get activePositionsFilter(): PositionNavFilter | undefined {
    return this.activeTab === 'Positions'
      ? this.positionsNavFilters[0]
      : undefined;
  }

  handlePositionsNavChange = (filter: NavFilter) => {
    let positionId = (filter as PositionNavFilter).positionId;
    if (positionId) {
      let position = this.positions.find((p) => p.id === positionId);
      if (position) {
        this.openCard(position);
      }
      return;
    }
    this.activeTab = 'Positions';
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

  get upcomingMeetings(): Array<{
    id?: string;
    title: string;
    day: string;
    month: string;
    timeLabel: string;
  }> {
    let now = new Date();
    return this.calendarEvents
      .filter((event) => event.date.getTime() >= now.getTime())
      .slice(0, 5)
      .map((event) => ({
        id: event.id,
        title: event.title,
        day: String(event.date.getDate()),
        month: event.date
          .toLocaleDateString('en-US', { month: 'short' })
          .toUpperCase(),
        timeLabel: event.date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        }),
      }));
  }

  get orgRoots(): OrgNode<OrgTreeItem>[] {
    let items = this.employees.map((e) => ({
      id: e.id,
      name: e.title,
      role: e.role,
      initials: initialsOf(e.name),
      photoUrl: e.photo?.resolvedUrl,
      status: e.status,
      managerId: e.manager?.id,
      openReqs: this.positions.filter(
        (p) => p.status === 'open' && p.hiringManager?.id === e.id,
      ).length,
    }));
    return buildOrgTree(items, (item) => item.managerId);
  }

  // `viewCard` is a TOP-LEVEL component arg — see SignatureFor<CardT> in
  // base/card-api.gts, which declares `viewCard?: ViewCardFn` alongside
  // `model` and `fields`. It is NOT on `context`; CardContext has no `actions`
  // member at all, so `context.actions.viewCard` (as recruiting-console.gts
  // does it) resolves to undefined and silently no-ops.
  //
  // ViewCardFn takes `CardDef | URL`, and the card object is the better
  // argument: a URL makes the host fetch, which for a just-created card
  // outruns indexing and parks the stack on "Loading card…".
  openCard = (
    item: { id?: string } | undefined,
    format: Format = 'isolated',
  ) => {
    let id = item?.id;
    if (!id) {
      return;
    }
    let viewCard = (this.args as any).viewCard as ViewCardFn | undefined;
    if (!viewCard) {
      return;
    }
    // Calendar chips and org-tree rows hand over a plain view-model carrying
    // only an id, so resolve those back to the real card before navigating.
    let card = this.cardById(id);
    viewCard(card ?? new URL(id), format);
  };

  private cardById(id: string) {
    let pools = [
      this.candidates,
      this.employees,
      this.meetings,
      this.args.model.teams ?? [],
      this.args.model.projects ?? [],
      this.args.model.vendors ?? [],
      this.args.model.positions ?? [],
      this.args.model.applications ?? [],
      this.args.model.offers ?? [],
    ];
    for (let pool of pools) {
      let hit = (pool as any[]).find((c) => c?.id === id);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }

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

  // The day currently being created — the Calendar reads this to swap that
  // day's + for a spinner and disable it. Without the feedback a slow create
  // invites repeat clicks, which is how a single day ends up holding four
  // cards all named "New Meeting".
  @tracked addingMeetingOn: Date | undefined;

  addMeeting = (date: Date) => {
    void this.addMeetingTask.perform(date);
  };

  // restartableTask, not a plain async function: it gives a real `isRunning`
  // state to drive the spinner, and cancels a superseded run rather than
  // letting two creates race.
  //
  // Uses the host's own createCard action (same primitive blog-app's "New
  // Post" button uses) instead of a manual SaveCardCommand-then-openCard
  // pair. createCard opens the new card in the stack itself, in edit format,
  // as ONE round trip — that's the whole reason this used to feel slow:
  // two sequential awaited saves (the meeting, then the whole tracker) had
  // to finish before the user saw anything at all. Linking the new meeting
  // into this tracker's own `meetings` array now happens AFTER the stack is
  // already open, since it's no longer on the path the user is waiting on.
  private addMeetingTask = restartableTask(async (date: Date) => {
    this.actionError = undefined;
    let createCard = (this.args as any).createCard as CreateCardFn | undefined;
    let store = this.args.context?.store;
    if (!createCard || !store) {
      this.actionError = 'Commands are unavailable in this mode';
      return;
    }
    this.addingMeetingOn = date;
    try {
      let realmHref = this.args.model[realmURL]?.href;
      let realm = realmHref ? new URL(realmHref) : undefined;
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { name: 'New Meeting', date: date.toISOString() },
          meta: { adoptsFrom: meetingRef },
        },
      };
      let newId = await createCard(meetingRef, realm, {
        realmURL: realm,
        doc,
      });
      if (!newId) {
        return;
      }
      let saved = await store.get<Meeting>(newId);
      if (saved instanceof Meeting) {
        this.args.model.meetings = [...(this.args.model.meetings ?? []), saved];
        let commandContext = this.args.context?.commandContext;
        if (commandContext) {
          await new SaveCardCommand(commandContext).execute({
            card: this.args.model,
          } as any);
        }
      }
    } catch (error: any) {
      this.actionError = error?.message ?? String(error);
    } finally {
      this.addingMeetingOn = undefined;
    }
  });

  // The candidate currently being scheduled — disables the button mid-flight
  // for the same reason addingMeetingOn does on the Calendar tab.
  @tracked schedulingCandidateId: string | undefined;

  isScheduling = (candidate: Candidate | undefined): boolean => {
    return Boolean(candidate?.id) && this.schedulingCandidateId === candidate?.id;
  };

  scheduleInterview = (candidate: Candidate) => {
    void this.scheduleInterviewTask.perform(candidate);
  };

  // Mirrors addMeetingTask's create-then-edit idiom rather than building a
  // bespoke inline date/interviewer picker: create the Meeting pre-linked to
  // the candidate via the host's own createCard action, then hand the user
  // straight to its edit form to fill in date, round type and interviewers.
  // ScheduleInterviewCommand (commands/schedule-interview-command.gts) covers
  // the fully scripted path — e.g. an AI assistant flow — but the click here
  // stays on the same one-round-trip primitive the Calendar tab already uses.
  private scheduleInterviewTask = restartableTask(async (candidate: Candidate) => {
    this.actionError = undefined;
    let createCard = (this.args as any).createCard as CreateCardFn | undefined;
    let store = this.args.context?.store;
    if (!createCard || !store) {
      this.actionError = 'Commands are unavailable in this mode';
      return;
    }
    this.schedulingCandidateId = candidate.id;
    try {
      let realmHref = this.args.model[realmURL]?.href;
      let realm = realmHref ? new URL(realmHref) : undefined;
      let doc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: { name: `Interview: ${candidate.name ?? 'Candidate'}`, meetingType: 'interview' },
          relationships: {
            candidate: {
              links: { self: candidate.id ?? null },
            },
          },
          meta: { adoptsFrom: meetingRef },
        },
      };
      let newId = await createCard(meetingRef, realm, {
        realmURL: realm,
        doc,
      });
      if (!newId) {
        return;
      }
      let saved = await store.get<Meeting>(newId);
      if (saved instanceof Meeting) {
        this.args.model.meetings = [...(this.args.model.meetings ?? []), saved];
        let commandContext = this.args.context?.commandContext;
        if (commandContext) {
          await new SaveCardCommand(commandContext).execute({
            card: this.args.model,
          } as any);
        }
        // Scheduling an interview is the real-world action that starts
        // interviewing — same "advance the stage as a side effect" pattern
        // ExtractResumeCommand uses for applied → screening.
        if (candidate.status === 'screening') {
          await this.runCommand(candidate, async (commandContext) => {
            candidate.status = 'interviewing';
            await new SaveCardCommand(commandContext).execute({
              card: candidate,
            } as any);
          });
        }
      }
    } catch (error: any) {
      this.actionError = error?.message ?? String(error);
    } finally {
      this.schedulingCandidateId = undefined;
    }
  });

  approve = async (candidate: Candidate) => {
    await this.runCommand(candidate, async (commandContext) => {
      await new ApproveOfferCommand(commandContext).execute({
        candidate,
      } as any);
    });
  };

  // The offer's approvalChain link is dereferenced here, inside the click
  // handler's body — not during render via `fn`'s eager arg evaluation —
  // for the same async-link-load reason openCandidateOffer's own comment
  // explains. When a chain is configured and not yet fully approved, hiring
  // is blocked (ApproveOfferCommand enforces this server-side too); the
  // click instead surfaces a message and opens the Offer so the chain can be
  // reviewed/decided there.
  approveOrReviewChain = (candidate: Candidate) => {
    let chain = candidate.offer?.approvalChain;
    if (chain?.steps?.length && chain.status !== 'approved') {
      this.actionError =
        'Approval chain in progress — open the Offer to review.';
      this.openCandidateOffer(candidate);
      return;
    }
    void this.approve(candidate);
  };

  // Opens the structured reject dialog instead of the old globalThis.prompt()
  // free-text box — the reason now drives the Offers dashboard breakdown, so
  // it has to come from a fixed set of values.
  reject = (candidate: Candidate) => {
    this.rejectDialogCandidate = candidate;
  };

  closeRejectDialog = () => {
    this.rejectDialogCandidate = undefined;
  };

  get isRejectDialogOpen(): boolean {
    return Boolean(this.rejectDialogCandidate);
  }

  confirmReject = async (reason: string, note: string) => {
    let candidate = this.rejectDialogCandidate;
    this.rejectDialogCandidate = undefined;
    if (!candidate) {
      return;
    }
    await this.runCommand(candidate, async (commandContext) => {
      await new RejectCandidateCommand(commandContext).execute({
        candidate,
        reason,
        note,
      } as any);
    });
  };

  extractResume = async (candidate: Candidate) => {
    await this.runCommand(candidate, async (commandContext) => {
      await new ExtractResumeCommand(commandContext).execute({
        candidate,
      } as any);
    });
  };

  extendOffer = async (candidate: Candidate) => {
    let result = await this.runCommand(candidate, async (commandContext) => {
      return (await new ExtendOfferCommand(commandContext).execute({
        candidate,
      } as any)) as any;
    });
    let offer = result?.offer;
    if (offer) {
      let commandContext = this.args.context?.commandContext;
      this.args.model.offers = [...(this.args.model.offers ?? []), offer];
      await new SaveCardCommand(commandContext).execute({
        card: this.args.model,
      } as any);
    }
  };

  advanceToOffer = async (candidate: Candidate) => {
    await this.runCommand(candidate, async (commandContext) => {
      await new AdvanceToOfferCommand(commandContext).execute({
        candidate,
      } as any);
    });
  };

  // Label for the offer link. Reads the scalar mirror rather than the
  // linked card's status, for the same hot-path reason as whoseTurn.
  // `fn` evaluates its positional args eagerly, at the point the helper
  // itself runs during render — not lazily when the bound function is later
  // called. `(fn this.openCard candidateModel.offer)` therefore dereferences
  // the `offer` linksTo on every render of every interviewing candidate,
  // racing the same async link-load assertion this guard was meant to avoid.
  // Wrapping the access inside this action defers it to actual click time.
  openCandidateOffer = (candidate: Candidate) => {
    this.openCard(candidate.offer);
  };

  offerLabel = (candidate: Candidate | undefined): string => {
    return offerStatusLabel(candidate?.offerState) ?? 'not sent';
  };

  isBusyCandidate = (candidate: Candidate | undefined): boolean => {
    return Boolean(candidate?.id) && this.busyCandidateId === candidate?.id;
  };

  isBusyApplication = (application: Application | undefined): boolean => {
    return (
      Boolean(application?.id) && this.busyApplicationId === application?.id
    );
  };

  formatDate = (value: Date | string | undefined): string => {
    if (!value) {
      return '—';
    }
    let date = new Date(value);
    if (isNaN(date.getTime())) {
      return '—';
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  applicationStatusStyle = (status: string | undefined) => {
    let color = stateColorOf(APPLICATION_STATUS_COLORS, status);
    return htmlSafe(`background: ${color.bg}; color: ${color.fg};`);
  };

  positionStatusStyle = (status: string | undefined) => {
    let color = stateColorOf(POSITION_STATUS_COLORS, status);
    return htmlSafe(`background: ${color.bg}; color: ${color.fg};`);
  };

  // Review mode — a full-screen triage queue instead of clicking Screen on
  // one tile at a time. Oldest-waiting-first, because that's the real
  // signal this app has (no AI match score exists to sort by instead).
  get reviewQueue(): Application[] {
    return this.applications
      .filter((a) => a.status === 'new' || a.status === 'reviewing')
      .sort((a, b) => {
        let aTime = a.appliedDate ? new Date(a.appliedDate).getTime() : 0;
        let bTime = b.appliedDate ? new Date(b.appliedDate).getTime() : 0;
        return aTime - bTime;
      });
  }

  get currentReviewApplication(): Application | undefined {
    let queue = this.reviewQueue;
    if (!queue.length) {
      return undefined;
    }
    return queue[Math.min(this.reviewIndex, queue.length - 1)];
  }

  get reviewPositionLabel(): string {
    return `${Math.min(this.reviewIndex + 1, this.reviewQueue.length)} / ${this.reviewQueue.length}`;
  }

  startReview = () => {
    this.reviewMode = true;
    this.reviewIndex = 0;
    this.reviewedCount = 0;
  };

  exitReview = () => {
    this.reviewMode = false;
  };

  reviewStep = (delta: number) => {
    let max = this.reviewQueue.length;
    if (!max) {
      return;
    }
    this.reviewIndex = Math.max(0, Math.min(max - 1, this.reviewIndex + delta));
  };

  reviewGoTo = (index: number) => {
    this.reviewIndex = Math.max(
      0,
      Math.min(this.reviewQueue.length - 1, index),
    );
  };

  reviewKeydown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.reviewStep(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.reviewStep(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.exitReview();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      let app = this.currentReviewApplication;
      if (app) {
        void this.reviewScreen(app);
      }
    }
  };

  reviewScreen = async (application: Application) => {
    await this.screenApplication(application);
    this.reviewedCount++;
    if (this.reviewIndex >= this.reviewQueue.length && this.reviewIndex > 0) {
      this.reviewIndex = this.reviewQueue.length - 1;
    }
  };

  reviewReject = async (application: Application) => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.actionError = 'Commands are unavailable in this mode';
      return;
    }
    this.busyApplicationId = application.id;
    try {
      application.status = 'rejected';
      await new SaveCardCommand(commandContext).execute({
        card: application,
      } as any);
      this.reviewedCount++;
      if (this.reviewIndex >= this.reviewQueue.length && this.reviewIndex > 0) {
        this.reviewIndex = this.reviewQueue.length - 1;
      }
    } catch (error: any) {
      this.actionError = error?.message ?? String(error);
    } finally {
      this.busyApplicationId = undefined;
    }
  };

  screenApplication = async (application: Application) => {
    this.actionError = undefined;
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.actionError = 'Commands are unavailable in this mode';
      return;
    }
    this.busyApplicationId = application.id;
    try {
      let result = (await new ScreenApplicationCommand(commandContext).execute({
        application,
      } as any)) as any;
      let candidate = result?.candidate;
      if (candidate) {
        this.args.model.candidates = [
          ...(this.args.model.candidates ?? []),
          candidate,
        ];
        await new SaveCardCommand(commandContext).execute({
          card: this.args.model,
        } as any);
      }
    } catch (error: any) {
      this.actionError = error?.message ?? String(error);
    } finally {
      this.busyApplicationId = undefined;
    }
  };

  stopEvent = (event: Event) => {
    event.stopPropagation();
  };

  // Time-in-stage aging: recruiters triage by how long a candidate has been
  // sitting in the pipeline. Only open stages age.
  pipelineAge = (
    candidate: Candidate | undefined,
  ): { label: string; stale: boolean } | undefined => {
    if (!candidate?.appliedDate) return undefined;
    let status = candidate.status;
    if (status === 'hired' || status === 'rejected') return undefined;
    let days = daysBetween(new Date(candidate.appliedDate), new Date());
    if (days < 0) return undefined;
    return { label: `Day ${days + 1}`, stale: days >= 30 };
  };

  // Interview scorecard rollup: average of linked Meetings' interviewScore.
  // Whether the extras strip under a kanban card would render anything at all.
  // The `.card-extras:empty` CSS fallback cannot do this job: the template's
  // newlines and indentation are whitespace text nodes, so the div is never
  // truly :empty and its padding still reserves a dead strip under the card.
  // Guarding in the template removes the element outright.
  hasCardExtras = (candidate: Candidate | undefined): boolean => {
    let status = candidate?.status;
    if (!status) {
      return false;
    }
    // Non-terminal stages always render at least the whose-turn chip, and
    // every stage-action button sits under a non-terminal branch.
    if (status !== 'hired' && status !== 'rejected') {
      return true;
    }
    // Terminal stages: pipelineAge returns undefined by design, so the score
    // rollup is the only thing that can still appear.
    return Boolean(this.avgInterviewScore(candidate));
  };

  avgInterviewScore = (
    candidate: Candidate | undefined,
  ): { label: string } | undefined => {
    if (!candidate?.id) return undefined;
    let scores = this.meetings
      .filter((m) => m.candidateId === candidate.id)
      .map((m) => m.interviewScore)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!scores.length) return undefined;
    let avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return {
      label: `\u2605 ${(Math.round(avg * 10) / 10).toFixed(1)} avg \u00b7 ${scores.length}`,
    };
  };

  private async runCommand<T>(
    candidate: Candidate,
    action: (commandContext: any) => Promise<T>,
  ): Promise<T | undefined> {
    this.actionError = undefined;
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.actionError = 'Commands are unavailable in this mode';
      return undefined;
    }
    this.busyCandidateId = candidate.id;
    try {
      return await action(commandContext);
    } catch (error: any) {
      this.actionError = error?.message ?? String(error);
      return undefined;
    } finally {
      this.busyCandidateId = undefined;
    }
  }

  <template>
    <RejectCandidateDialog
      @isOpen={{this.isRejectDialogOpen}}
      @candidateName={{this.rejectDialogCandidate.name}}
      @onConfirm={{this.confirmReject}}
      @onCancel={{this.closeRejectDialog}}
    />
    <section class='tracker'>
      <div class='shell'>
        <aside class='rail'>
          <div class='rail-kicker'>Personnel Registry</div>
          <h1 class='rail-title'>{{if
              @model.name
              @model.name
              'Talent & Resource Tracker'
            }}</h1>
          <div class='rail-sub'>Posted through {{this.todayLabel}}</div>
          <nav class='rail-nav'>
            {{#each this.tabs as |tab|}}
              {{#if (eq tab 'Positions')}}
                <FilterList
                  class='rail-filter-list'
                  @filters={{this.positionsNavFilters}}
                  @activeFilter={{this.activePositionsFilter}}
                  @onChanged={{this.handlePositionsNavChange}}
                />
              {{else}}
                <Button
                  type='button'
                  @kind='text-only'
                  class='rail-link {{if (eq tab this.activeTab) "current"}}'
                  {{on 'click' (fn this.setTab tab)}}
                >
                  <span class='t'>{{tab}}</span>
                </Button>
              {{/if}}
            {{/each}}
          </nav>
        </aside>

        <div class='page'>
          {{#if this.actionError}}
            <p class='error' role='alert'>{{this.actionError}}</p>
          {{/if}}

          {{#if (eq this.activeTab 'Dashboard')}}
            <div class='tab-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Dashboard</h2>
                  <p class='byline'>{{this.todayLabel}}
                    ·
                    {{this.headcount}}
                    people,
                    {{this.openReqs}}
                    open roles</p>
                </div>
              </div>

              <div class='dashboard-filters'>
                <Button
                  type='button'
                  @kind='primary'
                  class='btn-review'
                  aria-expanded='{{this.dashboardFilterOpen}}'
                  {{on 'click' this.toggleDashboardFilter}}
                >Filter: {{this.dashboardRangeLabel}}</Button>
                {{#if this.dashboardRange.start}}
                  <Button
                    type='button'
                    @kind='link'
                    class='board-link'
                    {{on 'click' this.clearDashboardRange}}
                  >Clear</Button>
                {{/if}}
                {{#if this.dashboardFilterOpen}}
                  <div class='dashboard-range-popover'>
                    <DateRangePicker
                      @selected={{this.dashboardRangeSelected}}
                      @onSelect={{this.onDashboardRangeSelect}}
                    />
                  </div>
                {{/if}}
              </div>

              <div class='dashboard-top'>
                <div class='dashboard-left'>
                  <div class='stats-row'>
                    <div class='stat-card hero'>
                      <div class='stat-label'>Offer Ratio</div>
                      <div class='stat-value'>{{this.offerRatioLabel}}</div>
                      <div class='stat-trend'>Applications per hire</div>
                    </div>
                    <div class='stat-card'>
                      <div class='stat-label'>Median Hiring Cycle</div>
                      <div class='stat-value'>{{this.avgTimeToHire}}</div>
                      <div class='stat-trend'>Trailing average</div>
                    </div>
                    <div class='stat-card'>
                      <div class='stat-label'>Slowest Stage</div>
                      {{#if this.slowestFunnelStage}}
                        <div class='stat-value stat-value-sm'>
                          {{this.slowestFunnelStage.label}}
                        </div>
                        <div class='stat-trend stat-trend-bad'>
                          {{this.slowestFunnelStage.dwellDays}}
                          days median
                        </div>
                      {{else}}
                        <div class='stat-value'>—</div>
                        <div class='stat-trend'>No active candidates</div>
                      {{/if}}
                    </div>
                    <div class='stat-card'>
                      <div class='stat-label'>Needs Us</div>
                      <div class='stat-value'>{{this.needsUsCount}}</div>
                      {{#if this.overdueFeedbackCount}}
                        <div class='stat-trend stat-trend-bad'>
                          {{this.overdueFeedbackCount}}
                          feedback overdue
                        </div>
                      {{else}}
                        <div class='stat-trend'>Across the pipeline</div>
                      {{/if}}
                    </div>
                  </div>

                  <div class='board-head'>
                    <h2>Candidate Pipeline</h2>
                    <Button
                      type='button'
                      @kind='link'
                      class='board-link'
                      {{on 'click' (fn this.setTab 'Pipeline')}}
                    >View full board →</Button>
                  </div>
                  <div class='board-preview'>
                    {{#each this.dashboardPipelinePreview as |col|}}
                      <div class='pcol'>
                        <div class='pcol-head'>
                          <span>{{col.label}}</span>
                          <span
                            class='pcol-count'
                          >{{col.candidates.length}}</span>
                        </div>
                        {{#each col.candidates as |candidate|}}
                          <Button
                            @kind='secondary'
                            class='kcard'
                            {{on 'click' (fn this.openCard candidate)}}
                          >
                            <span class='kavatar'>{{candidate.initials}}</span>
                            <span class='kmeta'>
                              <span class='kname'>{{candidate.name}}</span>
                              <span
                                class='krole'
                              >{{candidate.appliedRole}}</span>
                            </span>
                          </Button>
                        {{/each}}
                      </div>
                    {{/each}}
                  </div>
                </div>

                <div class='chart-card'>
                  <div class='chart-card-head'>
                    <span class='chart-title'>Funnel</span>
                    <span class='chart-total'>{{this.openPipeline}}
                      active</span>
                  </div>
                  <BarChart
                    @data={{this.funnelChartData}}
                    @formatValue={{this.formatFunnelStage}}
                  />
                </div>
              </div>

              <div class='chart-card source-effectiveness-card'>
                <div class='chart-card-head'>
                  <span class='chart-title'>Source Effectiveness</span>
                  <span class='chart-total'>{{this.sourceEffectiveness.length}}
                    sources</span>
                </div>
                {{#if this.sourceEffectiveness.length}}
                  <BarChart
                    @data={{this.sourceEffectivenessChartData}}
                    @formatValue={{this.formatSourceEffectiveness}}
                    @hue='purple'
                  />
                {{else}}
                  <p class='empty-note'>No applications in this range</p>
                {{/if}}
              </div>

              <div class='ops-row'>
                <div class='ops-col'>
                  <div class='col-h'>Interviewer Load · This Week</div>
                  {{#if this.interviewerLoad.length}}
                    <table class='data-table'>
                      <tbody>
                        {{#each this.interviewerLoad as |row|}}
                          <tr>
                            <td>{{row.employee.name}}</td>
                            <td class='num'>{{row.hours}}h</td>
                            <td>
                              <span class='status-pill pill-{{row.tone}}'>
                                {{if
                                  (eq row.tone 'red')
                                  'Over capacity'
                                  (if
                                    (eq row.tone 'amber')
                                    'Near capacity'
                                    'Has room'
                                  )
                                }}
                              </span>
                            </td>
                          </tr>
                        {{/each}}
                      </tbody>
                    </table>
                  {{else}}
                    <p class='empty-note'>No interviews scheduled this week</p>
                  {{/if}}
                </div>
                <div class='ops-col'>
                  <div class='col-h'>Score Calibration · Scored Interviews</div>
                  {{#if this.calibration.length}}
                    <table class='data-table'>
                      <tbody>
                        {{#each this.calibration as |row|}}
                          <tr>
                            <td>{{row.employee.name}}</td>
                            <td class='num'>★{{row.avgScore}}
                              avg ·
                              {{row.count}}</td>
                            <td>
                              <span class='status-pill pill-{{row.tone}}'>
                                {{row.label}}
                              </span>
                            </td>
                          </tr>
                        {{/each}}
                      </tbody>
                    </table>
                  {{else}}
                    <p class='empty-note'>No scored interviews yet</p>
                  {{/if}}
                </div>
              </div>

              <div class='upcoming-card'>
                <div class='board-head'>
                  <h2>Upcoming</h2>
                  <Button
                    type='button'
                    @kind='link'
                    class='board-link'
                    {{on 'click' (fn this.setTab 'Calendar')}}
                  >Open calendar →</Button>
                </div>
                {{#if this.upcomingMeetings.length}}
                  <div class='upcoming-list'>
                    {{#each this.upcomingMeetings as |meeting|}}
                      <Button
                        @kind='secondary'
                        class='upcoming-row'
                        {{on 'click' (fn this.openCard meeting)}}
                      >
                        <span class='upcoming-date'>
                          <span class='upcoming-day'>{{meeting.day}}</span>
                          <span class='upcoming-month'>{{meeting.month}}</span>
                        </span>
                        <span class='upcoming-info'>
                          <span class='upcoming-title'>{{meeting.title}}</span>
                          <span
                            class='upcoming-time'
                          >{{meeting.timeLabel}}</span>
                        </span>
                      </Button>
                    {{/each}}
                  </div>
                {{else}}
                  <p class='empty-note'>Nothing scheduled</p>
                {{/if}}
              </div>

              <div class='accounts'>
                <section class='account-col'>
                  <h2>Teams</h2>
                  {{#if this.teams.length}}
                    <ul class='account-list'>
                      {{#each this.teams as |team|}}
                        <li>
                          <Button
                            @kind='text-only'
                            class='account-row'
                            {{on 'click' (fn this.openCard team)}}
                          >
                            <span class='account-name'>{{team.title}}</span>
                            <span class='account-meta'>{{team.headcount}}</span>
                          </Button>
                        </li>
                      {{/each}}
                    </ul>
                  {{else}}
                    <p class='empty-note'>No teams yet</p>
                  {{/if}}
                </section>
                <section class='account-col'>
                  <h2>Projects</h2>
                  {{#if this.projects.length}}
                    <ul class='account-list'>
                      {{#each this.projects as |project|}}
                        <li>
                          <Button
                            @kind='text-only'
                            class='account-row'
                            {{on 'click' (fn this.openCard project)}}
                          >
                            <span
                              class='dot'
                              style={{this.projectDotStyle project.status}}
                            ></span>
                            <span class='account-name'>{{project.title}}</span>
                            <span class='account-meta'>{{project.status}}</span>
                          </Button>
                        </li>
                      {{/each}}
                    </ul>
                  {{else}}
                    <p class='empty-note'>No projects yet</p>
                  {{/if}}
                </section>
                <section class='account-col'>
                  <h2>Vendors</h2>
                  {{#if this.vendors.length}}
                    <ul class='account-list'>
                      {{#each this.vendors as |vendor|}}
                        <li>
                          <Button
                            @kind='text-only'
                            class='account-row'
                            {{on 'click' (fn this.openCard vendor)}}
                          >
                            <span class='account-name'>{{vendor.title}}</span>
                            <span
                              class='account-meta'
                            >{{vendor.serviceCategory}}</span>
                          </Button>
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

          {{#if (eq this.activeTab 'Positions')}}
            <div class='tab-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Open Positions</h2>
                  <p class='byline'>Requisitions open across the org</p>
                </div>
              </div>
              <div class='list-toolbar'>
                <div class='list-search'>
                  <BoxelInput
                    @type='search'
                    @value={{this.positionsSearch}}
                    @placeholder='Search positions…'
                    @onInput={{this.setPositionsSearch}}
                    aria-label='Search positions'
                  />
                </div>
                <div class='view-toggle' role='group' aria-label='View'>
                  <IconButton
                    type='button'
                    class='view-btn
                      {{if (eq this.positionsView "grid") "active"}}'
                    aria-label='Grid view'
                    {{on 'click' (fn this.setPositionsView 'grid')}}
                  ><LayoutGridIcon class='view-icon' /></IconButton>
                  <IconButton
                    type='button'
                    class='view-btn
                      {{if (eq this.positionsView "strip") "active"}}'
                    aria-label='List view'
                    {{on 'click' (fn this.setPositionsView 'strip')}}
                  ><ListIcon class='view-icon' /></IconButton>
                  <IconButton
                    type='button'
                    class='view-btn
                      {{if (eq this.positionsView "table") "active"}}'
                    aria-label='Table view'
                    {{on 'click' (fn this.setPositionsView 'table')}}
                  ><TableIcon class='view-icon' /></IconButton>
                </div>
              </div>
              {{#if this.filteredPositions.length}}
                {{#if (eq this.positionsView 'table')}}
                  <div class='data-table-wrap'>
                    <table class='data-table'>
                      <thead>
                        <tr>
                          <th>Position</th>
                          <th>Department</th>
                          <th>Days Open</th>
                          <th>Applicants</th>
                          <th>This Week</th>
                          <th>28-Day Trend</th>
                          <th>Interviewing</th>
                          <th>Status</th>
                          <th>Signal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {{#each this.positionsTableRows as |row|}}
                          <tr>
                            <td>{{row.position.jobTitle}}</td>
                            <td>{{row.position.department}}</td>
                            <td>{{if row.openDays row.openDays '—'}}</td>
                            <td>{{row.applicantCount}}</td>
                            <td>{{row.weeklyNew}}</td>
                            <td>
                              <svg
                                viewBox='0 0 80 20'
                                width='80'
                                height='20'
                                role='img'
                                aria-label='28-day applicant trend'
                              >
                                <polyline
                                  points={{row.trendPoints}}
                                  fill='none'
                                  stroke={{if
                                    (eq row.tone 'red')
                                    '#c2253c'
                                    (if
                                      (eq row.tone 'green') '#0f766e' '#c3cfe2'
                                    )
                                  }}
                                  stroke-width='1.6'
                                />
                              </svg>
                            </td>
                            <td>{{row.interviewingCount}}</td>
                            <td>
                              <span
                                class='status-pill'
                                style={{this.positionStatusStyle
                                  row.position.status
                                }}
                              >{{row.position.status}}</span>
                            </td>
                            <td>
                              {{#if row.stalled}}
                                <span
                                  class='status-pill pill-red'
                                >Stalled</span>
                              {{else if (eq row.position.status 'open')}}
                                <span
                                  class='status-pill pill-green'
                                >Healthy</span>
                              {{/if}}
                            </td>
                          </tr>
                        {{/each}}
                      </tbody>
                    </table>
                  </div>
                {{else}}
                  <div
                    class='tile-grid
                      {{if (eq this.positionsView "strip") "strip-view"}}'
                  >
                    {{#each this.filteredPositions as |entry|}}
                      {{#let
                        (get @fields.positions entry.index)
                        as |PositionField|
                      }}
                        {{#if PositionField}}
                          <div
                            class='tile
                              {{if
                                (eq this.positionsView "strip")
                                "strip-tile"
                              }}'
                          >
                            <PositionField
                              @format='fitted'
                              @displayContainer={{false}}
                            />
                          </div>
                        {{/if}}
                      {{/let}}
                    {{/each}}
                  </div>
                {{/if}}
              {{else}}
                <p class='empty-note'>No open positions yet</p>
              {{/if}}
            </div>
          {{/if}}

          {{#if (eq this.activeTab 'Applications')}}
            <div class='tab-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Applications</h2>
                  <p class='byline'>Inbound, not yet promoted to the pipeline</p>
                </div>
                {{#unless this.reviewMode}}
                  {{#if this.reviewQueue.length}}
                    <Button
                      type='button'
                      @kind='primary'
                      class='btn-review'
                      {{on 'click' this.startReview}}
                    >Review mode ({{this.reviewQueue.length}})</Button>
                  {{/if}}
                {{/unless}}
              </div>
              {{#if this.reviewMode}}
                {{#if this.currentReviewApplication}}
                  {{#let this.currentReviewApplication as |app|}}
                    <div
                      class='review'
                      tabindex='0'
                      {{on 'keydown' this.reviewKeydown}}
                    >
                      <div class='review-bar'>
                        <span class='review-status'>Review mode ·
                          {{this.reviewPositionLabel}}
                          · reviewed
                          {{this.reviewedCount}}</span>
                        <span class='review-keys'>
                          <kbd>←</kbd><kbd>→</kbd>
                          navigate ·
                          <kbd>↵</kbd>
                          screen ·
                          <kbd>Esc</kbd>
                          exit
                        </span>
                        <Button
                          type='button'
                          @kind='default'
                          class='btn-review-exit'
                          {{on 'click' this.exitReview}}
                        >Exit</Button>
                      </div>
                      <div class='review-panes'>
                        <div class='review-queue'>
                          {{#each this.reviewQueue as |queued index|}}
                            <Button
                              @kind='text-only'
                              class='review-queue-item
                                {{if (eq index this.reviewIndex) "on"}}'
                              {{on 'click' (fn this.reviewGoTo index)}}
                            >
                              <span
                                class='review-queue-name'
                              >{{queued.name}}</span>
                              <span class='review-queue-meta'>{{this.formatDate
                                  queued.appliedDate
                                }}</span>
                            </Button>
                          {{/each}}
                        </div>
                        <div class='review-resume'>
                          <div class='review-resume-head'>
                            <strong>{{app.name}}</strong>
                            <span class='dim'>{{app.position.jobTitle}}</span>
                          </div>
                          {{#if app.resumeText}}
                            <p class='review-resume-text'>{{app.resumeText}}</p>
                          {{else}}
                            <p class='empty-note'>No résumé text on file</p>
                          {{/if}}
                        </div>
                        <div class='review-actions'>
                          <Button
                            type='button'
                            @kind='primary'
                            class='btn-review-primary'
                            @disabled={{this.isBusyApplication app}}
                            {{on 'click' (fn this.reviewScreen app)}}
                          >{{if
                              (this.isBusyApplication app)
                              'Screening…'
                              'Screen → Candidate'
                            }}</Button>
                          <Button
                            type='button'
                            @kind='secondary'
                            class='btn-review-danger'
                            @disabled={{this.isBusyApplication app}}
                            {{on 'click' (fn this.reviewReject app)}}
                          >Reject</Button>
                        </div>
                      </div>
                    </div>
                  {{/let}}
                {{else}}
                  <p class='empty-note'>Queue is empty — every inbound
                    application has been reviewed.</p>
                {{/if}}
              {{else}}
                <div class='list-toolbar'>
                  <div class='list-search'>
                    <BoxelInput
                      @type='search'
                      @value={{this.applicationsSearch}}
                      @placeholder='Search applications…'
                      @onInput={{this.setApplicationsSearch}}
                      aria-label='Search applications'
                    />
                  </div>
                  <div class='view-toggle' role='group' aria-label='View'>
                    <IconButton
                      type='button'
                      class='view-btn
                        {{if (eq this.applicationsView "grid") "active"}}'
                      aria-label='Grid view'
                      {{on 'click' (fn this.setApplicationsView 'grid')}}
                    ><LayoutGridIcon class='view-icon' /></IconButton>
                    <IconButton
                      type='button'
                      class='view-btn
                        {{if (eq this.applicationsView "strip") "active"}}'
                      aria-label='List view'
                      {{on 'click' (fn this.setApplicationsView 'strip')}}
                    ><ListIcon class='view-icon' /></IconButton>
                    <IconButton
                      type='button'
                      class='view-btn
                        {{if (eq this.applicationsView "table") "active"}}'
                      aria-label='Table view'
                      {{on 'click' (fn this.setApplicationsView 'table')}}
                    ><TableIcon class='view-icon' /></IconButton>
                  </div>
                </div>
                {{#if this.filteredApplications.length}}
                  {{#if (eq this.applicationsView 'table')}}
                    <div class='data-table-wrap'>
                      <table class='data-table'>
                        <thead>
                          <tr>
                            <th>Applicant</th>
                            <th>Role</th>
                            <th>Source</th>
                            <th>Applied</th>
                            <th>Status</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {{#each this.filteredApplications as |entry|}}
                            <tr>
                              <td>{{entry.item.name}}</td>
                              <td>{{entry.item.position.jobTitle}}</td>
                              <td>{{entry.item.source}}</td>
                              <td>{{this.formatDate
                                  entry.item.appliedDate
                                }}</td>
                              <td>
                                <span
                                  class='status-pill'
                                  style={{this.applicationStatusStyle
                                    entry.item.status
                                  }}
                                >{{entry.item.status}}</span>
                              </td>
                              <td>
                                {{#if
                                  (or
                                    (eq entry.item.status 'new')
                                    (eq entry.item.status 'reviewing')
                                  )
                                }}
                                  <Button
                                    type='button'
                                    @kind='secondary'
                                    class='screen-btn'
                                    @disabled={{this.isBusyApplication
                                      entry.item
                                    }}
                                    {{on
                                      'click'
                                      (fn this.screenApplication entry.item)
                                    }}
                                  >{{if
                                      (this.isBusyApplication entry.item)
                                      'Screening…'
                                      'Screen → Candidate'
                                    }}</Button>
                                {{/if}}
                              </td>
                            </tr>
                          {{/each}}
                        </tbody>
                      </table>
                    </div>
                  {{else}}
                    <div
                      class='tile-grid
                        {{if (eq this.applicationsView "strip") "strip-view"}}'
                    >
                      {{#each this.filteredApplications as |entry|}}
                        {{#let
                          (get @fields.applications entry.index)
                          as |ApplicationField|
                        }}
                          <div
                            class='tile app-tile
                              {{if
                                (eq this.applicationsView "strip")
                                "strip-tile"
                              }}'
                          >
                            {{#if ApplicationField}}
                              <ApplicationField
                                @format='fitted'
                                @displayContainer={{false}}
                              />
                            {{/if}}
                            {{#if
                              (or
                                (eq entry.item.status 'new')
                                (eq entry.item.status 'reviewing')
                              )
                            }}
                              <Button
                                type='button'
                                @kind='secondary'
                                class='screen-btn'
                                @disabled={{this.isBusyApplication entry.item}}
                                {{on
                                  'click'
                                  (fn this.screenApplication entry.item)
                                }}
                              >{{if
                                  (this.isBusyApplication entry.item)
                                  'Screening…'
                                  'Screen → Candidate'
                                }}</Button>
                            {{/if}}
                          </div>
                        {{/let}}
                      {{/each}}
                    </div>
                  {{/if}}
                {{else}}
                  <p class='empty-note'>No applications yet</p>
                {{/if}}
              {{/if}}
            </div>
          {{/if}}

          {{#if (eq this.activeTab 'Directory')}}
            <div class='tab-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Directory</h2>
                  <p class='byline'>Every standing entry, searchable</p>
                </div>
              </div>
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
                  <Button
                    type='button'
                    @kind='default'
                    class='chip {{if (eq this.directoryDept "all") "active"}}'
                    {{on 'click' (fn this.setDirectoryDept 'all')}}
                  >All</Button>
                  {{#each this.departments as |dept|}}
                    <Button
                      type='button'
                      @kind='default'
                      class='chip {{if (eq this.directoryDept dept) "active"}}'
                      {{on 'click' (fn this.setDirectoryDept dept)}}
                    >{{dept}}</Button>
                  {{/each}}
                </div>
                <div class='view-toggle' role='group' aria-label='View'>
                  <IconButton
                    type='button'
                    class='view-btn
                      {{if (eq this.directoryView "grid") "active"}}'
                    aria-label='Grid view'
                    {{on 'click' (fn this.setDirectoryView 'grid')}}
                  ><LayoutGridIcon class='view-icon' /></IconButton>
                  <IconButton
                    type='button'
                    class='view-btn
                      {{if (eq this.directoryView "strip") "active"}}'
                    aria-label='List view'
                    {{on 'click' (fn this.setDirectoryView 'strip')}}
                  ><ListIcon class='view-icon' /></IconButton>
                </div>
              </div>
              <CardList
                class='directory'
                @query={{this.employeeQuery}}
                @realms={{this.realms}}
                @context={{@context}}
                @format='fitted'
                @viewOption={{this.directoryView}}
              />
            </div>
          {{/if}}

          {{#if (eq this.activeTab 'Pipeline')}}
            <div class='tab-section pipeline-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Candidate Pipeline</h2>
                  <p class='byline'>By stage — screening through offer</p>
                </div>
              </div>
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
                    {{#if (this.hasCardExtras candidateModel)}}
                      {{! The kanban drag engine claims every pointerdown inside
                        [data-card-index]; stopping propagation here keeps
                        button presses from becoming drags or card-opens. }}
                      {{! template-lint-disable no-invalid-interactive no-pointer-down-event-binding }}
                      <div
                        class='card-extras'
                        {{on 'pointerdown' this.stopEvent}}
                        {{on 'mousedown' this.stopEvent}}
                        {{on 'click' this.stopEvent}}
                      >
                        {{#let
                          (this.pipelineAge candidateModel)
                          (this.avgInterviewScore candidateModel)
                          as |age avg|
                        }}
                          {{#if
                            (or
                              (eq candidateStatus 'hired')
                              (eq candidateStatus 'rejected')
                            )
                          }}
                            {{! Terminal stages: nothing left to act on, so
                              only the plain age/score chips apply. }}
                          {{else}}
                            {{#let (this.whoseTurn candidateModel) as |turn|}}
                              <span
                                class='turn-chip turn-{{turn.tone}}'
                              >{{turn.label}}</span>
                            {{/let}}
                          {{/if}}
                          {{#if age}}
                            <span
                              class='age-chip {{if age.stale "stale"}}'
                            >{{age.label}}</span>
                          {{/if}}
                          {{#if avg}}
                            <span class='avg-chip'>{{avg.label}}</span>
                          {{/if}}
                        {{/let}}
                        {{#if (eq candidateStatus 'applied')}}
                          <Button
                            type='button'
                            @kind='secondary'
                            class='stage-act'
                            @disabled={{this.isBusyCandidate candidateModel}}
                            {{on
                              'click'
                              (fn this.extractResume candidateModel)
                            }}
                          >{{if
                              (this.isBusyCandidate candidateModel)
                              'Extracting…'
                              'Extract résumé'
                            }}</Button>
                        {{/if}}
                        {{#if (eq candidateStatus 'screening')}}
                          <Button
                            type='button'
                            @kind='secondary'
                            class='stage-act'
                            @disabled={{this.isScheduling candidateModel}}
                            {{on
                              'click'
                              (fn this.scheduleInterview candidateModel)
                            }}
                          >{{if
                              (this.isScheduling candidateModel)
                              'Scheduling…'
                              'Schedule interview'
                            }}</Button>
                        {{/if}}
                        {{#if (eq candidateStatus 'interviewing')}}
                          {{! One link out to the Offer card instead of a second set of
                              offer controls on the board. Terms, dates and the draft-to-sent
                              flip all live there. Guarded on the offerState scalar, not on
                              the `offer` linksTo — and the link itself is dereferenced only
                              inside openCandidateOffer's action body, which runs on click,
                              not `fn`'s eager arg evaluation at render time. }}
                          {{#if candidateModel.offerState}}
                            <Button
                              type='button'
                              @kind='secondary'
                              class='offer-link'
                              {{on
                                'click'
                                (fn this.openCandidateOffer candidateModel)
                              }}
                            >Offer &middot;
                              {{this.offerLabel candidateModel}}</Button>
                          {{/if}}
                          <Button
                            type='button'
                            @kind='secondary'
                            class='stage-act'
                            @disabled={{this.isScheduling candidateModel}}
                            {{on
                              'click'
                              (fn this.scheduleInterview candidateModel)
                            }}
                          >{{if
                              (this.isScheduling candidateModel)
                              'Scheduling…'
                              'Schedule interview'
                            }}</Button>
                          <Button
                            type='button'
                            @kind='primary'
                            class='stage-act approve'
                            @disabled={{this.isBusyCandidate candidateModel}}
                            {{on
                              'click'
                              (fn this.advanceToOffer candidateModel)
                            }}
                          >Advance to offer</Button>
                        {{/if}}
                        {{#if (eq candidateStatus 'offer')}}
                          {{#if candidateModel.offerState}}
                            <Button
                              type='button'
                              @kind='secondary'
                              class='offer-link'
                              {{on
                                'click'
                                (fn this.openCandidateOffer candidateModel)
                              }}
                            >Offer &middot;
                              {{this.offerLabel candidateModel}}</Button>
                            <Button
                              type='button'
                              @kind='primary'
                              class='stage-act approve'
                              @disabled={{this.isBusyCandidate candidateModel}}
                              {{on
                                'click'
                                (fn this.approveOrReviewChain candidateModel)
                              }}
                            >Approve</Button>
                          {{else}}
                            {{! Reaching the offer stage only drafts the
                                Offer (see AdvanceToOfferCommand) — nothing
                                has gone to the candidate yet, so Approve
                                has nothing to approve. Send it first. }}
                            <Button
                              type='button'
                              @kind='primary'
                              class='stage-act approve'
                              @disabled={{this.isBusyCandidate candidateModel}}
                              {{on
                                'click'
                                (fn this.extendOffer candidateModel)
                              }}
                            >{{if
                                (this.isBusyCandidate candidateModel)
                                'Sending…'
                                'Send offer'
                              }}</Button>
                          {{/if}}
                          <Button
                            type='button'
                            @kind='secondary'
                            class='stage-act danger'
                            @disabled={{this.isBusyCandidate candidateModel}}
                            {{on 'click' (fn this.reject candidateModel)}}
                          >Reject</Button>
                        {{/if}}
                      </div>
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

          {{#if (eq this.activeTab 'Requisitions')}}
            <section class='tab-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Requisitions</h2>
                  <p class='byline'>Job openings by approval status</p>
                </div>
              </div>
              {{#if this.requisitions.length}}
                <div class='tile-grid'>
                  {{#each this.requisitions as |req|}}
                    <div class='tile req-tile' {{on 'click' (fn this.openCard req)}}>
                      <h4 class='req-title'>{{req.displayTitle}}</h4>
                      {{#if req.department}}<p class='req-dept'>{{req.department}}</p>{{/if}}
                      {{#if req.headcount}}<p class='req-headcount'>{{req.headcount}} positions</p>{{/if}}
                      <p class='req-status'>Status: {{or req.requisitionStatus 'draft'}}</p>
                    </div>
                  {{/each}}
                </div>
              {{else}}
                <p class='empty-note'>No requisitions yet</p>
              {{/if}}
            </section>
          {{/if}}

          {{#if (eq this.activeTab 'Onboarding')}}
            <section class='tab-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Onboarding</h2>
                  <p class='byline'>Active onboarding checklists</p>
                </div>
              </div>
              {{#if this.activeChecklists.length}}
                <div class='tile-grid'>
                  {{#each this.activeChecklists as |checklist|}}
                    <div class='tile ob-tile' {{on 'click' (fn this.openCard checklist)}}>
                      <div class='ob-header'>
                        <h4>{{checklist.title}}</h4>
                      </div>
                      {{#if checklist.employee}}
                        <p class='ob-person'>{{checklist.employee.name}}</p>
                      {{else if checklist.contractor}}
                        <p class='ob-person'>{{checklist.contractor.name}}</p>
                      {{/if}}
                      <p class='ob-status'>{{checklist.status}}</p>
                      {{#if checklist.tasks.length}}
                        <p class='ob-tasks'>{{checklist.tasks.length}} tasks</p>
                      {{/if}}
                    </div>
                  {{/each}}
                </div>
              {{else}}
                <p class='empty-note'>No active onboarding checklists</p>
              {{/if}}
            </section>
          {{/if}}

          {{#if (eq this.activeTab 'Contractors')}}
            <section class='tab-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Contractors</h2>
                  <p class='byline'>Current contractor roster</p>
                </div>
              </div>
              {{#if this.contractors.length}}
                <div class='tile-grid'>
                  {{#each this.contractors as |contractor|}}
                    <div class='tile contractor-tile' {{on 'click' (fn this.openCard contractor)}}>
                      <h4 class='contractor-name'>{{contractor.name}}</h4>
                      {{#if contractor.contractStatus}}
                        <p class='contractor-status'>{{contractor.contractStatus}}</p>
                      {{/if}}
                      {{#if contractor.billableRate}}
                        <p class='contractor-rate'>${{contractor.billableRate}}/hr</p>
                      {{/if}}
                      {{#if contractor.invoiceFrequency}}
                        <p class='contractor-freq'>{{contractor.invoiceFrequency}}</p>
                      {{/if}}
                    </div>
                  {{/each}}
                </div>
              {{else}}
                <p class='empty-note'>No contractors</p>
              {{/if}}
            </section>
          {{/if}}

          {{#if (eq this.activeTab 'Offers')}}
            <div class='tab-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Offers</h2>
                  <p class='byline'>Sorted by soonest to expire
                    {{#if this.expiringOfferCount}}
                      ·
                      <span class='byline-bad'>{{this.expiringOfferCount}}
                        expiring within 7 days</span>
                    {{/if}}</p>
                </div>
              </div>
              <div class='stats-row'>
                <div class='stat-card'>
                  <div class='stat-label'>Accept Rate</div>
                  <div class='stat-value'>{{this.acceptRateLabel}}</div>
                  <div class='stat-trend'>Of decided offers</div>
                </div>
                <div class='stat-card'>
                  <div class='stat-label'>Median Time to Offer</div>
                  <div class='stat-value'>{{this.medianTimeToOfferLabel}}</div>
                  <div class='stat-trend'>Applied → offer extended</div>
                </div>
                <div class='stat-card'>
                  <div class='stat-label'>Top Rejection Reason</div>
                  <div class='stat-value stat-value-sm'>
                    {{this.topRejectionReasonLabel}}
                  </div>
                  <div class='stat-trend'>Of rejected candidates</div>
                </div>
              </div>
              <div class='list-toolbar'>
                <div class='list-search'>
                  <BoxelInput
                    @type='search'
                    @value={{this.offersSearch}}
                    @placeholder='Search offers…'
                    @onInput={{this.setOffersSearch}}
                    aria-label='Search offers'
                  />
                </div>
                <div class='view-toggle' role='group' aria-label='View'>
                  <IconButton
                    type='button'
                    class='view-btn {{if (eq this.offersView "grid") "active"}}'
                    aria-label='Grid view'
                    {{on 'click' (fn this.setOffersView 'grid')}}
                  ><LayoutGridIcon class='view-icon' /></IconButton>
                  <IconButton
                    type='button'
                    class='view-btn
                      {{if (eq this.offersView "strip") "active"}}'
                    aria-label='List view'
                    {{on 'click' (fn this.setOffersView 'strip')}}
                  ><ListIcon class='view-icon' /></IconButton>
                </div>
              </div>
              {{#if this.filteredOffers.length}}
                <div
                  class='tile-grid
                    {{if (eq this.offersView "strip") "strip-view"}}'
                >
                  {{#each this.filteredOffers as |entry|}}
                    {{#let (get @fields.offers entry.index) as |OfferField|}}
                      {{#if OfferField}}
                        <div
                          class='tile
                            {{if (eq this.offersView "strip") "strip-tile"}}
                            {{if (eq entry.item.status "draft") "draft-tile"}}'
                        >
                          {{#if (eq entry.item.status 'draft')}}
                            <span class='draft-flag'>Draft &middot; not sent</span>
                          {{/if}}
                          <OfferField
                            @format='fitted'
                            @displayContainer={{false}}
                          />
                        </div>
                      {{/if}}
                    {{/let}}
                  {{/each}}
                </div>
              {{else}}
                <p class='empty-note'>No offers extended yet</p>
              {{/if}}
            </div>
          {{/if}}

          {{#if (eq this.activeTab 'Calendar')}}
            <section class='tab-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Calendar</h2>
                  <p class='byline'>Interview activity this cycle</p>
                </div>
              </div>
              {{#if this.interviewerLoad.length}}
                <div class='capacity-row'>
                  <span class='capacity-label'>Interviewer load this week</span>
                  {{#each this.interviewerLoad as |row|}}
                    <span class='turn-chip turn-{{row.tone}}'>
                      {{row.employee.name}}
                      {{row.hours}}h /
                      {{row.capacityHours}}h
                    </span>
                  {{/each}}
                </div>
              {{/if}}
              <Calendar
                @events={{this.calendarEvents}}
                @onSelectEvent={{this.openEvent}}
                @onRescheduleEvent={{this.rescheduleEvent}}
                @onAddMeeting={{this.addMeeting}}
                @addingDate={{this.addingMeetingOn}}
              />
            </section>
          {{/if}}

          {{#if (eq this.activeTab 'Org Chart')}}
            <section class='tab-section'>
              <div class='sec-head'>
                <div class='htext'>
                  <h2>Org Chart</h2>
                  <p class='byline'>Reporting lines, current headcount</p>
                </div>
              </div>
              <OrgTree @roots={{this.orgRoots}} @onSelect={{this.openCard}} />
            </section>
          {{/if}}
        </div>
      </div>
    </section>
    <style scoped>
      .tracker {
        /* ── ADAPTER, not a palette ────────────────────────────────
           Every value below is var(<semantic>) or a color-mix of one.
           No color is invented here, which is the whole reason a linked
           Theme can reskin this card without touching it. Fallbacks go
           to --boxel-* design tokens rather than literal hex: the
           fallback only fires where the CardContainer pipeline does not
           reach (a portaled surface before its bridge runs, prerendered
           HTML outside the host), and those are exactly the places with
           no theme to flip a literal — so a hardcoded light-mode value
           there is near-black-on-near-black in dark.
           ──────────────────────────────────────────────────────────── */
        --surface: var(--card, var(--boxel-light));
        --text: var(--card-foreground, var(--boxel-dark));
        --surface-alt: var(--muted, var(--boxel-100));
        --text-muted: var(--muted-foreground, var(--boxel-450));
        --line: var(--border, var(--boxel-200));
        --accent-c: var(--primary, var(--boxel-highlight));
        --on-accent: var(--primary-foreground, var(--boxel-light));

        /* Status hues have no semantic token — shadcn's vocabulary ships
           only --destructive — so these forward to boxel's status scale
           instead. They stay MARKS AND FILLS: never a text color, since
           none of them clears 4.5:1 on a light ground. */
        --success: var(--boxel-success);
        --warn: var(--boxel-warning);
        --warn-soft: color-mix(in oklch, var(--warn) 12%, var(--surface));

        /* Text-legible derivations of the three above.
           Mixed toward --text — this adapter's OWN forwarded foreground —
           and NOT toward --foreground directly. --text is by construction
           the color that pairs with --surface, so the mix and the ground
           it sits on cannot disagree: forward both and they flip together;
           pin both and they stay put. Mixing toward --foreground while the
           ground came from somewhere else is how you get light text on a
           light fill the moment a dark theme is linked.
           oklch, not srgb: 45% then darkens by the amount it looks like
           at every hue, where srgb over-darkens blues. */
        --accent-strong: color-mix(in oklch, var(--accent-c) 45%, var(--text));
        --success-strong: color-mix(in oklch, var(--success) 45%, var(--text));
        --warn-strong: color-mix(in oklch, var(--warn) 45%, var(--text));

        --tracker-radius: var(--radius, 0.875rem);
        container-type: inline-size;
        container-name: tracker;
        height: 100%;
        overflow-y: auto;
        background: var(--surface-alt);
        color: var(--text);
        /* Fonts come from the linked Theme's cssImports, never an @import
           here. The literal families stay as the var-chain's fallback. */
        font-family: var(--font-sans, 'Inter', system-ui, sans-serif);
      }
      .shell {
        display: grid;
        /* minmax(0, 1fr), not a bare 1fr — a plain 1fr track's minimum
           defaults to auto (its content's min-content size), so a wide
           descendant grid (stats-row's own minmax(140px, ...) tracks)
           would push this whole track wider than the container instead of
           shrinking to fit it. */
        grid-template-columns: 230px minmax(0, 1fr);
        min-height: 100%;
      }
      .rail {
        background: var(--surface-alt);
        border-right: 1px solid var(--line);
        padding: var(--boxel-sp-lg) var(--boxel-sp-lg);
        position: sticky;
        top: 0;
        align-self: start;
        height: 100vh;
        overflow-y: auto;
      }
      /* container queries react to the tracker's own rendered width (a
         narrow stack panel, an embedded fitted preview) — @media only sees
         the browser viewport, which can be wide while this card's actual
         box is narrow, so a viewport breakpoint never fires when it should. */
      @container tracker (max-width: 40rem) {
        .shell {
          grid-template-columns: minmax(0, 1fr);
        }
        .rail {
          position: static;
          height: auto;
          border-right: none;
          border-bottom: 1px solid var(--line);
        }
      }
      .rail-kicker {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--accent-strong);
        margin-bottom: var(--boxel-sp-5xs);
      }
      .rail-title {
        font-family: 'Inter', system-ui, sans-serif;
        font-weight: 700;
        font-size: 19px;
        line-height: 1.25;
        letter-spacing: -0.01em;
        margin: 0 0 var(--boxel-sp-5xs);
      }
      .rail-sub {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10.5px;
        letter-spacing: 0.03em;
        color: var(--text-muted);
        margin-bottom: var(--boxel-sp-xl);
      }
      .rail-nav {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .rail-filter-list {
        --boxel-filter-selected-background: var(--card, var(--boxel-light));
        --boxel-filter-selected-foreground: var(--text);
        --boxel-filter-expanded-background: transparent;
        --boxel-filter-hover-background: var(--surface-alt);
      }
      .rail-link {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        width: 100%;
        --boxel-button-min-height: 2.25rem;
        --boxel-button-min-width: 0;
        --boxel-button-border-radius: 0;
        --boxel-button-ghost-background: var(--surface);
        --boxel-button-ghost-foreground: var(--text);
        border: none;
        border-left: 4px solid transparent;
        font-family: 'Inter', system-ui, sans-serif;
        --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp-xs);
        transition:
          color 0.15s ease-out,
          border-color 0.15s ease-out,
          background-color 0.15s ease-out;
      }
      .rail-link:hover {
        border-left-color: var(--line);
      }
      .rail-link:focus-visible {
        outline: 2px solid var(--accent-c);
        outline-offset: 2px;
      }
      .rail-link .t {
        font-size: 13px;
        font-weight: 500;
      }
      .rail-link.current {
        border-left-color: var(--accent-c);
        --boxel-button-ghost-background: var(--card, var(--boxel-light));
      }
      .rail-link.current .t {
        color: var(--accent-strong);
        font-weight: 700;
      }
      .page {
        background: var(--surface);
        padding: var(--boxel-sp-xl) var(--boxel-sp-xxl, 3.5rem)
          var(--boxel-sp-xxxl, 6rem);
        min-width: 0;
      }
      .sec-head {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp);
        padding-bottom: var(--boxel-sp);
        border-bottom: 2px solid var(--text);
        margin: 0 0 var(--boxel-sp-lg);
      }
      .sec-head .htext h2 {
        font-family: 'Inter', system-ui, sans-serif;
        font-weight: 700;
        font-size: 20px;
        margin: 0 0 3px;
      }
      .sec-head .htext .byline {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 11.5px;
        letter-spacing: 0.02em;
        color: var(--text-muted);
        margin: 0;
      }
      .byline-bad {
        color: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 38%,
          var(--text)
        );
        font-weight: 700;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
      }
      /* A draft offer has not gone out yet, so it reads as provisional:
         dashed edge plus a literal label — never colour alone. */
      .draft-tile {
        position: relative;
        border-style: dashed;
        border-color: var(--warn);
      }
      .draft-flag {
        position: absolute;
        top: 0.375rem;
        right: 0.375rem;
        z-index: 1;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        padding: 0.1em 0.4em;
        border-radius: 3px;
        background: var(--warn-soft);
        color: var(--warn-strong);
      }
      /* A link, not a third decision button — visually subordinate so
         Approve/Reject stay the dominant pair. */
      .offer-link {
        --boxel-button-secondary-background: none;
        --boxel-button-secondary-foreground: var(--text-muted);
        --boxel-button-secondary-border: var(--line);
        --boxel-button-border-radius: 3px;
        --boxel-button-padding: 0.2em 0.5em;
        --boxel-button-min-height: 0;
        --boxel-button-min-width: 0;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.625rem;
        font-weight: 600;
        letter-spacing: 0.03em;
      }
      .offer-link:hover {
        --boxel-button-secondary-border: var(--accent-c);
        --boxel-button-secondary-foreground: var(--accent-strong);
      }
      .offer-link:focus-visible {
        outline: 2px solid var(--accent-c);
        outline-offset: 2px;
      }
      .card-extras {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.625rem 0.5rem;
        cursor: default;
      }
      /* No `:empty` rule here — template whitespace means it never matched.
         The strip is guarded by hasCardExtras in the template instead. */
      .age-chip,
      .avg-chip {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.625rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        padding: 0.125rem 0.4375rem;
        background: var(--surface-alt);
        color: var(--text-muted);
        font-variant-numeric: tabular-nums;
      }
      .age-chip.stale {
        background: none;
        border: 2px solid var(--accent-c);
        color: var(--accent-strong);
        border-radius: 0;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        transform: rotate(-4deg);
        text-shadow: 0.5px 0.5px 0 var(--accent-c);
      }
      .turn-chip {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        padding: 0.125rem 0.4375rem;
        border-radius: 999px;
      }
      .turn-red {
        background: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 14%,
          var(--surface)
        );
        color: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 38%,
          var(--text)
        );
      }
      .turn-amber {
        background: color-mix(in oklch, var(--warn) 14%, var(--surface));
        color: color-mix(in oklch, var(--warn) 38%, var(--text));
      }
      .turn-green {
        background: color-mix(in oklch, var(--success) 14%, var(--surface));
        color: color-mix(in oklch, var(--success) 38%, var(--text));
      }
      .capacity-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
        margin-bottom: var(--boxel-sp);
      }
      .capacity-label {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 11px;
        color: var(--text-muted);
      }
      .dim {
        color: var(--text-muted);
      }
      .btn-review {
        --boxel-button-primary-background: var(--primary, var(--boxel-highlight));
        --boxel-button-primary-foreground: var(--primary-foreground, var(--boxel-dark));
        --boxel-button-border: 1px solid var(--accent-c);
        --boxel-button-border-radius: var(--tracker-radius);
        --boxel-button-padding: 0.375rem 0.75rem;
        --boxel-button-min-height: 0;
        --boxel-button-min-width: 0;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 11.5px;
        font-weight: 700;
      }
      .review {
        border: 1px solid var(--line);
        border-radius: var(--tracker-radius);
        background: var(--surface);
        overflow: hidden;
      }
      .review:focus-visible {
        outline: 2px solid var(--accent-c);
        outline-offset: 2px;
      }
      .review-bar {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        background: var(--surface-alt);
        border-bottom: 1px solid var(--line);
        font-size: var(--boxel-font-size-xs);
      }
      .review-status {
        font-weight: 700;
      }
      .review-keys {
        margin-left: auto;
        color: var(--text-muted);
      }
      .review-keys kbd {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10.5px;
        border: 1px solid var(--line);
        border-radius: 3px;
        padding: 1px 4px;
        background: var(--surface);
      }
      .btn-review-exit {
        --boxel-button-default-background: var(--surface);
        --boxel-button-default-foreground: var(--text);
        --boxel-button-default-border: var(--line);
        --boxel-button-padding: 0.25rem 0.625rem;
        --boxel-button-border-radius: var(--tracker-radius);
        --boxel-button-min-height: 0;
        --boxel-button-min-width: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .review-panes {
        display: grid;
        grid-template-columns: 200px minmax(0, 1fr) 220px;
        min-height: 24rem;
      }
      @container tracker (max-width: 60rem) {
        .review-panes {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .review-queue {
        border-right: 1px solid var(--line);
        overflow-y: auto;
        max-height: 32rem;
      }
      .review-queue-item {
        display: flex;
        flex-direction: column;
        width: 100%;
        text-align: left;
        gap: 0.125rem;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: none;
        border-bottom: 1px solid var(--line);
        background: none;
        cursor: pointer;
      }
      .review-queue-item.on {
        background: var(--surface-alt);
      }
      .review-queue-name {
        font-weight: 700;
        font-size: var(--boxel-font-size-sm);
      }
      .review-queue-meta {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10.5px;
        color: var(--text-muted);
      }
      .review-resume {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        overflow-y: auto;
        max-height: 32rem;
      }
      .review-resume-head {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp);
      }
      .review-resume-text {
        white-space: pre-wrap;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
      }
      .review-actions {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
        border-left: 1px solid var(--line);
      }
      .btn-review-primary,
      .btn-review-danger {
        --boxel-button-border-radius: var(--tracker-radius);
        --boxel-button-padding: 0.5rem 0.75rem;
        --boxel-button-min-height: 0;
        --boxel-button-min-width: 0;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.75rem;
        font-weight: 700;
      }
      .btn-review-primary {
        --boxel-button-primary-background: var(--primary, var(--boxel-highlight));
        --boxel-button-primary-foreground: var(--primary-foreground, var(--boxel-dark));
        --boxel-button-border: 1px solid var(--accent-c);
      }
      .btn-review-danger {
        --boxel-button-secondary-background: var(--surface);
        --boxel-button-secondary-foreground: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 38%,
          var(--text)
        );
        --boxel-button-secondary-border: var(--line-2, var(--line));
      }
      .stage-act {
        --boxel-button-secondary-background: var(--surface);
        --boxel-button-secondary-foreground: var(--text);
        --boxel-button-secondary-border: var(--text);
        --boxel-button-border-radius: 0;
        --boxel-button-padding: 0.1875rem 0.5625rem;
        --boxel-button-min-height: 0;
        --boxel-button-min-width: 0;
        font: inherit;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.6875rem;
        font-weight: 600;
      }
      .stage-act:hover:not(:disabled) {
        --boxel-button-secondary-background: var(--surface-alt);
      }
      .stage-act:focus-visible,
      .screen-btn:focus-visible,
      .chip:focus-visible,
      .account-row:focus-visible,
      .rail-link:focus-visible {
        outline: 2px solid var(--accent-c);
        outline-offset: 2px;
      }
      .stage-act:disabled {
        --button-button-disabled-opacity: 0.6;
        cursor: default;
      }
      .stage-act.approve {
        --boxel-button-primary-background: var(--primary, var(--boxel-highlight));
        --boxel-button-primary-foreground: var(--primary-foreground, var(--boxel-dark));
        --boxel-button-border: 1px solid var(--success);
      }
      .stage-act.danger {
        --boxel-button-secondary-foreground: var(--warn-strong);
        --boxel-button-secondary-border: var(--warn);
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
        background: var(--accent-strong);
        color: var(--surface);
        font-family: 'IBM Plex Mono', monospace;
        font-size: var(--boxel-font-size-sm);
        margin: 0 0 var(--boxel-sp);
      }
      .dashboard-top {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        gap: var(--boxel-sp);
        margin-bottom: var(--boxel-sp-lg);
        align-items: start;
      }
      @container tracker (max-width: 48rem) {
        .dashboard-top {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .dashboard-left {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        min-height: 100%;
      }
      .stats-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: var(--boxel-sp);
      }
      .stat-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--tracker-radius);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .stat-card.hero {
        background: var(--text);
        border-color: var(--text);
        color: var(--surface);
      }
      .stat-card.hero .stat-label {
        color: rgba(255, 255, 255, 0.65);
      }
      .stat-card.hero .stat-value {
        color: var(--surface);
      }
      .stat-card.hero .stat-trend {
        color: color-mix(in oklch, var(--on-accent) 78%, var(--accent-c));
      }
      .stat-label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--text-muted);
      }
      .stat-value {
        margin-top: var(--boxel-sp-4xs);
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 1.75rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        color: var(--text);
      }
      .stat-trend {
        margin-top: var(--boxel-sp-4xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        color: var(--success-strong);
      }
      .chart-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--tracker-radius);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .chart-card-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: var(--boxel-sp-xs);
      }
      .chart-title {
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
      }
      .chart-total {
        font-size: var(--boxel-font-size-xs);
        color: var(--text-muted);
      }
      .stat-value-sm {
        font-size: 1.1rem;
      }
      .stat-trend-bad {
        color: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 38%,
          var(--text)
        );
      }
      .dashboard-filters {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp);
      }
      .dashboard-range-popover {
        position: absolute;
        top: calc(100% + var(--boxel-sp-4xs));
        left: 0;
        z-index: 2;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--tracker-radius);
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
        padding: var(--boxel-sp);
      }
      .source-effectiveness-card {
        margin-bottom: var(--boxel-sp-lg);
      }
      .ops-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: var(--boxel-sp);
        margin-bottom: var(--boxel-sp-lg);
      }
      .ops-col {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--tracker-radius);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .ops-col .col-h {
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        margin-bottom: var(--boxel-sp-xs);
      }
      .ops-col .data-table {
        margin-top: 0;
      }
      .pill-red {
        background: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 14%,
          var(--surface)
        );
        color: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 38%,
          var(--text)
        );
      }
      .pill-amber {
        background: color-mix(in oklch, var(--warn) 14%, var(--surface));
        color: color-mix(in oklch, var(--warn) 38%, var(--text));
      }
      .pill-green {
        background: color-mix(in oklch, var(--success) 14%, var(--surface));
        color: color-mix(in oklch, var(--success) 38%, var(--text));
      }
      .pill-mute {
        background: var(--surface-alt);
        color: var(--text-muted);
      }
      .board-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin: 0 0 var(--boxel-sp);
      }
      .board-head h2 {
        margin: 0;
        font-family: 'Inter', system-ui, sans-serif;
        font-size: var(--boxel-font-size);
        font-weight: 700;
      }
      .board-link {
        --boxel-button-link-foreground: var(--accent-strong);
        --boxel-button-link-active-foreground: var(--accent-strong);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        font-family: inherit;
      }
      .board-preview {
        display: flex;
        gap: var(--boxel-sp);
        overflow-x: auto;
        padding-bottom: var(--boxel-sp-4xs);
      }
      .pcol {
        display: flex;
        flex-direction: column;
        flex: 1 0 180px;
        min-width: 180px;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        border-radius: 0.85rem;
        background: var(--surface-alt);
      }
      .pcol-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .pcol-count {
        background: var(--surface);
        border-radius: 999px;
        padding: 0.05rem 0.5rem;
        font-weight: 700;
      }
      .kcard {
        width: 100%;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 0.7rem;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-family: inherit;
        color: inherit;
        cursor: pointer;
        text-align: left;
      }
      .kcard:hover {
        border-color: var(--accent-c);
      }
      .kavatar {
        width: 1.9rem;
        height: 1.9rem;
        border-radius: 50%;
        background: var(--accent-strong);
        color: var(--surface);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 0.72rem;
        flex: none;
      }
      .kmeta {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .kname {
        font-weight: 700;
        font-size: var(--boxel-font-size-sm);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .krole {
        font-size: var(--boxel-font-size-xs);
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .upcoming-card {
        margin-top: var(--boxel-sp-lg);
        padding: var(--boxel-sp);
        border: 1px solid var(--line);
        border-radius: 1.25rem;
        background: var(--surface);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .upcoming-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: var(--boxel-sp-xs);
      }
      .upcoming-row {
        width: 100%;
        background: var(--surface-alt);
        border: 1px solid var(--line);
        border-radius: 0.7rem;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-family: inherit;
        color: inherit;
        cursor: pointer;
        text-align: left;
      }
      .upcoming-row:hover {
        border-color: var(--accent-c);
      }
      .upcoming-date {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        flex: none;
        border-radius: 0.5rem;
        background: var(--surface);
        border: 1px solid var(--line);
      }
      .upcoming-day {
        font-weight: 700;
        font-size: var(--boxel-font-size-sm);
        line-height: 1;
      }
      .upcoming-month {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted);
      }
      .upcoming-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .upcoming-title {
        font-weight: 700;
        font-size: var(--boxel-font-size-sm);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .upcoming-time {
        font-size: var(--boxel-font-size-xs);
        color: var(--text-muted);
      }
      .accounts {
        margin-top: var(--boxel-sp-xl);
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: var(--boxel-sp-lg);
      }
      .account-col h2 {
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 14px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        margin: 0 0 var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-5xs);
        border-bottom: 1px solid var(--text);
      }
      .account-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .account-list li {
        border-bottom: 1px dotted var(--line);
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
        color: var(--accent-strong);
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
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10.5px;
        color: var(--text-muted);
        margin-left: auto;
        white-space: nowrap;
        text-transform: capitalize;
      }
      .empty-note {
        margin: var(--boxel-sp-xs) 0 0;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 12px;
        color: var(--text-muted);
      }
      .tile-grid {
        margin-top: var(--boxel-sp);
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
        gap: var(--boxel-sp);
      }
      .data-table-wrap {
        margin-top: var(--boxel-sp);
        overflow-x: auto;
        border: 1px solid var(--line);
        border-radius: 1rem;
        background: var(--surface);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .data-table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--boxel-font-size-sm);
      }
      .data-table th {
        text-align: left;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-family: 'IBM Plex Mono', monospace;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted);
        border-bottom: 1px solid var(--line);
        white-space: nowrap;
      }
      .data-table td {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--line);
        white-space: nowrap;
      }
      .data-table tbody tr:last-child td {
        border-bottom: none;
      }
      .data-table tbody tr:hover {
        background: var(--surface-alt);
      }
      .status-pill {
        display: inline-block;
        padding: 0.125rem 0.5rem;
        border-radius: 999px;
        font-size: 11px;
        text-transform: capitalize;
        white-space: nowrap;
      }
      .tile {
        border: 1px solid var(--line);
        border-radius: 1.25rem;
        overflow: hidden;
        /* 11rem clipped the fitted card's middle line once the extras block
           filled out. Taller tiles let every tier render whole rather than
           relying on the card to shrink text it should not shrink. */
        height: 13.5rem;
        background: var(--surface);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        transition:
          border-color 0.15s ease-out,
          box-shadow 0.15s ease-out;
      }
      .tile:hover {
        border-color: var(--accent-c);
        box-shadow: 0 2px 8px rgba(19, 19, 16, 0.08);
      }
      .tile:focus-within {
        border-color: var(--accent-c);
      }
      @media (prefers-reduced-motion: reduce) {
        .tile {
          transition: none;
        }
      }
      .app-tile {
        display: flex;
        flex-direction: column;
        height: auto;
      }
      /* The Application card carries the most extra facts of any tile, so it
         needs the most room. 9.5rem clipped the middle line; matching the
         other tiles' 13.5rem lets every tier render whole. The Screen button
         sits below this, which is why .app-tile itself stays height: auto. */
      .app-tile > :first-child {
        height: 13.5rem;
      }
      .tile-grid.strip-view {
        grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
        gap: var(--boxel-sp-xs);
      }
      .tile.strip-tile {
        height: 4rem;
      }
      .app-tile.strip-tile {
        height: auto;
        flex-direction: row;
        align-items: center;
      }
      .app-tile.strip-tile > :first-child {
        height: 4rem;
        flex: 1;
      }
      .app-tile.strip-tile .screen-btn {
        margin: 0 var(--boxel-sp-sm);
        flex: none;
      }
      .screen-btn {
        margin: 0 var(--boxel-sp-xs) var(--boxel-sp-xs);
        --boxel-button-secondary-background: none;
        --boxel-button-secondary-foreground: var(--accent-strong);
        --boxel-button-secondary-border: var(--accent-c);
        --boxel-button-border-radius: 0;
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp);
        --boxel-button-min-height: 0;
        --boxel-button-min-width: 0;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.8125rem;
        font-weight: 600;
        transition:
          background-color 0.15s ease-out,
          color 0.15s ease-out;
      }
      .screen-btn:hover:not(:disabled) {
        --boxel-button-secondary-background: var(--primary, var(--boxel-highlight));
        --boxel-button-secondary-foreground: var(--primary-foreground, var(--boxel-dark));
      }
      .screen-btn:disabled {
        cursor: not-allowed;
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
        --boxel-button-default-background: var(--surface);
        --boxel-button-default-foreground: var(--text-muted);
        --boxel-button-default-border: var(--line);
        --boxel-button-border-radius: 0;
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-button-min-height: 0;
        --boxel-button-min-width: 0;
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 11.5px;
        font-weight: 600;
        transition:
          background-color 0.15s ease-out,
          color 0.15s ease-out,
          border-color 0.15s ease-out;
      }
      .chip:hover {
        --boxel-button-default-border: var(--accent-c);
      }
      .chip.active {
        --boxel-button-default-background: var(--text);
        --boxel-button-default-foreground: var(--surface);
        --boxel-button-default-border: var(--text);
      }
      /* Breathing room under the stat strip above. Without it the search
         field butts straight against the metric cards and reads as part of
         them rather than as the start of the list below. */
      .list-toolbar {
        margin-top: var(--boxel-sp-lg);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp);
        margin-bottom: var(--boxel-sp);
      }
      .list-search {
        flex: 1;
        min-width: 12rem;
        max-width: 20rem;
      }
      .view-toggle {
        display: flex;
        margin-left: auto;
        border: 1px solid var(--line);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        flex: none;
      }
      .view-btn {
        --boxel-icon-button-width: 2rem;
        --boxel-icon-button-height: 2rem;
        --boxel-icon-button-background: var(--surface);
        --boxel-icon-button-color: var(--text-muted);
        border: none;
        border-radius: 0;
        transition:
          background-color 0.15s ease-out,
          color 0.15s ease-out;
      }
      .view-btn + .view-btn {
        border-left: 1px solid var(--line);
      }
      .view-btn:hover {
        --boxel-icon-button-color: var(--text);
      }
      .view-btn.active {
        --boxel-icon-button-background: var(--text);
        --boxel-icon-button-color: var(--surface);
      }
      .view-icon {
        width: 1rem;
        height: 1rem;
      }
      .directory {
        --embedded-card-min-height: 65px;
      }
      /* Portrait tiles that fill the row instead of CardList's fixed 170px
         grid columns. The descendant selector outranks the addon's own
         .grid-view rule. Scoped to grid mode only — strip mode keeps
         CardList's own narrower row layout. */
      .tab-section > .directory.grid-view {
        --item-width: auto;
        --item-height: 14rem;
        grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
      }
      .pipeline-section {
        height: 710px;
        display: flex;
        flex-direction: column;
        --boxel-kanban-bg: var(--surface-alt);
        --boxel-kanban-fg: var(--text);
        --boxel-kanban-card-bg: var(--surface);
        --boxel-kanban-card-fg: var(--text);
        --boxel-kanban-muted-fg: var(--text-muted);
        --boxel-kanban-border: var(--line);
      }
      .pipeline-section > .sec-head {
        flex: none;
      }
      .pipeline-section > *:last-child {
        flex: 1;
        min-height: 0;
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
        color: var(--success-strong);
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
  @field positions = linksToMany(() => Position);
  @field applications = linksToMany(() => Application);
  @field offers = linksToMany(() => Offer);

  // Denormalized counts. A prerendered fitted card cannot resolve linksToMany,
  // so every number the fitted view shows has to exist as an own attribute.
  // These are computed at index time, when the links ARE resolved.
  @field headcountTally = contains(StringField, {
    computeVia: function (this: TalentResourceTracker) {
      let n = (this.employees ?? []).filter(
        (e) => e && e.status !== 'offboarded',
      ).length;
      return String(n);
    },
  });

  @field pipelineTally = contains(StringField, {
    computeVia: function (this: TalentResourceTracker) {
      let n = (this.candidates ?? []).filter(
        (c) => c && c.status !== 'hired' && c.status !== 'rejected',
      ).length;
      return String(n);
    },
  });

  @field openReqTally = contains(StringField, {
    computeVia: function (this: TalentResourceTracker) {
      let n = (this.positions ?? []).filter((p) => p?.status === 'open').length;
      return String(n);
    },
  });

  // The one number that says whether anyone needs to act today: candidates
  // sitting at a stage where the next move is ours.
  @field needsUsTally = contains(StringField, {
    computeVia: function (this: TalentResourceTracker) {
      let n = (this.candidates ?? []).filter((c) => {
        if (!c || c.status === 'hired' || c.status === 'rejected') {
          return false;
        }
        if (c.status === 'offer') {
          return c.offerState !== 'extended';
        }
        return true;
      }).length;
      return String(n);
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: TalentResourceTracker) {
      return this.name?.trim() || 'Talent & Resource Tracker';
    },
  });

  static isolated = Isolated;

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='trt-atom'>
        <UsersRoundIcon class='trt-atom-icon' aria-hidden='true' />
        <span class='trt-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .trt-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .trt-atom-icon {
          width: 14px;
          height: 14px;
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .trt-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <article class='fit'>
        <div class='fit-top'>
          <span class='glyph' aria-hidden='true'>
            <UsersRoundIcon class='glyph-svg' />
          </span>
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            <span class='fit-eb'>Applicant tracking &amp; people ops</span>
          </div>
          {{! The one number worth surfacing at every size: how many people are
              waiting on us. It is the reason to open the app at all. }}
          {{#if @model.needsUsTally}}
            <span class='fit-pill'>
              <span class='pill-dot'></span>{{@model.needsUsTally}}
              need us
            </span>
          {{/if}}
        </div>

        <dl class='fit-stats'>
          <div>
            <dt>On staff</dt>
            <dd>{{if @model.headcountTally @model.headcountTally '0'}}</dd>
          </div>
          <div>
            <dt>In pipeline</dt>
            <dd>{{if @model.pipelineTally @model.pipelineTally '0'}}</dd>
          </div>
        </dl>

        <dl class='fit-add'>
          <div>
            <dt>Open reqs</dt>
            <dd>{{if @model.openReqTally @model.openReqTally '0'}}</dd>
          </div>
          <div>
            <dt>Needs action</dt>
            <dd>{{if @model.needsUsTally @model.needsUsTally '0'}}</dd>
          </div>
        </dl>
      </article>
      <style scoped>
        /* Four tiers, each ADDING numbers. 11px floor. The "needs us" pill
           survives to the smallest size because it is the only figure that
           tells the reader whether to open the app right now. */
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          border-left: 3px solid var(--trt-id);
          --trt-id: var(--primary, var(--boxel-highlight));
          --trt-strong: color-mix(
            in oklch,
            var(--trt-id) 45%,
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
        .glyph {
          flex: none;
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 5px;
          display: grid;
          place-items: center;
          background: var(--trt-strong);
        }
        .glyph-svg {
          width: 62%;
          height: 62%;
          color: var(--background, var(--boxel-light));
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
          color: var(--trt-strong);
        }
        .pill-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .fit-stats,
        .fit-add {
          display: none;
          margin: 0;
          grid-template-columns: 1fr 1fr;
          gap: 0.05rem 0.5rem;
        }
        .fit-stats {
          flex: none;
        }
        .fit-add {
          margin-top: auto;
          padding-top: 0.3rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
        }
        .fit-stats > div,
        .fit-add > div {
          min-width: 0;
        }
        .fit-stats dt,
        .fit-add dt {
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        .fit-stats dd {
          margin: 0;
          font-size: calc(var(--fit-name) * 1.35);
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .fit-add dd {
          margin: 0;
          font-size: var(--fit-small);
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }

        /* TIER 2 — add the subtitle. Two rules: container queries have no `or`. */
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
        /* TIER 3 — add the two headline counts. */
        @container fitted-card (height > 130px) and (width > 180px) {
          .fit-stats {
            display: grid;
          }
        }
        /* TIER 4 — add the secondary counts. */
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
        /* Short strip: horizontal, counts drop, pill stays. */
        @container fitted-card (height <= 90px) {
          .fit {
            justify-content: center;
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
          .glyph {
            width: 1.25rem;
            height: 1.25rem;
          }
          .fit-eb {
            display: none;
          }
        }
      </style>
    </template>
  };
}
