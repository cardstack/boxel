/**
 * Copy `skills/` and `commands/` from the pinned boxel-skills tag into
 * `plugin/`. Run via `pnpm build:skills` from `packages/boxel-cli/`.
 *
 * Source: cardstack/boxel-skills at a pinned tag (BOXEL_SKILLS_VERSION).
 * Override the source location with BOXEL_SKILLS_REPO=/path/to/checkout for
 * local development against an unreleased boxel-skills branch.
 *
 * boxel-skills is markdown-first: `skills/<name>/SKILL.md` (+ `references/`,
 * `scripts/`) directories and `commands/<name>.md` slash-command files are
 * already in the shape Claude Code consumes, so this build is a verbatim
 * copy — no transformation, no formatting, no curation. Frontmatter is read
 * only to regenerate the plugin README's catalog tables.
 *
 * Stale-entry sweep: each run persists the copied entry names to
 * `scripts/.boxel-skills-manifest.json` and, on the next run, deletes any
 * `plugin/skills/<name>` or `plugin/commands/<name>` that was in the prior
 * manifest but is no longer in the source — keeping the plugin from shipping
 * content that has been removed or renamed upstream. Entries this script
 * never wrote (the CLI-authored skills like `file-ops` and `realm-sync`) are
 * never in the manifest, so the sweep cannot touch them.
 *
 * The on-`main` workflow `.github/workflows/boxel-cli-publish.yml` runs this
 * and commits the regenerated `plugin/` diff back to main.
 */
import { execSync } from 'child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { relative, resolve } from 'path';
import { format, resolveConfig } from 'prettier';

const BOXEL_SKILLS_VERSION = 'v0.0.29';
const BOXEL_SKILLS_REPO_URL = 'https://github.com/cardstack/boxel-skills.git';

const PLUGIN_DIR = resolve(import.meta.dirname, '..', 'plugin');
const PLUGIN_README_PATH = resolve(PLUGIN_DIR, 'README.md');
const CACHE_DIR = resolve(import.meta.dirname, '..', '.boxel-skills-cache');
const MANIFEST_PATH = resolve(
  import.meta.dirname,
  '.boxel-skills-manifest.json',
);

const README_BEGIN_MARKER =
  '<!-- BEGIN AUTO-GENERATED: boxel-skills (run `pnpm build:skills` to update) -->';
