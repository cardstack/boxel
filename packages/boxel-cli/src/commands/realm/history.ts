import * as fs from 'fs';
import type { Command } from 'commander';
import {
  CheckpointManager,
  type Checkpoint,
} from '../../lib/checkpoint-manager';
import { findCheckpoint } from '../../lib/find-checkpoint';
import { prompt } from '../../lib/prompt';
import {
  BOLD,
  DIM,
  FG_CYAN,
  FG_GREEN,
  FG_MAGENTA,
  FG_RED,
  FG_YELLOW,
  RESET,
} from '../../lib/colors';

const DEFAULT_LIMIT = 100;

export interface HistoryOptions {
  /** A 1-based index, short hash, or full hash to restore. */
  restore?: string;
  /** Create a manual checkpoint with this commit message. */
  message?: string;
  /** Max checkpoints to list or consider for restore. Defaults to 100. */
  limit?: number;
}

export interface HistoryResult {
  ok: boolean;
  /** Populated in view mode. */
  checkpoints?: Checkpoint[];
  /** True when the listing was capped by `limit` (view mode only). */
  truncated?: boolean;
  /** Populated when `--message` created a checkpoint. */
  created?: Checkpoint;
  /** Populated when `--restore` restored a checkpoint. */
  restored?: Checkpoint;
  error?: string;
}

interface HistoryCliOptions {
  restore?: string;
  message?: string;
  yes?: boolean;
  limit?: string;
}

type StepResult<T> = ({ ok: true } & T) | { ok: false; error: string };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function listCheckpointsStep(
  workspaceDir: string,
  limit: number,
): Promise<StepResult<{ checkpoints: Checkpoint[]; truncated: boolean }>> {
  if (!fs.existsSync(workspaceDir)) {
    return { ok: false, error: `Directory not found: ${workspaceDir}` };
  }
  try {
    const manager = new CheckpointManager(workspaceDir);
    if (!(await manager.isInitialized())) {
      return { ok: true, checkpoints: [], truncated: false };
    }
    // Fetch one extra so we can detect truncation without a separate count query.
    const fetched = await manager.getCheckpoints(limit + 1);
    const truncated = fetched.length > limit;
    const checkpoints = truncated ? fetched.slice(0, limit) : fetched;
    return { ok: true, checkpoints, truncated };
  } catch (e) {
    return {
      ok: false,
      error: `Failed to read checkpoint history: ${errorMessage(e)}`,
    };
  }
}

async function createManualCheckpointStep(
  workspaceDir: string,
  rawMessage: string,
): Promise<StepResult<{ created: Checkpoint }>> {
  if (!fs.existsSync(workspaceDir)) {
    return { ok: false, error: `Directory not found: ${workspaceDir}` };
  }
  const message = rawMessage.trim();
  if (!message) {
    return { ok: false, error: '--message must not be empty.' };
  }
  try {
    const manager = new CheckpointManager(workspaceDir);
    if (!(await manager.isInitialized())) {
      await manager.init();
    }
    const changes = await manager.detectCurrentChanges();
    const created = await manager.createCheckpoint('manual', changes, message);
    if (!created) {
      return { ok: false, error: 'No changes to checkpoint.' };
    }
    return { ok: true, created };
  } catch (e) {
    return {
      ok: false,
      error: `Failed to create checkpoint: ${errorMessage(e)}`,
    };
  }
}

