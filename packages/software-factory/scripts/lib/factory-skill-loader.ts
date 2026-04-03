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

/**
 * CLI skills that depend on boxel CLI commands. These are excluded from the
 * factory agent's tool registry (boxel-cli tools are not available until
 * CS-10520 lands). They remain valid for human Claude Code sessions but
 * should not be resolved for the factory execution loop.
 */
const CLI_ONLY_SKILLS: readonly string[] = [
  'boxel-sync',
  'boxel-track',
  'boxel-watch',
  'boxel-restore',
  'boxel-repair',
  'boxel-setup',
];

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
  'dev-spec-usage.md': ['spec', 'catalog', 'specification'],
  'dev-playwright-testing.md': ['test', 'playwright', 'spec.ts', 'verify'],
  'dev-realm-search.md': ['search', 'query', 'filter', 'find', 'realm'],
  'dev-replicate-ai.md': ['replicate', 'ai', 'model', 'ml'],
};

/** References that are always loaded for boxel-development (per SKILL.md). */
const ALWAYS_LOAD_REFERENCES: readonly string[] = [
  'dev-core-concept.md',
  'dev-technical-rules.md',
  'dev-quick-reference.md',
];

// ---------------------------------------------------------------------------
// Internal types for tracking reference metadata
// ---------------------------------------------------------------------------

interface NamedReference {
  fileName: string;
  content: string;
}

interface RawSkillData {
  name: string;
  content: string;
  references?: NamedReference[];
}

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
   * Resolution rules (from the phase-1 plan):
   * 1. boxel-development + boxel-file-structure — always loaded (common case)
   * 2. ember-best-practices — when ticket involves .gts component code
   * 3. software-factory-operations — for factory delivery workflow tickets
   * 4. KnowledgeArticle tags can specify additional skills
   *
   * CLI skills (boxel-sync, boxel-track, boxel-watch, boxel-restore,
   * boxel-repair, boxel-setup) are excluded because the factory agent's
   * tool registry does not include boxel-cli tools (deferred to CS-10520).
   * These skills reference commands the agent cannot invoke.
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

    // Check for additional skills from knowledge articles on the project
    // and from related knowledge on the ticket itself.
    let additionalSkills = extractKnowledgeSkillTags(project, ticket);
    for (let skillName of additionalSkills) {
      if (!skills.includes(skillName)) {
        skills.push(skillName);
      }
    }

    // Filter out CLI-only skills that reference boxel CLI commands the
    // factory agent cannot invoke (tool registry excludes boxel-cli tools).
    return skills.filter((s) => !CLI_ONLY_SKILLS.includes(s));
  }
}

// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------

export interface SkillLoaderInterface {
  load(skillName: string, ticket?: TicketCard): Promise<ResolvedSkill>;
  loadAll(skillNames: string[], ticket?: TicketCard): Promise<ResolvedSkill[]>;
}

export class SkillLoader implements SkillLoaderInterface {
  private skillsDirs: string[];
  private rawCache: Map<string, RawSkillData> = new Map();

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
   * When a ticket is provided, `boxel-development` references are filtered to
   * only include ticket-relevant files (always applied, not just with a budget).
   * Results are cached for the duration of the factory run.
   */
  async load(skillName: string, ticket?: TicketCard): Promise<ResolvedSkill> {
    let raw = await this.loadRaw(skillName);
    return toResolvedSkill(raw, ticket);
  }

