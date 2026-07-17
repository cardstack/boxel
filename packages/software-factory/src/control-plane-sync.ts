/**
 * Control-plane sync — the control half of the v3 control/product realm
 * split.
 *
 * With `--control-realm` set, the factory keeps ONE local workspace but
 * two realm destinations:
 *
 * - **Product realm** (`--target-realm`): the built card defs and
 *   instances. Synced by the existing atomic workspace sync, with the
 *   control-plane paths excluded via a factory-managed `.boxelignore`.
 * - **Control realm** (`--control-realm`): issues, project/board/knowledge
 *   tracker cards, validation artifacts, and the run log. Synced HERE, by
 *   individual raw `client.write` calls.
 *
 * Why this shape:
 * - Run-log/validation churn stops invalidating the product realm's index
 *   (the live-surface "flashing Loading…" failure), and product `.gts`
 *   updates stop nuking the loader under the run-log/issue cards the
 *   operator is watching.
 * - Raw per-file writes never go through `/_atomic?waitForIndex=true`,
 *   which strips `containsMany` FieldDef data from card sources (critical
 *   platform bug, report filed 2026-07-16) — so the entire control plane
 *   is structurally immune to the strip, not just healed after the fact.
 *
 * Limitations (documented, acceptable for the control plane):
 * - Text files only (`client.write` sends card-source MIME as a string).
 *   Design PNGs therefore stay on the product sync.
 * - No deletion propagation — control-plane cards are append/update-only
 *   in practice (issues get status flips, never deletes).
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { logger } from './logger.ts';

const log = logger('control-plane-sync');

// ---------------------------------------------------------------------------
// Control-plane path ownership
// ---------------------------------------------------------------------------

/**
 * Workspace directories owned by the control plane. Everything under these
 * goes to the control realm; everything else is product.
 */
export const CONTROL_DIRS = [
  'Issues',
  'Projects',
  'Boards',
  'Knowledge Articles',
  'Spec',
  'Validations',
  'Runs',
] as const;

/** Root-level files owned by the control plane (the run-log CardDef). */
export const CONTROL_ROOT_FILES = ['run-log.gts'] as const;

const IGNORE_MARKER = '# software-factory control-plane split';

/** True when a workspace-relative path belongs to the control plane. */
export function isControlPath(relPath: string): boolean {
  if ((CONTROL_ROOT_FILES as readonly string[]).includes(relPath)) {
    return true;
  }
  return CONTROL_DIRS.some(
    (dir) => relPath === dir || relPath.startsWith(`${dir}/`),
  );
}

/**
 * Write (or refresh) the factory-managed `.boxelignore` that keeps
 * control-plane paths out of the PRODUCT realm's atomic sync. The sync
 * engine reads `.boxelignore` with gitignore semantics; entries are
 * anchored to the workspace root. Idempotent: an existing file that
 * already carries the marker block is left alone; a user-authored file
 * without it gets the block appended.
 */
export async function ensureControlPlaneIgnoreFile(
  workspaceDir: string,
): Promise<void> {
  let ignorePath = join(workspaceDir, '.boxelignore');
  let block = [
    IGNORE_MARKER,
    ...CONTROL_DIRS.map((dir) => `/${dir}/`),
    ...CONTROL_ROOT_FILES.map((file) => `/${file}`),
    '/.boxelignore',
    '',
  ].join('\n');

  let existing = '';
  try {
    existing = await readFile(ignorePath, 'utf8');
  } catch {
    // No ignore file yet.
  }
  if (existing.includes(IGNORE_MARKER)) {
    return;
  }
  let content = existing
    ? `${existing.replace(/\n?$/, '\n')}\n${block}`
    : block;
  await writeFile(ignorePath, content, 'utf8');
  log.info(
    `Wrote control-plane .boxelignore (${CONTROL_DIRS.length} dirs excluded from product sync)`,
  );
}

// ---------------------------------------------------------------------------
// The syncer
// ---------------------------------------------------------------------------

export interface ControlPlaneSyncOptions {
  client: BoxelCLIClient;
  /** Control realm URL (trailing slash). */
  controlRealm: string;
  /** The shared local workspace (same one the product sync uses). */
  workspaceDir: string;
}

