import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  IssueData,
  ProjectData,
  ResolvedSkill,
  SkillIndexEntry,
} from './factory-agent/index.ts';
import { logger } from './logger.ts';

const log = logger('factory-skill-loader');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const MONOREPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/**
 * The factory's own workflow skills (`software-factory-bootstrap`,
 * `software-factory-operations`). These describe the factory-MCP-tool
 * surface (`signal_done`, `get_card_schema`, `run_lint`, …) that the
 * orchestrator's agent actually provides, so they are front-loaded in
 * full — the agent must follow the delivery workflow, not discover it.
 *
 * (The sibling `.agents/skills/` directory holds the interactive Claude
 * Code variants of these skills — a different tool surface — and is
 * deliberately NOT on this loader's search path.)
 */
const DEFAULT_SKILLS_DIR = join(PACKAGE_ROOT, '.agents', 'skills-orchestrator');

/**
 * The domain-skill library: `packages/boxel-cli/plugin/skills/`.
 *
 * This is the factory's single source of truth for everything that isn't
 * the factory workflow itself. It contains two populations, both consumed
 * on demand via the skill index + `read_skill` tool:
 *
 * - skills bundled from the `cardstack/boxel-skills` repo at a pinned tag
 *   by boxel-cli's `build:skills` script (`boxel`, `boxel-patterns`,
 *   `boxel-design`, …);
 * - CLI-native skills authored in place (`boxel-api`, `boxel-command`,
 *   `boxel-file-structure`, …) documenting the `boxel` CLI surface.
 */
const DEFAULT_FALLBACK_DIRS = [
  join(MONOREPO_ROOT, 'packages', 'boxel-cli', 'plugin', 'skills'),
];

/**
 * Skills excluded from the factory's on-demand index. Their entire subject
 * is workspace/realm lifecycle the orchestrator owns — an agent following
 * them (e.g. `boxel realm push`, `boxel file write`) would mutate the realm
 * behind the orchestrator's workspace→realm sync and corrupt the loop's
 * view of what changed.
 */
const FACTORY_EXCLUDED_SKILLS: ReadonlySet<string> = new Set([
  'file-ops',
  'realm-sync',
  'realm-history',
  'profile',
  'boxel-environment',
]);

/** Approximate characters per token for budget estimation. */
const CHARS_PER_TOKEN = 4;

/**
 * Priority order for front-loaded skills. Lower index = higher priority.
 * Skills not in this list get appended at the end (lowest priority).
 * Only the factory workflow skills are front-loaded, so this list is
 * short; knowledge-tag opt-ins land behind them.
 */
const SKILL_PRIORITY: readonly string[] = [
  'software-factory-bootstrap',
  'software-factory-operations',
];

// ---------------------------------------------------------------------------
// Keyword matchers for skill suggestion
// ---------------------------------------------------------------------------

