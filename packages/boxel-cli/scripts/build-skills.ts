/**
 * Generate plugin/skills/<skill>/SKILL.md (and references/) for the
 * boxel-skills-derived plugin skills. Run via `pnpm build:skills` from
 * `packages/boxel-cli/`.
 *
 * Source: cardstack/boxel-skills at a pinned tag (BOXEL_SKILLS_VERSION).
 * Override the source location with BOXEL_SKILLS_REPO=/path/to/checkout for
 * local development against an unreleased boxel-skills branch.
 *
 * CI runs this and `git diff --exit-code -- plugin/skills` to fail PRs whose
 * generated content drifted from the upstream pin (see
 * .github/workflows/ci-lint.yaml).
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
const CACHE_DIR = resolve(__dirname, '..', '.boxel-skills-cache');

/**
 * Skills from boxel-skills to emit as plugin skills. Anything outside this
 * list is reported as "available but not enabled" so we know what's there.
 */
const ALLOWLIST = ['boxel-development', 'boxel-design'];

/**
 * Per-skill overrides for the lean SKILL.md frontmatter `description`. The
 * source's cardInfo.summary is often too generic for Claude Code's
 * auto-activation; these descriptions are tuned for skill discovery.
 */
const DESCRIPTION_OVERRIDES: Record<string, string> = {
  'boxel-development':
    'Authoring Boxel cards. Use when creating or editing .gts card definitions, .json card instances, or answering questions about CardDef / FieldDef / templates / Boxel patterns. Covers the full .gts authoring surface — imports, fields, formats (isolated/embedded/fitted/atom/edit), styling, and common pitfalls.',
  'boxel-design':
    'Boxel UI design discovery. Use when designing or redesigning a Boxel app, choosing a visual direction, or pushing past default look-and-feel before generating code.',
};

interface SkillCard {
  id: string;
  json: any;
  /** Adopted card type, e.g. "SkillSet" or "SkillPlusMarkdown". */
  kind: string;
}

interface RelatedSkill {
  id: string;
  inclusionMode: 'full' | 'link-only';
  summary: string;
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

function getCardName(card: SkillCard): string {
  const a = card.json?.data?.attributes ?? {};
  return a?.cardInfo?.name ?? a?.cardTitle ?? card.id;
}

function getCardSummary(card: SkillCard): string {
  const a = card.json?.data?.attributes ?? {};
  return a?.cardInfo?.summary ?? a?.cardDescription ?? '';
}

function getRelatedSkills(card: SkillCard): RelatedSkill[] {
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
  const description =
    DESCRIPTION_OVERRIDES[name] ||
    getCardSummary(card) ||
    `${cardName} skill from boxel-skills.`;
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

  const cardName = getCardName(card);
  const description =
    DESCRIPTION_OVERRIDES[name] || getCardSummary(card) || cardName;
  const body = getLeafBody(sourceRoot, name).trimEnd() + '\n';
  const content = `${frontmatter(name, description)}\n${body}`;
  await writeFormattedMarkdown(resolve(skillDir, 'SKILL.md'), content);
  console.log(`wrote plugin/skills/${name}/SKILL.md (single-file leaf)`);
}

async function main(): Promise<void> {
  const sourceRoot = resolveSourceRoot();
  const cards = loadSkillCards(sourceRoot);

  const aggregatorChildren = new Set<string>();
  for (const id of ALLOWLIST) {
    const card = cards.get(id);
    if (card?.kind === 'SkillSet') {
      for (const r of getRelatedSkills(card)) aggregatorChildren.add(r.id);
    }
  }

  for (const id of ALLOWLIST) {
    const card = cards.get(id);
    if (!card) {
      throw new Error(
        `ALLOWLIST entry "${id}" not found in source. Available skill IDs: ` +
          [...cards.keys()].sort().join(', '),
      );
    }
    if (card.kind === 'SkillSet') {
      const related = getRelatedSkills(card);
      if (related.length === 0) {
        throw new Error(
          `Aggregator "${id}" has no related skills — JSON shape unexpected.`,
        );
      }
      await emitAggregator(sourceRoot, card, related);
    } else if (card.kind === 'SkillPlusMarkdown') {
      await emitLeaf(sourceRoot, card);
    } else {
      throw new Error(
        `ALLOWLIST entry "${id}" has unsupported adoptsFrom.name: "${card.kind}"`,
      );
    }
  }

  const enabled = new Set(ALLOWLIST);
  const skipped = [...cards.values()]
    .filter((c) => !enabled.has(c.id))
    .filter((c) => !aggregatorChildren.has(c.id));
  if (skipped.length > 0) {
    console.log('');
    console.log(
      'Available in boxel-skills but not enabled (add to ALLOWLIST to emit):',
    );
    for (const c of skipped.sort((a, b) => a.id.localeCompare(b.id))) {
      console.log(`  - ${c.id} (${c.kind})`);
    }
  }

  console.log('');
  console.log(
    `Done. Emitted ${ALLOWLIST.length} skill(s) from boxel-skills@${BOXEL_SKILLS_VERSION}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
