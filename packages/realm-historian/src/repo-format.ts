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

// The largest output a git command may return: above a file's largest
// allowed size (50 MB for video), so a blob read whole always fits.
export const GIT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

// Runs a git command against the repo and returns its standard output as
// bytes, so blob content and NUL-separated listings come back unaltered.
// Aborting `signal` sends git SIGTERM, on which git removes its lock files,
// and rejects with an `AbortError`.
export async function runGit(
  gitDir: string,
  args: string[],
  { signal }: { signal?: AbortSignal } = {},
): Promise<Buffer> {
  let { stdout } = await execFileAsync(
    'git',
    [`--git-dir=${gitDir}`, ...args],
    {
      encoding: 'buffer',
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      signal,
    },
  );
  return stdout;
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
// revision's events changed, with its status, superseded paths included:
// the subject names what was written, whether or not the content was kept.
// `writeCount` is the number of change events the revision covers;
// `contentNotKept` says every path was superseded, so the revision records
// that the writes happened and nothing of their content.
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
    throw new Error('a revision subject needs at least one change');
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

// A message's trailer block: its last paragraph, when the message has more
// than one and every line of the last is a trailer, with the paragraphs
// before it. Undefined for a message with no trailer block.
function trailerBlock(
  message: string,
): { before: string; lines: string[] } | undefined {
  let paragraphs = message.trimEnd().split(/\n\s*\n/);
  if (paragraphs.length < 2) {
    return undefined;
  }
  let lines = paragraphs[paragraphs.length - 1].split('\n');
  if (!lines.every((line) => TRAILER_LINE.test(line))) {
    return undefined;
  }
  return { before: paragraphs.slice(0, -1).join('\n\n'), lines };
}

// The `Boxel-*` trailers of a message's trailer block. Unknown trailers are
// left out.
export function parseTrailers(message: string): Trailers {
  let trailers: Trailers = {};
  for (let line of trailerBlock(message)?.lines ?? []) {
    let [, name, value] = TRAILER_LINE.exec(line)!;
    let key = KEY_BY_NAME.get(name);
    if (key) {
      (trailers[key] ??= []).push(value);
    }
  }
  return trailers;
}

// The message without its trailer block, or the whole message when it has
// none.
export function messageWithoutTrailers(message: string): string {
  return trailerBlock(message)?.before ?? message.trimEnd();
}

// `Boxel-Journal-Seq`: the change events a revision covers, as the `seq` of
// its first and last events in the realm's journal order, `<first>-<last>`,
// or the one `seq` of a revision that covers one event. The journal is read
// in `(xid, seq)` order, which can differ from `seq` order between two
// overlapping writes, so the range names the realm's events from the first
// through the last in that order, not every `seq` between the two numbers.
// Revisions cover unbroken runs of the realm's events, so no event falls in
// two revisions' ranges.
export interface JournalSeqRange {
  first: number;
  last: number;
}

export function formatJournalSeq({ first, last }: JournalSeqRange): string {
  return first === last ? `${first}` : `${first}-${last}`;
}

export function parseJournalSeq(value: string): JournalSeqRange | undefined {
  let match = /^(\d+)(?:-(\d+))?$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  let first = Number(match[1]);
  let last = match[2] === undefined ? first : Number(match[2]);
  return { first, last };
}

// `Boxel-Includes-Superseded`: a path whose diff in this revision also
// contains a superseded write's change, and the revision that recorded that
// write, as `<revision> <path>`. The revision comes first because a path may
// hold a space.
export interface IncludedSuperseded {
  revision: string;
  path: string;
}

export function formatIncludesSuperseded({
  revision,
  path,
}: IncludedSuperseded): string {
  return `${revision} ${path}`;
}

export function parseIncludesSuperseded(
  value: string,
): IncludedSuperseded | undefined {
  let match = /^([0-9a-f]{40}) (.+)$/.exec(value);
  return match ? { revision: match[1], path: match[2] } : undefined;
}

export interface RevisionRecord {
  id: string;
  message: string;
  trailers: Trailers;
  // The realm paths the revision changed: a size-only entry counts as its
  // file's path, not its marker's.
  changedPaths: string[];
}

// The revisions `git log` lists for `revisionArgs` (such as `<old>..<new>`,
// or `-n 100 <head>`), newest first, each with its trailers and the paths
// it changed, from one git process.
export async function readRevisions(
  gitDir: string,
  revisionArgs: string[],
): Promise<RevisionRecord[]> {
  let output = (
    await runGit(gitDir, [
      // A root revision's paths are listed whatever the user's git config
      // says, and the output is never colored.
      '-c',
      'log.showRoot=true',
      'log',
      '--no-color',
      '-z',
      '--raw',
      '--no-abbrev',
      '--no-renames',
      '--format=%H%x00%B',
      ...revisionArgs,
      '--',
    ])
  ).toString('utf8');
  return parseRawLog(output, 2).map(({ fields: [id, message], entries }) => ({
    id,
    message,
    trailers: parseTrailers(message),
    changedPaths: [...new Set(entries.map((entry) => realmPathOf(entry.path)))],
  }));
}

// One path a revision changed, as `git log --raw` prints it: the modes and
// object ids before and after (zeros for none) and git's status letter.
export interface RawEntry {
  srcMode: string;
  dstMode: string;
  srcId: string;
  dstId: string;
  status: string;
  path: string;
}

// The revisions in the output of `git log -z --raw` with a `--format` of
// `fieldCount` fields, each ended by `%x00`. With `-z`, each revision is its
// fields, each ended by a NUL, then, for a revision that changed anything, a
// newline and one raw entry per path: `:<modes> <ids> <status>` and the
// path, each ended by a NUL. The first field is the revision's id, which
// starts with a hex digit, and a raw entry starts with `:`, which is how the
// next revision is told from the next entry.
export function parseRawLog(
  output: string,
  fieldCount: number,
): { fields: string[]; entries: RawEntry[] }[] {
  let revisions: { fields: string[]; entries: RawEntry[] }[] = [];
  let position = 0;
  let next = (): string => {
    let end = output.indexOf('\0', position);
    if (end === -1) {
      end = output.length;
    }
    let token = output.slice(position, end);
    position = end + 1;
    return token;
  };
  while (position < output.length) {
    let fields: string[] = [];
    for (let index = 0; index < fieldCount; index++) {
      fields.push(next());
    }
    let entries: RawEntry[] = [];
    if (output[position] === '\n') {
      position++;
    }
    while (output[position] === ':') {
      let [srcMode, dstMode, srcId, dstId, status] = next().slice(1).split(' ');
      entries.push({ srcMode, dstMode, srcId, dstId, status, path: next() });
    }
    revisions.push({ fields, entries });
  }
  return revisions;
}

// The realm path a repo path stands for: a size-only entry's marker stands
// for the entry's own path.
function realmPathOf(repoPath: string): string {
  let suffix = `/${SIZE_ONLY_MARKER_NAME}`;
  return repoPath.endsWith(suffix)
    ? repoPath.slice(0, -suffix.length)
    : repoPath;
}

// A size-only entry: the shape of an appended file above the size threshold,
// whose content history does not keep. It is a tree with the file's name,
// holding one marker blob, so it can't be mistaken for the file's content.
// The marker's first line names the shape and its version, and a later shape
// such as chunked storage can take the same form with a marker of its own.
// The marker's name is reserved: no realm file of that name is recorded, so
// a tree holding only a blob of that name is always a size-only entry.
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
