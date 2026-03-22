import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { ProjectCard, ResolvedSkill, TicketCard } from './factory-agent';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = resolve(__dirname, '../..');
const MONOREPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const DEFAULT_SKILLS_DIR = join(PACKAGE_ROOT, '.agents', 'skills');

/**
 * Additional skill search directories, checked in order when a skill is not
 * found in the primary directory. The monorepo root `.agents/skills/` hosts
 * shared skills like `ember-best-practices` that live outside the package.
 */
const DEFAULT_FALLBACK_DIRS = [join(MONOREPO_ROOT, '.agents', 'skills')];

/** Approximate characters per token for budget estimation. */
const CHARS_PER_TOKEN = 4;

/**
 * Priority order for skills. Lower index = higher priority.
 * Skills not in this list get appended at the end (lowest priority).
 */
const SKILL_PRIORITY: readonly string[] = [
  'boxel-development',
  'boxel-file-structure',
  'ember-best-practices',
  'software-factory-operations',
  'boxel-sync',
  'boxel-track',
  'boxel-watch',
  'boxel-restore',
  'boxel-repair',
  'boxel-setup',
];

// ---------------------------------------------------------------------------
// Keyword matchers for skill resolution
// ---------------------------------------------------------------------------

/** Keywords in ticket content that indicate .gts component work. */
const GTS_KEYWORDS = [
  '.gts',
  'component',
  'template',
  'glimmer',
  'ember',
  'CardDef',
  'FieldDef',
];

/** Keywords that indicate factory workflow / delivery tickets. */
const FACTORY_WORKFLOW_KEYWORDS = [
  'factory',
  'delivery',
  'workflow',
  'pipeline',
  'orchestrat',
];

/** Map from CLI keyword to the specific skill it triggers. */
const CLI_KEYWORD_TO_SKILL: Record<string, string> = {
  sync: 'boxel-sync',
  track: 'boxel-track',
  watch: 'boxel-watch',
  restore: 'boxel-restore',
  repair: 'boxel-repair',
  setup: 'boxel-setup',
};

/**
 * Reference files in `boxel-development/references/` and the keywords that
 * trigger their inclusion. When a ticket doesn't match any keyword, only the
 * "always load" references from SKILL.md are included.
 */
const REFERENCE_KEYWORD_MAP: Record<string, string[]> = {
  'dev-core-patterns.md': ['pattern', 'card', 'structure', 'safe'],
  'dev-template-patterns.md': ['template', 'component', 'render'],
  'dev-delegated-rendering.md': ['delegat', 'render', 'template'],
  'dev-styling-design.md': ['style', 'css', 'design', 'layout', 'visual'],
  'dev-theme-design-system.md': ['theme', 'design system', 'token', 'style'],
  'dev-fitted-formats.md': ['fitted', 'format', 'grid', 'dashboard'],
  'dev-query-systems.md': ['query', 'search', 'filter', 'find'],
  'dev-data-management.md': ['data', 'manage', 'relationship', 'link'],
  'dev-file-def.md': ['file', 'asset', 'FileDef', 'upload'],
  'dev-enumerations.md': ['enum', 'select', 'option', 'choice'],
  'dev-defensive-programming.md': ['defensive', 'guard', 'error', 'safe'],
  'dev-external-libraries.md': ['library', 'external', 'third-party', 'npm'],
  'dev-command-development.md': ['command', 'action', 'invoke'],
  'dev-spec-usage.md': ['spec', 'test', 'specification'],
  'dev-replicate-ai.md': ['replicate', 'ai', 'model', 'ml'],
};

/** References that are always loaded for boxel-development (per SKILL.md). */
const ALWAYS_LOAD_REFERENCES: readonly string[] = [
  'dev-core-concept.md',
  'dev-technical-rules.md',
  'dev-quick-reference.md',
];

// ---------------------------------------------------------------------------
// SkillResolver
// ---------------------------------------------------------------------------

