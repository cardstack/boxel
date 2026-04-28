/**
 * Test helper for factory workspace directories.
 *
 * Every factory config now requires a `workspaceDir`. Most unit tests don't
 * care about the contents — they just need a real on-disk directory so
 * workspace-fs reads return `404` instead of throwing. This helper creates
 * a per-test temp dir and gives back minimal utilities for seeding and
 * asserting against it.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

export interface TestWorkspace {
  /** Absolute path to the workspace root. */
  dir: string;
  /** Write a file into the workspace, creating parent dirs as needed. */
  write: (relativePath: string, content: string) => void;
  /** Read a file from the workspace. Throws if missing. */
  read: (relativePath: string) => string;
  /** Whether the given relative path exists under the workspace. */
  exists: (relativePath: string) => boolean;
  /** Remove the workspace directory. */
  cleanup: () => void;
}

/**
 * Tracks every workspace created during the test run so leftovers get
 * removed at process exit even if the test forgot its `cleanup()`.
 * Explicit `cleanup()` is still recommended (frees the dir mid-run);
 * this is a safety net.
 */
const tracked = new Set<string>();
let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  let sweep = () => {
    for (let dir of tracked) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
    tracked.clear();
  };
  process.once('exit', sweep);
  process.once('beforeExit', sweep);
}

/**
 * Create an isolated workspace directory for a single test. Caller
 * should invoke `cleanup()` (typically from an `afterEach` or
 * `finally`). Any workspace not cleaned up is removed at process
 * exit as a safety net.
 */
export function createTestWorkspace(): TestWorkspace {
  installExitHook();
  let dir = mkdtempSync(join(tmpdir(), 'boxel-factory-test-ws-'));
  tracked.add(dir);
  return {
    dir,
    write: (relativePath, content) => {
      let full = join(dir, relativePath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    },
    read: (relativePath) => readFileSync(join(dir, relativePath), 'utf8'),
    exists: (relativePath) => existsSync(join(dir, relativePath)),
    cleanup: () => {
      tracked.delete(dir);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // swallow — tmp dir cleanup is best-effort
      }
    },
  };
}

/**
 * Create a workspace and pull the realm into it. Convenience for spec
 * tests that need the workspace pre-populated with the realm's current
 * state before running a step or in-memory tool.
 */
export async function pullIntoTestWorkspace(
  client: BoxelCLIClient,
  realmUrl: string,
): Promise<TestWorkspace> {
  let workspace = createTestWorkspace();
  let pullResult = await client.pull(realmUrl, workspace.dir);
  if (pullResult.error) {
    workspace.cleanup();
    throw new Error(
      `Failed to pull realm into test workspace: ${pullResult.error}`,
    );
  }
  return workspace;
}
