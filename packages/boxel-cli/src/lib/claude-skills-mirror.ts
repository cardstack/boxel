/**
 * Expose a realm's `skills/` directory to Claude Code by mirroring it into the
 * realm's own local directory as `.claude/skills/`.
 *
 * A user authors a skill in their workspace as `skills/<name>/SKILL.md` (see
 * the `boxel-skill-authoring` skill). Claude Code discovers skills as
 * `.claude/skills/<dir>/SKILL.md` and takes the *directory* name as the
 * command name, so the same file serves both harnesses unchanged — it only has
 * to appear at a path Claude Code looks at. Every `realm pull` / `sync` /
 * `watch` reconciles that mirror, so a skill added to the realm shows up in
 * the next agentic session with no extra step.
 *
 * Entries are plain recursive copies, rewritten on every run. They are
 * generated output: the realm checkout is where a skill is edited, and
 * `push` / `sync` carry a checkout edit back to the realm the same way they
 * carry any other file. An edit made to a copy instead is overwritten without
 * warning on the next run.
 *
 * `.claude/skills/.boxel-skills-sync.json` records, per realm, which entry
 * names this code wrote. That is what makes the sweep safe: an entry whose
 * realm-side skill was renamed or removed is deleted, and a
 * `.claude/skills/<dir>` this code never wrote is left alone rather than
 * claimed by the `<realm>-` prefix.
 */
import * as fs from 'fs/promises';
import { realpathSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DIM, FG_YELLOW, RESET } from './colors.ts';

const MANIFEST_NAME = '.boxel-skills-sync.json';
const MANIFEST_VERSION = 1;

interface ManifestRealm {
  /** Mirror directory names (`<realm>-<skill>`) this code wrote. */
  entries: string[];
}

export interface SkillsMirrorManifest {
  version: number;
  realms: Record<string, ManifestRealm>;
}

export interface SkillsMirrorSkipped {
  name: string;
  reason: string;
}

export interface SkillsMirrorResult {
  /** Directory holding the `.claude/` the mirror was written into. */
  root: string;
  /** Entries written from the realm's `skills/`. */
  written: string[];
  /** Entries removed because their realm-side skill is gone. */
  removed: string[];
  /** Entries left untouched, with why. */
  skipped: SkillsMirrorSkipped[];
}

export interface MirrorRealmSkillsOptions {
  realmUrl: string;
  /** Realm checkout — the directory `realm pull` writes the realm into. */
  localDir: string;
}

/**
 * Env opt-out, for a checkout where the mirror is unwanted. `1` and `true` are
 * both accepted (case-insensitively): the repo spells this kind of flag both
 * ways — `BOXEL_DISABLE_PATH_WARNING === '1'` next to
 * `REALM_REGISTRY_SKIP_ORPHAN_CHECK === 'true'` — and an opt-out that silently
 * ignores the other spelling is a bad way to find that out.
 */
export function isSkillsMirrorDisabled(): boolean {
  const value = process.env.BOXEL_DISABLE_CLAUDE_SKILLS_SYNC?.toLowerCase();
  return value === '1' || value === 'true';
}

/**
 * The mirror lives in the realm's own local directory — `<localDir>/.claude/`,
 * created if absent. Nothing is searched for up the tree: a realm's skills
 * belong to the checkout it was pulled into, and Claude Code loads nested
 * `.claude/skills/` directories below the working directory (qualifying the
 * command name by directory when two skills share a name), so a realm several
 * levels down still surfaces its skills.
 *
 * Null for the home directory itself, where `.claude/skills` is Claude Code's
 * personal scope — one realm's skills must not be pushed into every unrelated
 * project. Symlinks are followed before that comparison, so a checkout that
 * merely points at the home directory is recognised as the personal scope
 * rather than writing through the link into it.
 */
export function resolveMirrorRoot(localDir: string): string | null {
  const resolved = path.resolve(localDir);
  if (realOrLexicalPath(resolved) === realOrLexicalPath(os.homedir())) {
    return null;
  }
  return resolved;
}

/**
 * Symlink-resolved form of an absolute path, falling back to the path itself
 * when it cannot be resolved — a directory that does not exist yet is not the
 * home directory, so the lexical form answers the only question asked here.
 */
function realOrLexicalPath(absolutePath: string): string {
  try {
    return realpathSync.native(absolutePath);
  } catch {
    return absolutePath;
  }
}

