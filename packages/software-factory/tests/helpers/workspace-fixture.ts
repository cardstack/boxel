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
 * Create an isolated workspace directory for a single test. Caller is
 * responsible for invoking `cleanup()` (typically from an `afterEach`).
 */
export function mkTestWorkspace(): TestWorkspace {
  let dir = mkdtempSync(join(tmpdir(), 'boxel-factory-test-ws-'));
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
  let workspace = mkTestWorkspace();
  let pullResult = await client.pull(realmUrl, workspace.dir);
  if (pullResult.error) {
    workspace.cleanup();
    throw new Error(
      `Failed to pull realm into test workspace: ${pullResult.error}`,
    );
  }
  return workspace;
}
