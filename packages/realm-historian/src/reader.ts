// The realm server's reader of realm history. It reads a realm's repo with
// read-only git commands, straight from the shared file system, and never
// calls realm-historian: git objects never change once written and
// `refs/heads/main` moves by atomic rename, so a read sees either the old
// HEAD or the new one.
//
// Each read pins `refs/heads/main` once and runs every later command against
// that commit, so a revision committed mid-read never shifts a page.
//
// Listing is `git log` over path filters. git consults the commit-graph's
// changed-path Bloom filters for one path filter, and from git 2.51 for
// several. With `bloomWithSeveralPaths` off, several filters are listed one
// `git log` each, so each keeps its Bloom filter, and the results are merged
// in history order.

import { stat } from 'node:fs/promises';
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  TRAILERS,
  type ChangeStatus,
  type DiffOmitted,
  type ReadAtRevisionResult,
  type ReadHistoryParams,
  type ReadHistoryResult,
  type ReadTreeAtRevisionResult,
  type RealmHistoryReader,
  type RevisionChange,
  type RevisionSummary,
  type TreeFileAtRevision,
} from '@cardstack/runtime-common';
import {
  DEFAULT_GIT_TIMEOUT_MS,
  DEFAULT_MAX_GIT_PROCESSES,
  GitProcesses,
} from './git-process.ts';
import {
  MAIN_REF,
  messageWithoutTrailers,
  parseIncludesSuperseded,
  parseRawLog,
  parseSizeOnlyMarker,
  parseTrailers,
  repoPath,
  SIZE_ONLY_MARKER_NAME,
  type RawEntry,
  type TrailerKey,
  type Trailers,
} from './repo-format.ts';

export const DEFAULT_MAX_DIFF_BYTES_PER_FILE = 64 * 1024;
export const DEFAULT_DIFF_BUDGET_BYTES = 1024 * 1024;
export const DEFAULT_MAX_FILE_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface GitRealmHistoryReaderOptions {
  historyRoot: string;
  // How many git processes the reader runs at once, across every read.
  maxProcesses?: number;
  // How long one git process may run before it is killed.
  processTimeoutMs?: number;
  // A text file's diff larger than this is left out of a listing.
  maxDiffBytesPerFile?: number;
  // The diffs one listing may return in all. Past it, diffs are left out
  // and the listing says so with `diffsTruncated`.
  diffBudgetBytes?: number;
  // The largest file `readAtRevision` returns whole, and the largest range.
  maxFileResponseBytes?: number;
  // Whether the git in use consults Bloom filters with several path
  // filters (git 2.51 and later). Off, several filters are listed one at a
  // time and merged, which is correct on any git.
  bloomWithSeveralPaths?: boolean;
  gitBinary?: string;
}

// A request the reader refuses as malformed, such as a `limit` above
// `MAX_HISTORY_LIMIT` or a path with a `..` segment.
export class HistoryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryRequestError';
  }
}

const NO_OBJECT = '0'.repeat(40);
const TREE_MODE = '040000';
const ABSENT_MODE = '000000';
const MARKER_SUFFIX = `/${SIZE_ONLY_MARKER_NAME}`;
const REVISION_PATTERN = /^[0-9a-f]{4,40}$/;
const OBJECT_ID_PATTERN = /^[0-9a-f]{40}$/;
const REALM_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
// The fields of each revision `git log` prints, NUL-separated: id, parents,
// author name, author date in seconds, and the message.
const LOG_FORMAT = '--format=%H%x00%P%x00%an%x00%at%x00%B';
const LOG_FIELD_COUNT = 5;

// A path filter: `directory` filters end in `/` and match only what is
// under them; the others match a file of that path or anything under a
// directory of that path, as a literal git pathspec does.
interface PathFilter {
  path: string;
  directory: boolean;
}

// The whole realm, or a list of filters.
type Filters = PathFilter[] | 'all';

interface LogRecord {
  id: string;
  parent?: string;
  author: string;
  time: number;
  message: string;
  trailers: Trailers;
  entries: RawEntry[];
}

// One side of a change: a blob, or a size-only entry's tree with its
// marker blob.
interface Side {
  id: string;
  markerId?: string;
}

interface Change {
  path: string;
  status: ChangeStatus;
  before?: Side;
  after?: Side;
}

interface Listed {
  record: LogRecord;
  changes: Change[];
  // An inserted revision: a superseded write's, listed without changes
  // after the revision whose diff contains it.
  inserted?: boolean;
}

interface ListingQuery {
  filters: Filters;
  status?: ChangeStatus;
  correlationId?: string;
}

export class GitRealmHistoryReader implements RealmHistoryReader {
  #historyRoot: string;
  #git: GitProcesses;
  #maxDiffBytesPerFile: number;
  #diffBudgetBytes: number;
  #maxFileResponseBytes: number;
  #bloomWithSeveralPaths: boolean;

