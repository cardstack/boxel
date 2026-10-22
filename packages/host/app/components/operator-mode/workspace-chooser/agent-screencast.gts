import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import assistantIcon from '../../ai-assistant/ai-assist-icon@2x.webp';

type ChapterId = 'compose' | 'files' | 'form' | 'link' | 'brand' | 'query';
type BeatKind = 'user' | 'agent' | 'tool' | 'cli' | 'form';

// What the side panel shows, in the order the loop builds it up.
enum Stage {
  SignedOut,
  SignedIn,
  Composed,
  Files,
  Budget,
  Attendees,
  Branded,
  Board,
}

interface Beat {
  chapter: ChapterId;
  kind: BeatKind;
  // A step's argument, or the message itself.
  text: string;
  // A step's tool, the way the agent app names it (`Bash` for a CLI call).
  tool?: string;
  // A step's result, shown under it.
  detail?: string;
  // Files the user attaches to a request.
  attachments?: string[];
  // The panel moves to this stage when the beat starts.
  stage?: Stage;
  // The scene's last reply, held a moment before the next request.
  closes?: boolean;
}

interface TimedBeat extends Beat {
  start: number;
  end: number;
}

// Typing speed for requests and form fields, the beat each agent step
// takes to land, the pause that closes a scene, and how long the panel
// marks a change as new; the loop holds its last frame before starting
// over.
const TYPE_MS = 32;
const SEND_PAUSE_MS = 500;
const STEP_MS = 850;
const SCENE_HOLD_MS = 1600;
const FORM_OPEN_MS = 500;
// Filling in a form is slower than typing a request.
const FORM_TYPE_MS = 70;
const FORM_SEND_MS = 600;
const UPDATED_MS = 2400;
const HOLD_MS = 3500;
const TICK_MS = 50;

const CHAPTERS: { id: ChapterId; label: string }[] = [
  { id: 'compose', label: 'Compose cards' },
  { id: 'files', label: 'Files' },
  { id: 'form', label: 'Card forms' },
  { id: 'link', label: 'Link & search' },
  { id: 'brand', label: 'Brand guide' },
  { id: 'query', label: 'Live lists' },
];

// The card form the agent puts in the chat, filled in by the user.
const FORM_FIELDS = [
  { label: 'Headcount', value: '24' },
  { label: 'Dates', value: 'May 12–14' },
  { label: 'Dietary', value: '3 vegetarian, 1 vegan' },
];
const FORM_CHARS = FORM_FIELDS.reduce((n, f) => n + f.value.length, 0);
const FORM_MS = FORM_OPEN_MS + FORM_CHARS * FORM_TYPE_MS + FORM_SEND_MS;

const SCRIPT: Beat[] = [
  {
    chapter: 'compose',
    kind: 'user',
    text: 'Build an Offsite card with days, venues and a budget',
  },
  {
    chapter: 'compose',
    kind: 'cli',
    text: 'boxel browse --host-url …',
    detail: 'Boxel pane signed in',
    stage: Stage.SignedIn,
  },
  {
    chapter: 'compose',
    kind: 'tool',
    tool: 'Search',
    text: 'catalog "venue", "money"',
    detail: 'Reusing Venue and Money',
  },
  {
    chapter: 'compose',
    kind: 'tool',
    tool: 'Write',
    text: 'offsite.gts',
    detail: '+92 lines',
  },
  {
    chapter: 'compose',
    kind: 'cli',
    text: 'boxel file lint offsite.gts',
    detail: 'No problems',
  },
  {
    chapter: 'compose',
    kind: 'cli',
    text: 'boxel realm push',
    detail: 'Pushed 2 files to offsite',
    stage: Stage.Composed,
  },
  {
    chapter: 'compose',
    kind: 'agent',
    text: 'Lisbon offsite is live: a list of days, each linking its venue.',
    closes: true,
  },
  {
    chapter: 'files',
    kind: 'user',
    text: 'Attach the venue contract and floor plan',
    attachments: ['contract.pdf', 'floor-plan.png'],
  },
  {
    chapter: 'files',
    kind: 'cli',
    text: 'boxel file write contract.pdf floor-plan.png',
    detail: 'Indexed as PDF and image cards',
  },
  {
    chapter: 'files',
    kind: 'tool',
    tool: 'Edit',
    text: 'Day/day-1.json',
    detail: 'Linked both files',
    stage: Stage.Files,
  },
  {
    chapter: 'files',
    kind: 'agent',
    text: 'Day 1 shows them as file cards, with previews.',
    closes: true,
  },
  { chapter: 'form', kind: 'user', text: 'Work out the budget' },
  {
    chapter: 'form',
    kind: 'agent',
    text: 'I need three details. Fill in this card:',
  },
  { chapter: 'form', kind: 'form', text: 'Offsite details' },
  {
    chapter: 'form',
    kind: 'cli',
    text: 'boxel realm push',
    detail: 'Budget updated',
    stage: Stage.Budget,
  },
  {
    chapter: 'form',
    kind: 'agent',
    text: 'Budget set: €18,400 for 24 people.',
    closes: true,
  },
  { chapter: 'link', kind: 'user', text: 'Invite the platform team' },
  {
    chapter: 'link',
    kind: 'cli',
    text: 'boxel search --type Person --realm people',
    detail: '24 people found',
  },
  {
    chapter: 'link',
    kind: 'tool',
    tool: 'Edit',
    text: 'Offsite/lisbon.json',
    detail: 'Linked 24 attendees',
  },
  {
    chapter: 'link',
    kind: 'cli',
    text: 'boxel realm push',
    detail: 'Pushed 1 file to offsite',
    stage: Stage.Attendees,
  },
  {
    chapter: 'link',
    kind: 'agent',
    text: 'They’re linked from the people realm, not copied.',
    closes: true,
  },
  {
    chapter: 'brand',
    kind: 'user',
    text: 'Put it on the Fernway brand',
  },
  {
    chapter: 'brand',
    kind: 'cli',
    text: 'boxel search --type BrandGuide',
    detail: 'Fernway brand guide',
  },
  {
    chapter: 'brand',
    kind: 'tool',
    tool: 'Edit',
    text: 'Offsite/lisbon.json',
    detail: 'Linked the brand guide as its theme',
  },
  {
    chapter: 'brand',
    kind: 'cli',
    text: 'boxel realm push',
    detail: 'Pushed 1 file to offsite',
    stage: Stage.Branded,
  },
  {
    chapter: 'brand',
    kind: 'agent',
    text: 'Lisbon offsite now uses Fernway’s colors and type.',
    closes: true,
  },
  {
    chapter: 'query',
    kind: 'user',
    text: 'Make a board of all our offsites',
  },
  {
    chapter: 'query',
    kind: 'tool',
    tool: 'Write',
    text: 'offsite-board.gts',
    detail: '+41 lines · a query over Offsite',
  },
  {
    chapter: 'query',
    kind: 'cli',
    text: 'boxel realm push',
    detail: 'Pushed 2 files to offsite',
    stage: Stage.Board,
  },
  {
    chapter: 'query',
    kind: 'agent',
    text: 'The board is a live query, so new offsites join it on their own.',
    closes: true,
  },
];

function beatDuration(beat: Beat) {
  switch (beat.kind) {
    case 'user':
      return beat.text.length * TYPE_MS + SEND_PAUSE_MS;
    case 'form':
      return FORM_MS;
    default:
      return STEP_MS + (beat.closes ? SCENE_HOLD_MS : 0);
  }
}

const TIMELINE: TimedBeat[] = (() => {
  let at = 0;
  return SCRIPT.map((beat) => {
    let duration = beatDuration(beat);
    let timed = { ...beat, start: at, end: at + duration };
    at += duration;
    return timed;
  });
})();

const TOTAL_MS = TIMELINE[TIMELINE.length - 1]?.end ?? 0;

// The Offsite's days, each a field in its list that links a Venue card.
const DAYS = [
  {
    dow: 'TUE',
    date: '12',
    plan: 'Arrive and Alfama walk',
    time: '14:00–19:00',
    venue: 'Memmo Alfama',
    kind: 'Hotel · 24 rooms held',
    tone: 'tone-indigo',
  },
  {
    dow: 'WED',
    date: '13',
    plan: 'Strategy workshops',
    time: '09:30–17:00',
    venue: 'LX Factory, Room B',
    kind: 'Venue · 40 seats',
    tone: 'tone-teal',
  },
  {
    dow: 'THU',
    date: '14',
    plan: 'Sintra day trip',
    time: '08:00–18:00',
    venue: 'Pena Palace',
    kind: 'Guided tour',
    tone: 'tone-amber',
  },
];

const ATTENDEES = [
  { initials: 'AL', tone: 'tone-indigo' },
  { initials: 'MK', tone: 'tone-teal' },
  { initials: 'JS', tone: 'tone-amber' },
  { initials: 'RP', tone: 'tone-rose' },
];

// The budget the form's answers produce, by line, as shares of the bar.
const BUDGET = [
  { label: 'Venues', amount: '€7,200', share: 39, shade: 'tone-indigo' },
  { label: 'Travel', amount: '€5,600', share: 30, shade: 'tone-teal' },
  { label: 'Food', amount: '€3,700', share: 20, shade: 'tone-amber' },
  { label: 'Activities', amount: '€1,900', share: 11, shade: 'tone-rose' },
].map((line) => ({ ...line, width: htmlSafe(`flex: ${line.share}`) }));

