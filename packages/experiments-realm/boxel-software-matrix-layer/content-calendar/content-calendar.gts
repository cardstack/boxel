import {
  CardDef,
  Component,
  contains,
  field,
  realmURL,
  StringField,
  type CardContext,
} from '@cardstack/base/card-api';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import {
  CardCrudFunctionsContextName,
  identifyCard,
  type CardCrudFunctions,
  type getCards,
} from '@cardstack/runtime-common';
import { Button, TabbedHeader } from '@cardstack/boxel-ui/components';
import { cssVar, eq } from '@cardstack/boxel-ui/helpers';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import { consume } from 'ember-provide-consume-context';
import { restartableTask } from 'ember-concurrency';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { Calendar, type CalendarEvent } from '../components/calendar';
import { EnumSelect } from '../components/enum-select';
import { monthTitle } from '../utils/index';
import StatePill from '../components/state-pill';
import { ContentBundle } from './content-bundle';
import {
  CONTENT_STATUS_LABELS,
  PLATFORMS,
  PLATFORM_COLORS,
  contentStatusStyle,
  nextContentStatus,
  platformStyle,
} from './content-fields';
import { ContentIdea } from './content-idea';
import { ContentPiece } from './content-piece';
import { ContentSeries, nextOccurrences } from './content-series';
import { Freelancer } from './freelancer';

type SectionId =
  | 'calendar'
  | 'rhythm'
  | 'bundles'
  | 'backlog'
  | 'series'
  | 'bench';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'bundles', label: 'Bundles' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'series', label: 'Series' },
  { id: 'bench', label: 'Bench' },
];

