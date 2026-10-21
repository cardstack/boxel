// The Riverside relaunch, as data: every literal the showcase's assistant
// panel reads, so the page always shows the same instant of one story.
import type { AgentChoice } from './kit/components/agent-question';
import type { CardPillItem } from './kit/components/card-pills';
import type { ChangedFile } from './kit/components/turn-changes';
import type { RecommendationOption } from './kit/components/recommendation';
import type { SessionPrepStep } from './kit/components/session-prep';
import type { ThinkingRow } from './kit/components/thinking';
import type { ToolChangeRow } from './kit/components/tool-change-table';
import type { ToolPart } from './kit/components/tool-group';
import type { ToolPlanStep } from './kit/components/tool-plan';
import type { Reaction } from './kit/components/reactions';
import type { AnswerSource } from './kit/components/answer-furniture';

export const PREP_STEPS: SessionPrepStep[] = [
  { id: 'realm', label: 'Open Riverside Run Club', state: 'complete' },
  { id: 'plan', label: 'Read the relaunch plan', state: 'complete' },
  { id: 'skill', label: 'Turn on the Club organizer skill', state: 'running' },
];

export const COMPACTION_SUMMARY =
  'Chris set the relaunch for the first Wednesday in November. The club wants its regulars back first, then a poster and one email. Rupert owns the roster; Mei runs the kids’ group.';

export const PLAN_CARD: CardPillItem[] = [
  { id: 'plan', title: 'Riverside relaunch', kind: 'Relaunch plan' },
];

const REGULAR_NAMES = [
  ['Lena Ruiz', '4 of 4 runs'],
  ['Omar Haddad', '4 of 4 runs'],
  ['Kai Moreno', '3 of 4 runs'],
  ['Priya Shah', '3 of 4 runs'],
  ['Jonas Berg', '3 of 4 runs'],
  ['Ada Okafor', '3 of 4 runs'],
  ['Mei Tanaka', '3 of 4 runs'],
];
export const REGULARS: CardPillItem[] = REGULAR_NAMES.map(([title, sub]) => ({
  id: title!.toLowerCase().replace(/\s+/g, '-'),
  title: title!,
  kind: 'Member',
  sub,
}));

export const THOUGHTS: ThinkingRow[] = [
  {
    id: 't1',
    primary: 'A regular is anyone at three of the last four runs',
    state: 'done',
  },
  {
    id: 't2',
    primary: 'The roster is Rupert’s; tiers live on each member card',
    state: 'done',
  },
  {
    id: 't3',
    primary: 'Mark them first, then write to them',
    state: 'done',
  },
];

export const READS: ToolPart[] = [
  {
    id: 'r1',
    name: 'read_realm_file',
    state: 'completed',
    subtitle: 'relaunch-plan.json',
    kind: 'read',
  },
  {
    id: 'r2',
    name: 'read_realm_file',
    state: 'completed',
    subtitle: 'runs/2026-10.json',
    kind: 'read',
  },
  {
    id: 'r3',
    name: 'read_realm_file',
    state: 'completed',
    subtitle: 'runs/2026-09.json',
    kind: 'read',
  },
  {
    id: 'r4',
    name: 'search_cards',
    state: 'completed',
    subtitle: 'Member where runs >= 3',
    kind: 'search',
  },
];

export const RELAUNCH_PLAN: ToolPlanStep[] = [
  { label: 'Mark the seven regulars', state: 'next' },
  { label: 'Pick a poster and an accent', state: 'next' },
  { label: 'Find fall races for the first run', state: 'next' },
  { label: 'Draft one email to the regulars', state: 'next' },
];

export const AGENT_TASKS: ToolPlanStep[] = [
  { label: 'Mark the seven regulars', state: 'done' },
  { label: 'Pick a poster and an accent', state: 'done' },
  { label: 'Find fall races for the first run', state: 'current' },
  { label: 'Draft one email to the regulars', state: 'next' },
];

export const SCRIPT_STEPS: ToolPlanStep[] = [
  { label: 'Read the seven member cards', state: 'done' },
  { label: 'Write the email', state: 'current', note: '2 of 3 paragraphs' },
  { label: 'Attach the poster', state: 'next' },
  { label: 'Save it as a draft', state: 'next' },
];

