import { execFile } from 'child_process';

// A whole-realm diff lists thousands of paths, past execFile's 1 MB default.
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: GIT_MAX_BUFFER, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `git ${args.join(' ')} failed: ${(stderr || error.message).trim()}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function splitNul(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

/**
 * The paths under `dir`, relative to it, that git tracks and whose
 * working-tree content is the same as at `revision`. Anything else under `dir`
 * — a file modified, added or renamed since that commit, an untracked file,
 * one git ignores, or a file inside a submodule — is left out, so a caller
 * that skips only these paths never skips a file git can't vouch for.
 *
 * Throws when `dir` isn't inside a git work tree or `revision` doesn't name a
 * commit in it, which in a CI checkout usually means the history wasn't
 * fetched deep enough to reach it.
 */
export async function listUnchangedSince(
  dir: string,
  revision: string,
): Promise<Set<string>> {
  if (revision.startsWith('-')) {
    throw new Error(`"${revision}" is not a git revision`);
  }
  let commit: string;
  try {
    commit = (
      await git(dir, [
        'rev-parse',
        '--verify',
        '--quiet',
        `${revision}^{commit}`,
      ])
    ).trim();
  } catch {
    throw new Error(
      `${revision} is not a commit in the git repository at ${dir}. ` +
        `Check that ${dir} is a git checkout and that its history reaches ${revision} ` +
        `(a shallow CI checkout needs a deeper fetch).`,
    );
  }
  const [tracked, changed] = await Promise.all([
    // A submodule is listed as its own path, never the files inside it.
    git(dir, ['ls-files', '--cached', '-z']),
    git(dir, [
      'diff',
      '--name-only',
      '--no-renames',
      '--relative',
      '-z',
      commit,
      '--',
    ]),
  ]);
  const changedPaths = new Set(splitNul(changed));
  return new Set(splitNul(tracked).filter((p) => !changedPaths.has(p)));
}
