// What a Realm Runner run changed in its realm's files, kept so the
// transcript can show each change as a diff and so the reader can undo the
// run. The run records each file's text before its first change and after
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
   * SHA-256, so Undo can tell the file is still the run's */
  binarySha256?: string;
  /** the run deleted a binary file that existed before it: nothing can
   * bring it back */
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

// ── Undo ─────────────────────────────────────────────────────────────────

export interface UndoFiles {
  /** the file's text now; undefined when it does not exist */
  read(url: string): Promise<string | undefined>;
  write(url: string, content: string): Promise<void>;
  delete(url: string): Promise<void>;
  /** the SHA-256 of a binary file's bytes now, undefined when it is gone */
  binaryDigest(url: string): Promise<string | undefined>;
}

export interface UndoPlan {
  url: string;
  /** restore this text; absent means delete the file */
  restore?: string;
  /** what the file must still hold for the undo to go ahead */
  expect: { text: string } | { sha256: string } | { missing: true };
}

/** Each step that puts a file back, newest change first. A step for a text
 * file is planned from the full texts when the tab has them, else from the
 * result's diff: each hunk's after-side must still be in the file exactly
 * once, and is swapped back for its before-side. */
export async function planUndo(
  edits: { url: string; edit?: RealmFileEdit; diff?: string }[],
  files: UndoFiles,
): Promise<UndoPlan[]> {
  let plans: UndoPlan[] = [];
  for (let { url, edit, diff } of [...edits].reverse()) {
    if (edit?.irreversible) {
      throw new Error(`${shortName(url)} was a binary file the run deleted`);
    }
    if (edit?.binarySha256) {
      plans.push({ url, expect: { sha256: edit.binarySha256 } });
      continue;
    }
    if (edit) {
      plans.push(
        edit.after === undefined
          ? { url, restore: edit.before, expect: { missing: true } }
          : edit.before === undefined
            ? { url, expect: { text: edit.after } }
            : { url, restore: edit.before, expect: { text: edit.after } },
      );
      continue;
    }
    if (!diff) {
      throw new Error(`There is no record of what ${shortName(url)} held`);
    }
    let { lines, complete } = parseCompactDiff(diff);
    if (!complete) {
      throw new Error(`The change to ${shortName(url)} is too long to undo`);
    }
    let current = await files.read(url);
    if (current === undefined) {
      throw new Error(`${shortName(url)} is gone`);
    }
    if (lines.every((line) => line.op === 'add')) {
      // every line added: the run created the file, and it must still be
      // exactly what the run wrote
      let created = lines.map((line) => line.text);
      plans.push({ url, expect: { text: joinLike(current, created) } });
      continue;
    }
    let restored = current;
    for (let hunk of hunks(lines)) {
      let afterText = hunk
        .filter((l) => l.op !== 'del')
        .map((l) => l.text)
        .join('\n');
      let beforeText = hunk
        .filter((l) => l.op !== 'add')
        .map((l) => l.text)
        .join('\n');
      let at = restored.indexOf(afterText);
      if (at < 0 || restored.indexOf(afterText, at + 1) >= 0) {
        throw new Error(`${shortName(url)} changed since the run`);
      }
      restored =
        restored.slice(0, at) +
        beforeText +
        restored.slice(at + afterText.length);
    }
    plans.push({ url, restore: restored, expect: { text: current } });
  }
  return plans;
}

/** Checks every file first and changes nothing when one has moved on, then
 * puts each back. Returns what it restored, for the receipt. */
export async function applyUndo(
  plans: UndoPlan[],
  files: UndoFiles,
): Promise<string> {
  for (let plan of plans) {
    let { expect } = plan;
    if ('sha256' in expect) {
      if ((await files.binaryDigest(plan.url)) !== expect.sha256) {
        throw new Error(`${shortName(plan.url)} changed since the run`);
      }
    } else {
      let current = await files.read(plan.url);
      let unchanged =
        'missing' in expect
          ? current === undefined
          : current !== undefined && current === expect.text;
      if (!unchanged) {
        throw new Error(`${shortName(plan.url)} changed since the run`);
      }
    }
  }
  let restored = 0;
  let removed = 0;
  for (let plan of plans) {
    if (plan.restore === undefined) {
      await files.delete(plan.url);
      removed++;
    } else {
      await files.write(plan.url, plan.restore);
      restored++;
    }
  }
  let parts = [
    restored ? `restored ${count(restored, 'file')}` : '',
    removed ? `removed ${count(removed, 'new file')}` : '',
  ].filter(Boolean);
  let text = parts.join(', ');
  return text ? text[0]!.toUpperCase() + text.slice(1) : 'Nothing to undo';
}

/** Undo's file access over the realm's own source API: a read sees what the
 * realm holds now, never a cached copy. */
export function realmUndoFiles(deps: {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  saveSource: (url: string, content: string) => Promise<unknown>;
  deleteSource: (url: string) => Promise<unknown>;
}): UndoFiles {
  let get = async (url: string) => {
    let response = await deps.fetch(url, {
      headers: { Accept: 'application/vnd.card+source' },
      cache: 'no-store',
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Could not read ${shortName(url)} (HTTP ${response.status})`,
      );
    }
    return response;
  };
  return {
    read: async (url) => (await (await get(url))?.text()) ?? undefined,
    write: async (url, content) => {
      await deps.saveSource(url, content);
    },
    delete: async (url) => {
      await deps.deleteSource(url);
    },
    binaryDigest: async (url) => {
      let response = await get(url);
      if (!response) {
        return undefined;
      }
      let digest = await crypto.subtle.digest(
        'SHA-256',
        await response.arrayBuffer(),
      );
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    },
  };
}

function hunks(lines: DiffLine[]): DiffLine[][] {
  let out: DiffLine[][] = [[]];
  for (let line of lines) {
    if (line.skip) {
      out.push([]);
    } else {
      out[out.length - 1]!.push(line);
    }
  }
  return out.filter((hunk) => hunk.some((line) => line.op));
}

// The created file's text as the diff gives it, with the file's own final
// newline when it has one: the diff drops it.
function joinLike(current: string, lines: string[]): string {
  let text = lines.join('\n');
  return current.endsWith('\n') ? `${text}\n` : text;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function shortName(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}
