import { CardDef, Component } from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import ArrowUpIcon from '@cardstack/boxel-icons/arrow-up';
import MessageIcon from '@cardstack/boxel-icons/message';
import PlayerPauseIcon from '@cardstack/boxel-icons/player-pause';
import PlayerPlayIcon from '@cardstack/boxel-icons/player-play';
import PlayerStopIcon from '@cardstack/boxel-icons/player-stop';
import RefreshCwIcon from '@cardstack/boxel-icons/refresh-cw';

// The kit, copied from the monorepo's packages/pretui at the branch the
// assistant ships on: the staging Pret UI realm is deployed from main, which
// does not have the assistant parts yet.
import { AgentMark } from './kit/components/agent-mark';
import { AgentQuestion } from './kit/components/agent-question';
import { AnswerFooter } from './kit/components/answer-footer';
import {
  MethodNote,
  SourceRef,
  SourcesStrip,
  StatChips,
} from './kit/components/answer-furniture';
import { Button } from './kit/components/button';
import { CardEmbed } from './kit/components/card-embed';
import { CardPills } from './kit/components/card-pills';
import type { CardPillItem } from './kit/components/card-pills';
import { CodeBlock } from './kit/components/code-block';
import { CollapsedTurn } from './kit/components/collapsed-turn';
import { CompactionChip } from './kit/components/compaction-chip';
import { ComposerCap } from './kit/components/composer-cap';
import type { CapTone } from './kit/components/composer-cap';
import { ContextRing } from './kit/components/context-ring';
import { DiffBlock, lineDiff } from './kit/components/diff-block';
import { JumpChip } from './kit/components/jump-chip';
import { MarkdownStream } from './kit/components/markdown-stream';
import type { MarkdownSource } from './kit/components/markdown-stream';
import { QuickLook } from './kit/components/quick-look';
import { Reactions } from './kit/components/reactions';
import type { Reaction } from './kit/components/reactions';
import { Recommendation } from './kit/components/recommendation';
import type { RecommendationOption } from './kit/components/recommendation';
import { ResultCard } from './kit/components/result-card';
import { SegmentedControl } from './kit/components/segmented-control';
import { SessionPrep } from './kit/components/session-prep';
import type { SessionPrepStep } from './kit/components/session-prep';
import { Slider } from './kit/components/slider';
import { StickToBottom } from './kit/components/stick-to-bottom';
import { SystemLine } from './kit/components/system-line';
import { TaskChecklist } from './kit/components/task-checklist';
import { Thinking } from './kit/components/thinking';
import { ToolChangeTable } from './kit/components/tool-change-table';
import { ToolGate } from './kit/components/tool-gate';
import type { ToolGateAction } from './kit/components/tool-gate';
import { ToolGroup } from './kit/components/tool-group';
import { ToolMeta } from './kit/components/tool-meta';
import { ToolPlan } from './kit/components/tool-plan';
import type { ToolPlanStep } from './kit/components/tool-plan';
import {
  ToolChange,
  ToolLine,
  ToolReceiptAction,
  ToolRow,
} from './kit/components/tool-row';
import type { ToolProgress } from './kit/components/tool-row';
import { TranscriptStudy } from './kit/components/transcript-study';
import { TurnChanges } from './kit/components/turn-changes';
import { UserBubble } from './kit/components/user-bubble';
import { FoundEntries } from './found-entries';

import {
  AGENT_TASKS,
  ANSWER,
  BEATS,
  BORDER_RULE,
  CATALOG_MATCHES,
  COMPACTION_SUMMARY,
  FOLLOW_TURNS,
  MEMBER_DETAILS,
  METHOD,
  NEXT_RACE,
  PLAN_CARD,
  POSTER_AFTER,
  POSTER_BEFORE,
  POSTERS,
  PREP_STEPS,
  RACES,
  READS,
  REGULARS,
  RELAUNCH_PLAN,
  RESEARCH_PLAN,
  SCRIPT_STEPS,
  SEND_OPTIONS,
  SOURCES,
  STATS,
  STORY_LENGTH,
  SWATCHES,
  THOUGHTS,
  TIER_REACTIONS,
  TIER_ROWS,
  TURN_FILES,
  WEDNESDAYS,
} from './story';
import type { Beat, MemberDetail } from './story';

// the assistant's own icon, served from this realm: the host sets these
// tokens on its panel, and AgentMark reads them
const ICON = new URL('./assets/ai-assist-icon.webp', import.meta.url).href;
const ICON_2X = new URL('./assets/ai-assist-icon@2x.webp', import.meta.url)
  .href;
const ICON_WORKING = new URL(
  './assets/ai-assist-icon-animated.webp',
  import.meta.url,
).href;
const PANEL_ICONS = htmlSafe(
  `--pretui-agent-icon: image-set(url("${ICON}") 1x, url("${ICON_2X}") 2x); --pretui-agent-icon-working: url("${ICON_WORKING}"); --pretui-agent-glyph: '';`,
);

const BOLD = /\*\*([^*]+)\*\*/g;
const LIST_ITEM = /^\s*[-*]\s+/;
const WORD = /^\s*\S+/;
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function inline(text: string): string {
  return escapeHtml(text).replace(BOLD, '<strong>$1</strong>');
}
// the answer's markdown: paragraphs, bold and one level of list, which is
// all this story's answer uses
function renderAnswer(source: MarkdownSource): string {
  let src = source.src;
  if (LIST_ITEM.test(src)) {
    let items = src
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => `<li>${inline(line.replace(LIST_ITEM, ''))}</li>`);
    return `<ul>${items.join('')}</ul>`;
  }
  return `<p>${inline(src).replace(/\n/g, ' ')}</p>`;
}
// the answer cut at a word boundary, `share` of the way through
function streamedTo(share: number): string {
  let end = Math.floor(ANSWER.length * Math.min(1, Math.max(0, share)));
  let word = WORD.exec(ANSWER.slice(end));
  return ANSWER.slice(0, word ? end + word[0].length : ANSWER.length);
}

// a list of steps at time t: each finishes at its time; the one after the
// last finished is under way, once `start` has passed
function stepsAt(
  steps: ToolPlanStep[],
  finishes: number[],
  t: number,
  start: number,
): ToolPlanStep[] {
  return steps.map((step, i) => {
    let done = t >= finishes[i]!;
    let previous = i === 0 ? start : finishes[i - 1]!;
    return {
      ...step,
      state: done ? 'done' : t >= previous ? 'current' : 'next',
      note: done || t < previous ? undefined : step.note,
    };
  });
}
function progressAt(
  steps: ToolPlanStep[],
  finishes: number[],
  t: number,
  start: number,
): ToolProgress {
  let done = finishes.filter((f) => t >= f).length;
  let current = Math.min(done, steps.length - 1);
  let from = current === 0 ? start : finishes[current - 1]!;
  let span = finishes[current]! - from;
  return {
    step: current + 1,
    of: steps.length,
    label: steps[current]!.label,
    fraction: Math.min(1, Math.max(0, (t - from) / span)),
  };
}

const DIFF_LINES = lineDiff(POSTER_BEFORE, POSTER_AFTER, { context: 2 });
const BEAT_BY_ID = Object.fromEntries(BEATS.map((b) => [b.id, b])) as Record<
  string,
  Beat
>;
// the story's moments, in seconds
const AT = {
  prep: [1.5, 3, 4.5],
  thought: 10.5,
  reads: 9.5,
  readsDone: 11,
  search: 11,
  searchDone: 12,
  approve: 16,
  tierDone: 18.5,
  reactions: 20,
  poster: 24,
  accentAsk: 24.5,
  accent: 27,
  script: 28,
  scriptSteps: [30, 33, 34.5, 36],
  autofix: 31.5,
  draft: 33,
  research: 37,
  catalog: 42,
  catalogDone: 43.4,
  researchSteps: [38.2, 39.4, 40.6, 41.8],
  answer: 46,
  answerDone: 52,
  reco: 53,
  accept: 56,
  code: 57,
  edit: 58,
  editDone: 59.5,
  quote: 60,
  files: 61,
  look: 63,
  lookOpen: 64,
  follow: 66,
  tasks: [20, 27, 42, 52],
  scheduled: 62,
};
const TICK_MS = 100;

class Isolated extends Component<typeof AssistantShowcase> {
  panelIcons = PANEL_ICONS;
  compactionSummary = COMPACTION_SUMMARY;
  planCard = PLAN_CARD;
  regulars = REGULARS;
  thoughts = THOUGHTS;
  reads = READS;
  tierRows = TIER_ROWS;
  posters = POSTERS;
  swatches = SWATCHES;
  races = RACES;
  stats = STATS;
  sources = SOURCES;
  method = METHOD;
  sendOptions = SEND_OPTIONS;
  diffLines = DIFF_LINES;
  borderRule = BORDER_RULE;
  turnFiles = TURN_FILES;
  followTurns = FOLLOW_TURNS;
  nextRace = NEXT_RACE;
  beats = BEATS.filter((b) => b.id !== 'cap');
  renderAnswer = renderAnswer;
  messageIcon = MessageIcon;
  arrowUpIcon = ArrowUpIcon;
  pauseIcon = PlayerPauseIcon;
  playIcon = PlayerPlayIcon;
  stopIcon = PlayerStopIcon;
  retryIcon = RefreshCwIcon;
  storyLength = STORY_LENGTH;
  scriptMeta = ['run-realm-code', 'ctse/riverside', '8s', '6 credits'];
  resultLines = [
    'To 7 regulars, from Riverside Run Club',
    'Night Shift poster, lime accent',
    'A draft: nothing is sent',
  ];
  modes = [
    { value: 'panel', label: 'Panel' },
    { value: 'full', label: 'Full height' },
  ];