async function resolveCheckpointRefStep(
  workspaceDir: string,
  ref: string,
  limit: number,
): Promise<StepResult<{ target: Checkpoint }>> {
  if (!fs.existsSync(workspaceDir)) {
    return { ok: false, error: `Directory not found: ${workspaceDir}` };
  }
  try {
    const manager = new CheckpointManager(workspaceDir);
    if (!(await manager.isInitialized())) {
      return {
        ok: false,
        error:
          'No checkpoint history found for this workspace. ' +
          'Checkpoints are created automatically during sync operations.',
      };
    }
    const checkpoints = await manager.getCheckpoints(limit);
    const found = findCheckpoint(ref, checkpoints);
    if (found.kind === 'none') {
      return {
        ok: false,
        error: `Checkpoint not found: ${ref}. Use a number (1-${checkpoints.length}) or a commit hash.`,
      };
    }
    if (found.kind === 'ambiguous') {
      const sample = found.matches
        .slice(0, 5)
        .map((cp) => cp.shortHash)
        .join(', ');
      const more = found.matches.length > 5 ? ', …' : '';
      return {
        ok: false,
        error: `Ambiguous reference: ${ref} matches ${found.matches.length} checkpoints (${sample}${more}). Use a longer prefix or full hash.`,
      };
    }
    return { ok: true, target: found.target };
  } catch (e) {
    return {
      ok: false,
      error: `Failed to read checkpoint history: ${errorMessage(e)}`,
    };
  }
}

async function restoreCheckpointStep(
  workspaceDir: string,
  hash: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!fs.existsSync(workspaceDir)) {
    return { ok: false, error: `Directory not found: ${workspaceDir}` };
  }
  try {
    const manager = new CheckpointManager(workspaceDir);
    if (!(await manager.isInitialized())) {
      return {
        ok: false,
        error: 'No checkpoint history found for this workspace.',
      };
    }
    await manager.restore(hash);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `Failed to restore checkpoint: ${errorMessage(e)}`,
    };
  }
}

/**
 * View, restore, or create checkpoints in a workspace's local
 * `.boxel-history/` git repo. Pure local — does not touch the realm server.
 *
 * Programmatic API. Restores immediately without prompting; the CLI wraps
 * this with a TTY confirmation step (see `registerHistoryCommand`).
 */
export async function realmHistory(
  workspaceDir: string,
  options: HistoryOptions = {},
): Promise<HistoryResult> {
  if (options.restore !== undefined && options.message !== undefined) {
    return {
      ok: false,
      error: 'Only one of --restore or --message may be specified.',
    };
  }
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit <= 0)
  ) {
    return { ok: false, error: 'limit must be a positive integer.' };
  }
  const limit = options.limit ?? DEFAULT_LIMIT;

  if (options.message !== undefined) {
    const r = await createManualCheckpointStep(workspaceDir, options.message);
    return r.ok
      ? { ok: true, created: r.created }
      : { ok: false, error: r.error };
  }

  if (options.restore !== undefined) {
    const resolved = await resolveCheckpointRefStep(
      workspaceDir,
      options.restore,
      limit,
    );
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const restored = await restoreCheckpointStep(
      workspaceDir,
      resolved.target.hash,
    );
    if (!restored.ok) return { ok: false, error: restored.error };
    return { ok: true, restored: resolved.target };
  }

  const r = await listCheckpointsStep(workspaceDir, limit);
  return r.ok
    ? { ok: true, checkpoints: r.checkpoints, truncated: r.truncated }
    : { ok: false, error: r.error };
}

function formatSourceTag(source: 'local' | 'remote' | 'manual'): string {
  if (source === 'local') return `${FG_GREEN}LOCAL${RESET}`;
  if (source === 'remote') return `${FG_CYAN}SERVER${RESET}`;
  return `${FG_MAGENTA}MANUAL${RESET}`;
}

function formatRelativeDate(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 7)
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  return 'just now';
}

