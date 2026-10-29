// The assistant describes a call before it runs, in the first person: "I'll
// add the missing import". As a title the "I'll" is noise, so a title keeps
// only what is being done.
const FIRST_PERSON =
  /^(?:i['’]ll|i will|i['’]m going to|i am going to|let me|i['’]m|i am|now i['’]ll|next,? i['’]ll)\s+(?:go ahead and\s+|now\s+)?/i;

export function plainTitle(text: string): string {
  let plain = text
    .trim()
    .replace(FIRST_PERSON, '')
    .replace(/[.…]+$/, '');
  return plain ? plain[0]!.toUpperCase() + plain.slice(1) : text;
}

// The past tense of the verbs assistants lead a call's description with
// that do not take -ed by rule, or that the rule would spell wrong.
const PAST: Record<string, string> = {
  build: 'Built',
  buy: 'Bought',
  choose: 'Chose',
  do: 'Did',
  draw: 'Drew',
  find: 'Found',
  get: 'Got',
  give: 'Gave',
  keep: 'Kept',
  leave: 'Left',
  make: 'Made',
  put: 'Put',
  begin: 'Began',
  bring: 'Brought',
  think: 'Thought',
  read: 'Read',
  run: 'Ran',
  send: 'Sent',
  set: 'Set',
  show: 'Showed',
  take: 'Took',
  write: 'Wrote',
  try: 'Tried',
  copy: 'Copied',
  apply: 'Applied',
  identify: 'Identified',
  verify: 'Verified',
  modify: 'Modified',
  stop: 'Stopped',
  plan: 'Planned',
  map: 'Mapped',
  add: 'Added',
  check: 'Checked',
  fix: 'Fixed',
  look: 'Looked',
  drop: 'Dropped',
  tag: 'Tagged',
  ship: 'Shipped',
};

// Regular verbs assistants lead with. A lead word outside this list and PAST
// is left as it is, since it may not be a verb at all ("New card for Lena").
const REGULAR = new Set([
  'adjust',
  'ask',
  'attach',
  'clean',
  'compare',
  'convert',
  'create',
  'delete',
  'download',
  'draft',
  'edit',
  'enable',
  'disable',
  'export',
  'extract',
  'fetch',
  'fill',
  'format',
  'generate',
  'import',
  'insert',
  'install',
  'list',
  'load',
  'merge',
  'move',
  'normalize',
  'open',
  'parse',
  'patch',
  'publish',
  'pull',
  'remove',
  'rename',
  'render',
  'reorder',
  'replace',
  'report',
  'resize',
  'restore',
  'return',
  'review',
  'save',
  'search',
  'switch',
  'update',
  'upload',
  'use',
  'validate',
  'view',
  'wire',
  'invalidate',
  'reindex',
  'capture',
  'change',
  'collect',
  'confirm',
  'gather',
  'inspect',
  'link',
  'mark',
  'prepare',
  'resolve',
  'scan',
  'select',
  'sort',
  'summarize',
  'test',
  'translate',
]);
const VOWEL = /[aeiouy]/;

function regularPast(stem: string): string {
  let past = stem.endsWith('e') ? `${stem}d` : `${stem}ed`;
  return past[0]!.toUpperCase() + past.slice(1);
}

function pastOf(word: string): string | undefined {
  let lower = word.toLowerCase();
  if (PAST[lower]) {
    return PAST[lower];
  }
  if (REGULAR.has(lower)) {
    return regularPast(lower);
  }
  // a gerund ("Asking the user…") names the same act; its stem may have
  // lost an e ("making") or doubled its last letter ("running"). Only a
  // known verb is re-tensed, so "Something" or "Landing page" stays as it is.
  if (!lower.endsWith('ing')) {
    return undefined;
  }
  let stem = lower.slice(0, -3);
  if (!/^[a-z]{2,}$/.test(stem) || !VOWEL.test(stem)) {
    return undefined;
  }
  let undoubled =
    stem.length > 2 && stem.at(-1) === stem.at(-2) ? stem.slice(0, -1) : stem;
  for (let candidate of [stem, `${stem}e`, undoubled]) {
    if (PAST[candidate]) {
      return PAST[candidate];
    }
    if (REGULAR.has(candidate)) {
      return regularPast(candidate);
    }
  }
  return undefined;
}

// The clauses that say why or how, which a settled title can do without:
// "…cover image after your approval because it uses credit".
const TAIL =
  /\s+(?:because|so that|so it|so the|after your|before your|once you|using (?:one|a|the)? ?run-realm-code|with run-realm-code|via |in one script|in a single script|for (?:your|the user's) (?:review|approval))\b.*$/i;

/** A settled call's title: what it did, in the past tense, without the why.
 * "Replace the third relaunch note with two bullets" reads "Replaced the
 * third relaunch note with two bullets". A title whose lead word is the
 * row's verb drops it, since the verb label already says it: "Read file:
 * SKILL.md" under READ reads "SKILL.md". */
export function settledTitle(text: string, verb?: string): string {
  let plain = plainTitle(text).replace(TAIL, '');
  let [first, ...rest] = plain.split(/\s+/);
  if (!first) {
    return plain;
  }
  if (verb && first.replace(/:$/, '').toLowerCase() === verb.toLowerCase()) {
    let tail = rest.join(' ').replace(/^(?:file|files|card|cards):\s*/i, '');
    if (tail) {
      // a path keeps its own case
      return /^[\w.-]+[/.]/.test(tail)
        ? tail
        : tail[0]!.toUpperCase() + tail.slice(1);
    }
  }
  let past = pastOf(first.replace(/:$/, ''));
  if (!past) {
    return plain;
  }
  // "Opened the code and add a border": the second act is past too
  let tail = rest
    .join(' ')
    .replace(
      new RegExp(`(\\band|\\bthen|,) (${SECOND_VERBS.join('|')})\\b`, 'gi'),
      (_m, joiner: string, word: string) =>
        `${joiner} ${pastOf(word)?.toLowerCase() ?? word}`,
    );
  return tail ? `${past} ${tail}` : past;
}

// The verbs a description joins with "and": only these are re-tensed, so a
// noun after "and" is left alone.
const SECOND_VERBS = [
  'add',
  'ask',
  'copy',
  'delete',
  'download',
  'drop',
  'move',
  'rename',
  'stop',
  'tag',
  'apply',
  'build',
  'check',
  'collect',
  'compare',
  'create',
  'draft',
  'extract',
  'fetch',
  'find',
  'fix',
  'gather',
  'generate',
  'list',
  'make',
  'mark',
  'open',
  'prepare',
  'pull',
  'read',
  'remove',
  'replace',
  'report',
  'return',
  'run',
  'save',
  'search',
  'set',
  'show',
  'summarize',
  'update',
  'write',
];
