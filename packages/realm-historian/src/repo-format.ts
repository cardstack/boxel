// The history repo format: one bare git repo per realm, keyed by the realm's
// permanent registry id, with a linear `refs/heads/main`; the author and
// committer identities; the generated commit message and its `Boxel-*`
// trailers, which are the metadata contract the reader parses; and the
// size-only entry, the shape a large appended file takes when its content is
// not kept.

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SYSTEM_AUTHOR, TRAILERS } from '@cardstack/runtime-common';
import { BLOB_MODE, type Identity, type ObjectStore } from './git-objects.ts';

const execFileAsync = promisify(execFile);

export const MAIN_REF = 'refs/heads/main';

export const COMMITTER_NAME = 'realm-historian';

export function repoPath(historyRoot: string, realmId: string): string {
  return join(historyRoot, `${realmId}.git`);
}

// Creates an empty bare repo at `gitDir`, or leaves an existing one alone.
export async function initRepo(gitDir: string): Promise<void> {
  await mkdir(join(gitDir, 'objects', 'info'), { recursive: true });
  await mkdir(join(gitDir, 'objects', 'pack'), { recursive: true });
  await mkdir(join(gitDir, 'refs', 'heads'), { recursive: true });
  await mkdir(join(gitDir, 'refs', 'tags'), { recursive: true });
  await writeFile(join(gitDir, 'HEAD'), `ref: ${MAIN_REF}\n`, {
    flag: 'wx',
  }).catch(ignoreExisting);
  await writeFile(
    join(gitDir, 'config'),
    '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n',
    { flag: 'wx' },
  ).catch(ignoreExisting);
}

function ignoreExisting(error: any): void {
  if (error?.code !== 'EEXIST') {
    throw error;
  }
}

// The commit `refs/heads/main` names, or undefined in a repo with no commit.
// Read through git, so a ref that `git pack-refs` has moved out of its loose
// file is still found.
export async function readMain(gitDir: string): Promise<string | undefined> {
  try {
    let { stdout } = await execFileAsync('git', [
      `--git-dir=${gitDir}`,
      'rev-parse',
      '--verify',
      '--quiet',
      MAIN_REF,
    ]);
    return stdout.trim();
  } catch (error: any) {
    if (error?.code === 1 && !error.stdout) {
      return undefined;
    }
    throw error;
  }
}

// Moves `refs/heads/main` to `newId`, and only from `oldId` (or from no
// commit when `oldId` is undefined): git's compare-and-swap, so two writers
// can't fork the history. Rejects when the ref has moved.
export async function updateMain(
  gitDir: string,
  newId: string,
  oldId: string | undefined,
): Promise<void> {
  await execFileAsync('git', [
    `--git-dir=${gitDir}`,
    'update-ref',
    MAIN_REF,
    newId,
    oldId ?? '0'.repeat(40),
  ]);
}

// The git author: the Matrix user id, or `boxel-system`, as both name and
// email. `occurredAt` is the last write's time.
export function authorIdentity(
  author: string | undefined,
  occurredAt: string | Date,
): Identity {
  let name = author ?? SYSTEM_AUTHOR;
  return { name, email: name, timestamp: seconds(occurredAt) };
}

export function committerIdentity(now: Date = new Date()): Identity {
  return {
    name: COMMITTER_NAME,
    email: COMMITTER_NAME,
    timestamp: seconds(now),
  };
}

function seconds(time: string | Date): number {
  let ms = time instanceof Date ? time.getTime() : Date.parse(time);
  if (Number.isNaN(ms)) {
    throw new Error(`invalid time ${JSON.stringify(time)}`);
  }
  return Math.floor(ms / 1000);
}

// What a revision's subject line is made from. `changes` is every path the
// revision records, with its status; `writeCount` is the number of change
// events the revision covers; `contentNotKept` says every path was
// superseded, so the revision records that the writes happened and nothing
// of their content.
export type RevisionSubject =
  | { kind: 'changes'; changes: { path: string; status: 'A' | 'M' | 'D' }[] }
  | { kind: 'revert'; path: string; revision: string }
  | { kind: 'deploy'; source: string; commit: string }
  | { kind: 'initial-snapshot' }
  | { kind: 'unattributed' }
  | { kind: 'unattributed-external' };

export interface RevisionMessageInput {
  subject: RevisionSubject;
  writeCount?: number;
  contentNotKept?: boolean;
}

export function revisionMessage({
  subject,
  writeCount = 1,
  contentNotKept = false,
}: RevisionMessageInput): string {
  let text = subjectText(subject);
  if (writeCount > 1) {
    text += ` (${writeCount} writes)`;
  }
  if (contentNotKept) {
    text += ' (content not kept)';
  }
  return text;
}

const VERBS = { A: 'Add', M: 'Update', D: 'Delete' } as const;
const LOWER_VERBS = { A: 'add', M: 'update', D: 'delete' } as const;

function subjectText(subject: RevisionSubject): string {
  switch (subject.kind) {
    case 'revert':
      return `Revert ${subject.path} to ${subject.revision.slice(0, 7)}`;
    case 'deploy':
      return `Deploy ${subject.source}@${subject.commit}`;
    case 'initial-snapshot':
      return 'Initial snapshot';
    case 'unattributed':
      return 'Unattributed changes';
    case 'unattributed-external':
      return 'Unattributed external changes';
    case 'changes':
      return changesText(subject.changes);
  }
}

