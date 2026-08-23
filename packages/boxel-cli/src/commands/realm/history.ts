import * as fs from 'fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import {
  CheckpointManager,
  type Checkpoint,
} from '../../lib/checkpoint-manager.ts';
import { findCheckpoint } from '../../lib/find-checkpoint.ts';
import { prompt, resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { resolveRealmAuthenticator } from '../../lib/auth-resolver.ts';
import { loadDeckWorkspaceState } from '../../lib/deck-workspace-state.ts';
import {
  readDeckHistory,
  restoreDeckHistory,
  type DeckHistoryEntry,
} from '../../lib/deck-realm-history.ts';
import { detectRealmSyncMode } from '../../lib/realm-sync-mode.ts';
import type { RealmAuthenticator } from '../../lib/realm-authenticator.ts';
import {
  BOLD,
  DIM,
  FG_CYAN,
  FG_GREEN,
  FG_MAGENTA,
  FG_RED,
  FG_YELLOW,
  RESET,
} from '../../lib/colors.ts';

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
  branch?: string;
  realmSecretSeed?: boolean;
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

function printDeckHistory(entries: DeckHistoryEntry[], branch: string): void {
  if (entries.length === 0) {
    console.log(`No History Steps found on ${branch}.`);
    return;
  }
  console.log(`\n${BOLD}History · ${branch}${RESET}\n`);
  const width = String(entries.length).length;
  entries.forEach((entry, index) => {
    let number = `${DIM}${String(index + 1).padStart(width, ' ')}${RESET}`;
    let actor = entry.author ? ` ${FG_CYAN}${entry.author}${RESET}` : '';
    let paths = entry.filesSummary.slice(0, 3).join(', ');
    let extra =
      entry.filesSummary.length > 3
        ? ` (+${entry.filesSummary.length - 3} more)`
        : '';
    console.log(
      `${number} ${FG_YELLOW}${entry.changeId.slice(0, 12)}${RESET}${actor} ${entry.description}`,
    );
    console.log(
      `   ${DIM}${formatRelativeDate(new Date(entry.timestamp))}${paths ? ` · ${paths}${extra}` : ''}${RESET}\n`,
    );
  });
  console.log(
    `${DIM}Restore: boxel realm history <workspace-or-realm-url> --restore <step>${RESET}`,
  );
}

async function deckHistoryTarget(
  target: string,
  options: HistoryCliOptions,
): Promise<
  | {
      realmURL: string;
      branchName: string;
      localDir?: string;
      authenticator: RealmAuthenticator;
    }
  | undefined
> {
  let workspace;
  try {
    workspace = await loadDeckWorkspaceState(target);
  } catch (error) {
    let raw: unknown;
    try {
      raw = JSON.parse(
        await readFile(join(target, '.boxel-sync.json'), 'utf8'),
      );
    } catch {
      throw error;
    }
    if (typeof raw === 'object' && raw !== null && !('schema' in raw)) {
      return undefined;
    }
    throw error;
  }
  let realmURL = workspace?.realmURL;
  let branchName = options.branch ?? workspace?.branchName ?? 'main';
  let localDir = workspace ? target : undefined;
  if (!realmURL && URL.canParse(target)) {
    realmURL = new URL(target).href.replace(/\/+$/, '') + '/';
  }
  if (!realmURL) return undefined;
  if (workspace && options.branch && options.branch !== workspace.branchName) {
    throw new Error(
      `Workspace tracks branch ${workspace.branchName}, not ${options.branch}`,
    );
  }
  let realmSecretSeed = await resolveRealmSecretSeed(
    options.realmSecretSeed === true,
  );
  let resolution = resolveRealmAuthenticator({
    realmUrl: realmURL,
    realmSecretSeed,
  });
  if (!resolution.ok) throw new Error(resolution.error);
  let mode = await detectRealmSyncMode(realmURL, resolution.authenticator);
  if (mode.mode !== 'deck') {
    throw new Error(
      'A realm URL can show History only when that realm advertises Deck; use a local directory for legacy checkpoint history',
    );
  }
  return {
    realmURL,
    branchName,
    ...(localDir ? { localDir } : {}),
    authenticator: resolution.authenticator,
  };
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
      'View or restore Deck History, or manage legacy local checkpoints',
    )
    .argument(
      '<workspace-or-realm-url>',
      'A local workspace, or a Deck-enabled realm URL',
    )
    .option(
      '-r, --restore <ref>',
      'Restore a Deck History Step or legacy local checkpoint',
    )
    .option(
      '-m, --message <message>',
      'Create a manual checkpoint in a legacy local workspace',
    )
    .option(
      '-y, --yes',
      'Skip the interactive confirmation prompt before --restore',
    )
    .option(
      '--limit <n>',
      `Maximum History Steps or legacy checkpoints to list (default: ${DEFAULT_LIMIT})`,
    )
    .option(
      '-b, --branch <name>',
      'Deck branch (default: workspace branch or main)',
    )
    .option(
      '--realm-secret-seed',
      'Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile',
    )
    .action(async (target: string, opts: HistoryCliOptions) => {
      if (opts.restore !== undefined && opts.message !== undefined) {
        bailout('Only one of --restore or --message may be specified.');
      }

      const limit = parseLimit(opts.limit);
      if (limit === null) {
        bailout('--limit must be a positive integer.');
      }

      let deckTarget;
      try {
        deckTarget = await deckHistoryTarget(target, opts);
      } catch (error) {
        bailout(errorMessage(error));
      }
      if (deckTarget) {
        if (opts.message !== undefined) {
          bailout(
            'Deck History Steps are automatic. An authored collaboration Checkpoint is a separate command added in B5.',
          );
        }
        if (opts.restore !== undefined) {
          if (!opts.yes) {
            if (!process.stdin.isTTY) {
              bailout(
                '--restore advances the canonical branch. Pass --yes to confirm in non-interactive mode.',
              );
            }
            const answer = await prompt(
              `${FG_YELLOW}Restore ${deckTarget.branchName} to ${opts.restore} as a new History Step? (y/N) ${RESET}`,
            );
            if (!/^y/i.test(answer)) {
              console.log(`${DIM}Restore cancelled.${RESET}`);
              return;
            }
          }
          try {
            let restored = await restoreDeckHistory({
              realmURL: deckTarget.realmURL,
              branchName: deckTarget.branchName,
              revisionId: opts.restore,
              authenticator: deckTarget.authenticator,
              ...(deckTarget.localDir ? { localDir: deckTarget.localDir } : {}),
            });
            console.log(
              `${FG_GREEN}✓${RESET} Restored ${deckTarget.branchName} to ${FG_YELLOW}${restored.restored}${RESET} as new Step ${FG_YELLOW}${restored.historyHead}${RESET}`,
            );
          } catch (error) {
            bailout(errorMessage(error));
          }
          return;
        }
        try {
          let history = await readDeckHistory({
            realmURL: deckTarget.realmURL,
            branchName: deckTarget.branchName,
            limit,
            authenticator: deckTarget.authenticator,
          });
          printDeckHistory(history.entries, history.branch);
        } catch (error) {
          bailout(errorMessage(error));
        }
        return;
      }

      const localDir = target;

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