// The board's columns: every Offsite, grouped by status.
const BOARD = [
  {
    status: 'Planning',
    dot: 'is-planning',
    offsites: [
      {
        code: 'LIS',
        tone: 'tone-indigo',
        name: 'Lisbon',
        meta: 'May 12–14 · Platform',
        people: '24',
        budget: '€18,400',
        done: htmlSafe('width: 56%'),
        checklist: '5 / 9',
        isNew: true,
      },
    ],
  },
  {
    status: 'Booked',
    dot: 'is-booked',
    offsites: [
      {
        code: 'KIX',
        tone: 'tone-rose',
        name: 'Kyoto',
        meta: 'Oct 3–5 · Design',
        people: '18',
        budget: '€22,100',
        done: htmlSafe('width: 100%'),
        checklist: '9 / 9',
        isNew: false,
      },
    ],
  },
  {
    status: 'Done',
    dot: 'is-done',
    offsites: [
      {
        code: 'OAX',
        tone: 'tone-teal',
        name: 'Oaxaca',
        meta: 'Feb 9–11 · Company',
        people: '30',
        budget: '€15,900',
        done: htmlSafe('width: 100%'),
        checklist: '9 / 9',
        isNew: false,
      },
    ],
  },
];

// The agent apps the screencast can dress as: what each calls a new
// conversation, its list, its composer chips, and its tool steps. Claude
// Code and Codex are desktop apps with Boxel in their side panel; Grok Bot
// is a messaging app with no browser of its own, so Boxel opens in a
// window beside it.
export type AgentFlavor = 'claude' | 'codex' | 'grok' | 'boxel';

const AGENT_CHROME = {
  claude: {
    newChat: '＋ New session',
    listLabel: 'Recents',
    hint: 'Reply…',
    chips: ['＋', 'Auto'],
    model: 'Opus',
    steps: { cli: 'Bash', Search: 'Search', Write: 'Write', Edit: 'Edit' },
  },
  codex: {
    newChat: '✎ New task',
    listLabel: 'Tasks',
    hint: 'Work with Codex',
    chips: ['＋', 'Local'],
    model: 'GPT-6',
    steps: { cli: 'Ran', Search: 'Searched', Write: 'Created', Edit: 'Edited' },
  },
  grok: {
    newChat: '',
    listLabel: '',
    hint: 'Type your answer, or talk about something else',
    chips: [],
    model: '',
    steps: { cli: 'Ran', Search: 'Searched', Write: 'Created', Edit: 'Edited' },
  },
  // Boxel's own AI Assistant: no CLI, so its steps are the commands it
  // applies to cards.
  boxel: {
    newChat: '',
    listLabel: '',
    hint: 'Enter a prompt',
    chips: ['＋', 'Skills · 3'],
    model: 'Claude Sonnet',
    steps: {
      cli: 'Run',
      Search: 'Search cards',
      Write: 'Create card',
      Edit: 'Patch card',
    },
  },
} as const;

// Grok Bot's left column: its bots, the active one first.
const GROK_BOTS = [
  { tone: '#ff7a1a', active: true },
  { tone: '#8b5cf6', active: false },
  { tone: '#a3a3a3', active: false },
  { tone: '#ff3d8b', active: false },
  { tone: '#f43f5e', active: false },
];

const botTone = (tone: string) => htmlSafe(`--bot-tone: ${tone}`);

