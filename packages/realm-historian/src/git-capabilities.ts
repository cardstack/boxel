// What the git on PATH can do for history reads, found by trying it rather
// than by its version number, so a distribution's patches or a vendor's
// build answer for themselves.
//
// A path-filtered `git log` reads the commit-graph's changed-path Bloom
// filters instead of a tree per commit. Git uses them with one path filter
// from 2.27, and with several only from 2.51, so a reader with several path
// filters on an older git walks every commit's trees. The probe builds a
// two-commit repo in a temporary directory, writes its commit-graph with
// Bloom filters, and runs `git log` with one path filter and then two. Git
// reports a "bloom" "statistics" event to trace2 only when it used the
// filters.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BLOB_MODE, ObjectStore, TreeBuilder } from './git-objects.ts';
import { initRepo, MAIN_REF, runGit, updateMain } from './repo-format.ts';

const execFileAsync = promisify(execFile);

export interface GitCapabilities {
  // As `git --version` reports it, without the leading `git version`.
  version: string;
  // Whether `git log -- <path>` uses changed-path Bloom filters.
  bloomWithOnePath: boolean;
  // Whether `git log -- <path> <path>` does.
  bloomWithSeveralPaths: boolean;
}

export async function probeGit(): Promise<GitCapabilities> {
  let { stdout } = await execFileAsync('git', ['--version']);
  let version = stdout.trim().replace(/^git version /, '');
  let directory = await mkdtemp(join(tmpdir(), 'realm-historian-git-probe-'));
  try {
    let gitDir = join(directory, 'probe.git');
    await writeProbeRepo(gitDir);
    try {
      await runGit(gitDir, [
        'commit-graph',
        'write',
        '--reachable',
        '--changed-paths',
        '--no-progress',
      ]);
    } catch {
      // A git without changed-path Bloom filters can't write them.
      return { version, bloomWithOnePath: false, bloomWithSeveralPaths: false };
    }
    return {
      version,
      bloomWithOnePath: await usesBloomFilters(directory, gitDir, ['a']),
      bloomWithSeveralPaths: await usesBloomFilters(directory, gitDir, [
        'a',
        'b',
      ]),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// A first revision adding `a`, `b` and `c`, and a second changing only `c`.
async function writeProbeRepo(gitDir: string): Promise<void> {
  await initRepo(gitDir);
  let store = new ObjectStore(gitDir);
  let identity = { name: 'probe', email: 'probe', timestamp: 0 };
  let tree = new TreeBuilder();
  for (let name of ['a', 'b', 'c']) {
    tree.set(name, { mode: BLOB_MODE, id: (await store.writeBlob(name)).id });
  }
  let parents: string[] = [];
  for (let revision of [1, 2]) {
    if (revision === 2) {
      tree.set('c', {
        mode: BLOB_MODE,
        id: (await store.writeBlob('c changed')).id,
      });
    }
    let { id } = await store.writeCommit({
      tree: await tree.write(store),
      parents,
      author: identity,
      committer: identity,
      message: `revision ${revision}`,
    });
    await updateMain(gitDir, id, parents[0]);
    parents = [id];
  }
}

async function usesBloomFilters(
  directory: string,
  gitDir: string,
  paths: string[],
): Promise<boolean> {
  let trace = join(directory, `trace-${paths.length}.json`);
  await execFileAsync(
    'git',
    [`--git-dir=${gitDir}`, 'log', '--format=%H', MAIN_REF, '--', ...paths],
    { env: { ...process.env, GIT_TRACE2_EVENT: trace } },
  );
  let events: string;
  try {
    events = await readFile(trace, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  return events.split('\n').some((line) => {
    if (line.trim() === '') {
      return false;
    }
    let event = JSON.parse(line);
    return event.category === 'bloom' && event.key === 'statistics';
  });
}
