/**
 * Generate plugin/skills/<skill>/SKILL.md (and references/) for every
 * boxel-skills-derived plugin skill. Run via `pnpm build:skills` from
 * `packages/boxel-cli/`.
 *
 * Source: cardstack/boxel-skills at a pinned tag (BOXEL_SKILLS_VERSION).
 * Override the source location with BOXEL_SKILLS_REPO=/path/to/checkout for
 * local development against an unreleased boxel-skills branch.
 *
 * Emission policy: every SkillSet aggregator + every SkillPlusMarkdown leaf
 * that is NOT a child of any aggregator. Aggregator children stay inside
 * `plugin/skills/<aggregator>/references/`. No allowlist — adding a card
 * upstream automatically packages it on the next `pnpm build:skills`.
 *
 * The on-`main` workflow `.github/workflows/boxel-cli-publish.yml` runs this
 * and commits the regenerated `plugin/skills/` diff back to main.
 */
import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { resolve } from 'path';
import { format, resolveConfig } from 'prettier';

const BOXEL_SKILLS_VERSION = 'v0.0.22';
const BOXEL_SKILLS_REPO_URL = 'https://github.com/cardstack/boxel-skills.git';

const PLUGIN_DIR = resolve(__dirname, '..', 'plugin');
const PLUGIN_README_PATH = resolve(PLUGIN_DIR, 'README.md');
const CACHE_DIR = resolve(__dirname, '..', '.boxel-skills-cache');

const README_BEGIN_MARKER =
  '<!-- BEGIN AUTO-GENERATED: boxel-skills (run `pnpm build:skills` to update) -->';
const README_END_MARKER = '<!-- END AUTO-GENERATED: boxel-skills -->';

/**
 * Per-skill overrides for the lean SKILL.md frontmatter `description`. The
 * source's cardInfo.summary is often too generic for Claude Code's
 * auto-activation; these descriptions are tuned for skill discovery. New
 * boxel-skills cards fall through to upstream cardInfo.summary — only add an
 * override here if a specific skill's auto-activation proves too noisy/quiet.
 */
export const DESCRIPTION_OVERRIDES: Record<string, string> = {
  'boxel-development':
    'Authoring Boxel cards. Use when creating or editing .gts card definitions, .json card instances, or answering questions about CardDef / FieldDef / templates / Boxel patterns. Covers the full .gts authoring surface — imports, fields, formats (isolated/embedded/fitted/atom/edit), styling, and common pitfalls.',
  'boxel-design':
    'Boxel UI design discovery. Use when designing or redesigning a Boxel app, choosing a visual direction, or pushing past default look-and-feel before generating code.',
};

export interface SkillCard {
  id: string;
  json: any;
  /** Adopted card type, e.g. "SkillSet" or "SkillPlusMarkdown". */
  kind: string;
}

export interface RelatedSkill {
  id: string;
  inclusionMode: 'full' | 'link-only';
  summary: string;
}

export interface EmissionPlan {
  /** Cards to emit as top-level plugin skills, in stable order. */
  emit: SkillCard[];
  /** Card IDs that are children of some emitted SkillSet aggregator. */
  aggregatorChildren: Set<string>;
  /** Cards skipped because their `kind` is not understood. */
  unsupported: SkillCard[];
}

function resolveSourceRoot(): string {
  const override = process.env.BOXEL_SKILLS_REPO;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(
        `BOXEL_SKILLS_REPO is set to "${override}" but that path does not exist.`,
      );
    }
    console.log(`Using BOXEL_SKILLS_REPO override: ${override}`);
    return override;
  }
  const target = resolve(CACHE_DIR, BOXEL_SKILLS_VERSION);
  if (existsSync(resolve(target, 'Skill'))) {
    console.log(`Using cached boxel-skills clone at ${target}`);
    return target;
  }
  console.log(
    `Cloning boxel-skills@${BOXEL_SKILLS_VERSION} into ${target} ...`,
  );
  mkdirSync(CACHE_DIR, { recursive: true });
  execSync(
    `git clone --depth 1 --branch ${BOXEL_SKILLS_VERSION} ${BOXEL_SKILLS_REPO_URL} ${JSON.stringify(target)}`,
    { stdio: 'inherit' },
  );
  return target;
}

