// Resolves the path to the host test harness for `boxel test` (CS-11164).
//
// The harness is the host's dev-mode `dist/` (with `tests/index.html` and
// the QUnit + ember-test-helpers chunks). Where it comes from depends on
// the runtime context:
//
//   1. `BOXEL_TEST_HARNESS_DIR` env var → use the path as-is (for CI,
//      monorepo dev, and the `--host-dist-dir` flag).
//   2. Monorepo sibling: `packages/host/dist/` next to this CLI's checkout
//      → use that directly. Lets monorepo devs iterate without ever
//      downloading.
//   3. Cached download under `~/.cache/boxel-cli/host-test-harness/<version>/`
//      → use it if `tests/index.html` is present (sentinel for a complete
//      extract).
//   4. Download from the pinned GH release tarball, extract into the
//      cache, then use it.
//
// The pin (version + sha256) lives in `packages/boxel-cli/host-test-harness.json`,
// bumped by the `host-test-harness publish` workflow on each release cut.
// The CLI never depends on a fresh host build at install time — only at
// the moment of first `boxel test` per CLI version, when the cache is cold.

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

import { findBoxelCliRoot } from './find-package-root';

interface HarnessPin {
  version: string;
  sha256: string;
}

export interface ResolveOptions {
  /** Force a re-download even if the cache has the pinned version. */
  refresh?: boolean;
  /** Skip the download and import a local tarball instead. */
  offlineTarball?: string;
  /** Explicit override; if set, all other resolution is bypassed. */
  hostDistDir?: string;
}

export interface ResolvedHarness {
  /** Absolute path to a directory containing `tests/index.html`. */
  path: string;
  /** Where this came from — surfaced in `--debug` logs. */
  source: 'flag' | 'env' | 'monorepo-sibling' | 'cache' | 'downloaded';
}

const SENTINEL = join('tests', 'index.html');

export async function resolveHostTestHarness(
  opts: ResolveOptions = {},
): Promise<ResolvedHarness> {
  // (1) Caller-provided override / env override take priority — always
  // honored, no validation beyond existence.
  if (opts.hostDistDir) {
    return { path: resolve(opts.hostDistDir), source: 'flag' };
  }
  let envOverride = process.env.BOXEL_TEST_HARNESS_DIR;
  if (envOverride) {
    return { path: resolve(envOverride), source: 'env' };
  }

  // (2) Monorepo sibling — no download. The CLI lives at
  // `<repo>/packages/boxel-cli/`; the host's dist sits at
  // `<repo>/packages/host/dist/`. Resolves via `findBoxelCliRoot` so
  // it works whether the CLI is invoked from the symlinked `bin/`
  // or from a workspace consumer.
  let cliRoot = findBoxelCliRoot(__dirname);
  let sibling = join(cliRoot, '..', 'host', 'dist');
  if (existsSync(join(sibling, SENTINEL))) {
    return { path: resolve(sibling), source: 'monorepo-sibling' };
  }

  // (3, 4) Pinned download — cache hit or fresh fetch.
  let pin = readPin(cliRoot);
  if (pin.version === '0.0.0-placeholder') {
    throw new Error(
      'host-test-harness.json contains the placeholder pin. ' +
        'Either cut a release via the `host-test-harness publish` ' +
        'workflow and bump the pin, or set BOXEL_TEST_HARNESS_DIR to a ' +
        'directory containing tests/index.html.',
    );
  }
  let cacheDir = join(
    homedir(),
    '.cache',
    'boxel-cli',
    'host-test-harness',
    pin.version,
  );

  if (!opts.refresh && existsSync(join(cacheDir, SENTINEL))) {
    return { path: cacheDir, source: 'cache' };
  }

  // Cold cache — fetch (or sideload) + verify + extract.
  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(cacheDir, { recursive: true });
  let tarballPath = join(cacheDir, '_pending.tar.gz');

  if (opts.offlineTarball) {
    let abs = resolve(opts.offlineTarball);
    if (!existsSync(abs)) {
      throw new Error(`--offline-tarball not found: ${abs}`);
    }
    spawnSync('cp', [abs, tarballPath], { stdio: 'inherit' });
  } else {
    let url = releaseUrl(pin.version);
    process.stderr.write(`Fetching test harness v${pin.version}... `);
    await downloadTo(url, tarballPath);
    process.stderr.write('✓\n');
  }

  let actualSha = sha256(tarballPath);
  if (actualSha !== pin.sha256) {
    throw new Error(
      `Test harness sha256 mismatch.\n  expected: ${pin.sha256}\n  got:      ${actualSha}\n  tarball:  ${tarballPath}`,
    );
  }

  let untar = spawnSync('tar', ['xzf', tarballPath, '-C', cacheDir], {
    stdio: 'inherit',
  });
  if (untar.status !== 0) {
    throw new Error(`tar extraction failed (exit ${untar.status})`);
  }
  rmSync(tarballPath);

  if (!existsSync(join(cacheDir, SENTINEL))) {
    throw new Error(
      `Extracted harness is missing ${SENTINEL} — release tarball is malformed.`,
    );
  }

  return { path: cacheDir, source: 'downloaded' };
}

function readPin(cliRoot: string): HarnessPin {
  let path = join(cliRoot, 'host-test-harness.json');
  try {
    let raw = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw.version !== 'string' || typeof raw.sha256 !== 'string') {
      throw new Error('missing version or sha256');
    }
    return { version: raw.version, sha256: raw.sha256 };
  } catch (err) {
    throw new Error(
      `Failed to read host-test-harness pin at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function releaseUrl(version: string): string {
  return `https://github.com/cardstack/boxel/releases/download/host-test-harness-v${version}/harness.tar.gz`;
}

async function downloadTo(url: string, dest: string): Promise<void> {
  let res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Download failed: ${url} → HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error(`Download returned no body: ${url}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  // node:stream/promises pipeline + a WHATWG ReadableStream -> Web→Node
  // requires Readable.fromWeb. Node 18+ has it built in.
  let { Readable } = await import('node:stream');
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(dest),
  );
}

function sha256(path: string): string {
  let h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

/** Exposed for `--debug` reporting. */
export function describeSource(source: ResolvedHarness['source']): string {
  switch (source) {
    case 'flag':
      return 'explicit --host-dist-dir';
    case 'env':
      return 'BOXEL_TEST_HARNESS_DIR env';
    case 'monorepo-sibling':
      return 'monorepo packages/host/dist/';
    case 'cache':
      return '~/.cache/boxel-cli';
    case 'downloaded':
      return 'GitHub Release (fresh)';
  }
}

// Re-export for tests that want to peek at the cache dir name.
export function cacheDirFor(version: string): string {
  return join(homedir(), '.cache', 'boxel-cli', 'host-test-harness', version);
}

// Stat-guard for the never-actually-imported `statSync` (kept for future
// integrity checks). Keeps tsc happy under noUnusedLocals.
void statSync;