export interface SkillResolver {
  resolve(ticket: TicketCard, project: ProjectCard): string[];
}

export class DefaultSkillResolver implements SkillResolver {
  /**
   * Determine which skills to load based on ticket and project context.
   *
   * Resolution rules (from the plan):
   * 1. boxel-development + boxel-file-structure — always loaded (common case)
   * 2. ember-best-practices — when ticket involves .gts component code
   * 3. software-factory-operations — for factory delivery workflow tickets
   * 4. CLI skills — when ticket involves realm sync/workspace management
   * 5. KnowledgeArticle tags can specify additional skills
   */
  resolve(ticket: TicketCard, project: ProjectCard): string[] {
    let ticketText = extractTicketText(ticket);
    let skills: string[] = ['boxel-development', 'boxel-file-structure'];

    if (matchesAnyKeyword(ticketText, GTS_KEYWORDS)) {
      skills.push('ember-best-practices');
    }

    if (matchesAnyKeyword(ticketText, FACTORY_WORKFLOW_KEYWORDS)) {
      skills.push('software-factory-operations');
    }

    // Add specific CLI skills based on matched keywords
    for (let [keyword, skillName] of Object.entries(CLI_KEYWORD_TO_SKILL)) {
      if (
        matchesAnyKeyword(ticketText, [keyword]) &&
        !skills.includes(skillName)
      ) {
        skills.push(skillName);
      }
    }

    // Check for additional skills specified by knowledge articles in the project
    let additionalSkills = extractKnowledgeSkillTags(project);
    for (let skillName of additionalSkills) {
      if (!skills.includes(skillName)) {
        skills.push(skillName);
      }
    }

    return skills;
  }
}

// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------

export interface SkillLoaderInterface {
  load(skillName: string): Promise<ResolvedSkill>;
  loadAll(skillNames: string[]): Promise<ResolvedSkill[]>;
}

export class SkillLoader implements SkillLoaderInterface {
  private skillsDirs: string[];
  private cache: Map<string, ResolvedSkill> = new Map();

  /**
   * @param skillsDir      Primary directory to search for skills.
   * @param fallbackDirs   Additional directories checked (in order) when a
   *                        skill is not found in the primary directory. Defaults
   *                        to the monorepo root `.agents/skills/`.
   */
  constructor(
    skillsDir: string = DEFAULT_SKILLS_DIR,
    fallbackDirs: string[] = DEFAULT_FALLBACK_DIRS,
  ) {
    this.skillsDirs = [skillsDir, ...fallbackDirs];
  }

  /**
   * Load a single skill by name.
   * Searches the primary skills directory first, then each fallback directory.
   * Results are cached for the duration of the factory run.
   */
  async load(skillName: string): Promise<ResolvedSkill> {
    let cached = this.cache.get(skillName);
    if (cached) {
      return cached;
    }

    let skillDir = await this.findSkillDir(skillName);
    if (!skillDir) {
      let searched = this.skillsDirs.map((d) => join(d, skillName)).join(', ');
      throw new SkillLoadError(
        `Skill "${skillName}" not found. Searched: ${searched}`,
      );
    }

    let skillMdPath = join(skillDir, 'SKILL.md');

    let content: string;
    try {
      content = await readFile(skillMdPath, 'utf8');
    } catch {
      throw new SkillLoadError(
        `Skill "${skillName}" not found: ${skillMdPath} does not exist`,
      );
    }

    let references: string[] | undefined;

    // Check for rules/ directory first (e.g., ember-best-practices).
    // Load compiled AGENTS.md instead of individual rule files.
    let rulesDir = join(skillDir, 'rules');
    if (await directoryExists(rulesDir)) {
      let agentsMdPath = join(skillDir, 'AGENTS.md');
      try {
        let agentsContent = await readFile(agentsMdPath, 'utf8');
        references = [agentsContent];
      } catch {
        // If AGENTS.md doesn't exist, fall through — no references
      }
    }

    // Check for references/ directory (e.g., boxel-development).
    // Load all reference files — the caller filters by relevance.
    if (!references) {
      let refsDir = join(skillDir, 'references');
      if (await directoryExists(refsDir)) {
        let files = await readdir(refsDir);
        let mdFiles = files.filter((f) => f.endsWith('.md')).sort();
        references = await Promise.all(
          mdFiles.map((f) => readFile(join(refsDir, f), 'utf8')),
        );
      }
    }

    let resolved: ResolvedSkill = {
      name: skillName,
      content,
      ...(references && references.length > 0 ? { references } : {}),
    };

    this.cache.set(skillName, resolved);
    return resolved;
  }