function printCheckpoints(
  checkpoints: Checkpoint[],
  truncated: boolean,
  limit: number,
): void {
  if (checkpoints.length === 0) {
    console.log('No checkpoints found.');
    return;
  }
  console.log(`\n${BOLD}Checkpoint History${RESET}\n`);
  const width = String(checkpoints.length).length;
  checkpoints.forEach((cp, i) => {
    const num = i + 1;
    const numLabel = `${DIM}${String(num).padStart(width, ' ')}${RESET}`;
    const majorTag = cp.isMajor
      ? `${FG_YELLOW}[MAJOR]${RESET}`
      : `${DIM}[minor]${RESET}`;
    const milestoneTag = cp.isMilestone
      ? `${FG_YELLOW}⭐${RESET} ${FG_MAGENTA}[${cp.milestoneName}]${RESET} `
      : '';
    console.log(
      `${numLabel} ${FG_YELLOW}${cp.shortHash}${RESET} ${milestoneTag}${formatSourceTag(cp.source)} ${majorTag} ${cp.message} ${DIM}(${cp.filesChanged} files)${RESET}`,
    );
    console.log(`   ${DIM}${formatRelativeDate(cp.date)}${RESET}\n`);
  });
  if (truncated) {
    console.log(
      `${DIM}Showing first ${limit} checkpoints. Pass --limit <n> to see more.${RESET}`,
    );
  }
  console.log(
    `${DIM}Restore: boxel realm history <local-dir> -r <ref>${RESET}`,
  );
}

function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  return n > 0 ? n : null;
}

function bailout(msg: string): never {
  console.error(`${FG_RED}Error:${RESET} ${msg}`);
  process.exit(1);
}

export function registerHistoryCommand(realm: Command): void {
  realm
    .command('history')
    .alias('hist')
    .description(
      'View, restore, or create local checkpoints stored under .boxel-history/',
    )
    .argument('<local-dir>', 'The local workspace directory')
    .option(
      '-r, --restore <ref>',
      'Restore the workspace to a checkpoint (1-based index, short hash, or full hash)',
    )
    .option(
      '-m, --message <message>',
      'Create a manual checkpoint with the given message',
    )
    .option(
      '-y, --yes',
      'Skip the interactive confirmation prompt before --restore',
    )
    .option(
      '--limit <n>',
      `Maximum number of checkpoints to list or consider for --restore (default: ${DEFAULT_LIMIT})`,
    )
    .action(async (localDir: string, opts: HistoryCliOptions) => {
      if (opts.restore !== undefined && opts.message !== undefined) {
        bailout('Only one of --restore or --message may be specified.');
      }

      const limit = parseLimit(opts.limit);
      if (limit === null) {
        bailout('--limit must be a positive integer.');
      }

      if (opts.message !== undefined) {
        const r = await createManualCheckpointStep(localDir, opts.message);
        if (!r.ok) bailout(r.error);
        console.log(
          `${FG_GREEN}✓${RESET} Checkpoint created: ${FG_YELLOW}${r.created.shortHash}${RESET} ${r.created.message}`,
        );
        return;
      }

      if (opts.restore !== undefined) {
        const resolved = await resolveCheckpointRefStep(
          localDir,
          opts.restore,
          limit,
        );
        if (!resolved.ok) bailout(resolved.error);
        const target = resolved.target;

        if (!opts.yes) {
          if (!process.stdin.isTTY) {
            bailout(
              '--restore overwrites local files. Pass --yes to confirm in non-interactive mode.',
            );
          }
          console.log(
            `\n${BOLD}Restoring to:${RESET} ${FG_YELLOW}${target.shortHash}${RESET} - ${target.message}`,
          );
          console.log(`${DIM}${formatRelativeDate(target.date)}${RESET}\n`);
          const answer = await prompt(
            `${FG_YELLOW}This will overwrite current files. Continue? (y/N) ${RESET}`,
          );
          if (!/^y/i.test(answer)) {
            console.log(`${DIM}Restore cancelled.${RESET}`);
            return;
          }
        }

        const restored = await restoreCheckpointStep(localDir, target.hash);
        if (!restored.ok) bailout(restored.error);
        console.log(
          `${FG_GREEN}✓${RESET} Restored to ${FG_YELLOW}${target.shortHash}${RESET} ${target.message}`,
        );
        console.log(
          `${DIM}Run 'boxel realm sync <local-dir> <realm-url> --prefer-local' to push the restored state to the realm.${RESET}`,
        );
        return;
      }

      const r = await listCheckpointsStep(localDir, limit);
      if (!r.ok) bailout(r.error);
      printCheckpoints(r.checkpoints, r.truncated, limit);
    });
}
