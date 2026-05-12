import * as fs from 'fs';
import type { Command } from 'commander';
import {
  CheckpointManager,
  type Checkpoint,
} from '../../lib/checkpoint-manager';
import { cliLog } from '../../lib/cli-log';
import { findCheckpoint } from '../../lib/find-checkpoint';
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

export interface MilestoneOptions {
  /** A 1-based index, short hash, or full hash to mark as milestone. Requires `name`. */
  mark?: string;
  /** Name for the milestone (required when `mark` is given). */
  name?: string;
  /** A 1-based index, short hash, or full hash whose milestone tag to remove. */
  remove?: string;
  /** Max checkpoints to consider for ref resolution. Defaults to 100. */
  limit?: number;
}

export interface MilestoneResult {
  ok: boolean;
  /** Populated in list mode. */
  milestones?: Checkpoint[];
  /** Populated when a milestone was marked. */
  marked?: Checkpoint;
  /** Populated when a milestone was removed. */
  removed?: boolean;
  error?: string;
}

interface MilestoneCliOptions {
  mark?: string;
  name?: string;
  remove?: string;
  limit?: string;
  json?: boolean;
}

type StepResult<T> = ({ ok: true } & T) | { ok: false; error: string };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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

async function resolveRef(
  workspaceDir: string,
  ref: string,
  limit: number,
): Promise<StepResult<{ target: Checkpoint }>> {
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
      error: `Failed to read checkpoints: ${errorMessage(e)}`,
    };
  }
}

async function listMilestonesStep(
  workspaceDir: string,
): Promise<StepResult<{ milestones: Checkpoint[] }>> {
  if (!fs.existsSync(workspaceDir)) {
    return { ok: false, error: `Directory not found: ${workspaceDir}` };
  }
  try {
    const manager = new CheckpointManager(workspaceDir);
    if (!(await manager.isInitialized())) {
      return { ok: true, milestones: [] };
    }
    const milestones = await manager.getMilestones();
    return { ok: true, milestones };
  } catch (e) {
    return {
      ok: false,
      error: `Failed to read milestones: ${errorMessage(e)}`,
    };
  }
}

async function markMilestoneStep(
  workspaceDir: string,
  ref: string,
  name: string,
  limit: number,
): Promise<StepResult<{ marked: Checkpoint }>> {
  if (!fs.existsSync(workspaceDir)) {
    return { ok: false, error: `Directory not found: ${workspaceDir}` };
  }
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, error: '--name must not be empty.' };
  }
  const resolved = await resolveRef(workspaceDir, ref, limit);
  if (!resolved.ok) return resolved;

  try {
    const manager = new CheckpointManager(workspaceDir);
    const result = await manager.markMilestone(
      resolved.target.hash,
      trimmedName,
    );
    if (!result) {
      return {
        ok: false,
        error: 'Could not mark milestone. The checkpoint may already have one.',
      };
    }
    const checkpoints = await manager.getCheckpoints(limit);
    const marked = checkpoints.find((cp) => cp.hash === resolved.target.hash);
    if (!marked) {
      return {
        ok: false,
        error: 'Milestone created but checkpoint could not be re-read.',
      };
    }
    return { ok: true, marked };
  } catch (e) {
    return { ok: false, error: `Failed to mark milestone: ${errorMessage(e)}` };
  }
}

async function removeMilestoneStep(
  workspaceDir: string,
  ref: string,
  limit: number,
): Promise<StepResult<{ removed: boolean }>> {
  if (!fs.existsSync(workspaceDir)) {
    return { ok: false, error: `Directory not found: ${workspaceDir}` };
  }
  const resolved = await resolveRef(workspaceDir, ref, limit);
  if (!resolved.ok) return resolved;

  const target = resolved.target;
  if (!target.isMilestone) {
    return {
      ok: false,
      error: `Checkpoint ${target.shortHash} is not marked as a milestone.`,
    };
  }

  try {
    const manager = new CheckpointManager(workspaceDir);
    const success = await manager.unmarkMilestone(target.hash);
    return { ok: true, removed: success };
  } catch (e) {
    return {
      ok: false,
      error: `Failed to remove milestone: ${errorMessage(e)}`,
    };
  }
}

/**
 * List, mark, or remove milestones in a workspace's local `.boxel-history/` git repo.
 * Pure local — does not touch the realm server.
 */