  constructor({
    historyRoot,
    maxProcesses = DEFAULT_MAX_GIT_PROCESSES,
    processTimeoutMs = DEFAULT_GIT_TIMEOUT_MS,
    maxDiffBytesPerFile = DEFAULT_MAX_DIFF_BYTES_PER_FILE,
    diffBudgetBytes = DEFAULT_DIFF_BUDGET_BYTES,
    maxFileResponseBytes = DEFAULT_MAX_FILE_RESPONSE_BYTES,
    bloomWithSeveralPaths = false,
    gitBinary,
  }: GitRealmHistoryReaderOptions) {
    this.#historyRoot = historyRoot;
    this.#git = new GitProcesses({
      gitBinary,
      maxProcesses,
      timeoutMs: processTimeoutMs,
    });
    this.#maxDiffBytesPerFile = maxDiffBytesPerFile;
    this.#diffBudgetBytes = diffBudgetBytes;
    this.#maxFileResponseBytes = maxFileResponseBytes;
    this.#bloomWithSeveralPaths = bloomWithSeveralPaths;
  }

  async readHistory(
    realmId: string,
    params: ReadHistoryParams,
  ): Promise<ReadHistoryResult> {
    let limit = params.limit ?? DEFAULT_HISTORY_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
      throw new HistoryRequestError(
        `limit must be an integer from 1 to ${MAX_HISTORY_LIMIT}, not ${limit}`,
      );
    }
    let query: ListingQuery = {
      filters: pathFilters(params.paths),
      status: statusFilter(params.status),
      correlationId: correlationFilter(params.correlationId),
    };
    let gitDir = this.#gitDir(realmId);
    let main = await this.#main(gitDir);
    let before: string | undefined;
    if (params.before !== undefined) {
      before = main
        ? await this.#resolveOnMain(gitDir, main, params.before)
        : undefined;
      if (!before) {
        return { kind: 'revision-not-found' };
      }
    }
    if (!main || (query.filters !== 'all' && query.filters.length === 0)) {
      return { kind: 'history', revisions: [], hasMore: false };
    }

    let start: string | undefined = main;
    let pending: Listed[] = [];
    if (before) {
      ({ start, pending } = await this.#continueAfter(
        gitDir,
        main,
        before,
        query,
      ));
    }

    let natural = start
      ? await this.#list(gitDir, start, limit + 1, query)
      : { listed: [], more: false };
    let items: Listed[] = [...pending];
    let insertions = await this.#insertions(
      gitDir,
      natural.listed.map(({ record }) => record),
      query,
    );
    for (let listed of natural.listed) {
      items.push(listed);
      items.push(...(insertions.get(listed.record.id) ?? []));
    }
    let seen = new Set<string>();
    items = items.filter(({ record }) => {
      if (seen.has(record.id)) {
        return false;
      }
      seen.add(record.id);
      return true;
    });
    let hasMore = natural.more || items.length > limit;
    let page = items.slice(0, limit);

    let sizes = await this.#sizes(gitDir, page);
    let diffs =
      (params.includeDiffs ?? true)
        ? await this.#diffs(gitDir, page, query)
        : undefined;
    return {
      kind: 'history',
      revisions: page.map((listed) => summary(listed, sizes, diffs?.diffs)),
      hasMore,
      ...(diffs?.truncated ? { diffsTruncated: true } : {}),
    };
  }

  async readAtRevision(
    realmId: string,
    revision: string,
    path: string,
    range?: { start: number; length: number },
  ): Promise<ReadAtRevisionResult> {
    let { path: target, directory } = readPath(path);
    if (range) {
      validateRange(range);
    }
    let gitDir = this.#gitDir(realmId);
    let main = await this.#main(gitDir);
    let commit = main
      ? await this.#resolveOnMain(gitDir, main, revision)
      : undefined;
    if (!commit) {
      return { kind: 'revision-not-found' };
    }
    let [object] = await this.#describe(gitDir, [
      target === '' ? `${commit}^{tree}` : `${commit}:${target}`,
    ]);
    if (!object) {
      return {
        kind: (await this.#everExisted(gitDir, commit, target, directory))
          ? 'path-deleted-at-revision'
          : 'path-not-found-at-revision',
      };
    }
    if (object.type === 'tree') {
      let entries = await this.#treeEntries(gitDir, object.id);
      let marker = sizeOnlyMarkerOf(entries);
      if (marker) {
        if (directory) {
          return { kind: 'path-not-found-at-revision' };
        }
        let [size] = await this.#markerSizes(gitDir, [marker]);
        return { kind: 'content-not-kept', size: size ?? 0 };
      }
      return {
        kind: 'directory',
        entries: await this.#listing(gitDir, object.id, entries),
      };
    }
    if (object.type !== 'blob' || directory) {
      return { kind: 'path-not-found-at-revision' };
    }
    if (range) {
      if (range.length > this.#maxFileResponseBytes) {
        return { kind: 'too-large', size: object.size };
      }
      let start = Math.min(range.start, object.size);
      let length = Math.min(range.length, object.size - start);
      let bytes =
        length > 0
          ? await this.#readRange(gitDir, object.id, start, length)
          : Buffer.alloc(0);
      return {
        kind: 'file',
        content: bytes.toString('base64'),
        binary: true,
        size: object.size,
        range: { start, length: bytes.byteLength },
      };
    }
    if (object.size > this.#maxFileResponseBytes) {
      return { kind: 'too-large', size: object.size };
    }
    let { stdout } = await this.#git.run(gitDir, [
      'cat-file',
      'blob',
      object.id,
    ]);
    let text = utf8Text(stdout);
    return text === undefined
      ? {
          kind: 'file',
          content: stdout.toString('base64'),
          binary: true,
          size: object.size,
        }
      : { kind: 'file', content: text, binary: false, size: object.size };
  }

  async readTreeAtRevision(
    realmId: string,
    revision: string,
    path = '/',
  ): Promise<ReadTreeAtRevisionResult> {
    let { path: target, directory } = readPath(path);
    let gitDir = this.#gitDir(realmId);
    let main = await this.#main(gitDir);
    let commit = main
      ? await this.#resolveOnMain(gitDir, main, revision)
      : undefined;
    if (!commit) {
      return { kind: 'revision-not-found' };
    }
    let pathspec = target === '' ? [] : [directory ? `${target}/` : target];
    let { stdout } = await this.#git.run(gitDir, [
      'ls-tree',
      '-r',
      '-t',
      '-l',
      '-z',
      '--full-tree',
      commit,
      '--',
      ...pathspec,
    ]);
    let trees = new Map<string, string>();
    let blobs: { path: string; id: string; size: number }[] = [];
    let markers = new Map<string, string>();
    for (let record of stdout.toString('utf8').split('\0')) {
      if (record === '') {
        continue;
      }
      // `<mode> <type> <id> <size>\t<path>`, the size padded with spaces.
      let tab = record.indexOf('\t');
      let [, type, id, size] = record.slice(0, tab).split(/ +/);
      let entryPath = record.slice(tab + 1);
      if (type === 'tree') {
        trees.set(entryPath, id);
      } else if (type === 'blob') {
        if (entryPath.endsWith(MARKER_SUFFIX)) {
          markers.set(entryPath.slice(0, -MARKER_SUFFIX.length), id);
        } else {
          blobs.push({ path: entryPath, id, size: Number(size) });
        }
      }
    }
    let files: TreeFileAtRevision[] = blobs;
    if (markers.size > 0) {
      let paths = [...markers.keys()];
      let sizes = await this.#markerSizes(
        gitDir,
        paths.map((entryPath) => markers.get(entryPath)!),
      );
      files = [
        ...files,
        ...paths.map((entryPath, index) => ({
          path: entryPath,
          id: trees.get(entryPath)!,
          size: sizes[index] ?? 0,
          sizeOnly: true as const,
        })),
      ];
    }
    if (files.length === 0 && target !== '') {
      return {
        kind: (await this.#everExisted(gitDir, commit, target, directory))
          ? 'path-deleted-at-revision'
          : 'path-not-found-at-revision',
      };
    }
    files.sort((a, b) => compare(a.path, b.path));
    return { kind: 'tree', files };
  }

  #gitDir(realmId: string): string {
    if (!REALM_ID_PATTERN.test(realmId)) {
      throw new HistoryRequestError(
        `invalid realm id ${JSON.stringify(realmId)}`,
      );
    }
    return repoPath(this.#historyRoot, realmId);
  }

  // The commit `refs/heads/main` names, or undefined when the realm has no
  // repo or no revision yet.
  async #main(gitDir: string): Promise<string | undefined> {
    if (!(await exists(gitDir))) {
      return undefined;
    }
    let { stdout, exitCode } = await this.#git.run(
      gitDir,
      ['rev-parse', '--verify', '--quiet', MAIN_REF],
      { okExitCodes: [1] },
    );
    return exitCode === 0 ? stdout.toString('utf8').trim() : undefined;
  }

  // The full id of `revision` when it names a revision on `main`. A commit
  // that isn't on `main`, such as one written before its ref update failed,
  // isn't in the realm's history.
  async #resolveOnMain(
    gitDir: string,
    main: string,
    revision: string,
  ): Promise<string | undefined> {
    if (!REVISION_PATTERN.test(revision)) {
      return undefined;
    }
    let resolved = await this.#git.run(
      gitDir,
      ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`],
      { okExitCodes: [1, 128] },
    );
    if (resolved.exitCode !== 0) {
      return undefined;
    }
    let id = resolved.stdout.toString('utf8').trim();
    let { exitCode } = await this.#git.run(
      gitDir,
      ['merge-base', '--is-ancestor', id, main],
      { okExitCodes: [1] },
    );
    return exitCode === 0 ? id : undefined;
  }

  // Where a listing resumes after `before`: just below it, after the
  // revisions inserted after it. A `before` that is itself an inserted
  // revision resumes after the revision it was inserted after, with the
  // insertions that followed it there.
  async #continueAfter(
    gitDir: string,
    main: string,
    before: string,
    query: ListingQuery,
  ): Promise<{ start: string | undefined; pending: Listed[] }> {
    let [record] = await this.#records(gitDir, [before]);
    if (listedChanges(record, query) !== undefined) {
      let insertions = await this.#insertions(gitDir, [record], query);
      return { start: record.parent, pending: insertions.get(record.id) ?? [] };
    }
    let host = await this.#insertedAfter(gitDir, main, record, query);
    if (host) {
      let insertions =
        (await this.#insertions(gitDir, [host], query)).get(host.id) ?? [];
      let index = insertions.findIndex(({ record: { id } }) => id === before);
      if (index !== -1) {
        return { start: host.parent, pending: insertions.slice(index + 1) };
      }
    }
    return { start: record.parent, pending: [] };
  }

  // The revisions the listing shows from `start` down: `count` that change a
  // path under the filters, each with its changes there, or every one left.
  //
  // `git log -n` counts revisions the listing then drops: with `-t`, a
  // directory's tree is an entry of its own, so `--diff-filter=M` matches a
  // revision that only adds a file to a directory, and either half of a
  // size-only conversion matches `A` or `D`. So the walk goes on below the
  // oldest revision git printed until `count` are listed or git has no
  // more, and `more` says git may have more.
  async #list(
    gitDir: string,
    start: string,
    count: number,
    query: ListingQuery,
  ): Promise<{ listed: Listed[]; more: boolean }> {
    let { filters } = query;
    let listed: Listed[] = [];
    let from: string | undefined = start;
    let more = false;
    while (from && listed.length < count) {
      let records: LogRecord[] =
        filters !== 'all' && filters.length > 1 && !this.#bloomWithSeveralPaths
          ? await this.#listOneFilterAtATime(gitDir, from, count, query)
          : await this.#log(gitDir, from, count, query, filters);
      let below: string | undefined =
        records.length >= count
          ? records[records.length - 1].parent
          : undefined;
      more = below !== undefined;
      let batch: Listed[] = [];
      for (let record of records) {
        let changes = listedChanges(record, query);
        if (changes) {
          batch.push({ record, changes });
        }
      }
      if (query.status) {
        batch = await this.#withoutConversions(gitDir, batch, query.status);
      }
      listed.push(...batch);
      from = below;
    }
    return { listed, more };
  }

  async #log(
    gitDir: string,
    start: string,
    count: number,
    query: ListingQuery,
    filters: Filters,
  ): Promise<LogRecord[]> {
    let { stdout } = await this.#git.run(gitDir, [
      '-c',
      'log.showRoot=true',
      'log',
      '--no-color',
      '-z',
      '--raw',
      '-t',
      '--no-renames',
      '--no-abbrev',
      `-n`,
      `${count}`,
      LOG_FORMAT,
      ...(query.status ? [`--diff-filter=${query.status}`] : []),
      ...(query.correlationId
        ? [
            '--extended-regexp',
            `--grep=^${TRAILERS.correlationIds}: ${escapeRegExp(query.correlationId)}$`,
          ]
        : []),
      start,
      '--',
      ...pathspecs(filters),
    ]);
    return parseLog(stdout.toString('utf8'));
  }

  // Several filters, one `git log` each, merged. Each filter's newest
  // `count` revisions include every revision the combined listing's newest
  // `count` would take from it, so the union holds the combined listing's
  // first `count`. Their order is the order `git rev-list` walks them in,
  // read until it has passed `count` of them, which follows the
  // commit-graph without reading any tree.
  async #listOneFilterAtATime(
    gitDir: string,
    start: string,
    count: number,
    query: ListingQuery,
  ): Promise<LogRecord[]> {
    let filters = query.filters as PathFilter[];
    let lists = await Promise.all(
      filters.map((filter) => this.#log(gitDir, start, count, query, [filter])),
    );
    let union = new Map<string, LogRecord>();
    for (let list of lists) {
      for (let record of list) {
        let existing = union.get(record.id);
        if (!existing) {
          union.set(record.id, { ...record, entries: [...record.entries] });
          continue;
        }
        let known = new Set(existing.entries.map((entry) => entry.path));
        existing.entries.push(
          ...record.entries.filter((entry) => !known.has(entry.path)),
        );
      }
    }
    let wanted = Math.min(count, union.size);
    let ordered: LogRecord[] = [];
    if (wanted === 0) {
      return ordered;
    }
    let partial = '';
    await this.#git.stream(gitDir, ['rev-list', start], (chunk) => {
      let lines = (partial + chunk.toString('utf8')).split('\n');
      partial = lines.pop()!;
      for (let line of lines) {
        let record = union.get(line);
        if (record) {
          ordered.push(record);
          if (ordered.length === wanted) {
            return true;
          }
        }
      }
      return false;
    });
    return ordered;
  }

  // A file that becomes a size-only entry, or a size-only entry that
  // becomes a file, is a delete and an add at the same path to git, so
  // `--diff-filter` can list either half alone. A deleted file still there
  // at the revision, or an added one already there before it, is such a
  // half when either side is a size-only entry, and isn't what the filter
  // asked for. `status: 'M'` lists neither half, so such a change is listed
  // only without a status filter, as the `M` it is.
  async #withoutConversions(
    gitDir: string,
    listed: Listed[],
    status: ChangeStatus,
  ): Promise<Listed[]> {
    if (status === 'M') {
      return listed;
    }
    let names: string[] = [];
    for (let { record, changes } of listed) {
      for (let change of changes) {
        let at = status === 'D' ? record.id : record.parent;
        names.push(at ? `${at}:${change.path}` : '');
        names.push(at ? `${at}:${change.path}${MARKER_SUFFIX}` : '');
      }
    }
    let objects = await this.#describe(gitDir, names);
    let index = 0;
    let kept: Listed[] = [];
    for (let { record, changes } of listed) {
      let remaining = changes.filter((change) => {
        let other = objects[index++];
        let otherMarker = objects[index++];
        let changeIsSizeOnly = Boolean(
          (change.before ?? change.after)?.markerId,
        );
        let conversion =
          other !== undefined &&
          (otherMarker !== undefined ||
            (changeIsSizeOnly && other.type === 'blob'));
        return !conversion;
      });
      if (remaining.length > 0) {
        kept.push({ record, changes: remaining });
      }
    }
    return kept;
  }

  // The revisions to list after each of `hosts`, by host id: the
  // superseded writes their `Boxel-Includes-Superseded` names under the
  // filters, which a path-filtered `git log` doesn't list because they
  // changed nothing there.
  //
  // A superseded revision is listed once in any listing, after the oldest
  // listed revision that names it under the filters. That keeps its place
  // the same on every page, and puts it just below a write to the path it
  // superseded; under a directory or several filters, a revision newer than
  // it that changed another path can come after it. A revision the filters
  // list on its own, or that a `correlationId` filter leaves out, is never
  // inserted, and nothing is inserted into a listing by `status`, since the
  // trailers don't record what kind of change the superseded write made.
  async #insertions(
    gitDir: string,
    hosts: LogRecord[],
    query: ListingQuery,
  ): Promise<Map<string, Listed[]>> {
    let insertions = new Map<string, Listed[]>();
    let { filters } = query;
    if (filters === 'all' || query.status) {
      return insertions;
    }
    let named = hosts.map((host) => ({
      host,
      revisions: [
        ...new Set(
          supersessionsUnder(host, filters).map(({ revision }) => revision),
        ),
      ],
    }));
    let ids = [...new Set(named.flatMap(({ revisions }) => revisions))];
    if (ids.length === 0) {
      return insertions;
    }
    let present = await this.#describe(gitDir, ids);
    let records = new Map(
      (
        await this.#records(
          gitDir,
          ids.filter((_, index) => present[index]?.type === 'commit'),
        )
      ).map((record) => [record.id, record]),
    );
    for (let { host, revisions } of named) {
      let listed: Listed[] = [];
      for (let revision of revisions) {
        let record = records.get(revision);
        if (
          record &&
          host.parent &&
          matchesCorrelation(record, query.correlationId) &&
          listedChanges(record, query) === undefined &&
          (await this.#namers(gitDir, record, host.parent, query)).length === 0
        ) {
          listed.push({ record, changes: [], inserted: true });
        }
      }
      if (listed.length > 0) {
        insertions.set(host.id, listed);
      }
    }
    return insertions;
  }

  // The revision a listing with these filters inserts `record` after, when
  // it inserts it: the oldest listed revision on `main` that names it.
  async #insertedAfter(
    gitDir: string,
    main: string,
    record: LogRecord,
    query: ListingQuery,
  ): Promise<LogRecord | undefined> {
    if (
      query.filters === 'all' ||
      query.status ||
      !matchesCorrelation(record, query.correlationId)
    ) {
      return undefined;
    }
    let namers = await this.#namers(gitDir, record, main, query);
    let oldest = namers[namers.length - 1];
    if (!oldest) {
      return undefined;
    }
    let [full] = await this.#records(gitDir, [oldest.id]);
    return full;
  }

  // The revisions after `superseded` up to `through`, newest first, that the
  // listing lists and that name `superseded` for a path under the filters.
  // A revision that names it records a newer write to that path, so the
  // walk is limited to the superseded paths under the filters, from
  // `superseded` itself, which keeps it short.
  async #namers(
    gitDir: string,
    superseded: LogRecord,
    through: string,
    query: ListingQuery,
  ): Promise<LogRecord[]> {
    let filters = query.filters as PathFilter[];
    let paths = (superseded.trailers.superseded ?? []).filter((path) =>
      matchesAny(path, filters),
    );
    if (paths.length === 0) {
      return [];
    }
    let { stdout } = await this.#git.run(gitDir, [
      '-c',
      'log.showRoot=true',
      'log',
      '--no-color',
      '-z',
      '--raw',
      '-t',
      '--no-renames',
      '--no-abbrev',
      LOG_FORMAT,
      '--fixed-strings',
      `--grep=${TRAILERS.includesSuperseded}: ${superseded.id} `,
      `${superseded.id}..${through}`,
      '--',
      ...paths,
    ]);
    return parseLog(stdout.toString('utf8')).filter(
      (candidate) =>
        supersessionsUnder(candidate, filters).some(
          ({ revision }) => revision === superseded.id,
        ) && listedChanges(candidate, query) !== undefined,
    );
  }

  // Each revision with every path it changed.
  async #records(gitDir: string, ids: string[]): Promise<LogRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    let { stdout } = await this.#git.run(gitDir, [
      '-c',
      'log.showRoot=true',
      'log',
      '--no-color',
      '--no-walk=unsorted',
      '-z',
      '--raw',
      '-t',
      '--no-renames',
      '--no-abbrev',
      LOG_FORMAT,
      ...ids,
      '--',
    ]);
    return parseLog(stdout.toString('utf8'));
  }

  // Each object name's id, type and size, or undefined when it names
  // nothing. An empty name is answered undefined without asking git.
  async #describe(
    gitDir: string,
    names: string[],
  ): Promise<({ id: string; type: string; size: number } | undefined)[]> {
    let asked = names.filter((name) => name !== '' && !name.includes('\n'));
    if (asked.length === 0) {
      return names.map(() => undefined);
    }
    let { stdout } = await this.#git.run(
      gitDir,
      ['cat-file', '--batch-check'],
      { input: asked.map((name) => `${name}\n`).join('') },
    );
    let lines = stdout.toString('utf8').split('\n');
    let answers = new Map<string, { id: string; type: string; size: number }>();
    asked.forEach((name, index) => {
      let [id, type, size] = lines[index].split(' ');
      if (OBJECT_ID_PATTERN.test(id) && type !== 'missing') {
        answers.set(name, { id, type, size: Number(size) });
      }
    });
    return names.map((name) => answers.get(name));
  }

  // The size each size-only marker blob records.
  async #markerSizes(
    gitDir: string,
    markerIds: string[],
  ): Promise<(number | undefined)[]> {
    let contents = await this.#contents(gitDir, markerIds);
    return markerIds.map((id) => {
      let content = contents.get(id);
      return content ? parseSizeOnlyMarker(content)?.size : undefined;
    });
  }

  // The content of each blob, from one `git cat-file --batch`.
  async #contents(gitDir: string, ids: string[]): Promise<Map<string, Buffer>> {
    let unique = [...new Set(ids)];
    let contents = new Map<string, Buffer>();
    if (unique.length === 0) {
      return contents;
    }
    let { stdout } = await this.#git.run(gitDir, ['cat-file', '--batch'], {
      input: unique.map((id) => `${id}\n`).join(''),
    });
    let position = 0;
    for (let id of unique) {
      let end = stdout.indexOf(0x0a, position);
      let [, type, size] = stdout
        .subarray(position, end)
        .toString('utf8')
        .split(' ');
      position = end + 1;
      if (type === 'missing' || size === undefined) {
        continue;
      }
      let length = Number(size);
      contents.set(id, stdout.subarray(position, position + length));
      position += length + 1;
    }
    return contents;
  }

  async #treeEntries(
    gitDir: string,
    tree: string,
  ): Promise<{ mode: string; type: string; id: string; name: string }[]> {
    let { stdout } = await this.#git.run(gitDir, ['ls-tree', '-z', tree]);
    return stdout
      .toString('utf8')
      .split('\0')
      .filter((record) => record !== '')
      .map((record) => {
        let tab = record.indexOf('\t');
        let [mode, type, id] = record.slice(0, tab).split(' ');
        return { mode, type, id, name: record.slice(tab + 1) };
      });
  }

  // A directory's listing, with each size-only entry listed as the file it
  // stands for.
  async #listing(
    gitDir: string,
    tree: string,
    entries: { type: string; name: string }[],
  ): Promise<{ name: string; kind: 'file' | 'directory' }[]> {
    let subtrees = entries.filter(({ type }) => type === 'tree');
    let markers = await this.#describe(
      gitDir,
      subtrees.map(({ name }) => `${tree}:${name}${MARKER_SUFFIX}`),
    );
    let sizeOnly = new Set(
      subtrees.filter((_, index) => markers[index]).map(({ name }) => name),
    );
    return entries
      .filter(({ type }) => type === 'blob' || type === 'tree')
      .map(({ type, name }) => ({
        name,
        kind:
          type === 'tree' && !sizeOnly.has(name)
            ? ('directory' as const)
            : ('file' as const),
      }));
  }

  // Whether `path` was in the realm at any revision up to `commit`: the
  // newest revision there that touched it, when the path is gone at
  // `commit`, is the one that deleted it.
  async #everExisted(
    gitDir: string,
    commit: string,
    path: string,
    directory: boolean,
  ): Promise<boolean> {
    let { stdout } = await this.#git.run(gitDir, [
      'log',
      '-1',
      '--format=%H',
      commit,
      '--',
      directory ? `${path}/` : path,
    ]);
    return stdout.toString('utf8').trim() !== '';
  }

  // `length` bytes of a blob from `start`, read from git's output as it
  // streams and stopped once they are in hand.
  async #readRange(
    gitDir: string,
    id: string,
    start: number,
    length: number,
  ): Promise<Buffer> {
    let chunks: Buffer[] = [];
    let skipped = 0;
    let taken = 0;
    await this.#git.stream(gitDir, ['cat-file', 'blob', id], (chunk) => {
      let from = 0;
      if (skipped < start) {
        from = Math.min(chunk.byteLength, start - skipped);
        skipped += from;
      }
      if (from < chunk.byteLength) {
        let part = chunk.subarray(from, from + (length - taken));
        chunks.push(part);
        taken += part.byteLength;
      }
      return taken >= length;
    });
    return Buffer.concat(chunks);
  }

  // The size of each change on the page: the file after the change, or
  // before it for a deletion. A size-only entry's comes from its marker.
  async #sizes(gitDir: string, page: Listed[]): Promise<Map<Change, number>> {
    let blobs = new Map<Change, string>();
    let markers = new Map<Change, string>();
    for (let { changes } of page) {
      for (let change of changes) {
        let side = change.status === 'D' ? change.before : change.after;
        if (side?.markerId) {
          markers.set(change, side.markerId);
        } else if (side) {
          blobs.set(change, side.id);
        }
      }
    }
    let sizes = new Map<Change, number>();
    let blobIds = [...new Set(blobs.values())];
    let described = await this.#describe(gitDir, blobIds);
    let blobSizes = new Map(
      blobIds.map((id, index) => [id, described[index]?.size]),
    );
    for (let [change, id] of blobs) {
      let size = blobSizes.get(id);
      if (size !== undefined) {
        sizes.set(change, size);
      }
    }
    let markerIds = [...markers.values()];
    let markerSizes = await this.#markerSizes(gitDir, markerIds);
    [...markers.keys()].forEach((change, index) => {
      let size = markerSizes[index];
      if (size !== undefined) {
        sizes.set(change, size);
      }
    });
    return sizes;
  }

  // The diff of each change on the page, from one `git diff-tree --stdin`
  // fed the page's revisions. With `-z`, each revision's output is its id
  // and a NUL, its raw entries and, when it changed anything, a NUL and its
  // patch, with one `diff --git` section per raw entry in the same order.
  // git prints a file as text unless a NUL falls in its first 8000 bytes, so
  // a patch can hold a NUL; it ends where a line holds the next revision's
  // id and a NUL, which no patch line can, since each starts with a space,
  // `+`, `-` or a header word. A section that isn't UTF-8 text with no NUL
  // is a binary change, like one git reports as binary.
  //
  // A section above the per-file cap is left out. Once the sections kept
  // reach the budget, the process is stopped and the rest are left out;
  // reading also stops after eight times the budget, so a page of large
  // rewrites can't be read whole only to be dropped.
  async #diffs(
    gitDir: string,
    page: Listed[],
    query: ListingQuery,
  ): Promise<{
    diffs: Map<Change, { diff?: string; omitted?: DiffOmitted }>;
    truncated: boolean;
  }> {
    let diffs = new Map<Change, { diff?: string; omitted?: DiffOmitted }>();
    let revisions = page.filter(
      ({ inserted, changes }) => !inserted && changes.length > 0,
    );
    let byRevision = new Map(
      revisions.map(({ record, changes }) => [
        record.id,
        new Map(changes.map((change) => [change.path, change])),
      ]),
    );
    for (let { changes } of revisions) {
      for (let change of changes) {
        if (change.before?.markerId || change.after?.markerId) {
          diffs.set(change, { omitted: 'content-not-kept' });
        }
      }
    }
    let budget = this.#diffBudgetBytes;
    let readCap = this.#diffBudgetBytes * 8;
    let spent = 0;
    let read = 0;
    let truncated = false;
    let buffer = Buffer.alloc(0);
    let next = 0;
    let ids = revisions.map(({ record }) => record.id);

    // Parses the revisions whose output is complete, and says whether to
    // stop reading.
    let consume = (ended: boolean): boolean => {
      while (next < ids.length) {
        let id = ids[next];
        if (buffer.byteLength < 41) {
          return false;
        }
        if (
          buffer.subarray(0, 40).toString('latin1') !== id ||
          buffer[40] !== 0
        ) {
          throw new Error(`git diff-tree printed an unexpected revision`);
        }
        let position = 41;
        let entries: string[] = [];
        while (buffer[position] === 0x3a /* : */) {
          let metaEnd = buffer.indexOf(0, position);
          let pathEnd = metaEnd === -1 ? -1 : buffer.indexOf(0, metaEnd + 1);
          if (pathEnd === -1) {
            return false;
          }
          entries.push(buffer.subarray(metaEnd + 1, pathEnd).toString('utf8'));
          position = pathEnd + 1;
        }
        if (position >= buffer.byteLength && !ended) {
          // More raw entries, or the patch, may follow.
          return false;
        }
        let patch = Buffer.alloc(0);
        if (entries.length > 0) {
          if (buffer[position] !== 0) {
            throw new Error(`git diff-tree printed no patch for ${id}`);
          }
          let following = ids[next + 1];
          let nextHeader = following
            ? buffer.indexOf(`\n${following}\0`, position + 1, 'latin1')
            : -1;
          if (nextHeader === -1 && !ended) {
            return false;
          }
          let end = nextHeader === -1 ? buffer.byteLength : nextHeader + 1;
          patch = buffer.subarray(position + 1, end);
          position = end;
        }
        let sections = splitPatch(patch);
        if (sections.length !== entries.length) {
          throw new Error(
            `git diff-tree printed ${sections.length} patch sections for ${entries.length} changes`,
          );
        }
        let changes = byRevision.get(id)!;
        for (let [index, entryPath] of entries.entries()) {
          let change = changes.get(entryPath);
          if (!change || diffs.has(change)) {
            continue;
          }
          let section = sections[index];
          let text = utf8Text(section);
          if (text === undefined || /^Binary files .* differ$/m.test(text)) {
            diffs.set(change, { omitted: 'binary' });
          } else if (section.byteLength > this.#maxDiffBytesPerFile) {
            diffs.set(change, { omitted: 'too-large' });
          } else if (spent + section.byteLength > budget) {
            truncated = true;
            return true;
          } else {
            spent += section.byteLength;
            diffs.set(change, { diff: text });
          }
        }
        buffer = buffer.subarray(position);
        next++;
      }
      return true;
    };

    if (ids.length > 0) {
      await this.#git.stream(
        gitDir,
        [
          'diff-tree',
          '--stdin',
          '-r',
          '-p',
          '--raw',
          '-z',
          '--always',
          '--root',
          '--no-renames',
          '--full-index',
          '--no-abbrev',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          ...(query.status ? [`--diff-filter=${query.status}`] : []),
          '--',
          ...pathspecs(query.filters),
        ],
        (chunk) => {
          read += chunk.byteLength;
          buffer = Buffer.concat([buffer, chunk]);
          if (consume(false)) {
            return true;
          }
          if (read > readCap) {
            truncated = true;
            return true;
          }
          return false;
        },
        { input: ids.map((id) => `${id}\n`).join('') },
      );
      if (next < ids.length && !truncated) {
        consume(true);
      }
    }
    for (let { changes } of revisions) {
      for (let change of changes) {
        if (!diffs.has(change)) {
          truncated = true;
          diffs.set(change, { omitted: 'budget' });
        }
      }
    }
    return { diffs, truncated };
  }
}

function summary(
  { record, changes }: Listed,
  sizes: Map<Change, number>,
  diffs: Map<Change, { diff?: string; omitted?: DiffOmitted }> | undefined,
): RevisionSummary {
  let trailers: Record<string, string[]> = {};
  for (let [key, values] of Object.entries(record.trailers) as [
    TrailerKey,
    string[],
  ][]) {
    trailers[TRAILERS[key]] = values;
  }
  return {
    id: record.id,
    ...(record.parent ? { parent: record.parent } : {}),
    author: record.author,
    timestamp: new Date(record.time * 1000).toISOString(),
    message: messageWithoutTrailers(record.message),
    trailers,
    ...(record.trailers.gap?.includes('true') ? { gap: true } : {}),
    changes: changes.map((change): RevisionChange => {
      let size = sizes.get(change);
      let diff = diffs?.get(change);
      return {
        path: change.path,
        status: change.status,
        ...(change.before ? { beforeBlob: change.before.id } : {}),
        ...(change.after ? { afterBlob: change.after.id } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(diff?.diff !== undefined ? { diff: diff.diff } : {}),
        ...(diff?.omitted ? { diffOmitted: diff.omitted } : {}),
      };
    }),
  };
}

// The changes the listing shows for `record`: its changes under the
// filters, of the asked status, when the record passes the listing's
// filters at all; undefined when the listing doesn't list it. With no path
// filter and no status, every revision is listed, including one that
// changed nothing.
function listedChanges(
  record: LogRecord,
  query: ListingQuery,
): Change[] | undefined {
  if (!matchesCorrelation(record, query.correlationId)) {
    return undefined;
  }
  let changes = collapse(record.entries).filter(
    (change) =>
      (query.filters === 'all' || matchesAny(change.path, query.filters)) &&
      (!query.status || change.status === query.status),
  );
  if (changes.length > 0 || (query.filters === 'all' && !query.status)) {
    return changes;
  }
  return undefined;
}

function matchesCorrelation(
  record: LogRecord,
  correlationId: string | undefined,
): boolean {
  return (
    correlationId === undefined ||
    (record.trailers.correlationIds ?? []).includes(correlationId)
  );
}

// The superseded writes `record`'s `Boxel-Includes-Superseded` names for
// paths under the filters, in trailer order.
function supersessionsUnder(
  record: LogRecord,
  filters: PathFilter[],
): { revision: string; path: string }[] {
  return (record.trailers.includesSuperseded ?? [])
    .map(parseIncludesSuperseded)
    .filter(
      (supersession): supersession is { revision: string; path: string } =>
        supersession !== undefined && matchesAny(supersession.path, filters),
    );
}

// A revision's raw entries as changes to realm files. With `-t`, a
// size-only entry appears as its tree and its marker blob: the tree is the
// file's entry, with the marker's id kept for its size, and every other
// tree is a directory, which is no change of its own. A file that becomes a
// size-only entry, or the reverse, is a delete and an add at one path, and
// is one change.
function collapse(entries: RawEntry[]): Change[] {
  let markers = new Map<string, { src?: string; dst?: string }>();
  for (let entry of entries) {
    if (entry.path.endsWith(MARKER_SUFFIX)) {
      let path = entry.path.slice(0, -MARKER_SUFFIX.length);
      markers.set(path, {
        ...(entry.srcMode !== ABSENT_MODE ? { src: entry.srcId } : {}),
        ...(entry.dstMode !== ABSENT_MODE ? { dst: entry.dstId } : {}),
      });
    }
  }
  let sides = new Map<string, { before?: Side; after?: Side }>();
  for (let entry of entries) {
    if (entry.path.endsWith(MARKER_SUFFIX)) {
      continue;
    }
    let marker = markers.get(entry.path);
    let before = side(entry.srcMode, entry.srcId, marker?.src);
    let after = side(entry.dstMode, entry.dstId, marker?.dst);
    if (!before && !after) {
      continue;
    }
    let existing = sides.get(entry.path) ?? {};
    sides.set(entry.path, {
      before: existing.before ?? before,
      after: existing.after ?? after,
    });
  }
  return [...sides]
    .map(([path, { before, after }]) => ({
      path,
      status: (before && after ? 'M' : after ? 'A' : 'D') as ChangeStatus,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    }))
    .sort((a, b) => compare(a.path, b.path));
}

function side(
  mode: string,
  id: string,
  markerId: string | undefined,
): Side | undefined {
  if (mode === ABSENT_MODE || id === NO_OBJECT) {
    return undefined;
  }
  if (mode === TREE_MODE) {
    return markerId ? { id, markerId } : undefined;
  }
  return { id };
}

function sizeOnlyMarkerOf(
  entries: { type: string; id: string; name: string }[],
): string | undefined {
  return entries.length === 1 &&
    entries[0].type === 'blob' &&
    entries[0].name === SIZE_ONLY_MARKER_NAME
    ? entries[0].id
    : undefined;
}

// Revisions from `git log -z` (with `--raw` or without) and `LOG_FORMAT`.
function parseLog(output: string): LogRecord[] {
  return parseRawLog(output, LOG_FIELD_COUNT).map(({ fields, entries }) => {
    let [id, parents, author, time, message] = fields;
    let parent = parents.split(' ')[0];
    return {
      id,
      ...(parent ? { parent } : {}),
      author,
      time: Number(time),
      message,
      trailers: parseTrailers(message),
      entries,
    };
  });
}

// A patch's `diff --git` sections. Every other line of a patch starts with
// a space, `+`, `-`, `@` or a header word, so a line starting with
// `diff --git ` always starts a section.
function splitPatch(patch: Buffer): Buffer[] {
  if (patch.byteLength === 0) {
    return [];
  }
  let marker = Buffer.from('\ndiff --git ');
  let starts = [0];
  let at = patch.indexOf(marker);
  while (at !== -1) {
    starts.push(at + 1);
    at = patch.indexOf(marker, at + 1);
  }
  return starts.map((start, index) =>
    patch.subarray(start, starts[index + 1] ?? patch.byteLength),
  );
}

function pathFilters(paths: string[] | undefined): Filters {
  if (paths === undefined) {
    return 'all';
  }
  if (!Array.isArray(paths)) {
    throw new HistoryRequestError('paths must be a list of paths');
  }
  let filters: PathFilter[] = [];
  let seen = new Set<string>();
  for (let raw of paths) {
    let { path, directory } = readPath(raw);
    if (path === '') {
      return 'all';
    }
    let key = directory ? `${path}/` : path;
    if (!seen.has(key)) {
      seen.add(key);
      filters.push({ path, directory });
    }
  }
  return filters;
}

// A realm path as the reader takes it: relative to the realm, with or
// without a leading slash, with a trailing slash for a directory, and `/`
// or '' for the root. Returned without either slash.
function readPath(raw: string): { path: string; directory: boolean } {
  if (typeof raw !== 'string') {
    throw new HistoryRequestError('a path must be a string');
  }
  let path = raw.startsWith('/') ? raw.slice(1) : raw;
  if (path === '') {
    return { path: '', directory: true };
  }
  let directory = path.endsWith('/');
  if (directory) {
    path = path.slice(0, -1);
  }
  if (
    path
      .split('/')
      .some(
        (segment) => segment === '' || segment === '.' || segment === '..',
      ) ||
    /[\0\n]/.test(path)
  ) {
    throw new HistoryRequestError(`invalid path ${JSON.stringify(raw)}`);
  }
  return { path, directory };
}

function pathspecs(filters: Filters): string[] {
  return filters === 'all'
    ? []
    : filters.map(({ path, directory }) => (directory ? `${path}/` : path));
}

function matchesAny(path: string, filters: PathFilter[]): boolean {
  return filters.some((filter) =>
    filter.directory
      ? path.startsWith(`${filter.path}/`)
      : path === filter.path || path.startsWith(`${filter.path}/`),
  );
}

function statusFilter(status: unknown): ChangeStatus | undefined {
  if (status === undefined) {
    return undefined;
  }
  if (status !== 'A' && status !== 'M' && status !== 'D') {
    throw new HistoryRequestError(`status must be A, M or D, not ${status}`);
  }
  return status;
}

function correlationFilter(correlationId: unknown): string | undefined {
  if (correlationId === undefined) {
    return undefined;
  }
  if (
    typeof correlationId !== 'string' ||
    !/^[\x20-\x7E]+$/.test(correlationId)
  ) {
    throw new HistoryRequestError('correlationId must be printable ASCII');
  }
  return correlationId;
}

function validateRange({ start, length }: { start: number; length: number }) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0
  ) {
    throw new HistoryRequestError(
      'a range needs a start and a length that are non-negative integers',
    );
  }
}

// The bytes as text, when they are UTF-8 with no NUL; otherwise undefined.
function utf8Text(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) {
    return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