function loadSkillCards(sourceRoot: string): Map<string, SkillCard> {
  const skillsDir = resolve(sourceRoot, 'Skill');
  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) {
    throw new Error(`Source missing Skill/ directory: ${sourceRoot}`);
  }
  const cards = new Map<string, SkillCard>();
  for (const name of readdirSync(skillsDir)) {
    if (!name.endsWith('.json')) continue;
    const id = name.replace(/\.json$/, '');
    const path = resolve(skillsDir, name);
    let json: any;
    try {
      json = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new Error(`Failed to parse ${path}: ${(e as Error).message}`);
    }
    const kind = json?.data?.meta?.adoptsFrom?.name ?? '<unknown>';
    cards.set(id, { id, json, kind });
  }
  return cards;
}

export function getCardName(card: SkillCard): string {
  const a = card.json?.data?.attributes ?? {};
  return a?.cardInfo?.name ?? a?.cardTitle ?? card.id;
}

export function getCardSummary(card: SkillCard): string {
  const a = card.json?.data?.attributes ?? {};
  return a?.cardInfo?.summary ?? a?.cardDescription ?? '';
}

/**
 * The frontmatter `description` written into each emitted SKILL.md, and the
 * same text used in the auto-generated README table column. Mirrors the
 * fallback chain in `emitAggregator` / `emitLeaf`.
 */
export function getSkillDescription(card: SkillCard): string {
  const override = DESCRIPTION_OVERRIDES[card.id];
  if (override) return override;
  const summary = getCardSummary(card);
  if (summary) return summary;
  const name = getCardName(card);
  return card.kind === 'SkillSet' ? `${name} skill from boxel-skills.` : name;
}