const README_END_MARKER = '<!-- END AUTO-GENERATED: boxel-skills -->';

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
  if (existsSync(resolve(target, 'skills'))) {
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

/**
 * Top-level entries of a source directory, sorted. Includes plain files
 * (e.g. `skills/glossary.md`, which skill bodies link to relatively)
 * alongside `<name>/SKILL.md` directories.
 */
function listEntries(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Source missing expected directory: ${dir}`);
  }
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .sort();
}

/**
 * Minimal single-line YAML frontmatter reader — just enough to pull `name:`
 * and `description:` for the README tables. boxel-skills authors these as
 * single-line scalars; anything fancier falls back to the entry's file name
 * rather than mis-parsing. Deliberately not a YAML parser: the copied files
 * are the contract, the table is a convenience.
 */
export function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  if (!content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end === -1) return {};
  const block = content.slice(4, end);
  const out: { name?: string; description?: string } = {};
  for (const line of block.split('\n')) {
    const m = /^(name|description):\s*(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1] as 'name' | 'description';
    if (out[key] !== undefined) continue;
    out[key] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * Persisted record of which `plugin/skills/<name>` and
 * `plugin/commands/<name>` entries the last `pnpm build:skills` run copied.
 * Used to detect and delete entries that drop out of the source (upstream
 * removal or rename) so the plugin never ships stale content. `commands` is
 * optional for backward compatibility with manifests written before the
 * copy-only model shipped command files.
 */
export interface Manifest {
  version: string;
  skills: string[];
  commands?: string[];
}

export function loadManifest(path: string): Manifest | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const m = data as Manifest;
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof m.version !== 'string' ||
    !Array.isArray(m.skills) ||
    !m.skills.every((s) => typeof s === 'string') ||
    (m.commands !== undefined &&
      (!Array.isArray(m.commands) ||
        !m.commands.every((s) => typeof s === 'string')))
  ) {
    return null;
  }
  return m;
}

/**
 * Pure function: given the prior manifest's entry names and the new copy
 * plan's names, return the entries whose plugin copy should be deleted.
 * Stable-sorted so log output is deterministic.
 */
export function computeStaleIds(
  priorIds: readonly string[] | null | undefined,
  newIds: readonly string[],
): string[] {
  if (!priorIds) return [];
  const next = new Set(newIds);
  return priorIds.filter((id) => !next.has(id)).sort();
}

function sweepStaleEntries(subdir: string, staleIds: readonly string[]): void {
  for (const id of staleIds) {
    const target = resolve(PLUGIN_DIR, subdir, id);
    if (!existsSync(target)) continue;
    rmSync(target, { recursive: true, force: true });
    console.log(`removed stale plugin/${subdir}/${id}`);
  }
}

/**
 * Copy each top-level entry of `<sourceRoot>/<subdir>` into
 * `plugin/<subdir>/` verbatim. An existing destination entry is removed
 * first so files deleted upstream inside a skill (e.g. a dropped reference)
 * don't linger in the copy.
 */
function copyEntries(
  sourceRoot: string,
  subdir: string,
  entries: readonly string[],
): void {
  const destDir = resolve(PLUGIN_DIR, subdir);
  mkdirSync(destDir, { recursive: true });
  for (const name of entries) {
    const src = resolve(sourceRoot, subdir, name);
    const dest = resolve(destDir, name);
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
  }
  console.log(`copied ${entries.length} ${subdir}/ entries into plugin/`);
}

/**
 * Write `content` to `filePath` after running it through the repo's Prettier
 * config. Copied skill/command files ship verbatim; this applies only to the
 * README this script itself generates, so local format passes don't drift it
 * from the committed copy.
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

function tableRow(name: string, description: string): string {
  const desc = description.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return `| \`${name}\` | ${desc} |`;
}

/**
 * Build the marker-fenced auto-gen block for `plugin/README.md`: a skill
 * table and a command table, each keyed by the `/boxel-cli:<name>` slash
 * invocation (skills by directory name, commands by file basename) with the
 * description read from each entry's frontmatter. Pure over the filesystem
 * `sourceRoot` so it can be unit-tested without touching the real plugin dir.
 */
export function renderCatalogBlock(
  sourceRoot: string,
  skillEntries: readonly string[],
  commandEntries: readonly string[],
): string {
  const tagUrl = `https://github.com/cardstack/boxel-skills/tree/${BOXEL_SKILLS_VERSION}`;
  const lines: string[] = [];
  lines.push(README_BEGIN_MARKER);
  lines.push('');
  lines.push(
    `_Copied from [\`cardstack/boxel-skills@${BOXEL_SKILLS_VERSION}\`](${tagUrl}) by_ \`pnpm build:skills\`. _Edit upstream, not here._`,
  );
  lines.push('');
  lines.push('| Skill | Use it for |');
  lines.push('|---|---|');
  for (const entry of skillEntries) {
    const skillMd = resolve(sourceRoot, 'skills', entry, 'SKILL.md');
    if (!existsSync(skillMd)) continue; // plain files like glossary.md
    const fm = parseFrontmatter(readFileSync(skillMd, 'utf8'));
    lines.push(tableRow(`/boxel-cli:${entry}`, fm.description ?? ''));
  }
  lines.push('');
  lines.push('| Command | Use it for |');
  lines.push('|---|---|');
  for (const entry of commandEntries) {
    const fm = parseFrontmatter(
      readFileSync(resolve(sourceRoot, 'commands', entry), 'utf8'),
    );
    const name = entry.replace(/\.md$/, '');
    lines.push(tableRow(`/boxel-cli:${name}`, fm.description ?? ''));
  }
  lines.push('');
  lines.push(README_END_MARKER);
  return lines.join('\n');
}

/**
 * Rewrite the auto-generated block in `plugin/README.md` so it lists every
 * copied skill and command with the name/description from its frontmatter.
 * The block is fenced by HTML marker comments — if they're missing, throw
 * clearly rather than silently un-wiring the auto-gen.
 */
export async function updatePluginReadme(
  sourceRoot: string,
  skillEntries: readonly string[],
  commandEntries: readonly string[],
): Promise<void> {
  const readme = readFileSync(PLUGIN_README_PATH, 'utf8');
  const beginIdx = readme.indexOf(README_BEGIN_MARKER);
  const endIdx = readme.indexOf(README_END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(
      `plugin/README.md is missing the auto-gen markers ` +
        `"${README_BEGIN_MARKER}" and "${README_END_MARKER}". ` +
        `Restore them around the boxel-skills tables so build:skills can update them.`,
    );
  }

  const replacement = renderCatalogBlock(
    sourceRoot,
    skillEntries,
    commandEntries,
  );
  const before = readme.slice(0, beginIdx);
  const after = readme.slice(endIdx + README_END_MARKER.length);
  const next = `${before}${replacement}${after}`;
  await writeFormattedMarkdown(PLUGIN_README_PATH, next);
  console.log(
    `wrote plugin/README.md (${skillEntries.length} skills, ${commandEntries.length} commands)`,
  );
}

function writeManifest(
  skillEntries: readonly string[],
  commandEntries: readonly string[],
): void {
  const manifest: Manifest = {
    version: BOXEL_SKILLS_VERSION,
    skills: [...skillEntries].sort(),
    commands: [...commandEntries].sort(),
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `wrote ${relative(resolve(import.meta.dirname, '..'), MANIFEST_PATH)} (${manifest.skills.length} skills, ${manifest.commands!.length} commands)`,
  );
}

async function main(): Promise<void> {
  const sourceRoot = resolveSourceRoot();
  const skillEntries = listEntries(resolve(sourceRoot, 'skills'));
  const commandEntries = listEntries(resolve(sourceRoot, 'commands'));

  const priorManifest = loadManifest(MANIFEST_PATH);
  sweepStaleEntries(
    'skills',
    computeStaleIds(priorManifest?.skills, skillEntries),
  );
  sweepStaleEntries(
    'commands',
    computeStaleIds(priorManifest?.commands, commandEntries),
  );

  copyEntries(sourceRoot, 'skills', skillEntries);
  copyEntries(sourceRoot, 'commands', commandEntries);

  await updatePluginReadme(sourceRoot, skillEntries, commandEntries);
  writeManifest(skillEntries, commandEntries);

  console.log('');
  console.log(
    `Done. Copied ${skillEntries.length} skill(s) and ${commandEntries.length} command(s) from boxel-skills@${BOXEL_SKILLS_VERSION}.`,
  );
}

// Run main only when invoked directly, not when imported from tests.
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