/**
 * Slug identifying the realm in mirrored directory names. The realm segment of
 * the URL (`…/matic/experiments/` → `experiments`, `…/skills/` → `skills`),
 * lowercased and reduced to a safe path segment. Returns null for a URL with
 * no usable path segment, which disables mirroring rather than inventing a
 * name that could collide with an unrelated realm.
 */
export function realmSlugFromUrl(realmUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(realmUrl);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }
  const slug = decoded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

/** Mirror directory name for a realm-side skill. */
export function mirrorDirName(realmSlug: string, skillName: string): string {
  return `${realmSlug}-${skillName}`;
}

/**
 * Reconcile `<root>/.claude/skills/` against `<localDir>/skills/`. Never
 * throws for filesystem reasons a caller can't act on — the mirror is a
 * convenience layered on top of a transfer that has already succeeded, so
 * per-entry problems are reported through `skipped` and callers log them.
 */
export async function mirrorRealmSkills(
  options: MirrorRealmSkillsOptions,
): Promise<SkillsMirrorResult | null> {
  const { realmUrl } = options;
  const localDir = path.resolve(options.localDir);
  const realmSlug = realmSlugFromUrl(realmUrl);
  if (realmSlug === null) return null;

  const root = resolveMirrorRoot(localDir);
  if (root === null) {
    console.warn(
      `${FG_YELLOW}Warning:${RESET} not mirroring skills into ${path.join(localDir, '.claude', 'skills')} — that is Claude Code's personal skills scope, shared by every project. Pull the realm into a subdirectory instead.`,
    );
    return null;
  }
  const mirrorDir = path.join(root, '.claude', 'skills');
  const manifest = await loadMirrorManifest(mirrorDir);
  const priorEntries = manifest.realms[realmUrl]?.entries ?? [];

  const skills = await listRealmSkills(localDir);

  // Nothing to mirror and nothing previously mirrored — leave the checkout
  // exactly as it was, including creating no `.claude/` directory.
  if (skills.length === 0 && priorEntries.length === 0) {
    return null;
  }

  const result: SkillsMirrorResult = {
    root,
    written: [],
    removed: [],
    skipped: [],
  };
  const nextEntries = new Set<string>();

  for (const skill of skills) {
    const name = mirrorDirName(realmSlug, skill);
    const target = path.join(mirrorDir, name);
    const source = path.join(localDir, 'skills', skill);
    const owned = priorEntries.includes(name);

    const conflict = await findConflict({
      mirrorDir,
      name,
      realmUrl,
      manifest,
      owned,
    });
    if (conflict !== null) {
      result.skipped.push({ name, reason: conflict });
      // Keep the prior record so a later run that frees the path can still
      // rewrite or sweep what this code wrote before.
      if (owned) nextEntries.add(name);
      continue;
    }

    await fs.mkdir(mirrorDir, { recursive: true });
    // Replace rather than merge, so a file dropped from the realm's skill
    // (a retired reference) doesn't linger in the copy.
    await fs.rm(target, { recursive: true, force: true });
    try {
      await fs.cp(source, target, { recursive: true, dereference: true });
    } catch (error) {
      result.skipped.push({
        name,
        reason: `could not be copied: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }
    result.written.push(name);
    nextEntries.add(name);
  }

  for (const name of priorEntries) {
    if (nextEntries.has(name)) continue;
    await fs.rm(path.join(mirrorDir, name), { recursive: true, force: true });
    result.removed.push(name);
  }

  if (nextEntries.size === 0) {
    delete manifest.realms[realmUrl];
  } else {
    manifest.realms[realmUrl] = { entries: [...nextEntries].sort() };
  }
  await saveMirrorManifest(mirrorDir, manifest);

  result.written.sort();
  result.removed.sort();
  return result;
}

/**
 * Call-site wrapper for `pull` / `sync` / `watch`: honour the opt-out, run the
 * reconcile, report it, and swallow anything that goes wrong. The transfer that
 * precedes it has already succeeded by this point, so a mirror problem is worth
 * a warning and nothing more — it must never turn a good sync into a failure.
 *
 * A dry run neither writes nor previews. The mirror is derived from the
 * `skills/` tree the transfer leaves behind, and a dry run transfers nothing, so
 * anything read off the untouched checkout would be wrong in both directions:
 * silent about a skill the real run would expose, and naming one the realm has
 * since dropped. So it says only what it can stand behind — that the mirror is
 * settled by the real run.
 */
export async function reconcileSkillsMirror(
  options: MirrorRealmSkillsOptions & { enabled?: boolean; dryRun?: boolean },
): Promise<SkillsMirrorResult | null> {
  if (options.enabled === false || isSkillsMirrorDisabled()) return null;

  if (options.dryRun) {
    console.log(
      `${DIM}[DRY RUN] .claude/skills is reconciled by the real run, from the files it transfers${RESET}`,
    );
    return null;
  }

  let result: SkillsMirrorResult | null;
  try {
    result = await mirrorRealmSkills(options);
  } catch (error) {
    console.warn(
      `${FG_YELLOW}Warning:${RESET} could not mirror realm skills into .claude/skills:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }

  if (result === null) return null;

  const mirrorDir = path.join(result.root, '.claude', 'skills');

  if (result.written.length > 0) {
    console.log(
      `\nExposed ${result.written.length} realm skill(s) to Claude Code in ${mirrorDir}:`,
    );
    for (const name of result.written) {
      console.log(`  ${DIM}/${name}${RESET}`);
    }
  }
  for (const name of result.removed) {
    console.log(`Removed stale skill: ${name}`);
  }
  for (const { name, reason } of result.skipped) {
    console.warn(
      `${FG_YELLOW}Warning:${RESET} skipped skill ${name} — ${reason}`,
    );
  }

  return result;
}

/** Realm-side skill directory names — `skills/<name>/SKILL.md`, sorted. */
async function listRealmSkills(localDir: string): Promise<string[]> {
  const skillsDir = path.join(localDir, 'skills');
  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    throw err;
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    // `skills/glossary.md`-style loose files are reference material a skill
    // body points at, not skills; only a directory holding SKILL.md qualifies.
    if (!(await isDirectory(path.join(skillsDir, entry.name)))) continue;
    if (!(await pathPresent(path.join(skillsDir, entry.name, 'SKILL.md')))) {
      continue;
    }
    found.push(entry.name);
  }
  return found.sort();
}

/**
 * Why this realm may not write `<mirrorDir>/<name>`, or null when it may. An
 * entry the manifest attributes to this realm is ours to rewrite; an entry
 * attributed to a different realm, or present on disk without any manifest
 * record, belongs to someone else.
 */
async function findConflict(args: {
  mirrorDir: string;
  name: string;
  realmUrl: string;
  manifest: SkillsMirrorManifest;
  owned: boolean;
}): Promise<string | null> {
  const { mirrorDir, name, realmUrl, manifest, owned } = args;

  for (const [otherRealm, realm] of Object.entries(manifest.realms)) {
    if (otherRealm === realmUrl) continue;
    if (realm.entries.includes(name)) {
      return `already mirrored from ${otherRealm}`;
    }
  }

  if (owned) return null;
  if (await pathPresent(path.join(mirrorDir, name))) {
    return 'a directory of that name already exists and was not written by boxel';
  }
  return null;
}

export async function loadMirrorManifest(
  mirrorDir: string,
): Promise<SkillsMirrorManifest> {
  const empty: SkillsMirrorManifest = {
    version: MANIFEST_VERSION,
    realms: {},
  };
  let raw: string;
  try {
    raw = await fs.readFile(path.join(mirrorDir, MANIFEST_NAME), 'utf8');
  } catch {
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!isMirrorManifest(parsed)) return empty;
  return parsed;
}

async function saveMirrorManifest(
  mirrorDir: string,
  manifest: SkillsMirrorManifest,
): Promise<void> {
  const manifestPath = path.join(mirrorDir, MANIFEST_NAME);
  if (Object.keys(manifest.realms).length === 0) {
    try {
      await fs.unlink(manifestPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
    return;
  }
  await fs.mkdir(mirrorDir, { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

function isMirrorManifest(value: unknown): value is SkillsMirrorManifest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== MANIFEST_VERSION) return false;
  if (typeof v.realms !== 'object' || v.realms === null) return false;
  for (const realm of Object.values(v.realms as Record<string, unknown>)) {
    if (typeof realm !== 'object' || realm === null) return false;
    const r = realm as Record<string, unknown>;
    if (!Array.isArray(r.entries)) return false;
    if (!r.entries.every((entry) => typeof entry === 'string')) return false;
  }
  return true;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Present on disk — `lstat`, so an unreadable target still counts as taken. */
async function pathPresent(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}
