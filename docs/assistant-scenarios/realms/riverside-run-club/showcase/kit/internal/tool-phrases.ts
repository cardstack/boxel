// Pretui — the phrase grammar for tool calls: what a run of calls DID, in
// words, rather than which tools it used. "Read 3 files, searched 2
// queries, and edited 1 file" instead of "Used 6 tools · Read, Search,
// Patch". While the run is still going, the phrase for the newest call reads
// in the present tense ("editing 1 file"); the rest are past.
//
// Adapted from bb's timeline bundles (`packages/thread-view/src/timeline-view.ts`,
// activeSummaryPhrase / completedSummaryPhrase).

export type ToolKind =
  | 'read'
  | 'search'
  | 'write'
  | 'command'
  | 'web'
  | 'agent'
  | 'other';

export interface ToolPhrase {
  /** present tense, while the call is running: 'Reading' */
  active: string;
  /** past tense, once it settled: 'Read' */
  done: string;
  /** the noun for one, and for several: 'file', 'files' */
  one: string;
  many: string;
}

export const KIND_PHRASES: Record<ToolKind, ToolPhrase> = {
  read: { active: 'Reading', done: 'Read', one: 'file', many: 'files' },
  search: {
    active: 'Searching',
    done: 'Searched',
    one: 'query',
    many: 'queries',
  },
  write: { active: 'Editing', done: 'Edited', one: 'file', many: 'files' },
  command: { active: 'Running', done: 'Ran', one: 'command', many: 'commands' },
  web: {
    active: 'Researching',
    done: 'Researched',
    one: 'source',
    many: 'sources',
  },
  agent: {
    active: 'Delegating to',
    done: 'Delegated to',
    one: 'agent',
    many: 'agents',
  },
  other: { active: 'Using', done: 'Used', one: 'tool', many: 'tools' },
};

export interface PhraseItem {
  /** stable: identifies the phrase across updates */
  key: string;
  /** the verb in the right tense, lower-case unless it opens the receipt */
  verb: string;
  count: number;
  noun: string;
  /** present tense: this is what the run is doing now */
  active: boolean;
  /** the whole phrase as text */
  text: string;
}

function phraseKey(phrase: ToolPhrase): string {
  return `${phrase.done}|${phrase.one}`;
}

function lowerFirst(text: string): string {
  return text ? text[0]!.toLowerCase() + text.slice(1) : text;
}

function upperFirst(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/**
 * Group `items` by phrase, in order of first appearance, counting each.
 * `activeIndex` is the index of the call still running, if any: its phrase
 * reads in the present tense.
 */
export function phraseRun<T>(
  items: T[],
  phraseOf: (item: T) => ToolPhrase,
  activeIndex?: number,
): PhraseItem[] {
  let order: string[] = [];
  let groups = new Map<string, { phrase: ToolPhrase; count: number }>();
  items.forEach((item) => {
    let phrase = phraseOf(item);
    let key = phraseKey(phrase);
    let group = groups.get(key);
    if (group) {
      group.count++;
    } else {
      groups.set(key, { phrase, count: 1 });
      order.push(key);
    }
  });
  let activeKey =
    activeIndex !== undefined && items[activeIndex] !== undefined
      ? phraseKey(phraseOf(items[activeIndex]!))
      : undefined;
  return order.map((key, index) => {
    let { phrase, count } = groups.get(key)!;
    let active = key === activeKey;
    let verb = active ? phrase.active : phrase.done;
    verb = index === 0 ? upperFirst(verb) : lowerFirst(verb);
    let noun = count === 1 ? phrase.one : phrase.many;
    return { key, verb, count, noun, active, text: `${verb} ${count} ${noun}` };
  });
}

function formatter(): Intl.ListFormat | undefined {
  return typeof Intl !== 'undefined' && 'ListFormat' in Intl
    ? new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' })
    : undefined;
}

/** The phrases as one localized list. */
export function joinPhrases(texts: string[]): string {
  if (texts.length < 2) {
    return texts[0] ?? '';
  }
  let format = formatter();
  if (format) {
    return format.format(texts);
  }
  return `${texts.slice(0, -1).join(', ')} and ${texts[texts.length - 1]}`;
}

/**
 * The literal separators a localized list puts between `count` items, so a
 * template can lay the items out as components (a rolling count each) and
 * still read as one grammatical list. separators[i] goes before item i; the
 * first is ''.
 */
export function listSeparators(count: number): string[] {
  if (count <= 1) {
    return count === 1 ? [''] : [];
  }
  let format = formatter();
  let placeholders = Array.from({ length: count }, (_, i) => `\u0000${i}`);
  if (!format || typeof format.formatToParts !== 'function') {
    return placeholders.map((_, i) =>
      i === 0 ? '' : i === count - 1 ? ' and ' : ', ',
    );
  }
  let separators: string[] = [''];
  let pending = '';
  let seen = 0;
  for (let part of format.formatToParts(placeholders)) {
    if (part.type === 'element') {
      if (seen > 0) {
        separators.push(pending);
      }
      seen++;
      pending = '';
    } else {
      pending += part.value;
    }
  }
  return separators;
}