// `Update Author/jane.json`, `Update 3 files in Author/`, or, when the
// statuses mix, `Add 1 file, update 2 and delete 1 in Author/`. The
// directory is the paths' common parent, left out at the root.
function changesText(
  changes: { path: string; status: 'A' | 'M' | 'D' }[],
): string {
  if (changes.length === 0) {
    return 'No changes';
  }
  if (changes.length === 1) {
    let [{ path, status }] = changes;
    return `${VERBS[status]} ${path}`;
  }
  let directory = commonDirectory(changes.map((change) => change.path));
  let where = directory ? ` in ${directory}` : '';
  let counts = { A: 0, M: 0, D: 0 };
  for (let { status } of changes) {
    counts[status]++;
  }
  let present = (['A', 'M', 'D'] as const).filter(
    (status) => counts[status] > 0,
  );
  if (present.length === 1) {
    let [status] = present;
    return `${VERBS[status]} ${counts[status]} files${where}`;
  }
  let parts = present.map((status, index) => {
    let count = counts[status];
    return index === 0
      ? `${VERBS[status]} ${count} ${count === 1 ? 'file' : 'files'}`
      : `${LOWER_VERBS[status]} ${count}`;
  });
  let last = parts.pop()!;
  return `${parts.join(', ')} and ${last}${where}`;
}

// The longest directory every path is under, with its trailing slash, or ''.
export function commonDirectory(paths: string[]): string {
  let directories = paths.map((path) =>
    path.slice(0, path.lastIndexOf('/') + 1),
  );
  let common = directories[0] ?? '';
  for (let directory of directories.slice(1)) {
    while (common && !directory.startsWith(common)) {
      common = common.slice(0, common.lastIndexOf('/', common.length - 2) + 1);
    }
  }
  return common;
}

export type TrailerKey = keyof typeof TRAILERS;

// Trailer values by key. A key with several values is written as that many
// lines, which is how git carries a multi-valued trailer.
export type Trailers = Partial<Record<TrailerKey, string[]>>;

export function formatTrailers(trailers: Trailers): string {
  let lines: string[] = [];
  for (let key of Object.keys(TRAILERS) as TrailerKey[]) {
    for (let value of trailers[key] ?? []) {
      if (/[\n]/.test(value)) {
        throw new Error(`invalid trailer value ${JSON.stringify(value)}`);
      }
      lines.push(`${TRAILERS[key]}: ${value}`);
    }
  }
  return lines.join('\n');
}

// The subject, a blank line, and the trailer block: the message's last
// paragraph, where git looks for trailers.
export function buildMessage(subject: string, trailers: Trailers): string {
  let block = formatTrailers(trailers);
  return block ? `${subject}\n\n${block}\n` : `${subject}\n`;
}

// The value runs to the end of the line, whatever it holds: `.` would stop at
// a carriage return or a Unicode line separator, which a realm path can carry.
const TRAILER_LINE = /^([A-Za-z][A-Za-z0-9-]*): ([^\n]*)$/;
const KEY_BY_NAME = new Map(
  (Object.entries(TRAILERS) as [TrailerKey, string][]).map(([key, name]) => [
    name,
    key,
  ]),
);

// The `Boxel-*` trailers of a message: the lines of its last paragraph, when
// every line there is a trailer. Unknown trailers are left out.
export function parseTrailers(message: string): Trailers {
  let paragraphs = message.trimEnd().split(/\n\s*\n/);
  let last = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : '';
  let trailers: Trailers = {};
  let lines = last.split('\n');
  if (!lines.every((line) => TRAILER_LINE.test(line))) {
    return trailers;
  }
  for (let line of lines) {
    let [, name, value] = TRAILER_LINE.exec(line)!;
    let key = KEY_BY_NAME.get(name);
    if (key) {
      (trailers[key] ??= []).push(value);
    }
  }
  return trailers;
}

// A size-only entry: the shape of an appended file above the size threshold,
// whose content history does not keep. It is a tree with the file's name,
// holding one marker blob, so it can't be mistaken for the file's content.
// The marker's first line names the shape and its version, and a later shape
// such as chunked storage can take the same form with a marker of its own.
export const SIZE_ONLY_MARKER_NAME = '.realm-history-size-only';
export const SIZE_ONLY_FORMAT = 'realm-history-size-only';
export const SIZE_ONLY_VERSION = 1;

export interface SizeOnlyEntry {
  size: number;
  // The `content-hash.ts` fingerprint the change event carries.
  fingerprint: string;
}

export function sizeOnlyMarker({ size, fingerprint }: SizeOnlyEntry): string {
  return `${SIZE_ONLY_FORMAT} ${SIZE_ONLY_VERSION}\nsize ${size}\nfingerprint ${fingerprint}\n`;
}

// The entry a marker blob describes, or undefined for any other content.
export function parseSizeOnlyMarker(
  content: string | Uint8Array,
): SizeOnlyEntry | undefined {
  let text =
    typeof content === 'string' ? content : new TextDecoder().decode(content);
  let [header, ...rest] = text.split('\n');
  if (header !== `${SIZE_ONLY_FORMAT} ${SIZE_ONLY_VERSION}`) {
    return undefined;
  }
  let fields = new Map<string, string>();
  for (let line of rest) {
    let space = line.indexOf(' ');
    if (space > 0) {
      fields.set(line.slice(0, space), line.slice(space + 1));
    }
  }
  let size = Number(fields.get('size'));
  let fingerprint = fields.get('fingerprint');
  if (!Number.isInteger(size) || size < 0 || !fingerprint) {
    return undefined;
  }
  return { size, fingerprint };
}

// Writes the marker blob and its tree, and returns the tree's id, which goes
// into the parent tree under the file's name with `TREE_MODE`.
export async function writeSizeOnlyEntry(
  store: ObjectStore,
  entry: SizeOnlyEntry,
): Promise<string> {
  let { id: blob } = await store.writeBlob(sizeOnlyMarker(entry));
  let { id } = await store.writeTree([
    { mode: BLOB_MODE, name: SIZE_ONLY_MARKER_NAME, id: blob },
  ]);
  return id;
}