export interface ControlPlaneSyncResult {
  ok: boolean;
  error?: string;
  pushed: string[];
}

export interface ControlPlanePullResult {
  ok: boolean;
  error?: string;
  pulled: number;
}

export class ControlPlaneSync {
  private client: BoxelCLIClient;
  private controlRealm: string;
  private workspaceDir: string;
  /** relPath → sha1 of the content last confirmed on the control realm. */
  private lastPushed = new Map<string, string>();

  constructor(opts: ControlPlaneSyncOptions) {
    this.client = opts.client;
    this.controlRealm = opts.controlRealm;
    this.workspaceDir = opts.workspaceDir;
  }

  /**
   * Pull the control realm's control-plane files into the workspace —
   * selective (control paths only), so the control realm's own
   * `index.json` never clobbers the product one in the shared mirror.
   * Seeds the hash map so the first `sync()` doesn't re-push unchanged
   * files. Local files win on conflict (prefer-local, matching the
   * product sync's stance).
   */
  async pull(): Promise<ControlPlanePullResult> {
    try {
      let listing = await this.client.listFiles(this.controlRealm);
      if (listing.error) {
        log.warn(`control-plane pull failed: ${listing.error}`);
        return { ok: false, error: listing.error, pulled: 0 };
      }
      let paths = (listing.filenames ?? []).filter(isControlPath);
      let pulled = 0;
      for (let relPath of paths) {
        let localPath = join(this.workspaceDir, relPath);
        let localExists = await fileExists(localPath);
        let read = await this.client.read(this.controlRealm, relPath);
        if (!read.ok || typeof read.content !== 'string') {
          continue;
        }
        this.lastPushed.set(relPath, sha1(read.content));
        if (!localExists) {
          await mkdir(dirname(localPath), { recursive: true });
          await writeFile(localPath, read.content, 'utf8');
          pulled++;
        }
      }
      if (pulled > 0) {
        log.info(`Pulled ${pulled} control-plane file(s) from control realm`);
      }
      return { ok: true, pulled };
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      log.warn(`control-plane pull failed: ${message}`);
      return { ok: false, error: message, pulled: 0 };
    }
  }

  /**
   * Push changed control-plane files to the control realm as individual
   * raw writes. Hash-gated: only files whose content differs from the
   * last confirmed push go over the wire.
   */
  async sync(): Promise<ControlPlaneSyncResult> {
    let pushed: string[] = [];
    let errors: string[] = [];
    let files: string[];
    try {
      files = await this.listLocalControlFiles();
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message, pushed };
    }
    for (let relPath of files) {
      try {
        let content = await readFile(join(this.workspaceDir, relPath), 'utf8');
        let hash = sha1(content);
        if (this.lastPushed.get(relPath) === hash) {
          continue;
        }
        let result = await this.client.write(
          this.controlRealm,
          relPath,
          content,
        );
        if (!result.ok) {
          errors.push(`${relPath}: ${result.error ?? 'unknown write error'}`);
          continue;
        }
        this.lastPushed.set(relPath, hash);
        pushed.push(relPath);
      } catch (error) {
        errors.push(
          `${relPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (pushed.length > 0) {
      log.info(
        `Control-plane sync: pushed ${pushed.length} file(s) to control realm`,
      );
    }
    if (errors.length > 0) {
      log.warn(`Control-plane sync errors: ${errors.join('; ')}`);
      return { ok: false, error: errors.join('; '), pushed };
    }
    return { ok: true, pushed };
  }

  private async listLocalControlFiles(): Promise<string[]> {
    let results: string[] = [];
    for (let rootFile of CONTROL_ROOT_FILES) {
      if (await fileExists(join(this.workspaceDir, rootFile))) {
        results.push(rootFile);
      }
    }
    for (let dir of CONTROL_DIRS) {
      let dirPath = join(this.workspaceDir, dir);
      if (!(await fileExists(dirPath))) continue;
      let entries = await readdir(dirPath, {
        recursive: true,
        withFileTypes: true,
      });
      for (let entry of entries) {
        if (!entry.isFile()) continue;
        let abs = join(entry.parentPath, entry.name);
        let rel = relative(this.workspaceDir, abs).split(sep).join('/');
        results.push(rel);
      }
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