  // -- the clock ---------------------------------------------------------
  // t is where the story is, in seconds. ?t=24 opens the page paused there;
  // otherwise a page someone is looking at plays from the start, and one
  // nobody is looking at (a prerender) shows the whole story
  @tracked t = STORY_LENGTH;
  @tracked playing = false;
  @tracked mode: 'panel' | 'full' = 'panel';
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(owner: unknown, args: any) {
    super(owner as never, args);
    let asked = this.timeFromUrl();
    if (asked !== undefined) {
      this.t = asked;
    } else if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible'
    ) {
      this.t = 0;
      this.play();
    }
  }
  private timeFromUrl(): number | undefined {
    try {
      let raw = new URLSearchParams(globalThis.location?.search ?? '').get(
        't',
      );
      if (raw === null) return undefined;
      let n = Number.parseFloat(raw);
      return Number.isFinite(n)
        ? Math.min(STORY_LENGTH, Math.max(0, n))
        : undefined;
    } catch {
      return undefined;
    }
  }
  play = () => {
    if (this.t >= STORY_LENGTH) this.seek(0);
    this.playing = true;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      let next = Math.round((this.t + TICK_MS / 1000) * 10) / 10;
      if (next >= STORY_LENGTH) {
        this.t = STORY_LENGTH;
        this.pause();
      } else {
        this.t = next;
      }
    }, TICK_MS);
  };
  pause = () => {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = undefined;
  };
  togglePlay = () => (this.playing ? this.pause() : this.play());
  seek = (value: number) => {
    this.t = Math.min(STORY_LENGTH, Math.max(0, value));
    if (this.t < AT.lookOpen) this.lookClosed = false;
  };
  seekTo = (at: number) => () => this.seek(at);
  setMode = (value: string) => (this.mode = value === 'full' ? 'full' : 'panel');
  willDestroy() {
    super.willDestroy();
    clearInterval(this.timer);
  }
  get tLabel() {
    return this.t.toFixed(1);
  }
  formatT = (value: number) => `${value.toFixed(1)} seconds`;
  after = (at: number) => this.t >= at;
  before = (at: number) => this.t < at;
  shown = (id: string) => this.t >= (BEAT_BY_ID[id]?.at ?? 0);
  beat = (id: string) => BEAT_BY_ID[id]!;
  get currentBeat(): Beat {
    let current = this.beats[0]!;
    for (let b of this.beats) if (this.t >= b.at) current = b;
    return current;
  }
  beatState = (b: Beat) =>
    b === this.currentBeat ? 'current' : this.t >= b.at ? 'past' : 'next';
  get isPanel() {
    return this.mode === 'panel';
  }

  // in full height the page follows the newest beat while the story plays;
  // the panel follows with its own StickToBottom
  reveal = modifier((element: HTMLElement) => {
    if (this.playing && this.mode === 'full') {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  // -- the reader's clicks: each moves one part of the story on ----------
  @tracked receipt = '';
  note = (text: string) => () => (this.receipt = text);

  // session prep
  get prepSteps(): SessionPrepStep[] {
    return PREP_STEPS.map((step, i) => {
      let done = this.t >= AT.prep[i]!;
      let started = i === 0 || this.t >= AT.prep[i - 1]!;
      return {
        ...step,
        state: done ? 'complete' : started ? 'running' : 'pending',
      };
    });
  }

  // the plan, held at its gate until approved
  get planApproved() {
    return this.t >= AT.approve;
  }
  approvePlan = () => {
    this.seek(AT.approve);
    this.receipt = 'Approved the plan';
  };
  get planActions(): ToolGateAction[] {
    return [
      { label: 'Approve plan', kind: 'primary', onAct: this.approvePlan },
      {
        label: 'Edit plan',
        kind: 'secondary',
        onAct: this.note('Opened the plan to edit'),
      },
      {
        label: 'Decline',
        kind: 'quiet',
        declines: true,
        onAct: () => undefined,
      },
    ];
  }
  declinePlan = (reason: string) => {
    this.receipt = reason ? `Declined: ${reason}` : 'Declined the plan';
  };

  // the questions: the story answers them, unless the reader does first
  @tracked posterPick: string | undefined;
  @tracked accentPick: string | undefined;
  get poster() {
    return this.t >= AT.poster ? (this.posterPick ?? 'Night Shift') : undefined;
  }
  get accent() {
    return this.t >= AT.accent ? (this.accentPick ?? 'Lime') : undefined;
  }
  pickPoster = (value: string) => {
    this.posterPick = value;
    if (this.t < AT.poster) this.seek(AT.poster);
    this.receipt = `Picked ${value}`;
  };
  pickAccent = (value: string) => {
    this.accentPick = value;
    if (this.t < AT.accent) this.seek(AT.accent);
    this.receipt = `Picked ${value}`;
  };

  @tracked tierReactions: Reaction[] = TIER_REACTIONS;
  toggleReaction = (key: string) => {
    let found = this.tierReactions.find((r) => r.key === key);
    if (found) {
      this.tierReactions = this.tierReactions.map((r) =>
        r.key !== key
          ? r
          : r.mine
            ? { ...r, mine: false, by: r.by.filter((b) => b !== 'Chris') }
            : { ...r, mine: true, by: [...r.by, 'Chris'] },
      );
    } else {
      this.tierReactions = [
        ...this.tierReactions,
        { key, by: ['Chris'], mine: true },
      ];
    }
  };

  // the script and the research run tick through their steps
  get scriptSteps() {
    return stepsAt(SCRIPT_STEPS, AT.scriptSteps, this.t, AT.script);
  }
  get scriptProgress() {
    return progressAt(SCRIPT_STEPS, AT.scriptSteps, this.t, AT.script);
  }
  get scriptRunning() {
    return this.t < AT.scriptSteps[3]!;
  }
  get researchSteps() {
    return stepsAt(RESEARCH_PLAN, AT.researchSteps, this.t, AT.research);
  }
  get researchProgress() {
    return progressAt(RESEARCH_PLAN, AT.researchSteps, this.t, AT.research);
  }
  catalogMatches = CATALOG_MATCHES;
  get catalogRunning() {
    return this.t < AT.catalogDone;
  }
  get researchRunning() {
    return this.t < AT.researchSteps[3]!;
  }

  // the answer streams between its two moments
  get answerText() {
    return streamedTo(
      (this.t - AT.answer) / (AT.answerDone - AT.answer),
    );
  }
  get streaming() {
    return this.t >= AT.answer && this.t < AT.answerDone;
  }
  replayAnswer = () => {
    this.seek(AT.answer);
    this.play();
  };
  saveAnswer = async () => {
    this.receipt = 'Saved the answer as a card';
    return 'Relaunch summary';
  };

  // the recommendation is accepted at its moment, or when the reader does
  @tracked sendKey = 'wed';
  selectSend = (option: RecommendationOption) => (this.sendKey = option.key);
  get sendAccepted() {
    return this.t >= AT.accept;
  }
  acceptSend = (option: RecommendationOption) => {
    this.sendKey = option.key;
    if (this.t < AT.accept) this.seek(AT.accept);
    this.receipt = `Accepted: ${option.short}`;
  };

  // Quick Look: opens on Lena at its moment, or on whoever the reader taps
  @tracked looking: CardPillItem = REGULARS[0]!;
  @tracked lookClosed = false;
  get lookOpen() {
    return this.t >= AT.lookOpen && !this.lookClosed;
  }
  lookAt = (card: CardPillItem) => {
    this.looking = card;
    this.lookClosed = false;
    if (this.t < AT.lookOpen) this.seek(AT.lookOpen);
  };
  lookAtLena = () => this.lookAt(REGULARS[0]!);
  closeLook = () => (this.lookClosed = true);
  get lookingDetail(): MemberDetail {
    return MEMBER_DETAILS[this.looking.id ?? ''] ?? MEMBER_DETAILS['lena-ruiz']!;
  }
  get lookingAttendance() {
    return WEDNESDAYS.map((date, i) => ({
      date,
      came: this.lookingDetail.attended[i] ?? false,
    }));
  }
  get lookingInitial() {
    return this.looking.title.charAt(0);
  }

  // -- the message box's cap: its voice follows the story ---------------
  // the plan's steps tick as the turn does them, once it is approved
  get relaunchPlan() {
    return this.planApproved
      ? stepsAt(RELAUNCH_PLAN, AT.tasks, this.t, AT.approve)
      : RELAUNCH_PLAN;
  }
  get agentTasks() {
    return stepsAt(AGENT_TASKS, AT.tasks, this.t, AT.approve);
  }
  get contextUsed() {
    return Math.round(18000 + (this.t / STORY_LENGTH) * 142000);
  }
  get cap(): {
    tone: CapTone;
    title: string;
    detail?: string;
    action?: string;
    seekTo?: number;
    tasks?: boolean;
  } {
    let t = this.t;
    if (t < 7) return { tone: 'idle', title: 'Waiting for you', detail: 'nothing running' };
    if (t < AT.approve - 3)
      return { tone: 'working', title: 'Reading the club’s runs', action: 'Stop' };
    if (t < AT.approve)
      return { tone: 'waiting', title: 'Approve the plan', detail: '1 of 1', action: 'Approve', seekTo: AT.approve };
    if (t < 21)
      return { tone: 'working', title: 'Marking the regulars', action: 'Stop', tasks: true };
    if (t < AT.accent)
      return { tone: 'waiting', title: 'Answer the question', detail: t < AT.poster ? '1 of 2' : '2 of 2', action: 'Answer', seekTo: AT.accent };
    if (t < AT.answerDone)
      return { tone: 'working', title: t < AT.research ? 'Drafting the email' : t < AT.catalog ? 'Finding fall races' : t < AT.catalogDone ? 'Searching the catalog' : 'Writing the answer', action: 'Stop', tasks: true };
    if (t < AT.accept)
      return { tone: 'waiting', title: 'Pick a send time', action: 'Accept', seekTo: AT.accept };
    if (t < AT.scheduled)
      return { tone: 'working', title: 'Adding the border', action: 'Stop' };
    if (t < STORY_LENGTH - 2)
      return { tone: 'done', title: 'Email scheduled', detail: 'Wed 6 PM' };
    return { tone: 'idle', title: 'Waiting for you', detail: 'nothing running' };
  }
  get capQueued() {
    return this.t >= 30 && this.t < AT.answer;
  }
  get capDots() {
    return this.cap.tone === 'working';
  }
  capAct = () => {
    let seekTo = this.cap.seekTo;
    if (seekTo !== undefined) {
      this.seek(seekTo);
    } else {
      this.pause();
      this.receipt = 'Stopped the turn';
    }
  };

  // -- the transcript study, rendered on request: it is twenty boards
  @tracked studyOpen = false;
  toggleStudy = () => (this.studyOpen = !this.studyOpen);

  <template>
    <article class='showcase' data-mode={{this.mode}}>
      <div class='sheet'>
        <header class='masthead'>
          <p class='kicker'>Pret UI, the Boxel assistant</p>
          <h1 class='title'>Riverside relaunch</h1>
          <p class='lede'>One running club, one conversation with the
            assistant, and every part the new assistant panel is made of. The
            dark panel is the real kit at the panel’s real width. Play the
            story, or drag through it.</p>
          <ul class='facts'>
            <li><b>32</b> components</li>
            <li><b>440px</b> panel</li>
            <li><b>{{this.storyLength}}s</b> story</li>
          </ul>
        </header>

        <div class='transport' role='toolbar' aria-label='Story timeline'>
          <Button
            class='transport-play'
            @size='s'
            @tone='primary'
            @appearance='accent'
            {{on 'click' this.togglePlay}}
          >
            {{#if this.playing}}
              <this.pauseIcon width='14' height='14' aria-hidden='true' />
              Pause
            {{else}}
              <this.playIcon width='14' height='14' aria-hidden='true' />
              Play
            {{/if}}
          </Button>
          <Slider
            class='transport-scrub'
            @label='Story time'
            @min={{0}}
            @max={{this.storyLength}}
            @step={{0.5}}
            @value={{this.t}}
            @onValueChange={{this.seek}}
            @formatValue={{this.formatT}}
          />
          <output class='transport-t'>t={{this.tLabel}}s</output>
          <span class='transport-beat'>{{this.currentBeat.title}}</span>
          <SegmentedControl
            class='transport-mode'
            @options={{this.modes}}
            @value={{this.mode}}
            @onValueChange={{this.setMode}}
            @label='Panel height'
          />
        </div>

        <div class='stage'>
          <div class='column'>
            <div class='frame'>
              <StickToBottom
                class='scroller'
                @revision={{this.t}}
                @active={{this.playing}}
                @label='Assistant panel'
              >
                <:default>
                  <div class='board'>
                    {{#let (this.beat 'head') as |b|}}
                      <div class='beat-note note-head'>
                        <p class='note-title'>{{b.title}}</p>
                        <p>{{b.text}}</p>
                        <p class='note-names'>{{#each b.names as |n|}}<code
                            >{{n}}</code>{{/each}}</p>
                      </div>
                    {{/let}}
                    <div
                      class='beat-panel panel-head'
                      style={{this.panelIcons}}
                      data-scroll-anchor
                    >
                      <AgentMark @size={{20}} @working={{this.playing}} />
                      <span class='room'>
                        <span class='room-name'>Riverside relaunch</span>
                        <span class='room-sub'>Chris, Rupert, Mei and the
                          assistant</span>
                      </span>
                      <span class='receipt' role='status'>{{this.receipt}}</span>
                    </div>

                    {{! -- session start ------------------------------- }}
                    {{#let (this.beat 'prep') as |b|}}
                      <div class='beat-note'>
                        <p class='note-title'>{{b.title}}</p>
                        <p>{{b.text}}</p>
                        <p class='note-names'>{{#each b.names as |n|}}<code
                            >{{n}}</code>{{/each}}</p>
                      </div>
                    {{/let}}
                    <div class='beat-panel' style={{this.panelIcons}}
                      data-scroll-anchor>
                      <SessionPrep
                        @title='Preparing the session'
                        @steps={{this.prepSteps}}
                        @note='Nothing reaches the model until this finishes.'
                        @onSkip={{this.seekTo 5}}
                      />
                    </div>

                    {{! -- what came before ---------------------------- }}
                    {{#if (this.shown 'history')}}
                      {{#let (this.beat 'history') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel stack-tight'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <CollapsedTurn
                          @summary='Read 8 cards, changed 3, on Monday'
                          @variant='row'
                          @expanded={{false}}
                          @onExpand={{this.note
                            'Asked to unfold Monday’s turn'
                          }}
                        />
                        <CompactionChip
                          @state='done'
                          @messageCount={{42}}
                          @toolCallCount={{18}}
                          @summary={{this.compactionSummary}}
                        />
                        <SystemLine
                          @text='Skills on: Club organizer'
                          @glyph='retry'
                          @by='the assistant'
                        />
                        <SystemLine
                          @text='Rupert joined the room'
                          @glyph='add'
                        />
                      </div>
                    {{/if}}

                    {{! -- the ask ------------------------------------- }}
                    {{#if (this.shown 'ask')}}
                      {{#let (this.beat 'ask') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <UserBubble
                          @text='Who are our regulars for the relaunch? Mark them as Regular, then help me get the first run together.'
                          @self={{true}}
                          @time='Wed 2:04 PM'
                          @onEdit={{this.note 'Edited and resent the message'}}
                        >
                          <:attachments>
                            <CardPills
                              @cards={{this.planCard}}
                              @onOpen={{this.lookAt}}
                              @label='Attached'
                            />
                          </:attachments>
                        </UserBubble>
                      </div>
                    {{/if}}

                    {{! -- thinking, reading, finding ------------------ }}
                    {{#if (this.shown 'reading')}}
                      {{#let (this.beat 'reading') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <p class='speaker'><AgentMark
                            @working={{this.before 13}}
                          />
                          <span>Assistant</span>
                          <span class='speaker-time'>2:04 PM</span></p>
                        <Thinking
                          @working={{this.before 10.5}}
                          @label='Thinking'
                          @doneLabel='Thought for 3 seconds'
                          @rows={{this.thoughts}}
                        />
                        {{#if (this.after 9.5)}}
                          <ToolGroup
                            @tools={{this.reads}}
                            @pending={{this.before 11}}
                          />
                        {{/if}}
                        {{#if (this.after 11)}}
                          <ToolRow
                            @name='search_cards'
                            @verb='Search'
                            @title={{if
                              (this.before 12)
                              'Finding the regulars'
                              'Found the seven regulars'
                            }}
                            @state={{if (this.before 12) 'running' 'completed'}}
                            @duration={{0.6}}
                            @framed={{true}}
                          >
                            <:rows>
                              <ToolLine @glyph='note' @mono={{true}}>Member
                                where runs >= 3 of the last 4</ToolLine>
                              {{#if (this.after 12)}}
                                <CardPills
                                  @cards={{this.regulars}}
                                  @layout='grid'
                                  @limit={{6}}
                                  @onOpen={{this.lookAt}}
                                  @label='Regulars'
                                />
                              {{/if}}
                            </:rows>
                          </ToolRow>
                        {{/if}}
                      </div>
                    {{/if}}

                    {{! -- the plan, held for approval ----------------- }}
                    {{#if (this.shown 'plan')}}
                      {{#let (this.beat 'plan') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <ToolRow
                          @name='plan'
                          @verb='Plan'
                          @title={{if
                            this.planApproved
                            'Approved the relaunch plan'
                            'A plan for the relaunch'
                          }}
                          @state={{if
                            this.planApproved
                            'completed'
                            'awaiting-approval'
                          }}
                          @status={{if this.planApproved 'approved' 'needs you'}}
                          @density='run'
                          @framed={{true}}
                        >
                          <:rows><ToolPlan @steps={{this.relaunchPlan}} /></:rows>
                          <:gate>
                            {{#unless this.planApproved}}
                              <ToolGate
                                @prompt='Run this plan?'
                                @detail='It changes seven member cards and drafts one email. Nothing is sent without you.'
                                @actions={{this.planActions}}
                                @onDecline={{this.declinePlan}}
                              />
                            {{/unless}}
                          </:gate>
                        </ToolRow>
                      </div>
                    {{/if}}

                    {{! -- a field change, as a table ------------------ }}
                    {{#if (this.shown 'tier')}}
                      {{#let (this.beat 'tier') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <div class='reacted'>
                          <ToolRow
                            @name='patch_fields'
                            @verb='Edit'
                            @title={{if
                              (this.before 18.5)
                              'Marking the regulars'
                              'Marked 6 of 7 members as Regular'
                            }}
                            @state={{if (this.before 18.5) 'running' 'partial'}}
                            @framed={{true}}
                            @receipt={{if
                              (this.after 18.5)
                              '6 of 7 kept, 1 left as it is'
                            }}
                          >
                            <:rows>
                              <ToolChange
                                @label='Tier'
                                @from='Member'
                                @to='Regular'
                                @count='7 cards'
                              />
                              {{#if (this.after 18.5)}}
                                <ToolChangeTable
                                  @rows={{this.tierRows}}
                                  @changeLabel='Tier'
                                  @limit={{4}}
                                />
                              {{/if}}
                            </:rows>
                            <:receipt>
                              {{#if (this.after 18.5)}}
                                <ToolReceiptAction
                                  @label='Undo 6'
                                  @onAct={{this.note 'Undid 6 tier changes'}}
                                />
                              {{/if}}
                            </:receipt>
                          </ToolRow>
                          {{#if (this.after 20)}}
                            <Reactions
                              class='reacted-pills'
                              @reactions={{this.tierReactions}}
                              @onToggle={{this.toggleReaction}}
                              @subject='the tier change'
                            />
                          {{/if}}
                        </div>
                      </div>
                    {{/if}}

                    {{! -- asking, with the real things to pick -------- }}
                    {{#if (this.shown 'question')}}
                      {{#let (this.beat 'question') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <ToolRow
                          @name='ask-user'
                          @verb='Ask'
                          @title={{if
                            this.poster
                            'Chose the poster'
                            'Asking which poster'
                          }}
                          @state={{if this.poster 'completed' 'ask'}}
                          @choice={{this.poster}}
                          @framed={{true}}
                        >
                          <:gate>
                            <AgentQuestion
                              @question='Which poster should the relaunch use?'
                              @choices={{this.posters}}
                              @confirm={{true}}
                              @otherLabel='Something else'
                              @answered={{this.poster}}
                              @onAnswer={{this.pickPoster}}
                            />
                          </:gate>
                        </ToolRow>
                        {{#if (this.after 24.5)}}
                          <ToolRow
                            @name='ask-user'
                            @verb='Ask'
                            @title={{if
                              this.accent
                              'Chose the accent'
                              'Asking for the accent'
                            }}
                            @state={{if this.accent 'completed' 'ask'}}
                            @choice={{this.accent}}
                            @framed={{true}}
                          >
                            <:gate>
                              <AgentQuestion
                                @question='Which accent colour?'
                                @choices={{this.swatches}}
                                @layout='swatches'
                                @otherLabel='Another colour'
                                @answered={{this.accent}}
                                @onAnswer={{this.pickAccent}}
                              />
                            </:gate>
                          </ToolRow>
                        {{/if}}
                      </div>
                    {{/if}}

                    {{! -- a script, live ------------------------------ }}
                    {{#if (this.shown 'script')}}
                      {{#let (this.beat 'script') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <ToolRow
                          @name='run-realm-code'
                          @verb='Script'
                          @title={{if
                            this.scriptRunning
                            'Drafting the email to the regulars'
                            'Drafted the email to the regulars'
                          }}
                          @state={{if
                            this.scriptRunning
                            'running'
                            'completed'
                          }}
                          @duration={{8}}
                          @density='script'
                          @framed={{true}}
                          @progress={{this.scriptProgress}}
                          @receipt={{if
                            this.scriptRunning
                            'run 7c2e, started just now'
                            'run 7c2e, 1 draft written'
                          }}
                        >
                          <:rows>
                            <ToolPlan @steps={{this.scriptSteps}} />
                            {{#if (this.after 31.5)}}
                              <ToolLine
                                @tone='muted'
                                @glyph='retry'
                                @depth={{1}}
                                @sub='auto-fix, small model, 1 character'
                              >Fixed line 12: a missing bracket</ToolLine>
                            {{/if}}
                            <ToolMeta @items={{this.scriptMeta}} @reveal='always' />
                          </:rows>
                          <:result>
                            {{#if (this.after 33)}}
                              <ResultCard
                                @eyebrow='Email draft'
                                @title='We run again: Wednesday, Nov 4'
                                @lines={{this.resultLines}}
                              />
                            {{/if}}
                          </:result>
                          <:receipt>
                            {{#if this.scriptRunning}}
                              <ToolReceiptAction
                                @label='Stop'
                                @onAct={{this.pause}}
                              />
                            {{else}}
                              <ToolReceiptAction
                                @label='Undo'
                                @onAct={{this.note 'Undid the draft'}}
                              />
                            {{/if}}
                          </:receipt>
                        </ToolRow>
                      </div>
                    {{/if}}

                    {{! -- research, delivering a table ---------------- }}
                    {{#if (this.shown 'research')}}
                      {{#let (this.beat 'research') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <ToolRow
                          @name='research'
                          @verb='Research'
                          @title={{if
                            this.researchRunning
                            'Finding fall races for the first run'
                            'Found fall races for the first run'
                          }}
                          @state={{if
                            this.researchRunning
                            'running'
                            'delivered'
                          }}
                          @density='run'
                          @framed={{true}}
                          @progress={{this.researchProgress}}
                          @receipt={{if
                            this.researchRunning
                            'reading race pages'
                            '5 pages read, 4 races kept'
                          }}
                        >
                          <:rows><ToolPlan @steps={{this.researchSteps}} /></:rows>
                          <:result>
                            {{#if (this.after 40.6)}}
                              <CardEmbed
                                @format='embedded'
                                @state={{if this.researchRunning 'pending' 'ready'}}
                                @label='Fall races near the river'
                                @kind='Race table'
                                @icon={{this.messageIcon}}
                                @onOpen={{this.note 'Opened the race table'}}
                              >
                                <div class='club-card race-card'>
                                  <table class='races'>
                                    <thead>
                                      <tr><th>Race</th><th>Date</th><th
                                        >Kids</th><th>Distance</th></tr>
                                    </thead>
                                    <tbody>
                                      {{#each this.races as |r|}}
                                        <tr data-pick={{if r.pick 'true'}}><td
                                          >{{r.race}}{{#if r.pick}}
                                              <span class='race-pick'>our
                                                pick</span>{{/if}}</td><td
                                            class='num'
                                          >{{r.date}}</td><td
                                            class='num'
                                          >{{r.kids}}</td><td
                                            class='num'
                                          >{{r.distance}}</td></tr>
                                      {{/each}}
                                    </tbody>
                                  </table>
                                </div>
                              </CardEmbed>
                            {{/if}}
                          </:result>
                        </ToolRow>
                      </div>
                    {{/if}}

                    {{! -- the catalog search, best first -------------- }}
                    {{#if (this.shown 'catalog')}}
                      {{#let (this.beat 'catalog') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                        data-scroll-anchor
                        {{this.reveal}}
                      >
                        <ToolRow
                          @name='realm.entries.search'
                          @verb='Script'
                          @title={{if
                            this.catalogRunning
                            'Searching the catalog for a race-day card'
                            'Searched the catalog for a race-day card'
                          }}
                          @state={{if this.catalogRunning 'running' 'completed'}}
                          @duration={{1.4}}
                          @framed={{true}}
                        >
                          <:rows>
                            <ToolLine @glyph='note' @mono={{true}}>race day,
                              event schedule, in @cardstack/catalog</ToolLine>
                            {{#unless this.catalogRunning}}
                              <FoundEntries @entries={{this.catalogMatches}} />
                            {{/unless}}
                          </:rows>
                        </ToolRow>
                      </div>
                    {{/if}}

                    {{! -- the answer ---------------------------------- }}
                    {{#if (this.shown 'answer')}}
                      {{#let (this.beat 'answer') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel prose'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <p class='speaker'><AgentMark
                            @working={{this.streaming}}
                          />
                          <span>Assistant</span>
                          <span class='speaker-time'>2:06 PM</span></p>
                        <MarkdownStream
                          @text={{this.answerText}}
                          @streaming={{this.streaming}}
                          @render={{this.renderAnswer}}
                          @announceComplete='Answer complete'
                        />
                        {{#if (this.after 52)}}
                          <p class='refs'>Fees from
                            <SourceRef
                              @n={{1}}
                              @href='https://www.nyrr.org/races'
                            />
                            and
                            <SourceRef
                              @n={{3}}
                              @href='https://www.riversiderunclub.org/calendar'
                            />; open
                            <Button
                              class='inline-card'
                              @size='xs'
                              @tone='neutral'
                              @appearance='outlined'
                              @shape='pill'
                              {{on 'click' this.lookAtLena}}
                            >Lena Ruiz</Button>
                            for her runs.</p>
                          <StatChips @items={{this.stats}} />
                          <SourcesStrip @sources={{this.sources}} />
                          <MethodNote @text={{this.method}} />
                          <AnswerFooter
                            @text={{this.answerText}}
                            @onSave={{this.saveAnswer}}
                            @onRetry={{this.replayAnswer}}
                            @cost='18 credits'
                          />
                        {{/if}}
                      </div>
                    {{/if}}

                    {{! -- a recommendation ---------------------------- }}
                    {{#if (this.shown 'reco')}}
                      {{#let (this.beat 'reco') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <Recommendation
                          @question='When should the email go out?'
                          @options={{this.sendOptions}}
                          @selectedKey={{this.sendKey}}
                          @onSelect={{this.selectSend}}
                          @onAccept={{this.acceptSend}}
                          @accepted={{this.sendAccepted}}
                          @acceptedLabel='Scheduled'
                        />
                      </div>
                    {{/if}}

                    {{! -- code: the poster gets a border -------------- }}
                    {{#if (this.shown 'code')}}
                      {{#let (this.beat 'code') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel turn-gap'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <UserBubble
                          @text='Give the poster a 3px border in the accent.'
                          @author='Mei'
                          @time='2:09 PM'
                        />
                        {{#if (this.after 61)}}
                          <div class='stack'>
                            <p class='speaker'><AgentMark
                                @working={{this.before 58}}
                              />
                              <span>Assistant</span>
                              <span class='speaker-time'>2:09 PM</span></p>
                            <ToolRow
                              @name='run-realm-code'
                              @verb='Edit'
                              @title={{if
                                (this.before 59.5)
                                'Adding an accent border to the poster'
                                'Added an accent border to the poster'
                              }}
                              @state={{if
                                (this.before 59.5)
                                'running'
                                'completed'
                              }}
                              @duration={{1.5}}
                              @framed={{true}}
                              @receipt={{if (this.after 59.5) '1 file written'}}
                            >
                              <:rows>
                                {{#if (this.after 59.5)}}
                                  <DiffBlock
                                    @lines={{this.diffLines}}
                                    @filename='showcase/poster.gts'
                                    @lineNumbers={{true}}
                                  />
                                {{/if}}
                              </:rows>
                              <:receipt>
                                {{#if (this.after 59.5)}}
                                  <ToolReceiptAction
                                    @label='Undo'
                                    @onAct={{this.note 'Undid the border'}}
                                  />
                                {{/if}}
                              </:receipt>
                            </ToolRow>
                            {{#if (this.after 60)}}
                              <p class='prose-line'>Done. The rule it added, if
                                you want it on the race card too:</p>
                              <CodeBlock
                                @code={{this.borderRule}}
                                @language='css'
                                @filename='poster.css'
                                @density='compact'
                              />
                            {{/if}}
                            {{#if (this.after 61)}}
                              <TurnChanges
                                @files={{this.turnFiles}}
                                @onOpen={{this.note 'Opened a changed file'}}
                                @onReview={{this.note 'Opened the review'}}
                              />
                            {{/if}}
                          </div>
                        {{/if}}
                      </div>
                    {{/if}}

                    {{! -- quick look ---------------------------------- }}
                    {{#if (this.shown 'look')}}
                      {{#let (this.beat 'look') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <div class='look-stage'>
                          <p class='prose-line'>Tap a member’s pill, or
                            <Button
                              class='inline-card'
                              @size='xs'
                              @tone='neutral'
                              @appearance='outlined'
                              @shape='pill'
                              {{on 'click' this.lookAtLena}}
                            >Lena Ruiz</Button>, and the card opens in place
                            without leaving the conversation.</p>
                          {{#if this.lookOpen}}
                            <QuickLook
                              @title={{this.looking.title}}
                              @kind={{this.looking.kind}}
                              @onClose={{this.closeLook}}
                            >
                              <:actions>
                                <Button
                                  @size='s'
                                  {{on
                                    'click'
                                    (this.note 'Opened the member on the stack')
                                  }}
                                >Open</Button>
                              </:actions>
                              <:default>
                                <article class='club-card member'>
                                  <div class='member-band'>
                                    <span
                                      class='member-mark'
                                      aria-hidden='true'
                                    >{{this.lookingInitial}}</span>
                                    <span class='member-club'>Riverside Run
                                      Club</span>
                                  </div>
                                  <div class='member-body'>
                                    <div class='member-id'>
                                      <h3
                                        class='member-name'
                                      >{{this.looking.title}}</h3>
                                      <span class='member-tier'>Regular</span>
                                    </div>
                                    <p class='member-since'>Member since
                                      {{this.lookingDetail.joined}}</p>
                                    <div class='member-attend'>
                                      <p class='member-label'>Last four
                                        Wednesdays</p>
                                      <ol class='attend-strip'>
                                        {{#each this.lookingAttendance as |day|}}
                                          <li
                                            class='attend-day'
                                            data-came={{if
                                              day.came
                                              'true'
                                              'false'
                                            }}
                                          >
                                            <span
                                              class='attend-dot'
                                              aria-hidden='true'
                                            ></span>
                                            <span
                                              class='attend-date'
                                            >{{day.date}}</span>
                                            <span class='attend-said'>{{if
                                                day.came
                                                'came'
                                                'missed'
                                              }}</span>
                                          </li>
                                        {{/each}}
                                      </ol>
                                    </div>
                                    <dl class='member-stats'>
                                      <div><dt>This month</dt><dd
                                        >{{this.lookingDetail.km}} km</dd></div>
                                      <div><dt>Avg pace</dt><dd
                                        >{{this.lookingDetail.pace}} /km</dd></div>
                                      <div><dt>Runs this year</dt><dd
                                        >{{this.lookingDetail.runs}}</dd></div>
                                    </dl>
                                    <p class='member-next'>
                                      <span class='member-label'>Next race</span>
                                      <span><b>{{this.nextRace.name}}</b>,
                                        {{this.nextRace.date}},
                                        {{this.nextRace.note}}</span>
                                    </p>
                                  </div>
                                </article>
                              </:default>
                            </QuickLook>
                          {{/if}}
                        </div>
                      </div>
                    {{/if}}

                    {{! -- following the conversation ------------------ }}
                    {{#if (this.shown 'follow')}}
                      {{#let (this.beat 'follow') as |b|}}
                        <div class='beat-note'>
                          <p class='note-title'>{{b.title}}</p>
                          <p>{{b.text}}</p>
                          <p class='note-names'>{{#each b.names as |n|}}<code
                              >{{n}}</code>{{/each}}</p>
                        </div>
                      {{/let}}
                      <div
                        class='beat-panel'
                        style={{this.panelIcons}}
                      data-scroll-anchor
                        {{this.reveal}}
                      >
                        <div class='follow'>
                          <StickToBottom
                            @defaultFollowing={{false}}
                            @label='Later in the room'
                            @recede={{true}}
                          >
                            <:default>
                              <div class='follow-list'>
                                {{#each this.followTurns as |turn|}}
                                  <div data-transcript-id={{turn.id}}>
                                    {{#if turn.author}}
                                      <UserBubble
                                        @text={{turn.text}}
                                        @author={{turn.author}}
                                      />
                                    {{else}}
                                      <p class='prose-line'>{{turn.text}}</p>
                                    {{/if}}
                                  </div>
                                {{/each}}
                              </div>
                            </:default>
                            <:overlay as |scroll|>
                              <JumpChip
                                @visible={{true}}
                                @count={{3}}
                                @onJump={{fn scroll.scrollToEnd 'smooth'}}
                              />
                            </:overlay>
                          </StickToBottom>
                        </div>
                      </div>
                    {{/if}}
                  </div>
                </:default>
              </StickToBottom>
            </div>

            {{! -- the message box and its cap: always last ------------- }}
            <div class='board board-tail'>
              {{#let (this.beat 'cap') as |b|}}
                <div class='beat-note'>
                  <p class='note-title'>{{b.title}}</p>
                  <p>{{b.text}}</p>
                  <p class='note-names'>{{#each b.names as |n|}}<code
                      >{{n}}</code>{{/each}}</p>
                </div>
              {{/let}}
              <div class='beat-panel beat-last' style={{this.panelIcons}}>
                <div class='composer'>
                  <ComposerCap class='cap' as |cap|>
                    <cap.Status
                      @tone={{this.cap.tone}}
                      @title={{this.cap.title}}
                      @detail={{this.cap.detail}}
                      @dots={{this.capDots}}
                    >
                      {{#if this.cap.action}}
                        <cap.Button @kind='primary' {{on 'click' this.capAct}}>
                          {{#unless this.cap.seekTo}}<this.stopIcon
                              width='12'
                              height='12'
                              aria-hidden='true'
                            />{{/unless}}
                          {{this.cap.action}}
                        </cap.Button>
                      {{/if}}
                    </cap.Status>
                    {{#if this.cap.tasks}}
                      <cap.Section>
                        <TaskChecklist
                          @steps={{this.agentTasks}}
                          @activity={{this.cap.title}}
                          @onActivity={{this.note 'Opened the activity'}}
                        />
                      </cap.Section>
                    {{/if}}
                    {{#if this.capQueued}}
                      <cap.Queued
                        @order='Next'
                        @text='Also add the kids’ fees to the email'
                        @onEdit={{this.note 'Pulled the message back to edit'}}
                        @onRemove={{this.note 'Removed the queued message'}}
                      />
                    {{/if}}
                  </ComposerCap>
                  <div class='box'>
                    <span class='box-placeholder'>Message the assistant</span>
                    <span class='box-tools'>
                      <ContextRing @used={{this.contextUsed}} @limit={{200000}} />
                      <span class='box-send' aria-hidden='true'><this.arrowUpIcon
                          width='16'
                          height='16'
                        /></span>
                    </span>
                  </div>
                </div>
                {{#unless this.isPanel}}
                  <div class='cap-states'>
                    <p class='cap-states-title'>Every voice of the cap</p>
                    <ComposerCap class='cap' as |cap|>
                      <cap.Status
                        @tone='waiting'
                        @title='Run 3 tool calls'
                        @detail='1 of 3'
                      >
                        <cap.Button>Review</cap.Button>
                        <cap.Button @kind='primary'>Accept all</cap.Button>
                      </cap.Status>
                    </ComposerCap>
                    <ComposerCap class='cap' as |cap|>
                      <cap.Status @tone='problem' @title='Failed to send'>
                        <cap.Button @kind='primary'><this.retryIcon
                            width='12'
                            height='12'
                            aria-hidden='true'
                          />
                          Retry</cap.Button>
                      </cap.Status>
                    </ComposerCap>
                    <ComposerCap class='cap' as |cap|>
                      <cap.Status
                        @tone='done'
                        @title='Email scheduled'
                        @detail='Wed 6 PM'
                      />
                    </ComposerCap>
                    <ComposerCap class='cap' as |cap|>
                      <cap.Status
                        @tone='idle'
                        @title='Waiting for you'
                        @detail='nothing running'
                      />
                    </ComposerCap>
                    <div class='rings'>
                      <ContextRing @used={{6000}} @limit={{200000}} />
                      <ContextRing @used={{124000}} @limit={{200000}} />
                      <ContextRing @used={{176000}} @limit={{200000}} />
                    </div>
                  </div>
                {{/unless}}
              </div>
            </div>
          </div>

          {{#if this.isPanel}}
            <ol class='chapters' aria-label='Chapters'>
              {{#each this.beats as |b|}}
                <li class='chapter' data-state={{this.beatState b}}>
                  <Button
                    class='chapter-seek'
                    @size='s'
                    @tone='neutral'
                    @appearance='plain'
                    {{on 'click' (this.seekTo b.at)}}
                  >{{b.title}}</Button>
                  <span class='chapter-at'>{{b.at}}s</span>
                  <p class='chapter-text'>{{b.text}}</p>
                  <p class='note-names'>{{#each b.names as |n|}}<code
                      >{{n}}</code>{{/each}}</p>
                </li>
              {{/each}}
            </ol>
          {{/if}}
        </div>

        <section class='study'>
          <div class='study-head'>
            <h2 class='study-title'>The transcript study</h2>
            <p class='study-lede'>The kit’s own composition study: twenty
              boards of every transcript interaction at real panel widths,
              with its theme and light and dark switches.</p>
            <Button
              @size='s'
              @tone='neutral'
              @appearance='outlined'
              {{on 'click' this.toggleStudy}}
            >{{if this.studyOpen 'Hide the study' 'Show the study'}}</Button>
          </div>
          {{#if this.studyOpen}}
            <TranscriptStudy />
          {{/if}}
          <p class='note-names'><code>TranscriptStudy</code></p>
        </section>
      </div>
    </article>
    <style scoped>
      /* Theme posture: pinned. The page is a light editorial sheet; the
         panel is the Boxel assistant panel's dark theme, its values copied
         from the host's panel so the kit renders exactly as it does there.
         The scale tokens sit on the root so page and panel share one 4px
         grid and one type ladder. */
      .showcase {
        --step-4: 0.25rem;
        --step-8: 0.5rem;
        --step-12: 0.75rem;
        --step-16: 1rem;
        --step-24: 1.5rem;
        --step-32: 2rem;
        --step-48: 3rem;
        --step-64: 4rem;
        --round-chip: 0.25rem;
        --round-row: 0.5rem;
        --round-surface: 0.75rem;
        --type-read: 0.875rem;
        --leading-read: 1.375rem;
        --type-ui: 0.78125rem;
        --leading-ui: 1.125rem;
        --type-caption: 0.6875rem;
        --leading-caption: 1rem;
        --type-head: 1.0625rem;
        --leading-head: 1.5rem;
        --type-display: 1.375rem;
        --leading-display: 1.75rem;
        --type-data: 0.75rem;
        --leading-data: 1.125rem;
        --text-ui-xs: var(--type-caption);
        --text-ui-sm: var(--type-caption);
        --text-ui-md: var(--type-ui);
        --text-ui: var(--type-ui);
        --measure-read: 68ch;
        --font-mono: var(--boxel-monospace-font-family);
        --showcase-panel-w: 27.5rem;
        --showcase-note-w: 36ch;
        --showcase-frame-h: 40rem;
        --showcase-type-title: 2.5rem;
        --showcase-leading-title: 2.75rem;
        --showcase-type-lede: 1rem;
        --showcase-leading-lede: 1.5rem;
        /* the page's own inks, light on a lavender sheet */
        --page: #f4f2f8;
        --page-ink: #1d1830;
        --page-ink-2: #4c4563;
        --page-rule: color-mix(in oklch, var(--page-ink) 12%, transparent);
        --page-chip: color-mix(in oklch, var(--page-ink) 7%, transparent);

        container-type: inline-size;
        min-height: 100%;
        background-color: var(--page);
        color: var(--page-ink);
        font-family: var(--boxel-font-family);
        font-size: var(--type-read);
        line-height: var(--leading-read);
      }
      .sheet {
        box-sizing: border-box;
        padding: var(--step-48) var(--step-32) var(--step-64);
      }
      .masthead {
        max-width: var(--measure-read);
        margin: 0 auto var(--step-48);
        display: grid;
        gap: var(--step-12);
      }
      .kicker {
        font-size: var(--type-ui);
        line-height: var(--leading-ui);
        font-weight: 600;
        color: var(--page-ink-2);
      }
      .title {
        font-size: var(--showcase-type-title);
        line-height: var(--showcase-leading-title);
        font-weight: 600;
        letter-spacing: -0.02em;
      }
      .lede {
        color: var(--page-ink-2);
        font-size: var(--showcase-type-lede);
        line-height: var(--showcase-leading-lede);
      }
      .facts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--step-8);
        margin: var(--step-4) 0 0;
        padding: 0;
        list-style: none;
        font-size: var(--type-ui);
        line-height: var(--leading-ui);
        color: var(--page-ink-2);
        font-variant-numeric: tabular-nums;
      }
      .facts li {
        padding: var(--step-4) var(--step-12);
        border-radius: 999px;
        background-color: color-mix(in oklch, white 70%, transparent);
        box-shadow: 0 0 0 1px var(--page-rule);
      }
      .facts b {
        color: var(--page-ink);
        font-weight: 600;
      }

      /* the board: the panel column and its notes, one beat per row, so
         each note sits beside the part it names. A note comes first in the
         markup, so a phone reads it above its part; dense flow puts it
         beside the part here */
      .board {
        display: grid;
        grid-template-columns: var(--showcase-panel-w) minmax(0, var(--showcase-note-w));
        grid-auto-flow: row dense;
        column-gap: var(--step-32);
        justify-content: center;
        align-items: stretch;
      }
      .beat-panel {
        /* the Boxel assistant panel's colour tokens, from the host's panel */
        --foreground: #f7f8fa;
        --ink-2: #c9c4d6;
        --ink-3: #a8a2ba;
        --pretui-toolrow-settled-ink: var(--ink-2);
        --muted-foreground: var(--ink-2);
        --subtle-foreground: var(--ink-3);
        --state-live: var(--boxel-highlight);
        --state-attention: #f0b44c;
        --state-failed: #f07272;
        --background: var(--boxel-ai-purple);
        --card: color-mix(in oklch, var(--boxel-light) 6%, var(--boxel-ai-purple));
        --inset: color-mix(in oklch, var(--boxel-light) 9%, var(--boxel-ai-purple));
        --muted: var(--inset);
        --hover: color-mix(in oklch, var(--boxel-light) 12%, var(--boxel-ai-purple));
        --border: color-mix(in oklch, var(--boxel-light) 10%, transparent);
        --border-strong: color-mix(in oklch, var(--boxel-light) 20%, transparent);
        --pretui-shadow-hairline: 0 0 0 1px var(--border);
        --card-foreground: var(--foreground);
        --pretui-highlight-pill: color-mix(in oklch, var(--boxel-light) 18%, var(--boxel-ai-purple));
        --pretui-seg-active-ink: var(--foreground);
        --pretui-code-well: color-mix(in oklch, black 28%, color-mix(in oklch, var(--boxel-light) 6%, var(--boxel-ai-purple)));
        --ring: var(--boxel-highlight);
        --primary: var(--boxel-highlight);
        --primary-foreground: var(--boxel-dark);
        --pretui-primary-ink: var(--boxel-highlight);
        --pretui-link: var(--boxel-highlight);
        --success: var(--boxel-highlight);
        --success-ink: var(--boxel-highlight);
        --destructive: var(--boxel-danger);
        --pretui-destructive-ink: color-mix(in oklch, var(--boxel-danger) 55%, var(--boxel-light));
        --pretui-attention: var(--state-attention);
        --pretui-attention-ink: var(--state-attention);
        --pretui-code-string: #a8e6a1;
        --pretui-code-number: #f7b07a;
        --pretui-code-keyword: #d7a6ff;
        --pretui-code-name: #8fc7ff;
        --pretui-code-comment: var(--boxel-450);
        --pretui-cap-surface: color-mix(in oklch, var(--boxel-light) 9%, var(--boxel-ai-purple));
        --pretui-cap-edge: color-mix(in oklch, var(--boxel-light) 16%, var(--boxel-ai-purple));

        grid-column: 1;
        position: relative;
        display: grid;
        gap: var(--step-12);
        align-content: start;
        box-sizing: border-box;
        min-width: 0;
        padding: var(--step-12) var(--step-16);
        background-color: var(--background);
        color: var(--foreground);
        font-size: var(--type-ui);
        line-height: var(--leading-ui);
      }
      .panel-head {
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        padding-block: var(--step-16) var(--step-12);
        border-radius: var(--round-surface) var(--round-surface) 0 0;
      }
      .beat-last {
        padding-bottom: var(--step-16);
        border-radius: 0 0 var(--round-surface) var(--round-surface);
      }
      .turn-gap {
        gap: var(--step-24);
      }
      .stack {
        display: grid;
        gap: var(--step-12);
        min-width: 0;
      }
      .stack-tight {
        gap: var(--step-4);
      }
      .room {
        display: grid;
        min-width: 0;
      }
      .room-name {
        font-size: var(--type-read);
        line-height: var(--leading-read);
        font-weight: 600;
      }
      .room-sub,
      .receipt,
      .speaker-time {
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        color: var(--ink-3);
      }
      .receipt {
        grid-column: 1 / -1;
        color: var(--state-live);
      }
      .receipt:empty {
        display: none;
      }

      .beat-note {
        grid-column: 2;
        align-self: start;
        display: grid;
        gap: var(--step-4);
        padding-block: var(--step-12);
        border-top: 1px solid var(--page-rule);
        color: var(--page-ink-2);
        font-size: var(--type-ui);
        line-height: var(--leading-ui);
      }
      .beat-note p {
        max-width: var(--showcase-note-w);
      }
      .note-head {
        border-top: 0;
        padding-top: var(--step-16);
      }
      .note-title {
        color: var(--page-ink);
        font-weight: 600;
      }
      .note-names {
        display: flex;
        flex-wrap: wrap;
        gap: var(--step-4);
        margin-top: var(--step-4);
      }
      .note-names code {
        padding: 0 var(--step-4);
        border-radius: var(--round-chip);
        background-color: var(--page-chip);
        color: var(--page-ink);
        font-family: var(--font-mono);
        font-size: var(--type-data);
        line-height: var(--leading-data);
      }

      /* the speaker line: the mark on the spine, the name on the text edge */
      .speaker {
        display: flex;
        align-items: center;
        gap: var(--step-8);
        font-size: var(--type-ui);
        line-height: var(--leading-ui);
        font-weight: 600;
      }
      .speaker-time {
        font-weight: 400;
        font-variant-numeric: tabular-nums;
      }
      .prose-line {
        max-width: var(--measure-read);
        font-size: var(--type-read);
        line-height: var(--leading-read);
      }
      .refs {
        max-width: var(--measure-read);
        color: var(--ink-2);
      }
      /* a card named in the prose: an outlined pill on the inset, 18 tall
         inside the 22 leading, so the line never jumps */
      .inline-card {
        --pretui-button-h: 1.125rem;
        --pretui-button-px: var(--step-8);
        vertical-align: 1px;
      }
      .replay {
        display: flex;
      }

      .reacted {
        display: grid;
        gap: var(--step-8);
      }
      .reacted-pills {
        padding-inline-start: var(--step-24);
      }

      /* the cards the run made, in the club's own theme. QuickLook and
         CardEmbed reset font and colour at their frame, since a real card
         brings its own; these stand-ins do the same */
      .club-card {
        --club-paper: #fbfaf5;
        --club-ink: #1b1440;
        --club-ink-2: #4c4563;
        --club-rule: color-mix(in oklch, var(--club-ink) 12%, transparent);
        --club-night: #1b1440;
        --club-lime: #c3fc33;
        background-color: var(--club-paper);
        color: var(--club-ink);
        font-family: var(--boxel-font-family);
        font-size: var(--type-ui);
        line-height: var(--leading-ui);
        font-variant-numeric: tabular-nums;
      }
      .member {
        display: grid;
        min-height: 100%;
      }
      .member-band {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--step-12);
        height: 4.5rem;
        padding: 0 var(--step-16);
        background:
          radial-gradient(circle at 85% 30%, color-mix(in oklch, var(--club-lime) 55%, transparent) 0 0.75rem, transparent 0.8rem),
          linear-gradient(160deg, var(--club-night), color-mix(in oklch, var(--club-night) 70%, #3d2d7a));
        color: var(--club-paper);
      }
      .member-mark {
        display: grid;
        place-items: center;
        width: 3.5rem;
        height: 3.5rem;
        margin-bottom: calc(-1 * var(--step-24));
        border-radius: 50%;
        background-color: var(--club-lime);
        color: var(--club-night);
        box-shadow: 0 0 0 3px var(--club-paper);
        font-size: var(--type-display);
        font-weight: 600;
      }
      .member-club {
        padding-bottom: var(--step-8);
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        font-weight: 600;
        color: color-mix(in oklch, var(--club-paper) 80%, transparent);
      }
      .member-body {
        display: grid;
        gap: var(--step-12);
        padding: var(--step-32) var(--step-16) var(--step-16);
      }
      .member-id {
        display: flex;
        align-items: center;
        gap: var(--step-8);
      }
      .member-name {
        font-size: var(--type-display);
        line-height: var(--leading-display);
        font-weight: 600;
      }
      .member-tier {
        padding: 0 var(--step-8);
        border-radius: 999px;
        background-color: var(--club-lime);
        color: var(--club-night);
        font-size: var(--type-caption);
        line-height: var(--leading-ui);
        font-weight: 600;
      }
      .member-since {
        margin-top: calc(-1 * var(--step-8));
        color: var(--club-ink-2);
      }
      .member-label {
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        color: var(--club-ink-2);
      }
      .member-attend {
        display: grid;
        gap: var(--step-4);
      }
      .attend-strip {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--step-4);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .attend-day {
        display: grid;
        justify-items: start;
        gap: var(--step-4);
        padding: var(--step-8);
        border-radius: var(--round-row);
        box-shadow: inset 0 0 0 1px var(--club-rule);
      }
      .attend-day[data-came='true'] {
        background-color: var(--club-night);
        color: var(--club-paper);
        box-shadow: none;
      }
      .attend-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1.5px var(--club-ink-2);
      }
      .attend-day[data-came='true'] .attend-dot {
        background-color: var(--club-lime);
        box-shadow: none;
      }
      .attend-date {
        font-weight: 600;
      }
      .attend-said {
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        opacity: 0.8;
      }
      .member-stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin: 0;
        border-block: 1px solid var(--club-rule);
      }
      .member-stats > div {
        display: grid;
        padding: var(--step-8) 0;
      }
      .member-stats > div + div {
        padding-inline-start: var(--step-12);
        border-inline-start: 1px solid var(--club-rule);
      }
      .member-stats dt {
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        color: var(--club-ink-2);
      }
      .member-stats dd {
        margin: 0;
        font-size: var(--type-head);
        line-height: var(--leading-head);
        font-weight: 600;
      }
      .member-next {
        display: grid;
        gap: var(--step-4);
      }

      .race-card {
        padding: var(--step-4) var(--step-8);
      }
      .races {
        width: 100%;
        border-collapse: collapse;
      }
      .races th,
      .races td {
        padding: var(--step-8);
        border-bottom: 1px solid var(--club-rule);
        text-align: start;
      }
      .races th {
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--club-ink-2);
      }
      .races tr:last-child td {
        border-bottom: 0;
      }
      .races tr[data-pick] td {
        background-color: color-mix(in oklch, var(--club-lime) 35%, var(--club-paper));
        font-weight: 600;
      }
      .race-pick {
        margin-inline-start: var(--step-4);
        padding: 0 var(--step-4);
        border-radius: var(--round-chip);
        background-color: var(--club-night);
        color: var(--club-lime);
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        font-weight: 600;
        white-space: nowrap;
      }
      .races .num {
        white-space: nowrap;
      }

      .look-stage {
        position: relative;
        display: grid;
        align-content: start;
        min-height: 34rem;
        border-radius: var(--round-row);
        overflow: clip;
      }
      .follow {
        position: relative;
        height: 17.5rem;
        border-radius: var(--round-row);
        box-shadow: inset 0 0 0 1px var(--border);
        overflow: hidden;
      }
      .follow > :deep(*) {
        height: 100%;
      }
      .follow-list {
        display: grid;
        gap: var(--step-12);
        padding: var(--step-12);
      }

      .composer {
        display: grid;
      }
      .cap {
        position: relative;
        --pretui-cap-inset: 0;
      }
      /* the live cap runs the box's full width and tucks under it: the box
         overlaps its bottom edge, and the cap pads that overlap so nothing
         it says is covered */
      .composer .cap {
        padding-bottom: var(--step-12);
      }
      /* the message box: a tinted light, raised on the dark panel */
      .box {
        position: relative;
        z-index: 1;
        margin-top: calc(-1 * var(--step-12));
        --foreground: var(--boxel-dark);
        --ink-2: #4c4563;
        --ink-3: #6b6482;
        --muted-foreground: var(--ink-2);
        --border: color-mix(in oklch, var(--boxel-dark) 14%, transparent);
        display: flex;
        justify-content: space-between;
        gap: var(--step-8);
        min-height: 4.5rem;
        padding: var(--step-12);
        border-radius: var(--round-surface);
        background-color: color-mix(in oklch, var(--boxel-ai-purple) 5%, var(--boxel-light));
        color: var(--foreground);
      }
      .box-placeholder {
        font-size: var(--type-read);
        line-height: var(--leading-read);
        color: var(--ink-3);
      }
      .box-tools {
        display: flex;
        align-items: center;
        gap: var(--step-8);
        align-self: end;
      }
      .box-send {
        display: grid;
        place-items: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: var(--round-row);
        background-color: var(--primary);
        color: var(--primary-foreground);
        font-weight: 600;
      }
      .cap-states {
        display: grid;
        gap: var(--step-8);
        padding-top: var(--step-12);
      }
      .rings {
        display: flex;
        gap: var(--step-16);
        align-items: center;
        padding: var(--step-4) var(--step-12) 0;
      }

      .study {
        max-width: 75rem;
        margin: var(--step-64) auto 0;
        display: grid;
        gap: var(--step-16);
      }
      .study-head {
        max-width: var(--measure-read);
        display: grid;
        gap: var(--step-8);
        justify-items: start;
      }
      .study-title {
        font-size: var(--type-display);
        line-height: var(--leading-display);
        font-weight: 600;
      }
      .study-lede {
        color: var(--page-ink-2);
      }


      /* every beat, and every row a beat gains, rises in as Pret UI's
         Presence rise does: 8px up and a fade, on the kit's enter easing */
      @keyframes showcase-rise {
        from {
          opacity: 0;
          transform: translateY(0.5rem);
        }
      }
      .beat-panel > * {
        animation: showcase-rise 300ms
          var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1)) both;
      }
      @media (prefers-reduced-motion: reduce) {
        .beat-panel > * {
          animation: none;
        }
      }

      /* the transport: play, scrub, where the story is, and the panel's
         height */
      .transport {
        position: sticky;
        top: 0;
        z-index: 30;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--step-8) var(--step-16);
        max-width: calc(var(--showcase-panel-w) + var(--showcase-note-w) + var(--step-32));
        margin: 0 auto var(--step-24);
        padding: var(--step-12) var(--step-16);
        border-radius: var(--round-surface);
        background-color: color-mix(in oklch, white 80%, var(--page));
        box-shadow: 0 0 0 1px var(--page-rule), 0 0.5rem 1.5rem color-mix(in oklch, var(--page-ink) 8%, transparent);
        font-size: var(--type-ui);
        line-height: var(--leading-ui);
      }
      .transport-play {
        --pretui-button-min-w: 6rem;
        gap: var(--step-4);
      }
      .transport-scrub {
        flex: 2 1 8rem;
        min-width: 8rem;
      }
      .transport-t {
        min-width: 4.5rem;
        font-family: var(--font-mono);
        font-size: var(--type-data);
        font-variant-numeric: tabular-nums;
        color: var(--page-ink);
      }
      .transport-beat {
        flex: 1 1 8rem;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
        color: var(--page-ink-2);
      }

      /* the stage: the panel column, and in panel mode its chapters */
      .stage {
        display: grid;
        grid-template-columns: minmax(0, auto);
        justify-content: center;
        gap: var(--step-32);
        align-items: start;
      }
      .showcase[data-mode='panel'] .stage {
        grid-template-columns: var(--showcase-panel-w) minmax(0, var(--showcase-note-w));
      }
      .column {
        display: grid;
        min-width: 0;
      }
      /* the panel's own layers (Quick Look's sheet) stay inside it */
      .frame {
        isolation: isolate;
      }
      .scroller {
        height: auto;
      }
      .showcase[data-mode='panel'] .column {
        /* the panel colour behind both the frame and the message box, so
           the seam where they meet never shows the page through */
        border-radius: var(--round-surface);
        background-color: var(--boxel-ai-purple);
      }
      .showcase[data-mode='panel'] .frame {
        /* the panel's own colour behind a transcript still shorter than
           the frame, so it meets the message box with no gap */
        background-color: var(--boxel-ai-purple);
        height: var(--showcase-frame-h);
        border-radius: var(--round-surface) var(--round-surface) 0 0;
        overflow: clip;
      }
      .showcase[data-mode='panel'] .scroller {
        height: 100%;
      }
      .showcase[data-mode='panel'] .board {
        grid-template-columns: var(--showcase-panel-w);
      }
      .showcase[data-mode='panel'] .beat-note {
        display: none;
      }
      .board-tail .beat-note {
        border-top: 1px solid var(--page-rule);
      }
      .cap-states-title {
        padding: 0 var(--step-12);
        font-size: var(--type-caption);
        line-height: var(--leading-caption);
        color: var(--ink-3);
      }

      .chapters {
        display: grid;
        gap: var(--step-4);
        max-height: calc(var(--showcase-frame-h) + 9rem);
        margin: 0;
        padding: 0;
        overflow-y: auto;
        list-style: none;
      }
      .chapter {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 0 var(--step-8);
        padding: var(--step-8) var(--step-12);
        border-radius: var(--round-row);
        color: var(--page-ink-2);
        font-size: var(--type-ui);
        line-height: var(--leading-ui);
      }
      .chapter[data-state='current'] {
        background-color: color-mix(in oklch, white 80%, var(--page));
        box-shadow: 0 0 0 1px var(--page-rule);
        color: var(--page-ink);
      }
      .chapter[data-state='next'] {
        color: color-mix(in oklch, var(--page-ink-2) 75%, var(--page));
      }
      .chapter-seek {
        --pretui-button-px: 0;
        justify-self: start;
        font-weight: 600;
      }
      .chapter-at {
        font-family: var(--font-mono);
        font-size: var(--type-data);
        font-variant-numeric: tabular-nums;
      }
      .chapter-text,
      .chapter .note-names {
        grid-column: 1 / -1;
      }
      .chapter:not([data-state='current']) .chapter-text {
        display: none;
      }

      /* a phone: one column, the notes above the part they name, and the
         panel a run of segments down the page */
      @container (max-width: 760px) {
        .sheet {
          padding: var(--step-24) 0 var(--step-48);
        }
        .masthead,
        .study {
          padding-inline: var(--step-16);
        }
        .masthead {
          margin-bottom: var(--step-24);
        }
        .title {
          font-size: var(--type-display);
          line-height: var(--leading-display);
        }
        .board,
        .showcase[data-mode='panel'] .board,
        .showcase[data-mode='panel'] .stage {
          grid-template-columns: minmax(0, 1fr);
        }
        .chapters {
          display: none;
        }
        .transport {
          margin-inline: var(--step-8);
        }
        .showcase[data-mode='panel'] .frame {
          border-radius: 0;
        }
        .beat-panel,
        .beat-note {
          grid-column: 1;
        }
        .beat-note {
          padding: var(--step-16) var(--step-16) var(--step-8);
          border-top: 0;
        }
        .beat-panel,
        .panel-head {
          border-radius: var(--round-surface);
        }
      }
    </style>

  </template>
}

export class AssistantShowcase extends CardDef {
  static displayName = 'Assistant showcase';
  static icon = MessageIcon;
  static prefersWideFormat = true;
  static isolated = Isolated;
}