// Codex's rail: home, tasks, history, mentions, more, then the repo's
// branch and apps. Stroke paths in a 24-unit box.
const CODEX_RAIL = [
  {
    d: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    active: true,
  },
  { d: 'M3 6l1.5 1.5L7 5M3 13l1.5 1.5L7 12M11 6h10M11 13h10M11 20h10' },
  { d: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0' },
  {
    d: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  },
  { d: 'M5 12h.01M12 12h.01M19 12h.01' },
  { divider: true },
  {
    d: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  },
  { d: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z' },
] as { d?: string; active?: boolean; divider?: boolean }[];

const CODEX_SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z';

// Labeled once per agent app, so the thread keeps the same beat objects
// from tick to tick and its rows aren't rebuilt (and re-animated) each time.
// Only Claude Code and Codex can put a card form in their chat for the
// user to fill in. Grok Bot and Boxel AI Assistant ask in words instead,
// and the user answers with a message.
const INLINE_CARDS: Record<AgentFlavor, boolean> = {
  claude: true,
  codex: true,
  grok: false,
  boxel: false,
};

const ASK_IN_WORDS =
  'I need three details: headcount, dates and any dietary needs.';
const ANSWER_IN_WORDS = '24 people, May 12–14. 3 vegetarian, 1 vegan';

// The form beat and the ask before it, as an agent without card forms
// plays them: same timing, so the panel keeps its pace.
function withoutCardForm(beat: TimedBeat): TimedBeat {
  if (beat.kind === 'form') {
    return { ...beat, kind: 'user', text: ANSWER_IN_WORDS };
  }
  if (beat.chapter === 'form' && beat.kind === 'agent' && !beat.closes) {
    return { ...beat, text: ASK_IN_WORDS };
  }
  return beat;
}

const LABELED_TIMELINES = Object.fromEntries(
  (Object.keys(AGENT_CHROME) as AgentFlavor[]).map((agent) => {
    let steps: Record<string, string> = AGENT_CHROME[agent].steps;
    return [
      agent,
      // The assistant works on cards directly, so it has no CLI calls.
      TIMELINE.filter((beat) => agent !== 'boxel' || beat.kind !== 'cli')
        .map((beat) => (INLINE_CARDS[agent] ? beat : withoutCardForm(beat)))
        .map((beat) => ({
          ...beat,
          label:
            beat.kind === 'cli'
              ? steps.cli
              : (steps[beat.tool ?? ''] ?? beat.tool),
        })),
    ];
  }),
) as Record<AgentFlavor, (TimedBeat & { label?: string })[]>;

interface Signature {
  Args: {
    // Which agent app to dress as; follows the Agents section's pick.
    agent?: AgentFlavor;
  };
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

// Plays only while the player is on screen, so the loop costs nothing
// while the page is scrolled elsewhere.
const whileVisible = modifier(
  (element: HTMLElement, [onChange]: [(visible: boolean) => void]) => {
    let observer = new IntersectionObserver((entries) => {
      onChange(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(element);
    return () => observer.disconnect();
  },
);

// The pane's apps are laid out at a small tablet's width and scaled to
// the pane, so their layout never squeezes, whatever width the page gives.
const APP_WIDTH_PX = 400;
const fitToTablet = modifier((element: HTMLElement) => {
  let observer = new ResizeObserver(() => {
    element.style.setProperty(
      '--app-scale',
      String(element.clientWidth / APP_WIDTH_PX),
    );
  });
  observer.observe(element);
  return () => observer.disconnect();
});

// A screencast of Boxel with a coding agent, drawn in the page rather than
// shipped as a video: a desktop agent app, the kind Claude and Codex both
// are, works through the boxel CLI while Boxel, open in the app's side
// panel, picks each change up. Its scenes walk what that pairing gives
// you: cards composed from catalog fields, files kept as cards, a card
// form the agent puts in its chat for your input (Claude Code and Codex
// only; the others ask in words), links across realms, and live query
// lists. With reduced motion it holds the finished frame.
export default class AgentScreencast extends Component<Signature> {
  @tracked private elapsed = 0;
  @tracked private playing = !prefersReducedMotion();
  @tracked private visible = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args);
    if (!this.playing) {
      this.elapsed = TOTAL_MS;
    }
  }

  willDestroy() {
    super.willDestroy();
    this.stop();
  }

  // A request being typed sits in the composer; once sent, it and every
  // step after it show in the thread.
  private get typing() {
    let t = this.elapsed;
    let ask = LABELED_TIMELINES[this.args.agent ?? 'claude'].find(
      (beat) =>
        beat.kind === 'user' && t >= beat.start && t < beat.end - SEND_PAUSE_MS,
    );
    if (!ask) {
      return undefined;
    }
    let chars = Math.floor((t - ask.start) / TYPE_MS);
    return ask.text.slice(0, Math.max(chars, 0));
  }

  private get chrome() {
    return AGENT_CHROME[this.args.agent ?? 'claude'];
  }

  private get isClaude() {
    return (this.args.agent ?? 'claude') === 'claude';
  }

  // The form chapter is a card form only where the agent can show one.
  private get chapters() {
    return INLINE_CARDS[this.args.agent ?? 'claude']
      ? CHAPTERS
      : CHAPTERS.map((chapter) =>
          chapter.id === 'form' ? { ...chapter, label: 'Questions' } : chapter,
        );
  }

  private get isBoxel() {
    return this.args.agent === 'boxel';
  }

  private get isCodex() {
    return this.args.agent === 'codex';
  }

  private get isGrok() {
    return this.args.agent === 'grok';
  }

  // The timeline with each step labeled as this agent app prints it.
  private get thread() {
    let t = this.elapsed;
    return LABELED_TIMELINES[this.args.agent ?? 'claude'].filter((beat) =>
      beat.kind === 'user' ? t >= beat.end - SEND_PAUSE_MS : t >= beat.start,
    );
  }

  // The agent is at work after a request or a step, until it replies or
  // hands the user a form.
  private get working() {
    if (this.typing) {
      return false;
    }
    let last = this.thread[this.thread.length - 1];
    return Boolean(
      last &&
      (last.kind === 'user' || last.kind === 'tool' || last.kind === 'cli'),
    );
  }

  // The form's fields fill in one after another, then it is sent.
  private get formFields() {
    let form = TIMELINE.find((beat) => beat.kind === 'form');
    let typed = form
      ? Math.max(
          Math.floor((this.elapsed - form.start - FORM_OPEN_MS) / FORM_TYPE_MS),
          0,
        )
      : 0;
    return FORM_FIELDS.map((field) => {
      let shown = field.value.slice(0, typed);
      typed = Math.max(typed - field.value.length, 0);
      return { label: field.label, value: shown };
    });
  }

  private get formSent() {
    let form = TIMELINE.find((beat) => beat.kind === 'form');
    return Boolean(form && this.elapsed >= form.end - FORM_SEND_MS);
  }

  private get chapter(): ChapterId {
    let started = TIMELINE.filter((beat) => beat.start <= this.elapsed);
    return started[started.length - 1]?.chapter ?? 'compose';
  }

  private get stageBeat() {
    let reached = TIMELINE.filter(
      (beat) => beat.stage !== undefined && beat.start <= this.elapsed,
    );
    return reached[reached.length - 1];
  }

  private get stage() {
    return this.stageBeat?.stage ?? Stage.SignedOut;
  }

  // The panel marks each change for a moment after it lands.
  private get updated() {
    let beat = this.stageBeat;
    return Boolean(
      beat &&
      beat.stage !== Stage.SignedIn &&
      this.elapsed - beat.start < UPDATED_MS,
    );
  }

  private get signedOut() {
    return this.stage === Stage.SignedOut;
  }
  private get emptyWorkspace() {
    return this.stage === Stage.SignedIn;
  }
  private get showOffsite() {
    return this.stage >= Stage.Composed && this.stage < Stage.Board;
  }
  private get showFiles() {
    return this.stage >= Stage.Files;
  }
  private get showBudget() {
    return this.stage >= Stage.Budget;
  }
  private get showAttendees() {
    return this.stage >= Stage.Attendees;
  }
  private get showBoard() {
    return this.stage >= Stage.Board;
  }
  private get isBranded() {
    return this.stage >= Stage.Branded;
  }

  private get panelPath() {
    if (this.stage >= Stage.Board) {
      return 'offsite / All offsites';
    }
    if (this.stage >= Stage.Composed) {
      return 'offsite / Lisbon offsite';
    }
    return this.signedOut ? 'Sign in' : 'offsite';
  }

  private start() {
    if (this.timer || !this.playing || !this.visible) {
      return;
    }
    this.timer = setInterval(() => {
      let next = this.elapsed + TICK_MS;
      this.elapsed = next > TOTAL_MS + HOLD_MS ? 0 : next;
    }, TICK_MS);
  }

  private stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  @action private setVisible(visible: boolean) {
    this.visible = visible;
    if (visible) {
      this.start();
    } else {
      this.stop();
    }
  }

  @action private togglePlay() {
    this.playing = !this.playing;
    if (this.playing) {
      if (this.elapsed >= TOTAL_MS) {
        this.elapsed = 0;
      }
      this.start();
    } else {
      this.stop();
    }
  }

  @action private jumpTo(chapter: ChapterId) {
    let first = TIMELINE.find((beat) => beat.chapter === chapter);
    this.elapsed = first?.start ?? 0;
  }

  <template>
    <figure
      class='screencast'
      aria-label='How Boxel works with your coding agent'
      {{whileVisible this.setVisible}}
      data-test-agent-screencast
    >
      <div
        class={{cn
          'window'
          is-claude=this.isClaude
          is-codex=this.isCodex
          is-grok=this.isGrok
          is-boxel=this.isBoxel
        }}
        aria-hidden='true'
      >
        {{! The agent app: its own window when Boxel sits beside it. }}
        <div class='agent-app'>
          {{#if this.isGrok}}
            {{! Grok Bot's column of bots. }}
            <div class='sidebar is-bots'>
              <span class='traffic'><i></i><i></i><i></i></span>
              {{#each GROK_BOTS as |bot|}}
                <span class={{cn 'bot-slot' is-active=bot.active}}>
                  <i class='bot' style={{botTone bot.tone}}></i>
                </span>
              {{/each}}
              <span class='bot-add'>＋</span>
            </div>
          {{else if this.isBoxel}}
            {{! The assistant is a panel in Boxel itself: no sidebar. }}
          {{else if this.isCodex}}
            {{! Codex's rail of icons, with no session list. }}
            <div class='sidebar is-rail'>
              <span class='traffic'><i></i><i></i><i></i></span>
              {{#each CODEX_RAIL as |icon|}}
                {{#if icon.divider}}
                  <i class='rail-divider'></i>
                {{else}}
                  <span class={{cn 'rail-icon' is-active=icon.active}}><svg
                      viewBox='0 0 24 24'
                      width='13'
                      height='13'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='1.8'
                      stroke-linecap='round'
                      stroke-linejoin='round'
                    ><path d={{icon.d}} /></svg></span>
                {{/if}}
              {{/each}}
              <span class='rail-avatar'></span>
            </div>
          {{else}}
            {{! The agent app's own sidebar: a new session, then recent ones. }}
            <div class='sidebar'>
              <span class='traffic'><i></i><i></i><i></i></span>
              <span class='new-session'>{{this.chrome.newChat}}</span>
              <span class='side-label'>{{this.chrome.listLabel}}</span>
              <span class='side-item is-active'>
                <span class='side-title'>Plan the Lisbon offsite</span>
                <span class='side-meta'>offsite</span>
              </span>
              <span class='side-item'>
                <span class='side-title'>Studio landing page</span>
                <span class='side-meta'>studio · +214 −37</span>
              </span>
              <span class='side-item'>
                <span class='side-title'>Fix the byline query</span>
                <span class='side-meta'>newsroom · merged</span>
              </span>
              <span class='side-user'><i></i>You</span>
            </div>
          {{/if}}

          <div class='chat'>
            <div class='chat-head'>
              {{#if this.isGrok}}
                <span class='bot-pill'><i
                    class='bot'
                    style={{botTone '#ff7a1a'}}
                  ></i>Grok Bot</span>
              {{else if this.isBoxel}}
                <img class='ai-mark' src={{assistantIcon}} alt='' />
                <span class='chat-title'>Plan the Lisbon offsite</span>
                <span class='ai-head-tools'>＋ ⋯</span>
              {{else}}
                <span class='chat-title'>Plan the Lisbon offsite</span>
                <span class='chat-folder'>~/offsite</span>
              {{/if}}
            </div>
            <div class='thread'>
              {{#each this.thread as |beat|}}
                {{#if (eq beat.kind 'user')}}
                  <span class='bubble'>
                    {{beat.text}}
                    {{#if beat.attachments}}
                      <span class='attachments'>
                        {{#each beat.attachments as |file|}}
                          <span class='attachment'>{{file}}</span>
                        {{/each}}
                      </span>
                    {{/if}}
                  </span>
                {{else if (eq beat.kind 'agent')}}
                  <span class='reply'>{{beat.text}}</span>
                {{else if (eq beat.kind 'form')}}
                  {{! A card the agent renders in its chat for the user's input. }}
                  <span class='form-card' data-test-agent-screencast-form>
                    <span class='form-head'>
                      <span class='card-type'>{{beat.text}}</span>
                      <span class='form-kind'>Boxel card</span>
                    </span>
                    {{#each this.formFields as |field|}}
                      <span class='form-field'>
                        <span class='form-label'>{{field.label}}</span>
                        <span class='form-input'>{{field.value}}</span>
                      </span>
                    {{/each}}
                    <span class={{cn 'form-send' is-sent=this.formSent}}>
                      {{if this.formSent 'Sent ✓' 'Send'}}
                    </span>
                  </span>
                {{else}}
                  {{! A tool call, the way agent apps print one: the tool, its
                    argument, and the result indented under it. }}
                  <span class='step'>
                    <span class='step-call'>
                      <i class='step-dot'></i>
                      <b class='step-tool'>{{beat.label}}</b>
                      <span class='step-arg'>{{beat.text}}</span>
                      {{#if this.isBoxel}}
                        <span class='step-applied'>Applied</span>
                      {{/if}}
                    </span>
                    {{#if beat.detail}}
                      <span class='step-result'>⎿ {{beat.detail}}</span>
                    {{/if}}
                  </span>
                {{/if}}
              {{/each}}
              {{#if this.working}}
                <span class='working'><i></i><i></i><i></i></span>
              {{/if}}
            </div>
            <div class='composer'>
              {{#if this.isCodex}}
                <span class='context-chip'>@ Context · 1</span>
              {{/if}}
              <span class='composer-line'>
                {{#if this.typing}}
                  <span class='composer-text'>{{this.typing}}</span><i
                    class='caret'
                  ></i>
                {{else}}
                  <span class='composer-hint'>{{this.chrome.hint}}</span>
                {{/if}}
              </span>
              <span class='composer-bar'>
                {{#if this.isGrok}}
                  <span class='grok-mic'><svg
                      viewBox='0 0 24 24'
                      width='12'
                      height='12'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                      stroke-linecap='round'
                    ><rect x='9' y='3' width='6' height='11' rx='3' /><path
                        d='M5 11a7 7 0 0 0 14 0M12 18v3'
                      /></svg></span>
                  <span class='grok-voice'><svg
                      viewBox='0 0 24 24'
                      width='12'
                      height='12'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2.4'
                      stroke-linecap='round'
                    ><path d='M6 10v4M10 7v10M14 5v14M18 9v6' /></svg></span>
                {{else if this.isCodex}}
                  <span class='codex-tool'>＋</span>
                  <span class='codex-tool'><svg
                      viewBox='0 0 24 24'
                      width='11'
                      height='11'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                      stroke-linejoin='round'
                    ><path d={{CODEX_SHIELD}} /></svg></span>
                  <span class='composer-model'>{{this.chrome.model}}
                    <span class='composer-effort'>High</span></span>
                  <span class='codex-tool'><svg
                      viewBox='0 0 24 24'
                      width='11'
                      height='11'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                      stroke-linecap='round'
                    ><rect x='9' y='3' width='6' height='11' rx='3' /><path
                        d='M5 11a7 7 0 0 0 14 0M12 18v3'
                      /></svg></span>
                  <span class='send'>↑</span>
                {{else}}
                  {{#each this.chrome.chips as |chip|}}
                    <span class='composer-chip'>{{chip}}</span>
                  {{/each}}
                  <span class='composer-model'>{{this.chrome.model}}</span>
                  <span class='send'>↑</span>
                {{/if}}
              </span>
            </div>
          </div>
        </div>

        {{! Boxel, open in the agent app's side panel. }}
        <div class='panel'>
          <div class='panel-head'>
            {{#if this.isGrok}}
              {{! Its own browser window, beside Grok Bot. }}
              <span class='traffic'><i></i><i></i><i></i></span>
              <span class='url'><span class='boxel-mark'></span>app.boxel.ai /
                {{this.panelPath}}</span>
            {{else if this.isBoxel}}
              {{! Boxel's top-left: its button, then the mode switcher, open
                in Interact. }}
              <span class='mode-switcher'><span class='boxel-mark'></span>
                <b>Interact</b><span class='mode-caret'>▾</span></span>
            {{else}}
              <span class='boxel-mark'></span>
              <span class='panel-title'>Boxel</span>
              <span class='panel-path'>{{this.panelPath}}</span>
            {{/if}}
          </div>
          {{! In interact mode the open card sits on a stack, the cards it
            was opened from peeking out behind it. }}
          <div class='stack'>
            {{#if this.isBoxel}}
              <i class='stack-behind is-back'></i>
              <i class='stack-behind'></i>
            {{/if}}
            <div class='panel-body' {{fitToTablet}}>
              {{#if this.signedOut}}
                <span class='placeholder'>Not signed in</span>
              {{else if this.emptyWorkspace}}
                <span class='placeholder'>offsite · no cards yet</span>
              {{else if this.showOffsite}}
                {{! The Offsite open isolated: the finished app, not a tile. }}
                <div
                  class={{cn 'app' is-branded=this.isBranded}}
                  data-test-agent-screencast-offsite
                >
                  {{! A map header: the city's street grid, a pin on the hotel. }}
                  <span class='cover'>
                    <i class='cover-river'></i>
                    <i class='cover-pin'></i>
                    <span class='cover-top'>
                      {{#if this.isBranded}}
                        <span class='wordmark'>Fernway</span>
                      {{/if}}
                      <span class='crumb'>Offsites /
                        <b>Lisbon offsite</b></span>
                      {{#if this.updated}}
                        <span class='synced'>Updated</span>
                      {{/if}}
                    </span>
                  </span>
                  <div class='app-head'>
                    <span class='title-row'>
                      <span class='code is-cover'>LIS</span>
                      <span class='title-text'>
                        <span class='title-line'>
                          <b class='app-title'>Lisbon offsite</b>
                          <span class='status tone-amber'>Planning</span>
                        </span>
                        <span class='muted'>Platform team · Owned by Maya Kim</span>
                      </span>
                    </span>
                    <span class='facts' data-test-agent-screencast-budget>
                      <span class='fact'>
                        <span class='muted'>Dates</span>
                        <b>{{if this.showBudget 'May 12–14' '3 days'}}</b>
                      </span>
                      <span class='fact'>
                        <span class='muted'>City</span>
                        <b>Lisbon</b>
                      </span>
                      <span class='fact'>
                        <span class='muted'>People</span>
                        <b>{{if this.showAttendees '24' '—'}}</b>
                      </span>
                      <span class='fact'>
                        <span class='muted'>Budget</span>
                        <b>{{if this.showBudget '€18.4k' '—'}}</b>
                      </span>
                    </span>
                    <span class='tabs'>
                      <span class='tab is-active'>Itinerary</span>
                      <span class='tab'>Budget</span>
                      <span class='tab'>People{{#if this.showAttendees}}
                          <span class='count'>24</span>{{/if}}</span>
                      <span class='tab'>Files{{#if this.showFiles}}
                          <span class='count'>2</span>{{/if}}</span>
                    </span>
                  </div>
                  <div class='app-body'>
                    {{! Days: a list of fields inside the card, each linking a
                      Venue card. }}
                    <section class='itinerary'>
                      {{#each DAYS as |day index|}}
                        <span class='day'>
                          <span class='day-date {{day.tone}}'>
                            <span class='mono'>{{day.dow}}</span>
                            <b>{{day.date}}</b>
                          </span>
                          <span class='day-main'>
                            <span class='day-line'>
                              <b>{{day.plan}}</b>
                              <span class='muted'>{{day.time}}</span>
                            </span>
                            <span class='venue'>
                              <span class='venue-icon {{day.tone}}'><svg
                                  width='11'
                                  height='11'
                                  viewBox='0 0 24 24'
                                  fill='none'
                                  stroke='currentColor'
                                  stroke-width='1.8'
                                  stroke-linecap='round'
                                  stroke-linejoin='round'
                                ><path
                                    d='M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16'
                                  /><path d='M15 10h4a1 1 0 0 1 1 1v10' /><path
                                    d='M8 8h3M8 12h3M8 16h3M3 21h18'
                                  /></svg></span>
                              <b>{{day.venue}}</b>
                              <span class='muted'>{{day.kind}}</span>
                            </span>
                            {{#if (eq index 0)}}
                              {{#if this.showFiles}}
                                <span
                                  class='files'
                                  data-test-agent-screencast-files
                                >
                                  <span class='file'>
                                    <span class='file-type is-pdf'>PDF</span>
                                    <b>contract.pdf</b>
                                  </span>
                                  <span class='file'>
                                    <span class='file-type is-png'>PNG</span>
                                    <b>floor-plan.png</b>
                                  </span>
                                </span>
                              {{/if}}
                            {{/if}}
                          </span>
                        </span>
                      {{/each}}
                    </section>
                    <section class='summary'>
                      <span class='box'>
                        <span class='box-head'>
                          <b>Budget</b>
                          {{#if this.showBudget}}
                            <span class='muted'>€767 pp</span>
                          {{/if}}
                        </span>
                        {{#if this.showBudget}}
                          <b class='total'>€18,400</b>
                          <span class='bar'>
                            {{#each BUDGET as |line|}}
                              <i class={{line.shade}} style={{line.width}}></i>
                            {{/each}}
                          </span>
                        {{else}}
                          <span class='muted'>Needs headcount and dates</span>
                        {{/if}}
                      </span>
                      <span class='box'>
                        <span class='box-head'>
                          <b>Attendees</b>
                          {{#if this.showAttendees}}
                            <span class='muted'>Linked</span>
                          {{/if}}
                        </span>
                        {{#if this.showAttendees}}
                          <span
                            class='avatars'
                            data-test-agent-screencast-attendees
                          >
                            {{#each ATTENDEES as |person|}}
                              <i class={{person.tone}}>{{person.initials}}</i>
                            {{/each}}
                            <i class='more'>+20</i>
                          </span>
                        {{else}}
                          <span class='muted'>No one invited yet</span>
                        {{/if}}
                      </span>
                    </section>
                  </div>
                </div>
              {{else if this.showBoard}}
                {{! The board app: a live query over every Offsite, grouped by
                  status, as a list that fits any width. }}
                <div
                  class={{cn 'app is-board' is-branded=this.isBranded}}
                  data-test-agent-screencast-board
                >
                  <span class='board-head'>
                    <span class='board-title'>
                      <b class='app-title'>Offsites</b>
                      <span class='muted'><i class='dot is-live'></i>Live query
                        ·
                        <span class='mono'>type = Offsite</span></span>
                    </span>
                    {{#if this.updated}}
                      <span class='synced'>Updated</span>
                    {{/if}}
                  </span>
                  {{#each BOARD as |column|}}
                    <span class='group'>
                      <span class='group-head'>
                        <i class='dot {{column.dot}}'></i>
                        {{column.status}}
                        <span class='muted'>{{column.offsites.length}}</span>
                      </span>
                      {{#each column.offsites as |offsite|}}
                        <span class={{cn 'row' is-new=offsite.isNew}}>
                          <span
                            class='code {{offsite.tone}}'
                          >{{offsite.code}}</span>
                          <span class='row-name'>
                            <b>{{offsite.name}}</b>
                            <span class='muted'>{{offsite.meta}}</span>
                          </span>
                          <span class='row-figures'>
                            <b>{{offsite.budget}}</b>
                            <span class='muted'>{{offsite.people}} people</span>
                          </span>
                          <span class='track'><i
                              style={{offsite.done}}
                            ></i></span>
                        </span>
                      {{/each}}
                    </span>
                  {{/each}}
                </div>
              {{/if}}
            </div>
          </div>
        </div>
      </div>
      <figcaption class='controls'>
        <button
          type='button'
          class='play'
          aria-label={{if this.playing 'Pause' 'Play'}}
          {{on 'click' this.togglePlay}}
          data-test-agent-screencast-play
        >{{if this.playing '❚❚' '▶'}}</button>
        <span class='chapters' role='group' aria-label='Chapters'>
          {{#each this.chapters as |chapter|}}
            <button
              type='button'
              class={{cn 'chapter'}}
              aria-pressed={{if (eq this.chapter chapter.id) 'true' 'false'}}
              {{on 'click' (fn this.jumpTo chapter.id)}}
            >{{chapter.label}}</button>
          {{/each}}
        </span>
      </figcaption>
    </figure>

    <style scoped>
      .screencast {
        /* The agent app's own neutral grays; Boxel's colors stay in its
           pane. */
        --app-bg: color-mix(in oklch, var(--boxel-light) 9%, black);
        --app-side: color-mix(in oklch, var(--boxel-light) 6%, black);
        --app-ok: var(--boxel-green);
        --app-line: color-mix(in oklch, var(--boxel-light) 10%, transparent);
        --app-muted: color-mix(in oklch, var(--boxel-light) 50%, transparent);
        --app-ink: var(--boxel-light);
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .window {
        display: grid;
        grid-template-columns: 8.5rem minmax(0, 1.1fr) minmax(0, 1.2fr);
        /* A fixed height: the thread scrolls inside it, so the window
           never resizes from scene to scene. */
        height: 27rem;
        grid-template-rows: minmax(0, 1fr);
        overflow: hidden;
        border: 1px solid var(--app-line);
        border-radius: 1rem;
        background-color: var(--app-bg);
        color: var(--app-ink);
        font-size: 0.75rem;
        box-shadow: 0 1rem 2.5rem
          color-mix(in oklch, var(--boxel-dark) 45%, transparent);
      }

      /* The agent app's sidebar: neutral, the way desktop agent apps are. */
      .sidebar {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-height: 0;
        padding: var(--boxel-sp-xs);
        border-right: 1px solid var(--app-line);
        background-color: var(--app-side);
      }
      .traffic {
        display: flex;
        gap: 0.25rem;
        margin-bottom: var(--boxel-sp-xs);
      }
      .traffic i {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        background-color: color-mix(in oklch, var(--app-ink) 22%, transparent);
      }
      .new-session {
        margin-bottom: var(--boxel-sp-xs);
        padding: 0.3rem 0.375rem;
        border-radius: 0.375rem;
        color: var(--app-ink);
        font-weight: 500;
      }
      .side-label {
        padding: 0 0.375rem 0.125rem;
        font-size: 0.625rem;
        color: var(--app-muted);
      }
      .side-item {
        display: flex;
        flex-direction: column;
        gap: 0.0625rem;
        padding: 0.3rem 0.375rem;
        border-radius: 0.375rem;
        color: var(--app-muted);
      }
      .side-item.is-active {
        background-color: color-mix(in oklch, var(--app-ink) 8%, transparent);
        color: var(--app-ink);
      }
      .side-title,
      .side-meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .side-meta {
        font-size: 0.5625rem;
        color: var(--app-muted);
      }
      .side-user {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        margin-top: auto;
        padding: 0.3rem 0.375rem;
        color: var(--app-muted);
      }
      .side-user i {
        width: 1rem;
        height: 1rem;
        border-radius: 50%;
        background-color: color-mix(in oklch, var(--app-ink) 25%, transparent);
      }

      /* The chat: the thread, then the composer. */
      .chat {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      }
      .chat-head {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--app-line);
        white-space: nowrap;
      }
      .chat-title {
        overflow: hidden;
        font-weight: 600;
        text-overflow: ellipsis;
      }
      .chat-folder {
        font-family: var(--boxel-monospace-font-family);
        font-size: 0.625rem;
        color: var(--app-muted);
      }
      /* New steps push old ones up, the way a chat scrolls. Size
         containment keeps the thread from growing the window: it fills the
         height the row gives and clips its oldest messages. */
      .thread {
        flex: 1;
        contain: size;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 0.5rem;
        min-height: 0;
        overflow: hidden;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .bubble {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        align-self: flex-end;
        max-width: 85%;
        padding: 0.375rem 0.625rem;
        border-radius: 0.625rem;
        background-color: color-mix(in oklch, var(--app-ink) 10%, transparent);
        animation: arrive 0.3s ease-out;
      }
      .attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }
      .attachment {
        padding: 0.1rem 0.375rem;
        border: 1px solid var(--app-line);
        border-radius: 0.375rem;
        font-size: 0.625rem;
        color: var(--app-muted);
      }
      .reply {
        line-height: 1.45;
        animation: arrive 0.3s ease-out;
      }
      /* A tool call: dot, tool name, argument; the result under it. */
      .step {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
        animation: arrive 0.3s ease-out;
      }
      .step-call {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        min-width: 0;
        white-space: nowrap;
      }
      .step-dot {
        flex: none;
        width: 0.375rem;
        height: 0.375rem;
        border-radius: 50%;
        background-color: var(--app-ok);
      }
      .step-tool {
        flex: none;
        font-weight: 600;
      }
      .step-arg {
        overflow: hidden;
        font-family: var(--boxel-monospace-font-family);
        font-size: 0.6875rem;
        color: var(--app-muted);
        text-overflow: ellipsis;
      }
      .step-result {
        overflow: hidden;
        padding-left: 0.75rem;
        font-size: 0.6875rem;
        color: var(--app-muted);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .working {
        display: flex;
        gap: 0.2rem;
        padding: 0.25rem 0;
      }
      .working i {
        width: 0.3rem;
        height: 0.3rem;
        border-radius: 50%;
        background-color: var(--app-muted);
        animation: pulse 1s ease-in-out infinite;
      }
      .working i:nth-child(2) {
        animation-delay: 0.15s;
      }
      .working i:nth-child(3) {
        animation-delay: 0.3s;
      }
      .composer {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        margin: 0 var(--boxel-sp-xs) var(--boxel-sp-xs);
        padding: 0.5rem 0.5rem 0.375rem 0.625rem;
        border: 1px solid var(--app-line);
        border-radius: 0.75rem;
        background-color: color-mix(in oklch, var(--app-ink) 5%, transparent);
      }
      .composer-line {
        display: flex;
        align-items: center;
        min-height: 1rem;
      }
      .composer-text {
        overflow: hidden;
        white-space: nowrap;
      }
      .composer-hint {
        color: var(--app-muted);
      }
      .caret {
        flex: none;
        width: 1px;
        height: 1em;
        background-color: var(--app-ink);
        animation: blink 1s steps(1) infinite;
      }
      .composer-bar {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        color: var(--app-muted);
        font-size: 0.625rem;
      }
      .composer-chip {
        padding: 0.05rem 0.375rem;
        border: 1px solid var(--app-line);
        border-radius: 0.5rem;
      }
      .composer-model {
        margin-left: auto;
      }
      .send {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 50%;
        background-color: var(--app-ink);
        color: var(--boxel-dark);
        font-weight: 700;
      }

      /* Boxel in the side panel. */
      .panel {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        border-left: 1px solid var(--app-line);
        background-color: var(--boxel-700);
      }
      .panel-head {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--app-line);
        white-space: nowrap;
      }
      .boxel-mark {
        flex: none;
        width: 0.875rem;
        height: 0.875rem;
        border-radius: 0.25rem;
        background-color: var(--boxel-highlight);
      }
      .panel-title {
        font-weight: 700;
      }
      .panel-path {
        overflow: hidden;
        color: var(--app-muted);
        text-overflow: ellipsis;
      }
      .stack {
        position: relative;
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .panel-body {
        /* Replaced at runtime with the pane's width over the tablet's. */
        --app-scale: 0.6;
        position: relative;
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 0;
        overflow: hidden;
      }
      /* A card open isolated, the way Boxel shows a finished app: quiet
         and dense, like a real product screen, one column so it holds up
         in a narrow pane. It is laid out at its natural size, then shrunk
         whole (see fitToTablet), so the side panel reads as a real tablet
         app at a smaller zoom. */
      .app {
        --ink: var(--boxel-dark);
        --muted: color-mix(in oklch, var(--boxel-dark) 58%, white);
        --hair: color-mix(in oklch, var(--boxel-dark) 11%, white);
        --wash: color-mix(in oklch, var(--boxel-dark) 3%, white);
        position: absolute;
        top: 0;
        left: 0;
        display: flex;
        flex-direction: column;
        /* APP_WIDTH_PX: the tablet width fitToTablet scales from. */
        width: 400px;
        height: calc(100% / var(--app-scale));
        overflow: hidden;
        background-color: white;
        color: var(--ink);
        font-size: 0.6875rem;
        line-height: 1.4;
        font-variant-numeric: tabular-nums;
        transform: scale(var(--app-scale));
        transform-origin: top left;
        animation: arrive 0.4s ease-out;
      }
      .card-type {
        font-family: var(--boxel-monospace-font-family);
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--boxel-dark) 55%, transparent);
      }
      .synced {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.1rem 0.45rem;
        border-radius: 1rem;
        background-color: white;
        box-shadow: 0 0 0 1px var(--hair);
        font-size: 0.5625rem;
        font-weight: 500;
        color: var(--ink);
        animation: arrive 0.5s ease-out;
      }
      .synced::before {
        content: '';
        width: 0.375rem;
        height: 0.375rem;
        border-radius: 50%;
        background-color: var(--boxel-highlight);
      }
      .muted {
        color: var(--muted);
      }
      .mono {
        font-family: var(--boxel-monospace-font-family);
        font-size: 0.5rem;
        letter-spacing: 0.04em;
      }

      /* Four muted tones: a soft tint with its own color for text. */
      .tone-indigo {
        --tone: var(--boxel-blue);
      }
      .tone-teal {
        --tone: var(--boxel-dark-teal);
      }
      .tone-amber {
        --tone: var(--boxel-orange);
      }
      .tone-rose {
        --tone: var(--boxel-red);
      }
      .dot {
        display: inline-block;
        flex: none;
        width: 0.375rem;
        height: 0.375rem;
        margin-right: 0.3rem;
        border-radius: 50%;
        vertical-align: middle;
      }
      .dot.is-planning {
        background-color: var(--boxel-orange);
      }
      .dot.is-booked {
        background-color: var(--boxel-blue);
      }
      .dot.is-done {
        background-color: var(--muted);
      }
      .dot.is-live {
        background-color: var(--boxel-highlight);
      }
      .code {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 0.4rem;
        background-color: color-mix(
          in oklch,
          var(--tone, var(--ink)) 12%,
          white
        );
        color: color-mix(in oklch, var(--tone, var(--ink)) 80%, var(--ink));
        font-family: var(--boxel-monospace-font-family);
        font-size: 0.5625rem;
        font-weight: 600;
      }
      .app-title {
        font-size: 1rem;
        font-weight: 600;
        letter-spacing: -0.01em;
      }

      /* The map header: a street grid, the river, a pin. */
      .cover {
        position: relative;
        flex: none;
        height: 3.75rem;
        overflow: hidden;
        background:
          linear-gradient(
              color-mix(in oklch, var(--boxel-blue) 10%, white) 1px,
              transparent 1px
            )
            0 0 / 0.875rem 0.875rem,
          linear-gradient(
              90deg,
              color-mix(in oklch, var(--boxel-blue) 10%, white) 1px,
              transparent 1px
            )
            0 0 / 0.875rem 0.875rem,
          color-mix(in oklch, var(--boxel-blue) 4%, white);
      }
      .cover-river {
        position: absolute;
        left: -5%;
        right: -5%;
        bottom: -1.5rem;
        height: 2.75rem;
        border-radius: 50%;
        background-color: color-mix(in oklch, var(--boxel-blue) 18%, white);
        transform: rotate(-4deg);
      }
      .cover-pin {
        position: absolute;
        right: 28%;
        top: 1.4rem;
        width: 0.625rem;
        height: 0.625rem;
        border: 2px solid white;
        border-radius: 50%;
        background-color: var(--boxel-blue);
        box-shadow: 0 0 0 0.3rem
          color-mix(in oklch, var(--boxel-blue) 20%, transparent);
      }
      .cover-top {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 1.25rem;
      }
      .crumb {
        font-size: 0.5625rem;
        color: var(--muted);
      }
      .crumb b {
        font-weight: 500;
        color: var(--ink);
      }

      /* Positioned so the title row, pulled up over the map, paints on
         top of it. */
      .app-head {
        position: relative;
        flex: none;
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
        padding: 0 1.25rem;
      }
      .title-row {
        display: flex;
        align-items: flex-end;
        gap: 0.625rem;
        margin-top: -1.125rem;
      }
      .code.is-cover {
        width: 2.5rem;
        height: 2.5rem;
        border: 3px solid white;
        border-radius: 0.625rem;
        background-color: var(--ink);
        color: white;
        font-size: 0.625rem;
      }
      .title-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        font-size: 0.625rem;
      }
      .title-line {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .status {
        flex: none;
        padding: 0.05rem 0.4rem;
        border-radius: 1rem;
        background-color: color-mix(in oklch, var(--tone) 14%, white);
        color: color-mix(in oklch, var(--tone) 75%, var(--ink));
        font-size: 0.5625rem;
        font-weight: 600;
      }
      .facts {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        border: 1px solid var(--hair);
        border-radius: 0.5rem;
      }
      .fact {
        display: flex;
        flex-direction: column;
        min-width: 0;
        padding: 0.35rem 0.5rem;
        font-size: 0.5625rem;
      }
      .fact + .fact {
        border-left: 1px solid var(--hair);
      }
      .fact b {
        overflow: hidden;
        font-size: 0.6875rem;
        font-weight: 500;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tabs {
        display: flex;
        gap: 0.875rem;
        border-bottom: 1px solid var(--hair);
      }
      .tab {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-bottom: -1px;
        padding: 0.3rem 0 0.4rem;
        border-bottom: 1.5px solid transparent;
        color: var(--muted);
        font-size: 0.625rem;
      }
      .tab.is-active {
        border-bottom-color: var(--ink);
        color: var(--ink);
        font-weight: 500;
      }
      .count {
        color: color-mix(in oklch, var(--boxel-dark) 40%, white);
        animation: arrive 0.5s ease-out;
      }

      .app-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
        min-height: 0;
        padding: 0.25rem 1.25rem 1rem;
      }
      /* The itinerary: one row per day, a tinted date block, hairlines. */
      .itinerary {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .day {
        display: grid;
        grid-template-columns: 2rem minmax(0, 1fr);
        gap: 0.625rem;
        padding: 0.5rem 0;
      }
      .day + .day {
        border-top: 1px solid var(--hair);
      }
      .day-date {
        display: flex;
        flex-direction: column;
        align-items: center;
        align-self: start;
        padding: 0.2rem 0;
        border-radius: 0.375rem;
        background-color: color-mix(in oklch, var(--tone) 10%, white);
        color: color-mix(in oklch, var(--tone) 80%, var(--ink));
      }
      .day-date b {
        font-size: 0.8125rem;
        font-weight: 600;
        line-height: 1.1;
      }
      .day-main {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        min-width: 0;
      }
      /* The plan, with its time under it, each on one line, so a long
         plan never loses its words to the time. */
      .day-line {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .day-line > * {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .day-line b {
        font-weight: 600;
      }
      .day-line .muted {
        font-size: 0.5625rem;
      }
      /* The linked Venue card, embedded on one line. */
      .venue {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        min-width: 0;
        padding: 0.25rem 0.375rem;
        border: 1px solid var(--hair);
        border-radius: 0.375rem;
        font-size: 0.625rem;
        white-space: nowrap;
      }
      .venue b {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        font-weight: 500;
        text-overflow: ellipsis;
      }
      .venue .muted {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .venue-icon {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.125rem;
        height: 1.125rem;
        border-radius: 0.25rem;
        background-color: color-mix(in oklch, var(--tone) 12%, white);
        color: color-mix(in oklch, var(--tone) 80%, var(--ink));
      }
      .files {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
        animation: arrive 0.5s ease-out;
      }
      /* A file chip stays on one line: its type, its name, its size. */
      .file {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-width: 0;
        max-width: 100%;
        padding: 0.2rem 0.4rem 0.2rem 0.2rem;
        border: 1px solid var(--hair);
        border-radius: 0.375rem;
        font-size: 0.5625rem;
        white-space: nowrap;
      }
      .file > * {
        flex: none;
      }
      .file b {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        font-weight: 500;
        text-overflow: ellipsis;
      }
      .file-type {
        padding: 0.05rem 0.25rem;
        border-radius: 0.2rem;
        font-family: var(--boxel-monospace-font-family);
        font-size: 0.4375rem;
        font-weight: 600;
      }
      .file-type.is-pdf {
        background-color: color-mix(in oklch, var(--boxel-red) 14%, white);
        color: color-mix(in oklch, var(--boxel-red) 80%, var(--ink));
      }
      .file-type.is-png {
        background-color: color-mix(in oklch, var(--boxel-blue) 14%, white);
        color: color-mix(in oklch, var(--boxel-blue) 80%, var(--ink));
      }

      /* Budget and attendees, side by side under the itinerary. */
      .summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.5rem;
      }
      .box {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        min-width: 0;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--hair);
        border-radius: 0.5rem;
        font-size: 0.5625rem;
      }
      .box-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.375rem;
        min-width: 0;
        white-space: nowrap;
      }
      .box-head > .muted {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .box-head b {
        font-size: 0.625rem;
        font-weight: 600;
      }
      .total {
        font-size: 0.9375rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        animation: arrive 0.5s ease-out;
      }
      .bar {
        display: flex;
        gap: 2px;
        height: 0.3rem;
        overflow: hidden;
        border-radius: 0.2rem;
      }
      .bar i {
        background-color: var(--tone);
      }
      .avatars {
        display: flex;
        animation: arrive 0.5s ease-out;
      }
      .avatars i {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        margin-left: -0.3rem;
        border: 2px solid white;
        border-radius: 50%;
        background-color: color-mix(
          in oklch,
          var(--tone, var(--ink)) 16%,
          white
        );
        color: color-mix(in oklch, var(--tone, var(--ink)) 80%, var(--ink));
        font-size: 0.4375rem;
        font-style: normal;
        font-weight: 600;
      }
      .avatars i:first-child {
        margin-left: 0;
      }
      .avatars i.more {
        background-color: var(--ink);
        color: white;
      }

      /* The board app: every Offsite from a live query, grouped by status. */
      .app.is-board {
        gap: 0.75rem;
        padding: 1rem 1.25rem 1.25rem;
        background-color: var(--wash);
      }
      .board-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
      }
      .board-title {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        font-size: 0.5625rem;
      }
      .group {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .group-head {
        display: flex;
        align-items: center;
        gap: 0.2rem;
        font-size: 0.5625rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      /* An Offsite in the board's embedded format: one row. */
      .row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        grid-template-areas: 'code name figures' 'track track track';
        align-items: center;
        gap: 0.5rem 0.625rem;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--hair);
        border-radius: 0.5rem;
        background-color: white;
      }
      .row.is-new {
        border-color: color-mix(in oklch, var(--boxel-highlight) 70%, white);
        box-shadow: 0 0 0 3px
          color-mix(in oklch, var(--boxel-highlight) 22%, transparent);
        animation: arrive 0.5s ease-out;
      }
      .row .code {
        grid-area: code;
      }
      .row-name {
        grid-area: name;
        display: flex;
        flex-direction: column;
        min-width: 0;
        font-size: 0.5625rem;
        white-space: nowrap;
      }
      .row-name b {
        font-size: 0.6875rem;
        font-weight: 600;
      }
      .row-name .muted {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .row-figures {
        grid-area: figures;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        font-size: 0.5625rem;
        white-space: nowrap;
      }
      .row-figures b {
        font-size: 0.6875rem;
        font-weight: 500;
      }
      .track {
        grid-area: track;
        height: 0.2rem;
        overflow: hidden;
        border-radius: 0.1rem;
        background-color: var(--hair);
      }
      .track i {
        display: block;
        height: 100%;
        background-color: var(--ink);
      }

      /* On brand: a made-up company's guide, applied as the card's theme.
         Fernway's forest ink, coral accent, warm paper and serif display
         replace the default tokens across both apps. */
      .app.is-branded {
        --ink: #17382c;
        --muted: color-mix(in oklch, #17382c 60%, #fbf8f3);
        --hair: color-mix(in oklch, #17382c 13%, #fbf8f3);
        --wash: color-mix(in oklch, #17382c 4%, #fbf8f3);
        --brand-accent: #e0603a;
        background-color: #fbf8f3;
        animation: arrive 0.5s ease-out;
      }
      .app.is-board.is-branded {
        background-color: color-mix(in oklch, #17382c 5%, #fbf8f3);
      }
      .is-branded .app-title,
      .is-branded .total,
      .is-branded .day-date b {
        font-family: Georgia, 'Times New Roman', serif;
        font-weight: 600;
        letter-spacing: 0;
      }
      .is-branded .app-title {
        font-size: 1.125rem;
      }
      .is-branded .cover {
        background:
          linear-gradient(
              color-mix(in oklch, #17382c 9%, #fbf8f3) 1px,
              transparent 1px
            )
            0 0 / 0.875rem 0.875rem,
          linear-gradient(
              90deg,
              color-mix(in oklch, #17382c 9%, #fbf8f3) 1px,
              transparent 1px
            )
            0 0 / 0.875rem 0.875rem,
          color-mix(in oklch, #17382c 6%, #fbf8f3);
      }
      .is-branded .cover-river {
        background-color: color-mix(in oklch, #17382c 16%, #fbf8f3);
      }
      .is-branded .cover-pin {
        background-color: var(--brand-accent);
        box-shadow: 0 0 0 0.3rem
          color-mix(in oklch, var(--brand-accent) 22%, transparent);
      }
      .wordmark {
        margin-right: auto;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--ink);
        animation: arrive 0.5s ease-out;
      }
      .wordmark + .crumb {
        margin-right: 0.625rem;
      }
      .is-branded .code.is-cover {
        background-color: var(--ink);
        border-color: #fbf8f3;
      }
      .is-branded .status,
      .is-branded .tone-amber,
      .is-branded .tone-indigo,
      .is-branded .tone-teal,
      .is-branded .tone-rose {
        --tone: var(--ink);
      }
      .is-branded .status {
        background-color: var(--brand-accent);
        color: white;
      }
      .is-branded .tone-amber,
      .is-branded .bar i.tone-indigo {
        --tone: var(--brand-accent);
      }
      .is-branded .tab.is-active {
        border-bottom-color: var(--brand-accent);
      }
      .is-branded .facts,
      .is-branded .box,
      .is-branded .venue,
      .is-branded .file,
      .is-branded .row {
        background-color: white;
      }
      .is-branded .track i,
      .is-branded .avatars i.more {
        background-color: var(--brand-accent);
      }
      .is-branded .row.is-new {
        border-color: var(--brand-accent);
        box-shadow: 0 0 0 3px
          color-mix(in oklch, var(--brand-accent) 20%, transparent);
      }

      /* Claude Code and Codex: one window, the agent app's two columns then
         Boxel's panel. */
      .agent-app {
        display: contents;
      }

      /* Grok Bot: a light messaging app in its own window, and Boxel in a
         browser window beside it, since Grok Bot has no browser inside. */
      .window.is-grok {
        --grok-ink: #1d1d1f;
        --grok-muted: #86868b;
        --grok-line: rgba(0, 0, 0, 0.08);
        grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
        gap: var(--boxel-sp-sm);
        overflow: visible;
        border: 0;
        border-radius: 0;
        background: none;
        box-shadow: none;
      }
      .window.is-grok .agent-app,
      .window.is-grok .panel {
        min-height: 0;
        overflow: hidden;
        border-radius: 1rem;
        box-shadow: 0 1rem 2.5rem
          color-mix(in oklch, var(--boxel-dark) 45%, transparent);
      }
      .window.is-grok .agent-app {
        display: grid;
        grid-template-columns: 3.25rem minmax(0, 1fr);
        border: 1px solid var(--grok-line);
        background-color: #fbfbfb;
        color: var(--grok-ink);
      }
      .window.is-grok .traffic i:nth-child(1) {
        background-color: #ff5f57;
      }
      .window.is-grok .traffic i:nth-child(2) {
        background-color: #febc2e;
      }
      .window.is-grok .traffic i:nth-child(3) {
        background-color: #28c840;
      }
      .sidebar.is-bots {
        align-items: center;
        gap: 0.5rem;
        padding: var(--boxel-sp-xs) 0.25rem;
        border-right: 1px solid var(--grok-line);
        background-color: #f3f3f4;
      }
      .bot-slot {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.625rem;
      }
      .bot-slot.is-active {
        background-color: #e5e5e7;
      }
      /* A bot: a soft blob with two eyes. */
      .bot {
        position: relative;
        display: inline-block;
        flex: none;
        width: 1.5rem;
        height: 1.125rem;
        border-radius: 55% 45% 50% 50% / 60% 55% 45% 40%;
        background-color: var(--bot-tone);
      }
      .bot::before,
      .bot::after {
        content: '';
        position: absolute;
        top: 30%;
        width: 0.125rem;
        height: 0.3rem;
        border-radius: 0.1rem;
        background-color: white;
        transform: rotate(-12deg);
      }
      .bot::before {
        left: 40%;
      }
      .bot::after {
        left: 58%;
      }
      .bot-add {
        margin-top: auto;
        color: var(--grok-muted);
      }
      .window.is-grok .chat-head {
        border-bottom: 0;
      }
      .bot-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem 0.625rem 0.25rem 0.375rem;
        border-radius: 1rem;
        background-color: white;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
        font-weight: 600;
      }
      .bot-pill .bot {
        width: 1rem;
        height: 0.75rem;
      }
      .window.is-grok .bubble {
        background-color: color-mix(in oklch, #ff7a1a 14%, white);
      }
      .window.is-grok .reply {
        align-self: flex-start;
        max-width: 92%;
        padding: 0.4rem 0.625rem;
        border-radius: 0.875rem;
        background-color: #ececee;
      }
      .window.is-grok .attachment {
        border-color: var(--grok-line);
        color: var(--grok-muted);
      }
      /* Grok Bot's tool use reads as quiet status lines. */
      .window.is-grok .step-dot {
        display: none;
      }
      .window.is-grok .step-tool,
      .window.is-grok .step-result {
        font-weight: 500;
        color: var(--grok-muted);
      }
      .window.is-grok .step-arg {
        color: var(--grok-ink);
      }
      .window.is-grok .form-card {
        box-shadow: 0 0 0 1px var(--grok-line);
      }
      .window.is-grok .working i {
        background-color: var(--grok-muted);
      }
      .window.is-grok .composer {
        flex-direction: row;
        align-items: center;
        padding: 0.25rem 0.25rem 0.25rem 0.75rem;
        border-color: var(--grok-line);
        border-radius: 1.25rem;
        background-color: white;
      }
      .window.is-grok .composer-line {
        flex: 1;
        min-width: 0;
      }
      .window.is-grok .composer-hint {
        overflow: hidden;
        color: var(--grok-muted);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .window.is-grok .caret {
        background-color: var(--grok-ink);
      }
      .grok-mic,
      .grok-voice {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
      }
      .grok-mic {
        background-color: #f0f0f2;
        color: var(--grok-ink);
      }
      .grok-voice {
        background-color: #ff6a00;
        color: white;
      }
      /* Boxel's own browser window: traffic lights and its address. */
      .window.is-grok .panel {
        border: 1px solid var(--app-line);
      }
      .window.is-grok .panel-head {
        gap: 0.5rem;
      }
      .window.is-grok .panel-head .traffic {
        margin-bottom: 0;
      }
      .url {
        flex: 1;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        min-width: 0;
        overflow: hidden;
        padding: 0.15rem 0.5rem;
        border-radius: 0.4rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 8%,
          transparent
        );
        color: var(--app-muted);
        font-size: 0.625rem;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .url .boxel-mark {
        width: 0.625rem;
        height: 0.625rem;
      }

      /* Codex dresses its steps as plain lines: no dot, a muted verb. */
      .window.is-codex .step-dot {
        display: none;
      }
      .window.is-codex .step-tool {
        font-weight: 500;
        color: var(--app-muted);
      }
      .window.is-codex .step-arg {
        color: var(--app-ink);
      }
      .window.is-codex .step-result {
        padding-left: 0;
      }
      /* Claude and Codex in their light themes, each in its own shape:
         Claude soft and round on warm paper, Codex crisp on white. */
      .window.is-claude,
      .window.is-codex {
        --app-ink: #1f1e1d;
        --app-line: rgba(0, 0, 0, 0.09);
        --app-muted: rgba(0, 0, 0, 0.5);
        --app-ok: #2f9e6b;
        box-shadow: 0 1rem 2.5rem
          color-mix(in oklch, var(--boxel-dark) 35%, transparent);
      }
      .window.is-claude {
        --app-bg: #faf9f5;
        --app-side: #f0eee6;
        --app-panel: #f4f2ec;
        /* Two concentric radii: containers, and what sits inside them. */
        --claude-round: 0.75rem;
        --claude-round-inner: 0.5rem;
        border-radius: 1rem;
      }
      .window.is-codex {
        --app-ink: #0d0d0d;
        --app-bg: #ffffff;
        --app-side: #f7f7f8;
        --app-panel: #f5f5f6;
        grid-template-columns: 2.75rem minmax(0, 1.1fr) minmax(0, 1.2fr);
        border-radius: 0.625rem;
      }
      .window.is-claude .traffic i,
      .window.is-codex .traffic i {
        background-color: rgba(0, 0, 0, 0.14);
      }
      .window.is-claude .send,
      .window.is-codex .send {
        color: white;
      }
      .window.is-claude .form-card,
      .window.is-codex .form-card {
        background-color: white;
        box-shadow: 0 0 0 1px var(--app-line);
      }
      .window.is-claude .panel,
      .window.is-codex .panel {
        background-color: var(--app-panel);
      }
      .window.is-claude .panel-head,
      .window.is-codex .panel-head {
        background-color: var(--app-bg);
      }

      /* Claude: rounded bubbles and composer, its serif voice in replies,
         and a clay send button. */
      .window.is-claude .bubble {
        border-radius: var(--claude-round);
        background-color: #ebe8de;
      }
      .window.is-claude .reply {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 0.8125rem;
      }
      .window.is-claude .composer {
        border-radius: var(--claude-round);
        background-color: white;
        box-shadow: 0 0.125rem 0.5rem rgba(0, 0, 0, 0.05);
      }
      .window.is-claude .composer-chip,
      .window.is-claude .attachment,
      .window.is-claude .side-item,
      .window.is-claude .form-input,
      .window.is-claude .form-send {
        border-radius: var(--claude-round-inner);
      }
      .window.is-claude .form-card {
        border-radius: var(--claude-round);
      }
      .window.is-claude .send {
        border-radius: var(--claude-round-inner);
        background-color: #c96442;
      }
      .window.is-claude .side-item.is-active {
        background-color: #e4e1d6;
      }

      /* Codex: a rail of icons, tight radii, and a pill composer with a
         context chip and a round black send. */
      .sidebar.is-rail {
        align-items: center;
        gap: 0.3rem;
        padding: var(--boxel-sp-xs) 0;
      }
      .sidebar.is-rail .traffic {
        gap: 0.1875rem;
        margin-bottom: 0.375rem;
      }
      .sidebar.is-rail .traffic i {
        width: 0.375rem;
        height: 0.375rem;
      }
      .rail-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 0.375rem;
        color: var(--app-muted);
      }
      .rail-icon.is-active {
        background-color: rgba(0, 0, 0, 0.07);
        color: var(--app-ink);
      }
      .rail-divider {
        width: 1.25rem;
        height: 1px;
        margin: 0.125rem 0;
        background-color: var(--app-line);
      }
      .rail-avatar {
        width: 1.375rem;
        height: 1.375rem;
        margin-top: auto;
        border-radius: 50%;
        background-color: #f97316;
      }
      .window.is-codex .bubble {
        border-radius: 0.5rem;
        background-color: #f0f0f1;
      }
      .window.is-codex .composer {
        gap: 0.25rem;
        padding: 0.375rem 0.375rem 0.375rem 0.75rem;
        border-radius: 1.25rem;
        box-shadow: 0 0.0625rem 0.25rem rgba(0, 0, 0, 0.06);
        background-color: white;
      }
      .context-chip {
        align-self: flex-start;
        padding: 0.05rem 0.375rem;
        border: 1px solid var(--app-line);
        border-radius: 0.375rem;
        color: var(--app-muted);
        font-size: 0.5625rem;
      }
      .codex-tool {
        display: inline-flex;
        align-items: center;
        color: var(--app-muted);
      }
      .composer-effort {
        color: var(--app-muted);
        opacity: 0.7;
      }
      .window.is-codex .composer-model {
        color: var(--app-ink);
        font-weight: 500;
      }

      /* Boxel AI Assistant: Boxel itself, in interact mode, with the open
         card on its stack at the left and the assistant docked at the
         right. */
      .window.is-boxel {
        --app-ink: var(--boxel-light);
        --app-line: color-mix(in oklch, var(--boxel-light) 12%, transparent);
        --app-muted: color-mix(in oklch, var(--boxel-light) 58%, transparent);
        grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
        gap: 0.375rem;
        padding: 0.375rem;
        border-radius: 0.75rem;
        background-color: var(--boxel-700);
      }
      .window.is-boxel .panel {
        order: -1;
        border-left: 0;
        background: none;
      }
      .window.is-boxel .panel-head {
        gap: 0.5rem;
        padding: 0.125rem 0.125rem 0.375rem;
        border-bottom: 0;
      }
      .mode-switcher {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.2rem 0.5rem 0.2rem 0.25rem;
        border-radius: 0.5rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 9%,
          transparent
        );
      }
      .mode-switcher b {
        font-weight: 600;
      }
      .mode-caret {
        color: var(--app-muted);
        font-size: 0.5625rem;
      }
      /* The stack: the cards the open one came from peek out above it. */
      .window.is-boxel .stack {
        padding-top: 0.75rem;
      }
      .stack-behind {
        position: absolute;
        top: 0.375rem;
        left: 0.625rem;
        right: 0.625rem;
        height: 1rem;
        border-radius: 0.5rem 0.5rem 0 0;
        background-color: color-mix(in oklch, white 78%, var(--boxel-700));
      }
      .stack-behind.is-back {
        top: 0;
        left: 1.25rem;
        right: 1.25rem;
        background-color: color-mix(in oklch, white 50%, var(--boxel-700));
      }
      .window.is-boxel .panel-body {
        overflow: hidden;
        border-radius: 0.5rem;
        background-color: white;
        box-shadow: 0 0.25rem 1rem color-mix(in oklch, black 35%, transparent);
      }
      .window.is-boxel .placeholder {
        color: color-mix(in oklch, var(--boxel-dark) 50%, transparent);
      }
      /* The assistant panel, docked. */
      .window.is-boxel .chat {
        overflow: hidden;
        border-radius: 0.625rem;
        background-color: var(--boxel-ai-purple);
      }
      .window.is-boxel .chat-head {
        align-items: center;
      }
      .ai-mark {
        flex: none;
        width: 1rem;
        height: 1rem;
      }
      .ai-head-tools {
        margin-left: auto;
        color: var(--app-muted);
      }
      .window.is-boxel .bubble {
        border-radius: 0.5rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 14%,
          transparent
        );
      }
      .window.is-boxel .reply {
        align-self: flex-start;
        padding: 0.375rem 0.625rem;
        border-radius: 0.5rem;
        background-color: var(--boxel-650);
      }
      /* Each command the assistant applies, as a card with its status. */
      .window.is-boxel .step {
        padding: 0.3rem 0.5rem;
        border: 1px solid var(--app-line);
        border-radius: 0.5rem;
        background-color: color-mix(in oklch, black 22%, transparent);
      }
      .window.is-boxel .step-dot {
        display: none;
      }
      .window.is-boxel .step-arg {
        flex: 1;
        min-width: 0;
      }
      .step-applied {
        flex: none;
        padding: 0 0.375rem;
        border-radius: 1rem;
        background-color: var(--boxel-green);
        color: var(--boxel-dark);
        font-size: 0.5625rem;
        font-weight: 600;
      }
      .window.is-boxel .step-result {
        padding-left: 0;
      }
      .window.is-boxel .composer {
        border-radius: 0.5rem;
        background-color: color-mix(in oklch, black 22%, transparent);
      }
      .window.is-boxel .send {
        border-radius: 0.375rem;
        background-color: var(--boxel-highlight);
        color: var(--boxel-dark);
      }

      /* The card form the agent puts in its chat. */
      .form-card {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        align-self: flex-start;
        width: min(100%, 13rem);
        padding: 0.5rem 0.625rem;
        border-radius: 0.625rem;
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        animation: arrive 0.3s ease-out;
      }
      .form-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.375rem;
      }
      .form-kind {
        font-size: 0.5625rem;
        color: color-mix(in oklch, var(--boxel-dark) 50%, transparent);
      }
      .form-field {
        display: grid;
        grid-template-columns: 4rem minmax(0, 1fr);
        align-items: center;
        gap: 0.375rem;
      }
      .form-label {
        font-size: 0.625rem;
        color: color-mix(in oklch, var(--boxel-dark) 60%, transparent);
      }
      .form-input {
        min-height: 1.25rem;
        overflow: hidden;
        padding: 0.15rem 0.375rem;
        border: 1px solid
          color-mix(in oklch, var(--boxel-dark) 15%, transparent);
        border-radius: 0.375rem;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .form-send {
        align-self: flex-end;
        padding: 0.15rem 0.625rem;
        border-radius: 0.75rem;
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
        font-size: 0.625rem;
        font-weight: 600;
      }
      .form-send.is-sent {
        background-color: var(--boxel-highlight);
        color: var(--boxel-dark);
      }

      /* The panel before any card is pushed. */
      .placeholder {
        color: var(--app-muted);
      }
      @keyframes arrive {
        from {
          opacity: 0;
          transform: translateY(0.25rem);
        }
      }
      @keyframes blink {
        50% {
          opacity: 0;
        }
      }
      @keyframes pulse {
        50% {
          opacity: 0.25;
        }
      }

      /* Play and the chapters, under the window. */
      .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .play {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border: 1px solid
          color-mix(in oklch, var(--boxel-light) 18%, transparent);
        border-radius: 50%;
        background: none;
        color: var(--boxel-light);
        font-size: 0.625rem;
        cursor: pointer;
      }
      .chapters {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-5xs);
      }
      .chapter {
        height: 1.75rem;
        padding: 0 var(--boxel-sp-xs);
        border: 1px solid transparent;
        border-radius: 0.875rem;
        background: none;
        color: color-mix(in oklch, var(--boxel-light) 55%, transparent);
        font: 500 var(--boxel-font-xs);
        cursor: pointer;
      }
      .chapter:hover {
        color: var(--boxel-light);
      }
      .chapter[aria-pressed='true'] {
        border-color: color-mix(
          in oklch,
          var(--boxel-highlight) 50%,
          transparent
        );
        color: var(--boxel-highlight);
      }
      .play:focus-visible,
      .chapter:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
      /* Narrow: the sidebar goes and the panel sits under the chat. */
      @media (max-width: 40rem) {
        .window,
        .window.is-codex,
        .window.is-boxel {
          grid-template-columns: minmax(0, 1fr);
          /* The pane's card is drawn absolutely, so its row needs a
             height of its own. */
          grid-template-rows: 13rem 16rem;
          height: auto;
        }
        .sidebar {
          display: none;
        }
        .panel {
          border-left: 0;
          border-top: 1px solid var(--app-line);
        }
        .window.is-grok .agent-app {
          grid-template-columns: minmax(0, 1fr);
          height: 13rem;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .bubble,
        .reply,
        .step,
        .working i,
        .caret,
        .synced,
        .form-card,
        .app,
        .wordmark,
        .count,
        .total,
        .files,
        .avatars,
        .tile.is-new {
          animation: none;
        }
      }
    </style>
  </template>
}
