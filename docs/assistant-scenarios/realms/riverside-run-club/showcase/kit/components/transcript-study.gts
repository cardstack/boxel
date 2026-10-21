// Pretui — Transcript study: every assistant-transcript interaction on the design canvas, composed from Pret UI parts.
//
// A composition study, not a product surface: each artboard is a dark
// assistant panel at a real width, filled with literals, so the same board
// always shows the same instant. The two switches (the preview receipt's
// stage, the register) are the only state; nothing here keeps a clock.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { array, fn, hash } from '@ember/helper';
import { themeScope, themeScopedCss } from '@cardstack/boxel-ui/helpers';
import { STUDY_THEMES } from './transcript-study-themes';
import { on } from '@ember/modifier';

import { AgentQuestion } from './agent-question';
import { AppAuthGate } from './app-auth-gate';
import { AppBar } from './app-bar';
import { DisplayModeToggle } from './display-mode-toggle';
import { McpAppFrame } from './mcp-app-frame';
import type { AppHostBridge } from './mcp-app-frame';
import { SaveBar } from './save-bar';
import type { SaveState } from './save-bar';
import { deliverIntent } from './intent-bridge';
import type { IntentChannels } from './intent-bridge';
import type { CardEmbedState } from './card-embed';
import { MarkdownStream } from './markdown-stream';
import type { MarkdownSource } from './markdown-stream';
import { CardEmbed } from './card-embed';
import { LiveCard } from './live-card';
import type { CardIntent } from './live-card';
import type { ToolRenderers } from './tool-row';
import { AuthoredMark } from './authored-mark';
import { BranchSwitcher } from './branch-switcher';
import { ChangeReview } from './change-review';
import type { ReviewFile } from './change-review';
import type { DiffHunk, DiffHunkState } from './diff-block';
import { PatchBlock } from './patch-block';
import type { PatchState } from './patch-block';
import { AgentTurn } from './agent-turn';
import { GateStack } from './gate-stack';
import type { StackedGate } from './gate-stack';
import { MessageActions } from './message-actions';
import { ModelPicker } from './model-picker';
import type { PickerModel } from './model-picker';
import { QueuePanel } from './queue-panel';
import type { QueuedMessage } from './queue-panel';
import { StickToBottom } from './stick-to-bottom';
import { UserBubble } from './user-bubble';
import { VirtualTimeline } from './virtual-timeline';
import { Odometer } from './odometer';
import { Presence } from './presence';
import { AnswerFooter } from './answer-footer';
import { CardPills } from './card-pills';
import type { CardPillItem } from './card-pills';
import { GateDock } from './gate-dock';
import { ResultCard } from './result-card';
import { Thinking } from './thinking';
import type { ThinkingRow } from './thinking';
import { ToolChangeTable } from './tool-change-table';
import type { ToolChangeRow } from './tool-change-table';
import { ToolGroup } from './tool-group';
import type { ToolPart } from './tool-group';
import { TranscriptStatus } from './transcript-status';
import {
  MethodNote,
  SourceRef,
  SourcesStrip,
  StatChips,
} from './answer-furniture';
import { CollapsedTurn } from './collapsed-turn';
import { ContextRing } from './context-ring';
import type { ComposerAttachment } from './composer';
import { Composer } from './composer';
import { JumpChip } from './jump-chip';
import { QueuedNote } from './queued-note';
import { SegmentedControl } from './segmented-control';
import type { SegmentOption } from './segmented-control';
import { SpeakerLabel } from './speaker-label';
import { SystemLine } from './system-line';
import { ToolGate } from './tool-gate';
import type { ToolGateAction } from './tool-gate';
import { ToolMeta } from './tool-meta';
import { ToolPlan } from './tool-plan';
import { TaskChecklist } from './task-checklist';
import { Reactions } from './reactions';
import type { Reaction } from './reactions';
import type { ToolPlanStep } from './tool-plan';
import { ToolRetry } from './tool-retry';
import {
  ToolChange,
  ToolDiff,
  ToolLine,
  ToolReceiptAction,
  ToolRow,
} from './tool-row';
import { Transmute } from './transmute';

// ── fixtures ─────────────────────────────────────────────────────────────

const PLAN_BEFORE = `<template>
  <article class='plan'>
    <Poster @poster={{@model.poster}} />
    <h1>{{@model.title}}</h1>
  </article>
  <style scoped>
    .plan { display: grid; gap: 12px; }
  </style>
</template>`;
const PLAN_AFTER = `<template>
  <article class='plan'>
    <Poster @poster={{@model.poster}} />
    <h1>{{@model.title}}</h1>
  </article>
  <style scoped>
    .plan { display: grid; gap: 12px; }
    .plan :deep(.poster) { border: 3px solid var(--plan-accent); }
  </style>
</template>`;
const LENA_BEFORE = `{ "name": "Lena Ruiz", "runs": 4, "tier": "Member" }`;
const LENA_AFTER = `{ "name": "Lena Ruiz", "runs": 4, "tier": "Regular" }`;

const RESEARCH_PLAN: ToolPlanStep[] = [
  { label: 'Search race calendars', state: 'done' },
  { label: 'Read each race page', state: 'current', note: '3 of 5' },
  { label: 'Compare kids’ fees', state: 'next' },
  { label: 'Post the table here', state: 'next' },
];
// the agent's own task list: steps finish out of order, one under way
const AGENT_TASKS = [
  'Map how held approvals flow today',
  'Design 👍/👎 reaction as the approval',
  'Host: send reaction, read approvers',
  'ai-bot: approve on a member’s 👍',
  'Show who approved on the gate',
  'Tests, lint, types',
];
// the order the steps finish in, and what the agent says while on each
const AGENT_ORDER = [0, 1, 3, 2, 4, 5];
const AGENT_ACTIVITY = [
  'Reading the approval path',
  'Weighing a reaction against a result event',
  'Sending the 👍 from the host',
  'Teaching ai-bot to read reactions',
  'Drawing who approved on the gate',
  'Running the approval tests',
];
const STOPPED_PLAN: ToolPlanStep[] = [
  { label: 'Manhattan', state: 'done' },
  { label: 'Brooklyn', state: 'done' },
  { label: 'Queens', state: 'done' },
  { label: 'The Bronx', state: 'done' },
  { label: 'Staten Island', state: 'skipped' },
  { label: 'Summarize', state: 'skipped' },
];

const NAMES = [
  'Lena Ruiz',
  'Omar Haddad',
  'Kai Moreno',
  'Priya Shah',
  'Jonas Berg',
  'Ada Okafor',
  'Mei Tanaka',
  'Sam Ortiz',
  'Rosa Lind',
  'Theo Park',
];
function runsLabel(n: number): string {
  return n === 0
    ? 'no runs this month'
    : `${n} ${n === 1 ? 'run' : 'runs'} this month`;
}
const RUNNERS: CardPillItem[] = NAMES.slice(0, 7).map((title) => ({
  title,
  kind: 'Runner',
}));
const MEMBERS: CardPillItem[] = Array.from({ length: 42 }, (_u, i) => ({
  title:
    NAMES[i % NAMES.length]! +
    (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ''),
  kind: 'Member',
  sub: runsLabel((i * 7) % 5),
}));
// what the readers attached to their messages, as the composer showed it
const BUBBLE_POSTER: CardPillItem[] = [
  { id: 'poster', title: 'Relaunch poster', kind: 'Poster' },
];
const BUBBLE_BOROUGHS: CardPillItem[] = [
  { id: 'nyc-clubs', title: 'NYC running clubs', kind: 'Collection' },
  { id: 'kids-policy', title: 'Kids’ group policy', kind: 'Note' },
];
const RACES: CardPillItem[] = [
  { title: 'Harlem 5K', kind: 'Race' },
  { title: 'Prospect Park Fun Run', kind: 'Race' },
  { title: 'Queens Half', kind: 'Race' },
];
const BULK: ToolChangeRow[] = NAMES.slice(0, 6).map((card, i) => ({
  card,
  from: 'Member',
  to: 'Regular',
  skipped: i === 2 ? 'changed since the preview' : undefined,
}));
const GROUP: ToolPart[] = [
  {
    id: 'g1',
    name: 'read_realm_file',
    state: 'completed',
    subtitle: 'relaunch.gts',
    kind: 'read',
  },
  {
    id: 'g2',
    name: 'read_realm_file',
    state: 'completed',
    subtitle: 'runners/lena-ruiz.json',
    kind: 'read',
  },
  {
    id: 'g3',
    name: 'search_cards',
    state: 'completed',
    subtitle: 'Runner where runs ≥ 3',
    kind: 'search',
  },
  {
    id: 'g4',
    name: 'patch_fields',
    state: 'completed',
    subtitle: 'Autumn relaunch',
    kind: 'write',
  },
];
const THOUGHTS: ThinkingRow[] = [
  { id: 't1', primary: 'The plan names seven regulars', state: 'done' },
  {
    id: 't2',
    primary: 'Two races are trail races',
    state: 'done',
    secondary: 'skip',
  },
  { id: 't3', primary: 'Kids’ fees need each race page', state: 'done' },
];
const POSTERS = [
  { label: 'Night Shift', sub: 'Headlamps, city lights' },
  { label: 'Dawn Patrol', sub: 'First light, empty roads' },
  { label: 'Hill Repeats', sub: 'Up, down, again' },
];
const SWATCHES = [
  { label: 'Lime', swatch: '#c3fc33' },
  { label: 'Teal', swatch: '#00ffba' },
  { label: 'Coral', swatch: '#ff7a59' },
  { label: 'Ink', swatch: '#2b2340' },
];

const THREAD = Array.from({ length: 300 }, (_u, i) => ({
  id: `t${i}`,
  user: i % 2 === 0,
  text:
    i % 2 === 0
      ? [
          'Who are our regulars?',
          'Mark them as Regular.',
          'Find a chili recipe.',
          'Sum it up.',
        ][(i / 2) % 4]!
      : [
          'Seven runners came to three of the last four runs.',
          'Marked the seven as Regular.',
          'Budget Bytes has a one-pot chili.',
          'The relaunch is ready to send.',
        ][((i - 1) / 2) % 4]!,
  seconds: 4 + ((i * 7) % 40),
  // several people talk to the same assistant: Chris, Rupert and Mei
  self: i % 2 === 0 && (i / 2) % 3 === 0,
  author: i % 2 === 0 ? ['Chris', 'Rupert', 'Mei'][(i / 2) % 3] : undefined,
}));
const MODELS: PickerModel[] = [
  {
    id: 'terra',
    label: 'GPT-5.6 Terra',
    provider: 'OpenAI',
    cost: 2,
    note: 'default',
  },
  {
    id: 'luna',
    label: 'GPT-5.6 Luna',
    provider: 'OpenAI',
    cost: 1,
    note: 'fast',
  },
  {
    id: 'opus',
    label: 'Opus 5.5',
    provider: 'Anthropic',
    cost: 3,
    note: 'best for code',
  },
  { id: 'sonnet', label: 'Sonnet 5.5', provider: 'Anthropic', cost: 2 },
];
const MENTIONS = [
  { id: 'lena', label: 'Lena Ruiz', hint: 'Runner' },
  { id: 'omar', label: 'Omar Haddad', hint: 'Runner' },
  { id: 'plan', label: 'Autumn relaunch', hint: 'Relaunch plan' },
  { id: 'rupert', label: 'Rupert', hint: 'in this room' },
];
const COMMANDS = [
  { id: 'research', label: 'research', hint: 'Start a background run' },
  { id: 'summarize', label: 'summarize', hint: 'Sum up the thread' },
  { id: 'compact', label: 'compact', hint: 'Compact the history' },
  { id: 'model', label: 'model', hint: 'Switch the model' },
];

const SOURCES = [
  { n: 1, href: 'https://www.nyrr.org/races' },
  { n: 2, href: 'https://www.runnersworld.com/races' },
];

type Stage =
  | 'previewed'
  | 'committing'
  | 'conflict'
  | 'partial'
  | 'kept'
  | 'reverted';
const STAGES: SegmentOption[] = [
  { value: 'previewed', label: 'Preview' },
  { value: 'committing', label: 'Writing' },
  { value: 'conflict', label: 'Conflict' },
  { value: 'partial', label: 'Partial' },
  { value: 'kept', label: 'Kept' },
  { value: 'reverted', label: 'Reverted' },
];
const REGISTERS: SegmentOption[] = [
  { value: 'editorial', label: 'Editorial' },
  { value: 'machine', label: 'Machine' },
];

function remembered(key: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function remember(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // a private window or blocked storage: the choice lasts for this page
  }
}