/** Keywords in issue content that indicate .gts component work. */
const GTS_KEYWORDS = [
  '.gts',
  'component',
  'template',
  'glimmer',
  'ember',
  'CardDef',
  'FieldDef',
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

/**
 * The resolver's split decision for one issue: which skills go into the
 * system prompt in full, and which merely get a "suggested" marker in the
 * on-demand skill index. The agent can load ANY indexed skill via
 * `read_skill` regardless of the suggestions — they are a hint, not a gate.
 */
export interface SkillResolution {
  /** Skill names front-loaded in full into the system prompt. */
  load: string[];
  /** Skill names highlighted as suggested in the on-demand skill index. */
  suggested: string[];
}

export interface SkillResolver {
  resolve(issue: IssueData, project: ProjectData): SkillResolution;
}

export interface DefaultSkillResolverOptions {
  /**
   * Feature flag — when true, `boxel-ui-component-discovery` is added to the
   * front-loaded skill set so the agent searches the catalog for boxel-ui
   * Specs before writing UI in `.gts` files. Pair with the
   * `enableBoxelUiDiscovery` flag passed to the system-prompt template so
   * the catalog-search exception in `prompts/system.md` is also enabled.
   * See CS-10527.
   */
  enableBoxelUiDiscovery?: boolean;
}

export class DefaultSkillResolver implements SkillResolver {
  private enableBoxelUiDiscovery: boolean;

  constructor(options: DefaultSkillResolverOptions = {}) {
    this.enableBoxelUiDiscovery = options.enableBoxelUiDiscovery === true;
  }

  /**
   * Decide which skills to front-load and which to suggest for this issue.
   *
   * Front-loaded (full text in the system prompt):
   * 1. The factory workflow skill — `software-factory-bootstrap` for
   *    bootstrap issues, `software-factory-operations` for everything else.
   * 2. `boxel-ui-component-discovery` under its feature flag.
   * 3. Any skills opted in via KnowledgeArticle `skill:` tags — a deliberate
   *    per-project/per-issue authoring decision.
   *
   * Suggested (marked in the on-demand index, loaded only when the agent
   * calls `read_skill`):
   * - The core domain skills every implementation issue plausibly needs
   *   (`boxel`, `boxel-file-structure`, `boxel-api`, `boxel-command`).
   * - UI-flavored skills when the issue text indicates .gts component work.
   */
  resolve(issue: IssueData, project: ProjectData): SkillResolution {
    let issueText = extractIssueText(issue);
    let issueType = (issue as Record<string, unknown>).issueType;

    let load: string[];
    let suggested: string[];

    if (issueType === 'bootstrap') {
      load = ['software-factory-bootstrap'];
      suggested = ['boxel-file-structure'];
    } else {
      load = ['software-factory-operations'];
      suggested = [
        'boxel',
        'boxel-file-structure',
        'boxel-api',
        'boxel-command',
      ];

      if (matchesAnyKeyword(issueText, GTS_KEYWORDS)) {
        suggested.push('boxel-ui-guidelines', 'boxel-design', 'boxel-patterns');
      }
    }

    if (this.enableBoxelUiDiscovery) {
      // Always front-loaded under the feature flag. The directive must apply
      // even when the issue text doesn't contain `component` / `.gts` /
      // `template` literally — briefs that just describe a form, view, or
      // "isolated render" would otherwise miss the discovery skill and the
      // agent would hand-roll UI. See CS-10527.
      load.push('boxel-ui-component-discovery');
    }

    // KnowledgeArticle skill tags are the deliberate opt-in for a
    // must-have skill, so they stay front-loaded rather than suggested.
    let additionalSkills = extractKnowledgeSkillTags(project, issue);
    for (let skillName of additionalSkills) {
      if (!load.includes(skillName)) {
        load.push(skillName);
      }
    }

    log.info(
      `Resolved skills for issue "${issue.id}" (issueType=${issueType ?? '(none)'}): ` +
        `load=[${load.join(', ')}], suggested=[${suggested.join(', ')}]`,
    );

    return { load, suggested };
  }
}

// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------

export interface SkillLoaderInterface {
  load(skillName: string): Promise<ResolvedSkill>;
  loadAll(skillNames: string[]): Promise<ResolvedSkill[]>;
  buildIndex(): Promise<SkillIndexEntry[]>;
}

/**
 * The read surface the `read_skill` factory tool needs. Kept separate from
 * `SkillLoaderInterface` so the tool builder can depend on exactly the
 * on-demand operations.
 */
export interface SkillReaderInterface {
  buildIndex(): Promise<SkillIndexEntry[]>;
  readSkill(skillName: string): Promise<ReadSkillResult>;
  readReference(skillName: string, fileName: string): Promise<string>;
}

export interface ReadSkillResult {
  name: string;
  content: string;
  /** Filenames of this skill's reference documents, fetchable individually. */
  referenceFiles: string[];
}

export class SkillLoader implements SkillLoaderInterface, SkillReaderInterface {
  /** Bundled sources — always serve `load()`/`loadAll()` (front-loaded skills). */
  private defaultDirs: string[];
  /**
   * When set (`--skills-dir`), the on-demand library — `buildIndex()`,
   * `readSkill()`, `readReference()` — comes EXCLUSIVELY from these
   * directories, with no exclusion filtering (the operator curates them).
   * Front-loaded skills still resolve from the bundled sources.
   */
  private libraryDirs: string[] | undefined;
  private rawCache: Map<string, RawSkillData> = new Map();
  private indexCache: SkillIndexEntry[] | undefined;

  /**
   * @param skillsDir      Primary directory to search for skills.
   * @param fallbackDirs   Additional directories checked (in order) when a
   *                        skill is not found in the primary directory. Defaults
   *                        to boxel-cli's `plugin/skills/`.
   * @param options.libraryDirs  Optional operator-supplied skill directories
   *                        (`--skills-dir`). When present, they fully replace
   *                        the on-demand skill library — nothing outside them
   *                        is indexed or readable via `read_skill`, and the
   *                        exclusion list does not apply.
   */
  constructor(
    skillsDir: string = DEFAULT_SKILLS_DIR,
    fallbackDirs: string[] = DEFAULT_FALLBACK_DIRS,
    options: { libraryDirs?: string[] } = {},
  ) {
    this.defaultDirs = [skillsDir, ...fallbackDirs];
    this.libraryDirs =
      options.libraryDirs && options.libraryDirs.length > 0
        ? options.libraryDirs
        : undefined;
  }

  /**
   * Load a single skill by name from the bundled sources (front-load path;
   * unaffected by `--skills-dir`).
   * Searches the primary skills directory first, then each fallback directory.
   * Results are cached for the duration of the factory run.
   */
  async load(skillName: string): Promise<ResolvedSkill> {
    let raw = await this.loadRaw(skillName, this.defaultDirs, 'default');
    let refContents =
      raw.references && raw.references.length > 0
        ? raw.references.map((r) => r.content)
        : undefined;
    return {
      name: raw.name,
      content: raw.content,
      ...(refContents ? { references: refContents } : {}),
    };
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
          `Skipping unavailable skill "${name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return results;
  }

  /**
   * Build the on-demand skill index: one `{ name, description }` entry per
   * skill directory across the library, keyed by directory name (first
   * directory wins on name collisions). Descriptions come from the
   * `description:` field of each SKILL.md's frontmatter — skills without one
   * are skipped with a warning, since an undescribed entry gives the agent
   * nothing to decide relevance by. Cached for the run duration.
   *
   * Library scope: the bundled sources minus FACTORY_EXCLUDED_SKILLS — or,
   * when `libraryDirs` was configured, exactly those directories with no
   * exclusions. An override library that yields zero skills is a
   * configuration error and throws rather than silently degrading the
   * agent to no on-demand skills.
   */
  async buildIndex(): Promise<SkillIndexEntry[]> {
    if (this.indexCache) {
      return this.indexCache;
    }

    let scanDirs = this.libraryDirs ?? this.defaultDirs;
    let applyExclusions = this.libraryDirs === undefined;
    let entries = new Map<string, SkillIndexEntry>();

    for (let baseDir of scanDirs) {
      let dirNames: string[];
      try {
        dirNames = await readdir(baseDir);
      } catch {
        continue;
      }

      for (let name of dirNames.sort()) {
        if (
          entries.has(name) ||
          (applyExclusions && FACTORY_EXCLUDED_SKILLS.has(name))
        ) {
          continue;
        }
        let skillMdPath = join(baseDir, name, 'SKILL.md');
        let content: string;
        try {
          content = await readFile(skillMdPath, 'utf8');
        } catch {
          // Not a skill directory (plain file, or missing SKILL.md) — skip.
          continue;
        }
        let description = parseFrontmatterDescription(content);
        if (!description) {
          log.warn(
            `Skill "${name}" has no frontmatter description — omitting from the skill index`,
          );
          continue;
        }
        entries.set(name, { name, description });
      }
    }

    if (this.libraryDirs && entries.size === 0) {
      throw new SkillLoadError(
        `--skills-dir provided but no skills found in: ${this.libraryDirs.join(', ')}. ` +
          'Each skill must be a directory containing a SKILL.md with a frontmatter description.',
      );
    }

    this.indexCache = [...entries.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return this.indexCache;
  }

  /**
   * Read one skill's SKILL.md for on-demand consumption, along with the
   * filenames of its reference documents (fetchable via `readReference`).
   * Served from the library scope (see `buildIndex`).
   */
  async readSkill(skillName: string): Promise<ReadSkillResult> {
    let raw = await this.loadRawFromLibrary(skillName);
    return {
      name: raw.name,
      content: raw.content,
      referenceFiles: (raw.references ?? []).map((r) => r.fileName),
    };
  }

  /**
   * Read a single named reference document of a skill, from the library
   * scope. `fileName` must be one of the names returned by
   * `readSkill().referenceFiles` — arbitrary paths are rejected.
   */
  async readReference(skillName: string, fileName: string): Promise<string> {
    let raw = await this.loadRawFromLibrary(skillName);
    let ref = (raw.references ?? []).find((r) => r.fileName === fileName);
    if (!ref) {
      let available = (raw.references ?? []).map((r) => r.fileName);
      throw new SkillLoadError(
        `Skill "${skillName}" has no reference "${fileName}". ` +
          (available.length > 0
            ? `Available references: ${available.join(', ')}`
            : 'This skill has no reference files.'),
      );
    }
    return ref.content;
  }

  /** Clear the caches so skills are re-read from disk on next load. */
  clearCache(): void {
    this.rawCache.clear();
    this.indexCache = undefined;
  }

  /** Load raw skill data from the on-demand library scope. */
  private async loadRawFromLibrary(skillName: string): Promise<RawSkillData> {
    return this.libraryDirs
      ? this.loadRaw(skillName, this.libraryDirs, 'library')
      : this.loadRaw(skillName, this.defaultDirs, 'default');
  }

  /**
   * Load raw skill data (with reference filenames preserved) from disk.
   * Cached for the factory run duration. `cacheScope` keeps the bundled
   * and override-library caches apart — the same skill name can resolve
   * to different directories in each.
   */
  private async loadRaw(
    skillName: string,
    searchDirs: string[],
    cacheScope: 'default' | 'library',
  ): Promise<RawSkillData> {
    let cacheKey = `${cacheScope}:${skillName}`;
    let cached = this.rawCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let skillDir = await this.findSkillDir(skillName, searchDirs);
    if (!skillDir) {
      let searched = searchDirs.map((d) => join(d, skillName)).join(', ');
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

    // Check for rules/ directory first. Load compiled AGENTS.md instead of
    // individual rule files.
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

    // Check for references/ directory. Load all reference files with their
    // filenames preserved.
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

    this.rawCache.set(cacheKey, raw);
    return raw;
  }

  /**
   * Search the given skill directories for a skill by name.
   * Returns the full path to the skill directory, or undefined if not found.
   */
  private async findSkillDir(
    skillName: string,
    searchDirs: string[],
  ): Promise<string | undefined> {
    for (let baseDir of searchDirs) {
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
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Extract the `description:` value from a SKILL.md's YAML frontmatter.
 * Handles the single-line scalar form every skill in the search path uses
 * (optionally quoted); returns undefined when there is no frontmatter block
 * or no description field.
 */
export function parseFrontmatterDescription(
  content: string,
): string | undefined {
  if (!content.startsWith('---')) {
    return undefined;
  }
  let end = content.indexOf('\n---', 3);
  if (end === -1) {
    return undefined;
  }
  let block = content.slice(3, end);
  let match = block.match(/^description:[ \t]*(.+)$/m);
  if (!match) {
    return undefined;
  }
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value === '' ? undefined : value;
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
 * Only front-loaded skills pass through here (the workflow skill plus
 * knowledge-tag opt-ins) — on-demand skills are never budgeted, they are
 * fetched as tool results.
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
        `Dropping skill "${skill.name}" (${skillTokens} tokens) — ` +
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
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Extract searchable text from an issue card.
 * Concatenates known text fields (id, title, description, tags, labels, etc.)
 * into a single lowercase string for keyword matching.
 */
export function extractIssueText(issue: IssueData): string {
  let parts: string[] = [issue.id];

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
    let value = issue[key];
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
 * the issue's `relatedKnowledge` field (Issue card schema), as well as the
 * generic `knowledge` field for forward compatibility.
 */
function extractKnowledgeSkillTags(
  project: ProjectData,
  issue?: IssueData,
): string[] {
  let articles: unknown[] = [];

  // Collect knowledge articles from all known field names
  for (let source of [project, issue]) {
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
