/**
 * Materialize the factory skill catalog into the agent workspace as
 * `<workspace>/.claude/skills/<name>/` — the same convention Claude Code
 * uses for project skills.
 *
 * Why: the MCP `read_skill` tool is a custom lookup path the model has
 * no trained instinct for, and it cannot SEARCH across skills. Models
 * are heavily conditioned to explore `.claude/*` with native
 * Glob/Grep/Read — leaning into that instinct beats teaching a bespoke
 * tool. With the files on disk the agent can `Grep 'fitted'
 * .claude/skills` and find the standard it didn't know existed (the
 * unknown-unknown failure mode that shipped a non-standard fitted view,
 * wardrobe 2026-07-17), and with `settingSources: ['project']` the SDK
 * harness discovers them natively like any Claude Code project.
 *
 * Sync safety: the realm sync skips every dotfile/dotdir, so `.claude/`
 * never reaches the realm. The `read_skill` MCP tool stays available
 * (other backends, and the resolver's always-on injection path).
 */

import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { skillSearchDirs } from './factory-skill-loader.ts';
import { logger } from './logger.ts';

let log = logger('workspace-skills');

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');

/** Factory-adapted Boxel conventions, copied to `<workspace>/CLAUDE.md`. */
const WORKSPACE_CLAUDE_MD_SOURCE = join(
  PACKAGE_ROOT,
  '.agents',
  'workspace-CLAUDE.md',
);

const IGNORE_MARKER = '# factory agent-infra (auto-generated block)';

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Copy every resolvable skill (its whole directory: SKILL.md, AGENTS.md,
 * references/) into `<workspace>/.claude/skills/<name>/`. Earlier search
 * dirs win on name collisions, matching the loader's precedence. Returns
 * the number of skills materialized. Best-effort: a failure logs and
 * skips — the run must not die over skill copying.
 */
export async function materializeWorkspaceSkills(
  workspaceDir: string,
  dirs: string[] = skillSearchDirs(),
): Promise<number> {
  let targetRoot = join(workspaceDir, '.claude', 'skills');
  let materialized = new Set<string>();
  for (let dir of dirs) {
    if (!(await isDir(dir))) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (let entry of entries) {
      if (!entry.isDirectory()) continue;
      if (materialized.has(entry.name)) continue; // precedence: first wins
      let skillMd = join(dir, entry.name, 'SKILL.md');
      try {
        await stat(skillMd);
      } catch {
        continue; // not a skill dir
      }
      try {
        await mkdir(targetRoot, { recursive: true });
        await cp(join(dir, entry.name), join(targetRoot, entry.name), {
          recursive: true,
          force: true,
        });
        materialized.add(entry.name);
      } catch (err) {
        log.warn(
          `Failed to materialize skill "${entry.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  if (materialized.size > 0) {
    log.info(
      `Materialized ${materialized.size} skill(s) into workspace .claude/skills/`,
    );
  }
  await materializeWorkspaceClaudeMd(workspaceDir);
  return materialized.size;
}

/**
 * Copy the factory-adapted Boxel conventions to `<workspace>/CLAUDE.md`
 * and make sure the realm sync ignores it. With `settingSources:
 * ['project']` the SDK harness auto-loads a workspace-root CLAUDE.md as
 * project instructions — the same always-on conventions channel every
 * Claude Code project gets. Unlike `.claude/` (a dotdir the sync skips
 * automatically), a root CLAUDE.md WOULD sync to the product realm, so
 * an ignore entry is appended to `.boxelignore` (which the sync
 * consumes) before the file is written.
 */
export async function materializeWorkspaceClaudeMd(
  workspaceDir: string,
  sourcePath: string = WORKSPACE_CLAUDE_MD_SOURCE,
): Promise<boolean> {
  let content;
  try {
    content = await readFile(sourcePath, 'utf8');
  } catch {
    return false; // no template shipped — nothing to do
  }
  try {
    let ignorePath = join(workspaceDir, '.boxelignore');
    let existing = '';
    try {
      existing = await readFile(ignorePath, 'utf8');
    } catch {
      // no ignore file yet
    }
    if (!existing.includes(IGNORE_MARKER)) {
      let block = [IGNORE_MARKER, '/CLAUDE.md', ''].join('\n');
      await writeFile(
        ignorePath,
        existing ? `${existing.replace(/\n?$/, '\n')}${block}` : block,
        'utf8',
      );
    }
    await writeFile(join(workspaceDir, 'CLAUDE.md'), content, 'utf8');
    log.info('Materialized workspace CLAUDE.md (sync-ignored)');
    return true;
  } catch (err) {
    log.warn(
      `Failed to materialize workspace CLAUDE.md: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