  /**
   * Load all skills matching the resolved names.
   * Missing skills log a warning but do not fail the batch.
   */
  async loadAll(
    skillNames: string[],
    ticket?: TicketCard,
  ): Promise<ResolvedSkill[]> {
    let results: ResolvedSkill[] = [];

    for (let name of skillNames) {
      try {
        let skill = await this.load(name, ticket);
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
    this.rawCache.clear();
  }

  /**
   * Load raw skill data (with reference filenames preserved) from disk.
   * Cached for the factory run duration.
   */
  private async loadRaw(skillName: string): Promise<RawSkillData> {
    let cached = this.rawCache.get(skillName);
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

    let references: NamedReference[] | undefined;

    // Check for rules/ directory first (e.g., ember-best-practices).
    // Load compiled AGENTS.md instead of individual rule files.
    let rulesDir = join(skillDir, 'rules');
    if (await directoryExists(rulesDir)) {
      let agentsMdPath = join(skillDir, 'AGENTS.md');
      try {
        let agentsContent = await readFile(agentsMdPath, 'utf8');
        references = [{ fileName: 'AGENTS.md', content: agentsContent }];
      } catch {
        // If AGENTS.md doesn't exist, fall through — no references
      }
    }

    // Check for references/ directory (e.g., boxel-development).
    // Load all reference files with their filenames preserved.
    if (!references) {
      let refsDir = join(skillDir, 'references');
      if (await directoryExists(refsDir)) {
        let files = await readdir(refsDir);
        let mdFiles = files.filter((f) => f.endsWith('.md')).sort();
        references = await Promise.all(
          mdFiles.map(async (f) => ({
            fileName: f,
            content: await readFile(join(refsDir, f), 'utf8'),
          })),
        );
      }
    }

    let raw: RawSkillData = {
      name: skillName,
      content,
      ...(references && references.length > 0 ? { references } : {}),
    };

    this.rawCache.set(skillName, raw);
    return raw;
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
 * Skills are sorted by priority (from SKILL_PRIORITY) and then added in that
 * order until the budget would be exceeded. Skills that do not fit are
 * skipped, and later (lower-priority) skills may still be included if they
 * fit within the remaining budget.
 *
 * Reference filtering for `boxel-development` is handled at load time by the
 * SkillLoader when a ticket is provided — it is always applied regardless of
 * whether a budget is set.
 */
export function enforceSkillBudget(
  skills: ResolvedSkill[],
  maxTokens: number | undefined,
): ResolvedSkill[] {
  if (!maxTokens || maxTokens <= 0) {
    return skills;
  }

  // Sort by priority
  let sorted = [...skills].sort((a, b) => {
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
// Internal: convert raw data to public ResolvedSkill
// ---------------------------------------------------------------------------

/**
 * Convert RawSkillData (with named references) to the public ResolvedSkill
 * interface. For `boxel-development`, filters references by ticket relevance
 * using actual filenames — this happens on every load, not just when a
 * budget is enforced.
 */
function toResolvedSkill(
  raw: RawSkillData,
  ticket?: TicketCard,
): ResolvedSkill {
  let refs = raw.references;

  if (refs && raw.name === 'boxel-development' && ticket) {
    refs = filterBoxelDevelopmentRefs(refs, ticket);
  }

  let refContents =
    refs && refs.length > 0 ? refs.map((r) => r.content) : undefined;

  return {
    name: raw.name,
    content: raw.content,
    ...(refContents ? { references: refContents } : {}),
  };
}

/**
 * Filter boxel-development references to include only the "always load"
 * references plus those whose keywords match the ticket text.
 * Uses actual filenames from disk — no index-based reconstruction.
 */
function filterBoxelDevelopmentRefs(
  refs: NamedReference[],
  ticket: TicketCard,
): NamedReference[] {
  let ticketText = extractTicketText(ticket);

  return refs.filter((ref) => {
    // Always-load refs are always included
    if (
      ALWAYS_LOAD_REFERENCES.includes(
        ref.fileName as (typeof ALWAYS_LOAD_REFERENCES)[number],
      )
    ) {
      return true;
    }

    // Check if ticket text matches any keywords for this reference
    let keywords = REFERENCE_KEYWORD_MAP[ref.fileName];
    if (keywords && matchesAnyKeyword(ticketText, keywords)) {
      return true;
    }

    // References not in the keyword map (e.g., dev-file-editing.md) are only
    // loaded when no ticket context is available (handled by the caller).
    return false;
  });
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
 * Extract additional skill names from knowledge articles.
 * Checks both the project's `knowledgeBase` field (Project card schema) and
 * the ticket's `relatedKnowledge` field (Ticket card schema), as well as the
 * generic `knowledge` field for forward compatibility.
 */
function extractKnowledgeSkillTags(
  project: ProjectCard,
  ticket?: TicketCard,
): string[] {
  let articles: unknown[] = [];

  // Collect knowledge articles from all known field names
  for (let source of [project, ticket]) {
    if (!source) {
      continue;
    }
    for (let field of ['knowledge', 'knowledgeBase', 'relatedKnowledge']) {
      let value = (source as Record<string, unknown>)[field];
      if (Array.isArray(value)) {
        articles.push(...value);
      }
    }
  }

  let skills: string[] = [];

  for (let article of articles) {
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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  let lowerText = text.toLowerCase();

  return keywords.some((kw) => {
    let lowerKw = kw.toLowerCase();

    // Allow dotted/special tokens (e.g. ".gts", "CardDef") to match as
    // substrings — these are specific enough to not cause false positives.
    if (lowerKw.includes('.') || lowerKw !== lowerKw.toLowerCase()) {
      return lowerText.includes(lowerKw);
    }

    // For plain-word keywords, require word-boundary matches to avoid
    // false positives like "sync" matching "async".
    let pattern = new RegExp(`\\b${escapeRegExp(lowerKw)}\\b`);
    return pattern.test(lowerText);
  });
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
