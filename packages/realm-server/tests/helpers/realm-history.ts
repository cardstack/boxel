import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { join } from 'path';
import { HISTORY_DIR } from '@cardstack/runtime-common/realm-history';

// Running a real deckd for the realm-server tests that record history, and
// reading what it recorded. deckd's API reads a revision's files but not its
// metadata, so a revision's author, message and trailers are read straight
// out of the git store inside the repository deckd keeps (`jj/store/git`),
// with git.

// The root commit: HEAD of a history nothing has been recorded in.
export const ROOT_REVISION = '0'.repeat(40);

// --- deckd ------------------------------------------------------------------

// The deckd binary: `DECKD_BIN`, or `deckd` on PATH. CI provides one, so there
// its absence is a failure; a developer without one skips this module.
export function findDeckd(): string | undefined {
  if (process.env.DECKD_BIN) {
    return process.env.DECKD_BIN;
  }
  try {
    return (
      execFileSync('which', ['deckd'], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || undefined
    );
  } catch {
    return undefined;
  }
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    let server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      let address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}

export async function startDeckd(
  binary: string,
): Promise<{ url: string; process: ChildProcess }> {
  let port = await freePort();
  let child = spawn(binary, [], {
    env: { ...process.env, DECKD_BIND: `127.0.0.1:${port}` },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let url = `http://127.0.0.1:${port}`;
  let deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      let response = await fetch(`${url}/health`);
      if (response.ok) {
        return { url, process: child };
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`deckd at ${binary} did not answer /health within 20s`);
}

// --- reading a revision -------------------------------------------------------

export function git(realmDir: string, ...args: string[]): string {
  return execFileSync('git', [
    '--git-dir',
    join(realmDir, HISTORY_DIR, 'jj', 'store', 'git'),
    ...args,
  ]).toString();
}

export interface Revision {
  author: string;
  email: string;
  parents: string[];
  subject: string;
  trailers: Record<string, string>;
  // `A path`, `M path` or `D path`, sorted.
  changes: string[];
}

export function readRevision(realmDir: string, revision: string): Revision {
  let raw = git(
    realmDir,
    'show',
    '--no-renames',
    '--name-status',
    '--format=%an%x00%ae%x00%P%x00%B%x00',
    revision,
  );
  let [author, email, parents, body, rest] = raw.split('\0');
  let trailers: Record<string, string> = {};
  for (let line of body.split('\n')) {
    let match = /^([A-Za-z0-9-]+): (.*)$/.exec(line);
    if (match) {
      trailers[match[1]] = match[2];
    }
  }
  return {
    author,
    email,
    parents: parents.trim() ? parents.trim().split(' ') : [],
    subject: body.split('\n')[0],
    trailers,
    changes: rest
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/\t/, ' '))
      .sort(),
  };
}

// Every revision from HEAD back, newest first.
export function historyFrom(realmDir: string, head: string): string[] {
  if (head === ROOT_REVISION) {
    return [];
  }
  return git(realmDir, 'rev-list', '--first-parent', head)
    .split('\n')
    .filter(Boolean);
}