// A tool UI declared once, as a renderer's `result`: the forecast card a
// get_weather call makes. In the host this is a CardRenderer inside the
// CardEmbed; here it is a stand-in card in the card's own light theme.
interface ForecastSignature {
  Args: { params?: unknown; result?: unknown; state: string };
}
class ForecastCard extends Component<ForecastSignature> {
  hours = [
    { at: '1 PM', t: '19°', sky: '⛅' },
    { at: '2 PM', t: '21°', sky: '☀' },
    { at: '3 PM', t: '21°', sky: '☀' },
    { at: '4 PM', t: '19°', sky: '☁' },
    { at: '5 PM', t: '17°', sky: '🌧' },
  ];
  get pending() {
    return this.args.state === 'streaming' || this.args.state === 'running';
  }
  <template>
    <CardEmbed
      @format='embedded'
      @label='Race-day forecast'
      @kind='Forecast'
      @state={{if this.pending 'pending' 'ready'}}
      @minHeight='150px'
    >
      <div class='demo-forecast'>
        <span class='demo-forecast-place'>Harlem, race day</span>
        <span class='demo-forecast-now'>18°C</span>
        <span class='demo-forecast-sub'>Partly cloudy, feels like 17°C</span>
        <div class='demo-forecast-hours'>
          {{#each this.hours as |h|}}
            <span><b>{{h.at}}</b><i
                aria-hidden='true'
              >{{h.sky}}</i>{{h.t}}</span>
          {{/each}}
        </div>
      </div>
    </CardEmbed>
    <style scoped>
      .demo-forecast {
        display: grid;
        gap: 4px;
        padding: 16px;
        background: #fff;
        color: #272330;
        font:
          13px/1.45 system-ui,
          sans-serif;
      }
      .demo-forecast-place {
        color: #6b6577;
      }
      .demo-forecast-now {
        font-size: 30px;
        font-weight: 700;
        line-height: 1.1;
      }
      .demo-forecast-sub {
        color: #6b6577;
      }
      .demo-forecast-hours {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 4px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #e3e1e8;
        text-align: center;
      }
      .demo-forecast-hours span {
        display: grid;
        gap: 2px;
        color: #6b6577;
      }
      .demo-forecast-hours b {
        font-weight: 500;
      }
      .demo-forecast-hours i {
        font-style: normal;
      }
    </style>
  </template>
}

const RENDERERS: ToolRenderers = {
  get_weather: {
    title: 'Race-day forecast',
    result: ForecastCard,
    kind: 'read',
  },
};

// The answer the study streams, and a small renderer for it. In the host,
// MarkdownStream gets the real markdown renderer and its sanitizer; this one
// knows only what the answer uses.
const ANSWER = `Kids’ races in October cost about **$12**, and most close registration a week before race day.

- **Harlem 5K**: Oct 5, kids’ mile $10
- **Prospect Park Fun Run**: Oct 12, $12
- **Queens Half**: Oct 26, $15

Trail races are left out, as Rupert asked.`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function inlineMd(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function renderAnswer(source: MarkdownSource): string {
  let src = source.src;
  if (/^\s*[-*]\s/.test(src)) {
    let items = src
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => `<li>${inlineMd(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
    return `<ul>${items.join('')}</ul>`;
  }
  return `<p>${inlineMd(src).replace(/\n/g, ' ')}</p>`;
}

// ── the study ────────────────────────────────────────────────────────────

export interface TranscriptStudySignature {
  Element: HTMLDivElement;
}

export class TranscriptStudy extends Component<TranscriptStudySignature> {
  /** each board's replay count: bumping it remounts the board, so its
   * entrances play again. Motion is Presence's, all CSS and timer-free */
  @tracked replays: Record<string, number> = {};
  replayKey = (board: string) => [this.replays[board] ?? 0];
  replay = (board: string) => {
    this.replays = { ...this.replays, [board]: (this.replays[board] ?? 0) + 1 };
    this.rowStates = Object.fromEntries(
      Object.entries(this.rowStates).filter(
        ([key]) => !key.startsWith(`${board}-`),
      ),
    );
    if (board === 'b6') {
      this.cost = 0;
      requestAnimationFrame(() => (this.cost = 18));
      this.streamAnswer();
    }
  };
  // how many of the agent's tasks are done; the next in AGENT_ORDER runs
  @tracked agentDone = 3;
  get agentTasks(): ToolPlanStep[] {
    let done = new Set(AGENT_ORDER.slice(0, this.agentDone));
    let current = AGENT_ORDER[this.agentDone];
    return AGENT_TASKS.map((label, i) => ({
      label,
      state: done.has(i) ? 'done' : i === current ? 'current' : 'next',
    }));
  }
  get agentActivity(): string {
    let current = AGENT_ORDER[this.agentDone];
    return current === undefined ? 'All tasks done' : AGENT_ACTIVITY[current]!;
  }
  // the activity line steps the plan on, then starts it over
  advanceAgent = () => {
    this.agentDone =
      this.agentDone >= AGENT_TASKS.length ? 0 : this.agentDone + 1;
  };
  @tracked cost = 18;
  // ── the streamed answer (board 6), fed a word every fourth frame (about
  // fifteen words a second, the pace a model streams at)
  renderAnswer = renderAnswer;
  @tracked streamed = ANSWER.length;
  @tracked streamingAnswer = false;
  private cancelStream: number | undefined;
  get answerText() {
    return ANSWER.slice(0, this.streamed);
  }
  streamAnswer = () => {
    if (this.cancelStream !== undefined) {
      cancelAnimationFrame(this.cancelStream);
    }
    this.streamed = 0;
    this.streamingAnswer = true;
    let frame = 0;
    let step = () => {
      frame++;
      if (frame % 4 === 0) {
        // the next word, and the space after it
        let rest = ANSWER.slice(this.streamed);
        let word = /^\s*\S+/.exec(rest);
        this.streamed += word ? word[0].length : rest.length;
      }
      if (this.streamed < ANSWER.length) {
        this.cancelStream = requestAnimationFrame(step);
      } else {
        this.streamingAnswer = false;
        this.cancelStream = undefined;
      }
    };
    this.cancelStream = requestAnimationFrame(step);
  };
  willDestroy() {
    super.willDestroy();
    if (this.cancelStream !== undefined) {
      cancelAnimationFrame(this.cancelStream);
    }
  }
  /** the rows a click moves on, by key; a board's replay resets its own */
  @tracked rowStates: Record<string, string> = {};
  st = (key: string, fallback: string) => this.rowStates[key] ?? fallback;
  is = (key: string, fallback: string, value: string) =>
    (this.rowStates[key] ?? fallback) === value;
  go = (key: string, value: string, receipt?: string) => () => {
    this.rowStates = { ...this.rowStates, [key]: value };
    if (receipt) {
      this.receipt = receipt;
    }
  };
  // the reader's theme and mode survive a reload while they review; a
  // convenience only, so storage that throws or is empty changes nothing
  @tracked themeId = remembered('pretui-study-theme') ?? 'boxel';
  @tracked mode: 'light' | 'dark' =
    remembered('pretui-study-mode') === 'light' ? 'light' : 'dark';
  themes = STUDY_THEMES.map((t) => ({ value: t.id, label: t.cardTitle }));
  modes = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  setTheme = (value: string) => {
    this.themeId = value;
    remember('pretui-study-theme', value);
  };
  setMode = (value: string) => {
    this.mode = value as 'light' | 'dark';
    remember('pretui-study-mode', value);
  };
  get theme() {
    return STUDY_THEMES.find((t) => t.id === this.themeId) ?? STUDY_THEMES[0]!;
  }
  get scope() {
    return themeScope(this.theme.id, this.theme.cssVariables);
  }
  @tracked stage: Stage = 'previewed';
  @tracked register: 'editorial' | 'machine' = 'editorial';
  @tracked receipt = '';

  planBefore = PLAN_BEFORE;
  planAfter = PLAN_AFTER;
  lenaBefore = LENA_BEFORE;
  lenaAfter = LENA_AFTER;
  researchPlan = RESEARCH_PLAN;
  bubblePoster = BUBBLE_POSTER;
  answerReactions: Reaction[] = [{ key: '👍', by: ['Chris'] }];
  bubbleBoroughs = BUBBLE_BOROUGHS;
  stoppedPlan = STOPPED_PLAN;
  sources = SOURCES;
  stages = STAGES;
  registers = REGISTERS;
  stats = ['$12 median', '5 races', 'checked Oct 20'];
  runners = RUNNERS;
  members = MEMBERS;
  races = RACES;
  lena = [RUNNERS[0]!];
  bulk = BULK;
  group = GROUP;
  thoughts = THOUGHTS;
  posterChoices = POSTERS;
  swatches = SWATCHES;
  relaunchChange = [
    {
      card: 'Autumn relaunch',
      change: 'Accent: Lime to Teal · Send day: Wednesday to Thursday',
    },
  ];
  manySources = [
    ...SOURCES,
    { n: 3, href: 'https://www.halfmarathons.net' },
    { n: 4, href: 'https://www.ahotu.com' },
    { n: 5, href: 'https://www.raceraves.com' },
  ];
  logo =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 72'><rect width='72' height='72' fill='#f7df1e'/><text x='38' y='60' font-family='Arial' font-weight='700' font-size='30'>JS</text></svg>",
    );
  cover =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 72'><rect width='72' height='72' fill='#1b1530'/><circle cx='52' cy='22' r='16' fill='#c3fc33'/><rect x='8' y='50' width='40' height='5' fill='#fff'/></svg>",
    );
  @tracked expanded = false;
  thread = THREAD;
  models = MODELS;
  mentions = MENTIONS;
  commands = COMMANDS;
  efforts = ['low', 'medium', 'high'];
  @tracked model = 'terra';
  @tracked effort = 'medium';
  setModel = (id: string) => {
    this.model = id;
    this.receipt = `Model set to ${MODELS.find((m) => m.id === id)?.label}`;
  };
  setEffort = (e: string) => (this.effort = e);
  mentioned = (item: { label: string }) =>
    (this.receipt = `Mentioned ${item.label}`);
  commanded = (item: { label: string }) =>
    (this.receipt = `Command /${item.label}`);
  @tracked queue: QueuedMessage[] = [
    { id: 'q1', text: 'Skip the trail races' },
    { id: 'q2', text: 'And add the kids’ fees to the table' },
  ];
  reorderQueue = (ids: string[]) =>
    (this.queue = ids.map((id) => this.queue.find((q) => q.id === id)!));
  editQueue = (id: string, text: string) =>
    (this.queue = this.queue.map((q) => (q.id === id ? { ...q, text } : q)));
  removeQueued = (id: string) =>
    (this.queue = this.queue.filter((q) => q.id !== id));
  sendQueuedNow = (id: string) => {
    this.removeQueued(id);
    this.receipt = 'Sent now, to steer the run at its next step';
  };
  retryUpload = (a: ComposerAttachment) => {
    this.attached = this.attached.map((x) =>
      x.id === a.id
        ? { ...x, state: 'uploading', progress: 0.3, error: undefined }
        : x,
    );
    this.receipt = `Retrying ${a.label}`;
  };
  @tracked stacked: StackedGate[] = [
    { id: 'del', title: 'Delete showcase/scratch/pick.md', kind: 'delete' },
    { id: 'dl', title: 'Download the club logo', kind: 'download' },
    { id: 'img', title: 'Generate a cover image', kind: '12 credits' },
  ];
  settleStacked = (id: string, what: string) => () => {
    this.stacked = this.stacked.filter((g) => g.id !== id);
    this.receipt = what;
  };
  stackActions = (gate: StackedGate): ToolGateAction[] =>
    gate.id === 'del'
      ? [
          {
            label: 'Delete',
            kind: 'primary',
            onAct: this.settleStacked(gate.id, 'Deleted pick.md'),
          },
          {
            label: 'Always for this session',
            always: true,
            onAct: this.settleStacked(gate.id, ''),
          },
          {
            label: 'Keep it',
            kind: 'quiet',
            declines: true,
            onAct: () => undefined,
          },
        ]
      : [
          {
            label: 'Allow once',
            kind: 'primary',
            onAct: this.settleStacked(gate.id, `Allowed: ${gate.title}`),
          },
          {
            label: 'Always for this session',
            always: true,
            onAct: this.settleStacked(gate.id, `Always: ${gate.title}`),
          },
          {
            label: 'Deny',
            kind: 'quiet',
            declines: true,
            onAct: () => undefined,
          },
        ];
  declineStacked = (id: string) => (reason: string) => {
    this.stacked = this.stacked.filter((g) => g.id !== id);
    this.receipt = reason ? `Declined: ${reason}` : 'Declined';
  };
  isDelete = (gate: StackedGate) => gate.id === 'del';
  scopeOf = (gate: StackedGate) =>
    gate.id === 'dl'
      ? 'realm.fs.download from github.com for this session'
      : 'images.generate for this session';
  @tracked attached: ComposerAttachment[] = [
    {
      id: 'focus',
      label: 'Autumn relaunch',
      auto: true,
      type: 'Relaunch plan',
    },
    { id: 'lena', label: 'Lena Ruiz', kind: 'card', type: 'Runner' },
    { id: 'notes', label: 'race-notes.md', kind: 'file', type: 'MD' },
    {
      id: 'poster',
      label: 'night-shift.png',
      kind: 'image',
      type: 'PNG',
      image: this.cover,
    },
    { id: 'skill', label: 'Showcase director', kind: 'skill' },
    {
      id: 'upload',
      label: 'route-map.pdf',
      kind: 'file',
      type: 'PDF',
      state: 'uploading',
      progress: 0.62,
    },
    {
      id: 'failed',
      label: 'club-photos.zip',
      kind: 'file',
      type: 'ZIP',
      state: 'failed',
      error: 'Too large: 120 MB, the limit is 50 MB',
    },
  ];
  pinFocus = (attachment: ComposerAttachment) => {
    this.attached = this.attached.map((a) =>
      a.id === attachment.id ? { ...a, auto: false } : a,
    );
    this.receipt = `Pinned ${attachment.label}`;
  };
  removeAttachment = (attachment: ComposerAttachment) => {
    this.attached = this.attached.filter((a) => a.id !== attachment.id);
    this.receipt = `Removed ${attachment.label}`;
  };
  toggleExpanded = () => (this.expanded = !this.expanded);
  // ── review and diff (board 17)
  reviewFiles: ReviewFile[] = [
    { path: 'showcase/relaunch.gts', before: PLAN_BEFORE, after: PLAN_AFTER },
    { path: 'runners/lena-ruiz.json', before: LENA_BEFORE, after: LENA_AFTER },
    {
      path: 'showcase/notes.md',
      after: '# Relaunch notes\nSend on Wednesday evening.\nSeven regulars.\n',
    },
  ];
  @tracked fileStates: Record<string, 'kept' | 'reverted'> = {};
  @tracked hunkStates: Record<string, Record<number, DiffHunkState>> = {};
  private setHunk =
    (state: DiffHunkState) => (path: string, hunk: DiffHunk) => {
      this.hunkStates = {
        ...this.hunkStates,
        [path]: { ...this.hunkStates[path], [hunk.index]: state },
      };
      this.receipt = `${state === 'kept' ? 'Kept' : 'Reverted'} change ${hunk.index + 1} in ${path}`;
    };
  keepHunk = this.setHunk('kept');
  revertHunk = this.setHunk('reverted');
  private setFile = (state: 'kept' | 'reverted') => (path: string) => {
    this.fileStates = { ...this.fileStates, [path]: state };
    this.receipt = `${state === 'kept' ? 'Kept' : 'Reverted'} ${path}`;
  };
  keepFile = this.setFile('kept');
  revertFile = this.setFile('reverted');
  keepAllFiles = () => {
    this.fileStates = Object.fromEntries(
      this.reviewFiles.map((f) => [f.path, 'kept'] as const),
    );
    this.receipt = 'Kept every change';
  };
  revertAllFiles = () => {
    this.fileStates = Object.fromEntries(
      this.reviewFiles.map((f) => [f.path, 'reverted'] as const),
    );
    this.receipt = 'Reverted every change';
  };
  @tracked patchState: PatchState = 'proposed';
  applyPatch = () => {
    this.patchState = 'applied';
    this.receipt = 'Applied the patch';
  };
  revertPatch = () => {
    this.patchState = 'reverted';
    this.receipt = 'Reverted the patch';
  };
  @tracked branch = 1;
  setBranch = (i: number) => (this.branch = i);
  get branchText() {
    return [
      'Use a 3px lime border on the poster.',
      'Use a 2px border in the plan’s accent, so it follows the theme.',
      'Skip the border; lift the poster with a soft shadow instead.',
    ][this.branch];
  }
  @tracked bulkPicked: string[] = NAMES.slice(0, 6).filter((_n, i) => i !== 2);
  pickBulk = (cards: string[]) => (this.bulkPicked = cards);
  get bulkActions(): ToolGateAction[] {
    let n = this.bulkPicked.length;
    return [
      {
        label: `Keep ${n}`,
        kind: 'primary',
        onAct: this.note(`Kept ${n} changes`),
      },
      {
        label: 'Revert',
        kind: 'quiet',
        onAct: this.note('Reverted the bulk edit'),
      },
    ];
  }
  // ── inline UI (board 18)
  renderers = RENDERERS;
  @tracked weatherState = 'completed';
  // the study keeps no clock: the reader steps the call themselves
  get weatherPending() {
    return this.weatherState === 'running';
  }
  replayWeather = () =>
    (this.weatherState = this.weatherPending ? 'completed' : 'running');
  chooseLot = async (intent: CardIntent) => {
    this.receipt = `${intent.kind === 'choose' ? 'Chose' : 'Explored'} ${intent.label}`;
  };
  // ── the MCP App iframe (board 19)
  mcpStates = [
    { value: 'ready', label: 'Ready' },
    { value: 'pending', label: 'Writing' },
    { value: 'loading', label: 'Booting' },
    { value: 'auth-required', label: 'Access' },
    { value: 'error', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];
  hostModes = [
    { value: 'light', label: 'Host light' },
    { value: 'dark', label: 'Host dark' },
  ];
  channelModes = [
    { value: 'send', label: 'Host sends' },
    { value: 'draft', label: 'Host drafts' },
    { value: 'none', label: 'No messages' },
  ];
  @tracked mcpState: CardEmbedState = 'ready';
  @tracked hostTheme: 'light' | 'dark' = 'dark';
  @tracked mcpDisplay = 'inline';
  @tracked reportedHeight = 0;
  @tracked channelMode = 'send';
  @tracked saveState: SaveState = 'dirty';
  setMcpState = (v: string) => (this.mcpState = v as CardEmbedState);
  setHostTheme = (v: string) => (this.hostTheme = v as 'light' | 'dark');
  setChannelMode = (v: string) => (this.channelMode = v);
  get mcpBridge(): AppHostBridge {
    let dark = this.hostTheme === 'dark';
    return {
      reportSize: ({ height }) => (this.reportedHeight = height),
      hostContext: {
        theme: this.hostTheme,
        displayMode: this.mcpDisplay,
        availableDisplayModes: ['inline', 'fullscreen', 'pip'],
        containerDimensions: { maxHeight: 520 },
        styles: {
          variables: dark
            ? {
                '--color-background-primary': '#262624',
                '--color-background-secondary': '#30302e',
                '--color-background-tertiary': '#3a3a37',
                '--color-text-primary': '#f5f4ef',
                '--color-text-secondary': '#b7b5a9',
                '--color-border-primary': '#3d3d3a',
                '--color-ring-primary': '#d97757',
                '--color-text-info': '#e8a083',
                '--font-sans': 'ui-sans-serif, system-ui, sans-serif',
              }
            : {
                '--color-background-primary': '#ffffff',
                '--color-background-secondary': '#f5f4ef',
                '--color-background-tertiary': '#ecebe4',
                '--color-text-primary': '#1f1e1d',
                '--color-text-secondary': '#6b6a64',
                '--color-border-primary': '#e5e3da',
                '--color-ring-primary': '#c96442',
                '--color-text-info': '#b4532f',
                '--font-sans': 'ui-sans-serif, system-ui, sans-serif',
              },
        },
      },
      openLink: (url) => (this.receipt = `Asked the host to open ${url}`),
      requestDisplayMode: (mode) => (this.mcpDisplay = mode),
    };
  }
  requestMcpMode = (mode: string) => {
    this.mcpDisplay = mode === 'pip' ? 'inline' : mode;
    return this.mcpDisplay;
  };
  get mcpChannels(): IntentChannels {
    let mode = this.channelMode;
    return {
      updateContext: async () => undefined,
      sendMessage:
        mode === 'none'
          ? undefined
          : async () => (mode === 'draft' ? 'drafted' : 'sent'),
    };
  }
  deliverMcp = (intent: CardIntent) => deliverIntent(intent, this.mcpChannels);
  // what a Boxel kernel card does on a tap: a bubbling boxel-intent event
  boxelTap = (lot: string, event: Event) => {
    event.target?.dispatchEvent(
      new CustomEvent('boxel-intent', {
        bubbles: true,
        detail: {
          kind: 'choose',
          cardId: `lots/${lot.toLowerCase()}`,
          title: lot,
        },
      }),
    );
  };
  saveCard = () => {
    this.saveState = 'saving';
    requestAnimationFrame(() =>
      requestAnimationFrame(() => (this.saveState = 'saved')),
    );
  };
  isMcpCancelled = () => this.mcpState === 'cancelled';
  get isAuth() {
    return this.mcpState === 'auth-required';
  }
  @tracked openCardId: string | undefined;
  @tracked expandedMember: string | undefined;
  expandMember = (card: CardPillItem) => {
    this.expandedMember = card.id ?? card.title;
    this.receipt = `Showing ${card.title} here`;
  };
  collapseMember = () => (this.expandedMember = undefined);
  @tracked pickedRunners: string[] = [];
  openCard = (card: CardPillItem) => {
    this.openCardId = card.id ?? card.title;
    this.receipt = `Opened ${card.title} on the rightmost stack`;
  };
  closeCard = (card: CardPillItem) => {
    this.openCardId = undefined;
    this.receipt = `Closed ${card.title}`;
  };
  pickRunners = (ids: string[]) => (this.pickedRunners = ids);
  messageRunners = (cards: CardPillItem[]) =>
    (this.receipt = `Attached ${cards.map((c) => c.title).join(', ')} to the message`);
  get fullReindexActions(): ToolGateAction[] {
    return [
      {
        label: 'Reindex everything',
        kind: 'primary',
        onAct: this.go('b11-full', 'running', 'Full reindex started'),
      },
      {
        label: 'Cancel',
        kind: 'quiet',
        onAct: this.go('b11-full', 'canceled', 'Canceled the reindex'),
      },
    ];
  }
  diff = { files: 1, added: 1, removed: 0 };
  posters = ['Night Shift', 'Dawn Patrol', 'Hill Repeats'];

  note = (what: string) => () => (this.receipt = what);
  setStage = (value: string) => (this.stage = value as Stage);
  setRegister = (value: string) =>
    (this.register = value as 'editorial' | 'machine');
  save = async () => '2026-10-20-race-bibs.md';

  get clickActions(): ToolGateAction[] {
    return [
      {
        label: 'Allow once',
        kind: 'primary',
        onAct: this.go('b2-gate', 'completed', 'Allowed once'),
      },
      {
        label: 'Always for this session',
        onAct: this.go('b2-gate', 'completed', 'Allowed for the session'),
      },
      {
        label: 'Deny',
        kind: 'quiet',
        onAct: this.go('b2-gate', 'canceled', 'Denied'),
      },
    ];
  }
  // board 02c: a plain script held for the reader's click, nothing risky
  // in it to name
  get runActions(): ToolGateAction[] {
    return [
      { label: 'Run', kind: 'primary', onAct: this.note('Ran the script') },
      {
        label: 'Decline',
        kind: 'quiet',
        onAct: this.note('Declined the script'),
      },
    ];
  }
  get previewActions(): ToolGateAction[] {
    return [
      {
        label: 'Keep 40',
        kind: 'primary',
        onAct: () => this.setStage('committing'),
      },
      { label: 'Always for edits', onAct: () => this.setStage('committing') },
      {
        label: 'Revert',
        kind: 'quiet',
        onAct: () => this.setStage('reverted'),
      },
    ];
  }
  get conflictActions(): ToolGateAction[] {
    return [
      {
        label: 'Re-preview',
        kind: 'primary',
        onAct: () => this.setStage('previewed'),
      },
      { label: 'Keep the other 37', onAct: () => this.setStage('partial') },
      {
        label: 'Revert',
        kind: 'quiet',
        onAct: () => this.setStage('reverted'),
      },
    ];
  }

  get previewState(): string {
    return {
      previewed: 'previewed',
      committing: 'committing',
      conflict: 'conflict',
      partial: 'partial',
      kept: 'kept',
      reverted: 'reverted',
    }[this.stage];
  }
  get previewTitle(): string {
    return {
      previewed: 'Mark everyone at 3 of 4 runs as Regular',
      committing: 'Marking everyone at 3 of 4 runs as Regular',
      conflict: 'Mark everyone at 3 of 4 runs as Regular',
      partial: 'Marked 37 runners as Regular',
      kept: 'Marked 40 runners as Regular',
      reverted: 'Mark everyone at 3 of 4 runs as Regular',
    }[this.stage];
  }
  get previewReceipt(): string {
    return {
      previewed: 'preview a1f3… · sealed · 40 files staged',
      committing: 'preview a1f3… · writing',
      conflict: 'preview a1f3… · 3 files moved since',
      partial: '37 of 40 kept',
      kept: '40 kept',
      reverted: 'reverted · nothing was written',
    }[this.stage];
  }
  get isStage() {
    return (stage: Stage) => this.stage === stage;
  }
  get writing() {
    return { step: 28, of: 40, label: 'Writing', fraction: 0 };
  }
  get isMachine() {
    return this.register === 'machine';
  }

  <template>
    {{! the theme is applied the way a card's is: data-theme stamps the
        scheme, and boxel-ui's scope helpers re-declare the theme's light
        and dark variables under a content-hashed scope inside it }}
    <div
      class='study-frame'
      data-theme={{this.mode}}
      data-test-pretui-transcript-study-frame
    >
      <div
        class='study'
        data-boxel-theme-scope={{this.scope}}
        data-test-pretui-transcript-study
        ...attributes
      >
        {{! template-lint-disable require-scoped-style }}
        <style data-boxel-theme-style>
          {{themeScopedCss this.scope this.theme.cssVariables}}
        </style>
        {{! template-lint-enable require-scoped-style }}
        <header class='study-head'>
          <span class='study-eyebrow'>Composition study · Assistant transcript</span>
          <h1 class='study-title'>Every interaction on the canvas, from Pret UI
            parts</h1>
          <p class='study-lede'>Each board is a panel at a real width. The parts
            are ready for the assistant to wire; nothing here is the host’s.</p>
          <div class='study-controls'>
            <SegmentedControl
              @options={{this.themes}}
              @value={{this.themeId}}
              @onValueChange={{this.setTheme}}
              @label='Theme'
              data-test-study-theme
            />
            <SegmentedControl
              @options={{this.modes}}
              @value={{this.mode}}
              @onValueChange={{this.setMode}}
              @label='Light or dark'
              data-test-study-mode
            />
          </div>
          {{#if this.receipt}}<p class='study-receipt' role='status'>Last click:
              {{this.receipt}}</p>{{/if}}
        </header>

        <div class='study-grid'>

          {{! ── 1. calls and their states ───────────────────────────── }}
          <section class='board' aria-labelledby='b1'>
            <div class='board-head'><h2 class='board-title' id='b1'><span
                >01</span>
                Calls and their states</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 1'
                data-test-study-replay='b1'
                {{on 'click' (fn this.replay 'b1')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b1') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.06}}
                  ><ToolRow
                      @name='research'
                      @verb='Research'
                      @title='Finding kids’ race fees'
                      @state={{this.st 'b1-run' 'running'}}
                      @density='run'
                      @framed={{true}}
                      @progress={{hash step=2 of=4 label='Read each race page'}}
                      @receipt={{if
                        (this.is 'b1-run' 'running' 'stopped')
                        'run 7c2e… · stopped · 1 step kept'
                        'run 7c2e… · started 1m ago'
                      }}
                    >
                      <:rows><ToolPlan @steps={{this.researchPlan}} /></:rows>
                      <:receipt>
                        {{#if (this.is 'b1-run' 'running' 'stopped')}}
                          <ToolReceiptAction
                            @label='Resume'
                            @onAct={{this.go
                              'b1-run'
                              'resumed'
                              'Resumed the run'
                            }}
                          />
                        {{else}}
                          <ToolReceiptAction
                            @label='Stop'
                            @onAct={{this.go
                              'b1-run'
                              'stopped'
                              'Stopped the run'
                            }}
                          />
                        {{/if}}
                      </:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.09}}
                  ><TaskChecklist
                      @steps={{this.agentTasks}}
                      @activity={{this.agentActivity}}
                      @onActivity={{this.advanceAgent}}
                      data-test-study-task-checklist
                    /></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.12}}
                  ><ToolRow
                      @name='web-search'
                      @verb='Search'
                      @title={{if
                        (this.is 'b1-search' 'retrying' 'completed')
                        'Searched race calendars'
                        'Searching race calendars'
                      }}
                      @state={{this.st 'b1-search' 'retrying'}}
                      @duration={{if
                        (this.is 'b1-search' 'retrying' 'completed')
                        3.1
                      }}
                      @framed={{true}}
                    >
                      <:rows>
                        <ToolLine @tone='done' @glyph='done'>nyrr.org · 12 races</ToolLine>
                        {{#if (this.is 'b1-search' 'retrying' 'completed')}}
                          <ToolLine @tone='done' @glyph='done'>runnersworld.com
                            · 8 races</ToolLine>
                        {{else}}
                          <ToolRetry
                            @reason='Rate limited by the search service'
                            @seconds={{8}}
                            @attempt='2 of 3'
                            @onRetry={{this.go
                              'b1-search'
                              'completed'
                              'Retried now'
                            }}
                          />
                        {{/if}}
                      </:rows>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.18}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Script'
                      @title='Found running clubs in each borough'
                      @state='stopped'
                      @status='stopped · kept 4 of 6'
                      @framed={{true}}
                      @receipt='run 41ab… · 4 searches kept'
                    >
                      <:rows><ToolPlan @steps={{this.stoppedPlan}} /></:rows>
                      <:receipt><ToolReceiptAction
                          @label='Resume'
                          @onAct={{this.note 'Resumed'}}
                        /></:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.24}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Script'
                      @title='Read every race page'
                      @state='budget'
                      @framed={{true}}
                      @receipt='spent 40 of 40 reads · 31 pages kept'
                    >
                      <:rows>
                        <ToolLine @tone='muted' @glyph='note'>Stopped at its
                          read budget; what it read is kept</ToolLine>
                      </:rows>
                      <:receipt><ToolReceiptAction
                          @label='Continue'
                          @onAct={{this.note 'Continued'}}
                        /></:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.3}}
                  ><ToolRow
                      @name='research'
                      @verb='Research'
                      @title='Looking up race-day bibs'
                      @state='reconnecting'
                      @framed={{true}}
                    >
                      <:rows><ToolLine @tone='muted' @glyph='note'>Run state
                          fetched · the page that ran it was reloaded</ToolLine></:rows>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.36}}
                  ><ToolRow
                      @name='research'
                      @verb='Research'
                      @title='Looked up race-day bibs'
                      @state='delivered'
                      @framed={{true}}
                    >
                      <:rows><ToolLine @tone='done' @glyph='done'>Finished ·
                          result posted here</ToolLine></:rows>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.42}}
                  ><ToolRow
                      @name='read'
                      @verb='Read'
                      @title='relaunch-plan.gts'
                      @state='superseded'
                    /></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.48}}
                  ><ToolRow
                      @name='read'
                      @verb='Read'
                      @title='showcase/relaunch.gts'
                      @state='completed'
                      @duration={{0.4}}
                    /></Presence>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 2. gates ─────────────────────────────────────────────── }}
          <section class='board' aria-labelledby='b2'>
            <div class='board-head'><h2 class='board-title' id='b2'><span
                >02</span>
                Asked in the row</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 2'
                data-test-study-replay='b2'
                {{on 'click' (fn this.replay 'b2')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b2') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.06}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Script'
                      @title={{if
                        (this.is 'b2-gate' 'ready' 'ready')
                        'Save a logo, drop the pick note'
                        'Saved a logo, dropped the pick note'
                      }}
                      @state={{this.st 'b2-gate' 'ready'}}
                      @framed={{true}}
                      @receipt={{if
                        (this.is 'b2-gate' 'ready' 'completed')
                        '1 file written · 1 deleted'
                      }}
                    >
                      <:rows>
                        <ToolLine
                          @tone='attention'
                          @glyph='warning'
                          @mono={{true}}
                          @sub='Deletes a file. This cannot be undone.'
                        >realm.fs.delete</ToolLine>
                        <ToolLine
                          @tone='attention'
                          @glyph='warning'
                          @mono={{true}}
                          @sub='Downloads a file from an outside URL into the workspace.'
                        >realm.fs.download</ToolLine>
                      </:rows>
                      <:gate>{{#if
                          (this.is 'b2-gate' 'ready' 'ready')
                        }}<ToolGate
                            @prompt='This waits for your click.'
                            @actions={{this.clickActions}}
                          />{{/if}}</:gate>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.12}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Script'
                      @title='Copying the plan for a poster'
                      @state='ask'
                      @framed={{true}}
                    >
                      <:rows><ToolLine @tone='live' @glyph='current'>Asking
                          which poster</ToolLine></:rows>
                      <:gate>
                        <AgentQuestion
                          @question='Which poster should the scratch copy use?'
                          @options={{this.posters}}
                          @onAnswer={{this.note 'Picked a poster'}}
                        />
                      </:gate>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.18}}
                  ><ToolRow
                      @name='ask-user'
                      @verb='Ask'
                      @title='Chose the poster'
                      @choice='Night Shift'
                      @state='completed'
                      @status='you chose'
                    /></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.24}}
                  ><ToolRow
                      @name='transfer-realm'
                      @verb='Action'
                      @title='Move the club roster to Rupert’s workspace'
                      @state='routed'
                      @status='waiting on Rupert'
                      @framed={{true}}
                    >
                      <:gate><ToolGate
                          @prompt='Approve the move?'
                          @detail='It writes to a workspace only Rupert can change.'
                          @waitingOn='Rupert'
                        /></:gate>
                    </ToolRow></Presence>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 2b. a script's question, answered ────────────────────── }}
          <section class='board' aria-labelledby='b2b'>
            <div class='board-head'><h2 class='board-title' id='b2b'><span
                >02b</span>
                A script's question, answered</h2></div>
            <div class='panel' data-w='440px'>
              {{! asked: the script waits in its own row, the question in its gate }}
              <ToolRow
                @name='run-realm-code'
                @verb='Script'
                @title='Setting the relaunch accent'
                @state='ask'
                @framed={{true}}
              >
                <:rows><ToolLine @tone='live' @glyph='current'>Asking which
                    accent</ToolLine></:rows>
                <:gate>
                  <AgentQuestion
                    @question='Which accent should the relaunch plan use?'
                    @choices={{this.swatches}}
                    @layout='swatches'
                    @confirm={{true}}
                    @onAnswer={{this.note 'Picked an accent'}}
                  />
                </:gate>
              </ToolRow>
              {{! answered: the pick is the row's own history, in its header
                where a folded row still shows it; open, the question stays
                checked with its answer, and the run's particulars come last }}
              <ToolRow
                @name='run-realm-code'
                @verb='Script'
                @title='Set the relaunch accent'
                @choice='Teal'
                @state='completed'
                @duration={{8}}
                @framed={{true}}
              >
                <:rows>
                  <ToolLine @tone='done' @glyph='done'>Which accent should the
                    relaunch plan use?
                    <b>Teal</b></ToolLine>
                  <ToolLine
                    @tone='done'
                    @glyph='done'
                    @mono={{true}}
                  >showcase/RelaunchPlan/autumn.json</ToolLine>
                  <ToolMeta
                    @items={{array 'run-realm-code' 'ctse/riverside' '8s'}}
                    @reveal='always'
                  />
                </:rows>
              </ToolRow>
              {{! folded into history: one line, the pick still on it }}
              <ToolRow
                @name='run-realm-code'
                @verb='Script'
                @title='Set the relaunch accent'
                @choice='Teal'
                @state='completed'
                @duration={{8}}
              />
            </div>
          </section>

          {{! ── 2c. a plain script held for a click ──────────────────── }}
          <section class='board' aria-labelledby='b2c'>
            <div class='board-head'><h2 class='board-title' id='b2c'><span
                >02c</span>
                A script held for your click</h2></div>
            <div class='panel' data-w='440px'>
              {{! held: nothing risky to name, so the gate says what running it
                does; the row needs the reader, so its title reads in full }}
              <ToolRow
                @name='run-realm-code'
                @verb='Script'
                @title='Set the Autumn relaunch plan’s accent to Teal and its send day to Thursday, then open the plan'
                @state='ready'
                @framed={{true}}
              >
                <:gate><ToolGate
                    @prompt='Run this script?'
                    @detail='It writes to ctse/riverside. Nothing runs until you click.'
                    @actions={{this.runActions}}
                  /></:gate>
              </ToolRow>
              {{! approved: the decision stays on the row, where the duration
                would go; folded, it still says who let it run }}
              <ToolRow
                @name='run-realm-code'
                @verb='Edit'
                @title='Set the Autumn relaunch plan’s accent to Teal and its send day to Thursday'
                @state='completed'
                @status='you ran it'
                @framed={{true}}
                @receipt='1 file written'
              >
                <:rows><ToolChangeTable
                    @rows={{this.relaunchChange}}
                    @changeLabel='Change'
                  /></:rows>
                <:receipt><ToolReceiptAction
                    @label='Undo'
                    @onAct={{this.note 'Undid the change'}}
                  /></:receipt>
              </ToolRow>
              {{! declined: struck through, the decision in its place }}
              <ToolRow
                @name='run-realm-code'
                @verb='Script'
                @title='Set the Autumn relaunch plan’s accent to Teal and its send day to Thursday'
                @state='canceled'
                @status='you declined'
              />
            </div>
          </section>

          {{! ── 3. the preview receipt ───────────────────────────────── }}
          <section class='board' aria-labelledby='b3'>
            <div class='board-head'><h2 class='board-title' id='b3'><span
                >03</span>
                A write, previewed then kept</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 3'
                data-test-study-replay='b3'
                {{on 'click' (fn this.replay 'b3')}}
              >↻ Replay</button></div>
            <SegmentedControl
              class='board-switch'
              @options={{this.stages}}
              @value={{this.stage}}
              @onValueChange={{this.setStage}}
              @label='Preview stage'
            />
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b3') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.06}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Edit'
                      @title={{this.previewTitle}}
                      @state={{this.previewState}}
                      @density='action'
                      @framed={{true}}
                      @progress={{if (this.isStage 'committing') this.writing}}
                      @receipt={{this.previewReceipt}}
                    >
                      <:rows>
                        {{#if (this.isStage 'conflict')}}
                          <ToolLine
                            @tone='attention'
                            @glyph='warning'
                            @mono={{true}}
                            @sub='edited by you at 2:11 PM'
                          >runners/lena-ruiz.json</ToolLine>
                          <ToolLine
                            @tone='attention'
                            @glyph='warning'
                            @mono={{true}}
                            @sub='edited by Rupert'
                          >runners/omar-haddad.json</ToolLine>
                          <ToolLine
                            @tone='attention'
                            @glyph='warning'
                            @mono={{true}}
                            @sub='deleted'
                          >runners/kai-moreno.json</ToolLine>
                        {{else if (this.isStage 'reverted')}}
                          <ToolLine @tone='muted' @glyph='note'>Discarded the
                            preview; no file was written</ToolLine>
                        {{else}}
                          <ToolChange
                            @label='Tier'
                            @from='Member'
                            @to='Regular'
                            @count='×40'
                          />
                          {{#unless (this.isStage 'committing')}}
                            <ToolDiff
                              @path='runners/lena-ruiz.json'
                              @before={{this.lenaBefore}}
                              @after={{this.lenaAfter}}
                            />
                          {{/unless}}
                          {{#if (this.isStage 'partial')}}
                            <ToolLine
                              @tone='muted'
                              @glyph='note'
                              @sub='changed since the preview; left as they are'
                            >3 files not written</ToolLine>
                          {{/if}}
                        {{/if}}
                      </:rows>
                      <:gate>
                        {{#if (this.isStage 'previewed')}}
                          <ToolGate
                            @prompt='40 changes are staged. Nothing is written until you keep them.'
                            @actions={{this.previewActions}}
                          />
                        {{else if (this.isStage 'conflict')}}
                          <ToolGate
                            @tone='conflict'
                            @prompt='3 files changed since the preview.'
                            @detail='Re-preview builds the change again on what they hold now.'
                            @actions={{this.conflictActions}}
                          />
                        {{/if}}
                      </:gate>
                      <:receipt>
                        {{#if (this.isStage 'kept')}}
                          <ToolReceiptAction
                            @label='Undo 40'
                            @onAct={{this.note 'Undid 40'}}
                          />
                        {{else if (this.isStage 'partial')}}
                          <ToolReceiptAction
                            @label='Undo 37'
                            @onAct={{this.note 'Undid 37'}}
                          />
                        {{/if}}
                      </:receipt>
                    </ToolRow></Presence>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 4. what a write says ─────────────────────────────────── }}
          <section class='board' aria-labelledby='b4'>
            <div class='board-head'><h2 class='board-title' id='b4'><span
                >04</span>
                What a write says</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 4'
                data-test-study-replay='b4'
                {{on 'click' (fn this.replay 'b4')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b4') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.06}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Edit'
                      @title='Opened the relaunch source and added a border to its poster'
                      @state={{this.st 'b4-edit' 'completed'}}
                      @duration={{10}}
                      @framed={{true}}
                      @receipt='1 file written'
                    >
                      <:rows>
                        <ToolDiff
                          @path='showcase/relaunch.gts'
                          @before={{this.planBefore}}
                          @after={{this.planAfter}}
                        />
                        <ToolMeta
                          @items={{array
                            'run-realm-code'
                            'ctse'
                            '10s'
                            '6 credits'
                          }}
                        />
                      </:rows>
                      <:receipt>{{#if
                          (this.is 'b4-edit' 'completed' 'completed')
                        }}<ToolReceiptAction
                            @label='Undo'
                            @onAct={{this.go
                              'b4-edit'
                              'reverted'
                              'Undid the border'
                            }}
                          />{{/if}}</:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.12}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Edit'
                      @title='Saved a logo, dropped the pick note'
                      @state='completed'
                      @framed={{true}}
                      @receipt='run OtwR… · 1 file written · 1 deleted'
                    >
                      <:rows>
                        <ToolLine
                          @tone='done'
                          @glyph='done'
                          @mono={{true}}
                        >showcase/scratch/logo.png</ToolLine>
                        <ToolLine
                          @tone='muted'
                          @glyph='skipped'
                          @mono={{true}}
                          @sub='deleted'
                        ><s>showcase/scratch/pick.md</s></ToolLine>
                        <ToolLine @tone='done' @glyph='done'>Copied relaunch.gts
                          → scratch/relaunch-copy.gts</ToolLine>
                        <ToolLine @glyph='note'>Read 4 files · 13 KB</ToolLine>
                      </:rows>
                      <:receipt><ToolReceiptAction
                          @label='Undo'
                          @onAct={{this.note 'Undid the logo'}}
                        /></:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.18}}
                  ><ToolRow
                      @name='set-plan-fields'
                      @verb='Set'
                      @title='Approved 5 changes to Autumn relaunch'
                      @state='completed'
                      @framed={{true}}
                      @receipt='5 fields changed'
                    >
                      <:rows>
                        <ToolChange
                          @label='Poster'
                          @from='Dawn Patrol'
                          @to='Night Shift'
                        />
                        <ToolChange @label='Accent' @from='Teal' @to='Lime' />
                        <ToolChange @label='Send on' @to='Wednesday evening' />
                      </:rows>
                      <:receipt><ToolReceiptAction
                          @label='Undo'
                          @onAct={{this.note 'Undid 5 fields'}}
                        /></:receipt>
                    </ToolRow></Presence>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 5. the thread ────────────────────────────────────────── }}
          <section class='board' aria-labelledby='b5'>
            <div class='board-head'><h2 class='board-title' id='b5'><span
                >05</span>
                A room with people in it</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 5'
                data-test-study-replay='b5'
                {{on 'click' (fn this.replay 'b5')}}
              >↻ Replay</button></div>
            <div class='panel' data-thread data-w='440px'>
              {{#each
                (this.replayKey 'b5') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  {{! three gaps only: 4px within a group, 8px from a speaker to
                their words, 24px between turns }}
                  <div class='thread-group' data-gap='tight'>
                    <CollapsedTurn
                      @summary='Ran 2 scripts, checked 1 file · 30s'
                      @variant='row'
                      @expanded={{false}}
                    />
                    <SystemLine
                      @text='Model set to GPT-5.6 Terra'
                      @glyph='retry'
                      @by='the assistant'
                    />
                    <SystemLine @text='Rupert joined the room' @glyph='add' />
                  </div>
                  <UserBubble
                    @author='Rupert'
                    @time='2:03 PM'
                    @text='Can we skip the trail races? Kids hate the mud.'
                  />
                  <div class='thread-group' data-gap='speaker'>
                    <SpeakerLabel
                      @name='Assistant'
                      @agent={{true}}
                      @via='Chris'
                      @time='2:04 PM'
                    />
                    <div class='thread-group' data-gap='tight'>
                      <Presence
                        class='row-presence'
                        @enter='rise'
                        @distance={{8}}
                        @delay={{0.06}}
                      ><ToolRow
                          @name='research'
                          @verb='Research'
                          @title='Finding kids’ race fees'
                          @state='running'
                          @framed={{true}}
                          @progress={{hash
                            step=2
                            of=4
                            label='Read each race page'
                          }}
                        /></Presence>
                      {{#unless (this.is 'b5-note' 'queued' 'taken')}}
                        <QueuedNote
                          @text='Skip the trail races'
                          @arrivesAt='step 3'
                          @onCancel={{this.go
                            'b5-note'
                            'taken'
                            'Took the note back'
                          }}
                        />
                      {{/unless}}
                      <QueuedNote
                        @text='Only races in October'
                        @arrivesAt='step 2'
                        @state='delivered'
                      />
                    </div>
                  </div>
                  <div class='thread-foot'>
                    <div class='jump-float'><JumpChip
                        @visible={{true}}
                        @count={{3}}
                      /></div>
                    <Composer
                      @busy={{true}}
                      @steering={{true}}
                      @defaultMode='act'
                    />
                  </div>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 6. the answer ────────────────────────────────────────── }}
          <section class='board' aria-labelledby='b6'>
            <div class='board-head'><h2 class='board-title' id='b6'><span
                >06</span>
                The answer</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 6'
                data-test-study-replay='b6'
                {{on 'click' (fn this.replay 'b6')}}
              >↻ Replay</button></div>
            <div class='panel prose' data-w='440px'>
              {{#each
                (this.replayKey 'b6') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <MarkdownStream
                    @text={{this.answerText}}
                    @streaming={{this.streamingAnswer}}
                    @render={{this.renderAnswer}}
                    @announceComplete='Answer complete'
                  />
                  <p class='prose-refs'>From
                    <SourceRef @n={{1}} @href='https://www.nyrr.org/races' />
                    and
                    <SourceRef
                      @n={{2}}
                      @href='https://www.runnersworld.com/races'
                    />.</p>
                  <button
                    type='button'
                    class='board-expand'
                    data-test-study-stream
                    {{on 'click' this.streamAnswer}}
                  >{{if
                      this.streamingAnswer
                      'Streaming…'
                      'Stream the answer again'
                    }}</button>
                  <StatChips @items={{this.stats}} />
                  <table class='answer-table'>
                    <thead><tr><th>Race</th><th>Date</th><th
                        >Kids</th></tr></thead>
                    <tbody>
                      <tr><td>Harlem 5K</td><td>Oct 5</td><td>$10</td></tr>
                      <tr><td>Prospect Park Fun Run</td><td>Oct 12</td><td
                        >$12</td></tr>
                      <tr><td>Queens Half</td><td>Oct 26</td><td>$15</td></tr>
                    </tbody>
                  </table>
                  <SourcesStrip @sources={{this.sources}} />
                  <MethodNote
                    @text='Read each race’s own page; the fee is the 1-mile kids’ race before late registration, trail races left out as you asked.'
                  />
                  <AnswerFooter
                    @text='Kids’ races in October cost about $12.'
                    @onSave={{this.save}}
                    @diff={{this.diff}}
                    @onReview={{this.note 'Review opened'}}
                    @onRetry={{this.note 'Asked again'}}
                  />
                  <p class='answer-cost'><Odometer @value={{this.cost}} />
                    credits</p>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 7. registers ─────────────────────────────────────────── }}
          <section class='board' aria-labelledby='b7'>
            <div class='board-head'><h2 class='board-title' id='b7'><span
                >07</span>
                Two registers, one row</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 7'
                data-test-study-replay='b7'
                {{on 'click' (fn this.replay 'b7')}}
              >↻ Replay</button></div>
            <SegmentedControl
              class='board-switch'
              @options={{this.registers}}
              @value={{this.register}}
              @onValueChange={{this.setRegister}}
              @label='Register'
            />
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b7') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.06}}
                  ><ToolRow
                      @name='read'
                      @verb='Read'
                      @title='Read the relaunch plan'
                      @call='read_file("showcase/relaunch.gts")'
                      @register={{this.register}}
                      @state='completed'
                      @duration={{0.4}}
                    /></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.12}}
                  ><ToolRow
                      @name='search'
                      @verb='Search'
                      @title='Found the seven regulars'
                      @call='cards.search({ type: Runner, filter: runs >= 3 })'
                      @register={{this.register}}
                      @state='completed'
                      @duration={{1.1}}
                    /></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.18}}
                  ><ToolRow
                      @name='edit'
                      @verb='Edit'
                      @title='Marked Lena Ruiz as Regular'
                      @call='cards.update("runners/lena-ruiz", { tier: "Regular" })'
                      @register={{this.register}}
                      @state='completed'
                      @duration={{0.3}}
                    /></Presence>
                  <p class='panel-note'>Transmute is the animated form: hover
                    promotes a tier.</p>
                  <Transmute
                    @verb='READ'
                    @label='the relaunch plan'
                    @call='read_file("relaunch.gts")'
                    @tier={{if this.isMachine 't2' 't1'}}
                  />
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 07b. where a reaction sits ──────────────────────────── }}
          <section
            class='board'
            aria-labelledby='b7r'
            data-test-study-reaction-placement
          >
            <div class='board-head'><h2 class='board-title' id='b7r'><span
                >07b</span>
                Where a reaction sits</h2></div>
            <div class='panel' data-w='440px'>
              <p class='panel-note'>A · under the row, on its text edge</p>
              <div class='react-a'>
                <ToolRow
                  @name='readUrl'
                  @verb='Read'
                  @title='Read web page: https://www.nyrr.org/races'
                  @state='invalid'
                />
                <Reactions
                  class='react-a-pills'
                  @reactions={{this.answerReactions}}
                  @subject='the read'
                />
              </div>
              <p class='panel-note'>B · in the row's head, beside its status</p>
              <ToolRow
                @name='readUrl'
                @verb='Read'
                @title='Read web page: https://www.nyrr.org/races'
                @state='invalid'
              >
                <:actions><Reactions
                    @reactions={{this.answerReactions}}
                    @subject='the read'
                  /></:actions>
              </ToolRow>
              <p class='panel-note'>C · hanging from the row's bottom edge, as a
                chat reaction</p>
              <div class='react-c'>
                <ToolRow
                  @name='readUrl'
                  @verb='Read'
                  @title='Read web page: https://www.nyrr.org/races'
                  @state='invalid'
                  @framed={{true}}
                />
                <Reactions
                  class='react-c-pills'
                  @reactions={{this.answerReactions}}
                  @subject='the read'
                />
              </div>
            </div>
          </section>

          {{! ── 9. search and cards ─────────────────────────────────── }}
          <section class='board' aria-labelledby='b9'>
            <div class='board-head'><h2 class='board-title' id='b9'><span
                >09</span>
                Search, and the cards it returns</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 9'
                data-test-study-replay='b9'
                {{on 'click' (fn this.replay 'b9')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b9') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.06}}
                  ><ToolRow
                      @name='web.search'
                      @verb='Search'
                      @title='Searched the web for October kids’ races'
                      @state='completed'
                      @duration={{1.4}}
                      @framed={{true}}
                      @receipt='5 results · 2 read'
                    >
                      <:rows>
                        <ToolLine
                          @tone='done'
                          @glyph='done'
                          @sub='nyrr.org · read'
                        >NYRR Kids’ Races, fall 2026</ToolLine>
                        <ToolLine
                          @tone='done'
                          @glyph='done'
                          @sub='runnersworld.com · read'
                        >The best fall races for kids</ToolLine>
                        <ToolLine @glyph='note' @sub='halfmarathons.net'>Queens
                          Half: kids’ mile</ToolLine>
                        <ToolLine
                          @tone='failed'
                          @glyph='failed'
                          @sub='403 · the site refused the read'
                        >allrecipes.com</ToolLine>
                      </:rows>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.12}}
                  ><ToolRow
                      @name='cards.search'
                      @verb='Search'
                      @title='Found 7 runners at 3 of 4 runs'
                      @state='completed'
                      @duration={{0.6}}
                      @framed={{true}}
                    >
                      <:rows>
                        <ToolLine @glyph='note' @mono={{true}}>Runner where runs
                          ≥ 3</ToolLine>
                        <CardPills
                          @cards={{this.runners}}
                          @limit={{5}}
                          @selectable={{true}}
                          @selected={{this.pickedRunners}}
                          @onSelectionChange={{this.pickRunners}}
                          @useLabel='Attach to message'
                          @onUseSelection={{this.messageRunners}}
                          @label='Runners to pick'
                        />
                      </:rows>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.18}}
                  ><ToolRow
                      @name='entries.search'
                      @verb='Search'
                      @title='Found 3 races in October'
                      @state='completed'
                      @duration={{0.3}}
                    >
                      <:rows><CardPills
                          @cards={{this.races}}
                          @onOpen={{this.openCard}}
                        /></:rows>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.24}}
                  ><ToolRow
                      @name='cards.get'
                      @verb='Read'
                      @title='Read Lena Ruiz'
                      @state='completed'
                      @duration={{0.1}}
                    >
                      <:rows><CardPills
                          @cards={{this.lena}}
                          @onOpen={{this.openCard}}
                        /></:rows>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.3}}
                  ><ToolRow
                      @name='web.read'
                      @verb='Script'
                      @title='Read the Harlem 5K page into a Race card'
                      @state='completed'
                      @duration={{4.2}}
                      @framed={{true}}
                      @receipt='1 file written'
                    >
                      <:rows>
                        <ToolLine
                          @tone='done'
                          @glyph='done'
                          @sub='nyrr.org/races/harlem-5k · 18 KB'
                        >Read the race page</ToolLine>
                        <ToolLine
                          @tone='done'
                          @glyph='done'
                          @mono={{true}}
                        >races/harlem-5k.json</ToolLine>
                      </:rows>
                      <:result>
                        <ResultCard
                          @eyebrow='Race'
                          @title='Harlem 5K'
                          @lines={{array
                            'Sat Oct 5 · 8:00 AM'
                            'Kids’ mile $10 · closes Sep 28'
                          }}
                        />
                      </:result>
                      <:receipt><ToolReceiptAction
                          @label='Undo'
                          @onAct={{this.note 'Undid the race card'}}
                        /></:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.36}}
                  ><ToolRow
                      @name='cards.search'
                      @verb='Search'
                      @title='The club’s members'
                      @state='completed'
                      @duration={{0.8}}
                      @framed={{true}}
                    >
                      <:rows><CardPills
                          @cards={{this.members}}
                          @layout='grid'
                          @limit={{6}}
                          @open={{this.openCardId}}
                          @onOpen={{this.openCard}}
                          @onClose={{this.closeCard}}
                          @peek={{true}}
                          @expanded={{this.expandedMember}}
                          @onExpand={{this.expandMember}}
                          @onCollapse={{this.collapseMember}}
                          @label='Members'
                        >
                          <:peek as |card|>
                            <div class='demo-fitted'>
                              <span
                                class='demo-fitted-mark'
                              >{{card.title}}</span>
                              <b>{{card.title}}</b>
                              <span>Member · {{card.sub}}</span>
                            </div>
                          </:peek>
                          <:expanded as |card|>
                            <CardEmbed
                              @format='embedded'
                              @kind='Member'
                              @label={{card.title}}
                              @onOpen={{this.note
                                'Opened the member on the stack'
                              }}
                            >
                              <div class='demo-member'>
                                <b>{{card.title}}</b>
                                <span>{{card.sub}} · joined March 2025</span>
                                <span>Usual run: Tuesday 7 PM, 8 km</span>
                              </div>
                            </CardEmbed>
                          </:expanded>
                        </CardPills></:rows>
                    </ToolRow></Presence>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 10. when it goes wrong ───────────────────────────────── }}
          <section class='board' aria-labelledby='b10'>
            <div class='board-head'><h2 class='board-title' id='b10'><span
                >10</span>
                When it goes wrong</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 10'
                data-test-study-replay='b10'
                {{on 'click' (fn this.replay 'b10')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b10') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.06}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Script'
                      @title='Read the plan, fell back to its source'
                      @state='completed'
                      @duration={{2.1}}
                      @framed={{true}}
                    >
                      <:rows>
                        <ToolLine
                          @tone='failed'
                          @glyph='failed'
                          @mono={{true}}
                          @sub='not found'
                        >showcase/relaunch-plan.json</ToolLine>
                        <ToolLine
                          @tone='done'
                          @glyph='done'
                          @mono={{true}}
                          @sub='found by its title'
                        >showcase/relaunch.gts</ToolLine>
                      </:rows>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.12}}
                  ><ToolRow
                      @name='checkCorrectness'
                      @verb='Check'
                      @title='poster.gts'
                      @state={{this.st 'b10-check' 'invalid'}}
                      @status={{if
                        (this.is 'b10-check' 'invalid' 'invalid')
                        'invalid · 2 errors'
                      }}
                      @duration={{if
                        (this.is 'b10-check' 'invalid' 'completed')
                        2.2
                      }}
                      @framed={{true}}
                    >
                      <:rows>
                        <ToolLine
                          @tone='failed'
                          @glyph='failed'
                          @mono={{true}}
                          @sub='line 14'
                        >Unexpected token: missing closing brace</ToolLine>
                        <ToolLine
                          @tone='failed'
                          @glyph='failed'
                          @mono={{true}}
                          @sub='line 22'
                        >PosterTheme is not defined</ToolLine>
                      </:rows>
                      <:receipt>{{#if
                          (this.is 'b10-check' 'invalid' 'invalid')
                        }}<ToolReceiptAction
                            @label='Fix'
                            @onAct={{this.go
                              'b10-check'
                              'completed'
                              'Fixed and checked again'
                            }}
                          />{{/if}}</:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.18}}
                  ><ToolRow
                      @name='web.read'
                      @verb='Read'
                      @title='Read the race calendar'
                      @state='failed'
                      @framed={{true}}
                      @receipt='the site refused the read'
                    >
                      <:rows><ToolLine
                          @tone='failed'
                          @glyph='failed'
                          @sub='403 Forbidden · it blocks automated reads'
                        >runningintheusa.com</ToolLine></:rows>
                      <:receipt><ToolReceiptAction
                          @label='Try another URL'
                          @onAct={{this.note 'Asked for another URL'}}
                        /></:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.24}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Script'
                      @title='Repairing the poster import'
                      @state='ask'
                      @framed={{true}}
                    >
                      <:rows>
                        <ToolLine
                          @glyph='retry'
                          @sub='Poster not exported by ./poster'
                        >Auto-fix 1 of 3</ToolLine>
                        <ToolLine
                          @glyph='retry'
                          @sub='still not exported'
                        >Auto-fix 2 of 3</ToolLine>
                        <ToolLine
                          @glyph='retry'
                          @sub='repair cap reached'
                        >Auto-fix 3 of 3</ToolLine>
                      </:rows>
                      <:gate>
                        <AgentQuestion
                          @question='Which poster module should the plan use?'
                          @options={{array
                            './night-shift'
                            './posters/index'
                            'Make a new one'
                          }}
                          @onAnswer={{this.note 'Picked a module'}}
                        />
                      </:gate>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.3}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Edit'
                      @title='Mark the regulars and email them'
                      @state='failed'
                      @framed={{true}}
                      @receipt='2 files changed before it ended'
                    >
                      <:rows>
                        <ToolLine
                          @tone='done'
                          @glyph='done'
                          @mono={{true}}
                        >runners/lena-ruiz.json</ToolLine>
                        <ToolLine
                          @tone='done'
                          @glyph='done'
                          @mono={{true}}
                        >runners/omar-haddad.json</ToolLine>
                        <ToolLine @tone='failed' @glyph='failed'>Email is not
                          available to scripts</ToolLine>
                      </:rows>
                      <:receipt><ToolReceiptAction
                          @label='Undo 2'
                          @onAct={{this.note 'Undid 2 files'}}
                        /></:receipt>
                    </ToolRow></Presence>
                  <Thinking
                    @doneLabel='Thought for 6 seconds'
                    @rows={{this.thoughts}}
                  />
                  <ToolGroup @tools={{this.group}} />
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 11. operations and bulk writes ───────────────────────── }}
          <section class='board' aria-labelledby='b11'>
            <div class='board-head'><h2 class='board-title' id='b11'><span
                >11</span>
                Operations, images and bulk writes</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 11'
                data-test-study-replay='b11'
                {{on 'click' (fn this.replay 'b11')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b11') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.06}}
                  ><ToolRow
                      @name='images.generate'
                      @verb='Script'
                      @title='Generated the cover and saved the logo'
                      @state='completed'
                      @duration={{18}}
                      @framed={{true}}
                      @receipt='2 files written · 12 credits'
                    >
                      <:rows>
                        <ToolLine
                          @tone='done'
                          @glyph='done'
                          @mono={{true}}
                          @thumb={{this.cover}}
                        >showcase/cover.png</ToolLine>
                        <ToolLine
                          @tone='done'
                          @glyph='done'
                          @mono={{true}}
                          @thumb={{this.logo}}
                        >showcase/scratch/logo.png</ToolLine>
                      </:rows>
                      <:receipt><ToolReceiptAction
                          @label='Undo 2'
                          @onAct={{this.note 'Undid 2 images'}}
                        /></:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.12}}
                  ><ToolRow
                      @name='run-realm-code'
                      @verb='Edit'
                      @title='Marked 37 runners as Regular'
                      @state='partial'
                      @framed={{true}}
                      @receipt='37 of 40 kept'
                    >
                      <:rows><ToolChangeTable
                          @rows={{this.bulk}}
                          @changeLabel='Tier'
                        /></:rows>
                      <:receipt><ToolReceiptAction
                          @label='Undo all'
                          @onAct={{this.note 'Undid all 37'}}
                        /></:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.18}}
                  ><ToolRow
                      @name='index.reindex'
                      @verb='Index'
                      @title='Reindexing the workspace'
                      @state='running'
                      @framed={{true}}
                      @progress={{hash
                        step=412
                        of=980
                        label='Indexing cards'
                        fraction=0
                      }}
                    >
                      <:receipt><ToolReceiptAction
                          @label='Cancel job'
                          @onAct={{this.note 'Canceled the index job'}}
                        /></:receipt>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.24}}
                  ><ToolRow
                      @name='index.fullReindex'
                      @verb='Index'
                      @title={{if
                        (this.is 'b11-full' 'ready' 'running')
                        'Rebuilding the whole index'
                        'Rebuild the whole index'
                      }}
                      @state={{this.st 'b11-full' 'ready'}}
                      @framed={{true}}
                      @progress={{if
                        (this.is 'b11-full' 'ready' 'running')
                        (hash step=1 of=980 label='Indexing cards' fraction=0)
                      }}
                    >
                      <:rows><ToolLine
                          @tone='attention'
                          @glyph='warning'
                          @mono={{true}}
                          @sub='Rebuilds every card; searches are slow until it ends.'
                        >realm.index.fullReindex</ToolLine></:rows>
                      <:gate>{{#if
                          (this.is 'b11-full' 'ready' 'ready')
                        }}<ToolGate
                            @prompt='This waits for your click.'
                            @actions={{this.fullReindexActions}}
                          />{{/if}}</:gate>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.3}}
                  ><ToolRow
                      @name='index.cancelJob'
                      @verb='Index'
                      @title='Canceled the running index job'
                      @state='completed'
                      @duration={{0.2}}
                    /></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.36}}
                  ><ToolRow
                      @name='workspaces.create'
                      @verb='Create'
                      @title='Created the Fall Races workspace'
                      @state='completed'
                      @duration={{2.4}}
                    /></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.42}}
                  ><ToolRow
                      @name='workspaces.delete'
                      @verb='Delete'
                      @title='Deleted the Scratch workspace'
                      @state='completed'
                      @status='deleted · cannot be undone'
                    /></Presence>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 12. docks, rails and rich asks ───────────────────────── }}
          <section class='board' aria-labelledby='b12'>
            <div class='board-head'><h2 class='board-title' id='b12'><span
                >12</span>
                Docks, rails and rich asks</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 12'
                data-test-study-replay='b12'
                {{on 'click' (fn this.replay 'b12')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b12') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.06}}
                  ><ToolRow
                      @name='ask-user'
                      @verb='Ask'
                      @title='Asking which poster'
                      @state='ask'
                      @framed={{true}}
                    >
                      <:gate><AgentQuestion
                          @question='Which poster should the relaunch use?'
                          @choices={{this.posterChoices}}
                          @otherLabel='Something else…'
                          @onAnswer={{this.note 'Picked a poster'}}
                        /></:gate>
                    </ToolRow></Presence>
                  <Presence
                    class='row-presence'
                    @enter='rise'
                    @distance={{8}}
                    @delay={{0.12}}
                  ><ToolRow
                      @name='ask-user'
                      @verb='Ask'
                      @title='Asking for the accent'
                      @state='ask'
                      @framed={{true}}
                    >
                      <:gate><AgentQuestion
                          @question='Which accent colour?'
                          @choices={{this.swatches}}
                          @layout='swatches'
                          @otherLabel='Another colour…'
                          @onAnswer={{this.note 'Picked an accent'}}
                        /></:gate>
                    </ToolRow></Presence>
                  <SourcesStrip @sources={{this.manySources}} @limit={{3}} />
                  <div class='panel-foot'>
                    <GateDock
                      @count={{1}}
                      @noun='question'
                      @note='nothing else running'
                      @onJump={{this.note 'Jumped to the question'}}
                    />
                    <GateDock
                      @count={{3}}
                      @noun='approval'
                      @onApproveAll={{this.note 'Approved all 3'}}
                      @onReview={{this.note 'Reviewing 3'}}
                      @onDecline={{this.note 'Declined 3'}}
                    />
                    <TranscriptStatus @waiting={{1}} />
                    <TranscriptStatus
                      @waiting={{1}}
                      @working={{2}}
                      @background={{1}}
                    />
                  </div>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 13. the composer ─────────────────────────────────────── }}
          <section class='board' aria-labelledby='b13'>
            <div class='board-head'><h2 class='board-title' id='b13'><span
                >13</span>
                The composer and its context</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 13'
                data-test-study-replay='b13'
                {{on 'click' (fn this.replay 'b13')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b13') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <p class='panel-note'>Type @ for a card or a person, or / at
                    the start for a command.</p>
                  <Composer
                    @attachments={{this.attached}}
                    @onPin={{this.pinFocus}}
                    @onRemove={{this.removeAttachment}}
                    @onRetryAttachment={{this.retryUpload}}
                    @onAttach={{this.note 'Opened the attach menu'}}
                    @mentionItems={{this.mentions}}
                    @onMention={{this.mentioned}}
                    @commands={{this.commands}}
                    @onCommand={{this.commanded}}
                    @defaultMode='act'
                  >
                    <:tools>
                      <ModelPicker
                        @models={{this.models}}
                        @value={{this.model}}
                        @onChange={{this.setModel}}
                        @efforts={{this.efforts}}
                        @effort={{this.effort}}
                        @onEffortChange={{this.setEffort}}
                      />
                      <ContextRing
                        @used={{124000}}
                        @limit={{200000}}
                        @compact={{true}}
                      />
                    </:tools>
                  </Composer>
                  <QueuePanel
                    @items={{this.queue}}
                    @onReorder={{this.reorderQueue}}
                    @onEdit={{this.editQueue}}
                    @onRemove={{this.removeQueued}}
                    @onSendNow={{this.sendQueuedNow}}
                  />
                  <Composer @queueCount={{this.queue.length}} @busy={{true}} />
                  <Composer
                    @disabled={{true}}
                    @placeholder='Sign in to message the assistant'
                  />
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 14. a long thread, windowed ──────────────────────────── }}
          <section class='board' aria-labelledby='b14'>
            <div class='board-head'><h2 class='board-title' id='b14'><span
                >14</span>
                A 300-turn thread, windowed</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 14'
                data-test-study-replay='b14'
                {{on 'click' (fn this.replay 'b14')}}
              >↻ Replay</button></div>
            <div class='panel panel-scroll' data-w='440px'>
              {{#each (this.replayKey 'b14') key='@identity' as |_replay|}}
                <StickToBottom @label='A long conversation' as |scroll|>
                  <VirtualTimeline
                    @rows={{this.thread}}
                    @scroll={{scroll}}
                    @estimate={{64}}
                    @measurementKey='study-thread'
                  >
                    <:row as |row|>
                      <div class='thread-row'>
                        {{#if row.user}}
                          <UserBubble
                            @text={{row.text}}
                            @author={{row.author}}
                            @self={{row.self}}
                          />
                        {{else}}
                          <AgentTurn @elapsed={{row.seconds}}><p
                              class='prose-line'
                            >{{row.text}}</p></AgentTurn>
                        {{/if}}
                      </div>
                    </:row>
                  </VirtualTimeline>
                </StickToBottom>
              {{/each}}
            </div>
            <p class='board-note'>Only the rows near the view are in the page;
              scroll up and older turns render as they come into view, keyed by
              id.</p>
          </section>

          {{! ── 15. turns and messages ───────────────────────────────── }}
          <section class='board' aria-labelledby='b15'>
            <div class='board-head'><h2 class='board-title' id='b15'><span
                >15</span>
                Turns and messages</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 15'
                data-test-study-replay='b15'
                {{on 'click' (fn this.replay 'b15')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b15') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <UserBubble
                    @text='Give the poster a border.'
                    @self={{true}}
                    @onEdit={{this.note 'Edited and resent'}}
                    @time='2:04 PM'
                  >
                    <:attachments><CardPills
                        @cards={{this.bubblePoster}}
                        @onOpen={{this.openCard}}
                        @label='Attached'
                      /></:attachments>
                  </UserBubble>
                  <AgentTurn
                    @working={{true}}
                    @phase='checking poster.gts'
                    @elapsed={{12}}
                    @time='2:04 PM'
                  >
                    <Presence
                      class='row-presence'
                      @enter='rise'
                      @distance={{8}}
                      @delay={{0.1}}
                    >
                      <ToolRow
                        @name='checkCorrectness'
                        @verb='Check'
                        @title='Checking poster.gts'
                        @state='running'
                      />
                    </Presence>
                  </AgentTurn>
                  <UserBubble
                    @author='Rupert'
                    @time='2:05 PM'
                    @text='Find running clubs in each of the five boroughs, then for each one list when it meets, how far it runs, whether it welcomes beginners, and whether it has a kids’ group. Put it in a table and skip any club that has not posted in the last year.'
                    @maxLines={{3}}
                  >
                    <:attachments><CardPills
                        @cards={{this.bubbleBoroughs}}
                        @onOpen={{this.openCard}}
                        @label='Attached'
                      /></:attachments>
                  </UserBubble>
                  <AgentTurn
                    @elapsed={{48}}
                    @time='2:06 PM'
                    @meta={{array
                      'GPT-5.6 Terra'
                      '48s'
                      '41 tok/s'
                      '18 credits'
                    }}
                  >
                    <:default><p class='prose-line'>Five boroughs, eleven clubs;
                        three have kids’ groups.</p></:default>
                    <:footer>
                      <MessageActions
                        @text='Five boroughs, eleven clubs; three have kids’ groups.'
                        @onRetry={{this.note 'Regenerating'}}
                        @onFeedback={{this.note 'Rated the reply'}}
                        @onShare={{this.note 'Shared the reply'}}
                      />
                    </:footer>
                  </AgentTurn>
                  <UserBubble
                    @text='Skip the trail races'
                    @self={{true}}
                    @delivery='steer'
                  />
                  <UserBubble
                    @text='And the kids’ fees'
                    @self={{true}}
                    @continued={{true}}
                    @delivery='queued'
                  />
                  <UserBubble
                    @text='Reindex everything'
                    @author='Mei'
                    @delivery='rejected'
                    @reason='you are offline'
                    @onRetry={{this.note 'Retried sending'}}
                  />
                  <AgentTurn @stopped={{true}} @elapsed={{9}}>
                    <p class='prose-line'>Brooklyn has three clubs that…</p>
                  </AgentTurn>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 16. many decisions at once ───────────────────────────── }}
          <section class='board' aria-labelledby='b16'>
            <div class='board-head'><h2 class='board-title' id='b16'><span
                >16</span>
                Many decisions at once</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 16'
                data-test-study-replay='b16'
                {{on 'click' (fn this.replay 'b16')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b16') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  {{#if this.stacked.length}}
                    <GateStack @gates={{this.stacked}} as |gate|>
                      <ToolGate
                        @prompt={{gate.title}}
                        @destructive={{this.isDelete gate}}
                        @scope={{this.scopeOf gate}}
                        @actions={{this.stackActions gate}}
                        @onDecline={{this.declineStacked gate.id}}
                      />
                    </GateStack>
                  {{else}}
                    <TranscriptStatus />
                  {{/if}}
                  <ToolRow
                    @name='run-realm-code'
                    @verb='Script'
                    @title='Saved the logo'
                    @state='completed'
                    @duration={{1.2}}
                    @framed={{true}}
                  >
                    <:gate><ToolGate
                        @prompt=''
                        @auto='Allowed for this session · realm.fs.download'
                      /></:gate>
                  </ToolRow>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 17. review and diff ──────────────────────────────────── }}
          <section class='board board-wide board-wrap' aria-labelledby='b17'>
            <div class='board-head'><h2 class='board-title' id='b17'><span
                >17</span>
                Reviewing what changed</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 17'
                data-test-study-replay='b17'
                {{on 'click' (fn this.replay 'b17')}}
              >↻ Replay</button></div>
            <div class='widths'>
              {{#each
                (this.replayKey 'b17') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <div class='width-col'>
                    <span class='panel-width'>expanded</span>
                    <div class='panel' data-w='680px'>
                      <ChangeReview
                        @files={{this.reviewFiles}}
                        @fileStates={{this.fileStates}}
                        @hunkStates={{this.hunkStates}}
                        @onKeepHunk={{this.keepHunk}}
                        @onRevertHunk={{this.revertHunk}}
                        @onKeepFile={{this.keepFile}}
                        @onRevertFile={{this.revertFile}}
                        @onKeepAll={{this.keepAllFiles}}
                        @onRevertAll={{this.revertAllFiles}}
                        @view='auto'
                      />
                    </div>
                  </div>
                  <div class='width-col'>
                    <span class='panel-width'>440px</span>
                    <div class='panel' data-w='440px'>
                      <SystemLine
                        @variant='checkpoint'
                        @text='Before the border · 2:04 PM'
                        @action='Restore'
                        @onAction={{this.note 'Restored the checkpoint'}}
                      />
                      <AgentTurn @elapsed={{6}}>
                        <:default>
                          <p class='prose-line'>{{this.branchText}}
                            Here is the change; nothing is written until you
                            apply it.</p>
                          <PatchBlock
                            @path='showcase/relaunch.gts'
                            @before={{this.planBefore}}
                            @after={{this.planAfter}}
                            @state={{this.patchState}}
                            @patch='--- a/showcase/relaunch.gts'
                            @onApply={{this.applyPatch}}
                            @onRevert={{this.revertPatch}}
                          />
                        </:default>
                        <:footer>
                          <div class='turn-foot'>
                            <BranchSwitcher
                              @index={{this.branch}}
                              @count={{3}}
                              @onChange={{this.setBranch}}
                            />
                            <MessageActions
                              @text={{this.branchText}}
                              @onRetry={{this.note 'Regenerating'}}
                              @onFeedback={{this.note 'Rated the reply'}}
                            />
                          </div>
                        </:footer>
                      </AgentTurn>
                      <ToolRow
                        @name='run-realm-code'
                        @verb='Edit'
                        @title='Mark the regulars and set their home race'
                        @state='previewed'
                        @framed={{true}}
                        @receipt='preview 9b2c… · sealed'
                      >
                        <:rows>
                          <ToolChange
                            @label='Home race'
                            @from='—'
                            @to='Harlem 5K'
                            @count='×5'
                            @confidence='guessed'
                          />
                          <ToolChangeTable
                            @rows={{this.bulk}}
                            @changeLabel='Tier'
                            @selectable={{true}}
                            @selected={{this.bulkPicked}}
                            @onSelectionChange={{this.pickBulk}}
                          />
                        </:rows>
                        <:gate><ToolGate
                            @prompt='Keep the picked changes?'
                            @actions={{this.bulkActions}}
                          /></:gate>
                      </ToolRow>
                      <ToolRow
                        @name='run-realm-code'
                        @verb='Edit'
                        @title='Added a border to the poster'
                        @state='completed'
                        @duration={{10}}
                        @framed={{true}}
                        @receipt='1 file written'
                      >
                        <:receipt><ToolReceiptAction
                            @label='Undo'
                            @onAct={{this.note 'Undo'}}
                            @refusal='Not undone · the file changed since the run'
                          /></:receipt>
                      </ToolRow>
                      <p class='prose-line'>On the plan card: poster
                        <AuthoredMark @when='turn 3'>Night Shift</AuthoredMark>,
                        accent
                        <AuthoredMark @when='turn 4'>Lime</AuthoredMark>.</p>
                    </div>
                  </div>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 18. inline UI: cards in the reply ────────────────────── }}
          <section class='board' aria-labelledby='b18'>
            <div class='board-head'><h2 class='board-title' id='b18'><span
                >18</span>
                Cards in the reply</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 18'
                data-test-study-replay='b18'
                {{on 'click' (fn this.replay 'b18')}}
              >↻ Replay</button></div>
            <div class='panel' data-w='440px'>
              {{#each
                (this.replayKey 'b18') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  <UserBubble
                    @text='Which tea should the café order for race day?'
                    @author='Mei'
                    @time='9:12 AM'
                  />
                  <AgentTurn @elapsed={{4}}>
                    <:default>
                      <Presence
                        class='row-presence'
                        @enter='rise'
                        @distance={{8}}
                        @delay={{0.08}}
                      >
                        <ToolRow
                          @name='cards.search'
                          @verb='Search'
                          @title='Found 3 tea lots in stock'
                          @state='completed'
                          @duration={{0.6}}
                        >
                          <:result>
                            <LiveCard
                              @onIntent={{this.chooseLot}}
                              @format='embedded'
                              @label='Tea lots'
                              @kind='Tea lot'
                              @onOpen={{this.note
                                'Opened the lots on the stack'
                              }}
                            >
                              <div class='demo-lots'>
                                {{#each
                                  (array 'Rougui' 'Dancong' 'Jin Jun Mei')
                                  as |lot|
                                }}
                                  <div class='demo-lot'>
                                    <b>{{lot}}</b>
                                    <span>Roasted · 250 g in stock</span>
                                    <button
                                      type='button'
                                      data-intent='choose'
                                      data-intent-value={{lot}}
                                      data-intent-label={{lot}}
                                    >Order {{lot}}</button>
                                  </div>
                                {{/each}}
                                <button
                                  type='button'
                                  class='demo-more'
                                  data-intent='explore'
                                  data-intent-label='more lots'
                                >Show more lots</button>
                              </div>
                            </LiveCard>
                          </:result>
                        </ToolRow>
                      </Presence>
                      <p class='prose-line'>Three lots are in stock. Rougui is
                        the roastiest, and holds up to a cold morning.</p>
                    </:default>
                    <:footer>
                      <MessageActions
                        @text='Three lots are in stock.'
                        @onRetry={{this.note 'Regenerating'}}
                        @onFeedback={{this.note 'Rated the reply'}}
                        @reveal='always'
                      >
                        <:more as |close|>
                          <button
                            type='button'
                            {{on
                              'click'
                              (this.note 'Copied a link to this reply')
                            }}
                            {{on 'click' close}}
                          >Copy link</button>
                          <button
                            type='button'
                            {{on
                              'click'
                              (this.note 'Forked a session from here')
                            }}
                            {{on 'click' close}}
                          >Fork from here</button>
                          <button
                            type='button'
                            {{on 'click' (this.note 'Exported as markdown')}}
                            {{on 'click' close}}
                          >Export as markdown</button>
                        </:more>
                      </MessageActions>
                    </:footer>
                  </AgentTurn>
                  <UserBubble
                    @text='And the weather on race day?'
                    @self={{true}}
                    @time='9:13 AM'
                  />
                  <AgentTurn @elapsed={{2}}>
                    <:default>
                      <ToolRow
                        @name='get_weather'
                        @verb='Read'
                        @renderers={{this.renderers}}
                        @state={{this.weatherState}}
                        @duration={{0.8}}
                      />
                      <p class='prose-line'>18°C and partly cloudy at the start,
                        peaking at 21°C around 2 PM. Rain after 5, after the
                        kids’ mile.</p>
                      <button
                        type='button'
                        class='board-expand'
                        aria-pressed={{if this.weatherPending 'true' 'false'}}
                        data-test-study-weather-step
                        {{on 'click' this.replayWeather}}
                      >{{if
                          this.weatherPending
                          'Finish the call'
                          'Show the call pending'
                        }}</button>
                    </:default>
                  </AgentTurn>
                </Presence>{{/each}}
            </div>
          </section>

          {{! ── 19. inside an MCP App iframe ─────────────────────────── }}
          <section class='board' aria-labelledby='b19'>
            <div class='board-head'><h2 class='board-title' id='b19'><span
                >19</span>
                Inside an MCP App iframe</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 19'
                data-test-study-replay='b19'
                {{on 'click' (fn this.replay 'b19')}}
              >↻ Replay</button></div>
            <SegmentedControl
              class='board-switch'
              @options={{this.mcpStates}}
              @value={{this.mcpState}}
              @onValueChange={{this.setMcpState}}
              @label='Frame state'
            />
            <SegmentedControl
              class='board-switch'
              @options={{this.hostModes}}
              @value={{this.hostTheme}}
              @onValueChange={{this.setHostTheme}}
              @label='Host theme'
            />
            <SegmentedControl
              class='board-switch'
              @options={{this.channelModes}}
              @value={{this.channelMode}}
              @onValueChange={{this.setChannelMode}}
              @label='Host message channel'
            />
            <div class='mcp-host' data-host-theme={{this.hostTheme}}>
              <span class='mcp-host-label'>claude.ai · Boxel connector</span>
              <div class='mcp-iframe'>
                {{#each (this.replayKey 'b19') key='@identity' as |_replay|}}
                  <McpAppFrame
                    @bridge={{this.mcpBridge}}
                    @state={{this.mcpState}}
                    @format='embedded'
                    @label='Tea lots for race day'
                    @kind='Tea lots'
                    @error={{if
                      (this.isMcpCancelled)
                      'the reader stopped the call'
                      'The realm did not answer'
                    }}
                    @onRetry={{this.note 'Retried the kernel boot'}}
                    @boxelUrl='https://app.boxel.ai/chris/cafe/lots'
                    @authPrompt='Saving needs edit access to Café menu.'
                    @authorizeLabel='Ask to reconnect'
                    @onAuthorize={{this.note
                      'Asked the assistant to reconnect with edit access'
                    }}
                  >
                    <:bar>
                      <AppBar
                        @title='Tea lots for race day'
                        @kind='Tea lots'
                        @backTitle='Café menu'
                        @onBack={{this.note 'Back to the café menu'}}
                      >
                        <:actions><DisplayModeToggle
                            @mode={{this.mcpDisplay}}
                            @available={{array 'inline' 'fullscreen'}}
                            @onRequest={{this.requestMcpMode}}
                          /></:actions>
                      </AppBar>
                    </:bar>
                    <:default>
                      <LiveCard
                        @onIntent={{this.deliverMcp}}
                        @intentEvents={{array 'boxel-intent'}}
                        @revisable={{true}}
                        @format='embedded'
                        @hat={{false}}
                      >
                        <div class='demo-lots'>
                          {{#each
                            (array 'Rougui' 'Dancong' 'Jin Jun Mei')
                            as |lot|
                          }}
                            <div class='demo-lot'>
                              <b>{{lot}}</b>
                              <span>Roasted · 250 g</span>
                              <button
                                type='button'
                                {{on 'click' (fn this.boxelTap lot)}}
                              >Order {{lot}}</button>
                            </div>
                          {{/each}}
                        </div>
                      </LiveCard>
                    </:default>
                    <:foot>
                      <SaveBar
                        @state={{this.saveState}}
                        @changes={{2}}
                        @destination='Café menu'
                        @onSave={{this.saveCard}}
                        @onDiscard={{this.note 'Discarded the edits'}}
                      />
                    </:foot>
                  </McpAppFrame>
                {{/each}}
              </div>
              <span class='mcp-host-label'>Reported to the host:
                {{this.reportedHeight}}px · view
                {{this.mcpDisplay}}</span>
            </div>
            {{#if this.isAuth}}
              <p class='board-note'>The same step as its own gate, for a tool
                result that is not a card:</p>
              <div class='panel' data-w='440px'>
                <AppAuthGate
                  @action='Saving'
                  @access='edit access to Café menu'
                  @onAskToReconnect={{this.note
                    'Asked the assistant to reconnect'
                  }}
                />
              </div>
            {{/if}}
          </section>

          {{! ── 8. widths ────────────────────────────────────────────── }}
          <section class='board board-wide board-wrap' aria-labelledby='b8'>
            <div class='board-head'><h2 class='board-title' id='b8'><span
                >08</span>
                One turn at 320, 440 and expanded</h2><button
                type='button'
                class='board-replay'
                aria-label='Replay board 8'
                data-test-study-replay='b8'
                {{on 'click' (fn this.replay 'b8')}}
              >↻ Replay</button></div>
            <button
              type='button'
              class='board-expand'
              aria-pressed={{if this.expanded 'true' 'false'}}
              {{on 'click' this.toggleExpanded}}
            >{{if this.expanded 'Narrow the panel' 'Expand the panel'}}</button>
            <div class='widths'>
              {{#each
                (this.replayKey 'b8') key='@identity'
                as |_replay|
              }}<Presence
                  class='board-presence'
                  @enter='rise'
                  @duration={{0.3}}
                >
                  {{#each
                    (if
                      this.expanded
                      (array '680px' '960px')
                      (array '320px' '440px' '680px')
                    )
                    as |w|
                  }}
                    <div class='width-col'>
                      <span class='panel-width'>{{w}}</span>
                      <div class='panel' data-w={{w}}>
                        <UserBubble
                          @text='Give the poster a border.'
                          @self={{true}}
                        />
                        <Presence
                          class='row-presence'
                          @enter='rise'
                          @distance={{8}}
                          @delay={{0.06}}
                        ><ToolRow
                            @name='run-realm-code'
                            @verb='Edit'
                            @title='Added an accent border to the poster'
                            @state='completed'
                            @duration={{10}}
                            @framed={{true}}
                            @receipt='1 file written'
                          >
                            <:rows><ToolDiff
                                @path='showcase/relaunch.gts'
                                @before={{this.planBefore}}
                                @after={{this.planAfter}}
                              /></:rows>
                            <:receipt><ToolReceiptAction
                                @label='Undo'
                                @onAct={{this.note 'Undid'}}
                              /></:receipt>
                          </ToolRow></Presence>
                        <p class='prose-line'>Done. The poster now has a 3 px
                          border in the plan’s accent.</p>
                        <AnswerFooter
                          @text='Done.'
                          @diff={{this.diff}}
                          @onReview={{this.note 'Review opened'}}
                          @cost='6 credits'
                        />
                      </div>
                    </div>
                  {{/each}}
                </Presence>{{/each}}
            </div>
          </section>
        </div>
      </div>
    </div>
    <style scoped>
      /* every colour below is a theme token: the study proves the parts
         theme, so it hard-codes none */
      .study {
        --pretui-recede-opacity: 1;
        --pretui-toolrow-title-size: 12.5px;
        min-height: 100%;
        padding: 40px 40px 80px;
        background: var(--muted);
        color: var(--foreground);
        font-family: var(--font-sans, 'IBM Plex Sans', system-ui, sans-serif);
      }
      .study-frame[data-theme='dark'] {
        color-scheme: dark;
      }
      .study-frame[data-theme='light'] {
        color-scheme: light;
      }
      .study-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }
      .study-head {
        display: grid;
        gap: 6px;
        max-width: 760px;
        margin-bottom: 32px;
      }
      .study-eyebrow,
      .board-title span,
      .panel-width {
        font-family: var(--font-mono, 'IBM Plex Mono', monospace);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .study-title {
        margin: 0;
        font-size: 28px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .study-lede,
      .study-receipt {
        margin: 0;
        font-size: 14px;
        color: var(--muted-foreground);
      }
      .study-receipt {
        font-family: var(--font-mono, monospace);
        font-size: 12px;
      }
      .study-grid {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(440px, 100%), 440px)
        );
        gap: 40px 24px;
        align-items: start;
      }
      .board {
        display: grid;
        gap: 12px;
        justify-items: start;
        min-width: 0;
        max-width: 100%;
      }
      /* a board's switch never pushes the board wider than the pane: it
         scrolls inside its own width */
      .board-switch {
        max-width: 100%;
        overflow-x: auto;
        scrollbar-width: none;
      }
      /* on a narrow pane the segments tighten so every stage stays in view */
      @media (max-width: 560px) {
        .board-switch {
          --boxel-sp-sm: 7px;
          --boxel-sp: 8px;
          --boxel-ui-label-font-size: 12px;
        }
      }
      .board-wide {
        grid-column: 1 / -1;
      }
      .board-head {
        display: flex;
        align-items: baseline;
        gap: 12px;
      }
      .board-replay {
        padding: 0 4px;
        border: 0;
        border-radius: 4px;
        background: none;
        font: inherit;
        font-size: 11.5px;
        font-weight: 500;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .board-replay:hover {
        color: var(--pretui-link, var(--primary));
      }
      .board-replay:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      /* the remount wrappers keep the panel's grid: the board's content
         lays out as if they were not there */
      .board-presence {
        --pretui-presence-display: grid;
        gap: 12px;
        align-content: start;
      }
      /* the display custom property inherits, so each row's own wrapper
         says block, or a flex board would make its rows flex items */
      .row-presence {
        --pretui-presence-display: block;
        min-width: 0;
      }
      /* unframed rows in a row are one run's steps: they sit together, as
         in the transcript, not a board gap apart */
      .row-presence:has(.pretui-toolrow:not([data-framed]))
        + .row-presence:has(.pretui-toolrow:not([data-framed])) {
        margin-top: -12px;
      }
      .widths .board-presence {
        --pretui-presence-display: flex;
        gap: 24px;
        align-items: start;
      }
      /* a fixed-height panel the long thread scrolls inside */
      .panel-scroll {
        height: 520px;
        padding: 0;
        grid-template-rows: minmax(0, 1fr);
      }
      .panel-scroll > :deep(*) {
        min-height: 0;
      }
      .thread-row {
        padding: 6px 16px;
      }
      /* stand-in cards, in the card's own light theme, as a host card is */
      .demo-fitted,
      .demo-member {
        display: grid;
        gap: 2px;
        padding: 10px 12px;
        background: #fff;
        color: #272330;
        font:
          12px/1.4 system-ui,
          sans-serif;
      }
      .demo-fitted span,
      .demo-member span {
        color: #6b6577;
      }
      .demo-fitted-mark {
        display: none;
      }
      .demo-lots {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        padding: 12px;
        background: #fff;
        color: #272330;
        font:
          12.5px/1.4 system-ui,
          sans-serif;
      }
      .demo-lot {
        display: grid;
        gap: 2px;
        align-content: start;
      }
      .demo-lot span {
        color: #6b6577;
        font-size: 11.5px;
      }
      .demo-lot button,
      .demo-more {
        margin-top: 6px;
        padding: 5px 8px;
        border: 1px solid #cfcbd6;
        border-radius: 8px;
        background: #fff;
        font: inherit;
        color: #272330;
        cursor: pointer;
      }
      .demo-lot button:hover,
      .demo-more:hover {
        border-color: #272330;
      }
      .demo-more {
        grid-column: 1 / -1;
        justify-self: start;
        border: 0;
        padding: 0;
        color: #00875f;
      }
      /* a mock of the MCP host around the iframe, in the host's own look:
         nothing of the study's theme reaches inside the frame */
      .mcp-host {
        display: grid;
        gap: 8px;
        width: min(480px, 100%);
        padding: 12px;
        border-radius: 14px;
        background: #f5f4ef;
        color: #6b6a64;
        font:
          11px/1.4 ui-sans-serif,
          system-ui,
          sans-serif;
      }
      .mcp-host[data-host-theme='dark'] {
        background: #1f1e1d;
        color: #b7b5a9;
      }
      .mcp-iframe {
        overflow: hidden;
        border-radius: 12px;
        box-shadow: 0 0 0 1px rgb(127 127 127 / 0.3);
      }
      .turn-foot {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .board-note {
        max-width: 440px;
        margin: 0;
        font-size: 11.5px;
        color: var(--muted-foreground);
      }
      .prose-refs {
        color: var(--muted-foreground);
        font-size: 11.5px;
      }
      .answer-cost {
        margin: -6px 0 0;
        text-align: end;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--subtle-foreground, var(--muted-foreground));
      }
      .board-title {
        display: flex;
        gap: 10px;
        align-items: baseline;
        margin: 0;
        font-size: 15px;
        font-weight: 600;
      }
      .widths {
        display: flex;
        gap: 24px;
        align-items: start;
        max-width: 100%;
        overflow-x: auto;
      }
      /* the thread's three gaps */
      .panel[data-thread] .board-presence {
        gap: var(--pretui-turn-gap, 24px);
      }
      .thread-group {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .thread-group[data-gap='speaker'] {
        gap: 8px;
        justify-items: start;
      }
      .thread-group[data-gap='speaker'] > .thread-group {
        justify-self: stretch;
      }
      /* the jump chip floats on the composer's top edge: it takes no line */
      .thread-foot {
        position: relative;
        display: grid;
      }
      .jump-float {
        --pretui-jump-offset: 0px;
        position: absolute;
        inset-inline: 0;
        inset-block-start: 0;
        height: 0;
        z-index: 1;
      }
      .jump-float > :deep(*) {
        transform: translateY(-50%);
      }
      /* JumpChip sits against a positioned frame: here, the strip above
         the composer, as it sits over the transcript's end in the panel */
      .jump-slot {
        --pretui-jump-offset: 0px;
        position: relative;
        min-height: 32px;
      }

      /* the panel is the one rounded container; everything in it is
         square to its edges */
      .panel {
        position: relative;
        display: grid;
        gap: 12px;
        align-content: start;
        box-sizing: border-box;
        width: min(var(--panel-w, 440px), 100%);
        padding: 16px;
        border-radius: 14px;
        background: var(--background);
        color: var(--pretui-toolrow-settled-ink, var(--foreground));
        box-shadow: 0 0 0 1px var(--border);
        font-size: 12.5px;
        line-height: 1.55;
        overflow: clip;
      }
      .panel[data-w='320px'] {
        --panel-w: 320px;
      }
      .panel[data-w='440px'] {
        --panel-w: 440px;
      }
      .panel[data-w='680px'] {
        --panel-w: 680px;
      }
      .panel[data-w='960px'] {
        --panel-w: 960px;
      }
      .board-expand {
        height: 26px;
        padding: 0 12px;
        border: 0;
        border-radius: 13px;
        background: none;
        box-shadow: inset 0 0 0 1px var(--border-strong, var(--border));
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        color: var(--foreground);
        cursor: pointer;
      }
      .board-expand:hover {
        color: var(--pretui-link);
      }
      .width-col {
        display: grid;
        gap: 8px;
        flex: none;
      }
      .width-col > .panel {
        width: var(--panel-w);
      }
      /* a board whose panels are wider than a narrow pane wraps them, each
         at its width or the pane's, whichever is less, instead of cutting
         them off */
      /* the board's one column is its own width, never its widest panel's */
      .board-wrap {
        grid-template-columns: minmax(0, 1fr);
      }
      .board-wrap .widths,
      .board-wrap .widths .board-presence {
        min-width: 0;
        max-width: 100%;
      }
      .board-wrap .widths,
      .board-wrap .widths .board-presence {
        flex-wrap: wrap;
        overflow: visible;
      }
      .board-wrap .width-col {
        flex: 0 1 auto;
        grid-template-columns: minmax(0, 1fr);
        min-width: 0;
        max-width: 100%;
      }
      /* the panel keeps its width and the cap does the narrowing: a width
         in percent of a column sized by its content collapses it */
      .board-wrap .width-col > .panel {
        width: var(--panel-w);
        max-width: 100%;
      }
      /* where a reaction sits: under the row's text edge, or hanging from
         a framed row's bottom edge */
      .react-a {
        display: grid;
        gap: 4px;
      }
      .react-a-pills {
        padding-inline-start: 24px;
      }
      .react-c {
        display: grid;
      }
      /* the pill hangs from the row's bottom edge: it overlaps the frame's
         border, never the title's descenders */
      .react-c-pills {
        margin-top: -6px;
        padding-inline-start: 32px;
        position: relative;
        z-index: 1;
      }
      .react-c-pills :deep(.pretui-reaction) {
        background: var(--card);
      }
      .panel-note {
        margin: 4px 0 0;
        font-size: 11.5px;
        color: var(--muted-foreground);
      }
      .panel-foot {
        display: grid;
        gap: 6px;
        margin-top: 4px;
      }
      .msg {
        display: grid;
        gap: 8px;
      }
      /* the reader's messages hang from the left edge, as main draws them */
      .msg-person {
        justify-items: start;
      }
      .bubble {
        max-width: 85%;
        margin: 0;
        padding: var(--boxel-sp-sm, 12px);
        border-radius: var(--boxel-border-radius-xxl, 20px);
        border-top-left-radius: var(--boxel-border-radius-xs, 5px);
        /* the user's message is main's white bubble in every theme and
           mode, as the host draws it; a hairline keeps it on a light panel */
        background: light-dark(
          color-mix(in oklch, var(--foreground) 6%, var(--background)),
          var(--boxel-light, #fff)
        );
        color: light-dark(var(--foreground), var(--boxel-dark, #272330));
      }
      .prose p,
      .prose-line {
        margin: 0;
      }
      .answer-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      .answer-table th {
        padding: 6px 8px;
        border-bottom: 1px solid var(--border-strong);
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-align: start;
        text-transform: uppercase;
        white-space: nowrap;
        color: var(--muted-foreground);
      }
      .answer-table td {
        padding: 6px 8px;
        border-bottom: 1px solid var(--border);
      }
      .answer-table tr:last-child td {
        border-bottom: 0;
      }
      @media (max-width: 560px) {
        .study {
          padding: 24px 16px 48px;
        }
        .study-grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    </style>
  </template>
}