  /**
   * Load all skills matching the resolved names.
   * Missing skills log a warning but do not fail the batch.
   */
  async loadAll(skillNames: string[]): Promise<ResolvedSkill[]> {
    let results: ResolvedSkill[] = [];

    for (let name of skillNames) {
      try {
        let skill = await this.load(name);
        results.push(skill);
      } catch (error) {
        console.warn(
          `[SkillLoader] Skipping unavailable skill "${name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return results;
  }

  /** Clear the cache so skills are re-read from disk on next load. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Search all configured skill directories for a skill by name.
   * Returns the full path to the skill directory, or undefined if not found.
   */
  private async findSkillDir(skillName: string): Promise<string | undefined> {
    for (let baseDir of this.skillsDirs) {
      let candidate = join(baseDir, skillName);
      let skillMd = join(candidate, 'SKILL.md');
      try {
        await stat(skillMd);
        return candidate;
      } catch {
        // Not found in this directory, try next
      }
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Context budget enforcement
// ---------------------------------------------------------------------------

/**
 * Filter resolved skills to fit within a token budget.
 * Skills are sorted by priority (from SKILL_PRIORITY), then trimmed from the
 * end (lowest priority) when the budget is exceeded.
 *
 * For `boxel-development`, only ticket-relevant references are included when
 * a ticket is provided, keeping the context focused.
 */
export function enforceSkillBudget(
  skills: ResolvedSkill[],
  maxTokens: number | undefined,
  ticket?: TicketCard,
): ResolvedSkill[] {
  if (!maxTokens || maxTokens <= 0) {
    return skills;
  }

  // Apply targeted reference filtering for boxel-development
  let filtered = skills.map((skill) =>
    skill.name === 'boxel-development' && skill.references
      ? filterBoxelDevelopmentRefs(skill, ticket)
      : skill,
  );

  // Sort by priority
  let sorted = [...filtered].sort((a, b) => {
    let aPriority = SKILL_PRIORITY.indexOf(a.name);
    let bPriority = SKILL_PRIORITY.indexOf(b.name);
    if (aPriority === -1) {
      aPriority = SKILL_PRIORITY.length;
    }
    if (bPriority === -1) {
      bPriority = SKILL_PRIORITY.length;
    }
    return aPriority - bPriority;
  });

  let result: ResolvedSkill[] = [];
  let usedTokens = 0;

  for (let skill of sorted) {
    let skillTokens = estimateTokens(skill);

    if (usedTokens + skillTokens > maxTokens) {
      console.warn(
        `[SkillBudget] Dropping skill "${skill.name}" (${skillTokens} tokens) — ` +
          `would exceed budget of ${maxTokens} (used: ${usedTokens})`,
      );
      continue;
    }

    result.push(skill);
    usedTokens += skillTokens;
  }

  return result;
}

/**
 * Filter boxel-development references to include only the "always load"
 * references plus those whose keywords match the ticket text.
 */
function filterBoxelDevelopmentRefs(
  skill: ResolvedSkill,
  ticket?: TicketCard,
): ResolvedSkill {
  if (!skill.references || skill.references.length === 0) {
    return skill;
  }

  if (!ticket) {
    return skill;
  }

  let ticketText = extractTicketText(ticket);
  let allRefNames = Object.keys(REFERENCE_KEYWORD_MAP);

  let filteredRefs = skill.references.filter((_content, index) => {
    // We need to know the filename to decide. Since references are loaded
    // in sorted order, we reconstruct the sorted file list. The "always load"
    // references (dev-core-concept.md, dev-technical-rules.md, dev-quick-reference.md)
    // come first alphabetically in the sorted list. We use a simpler approach:
    // keep all always-load refs plus keyword-matched refs.
    let sortedNames = [...ALWAYS_LOAD_REFERENCES, ...allRefNames].sort();
    // Deduplicate
    let uniqueNames = [...new Set(sortedNames)];

    if (index >= uniqueNames.length) {
      return false;
    }

    let refName = uniqueNames[index];
    if (!refName) {
      return false;
    }

    // Always-load refs are always included
    if (ALWAYS_LOAD_REFERENCES.includes(refName)) {
      return true;
    }

    // Check if ticket text matches any keywords for this reference
    let keywords = REFERENCE_KEYWORD_MAP[refName];
    if (keywords && matchesAnyKeyword(ticketText, keywords)) {
      return true;
    }

    return false;
  });

  return {
    ...skill,
    references: filteredRefs.length > 0 ? filteredRefs : undefined,
  };
}

/** Estimate token count for a resolved skill. */
export function estimateTokens(skill: ResolvedSkill): number {
  let total = skill.content.length;

  if (skill.references) {
    for (let ref of skill.references) {
      total += ref.length;
    }
  }

  return Math.ceil(total / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Extract searchable text from a ticket card.
 * Concatenates known text fields (id, title, description, tags, labels, etc.)
 * into a single lowercase string for keyword matching.
 */
export function extractTicketText(ticket: TicketCard): string {
  let parts: string[] = [ticket.id];

  for (let key of [
    'title',
    'description',
    'summary',
    'body',
    'name',
    'tags',
    'labels',
    'scope',
    'notes',
  ]) {
    let value = ticket[key];
    if (typeof value === 'string') {
      parts.push(value);
    } else if (Array.isArray(value)) {
      for (let item of value) {
        if (typeof item === 'string') {
          parts.push(item);
        } else if (typeof item === 'object' && item !== null) {
          // Handle objects with name/label/value properties
          for (let prop of ['name', 'label', 'value', 'title']) {
            let v = (item as Record<string, unknown>)[prop];
            if (typeof v === 'string') {
              parts.push(v);
            }
          }
        }
      }
    }
  }

  return parts.join(' ').toLowerCase();
}

/**
 * Extract additional skill names from knowledge articles in a project card.
 * Looks for `knowledge` array entries with `skills` or `tags` arrays.
 */
function extractKnowledgeSkillTags(project: ProjectCard): string[] {
  let knowledge = project.knowledge;
  if (!Array.isArray(knowledge)) {
    return [];
  }

  let skills: string[] = [];

  for (let article of knowledge) {
    if (typeof article !== 'object' || article === null) {
      continue;
    }

    let articleObj = article as Record<string, unknown>;

    // Check for explicit skills array
    let articleSkills = articleObj.skills;
    if (Array.isArray(articleSkills)) {
      for (let s of articleSkills) {
        if (typeof s === 'string' && s.trim() !== '') {
          skills.push(s.trim());
        }
      }
    }

    // Check for tags that match skill names
    let tags = articleObj.tags;
    if (Array.isArray(tags)) {
      for (let tag of tags) {
        let tagName = typeof tag === 'string' ? tag : null;
        if (
          tagName === null &&
          typeof tag === 'object' &&
          tag !== null &&
          'name' in tag
        ) {
          tagName = String((tag as Record<string, unknown>).name);
        }
        if (tagName && tagName.startsWith('skill:')) {
          skills.push(tagName.slice('skill:'.length).trim());
        }
      }
    }
  }

  return skills;
}

function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw.toLowerCase()));
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    let s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class SkillLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillLoadError';
  }
}
