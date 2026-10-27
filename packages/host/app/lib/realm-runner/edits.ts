// What a Realm Runner run changed in its realm's files, kept so the
// transcript can show each change as a diff. The run records each file's text before its first change and after
// its last; the tool result carries a compact diff of the same, and the tab
// that ran the call keeps the full texts, because the realm server's base
// can lag behind the host and drop the result's newer fields.

import { lineDiff } from '@cardstack/pretui/components/diff-block';

import type { DiffLine } from '@cardstack/pretui/components/diff-block';

export interface RealmFileEdit {
  url: string;
  /** the text before the run first changed the file; absent when the run
   * created it */
  before?: string;
  /** the text the run left; absent when the run deleted the file */
  after?: string;
  /** the run created this binary file; its bytes are not kept, only their
   * SHA-256 */
  binarySha256?: string;
  /** the run deleted a binary file that existed before it, so its text
   * before is not known */
  irreversible?: boolean;
  /** the run made this file with realm.fs.copy: the row says "Copied a →
   * b" in one line, so a whole file of additions is not shown as a diff */
  copiedFrom?: string;
}

// The source files whose change the transcript shows as a diff.
const DIFFABLE_RE = /\.(gts|ts|js|mjs|css|md|markdown)$/i;

export function isDiffable(url: string): boolean {
  return DIFFABLE_RE.test(new URL(url).pathname);
}

// A diff in the result is for reading, by the reader and the model: past
// this size it stops, and says so, rather than filling the room event.
const MAX_RESULT_DIFF_LINES = 120;
const MAX_RESULT_DIFF_CHARS = 6000;
const TRUNCATED = '…truncated';

/** Where a file result's `detail` carries the diff when its base has no
 * `diff` field. */
export const DIFF_IN_DETAIL = '\n\nDiff:\n';

/** Where a card file's result carries what the run changed on the card,
 * as JSON, after its diff: `[{ field, before, after }]`. */
export const CARD_CHANGES_IN_DETAIL = '\n\nCard changes:\n';

/** One field a run changed on a card, as the card's attributes held it. */
export interface CardFieldChange {
  field: string;
  before?: string;
  after?: string;
}

const MAX_CHANGE_VALUE_CHARS = 240;

function shownValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_CHANGE_VALUE_CHARS
    ? `${text.slice(0, MAX_CHANGE_VALUE_CHARS - 1)}…`
    : text;
}

/** What changed between two versions of a card instance's JSON, one entry
 * per top-level attribute that differs. Empty when either side is not a
 * card document. */
export function cardChanges(
  before: string | undefined,
  after: string | undefined,
): CardFieldChange[] {
  let attributes = (text: string | undefined) => {
    try {
      let doc = text ? JSON.parse(text) : undefined;
      let attrs = doc?.data?.attributes;
      return attrs && typeof attrs === 'object' && !Array.isArray(attrs)
        ? (attrs as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  };
  let was = attributes(before);
  let now = attributes(after);
  if (!was || !now) {
    return [];
  }
  let changes: CardFieldChange[] = [];
  for (let field of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (JSON.stringify(was[field]) === JSON.stringify(now[field])) {
      continue;
    }
    changes.push({
      field,
      before: shownValue(was[field]),
      after: shownValue(now[field]),
    });
  }
  return changes;
}

/** A card file result's changes, read back from its `detail`. */
export function resultCardChanges(file: {
  detail?: string;
}): CardFieldChange[] | undefined {
  let at = file.detail?.indexOf(CARD_CHANGES_IN_DETAIL) ?? -1;
  if (at < 0) {
    return undefined;
  }
  try {
    let parsed = JSON.parse(
      file.detail!.slice(at + CARD_CHANGES_IN_DETAIL.length),
    );
    return Array.isArray(parsed) ? (parsed as CardFieldChange[]) : undefined;
  } catch {
    return undefined;
  }
}

/** A file result's diff: its own field, else the copy in `detail`. */
export function resultDiff(file: {
  diff?: string;
  detail?: string;
}): string | undefined {
  if (file.diff) {
    return file.diff;
  }
  let at = file.detail?.indexOf(DIFF_IN_DETAIL) ?? -1;
  if (at < 0) {
    return undefined;
  }
  let rest = file.detail!.slice(at + DIFF_IN_DETAIL.length);
  let end = rest.indexOf(CARD_CHANGES_IN_DETAIL);
  return end >= 0 ? rest.slice(0, end) : rest;
}

/** The edit as the result carries it: one line per diff line, signed ' ',
 * '-' or '+', with `…N` for N unchanged lines left out, and a closing
 * `…truncated` when the diff was cut short. */
export function compactDiff(edit: RealmFileEdit): string | undefined {
  if (edit.binarySha256 || edit.irreversible || edit.copiedFrom) {
    return undefined;
  }
  let lines = lineDiff(edit.before, edit.after, { context: 2 });
  if (!lines.length) {
    return undefined;
  }
  let out: string[] = [];
  let chars = 0;
  for (let line of lines) {
    let text = line.skip
      ? `…${line.skip}`
      : `${line.op === 'add' ? '+' : line.op === 'del' ? '-' : ' '}${line.text}`;
    if (
      out.length >= MAX_RESULT_DIFF_LINES ||
      chars + text.length > MAX_RESULT_DIFF_CHARS
    ) {
      out.push(TRUNCATED);
      break;
    }
    out.push(text);
    chars += text.length + 1;
  }
  return out.join('\n');
}

/** A result's compact diff back as diff lines, and whether it is whole. */
export function parseCompactDiff(text: string): {
  lines: DiffLine[];
  complete: boolean;
} {
  let lines: DiffLine[] = [];
  let complete = true;
  for (let raw of text.split('\n')) {
    if (raw === TRUNCATED) {
      complete = false;
      break;
    }
    let skip = raw.match(/^…(\d+)$/);
    if (skip) {
      lines.push({ text: '', skip: Number(skip[1]) });
    } else if (raw.startsWith('+')) {
      lines.push({ op: 'add', text: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      lines.push({ op: 'del', text: raw.slice(1) });
    } else {
      lines.push({ text: raw.slice(1) });
    }
  }
  return { lines, complete };
}