const STATUS_RANK: Record<string, number> = {
  planned: 1,
  in_progress: 2,
  done: 3,
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const ALL_PLATFORMS = 'All platforms';

// How many occurrences one "materialise" press mints. There is no scheduler in
// the platform, so occurrences are real cards — an unbounded horizon would put
// hundreds in the realm.
const MATERIALISE_COUNT = 4;

const STATUS_GLYPH: Record<string, string> = {
  planned: '○',
  in_progress: '●',
  done: '✓',
};

interface ConsoleSignature {
  Args: {
    studioName?: string;
    realm?: string;
    calendarId?: string;
    context?: CardContext;
  };
  Element: HTMLElement;
}

class ContentCalendarConsole extends GlimmerComponent<ConsoleSignature> {
  @consume(CardCrudFunctionsContextName)
  declare cardCrudFunctions: CardCrudFunctions | undefined;

  @tracked sectionId: SectionId = 'calendar';
  @tracked platformFilter: string = ALL_PLATFORMS;
  @tracked actionProblem: string | undefined;
  @tracked addingOn: Date | undefined;
  @tracked busyId: string | undefined;

  @tracked private pieceQuery: ReturnType<getCards> | undefined;
  @tracked private bundleQuery: ReturnType<getCards> | undefined;
  @tracked private ideaQuery: ReturnType<getCards> | undefined;
  @tracked private seriesQuery: ReturnType<getCards> | undefined;
  @tracked private freelancerQuery: ReturnType<getCards> | undefined;

  constructor(owner: unknown, args: ConsoleSignature['Args']) {
    super(owner as never, args as never);
    let live = { isLive: true };
    let realms = () => (this.args.realm ? [this.args.realm] : []);
    let queryFor = (cardClass: typeof CardDef) => () => {
      if (!this.isInteractive) {
        return undefined;
      }
      let ref = identifyCard(cardClass);
      return ref ? { filter: { type: ref } } : undefined;
    };
    this.pieceQuery = this.args.context?.getCards(
      this,
      queryFor(ContentPiece),
      realms,
      live,
    );
    this.bundleQuery = this.args.context?.getCards(
      this,
      queryFor(ContentBundle),
      realms,
      live,
    );
    this.ideaQuery = this.args.context?.getCards(
      this,
      queryFor(ContentIdea),
      realms,
      live,
    );
    this.seriesQuery = this.args.context?.getCards(
      this,
      queryFor(ContentSeries),
      realms,
      live,
    );
    this.freelancerQuery = this.args.context?.getCards(
      this,
      queryFor(Freelancer),
      realms,
      live,
    );
  }

  // Prerender gets the static shell only; live queries and every interactive
  // surface are gated on a person actually looking at this.
  get isInteractive(): boolean {
    return Boolean(this.cardCrudFunctions?.viewCard);
  }

  get isLoadingData(): boolean {
    return [
      this.pieceQuery,
      this.bundleQuery,
      this.ideaQuery,
      this.seriesQuery,
      this.freelancerQuery,
    ].some((q) => Boolean(q?.isLoading));
  }

  /**
   * This calendar's owner key: the last two segments of its id, e.g.
   * `ContentCalendar/main`.
   *
   * Not the absolute id, and deliberately not the realm-relative path either.
   * Realm depth varies — served from staging this tree IS the realm root, but
   * locally the same tree is a subfolder of the experiments realm, so a
   * relative path gains a `boxel-software-matrix-layer/` segment and the same
   * content stops matching. The type folder plus the instance name is stable in
   * both, which is what makes the demo fixtures portable.
   */
  get calendarKey(): string | undefined {
    let id = this.args.calendarId;
    if (!id) {
      return undefined;
    }
    let path = id.replace(/\.json$/, '').split('/').filter(Boolean);
    return path.slice(-2).join('/') || undefined;
  }

  // A realm can hold more than one calendar, so every collection is scoped to
  // this one. Strictly: content that records no owner belongs to no calendar,
  // which is what makes a newly created calendar genuinely empty.
  private mine = <T extends { calendarId?: string | null }>(rows: T[]): T[] => {
    let me = this.calendarKey;
    if (!me) {
      return rows;
    }
    return rows.filter((r) => r.calendarId === me);
  };

  get pieces(): ContentPiece[] {
    return this.mine(
      ((this.pieceQuery?.instances ?? []) as ContentPiece[]).filter(Boolean),
    );
  }

  get bundles(): ContentBundle[] {
    return this.mine(
      ((this.bundleQuery?.instances ?? []) as ContentBundle[]).filter(Boolean),
    );
  }

  get ideas(): ContentIdea[] {
    return this.mine(
      ((this.ideaQuery?.instances ?? []) as ContentIdea[]).filter(Boolean),
    );
  }

  private get scheduledIdeaIds(): Set<string> {
    let ids = new Set<string>();
    for (let piece of this.pieces) {
      let id = piece.sourceIdea?.id;
      if (id) {
        ids.add(id);
      }
    }
    return ids;
  }

  get unscheduledIdeas(): ContentIdea[] {
    let scheduled = this.scheduledIdeaIds;
    return this.ideas.filter((i) => !i.id || !scheduled.has(i.id));
  }

  get scheduledIdeaCount(): number {
    return this.ideas.length - this.unscheduledIdeas.length;
  }

  get seriesList(): ContentSeries[] {
    return this.mine(
      ((this.seriesQuery?.instances ?? []) as ContentSeries[]).filter(Boolean),
    );
  }

  get freelancers(): Freelancer[] {
    return this.mine(
      ((this.freelancerQuery?.instances ?? []) as Freelancer[]).filter(Boolean),
    );
  }

  // ── Filtering ──────────────────────────────────────────────────────────

  get platformOptions(): string[] {
    return [ALL_PLATFORMS, ...PLATFORMS.map((p) => p.label)];
  }

  private get platformFilterValue(): string | undefined {
    return PLATFORMS.find((p) => p.label === this.platformFilter)?.value;
  }

  setPlatformFilter = (label: string | undefined) => {
    this.platformFilter = label ?? ALL_PLATFORMS;
  };

  get visiblePieces(): ContentPiece[] {
    let wanted = this.platformFilterValue;
    if (!wanted) {
      return this.pieces;
    }
    return this.pieces.filter((p) => p.platform === wanted);
  }

  // ── Calendar ───────────────────────────────────────────────────────────

  get calendarEvents(): CalendarEvent[] {
    return this.visiblePieces
      .filter((p) => p.scheduledAt)
      .map((p) => ({
        id: p.id,
        title: p.cardTitle ?? 'Untitled piece',
        date: new Date(p.scheduledAt as unknown as string),
        kind: p.platform ?? undefined,
      }));
  }

  get platformColors() {
    return PLATFORM_COLORS;
  }

  private pieceById(id?: string): ContentPiece | undefined {
    if (!id) {
      return undefined;
    }
    return this.pieces.find((p) => p.id === id);
  }

  shortFor = (event: CalendarEvent): string =>
    platformStyle(event?.kind).short;

  glyphFor = (event: CalendarEvent): string => {
    let piece = this.pieceById(event?.id);
    return STATUS_GLYPH[piece?.status ?? 'planned'] ?? '○';
  };

  isBundled = (event: CalendarEvent): boolean => {
    let id = event?.id;
    if (!id) {
      return false;
    }
    return this.bundles.some(
      (b) =>
        b.anchor?.id === id ||
        (b.supporting ?? []).filter(Boolean).some((p) => p?.id === id),
    );
  };

  openEvent = (event: CalendarEvent) => {
    this.open(this.pieceById(event?.id));
  };

  open = (card: CardDef | undefined) => {
    if (card) {
      this.cardCrudFunctions?.viewCard?.(card as never, 'isolated');
    }
  };

  reschedulePiece = async (event: CalendarEvent, newDate: Date) => {
    let piece = this.pieceById(event?.id);
    if (!piece?.scheduledAt) {
      return;
    }
    let previous = new Date(piece.scheduledAt as unknown as string);
    let updated = new Date(newDate);
    updated.setHours(
      previous.getHours(),
      previous.getMinutes(),
      previous.getSeconds(),
      0,
    );
    (piece as never as { scheduledAt: Date }).scheduledAt = updated;
    await this.save(piece);
  };

  private async save(card: CardDef) {
    this.actionProblem = undefined;
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.actionProblem = 'Commands are unavailable in this mode.';
      return;
    }
    try {
      await new SaveCardCommand(commandContext).execute({ card } as never);
    } catch (error: unknown) {
      this.actionProblem = (error as Error)?.message ?? String(error);
    }
  }

  cycleStatus = async (piece: ContentPiece) => {
    if (!piece) {
      return;
    }
    this.busyId = piece.id;
    try {
      (piece as never as { status: string }).status = nextContentStatus(
        piece.status,
      );
      await this.save(piece);
    } finally {
      this.busyId = undefined;
    }
  };

  statusLabel = (piece: ContentPiece): string =>
    contentStatusStyle(piece?.status).label;

  statusHue = (piece: ContentPiece) => contentStatusStyle(piece?.status).hue;

  platformLabel = (piece: ContentPiece): string =>
    platformStyle(piece?.platform).label;

  platformLabelFor = (value?: string | null): string =>
    platformStyle(value).label;

  // ── Creating ───────────────────────────────────────────────────────────

  /**
   * Make a piece without opening it. `createCard` deliberately opens the new
   * card in edit format, which is right for "new blank thing, go fill it in"
   * and wrong for scheduling — the person is working the backlog and expects to
   * stay there. Series materialisation would otherwise open one stack item per
   * occurrence.
   */
  private async createPieceSilently(attrs: {
    title?: string;
    platform?: string;
    status?: string;
    scheduledAt?: Date;
    brief?: string;
    sourceIdea?: ContentIdea;
    series?: ContentSeries;
  }): Promise<boolean> {
    let owned = { ...attrs, calendarId: this.calendarKey };
    let commandContext = this.args.context?.commandContext;
    if (!commandContext || !this.args.realm) {
      this.actionProblem = 'Commands are unavailable in this mode.';
      return false;
    }
    this.actionProblem = undefined;
    try {
      await new SaveCardCommand(commandContext).execute({
        card: new ContentPiece(owned as never),
        realm: this.args.realm,
      } as never);
      return true;
    } catch (error: unknown) {
      this.actionProblem = (error as Error)?.message ?? String(error);
      return false;
    }
  }

  private async create(
    module: string,
    name: string,
    attributes?: Record<string, unknown>,
  ) {
    let createCard = this.cardCrudFunctions?.createCard;
    if (!createCard || !this.args.realm) {
      this.actionProblem =
        'Save this calendar in a realm before creating records from it.';
      return;
    }
    this.actionProblem = undefined;
    let realm = new URL(this.args.realm);
    let ref = { module: new URL(module, this.args.realm).href, name };
    // Even a blank card gets its owner stamped, or it would show up in every
    // calendar in the realm the moment it is saved.
    let owned = { ...(attributes ?? {}), calendarId: this.calendarKey };
    try {
      await createCard(
        ref,
        realm,
        {
          realmURL: realm,
          doc: {
            data: {
              type: 'card',
              attributes: owned,
              meta: { adoptsFrom: ref },
            },
          },
        } as never,
      );
    } catch (error: unknown) {
      this.actionProblem = (error as Error)?.message ?? String(error);
    }
  }

  addPiece = (date: Date) => {
    void this.addPieceTask.perform(date);
  };

  private addPieceTask = restartableTask(async (date: Date) => {
    this.addingOn = date;
    try {
      await this.create('./content-calendar/content-piece', 'ContentPiece', {
        title: 'New content piece',
        status: 'planned',
        scheduledAt: date.toISOString(),
      });
    } finally {
      this.addingOn = undefined;
    }
  });

  newIdea = () => {
    void this.create('./content-calendar/content-idea', 'ContentIdea');
  };

  newBundle = () => {
    void this.create('./content-calendar/content-bundle', 'ContentBundle');
  };

  newSeries = () => {
    void this.create('./content-calendar/content-series', 'ContentSeries');
  };

  newFreelancer = () => {
    void this.create('./content-calendar/freelancer', 'Freelancer');
  };

  // ── Backlog → calendar ─────────────────────────────────────────────────

  startIdeaDrag = (idea: ContentIdea, event: DragEvent) => {
    if (!idea?.id) {
      return;
    }
    event.dataTransfer?.setData('text/plain', idea.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  };

  scheduleFromDrop = (event: DragEvent, date: Date) => {
    let id = event.dataTransfer?.getData('text/plain');
    let idea = this.ideas.find((i) => i.id === id);
    if (idea) {
      void this.scheduleIdeaTask.perform(idea, date);
    }
  };

  scheduleIdeaToday = (idea: ContentIdea) => {
    void this.scheduleIdeaTask.perform(idea, new Date());
  };

  private scheduleIdeaTask = restartableTask(
    async (idea: ContentIdea, date: Date) => {
      this.busyId = idea.id;
      this.addingOn = date;
      try {
        let when = new Date(date);
        when.setHours(9, 0, 0, 0);
        await this.createPieceSilently({
          title: idea.cardTitle ?? 'Untitled piece',
          brief: idea.thought ?? undefined,
          platform: idea.hunchPlatform ?? undefined,
          status: 'planned',
          scheduledAt: when,
          sourceIdea: idea,
        });
      } finally {
        this.busyId = undefined;
        this.addingOn = undefined;
      }
    },
  );

  // ── Series ─────────────────────────────────────────────────────────────

  materialise = (series: ContentSeries) => {
    void this.materialiseTask.perform(series);
  };

  private materialiseTask = restartableTask(async (series: ContentSeries) => {
    this.busyId = series.id;
    try {
      let slots = nextOccurrences(series, new Date(), MATERIALISE_COUNT);
      for (let slot of slots) {
        let ok = await this.createPieceSilently({
          title: series.cardTitle ?? 'Series occurrence',
          platform: series.platform ?? undefined,
          status: 'planned',
          scheduledAt: slot,
          series,
        });
        if (!ok) {
          break;
        }
      }
    } finally {
      this.busyId = undefined;
    }
  });

  seriesRhythm = (series: ContentSeries): string =>
    series?.rhythm ?? 'No cadence set';

  // ── Bench ──────────────────────────────────────────────────────────────

  get waitingOn(): { person: Freelancer; pieces: ContentPiece[] }[] {
    return this.freelancers
      .map((person) => ({
        person,
        pieces: this.pieces.filter(
          (p) => p.handedTo?.id === person.id && p.status !== 'done',
        ),
      }))
      .filter((row) => row.pieces.length > 0);
  }

  get mineOpen(): ContentPiece[] {
    return this.pieces.filter((p) => !p.handedTo && p.status !== 'done');
  }

  specialtyNames = (person: Freelancer): string => {
    let tags = (person?.specialties ?? []).filter(Boolean);
    return tags.map((t) => t?.name).filter(Boolean).join(', ');
  };

  // ── Masthead stats ─────────────────────────────────────────────────────

  private get weekBounds(): [number, number] {
    let now = new Date();
    let start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    let end = new Date(start);
    end.setDate(start.getDate() + 7);
    return [start.getTime(), end.getTime()];
  }

  get thisWeekCount(): number {
    let [start, end] = this.weekBounds;
    return this.pieces.filter((p) => {
      if (!p.scheduledAt) {
        return false;
      }
      let at = new Date(p.scheduledAt as unknown as string).getTime();
      return at >= start && at < end;
    }).length;
  }

  get inProgressCount(): number {
    return this.pieces.filter((p) => p.status === 'in_progress').length;
  }

  get handedOutCount(): number {
    return this.pieces.filter((p) => p.handedTo && p.status !== 'done').length;
  }

  // ── Rhythm (the posting-consistency sequencer) ─────────────────────────

  @tracked rhythmCursor = new Date();

  shiftRhythmMonth = (delta: number) => {
    this.rhythmCursor = new Date(
      this.rhythmCursor.getFullYear(),
      this.rhythmCursor.getMonth() + delta,
      1,
    );
  };

  get rhythmMonthTitle(): string {
    return monthTitle(this.rhythmCursor);
  }

  private get rhythmDayCount(): number {
    let c = this.rhythmCursor;
    return new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
  }

  // Strongest status per (platform, day) in the cursor month — a day with a
  // done reel and a planned story beats as done in the reel lane only.
  private get rhythmStatusMap(): Map<string, string> {
    let c = this.rhythmCursor;
    let map = new Map<string, string>();
    for (let piece of this.pieces) {
      if (!piece.scheduledAt || !piece.platform) {
        continue;
      }
      let at = new Date(piece.scheduledAt as unknown as string);
      if (at.getFullYear() !== c.getFullYear() || at.getMonth() !== c.getMonth()) {
        continue;
      }
      let key = `${piece.platform}|${at.getDate()}`;
      let status = piece.status ?? 'planned';
      let held = map.get(key);
      if (!held || (STATUS_RANK[status] ?? 0) > (STATUS_RANK[held] ?? 0)) {
        map.set(key, status);
      }
    }
    return map;
  }

  get rhythmRows(): {
    platform: (typeof PLATFORMS)[number];
    hue: string;
    cells: { key: string; cls: string }[];
  }[] {
    let map = this.rhythmStatusMap;
    let days = this.rhythmDayCount;
    return PLATFORMS.filter((p) =>
      Array.from(map.keys()).some((k) => k.startsWith(`${p.value}|`)),
    ).map((p) => ({
      platform: p,
      hue: PLATFORM_COLORS[p.value].ring,
      cells: Array.from({ length: days }, (_, i) => {
        let d = i + 1;
        let status = map.get(`${p.value}|${d}`);
        return {
          key: `${p.value}|${d}`,
          cls: status ? `beat is-${status}` : 'beat',
        };
      }),
    }));
  }

  // Zero-based column for today, or undefined when the cursor is off this
  // month — the playhead only exists when there is a today to point at.
  get todayIndex(): number | undefined {
    let now = new Date();
    if (
      now.getFullYear() !== this.rhythmCursor.getFullYear() ||
      now.getMonth() !== this.rhythmCursor.getMonth()
    ) {
      return undefined;
    }
    return now.getDate() - 1;
  }

  get hasToday(): boolean {
    return this.todayIndex !== undefined;
  }

  get rhythmColumnCount(): number {
    return this.rhythmDayCount;
  }

  get rhythmDayMarks(): { key: number; label: string; isToday: boolean }[] {
    let days = this.rhythmDayCount;
    let now = new Date();
    let cursorIsNow =
      now.getFullYear() === this.rhythmCursor.getFullYear() &&
      now.getMonth() === this.rhythmCursor.getMonth();
    let today = cursorIsNow ? now.getDate() : -1;
    return Array.from({ length: days }, (_, i) => {
      let d = i + 1;
      let isToday = d === today;
      let label = isToday || d === 1 || d % 5 === 0 ? String(d) : '';
      return { key: d, label, isToday };
    });
  }

  // Days (any lane) with at least one DONE piece — the streak's raw material.
  private get doneDayKeys(): Set<string> {
    let set = new Set<string>();
    for (let piece of this.pieces) {
      if (piece.status !== 'done' || !piece.scheduledAt) {
        continue;
      }
      set.add(dayKey(new Date(piece.scheduledAt as unknown as string)));
    }
    return set;
  }

  // Consecutive posting days ending today — or yesterday, so a streak isn't
  // "broken" by a day that isn't over yet.
  get currentStreak(): number {
    let done = this.doneDayKeys;
    let cursor = new Date();
    if (!done.has(dayKey(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    let streak = 0;
    while (done.has(dayKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  get bestStreakThisMonth(): number {
    let done = this.doneDayKeys;
    let c = this.rhythmCursor;
    let best = 0;
    let run = 0;
    for (let d = 1; d <= this.rhythmDayCount; d++) {
      if (done.has(dayKey(new Date(c.getFullYear(), c.getMonth(), d)))) {
        run++;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }
    return best;
  }

  get monthDoneCount(): number {
    let count = 0;
    for (let status of this.rhythmStatusMap.values()) {
      if (status === 'done') {
        count++;
      }
    }
    return count;
  }

  get topLane(): string {
    let counts = new Map<string, number>();
    for (let [key, status] of this.rhythmStatusMap) {
      if (status !== 'done') {
        continue;
      }
      let platform = key.split('|')[0];
      counts.set(platform, (counts.get(platform) ?? 0) + 1);
    }
    let top: string | undefined;
    let max = 0;
    for (let [platform, n] of counts) {
      if (n > max) {
        max = n;
        top = platform;
      }
    }
    return top ? platformStyle(top).label : '—';
  }

  bundleHue = (bundle: ContentBundle) => {
    let total = bundle?.pieceCount ?? 0;
    return total > 0 && (bundle?.doneCount ?? 0) === total ? 'green' : 'amber';
  };

  bundleSummary = (bundle: ContentBundle): string => {
    let anchor = bundle?.anchor;
    let supporting = (bundle?.supporting ?? []).filter(Boolean).length;
    let anchorLabel = anchor
      ? platformStyle(anchor.platform).label
      : 'no anchor';
    return `${anchorLabel} · ${supporting} supporting`;
  };

  get openBundleCount(): number {
    return this.bundles.filter((b) => {
      let total = b.pieceCount ?? 0;
      return total > 0 && (b.doneCount ?? 0) < total;
    }).length;
  }

  setSection = (id: SectionId) => {
    this.sectionId = id;
  };

  // Nothing anywhere. Distinct from "this pane is empty": the person has no
  // foothold at all, so the app owes them a first move rather than six empty
  // tabs.
  get isFirstRun(): boolean {
    if (!this.isInteractive || this.isLoadingData) {
      return false;
    }
    return (
      this.pieces.length === 0 &&
      this.ideas.length === 0 &&
      this.seriesList.length === 0 &&
      this.bundles.length === 0 &&
      this.freelancers.length === 0
    );
  }

  get hasNoPieces(): boolean {
    return this.pieces.length === 0;
  }

  get tabs() {
    return SECTIONS.map((s) => ({ tabId: s.id, displayName: s.label }));
  }

  get statusLabels() {
    return CONTENT_STATUS_LABELS;
  }

  <template>
    <section class='studio' ...attributes>
      {{#if this.isInteractive}}
        <TabbedHeader
          class='studio-header'
          @headerTitle={{if @studioName @studioName 'My content calendar'}}
          @tabs={{this.tabs}}
          @activeTabId={{this.sectionId}}
          @setActiveTab={{this.setSection}}
        >
          <:headerIcon>
            <span class='crest'><CalendarIcon class='crest-icon' /></span>
          </:headerIcon>
          <:sideContent>
            <div class='stats'>
              <div class='stat'>
                <span class='stat-n'>{{this.thisWeekCount}}</span>
                <span class='stat-l'>this week</span>
              </div>
              <div class='stat'>
                <span class='stat-n'>{{this.inProgressCount}}</span>
                <span class='stat-l'>in progress</span>
              </div>
              <div class='stat'>
                <span class='stat-n'>{{this.handedOutCount}}</span>
                <span class='stat-l'>with someone</span>
              </div>
              <div class='stat'>
                <span class='stat-n'>{{this.openBundleCount}}</span>
                <span class='stat-l'>open bundles</span>
              </div>
            </div>
          </:sideContent>
        </TabbedHeader>

        {{#if this.actionProblem}}
          <p class='problem' role='alert'>{{this.actionProblem}}</p>
        {{/if}}

        {{#if this.isFirstRun}}
          <section class='onboard'>
            <p class='onboard-eyebrow'>Nothing here yet</p>
            <h2 class='onboard-title'>Three moves and this calendar starts
              working for you.</h2>
            <ol class='steps'>
              <li class='step'>
                <span class='step-n'>1</span>
                <div class='step-body'>
                  <h3>Set up what repeats</h3>
                  <p>Your class reminder, your Monday post — the content that
                    holds an audience. Give it a cadence once and the calendar
                    fills itself in.</p>
                  <Button
                    type='button'
                    @kind='primary'
                    {{on 'click' this.newSeries}}
                  >Add a recurring series</Button>
                </div>
              </li>
              <li class='step'>
                <span class='step-n'>2</span>
                <div class='step-body'>
                  <h3>Empty your head into the backlog</h3>
                  <p>Ideas arrive mid-class, not at a desk. Capture them with
                    just a title now; pick the day later.</p>
                  <Button
                    type='button'
                    @kind='secondary'
                    {{on 'click' this.newIdea}}
                  >Capture an idea</Button>
                </div>
              </li>
              <li class='step'>
                <span class='step-n'>3</span>
                <div class='step-body'>
                  <h3>Plan one drop end to end</h3>
                  <p>A bundle is a video plus every post promoting it, counted
                    so you can see what is still missing before the day
                    arrives.</p>
                  <Button
                    type='button'
                    @kind='secondary'
                    {{on 'click' this.newBundle}}
                  >Start a bundle</Button>
                </div>
              </li>
            </ol>
            <p class='onboard-foot'>Prefer to dive in? Open
              <strong>Calendar</strong>
              and press
              <strong>+</strong>
              on any day.</p>
          </section>
        {{/if}}

        {{#if (eq this.sectionId 'calendar')}}
          <section class='pane'>
            <div class='pane-head'>
              <div class='pane-text'>
                <h2>Everything scheduled</h2>
                <p class='byline'>Drag a chip to reschedule. Drag an idea in
                  from the backlog to plan it.</p>
              </div>
              <EnumSelect
                class='filter'
                @label='Platform'
                @value={{this.platformFilter}}
                @options={{this.platformOptions}}
                @onChange={{this.setPlatformFilter}}
              />
            </div>
            {{#if this.hasNoPieces}}
              <p class='empty'>Nothing scheduled yet. Press
                <strong>+</strong>
                on any day below, or drag an idea in from the Backlog.</p>
            {{/if}}
            <Calendar
              @events={{this.calendarEvents}}
              @kindColors={{this.platformColors}}
              @onSelectEvent={{this.openEvent}}
              @onRescheduleEvent={{this.reschedulePiece}}
              @onAddEvent={{this.addPiece}}
              @onExternalDrop={{this.scheduleFromDrop}}
              @addingDate={{this.addingOn}}
            >
              <:chip as |event|>
                <span class='chip'>
                  <span class='chip-mark'>{{this.shortFor event}}</span>
                  <span class='chip-title'>{{event.title}}</span>
                  {{#if (this.isBundled event)}}
                    <span class='chip-bundle' title='Part of a bundle'>◆</span>
                  {{/if}}
                  <span class='chip-state'>{{this.glyphFor event}}</span>
                </span>
              </:chip>
            </Calendar>
          </section>
        {{/if}}

        {{#if (eq this.sectionId 'rhythm')}}
          <section class='pane'>
            <div class='pane-head'>
              <div class='pane-text'>
                <h2>Posting rhythm</h2>
                <p class='byline'>Every lane, every day. Consistency is the
                  choreography that grows an account.</p>
              </div>
              <div class='rhythm-nav'>
                <button
                  type='button'
                  class='nav-btn'
                  aria-label='Previous month'
                  {{on 'click' (fn this.shiftRhythmMonth -1)}}
                >‹</button>
                <span class='rhythm-month'>{{this.rhythmMonthTitle}}</span>
                <button
                  type='button'
                  class='nav-btn'
                  aria-label='Next month'
                  {{on 'click' (fn this.shiftRhythmMonth 1)}}
                >›</button>
              </div>
            </div>

            <div class='streak-slab'>
              <div class='streak-hero'>
                <span class='streak-n'>{{this.currentStreak}}</span>
                <span class='streak-unit'>day streak</span>
              </div>
              <dl class='streak-facts'>
                <div class='sf'>
                  <dt>Best this month</dt>
                  <dd>{{this.bestStreakThisMonth}} days</dd>
                </div>
                <div class='sf'>
                  <dt>Posted this month</dt>
                  <dd>{{this.monthDoneCount}}</dd>
                </div>
                <div class='sf'>
                  <dt>Loudest lane</dt>
                  <dd>{{this.topLane}}</dd>
                </div>
              </dl>
            </div>

            {{#if this.rhythmRows.length}}
              <div class='sequencer'>
                {{#if this.hasToday}}
                  <span
                    class='playhead'
                    style={{cssVar
                      today-i=this.todayIndex
                      day-n=this.rhythmColumnCount
                    }}
                    aria-hidden='true'
                  ></span>
                {{/if}}
                {{#each this.rhythmRows as |row|}}
                  <div class='lane' style={{cssVar beat-hue=row.hue}}>
                    <span class='lane-label'>
                      <span class='lane-dot'></span>
                      <span class='lane-name'>{{row.platform.label}}</span>
                    </span>
                    <div class='beats'>
                      {{#each row.cells key='key' as |cell|}}
                        <span class={{cell.cls}}></span>
                      {{/each}}
                    </div>
                  </div>
                {{/each}}
                <div class='lane marks-lane'>
                  <span class='lane-label'></span>
                  <div class='beats'>
                    {{#each this.rhythmDayMarks key='key' as |mark|}}
                      <span
                        class='mark {{if mark.isToday "is-today"}}'
                      >{{mark.label}}</span>
                    {{/each}}
                  </div>
                </div>
              </div>
              <p class='legend'>
                <span class='legend-item'><span class='beat is-done demo'></span>
                  posted</span>
                <span class='legend-item'><span
                    class='beat is-in_progress demo'
                  ></span>
                  in progress</span>
                <span class='legend-item'><span
                    class='beat is-planned demo'
                  ></span>
                  planned</span>
              </p>
            {{else}}
              <p class='empty'>Nothing scheduled this month — the lanes are
                silent.</p>
            {{/if}}
          </section>
        {{/if}}

        {{#if (eq this.sectionId 'bundles')}}
          <section class='pane'>
            <div class='pane-head'>
              <div class='pane-text'>
                <h2>Bundles</h2>
                <p class='byline'>An anchor plus everything that promotes it.</p>
              </div>
              <Button type='button' @kind='primary' {{on 'click' this.newBundle}}>
                New bundle
              </Button>
            </div>
            {{#if this.bundles.length}}
              <ul class='rows'>
                {{#each this.bundles as |bundle|}}
                  <li class='row'>
                    <button
                      type='button'
                      class='row-main'
                      {{on 'click' (fn this.open bundle)}}
                    >
                      <span class='row-title'>{{bundle.cardTitle}}</span>
                      <span class='row-meta'>{{this.bundleSummary bundle}}</span>
                    </button>
                    <StatePill
                      @label={{bundle.completion}}
                      @hue={{this.bundleHue bundle}}
                    />
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>No bundles yet. A bundle groups a video with its
                teasers so nothing gets forgotten.</p>
            {{/if}}
          </section>
        {{/if}}

        {{#if (eq this.sectionId 'backlog')}}
          <section class='pane'>
            <div class='pane-head'>
              <div class='pane-text'>
                <h2>Idea backlog</h2>
                <p class='byline'>Unscheduled. Drag one onto the calendar, or
                  schedule it for today.{{#if this.scheduledIdeaCount}}
                    <span class='byline-note'>{{this.scheduledIdeaCount}}
                      already planned — open the piece it became to find it
                      again.</span>
                  {{/if}}</p>
              </div>
              <Button type='button' @kind='primary' {{on 'click' this.newIdea}}>
                Capture idea
              </Button>
            </div>
            {{#if this.unscheduledIdeas.length}}
              <ul class='rows'>
                {{#each this.unscheduledIdeas as |idea|}}
                  <li
                    class='row idea-row'
                    draggable='true'
                    {{on 'dragstart' (fn this.startIdeaDrag idea)}}
                  >
                    <button
                      type='button'
                      class='row-main'
                      {{on 'click' (fn this.open idea)}}
                    >
                      <span class='row-title'>{{idea.cardTitle}}</span>
                      {{#if idea.hunchPlatform}}
                        <span class='row-meta'>{{this.platformLabelFor
                            idea.hunchPlatform
                          }}</span>
                      {{/if}}
                    </button>
                    <Button
                      type='button'
                      @kind='secondary'
                      @loading={{eq this.busyId idea.id}}
                      {{on 'click' (fn this.scheduleIdeaToday idea)}}
                    >Schedule today</Button>
                  </li>
                {{/each}}
              </ul>
            {{else if this.scheduledIdeaCount}}
              <p class='empty'>Backlog clear — all
                {{this.scheduledIdeaCount}}
                captured ideas are on the calendar.</p>
            {{else}}
              <p class='empty'>Nothing captured yet.</p>
            {{/if}}
          </section>
        {{/if}}

        {{#if (eq this.sectionId 'series')}}
          <section class='pane'>
            <div class='pane-head'>
              <div class='pane-text'>
                <h2>Recurring series</h2>
                <p class='byline'>Materialising mints
                  {{MATERIALISE_COUNT}}
                  real pieces at a time — there is no scheduler to do it for
                  you.</p>
              </div>
              <Button type='button' @kind='primary' {{on 'click' this.newSeries}}>
                New series
              </Button>
            </div>
            {{#if this.seriesList.length}}
              <ul class='rows'>
                {{#each this.seriesList as |series|}}
                  <li class='row'>
                    <button
                      type='button'
                      class='row-main'
                      {{on 'click' (fn this.open series)}}
                    >
                      <span class='row-title'>{{series.cardTitle}}</span>
                      <span class='row-meta'>{{this.seriesRhythm series}}</span>
                    </button>
                    {{#unless series.active}}
                      <StatePill @label='Paused' @hue='slate' @chrome={{true}} />
                    {{/unless}}
                    <Button
                      type='button'
                      @kind='secondary'
                      @loading={{eq this.busyId series.id}}
                      {{on 'click' (fn this.materialise series)}}
                    >Materialise next {{MATERIALISE_COUNT}}</Button>
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>No series yet. A weekly class reminder is the
                usual first one.</p>
            {{/if}}
          </section>
        {{/if}}

        {{#if (eq this.sectionId 'bench')}}
          <section class='pane'>
            <div class='pane-head'>
              <div class='pane-text'>
                <h2>Freelancer bench</h2>
                <p class='byline'>People you hand work to. They are records
                  here, not users — nothing is sent to them.</p>
              </div>
              <Button
                type='button'
                @kind='primary'
                {{on 'click' this.newFreelancer}}
              >
                Add freelancer
              </Button>
            </div>

            {{#if this.freelancers.length}}
              <ul class='rows'>
                {{#each this.freelancers as |person|}}
                  <li class='row'>
                    <button
                      type='button'
                      class='row-main'
                      {{on 'click' (fn this.open person)}}
                    >
                      <span class='row-title'>{{person.name}}</span>
                      <span class='row-meta'>{{this.specialtyNames person}}</span>
                    </button>
                    {{#if person.rateNote}}
                      <span class='rate'>{{person.rateNote}}</span>
                    {{/if}}
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>Bench is empty.</p>
            {{/if}}

            <h3 class='sub'>Waiting on someone else</h3>
            {{#if this.waitingOn.length}}
              {{#each this.waitingOn as |row|}}
                <div class='waiting'>
                  <p class='waiting-who'>{{row.person.name}}
                    <span class='waiting-n'>{{row.pieces.length}}</span></p>
                  <ul class='rows tight'>
                    {{#each row.pieces as |piece|}}
                      <li class='row'>
                        <button
                          type='button'
                          class='row-main'
                          {{on 'click' (fn this.open piece)}}
                        >
                          <span class='row-title'>{{piece.cardTitle}}</span>
                          <span class='row-meta'>{{this.platformLabel
                              piece
                            }}</span>
                        </button>
                        <Button
                          type='button'
                          @kind='secondary'
                          @loading={{eq this.busyId piece.id}}
                          {{on 'click' (fn this.cycleStatus piece)}}
                        >{{this.statusLabel piece}}</Button>
                      </li>
                    {{/each}}
                  </ul>
                </div>
              {{/each}}
            {{else}}
              <p class='empty'>Nothing is out with anyone.</p>
            {{/if}}
          </section>
        {{/if}}
      {{else}}
        <header class='shell-head'>
          <span class='crest'><CalendarIcon class='crest-icon' /></span>
          <div>
            <p class='eyebrow'>Content calendar</p>
            <h1>{{if @studioName @studioName 'My content calendar'}}</h1>
          </div>
        </header>
        <p class='shell-note'>Open this calendar in the app to plan content,
          group bundles and hand work to your bench.</p>
      {{/if}}
    </section>

    <style scoped>
      /* ── ADAPTER, not a palette ──────────────────────────────────────
         Every colour below resolves through a semantic token with a
         --boxel-* fallback, so a linked Theme reskins the whole console
         without this file changing. */
      .studio {
        --studio-band: color-mix(
          in oklch,
          var(--primary, var(--boxel-purple)) 88%,
          var(--foreground, var(--boxel-dark))
        );
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        font-family: var(--font-sans, var(--boxel-font-family));
      }
      
      
      .crest {
        display: grid;
        place-items: center;
        width: 2.5rem;
        height: 2.5rem;
        flex: none;
        border-radius: 0.75rem;
        background: var(--studio-band);
      }
      .crest-icon {
        width: 20px;
        height: 20px;
        color: var(--background, var(--boxel-light));
      }
      .eyebrow {
        margin: 0;
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.09em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      h1 {
        margin: 0;
        font-family: var(
          --font-display,
          var(--font-sans, var(--boxel-font-family))
        );
        font-size: 1.5rem;
        font-weight: 500;
        line-height: 1.15;
        letter-spacing: -0.015em;
      }
      .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 1.25rem;
      }
      .stat {
        display: grid;
        gap: 0.1rem;
        justify-items: start;
      }
      .stat-n {
        font-family: var(
          --font-display,
          var(--font-sans, var(--boxel-font-family))
        );
        font-size: 1.5rem;
        font-weight: 650;
        line-height: 1;
        letter-spacing: -0.015em;
        font-variant-numeric: tabular-nums;
      }
      .stat-l {
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      
      
      
      
      .problem {
        margin: 0;
        border-radius: var(--boxel-border-radius-sm);
        padding: 0.5rem 0.75rem;
        background: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 12%,
          var(--card, var(--boxel-light))
        );
        color: var(--foreground, var(--boxel-dark));
        font-size: 0.8125rem;
      }
      .pane {
        display: grid;
        gap: var(--boxel-sp);
      }
      .pane-head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--boxel-sp);
      }
      .pane-text h2 {
        margin: 0;
        font-family: var(
          --font-display,
          var(--font-sans, var(--boxel-font-family))
        );
        font-size: 1.375rem;
        font-weight: 400;
        line-height: 1.15;
        letter-spacing: -0.015em;
      }
      .byline {
        margin: 0.15rem 0 0;
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .byline-note {
        display: block;
        font-weight: 600;
      }
      .filter {
        min-width: 13rem;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        width: 100%;
        min-width: 0;
      }
      .chip-mark {
        font-size: 0.5625rem;
        font-weight: 800;
        letter-spacing: 0.03em;
        opacity: 0.75;
        flex: none;
      }
      .chip-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chip-bundle,
      .chip-state {
        flex: none;
        font-size: 0.5625rem;
        opacity: 0.8;
      }
      
      
      
      .rows {
        display: grid;
        gap: 0.375rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .rows.tight {
        gap: 0.25rem;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm);
        padding: 0.4rem 0.6rem;
        background: var(--card, var(--boxel-light));
      }
      .idea-row {
        cursor: grab;
      }
      .row-main {
        display: flex;
        flex: 1;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.5rem;
        min-width: 0;
        border: none;
        padding: 0;
        background: none;
        text-align: left;
        cursor: pointer;
        color: inherit;
      }
      .row-title {
        font-size: 0.8125rem;
        font-weight: 600;
      }
      .row-meta {
        font-size: 0.6875rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .rate {
        font-size: 0.6875rem;
        color: var(--muted-foreground, var(--boxel-450));
        white-space: nowrap;
      }
      .sub {
        margin: var(--boxel-sp) 0 0;
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .waiting {
        display: grid;
        gap: 0.35rem;
        padding-top: 0.5rem;
      }
      .waiting-who {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin: 0;
        font-size: 0.8125rem;
        font-weight: 600;
      }
      .waiting-n {
        border-radius: 999px;
        padding: 0.05rem 0.4rem;
        background: var(--muted, var(--boxel-100));
        font-size: 0.6875rem;
        font-variant-numeric: tabular-nums;
      }
      .rhythm-nav {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .rhythm-month {
        min-width: 9rem;
        text-align: center;
        font: 600 0.8125rem/1.4 var(--font-sans, var(--boxel-font-family));
      }
      .nav-btn {
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm);
        padding: 0.15rem 0.6rem;
        background: var(--card, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        font-size: 0.875rem;
        cursor: pointer;
      }
      .nav-btn:hover {
        border-color: var(--studio-band);
      }
      .streak-slab {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 2rem;
        padding: var(--boxel-sp) 0;
        border-top: 2px solid var(--foreground, var(--boxel-dark));
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .streak-hero {
        display: flex;
        align-items: baseline;
        gap: 0.6rem;
      }
      .streak-n {
        font-family: var(--font-display, var(--font-sans, var(--boxel-font-family)));
        font-size: 4rem;
        font-weight: 750;
        line-height: 0.9;
        letter-spacing: -0.02em;
        color: var(--primary, var(--boxel-purple));
        font-variant-numeric: tabular-nums;
      }
      .streak-unit {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .streak-facts {
        display: flex;
        flex-wrap: wrap;
        gap: 2rem;
        margin: 0;
      }
      .sf {
        display: grid;
        gap: 0.15rem;
      }
      .sf dt {
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.09em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .sf dd {
        margin: 0;
        font-family: var(--font-display, var(--font-sans, var(--boxel-font-family)));
        font-size: 1.125rem;
        font-weight: 650;
      }
      .sequencer {
        --lane-label-w: 8.5rem;
        --lane-gap: 0.75rem;
        --beat-gap: 2px;
        position: relative;
        display: grid;
        gap: 0.375rem;
      }
      .lane {
        display: grid;
        grid-template-columns: var(--lane-label-w) minmax(0, 1fr);
        align-items: center;
        gap: var(--lane-gap);
      }
      /* A sequencer's playhead. Today used to be drawn as a ring on each cell
         in the column, which is the same shape "planned" uses — so an empty
         lane on today read as scheduled content. One line across every lane
         says "here" without claiming anything is in the cell. The arithmetic
         mirrors the flex row above it: N equal cells separated by --beat-gap. */
      .playhead {
        position: absolute;
        top: -0.15rem;
        bottom: 1.15rem;
        width: 2px;
        pointer-events: none;
        background: var(--primary, var(--boxel-purple));
        left: calc(
          var(--lane-label-w) + var(--lane-gap) +
            (
                (100% - var(--lane-label-w) - var(--lane-gap)) -
                  (var(--day-n) - 1) * var(--beat-gap)
              ) / var(--day-n) * var(--today-i) + var(--beat-gap) *
            var(--today-i) +
            (
                (100% - var(--lane-label-w) - var(--lane-gap)) -
                  (var(--day-n) - 1) * var(--beat-gap)
              ) / var(--day-n) / 2 - 1px
        );
      }
      .playhead::before {
        content: '';
        position: absolute;
        top: -3px;
        left: -3px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--primary, var(--boxel-purple));
      }
      .lane-label {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        min-width: 0;
      }
      .lane-dot {
        width: 8px;
        height: 8px;
        flex: none;
        border-radius: 50%;
        background: var(--beat-hue, var(--muted-foreground, var(--boxel-450)));
      }
      .lane-name {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .beats {
        display: flex;
        gap: 2px;
      }
      .beat {
        flex: 1;
        min-width: 0;
        height: 18px;
        border-radius: 3px;
        background: color-mix(
          in oklch,
          var(--foreground, var(--boxel-dark)) 4%,
          transparent
        );
      }
      .beat.is-planned {
        background: transparent;
        border: 1px solid
          color-mix(in oklch, var(--beat-hue, var(--boxel-450)) 45%, transparent);
      }
      .beat.is-in_progress {
        background: color-mix(
          in oklch,
          var(--beat-hue, var(--boxel-450)) 30%,
          transparent
        );
        border: 1px solid
          color-mix(in oklch, var(--beat-hue, var(--boxel-450)) 55%, transparent);
      }
      .beat.is-done {
        background: var(--beat-hue, var(--boxel-450));
      }
      .beat.demo {
        flex: none;
        width: 18px;
        --beat-hue: var(--muted-foreground, var(--boxel-450));
      }
      .marks-lane {
        margin-top: -0.125rem;
      }
      .mark {
        flex: 1;
        min-width: 0;
        text-align: center;
        font-size: 0.5625rem;
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .mark.is-today {
        font-weight: 800;
        color: var(--primary, var(--boxel-purple));
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 1.25rem;
        margin: 0;
        font-size: 0.6875rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }
      .onboard {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
        border-top: 2px solid var(--foreground, var(--boxel-dark));
        border-bottom: 1px solid var(--border, var(--boxel-200));
        background: var(--card, var(--boxel-light));
      }
      .onboard-eyebrow {
        margin: 0;
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .onboard-title {
        margin: 0;
        max-width: 34ch;
        font-family: var(
          --font-display,
          var(--font-sans, var(--boxel-font-family))
        );
        font-size: 1.75rem;
        font-weight: 400;
        line-height: 1.12;
        letter-spacing: -0.02em;
      }
      .steps {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
        gap: var(--boxel-sp-lg);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .step {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 0.75rem;
        align-items: start;
      }
      .step-n {
        font-family: var(
          --font-display,
          var(--font-sans, var(--boxel-font-family))
        );
        font-size: 1.5rem;
        font-weight: 700;
        line-height: 1;
        color: var(--primary, var(--boxel-purple));
        font-variant-numeric: tabular-nums;
      }
      .step-body {
        display: grid;
        gap: 0.35rem;
        justify-items: start;
      }
      .step-body h3 {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 650;
      }
      .step-body p {
        margin: 0;
        font-size: 0.8125rem;
        line-height: 1.5;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .onboard-foot {
        margin: 0;
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--border, var(--boxel-200));
        font-size: 0.8125rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .empty,
      .shell-note {
        margin: 0;
        border: 1px dashed var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
        color: var(--muted-foreground, var(--boxel-450));
        font-size: 0.8125rem;
      }
    </style>
  </template>
}

export class ContentCalendar extends CardDef {
  static displayName = 'Content Calendar';
  static icon = CalendarIcon;
  static prefersWideFormat = true;

  @field studioName = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ContentCalendar) {
      return this.studioName?.trim()?.length
        ? `${this.studioName} — Content Calendar`
        : 'Content Calendar';
    },
  });

  static isolated = class Isolated extends Component<typeof ContentCalendar> {
    get realm(): string | undefined {
      return this.args.model?.[realmURL]?.href;
    }
    <template>
      <ContentCalendarConsole
        @studioName={{@model.studioName}}
        @realm={{this.realm}}
        @calendarId={{@model.id}}
        @context={{@context}}
      />
    </template>
  };
}

export default ContentCalendar;