export const TIER_ROWS: ToolChangeRow[] = [
  { card: 'Lena Ruiz', from: 'Member', to: 'Regular' },
  { card: 'Omar Haddad', from: 'Member', to: 'Regular' },
  {
    card: 'Kai Moreno',
    from: 'Member',
    to: 'Regular',
    skipped: 'Rupert edited it since the preview',
  },
  { card: 'Priya Shah', from: 'Member', to: 'Regular' },
  { card: 'Jonas Berg', from: 'Member', to: 'Regular' },
  { card: 'Ada Okafor', from: 'Member', to: 'Regular' },
  { card: 'Mei Tanaka', from: 'Member', to: 'Regular' },
];

export const TIER_REACTIONS: Reaction[] = [
  { key: '👍', by: ['Rupert'] },
  { key: '🎉', by: ['Mei', 'Lena'] },
];

// posters drawn as data so the realm carries no bitmaps for them
function poster(sky: string, ground: string, sun: string, mark: string) {
  let svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 110'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${sky}'/><stop offset='1' stop-color='${ground}'/></linearGradient></defs><rect width='160' height='110' fill='url(#g)'/><circle cx='118' cy='38' r='16' fill='${sun}'/><path d='M0 84 C40 70 70 92 160 76 L160 110 L0 110Z' fill='${mark}'/><path d='M20 96 L52 64 L60 72 L84 50' stroke='${sun}' stroke-width='3' fill='none' stroke-linecap='round'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const POSTERS: AgentChoice[] = [
  {
    label: 'Night Shift',
    sub: 'Headlamps, city lights',
    image: poster('#1b1440', '#3d2d7a', '#c3fc33', '#120d2b'),
  },
  {
    label: 'Dawn Patrol',
    sub: 'First light, empty roads',
    image: poster('#ffb38a', '#ffe2c4', '#ff6f3c', '#d9875a'),
  },
  {
    label: 'River Loop',
    sub: 'The towpath at noon',
    image: poster('#7fd3e8', '#d8f3f7', '#ffffff', '#2f8a83'),
  },
];

export const SWATCHES: AgentChoice[] = [
  { label: 'Lime', swatch: '#c3fc33' },
  { label: 'Teal', swatch: '#00ffba' },
  { label: 'Coral', swatch: '#ff7a59' },
  { label: 'Ink', swatch: '#2b2340' },
];

export const RESEARCH_PLAN: ToolPlanStep[] = [
  { label: 'Search race calendars', state: 'done' },
  { label: 'Read each race page', state: 'done', note: '5 of 5' },
  { label: 'Compare dates and kids’ fees', state: 'done' },
  { label: 'Post the table here', state: 'done' },
];

export const RACES = [
  {
    race: 'Riverside 5K',
    date: 'Nov 4',
    kids: '$8',
    distance: '5 km',
    pick: true,
  },
  { race: 'Harlem 5K', date: 'Nov 7', kids: '$10', distance: '5 km' },
  {
    race: 'Prospect Park Fun Run',
    date: 'Nov 14',
    kids: '$12',
    distance: '1 mile',
  },
  { race: 'Queens Half', date: 'Nov 22', kids: '$15', distance: '21.1 km' },
];

export const ANSWER = `Seven runners came to at least three of the last four Wednesday runs. Six are now marked **Regular**; Kai Moreno is the one left, because Rupert edited his card after the preview.

For the first run back, the **Riverside 5K** on November 4 is the easy pick:

- it starts at our usual towpath gate
- the kids’ mile is $8, the cheapest of the four
- registration stays open until October 30

The email to the regulars is drafted with the Night Shift poster and a lime accent. Nothing has been sent.`;

export const STATS = [
  '7 regulars',
  '6 marked',
  '$8 kids’ mile',
  'checked Oct 21',
];

export const SOURCES: AnswerSource[] = [
  { n: 1, href: 'https://www.nyrr.org/races' },
  { n: 2, href: 'https://www.runnersworld.com/races' },
  { n: 3, href: 'https://www.riversiderunclub.org/calendar' },
];

export const METHOD =
  'A regular came to three of the last four Wednesday runs, counted from the run logs for September and October. Race fees are each race’s own kids’ mile before late registration.';

export const SEND_OPTIONS: RecommendationOption[] = [
  {
    key: 'wed',
    body: 'Send it Wednesday at 6 PM, an hour before the usual run. Last spring’s club emails sent on run nights were opened by 71% of regulars, against 48% for weekend sends, and it lands while people are deciding whether to come out.',
    short: 'Wednesday, 6 PM',
    level: 3,
    label: 'High confidence',
    cta: 'Schedule for Wednesday',
  },
  {
    key: 'sun',
    body: 'Send it Sunday morning. Weekend sends are read more slowly but stay in view through the week, which suits a race-day reminder more than a relaunch.',
    short: 'Sunday, 9 AM',
    level: 2,
    label: 'Medium confidence',
  },
  {
    key: 'now',
    body: 'Send it now. It reaches people soonest, but two regulars have not yet been marked, so the list would change after it goes.',
    short: 'Right now',
    level: 1,
    label: 'Low confidence',
  },
];

export const POSTER_BEFORE = `<template>
  <article class='poster'>
    <img src={{@model.art}} alt='' />
    <h1>{{@model.title}}</h1>
    <p>{{@model.date}}, {{@model.place}}</p>
  </article>
  <style scoped>
    .poster { display: grid; gap: 12px; }
    h1 { font-size: 2rem; }
  </style>
</template>`;

export const POSTER_AFTER = `<template>
  <article class='poster'>
    <img src={{@model.art}} alt='' />
    <h1>{{@model.title}}</h1>
    <p>{{@model.date}}, {{@model.place}}</p>
  </article>
  <style scoped>
    .poster { display: grid; gap: 12px; }
    .poster { border: 3px solid var(--plan-accent); }
    h1 { font-size: 2rem; }
  </style>
</template>`;

export const BORDER_RULE = `.poster {
  border: 3px solid var(--plan-accent);
  border-radius: 12px;
}`;

export const TURN_FILES: ChangedFile[] = [
  { path: 'showcase/poster.gts', added: 1, removed: 0 },
  { path: 'members/lena-ruiz.json', added: 1, removed: 1, state: 'kept' },
  {
    path: 'emails/relaunch-draft.json',
    added: 24,
    removed: 0,
    status: 'added',
  },
];

export const FOLLOW_TURNS = [
  {
    id: 'f1',
    who: 'user',
    author: 'Rupert',
    text: 'Can the kids’ group come to the 5K?',
  },
  {
    id: 'f2',
    who: 'agent',
    text: 'Yes. The Riverside 5K runs a kids’ mile at 8:30, before the main start, and Mei has led it the last two years.',
  },
  {
    id: 'f3',
    who: 'user',
    author: 'Mei',
    text: 'I can take up to twelve kids.',
  },
  {
    id: 'f4',
    who: 'agent',
    text: 'Noted on the plan: kids’ mile, twelve places, Mei leading. I added it as a line in the email draft.',
  },
  { id: 'f5', who: 'user', author: 'Rupert', text: 'And water at the gate?' },
  {
    id: 'f6',
    who: 'agent',
    text: 'The race supplies water at the 2.5 km mark; the gate has none. I listed it under “bring your own” in the draft.',
  },
  {
    id: 'f7',
    who: 'user',
    author: 'Chris',
    text: 'Perfect. Send it Wednesday.',
  },
];

// what each regular's card shows: the last four Wednesdays, and the month
export interface MemberDetail {
  attended: boolean[];
  km: number;
  pace: string;
  runs: number;
  joined: string;
}
const RUN_DATES = ['Sep 30', 'Oct 7', 'Oct 14', 'Oct 21'];
export const WEDNESDAYS = RUN_DATES;
export const MEMBER_DETAILS: Record<string, MemberDetail> = {
  'lena-ruiz': {
    attended: [true, true, true, true],
    km: 34,
    pace: '5:42',
    runs: 21,
    joined: 'March 2025',
  },
  'omar-haddad': {
    attended: [true, true, true, true],
    km: 41,
    pace: '5:05',
    runs: 26,
    joined: 'May 2024',
  },
  'kai-moreno': {
    attended: [true, false, true, true],
    km: 22,
    pace: '6:10',
    runs: 14,
    joined: 'January 2026',
  },
  'priya-shah': {
    attended: [true, true, false, true],
    km: 27,
    pace: '5:58',
    runs: 17,
    joined: 'August 2025',
  },
  'jonas-berg': {
    attended: [false, true, true, true],
    km: 30,
    pace: '5:31',
    runs: 19,
    joined: 'June 2025',
  },
  'ada-okafor': {
    attended: [true, true, true, false],
    km: 25,
    pace: '6:02',
    runs: 15,
    joined: 'February 2026',
  },
  'mei-tanaka': {
    attended: [true, false, true, true],
    km: 19,
    pace: '6:25',
    runs: 23,
    joined: 'April 2024',
  },
};
export const NEXT_RACE = {
  name: 'Riverside 5K',
  date: 'Wed, Nov 4',
  note: 'kids’ mile at 8:30',
};

// the story as a timeline: each beat appears at `at` seconds, and its note
// names the parts it shows
export interface Beat {
  id: string;
  at: number;
  title: string;
  text: string;
  names: string[];
}
export const STORY_LENGTH = 71;
export const BEATS: Beat[] = [
  {
    id: 'head',
    at: 0,
    title: 'The panel',
    text: 'A dark column at 440px, as the assistant opens beside a workspace. Its icon, inks, type and spacing are the host’s tokens.',
    names: ['AgentMark'],
  },
  {
    id: 'prep',
    at: 0,
    title: 'Before the first message',
    text: 'The session gets its workspace, its plan and its skill ready, and says what it is waiting on.',
    names: ['SessionPrep'],
  },
  {
    id: 'history',
    at: 5,
    title: 'What came before',
    text: 'Monday’s work folds to one line; forty-two older messages are compacted into a summary you can open; changes to the room itself are single lines between turns.',
    names: ['CollapsedTurn', 'CompactionChip', 'SystemLine'],
  },
  {
    id: 'ask',
    at: 7,
    title: 'The ask',
    text: 'The reader’s message steps back on an inset, with the card it was sent with as an outlined pill.',
    names: ['UserBubble', 'CardPills'],
  },
  {
    id: 'reading',
    at: 8,
    title: 'Reading before acting',
    text: 'The reasoning settles into a quiet line; four reads merge into one receipt; the search returns the members themselves, as cards you can open.',
    names: ['Thinking', 'ToolGroup', 'ToolRow', 'CardPills'],
  },
  {
    id: 'plan',
    at: 13,
    title: 'A plan, held at a gate',
    text: 'Nothing runs until the reader approves. Amber is the one colour for “needs you”; the gate’s single filled button is the moment’s one action.',
    names: ['ToolPlan', 'ToolGate'],
  },
  {
    id: 'tier',
    at: 17,
    title: 'A change you can read',
    text: 'A bulk write shows one line per card, folds after four, and strikes the one that did not land, with why. Rupert and Mei react under it.',
    names: ['ToolChangeTable', 'Reactions'],
  },
  {
    id: 'question',
    at: 21,
    title: 'A question with real answers',
    text: 'Posters are cards to pick between, confirmed so a stray tap never answers; the accent is a set of swatches. Each settles into the row’s title as a pill.',
    names: ['AgentQuestion'],
  },
  {
    id: 'script',
    at: 28,
    title: 'A script with live steps',
    text: 'The row ticks through its own plan, nests an auto-fix under the step it fixed, and shows its particulars in mono. The draft it writes arrives as a card.',
    names: ['ToolRow', 'ToolPlan', 'ToolMeta', 'ResultCard'],
  },
  {
    id: 'research',
    at: 37,
    title: 'Research that hands back a table',
    text: 'A background run reports where it is, then delivers its result as a card in the turn: a hat with its type and title, and Open.',
    names: ['CardEmbed'],
  },
  {
    id: 'catalog',
    at: 42,
    title: 'Search results, best first',
    text: 'A catalog search reports what each match is, where it lives and how well it fits: a kind badge, a short path and a five-tick fit meter, the best match tinted. The top three show; the rest wait behind a count.',
    names: ['ToolRow', 'FoundEntries'],
  },
  {
    id: 'answer',
    at: 46,
    title: 'The answer',
    text: 'Prose holds a 68ch measure and streams in a word at a time. Stat chips, numbered sources and the Method note sit under it; the footer copies, saves it as a card, and asks again.',
    names: ['MarkdownStream', 'AnswerFooter', 'Button'],
  },
  {
    id: 'reco',
    at: 53,
    title: 'A recommendation',
    text: 'The best option, argued in full, with its confidence in words beside the meter; the others wait in a drawer.',
    names: ['Recommendation'],
  },
  {
    id: 'code',
    at: 57,
    title: 'Code, and what the turn changed',
    text: 'The edit shows its diff in the row, the reply quotes code in a compact block, and the turn ends with every file it touched and Review.',
    names: ['DiffBlock', 'CodeBlock', 'TurnChanges'],
  },
  {
    id: 'look',
    at: 63,
    title: 'Quick Look',
    text: 'A sheet over the transcript, for a look at one card: Escape, the backdrop or Close put it away, and focus goes back where it came from.',
    names: ['QuickLook'],
  },
  {
    id: 'follow',
    at: 66,
    title: 'Reading back while it talks',
    text: 'The transcript follows the end until the reader scrolls up; then new messages count up on a chip instead of moving the page.',
    names: ['StickToBottom', 'JumpChip'],
  },
  {
    id: 'cap',
    at: 0,
    title: 'The message box’s cap',
    text: 'A dark cap on the box’s top edge says what the assistant is doing, holds the task list and the queued message, and changes voice: working, waiting on you, a problem, done, idle. The ring fills as the context does.',
    names: ['ComposerCap', 'TaskChecklist', 'ContextRing'],
  },
];

// what the catalog search found for a race-day card, best first: catalog
// Spec entries, as the assistant's realm.entries.search returns them
export interface CatalogEntry {
  url: string;
  kind: 'card' | 'file';
  specType?: string;
  cardTitle?: string;
  cardDescription?: string;
  matchRelevance?: number;
}
const CATALOG = 'https://realms-staging.stack.cards/catalog';
export const CATALOG_MATCHES: CatalogEntry[] = [
  {
    url: `${CATALOG}/4a1f3c-event/Spec/2c9e7a41-8b3d-4f0e-9a51-6d2f8c7b1e30`,
    kind: 'card',
    specType: 'card',
    cardTitle: 'Event',
    cardDescription:
      'A dated happening with a place, a start time and the people coming.',
    matchRelevance: 0.92,
  },
  {
    url: `${CATALOG}/9d27b0-schedule/Spec/71a4c0de-3e2b-4c19-8f6a-0b5d9e2a7c14`,
    kind: 'card',
    specType: 'field',
    cardTitle: 'Schedule',
    cardDescription:
      'Times in order for a day or a series, with what happens at each.',
    matchRelevance: 0.74,
  },
  {
    url: `${CATALOG}/c3e8f2-match/Spec/5f0b2d93-a7c6-4e81-b2d4-93e1a6c0f857`,
    kind: 'card',
    specType: 'card',
    cardTitle: 'Match',
    cardDescription:
      'Two sides, a venue and a result, for a fixture or a heat.',
    matchRelevance: 0.58,
  },
  {
    url: `${CATALOG}/1b6d4e-meeting/Spec/a83f5c27-6d1e-4b09-8c3a-2e7f4d9b0a61`,
    kind: 'card',
    specType: 'card',
    cardTitle: 'Meeting',
    cardDescription: 'An agenda, the attendees and the notes taken.',
    matchRelevance: 0.49,
  },
  {
    url: `${CATALOG}/7e2a91-time-slot/Spec/0d4c8b16-2f5a-4e73-91b8-c6a3e5d2f904`,
    kind: 'card',
    specType: 'field',
    cardTitle: 'Time Slot',
    cardDescription: 'A start and an end, with an optional label.',
    matchRelevance: 0.38,
  },
  {
    url: `${CATALOG}/5c90d7-venue/Spec/e61b3a08-94c2-4d5f-a07e-3b8d1f6c2e95`,
    kind: 'card',
    specType: 'card',
    cardTitle: 'Venue',
    cardDescription:
      'A place with an address, a capacity and how to get there.',
    matchRelevance: 0.31,
  },
];
