// A settled assistant turn's tool calls, said as one line: what the calls
// did, counted, and how long the turn took. "Ran 3 scripts, read 2 pages ·
// 1m 32s". It names what was done, not which tools were used.

import { formatToolDuration } from '@cardstack/pretui/components/tool-row';

interface Phrase {
  verb: string;
  one: string;
  many: string;
}

// The first rule a call's name matches gives its phrase.
const PHRASES: [RegExp, Phrase][] = [
  [
    /realm.?code|realm.?script/,
    { verb: 'ran', one: 'script', many: 'scripts' },
  ],
  [/research/, { verb: 'researched', one: 'question', many: 'questions' }],
  [/check.?correctness/, { verb: 'checked', one: 'file', many: 'files' }],
  [/ask.?user|^ask/, { verb: 'asked', one: 'question', many: 'questions' }],
  [/search|find|explore/, { verb: 'searched', one: 'time', many: 'times' }],
  [/web.?read|fetch|scrape/, { verb: 'read', one: 'page', many: 'pages' }],
  [/read|get|load|inspect/, { verb: 'read', one: 'file', many: 'files' }],
  [
    /patch|update|set|write|create|save|delete|apply|copy|replace|upload|generate/,
    { verb: 'made', one: 'change', many: 'changes' },
  ],
  [
    /show|open|switch|view|preview|navigate/,
    { verb: 'opened', one: 'view', many: 'views' },
  ],
];
const OTHER: Phrase = { verb: 'used', one: 'tool', many: 'tools' };

// A skill's tool name carries a runtime hash and often a `Tool` suffix:
// `ResearchTool_3f9a1c` is `research`.
function baseName(name: string): string {
  return name
    .replace(/_[0-9a-f]{6,}$/i, '')
    .replace(/Tool$/, '')
    .toLowerCase();
}

export function phraseFor(name: string): Phrase {
  let base = baseName(name);
  return PHRASES.find(([pattern]) => pattern.test(base))?.[1] ?? OTHER;
}

/** "Ran 3 scripts, read 2 pages · 1 failed · 1m 32s" */
export function turnSummary(
  toolNames: string[],
  options: {
    seconds?: number;
    failed?: number;
    stopped?: number;
    undone?: number;
  } = {},
): string {
  let counts = new Map<Phrase, number>();
  for (let name of toolNames) {
    let phrase = phraseFor(name);
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  let parts = [...counts].map(
    ([phrase, n]) =>
      `${phrase.verb} ${n} ${n === 1 ? phrase.one : phrase.many}`,
  );
  let text = parts.join(', ');
  let line = text ? text[0]!.toUpperCase() + text.slice(1) : 'No tools used';
  if (options.failed) {
    line += ` · ${options.failed} failed`;
  }
  if (options.stopped) {
    line += ` · ${options.stopped} stopped`;
  }
  if (options.undone) {
    line += ` · ${options.undone} undone`;
  }
  if (options.seconds !== undefined && options.seconds >= 1) {
    line += ` · ${formatToolDuration(options.seconds)}`;
  }
  return line;
}

/** A settled turn's fold, as each of its messages sees it. */
export interface TurnFold {
  /** the turn's first assistant message, which names the turn */
  key: string;
  summary: string;
  expanded: boolean;
  /** the message that carries the summary line: the first with tool rows */
  isFirst: boolean;
  toggle: () => void;
}

/** The head of an assistant turn that isn't folded: Pret UI's AgentTurn
 * header, the assistant's mark and where the turn stands. */
export interface TurnHead {
  /** the turn is still going: the mark animates */
  working: boolean;
  /** how long it took, from the question to its last message */
  seconds?: number;
  /** when the turn started, for the time on hover */
  at: Date;
  /** how many calls the turn made, once it is done */
  calls?: number;
  /** how many source files it changed, once it is done */
  files?: number;
  /** the turn has reasoning the reader can open from its header */
  thinking?: boolean;
  thinkingShown?: boolean;
  toggleThinking?: () => void;
}

/** A reply's place in its turn: which turn (its first reply's event id),
 * whether the turn still works, and whether this is its last part. */
export interface TurnPlace {
  key: string;
  working: boolean;
  last: boolean;
}

/** How a reply shows its reasoning: one moving line at the end of a
 * working turn, nothing, or the full text the reader opened. */
export type ReasoningMode = 'tail' | 'hidden' | 'shown';

/** What the quiet actions under a turn's final reply act on. */
// One source file a call changed, with its size, for the turn's list.
export interface ChangedFile {
  url: string;
  path: string;
  added: number;
  removed: number;
  status: 'modified' | 'added' | 'deleted';
  state: 'kept' | 'reverted';
}

export interface AnswerFooterData {
  /** a later turn has its own footer: this one stays mounted but hidden,
   * so it can leave by shrinking rather than vanishing */
  superseded?: boolean;
  /** the reply as written, for Copy */
  markdown: string;
  /** the turn's cost, in credits */
  credits?: string;
  /** asks again: the room's own retry, offered on the latest turn only */
  retry?: () => void;
  /** saves the reply as a markdown card in the open workspace and gives
   * its URL; absent when there is nowhere sensible to save it */
  saveAsCard?: () => Promise<string>;
  /** what the turn changed in source files, and how to show it: Review
   * opens the turn and brings its first diff into view */
  diff?: {
    files: number;
    added: number;
    removed: number;
    /** each file the turn changed, with its size, for TurnChanges */
    perFile?: ChangedFile[];
    review: (from: HTMLElement) => void;
  };
}