export async function realmMilestone(
  workspaceDir: string,
  options: MilestoneOptions = {},
): Promise<MilestoneResult> {
  if (options.mark !== undefined && options.remove !== undefined) {
    return {
      ok: false,
      error: 'Only one of --mark or --remove may be specified.',
    };
  }
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit <= 0)
  ) {
    return { ok: false, error: 'limit must be a positive integer.' };
  }
  const limit = options.limit ?? DEFAULT_LIMIT;

  if (options.mark !== undefined) {
    if (options.name === undefined) {
      return { ok: false, error: '--name is required when using --mark.' };
    }
    const r = await markMilestoneStep(
      workspaceDir,
      options.mark,
      options.name,
      limit,
    );
    return r.ok
      ? { ok: true, marked: r.marked }
      : { ok: false, error: r.error };
  }

  if (options.remove !== undefined) {
    const r = await removeMilestoneStep(workspaceDir, options.remove, limit);
    return r.ok
      ? { ok: true, removed: r.removed }
      : { ok: false, error: r.error };
  }

  const r = await listMilestonesStep(workspaceDir);
  return r.ok
    ? { ok: true, milestones: r.milestones }
    : { ok: false, error: r.error };
}

function printMilestones(milestones: Checkpoint[], workspaceDir: string): void {
  if (milestones.length === 0) {
    console.log('\nNo milestones marked yet.\n');
    console.log(
      `Use ${FG_CYAN}boxel realm milestone <local-dir> --mark <ref> --name <name>${RESET} to mark a checkpoint.`,
    );
    console.log(
      `Use ${FG_CYAN}boxel realm history <local-dir>${RESET} to see available checkpoints.\n`,
    );
    return;
  }

  console.log(`\n${BOLD}Milestones${RESET} ${DIM}(${workspaceDir})${RESET}\n`);
  for (const cp of milestones) {
    const sourceIcon =
      cp.source === 'local' ? '↑' : cp.source === 'remote' ? '↓' : '●';
    const sourceColor =
      cp.source === 'local'
        ? FG_GREEN
        : cp.source === 'remote'
          ? FG_CYAN
          : FG_MAGENTA;
    console.log(
      `  ${FG_YELLOW}⭐${RESET} ` +
        `${FG_YELLOW}${cp.shortHash}${RESET} ` +
        `${sourceColor}${sourceIcon}${RESET} ` +
        `${FG_MAGENTA}[${cp.milestoneName}]${RESET} ` +
        `${cp.message}`,
    );
    console.log(`     ${DIM}${formatRelativeDate(cp.date)}${RESET}`);
  }
  console.log();
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

export function registerMilestoneCommand(realm: Command): void {
  realm
    .command('milestone')
    .description(
      'List, mark, or remove milestones in the local .boxel-history/ checkpoint log',
    )
    .argument('<local-dir>', 'The local workspace directory')
    .option(
      '--mark <ref>',
      'Mark a checkpoint as a milestone (1-based index, short hash, or full hash)',
    )
    .option('--name <name>', 'Name for the milestone (required with --mark)')
    .option(
      '--remove <ref>',
      'Remove the milestone tag from a checkpoint (1-based index, short hash, or full hash)',
    )
    .option(
      '--limit <n>',
      `Maximum number of checkpoints to consider for ref resolution (default: ${DEFAULT_LIMIT})`,
    )
    .option('--json', 'Output result as JSON')
    .action(async (localDir: string, opts: MilestoneCliOptions) => {
      if (opts.mark !== undefined && opts.remove !== undefined) {
        bailout('Only one of --mark or --remove may be specified.');
      }

      const limit = parseLimit(opts.limit);
      if (limit === null) {
        bailout('--limit must be a positive integer.');
      }

      if (opts.mark !== undefined && opts.name === undefined) {
        bailout('--name is required when using --mark.');
      }

      const result = await realmMilestone(localDir, {
        mark: opts.mark,
        name: opts.name,
        remove: opts.remove,
        limit,
      });

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
        if (!result.ok) process.exit(1);
        return;
      }

      if (!result.ok) {
        bailout(result.error!);
      }

      if (result.marked) {
        const cp = result.marked;
        console.log(
          `\n${FG_GREEN}✓${RESET} ${FG_YELLOW}⭐${RESET} Milestone created: ${FG_MAGENTA}${cp.milestoneName}${RESET}`,
        );
        console.log(
          `  Checkpoint: ${FG_YELLOW}${cp.shortHash}${RESET} ${cp.message}`,
        );
        console.log();
        return;
      }

      if (result.removed !== undefined) {
        console.log(`${FG_GREEN}✓${RESET} Milestone removed`);
        return;
      }

      printMilestones(result.milestones!, localDir);
    });
}
