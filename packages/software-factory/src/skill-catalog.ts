/**
 * Skill catalog — on-demand skill discovery and reading for the factory agent.
 *
 * The system prompt front-loads only a small always-on skill core; everything
 * else is discoverable at runtime through the `list_skills` / `read_skill`
 * factory tools built on these functions. Progressive disclosure keeps the
 * per-turn context budget on precedent code and design specs instead of
 * skill text the current issue never touches.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { skillSearchDirs } from './factory-skill-loader.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillCatalogEntry {
  name: string;
  description: string;
  /** Reference file names loadable individually via read_skill. */
  references: string[];
}

export interface SkillReadResult {
  name: string;
  /**
   * SKILL.md body when no reference was requested; the reference file's
   * content when one was.
   */
  content: string;
  /** Reference file names available for follow-up reads. */
  references: string[];
  /** Set when a specific reference file was read. */
  referenceFileName?: string;
}

const DESCRIPTION_MAX_CHARS = 240;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * Enumerate every skill resolvable from the loader's search directories.
 * Earlier directories win on name collisions — the same precedence the
 * SkillLoader applies — so the catalog never advertises a skill the loader
 * would resolve to a different copy.
 */
export async function catalogSkills(
  dirs: string[] = skillSearchDirs(),
): Promise<SkillCatalogEntry[]> {
  let seen = new Map<string, SkillCatalogEntry>();

  for (let dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (let name of entries) {
      if (seen.has(name)) continue;
      let skillDir = join(dir, name);
      let content: string;
      try {
        content = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
      } catch {
        continue;
      }
      seen.set(name, {
        name,
        description: extractDescription(content),
        references: await listReferenceFiles(skillDir),
      });
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read a skill's SKILL.md, or one of its reference files, by name.
 * Reference reads are constrained to basenames inside the skill's own
 * `references/` directory (or its compiled `AGENTS.md`) — no traversal.
 */
export async function readSkillOnDemand(
  skillName: string,
  referenceFileName?: string,
  dirs: string[] = skillSearchDirs(),
): Promise<SkillReadResult> {
  let skillDir = await findSkillDir(skillName, dirs);
  if (!skillDir) {
    throw new Error(
      `Skill "${skillName}" not found. Call list_skills for the catalog of available names.`,
    );
  }

  let references = await listReferenceFiles(skillDir);

  if (referenceFileName) {
    let safeName = basename(referenceFileName);
    if (!references.includes(safeName)) {
      throw new Error(
        `Skill "${skillName}" has no reference "${referenceFileName}". ` +
          `Available references: ${references.length > 0 ? references.join(', ') : '(none)'}.`,
      );
    }
    let refPath =
      safeName === 'AGENTS.md'
        ? join(skillDir, 'AGENTS.md')
        : join(skillDir, 'references', safeName);
    return {
      name: skillName,
      content: await readFile(refPath, 'utf8'),
      references,
      referenceFileName: safeName,
    };
  }

  return {
    name: skillName,
    content: await readFile(join(skillDir, 'SKILL.md'), 'utf8'),
    references,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function findSkillDir(
  skillName: string,
  dirs: string[],
): Promise<string | undefined> {
  let safeName = basename(skillName);
  for (let dir of dirs) {
    let candidate = join(dir, safeName);
    try {
      await stat(join(candidate, 'SKILL.md'));
      return candidate;
    } catch {
      // try next directory
    }
  }
  return undefined;
}

/**
 * Reference files a skill exposes: the compiled `AGENTS.md` for rules-style
 * skills (e.g. ember-best-practices), else the `references/*.md` set — the
 * same shapes the SkillLoader inlines.
 */
async function listReferenceFiles(skillDir: string): Promise<string[]> {
  try {
    await stat(join(skillDir, 'rules'));
    try {
      await stat(join(skillDir, 'AGENTS.md'));
      return ['AGENTS.md'];
    } catch {
      return [];
    }
  } catch {
    // no rules/ dir — fall through to references/
  }

  try {
    let files = await readdir(join(skillDir, 'references'));
    return files.filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

/**
 * One-line description for the catalog: frontmatter `description:` when
 * present, else the first non-empty non-heading body line.
 */
function extractDescription(skillMd: string): string {
  let body = skillMd;
  let frontmatter = skillMd.match(/^---\n([\s\S]*?)\n---\n/);
  if (frontmatter) {
    let descLine = frontmatter[1]
      .split('\n')
      .find((l) => l.startsWith('description:'));
    if (descLine) {
      return truncate(descLine.slice('description:'.length).trim());
    }
    body = skillMd.slice(frontmatter[0].length);
  }
  let line = body
    .split('\n')
    .find((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  return truncate(line?.trim() ?? '');
}

function truncate(text: string): string {
  return text.length > DESCRIPTION_MAX_CHARS
    ? text.slice(0, DESCRIPTION_MAX_CHARS - 1) + '…'
    : text;
}