export function getRelatedSkills(card: SkillCard): RelatedSkill[] {
  const attrs = card.json?.data?.attributes;
  const rels = card.json?.data?.relationships;
  if (!Array.isArray(attrs?.relatedSkills) || !rels) return [];
  const out: RelatedSkill[] = [];
  attrs.relatedSkills.forEach((entry: any, i: number) => {
    const link = rels[`relatedSkills.${i}.skill`]?.links?.self;
    if (typeof link !== 'string') return;
    const id = link.replace(/^\.\//, '');
    out.push({
      id,
      inclusionMode:
        entry?.inclusionMode === 'link-only' ? 'link-only' : 'full',
      summary:
        typeof entry?.contentSummary === 'string' ? entry.contentSummary : '',
    });
  });
  return out;
}

function getLeafBody(sourceRoot: string, leafId: string): string {
  const path = resolve(sourceRoot, 'Skill', `${leafId}.md`);
  if (!existsSync(path)) {
    throw new Error(`Leaf skill body missing: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

function frontmatter(name: string, description: string): string {
  // Collapse whitespace; Claude Code reads description as one line.
  const desc = description.replace(/\s+/g, ' ').trim();
  return `---\nname: ${name}\ndescription: ${desc}\n---\n`;
}

/**
 * Write `content` to `filePath` after running it through the repo's Prettier
 * config. Without this the generated markdown drifts from the committed copy
 * whenever any local format pass (pre-commit hook, `pnpm format`, editor on-save)
 * touches it, breaking the boxel-skills sync freshness CI gate.
 */
async function writeFormattedMarkdown(
  filePath: string,
  content: string,
): Promise<void> {
  const config = (await resolveConfig(filePath)) ?? {};
  const formatted = await format(content, {
    ...config,
    parser: 'markdown',
    filepath: filePath,
  });
  writeFileSync(filePath, formatted);
}

function clearReferencesDir(skillName: string): void {
  const refsDir = resolve(PLUGIN_DIR, 'skills', skillName, 'references');
  if (existsSync(refsDir)) {
    rmSync(refsDir, { recursive: true, force: true });
  }
}

async function emitAggregator(
  sourceRoot: string,
  card: SkillCard,
  related: RelatedSkill[],
): Promise<void> {
  const name = card.id;
  const skillDir = resolve(PLUGIN_DIR, 'skills', name);
  mkdirSync(skillDir, { recursive: true });

  clearReferencesDir(name);
  const refsDir = resolve(skillDir, 'references');
  mkdirSync(refsDir, { recursive: true });
  for (const r of related) {
    const body = getLeafBody(sourceRoot, r.id);
    await writeFormattedMarkdown(resolve(refsDir, `${r.id}.md`), body);
  }

  const cardName = getCardName(card);
  const description = getSkillDescription(card);
  const attrs = card.json?.data?.attributes ?? {};
  const intro =
    typeof attrs.frontMatter === 'string' ? attrs.frontMatter.trim() : '';
  const outro =
    typeof attrs.backMatter === 'string' ? attrs.backMatter.trim() : '';

  const fullRefs = related.filter((r) => r.inclusionMode === 'full');
  const linkOnlyRefs = related.filter((r) => r.inclusionMode === 'link-only');

  const refIndex: string[] = [];
  refIndex.push('## References');
  refIndex.push('');
  refIndex.push(
    `_Generated from \`cardstack/boxel-skills@${BOXEL_SKILLS_VERSION}\` by_ \`pnpm build:skills\`. _Edit upstream, not here._`,
  );
  refIndex.push('');
  if (fullRefs.length > 0) {
    refIndex.push('### Always load when this skill activates');
    refIndex.push('');
    for (const r of fullRefs) {
      refIndex.push(`- \`references/${r.id}.md\` — ${r.summary}`);
    }
    refIndex.push('');
  }
  if (linkOnlyRefs.length > 0) {
    refIndex.push('### Load on demand (only when the task touches this area)');
    refIndex.push('');
    for (const r of linkOnlyRefs) {
      refIndex.push(`- \`references/${r.id}.md\` — ${r.summary}`);
    }
    refIndex.push('');
  }

  const sections: string[] = [];
  sections.push(frontmatter(name, description));
  // Use the source's own H1 if frontMatter starts with one; otherwise add ours.
  const introHasH1 = /^#\s+\S/.test(intro);
  if (!introHasH1) {
    sections.push(`# ${cardName}`);
    sections.push('');
  }
  if (intro) {
    sections.push(intro);
    sections.push('');
  }
  sections.push(refIndex.join('\n'));
  if (outro) {
    sections.push(outro);
    sections.push('');
  }
  const content =
    sections
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n';
  await writeFormattedMarkdown(resolve(skillDir, 'SKILL.md'), content);
  console.log(
    `wrote plugin/skills/${name}/SKILL.md + ${related.length} references`,
  );
}

async function emitLeaf(sourceRoot: string, card: SkillCard): Promise<void> {
  const name = card.id;
  const skillDir = resolve(PLUGIN_DIR, 'skills', name);
  mkdirSync(skillDir, { recursive: true });

  const description = getSkillDescription(card);
  const body = getLeafBody(sourceRoot, name).trimEnd() + '\n';
  const content = `${frontmatter(name, description)}\n${body}`;
  await writeFormattedMarkdown(resolve(skillDir, 'SKILL.md'), content);
  console.log(`wrote plugin/skills/${name}/SKILL.md (single-file leaf)`);
}

/**
 * Decide which cards to emit as top-level plugin skills.
 *
 * - Every SkillSet aggregator is emitted (its children get bundled inside
 *   `references/` by `emitAggregator`).
 * - Every SkillPlusMarkdown leaf is emitted UNLESS it's already a child of
 *   some aggregator — those leaves are reachable via the aggregator's
 *   references and don't need a duplicate top-level skill.
 * - Cards with any other `kind` are recorded as `unsupported` so the caller
 *   can warn without exploding the build.
 */
export function computeEmissionPlan(
  cards: Map<string, SkillCard>,
): EmissionPlan {
  const aggregatorChildren = new Set<string>();
  for (const card of cards.values()) {
    if (card.kind !== 'SkillSet') continue;
    for (const r of getRelatedSkills(card)) aggregatorChildren.add(r.id);
  }

  const emit: SkillCard[] = [];
  const unsupported: SkillCard[] = [];
  for (const card of cards.values()) {
    if (card.kind === 'SkillSet') {
      emit.push(card);
    } else if (card.kind === 'SkillPlusMarkdown') {
      if (!aggregatorChildren.has(card.id)) emit.push(card);
    } else {
      unsupported.push(card);
    }
  }

  emit.sort((a, b) => a.id.localeCompare(b.id));
  unsupported.sort((a, b) => a.id.localeCompare(b.id));
  return { emit, aggregatorChildren, unsupported };
}

/**
 * Rewrite the auto-generated table block in `plugin/README.md` so it lists
 * every skill in the current emission plan. The block is fenced by HTML
 * marker comments — if they're missing, throw clearly rather than silently
 * un-wiring the auto-gen.
 */
export async function updatePluginReadme(plan: EmissionPlan): Promise<void> {
  const readme = readFileSync(PLUGIN_README_PATH, 'utf8');
  const beginIdx = readme.indexOf(README_BEGIN_MARKER);
  const endIdx = readme.indexOf(README_END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(
      `plugin/README.md is missing the auto-gen markers ` +
        `"${README_BEGIN_MARKER}" and "${README_END_MARKER}". ` +
        `Restore them around the boxel-skills table so build:skills can update it.`,
    );
  }

  const tagUrl = `https://github.com/cardstack/boxel-skills/tree/${BOXEL_SKILLS_VERSION}`;
  const lines: string[] = [];
  lines.push(README_BEGIN_MARKER);
  lines.push('');
  lines.push(
    `_Generated from [\`cardstack/boxel-skills@${BOXEL_SKILLS_VERSION}\`](${tagUrl}) by_ \`pnpm build:skills\`. _Edit upstream, not here._`,
  );
  lines.push('');
  lines.push('| Skill | Use it for |');
  lines.push('|---|---|');
  for (const card of plan.emit) {
    const desc = getSkillDescription(card).replace(/\s+/g, ' ').trim();
    lines.push(`| \`/boxel-cli:${card.id}\` | ${desc} |`);
  }
  lines.push('');
  lines.push(README_END_MARKER);

  const replacement = lines.join('\n');
  const before = readme.slice(0, beginIdx);
  const after = readme.slice(endIdx + README_END_MARKER.length);
  const next = `${before}${replacement}${after}`;
  await writeFormattedMarkdown(PLUGIN_README_PATH, next);
  console.log(
    `wrote plugin/README.md (boxel-skills table, ${plan.emit.length} rows)`,
  );
}

async function main(): Promise<void> {
  const sourceRoot = resolveSourceRoot();
  const cards = loadSkillCards(sourceRoot);
  const plan = computeEmissionPlan(cards);

  for (const card of plan.emit) {
    if (card.kind === 'SkillSet') {
      const related = getRelatedSkills(card);
      if (related.length === 0) {
        throw new Error(
          `Aggregator "${card.id}" has no related skills — JSON shape unexpected.`,
        );
      }
      await emitAggregator(sourceRoot, card, related);
    } else if (card.kind === 'SkillPlusMarkdown') {
      await emitLeaf(sourceRoot, card);
    }
  }

  await updatePluginReadme(plan);

  if (plan.unsupported.length > 0) {
    console.log('');
    console.log(
      'Skipped: cards with unsupported adoptsFrom.name (build keeps going):',
    );
    for (const c of plan.unsupported) {
      console.log(`  - ${c.id} (${c.kind})`);
    }
  }

  console.log('');
  console.log(
    `Done. Emitted ${plan.emit.length} skill(s) from boxel-skills@${BOXEL_SKILLS_VERSION}.`,
  );
}

// Run main only when invoked directly, not when imported from tests.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
