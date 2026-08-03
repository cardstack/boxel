/**
 * Expose a realm's `skills/` directory to Claude Code by mirroring it into the
 * surrounding checkout's `.claude/skills/`.
 *
 * A user authors a skill in their workspace as `skills/<name>/SKILL.md` (see
 * the `boxel-skill-authoring` skill). Claude Code discovers skills as
 * `.claude/skills/<dir>/SKILL.md` and takes the *directory* name as the
 * command name, so the same file serves both harnesses unchanged — it only has
 * to appear at a path Claude Code looks at. Every `realm pull` / `sync` /
 * `watch` reconciles that mirror, so a skill added to the realm shows up in
 * the next agentic session with no extra step.
 *
 * Each mirrored entry is a **symlink** into the realm checkout
 * (`.claude/skills/<realm>-<name>` → `<localDir>/skills/<name>`), which Claude
 * Code follows. That keeps the mirror live — `watch` updating the checkout
 * updates what the agent reads — and makes editing a skill through the link an
 * ordinary checkout edit that `realm push` sends back up through the existing
 * conflict machinery. Where the OS refuses symlinks the entry falls back to a
 * recursive copy, which is stale-until-next-run but still discoverable.
 *
 * Ownership is tracked in `.claude/skills/.boxel-skills-sync.json` so a later
 * run can delete entries whose realm-side skill was renamed or removed, and so
 * a hand-authored `.claude/skills/<dir>` this code never wrote is left alone.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DIM, FG_YELLOW, RESET } from './colors.ts';

const MANIFEST_NAME = '.boxel-skills-sync.json';
const MANIFEST_VERSION = 1;

export type MirrorEntryKind = 'symlink' | 'copy';

interface ManifestEntry {
  /** Realm-side skill directory name, i.e. `skills/<skill>/`. */
  skill: string;
  kind: MirrorEntryKind;
}

interface ManifestRealm {
  /** Realm checkout the entries point into, relative to the mirror root. */
  localDir: string;
  /** Mirror directory name (`<realm>-<skill>`) → what it was written from. */
  entries: Record<string, ManifestEntry>;
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
  /** Entries now present and owned by this realm. */
  linked: string[];
  /** Entries written as copies because the symlink could not be created. */
  copied: string[];
  /** Entries removed because their realm-side skill is gone. */
  removed: string[];
  /** Entries left untouched, with why. */
  skipped: SkillsMirrorSkipped[];
}

export interface MirrorRealmSkillsOptions {
  realmUrl: string;
  /** Realm checkout — the directory `realm pull` writes the realm into. */
  localDir: string;
  /** Report what would change without touching the filesystem. */
  dryRun?: boolean;
}

/** Env opt-out, for a checkout where the mirror is unwanted. */
export function isSkillsMirrorDisabled(): boolean {
  return process.env.BOXEL_NO_CLAUDE_SKILLS === '1';
}

/**
 * Locate the checkout the mirror belongs to, starting at the realm's local
 * directory and walking up: an existing `.claude/` wins, else the enclosing
 * git checkout, else the realm directory itself (where `.claude/` is created).
 *
 * The walk stops *below* the home directory. Realm checkouts commonly live
 * under `~`, and `~/.claude/skills` is Claude Code's personal scope — writing
 * there would leak one realm's skills into every unrelated project.
 */
export async function resolveMirrorRoot(localDir: string): Promise<string> {
  const start = path.resolve(localDir);
  const home = path.resolve(os.homedir());
  const candidates: string[] = [];
  let current = start;
  while (current !== home) {
    candidates.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const dir of candidates) {
    if (await isDirectory(path.join(dir, '.claude'))) return dir;
  }
  for (const dir of candidates) {
    if (await pathPresent(path.join(dir, '.git'))) return dir;
  }
  return start;
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
  const { realmUrl, dryRun } = options;
  const localDir = path.resolve(options.localDir);
  const realmSlug = realmSlugFromUrl(realmUrl);
  if (realmSlug === null) return null;

  const root = await resolveMirrorRoot(localDir);
  const mirrorDir = path.join(root, '.claude', 'skills');
  const manifest = await loadMirrorManifest(mirrorDir);
  const priorEntries = manifest.realms[realmUrl]?.entries ?? {};

  const skills = await listRealmSkills(localDir);

  // Nothing to mirror and nothing previously mirrored — leave the checkout
  // exactly as it was, including creating no `.claude/` directory.
  if (skills.length === 0 && Object.keys(priorEntries).length === 0) {
    return null;
  }

  const result: SkillsMirrorResult = {
    root,
    linked: [],
    copied: [],
    removed: [],
    skipped: [],
  };
  const nextEntries: Record<string, ManifestEntry> = {};

  if (!dryRun && skills.length > 0) {
    await fs.mkdir(mirrorDir, { recursive: true });
  }

  for (const skill of skills) {
    const name = mirrorDirName(realmSlug, skill);
    const target = path.join(mirrorDir, name);
    const source = path.join(localDir, 'skills', skill);

    const claim = await claimEntry({
      mirrorDir,
      name,
      source,
      realmUrl,
      manifest,
      priorEntries,
    });
    if (!claim.ok) {
      result.skipped.push({ name, reason: claim.reason });
      // Keep the prior record so a later run that frees the path can still
      // sweep what this code wrote before.
      const prior = priorEntries[name];
      if (prior) nextEntries[name] = prior;
      continue;
    }

    if (dryRun) {
      result.linked.push(name);
      nextEntries[name] = { skill, kind: claim.existingKind ?? 'symlink' };
      continue;
    }

    const written = await writeEntry(target, source, claim.replace);
    if (written === null) {
      result.skipped.push({
        name,
        reason: 'could not be written as a symlink or a copy',
      });
      continue;
    }
    if (written === 'copy') result.copied.push(name);
    result.linked.push(name);
    nextEntries[name] = { skill, kind: written };
  }

  for (const name of Object.keys(priorEntries)) {
    if (nextEntries[name] !== undefined) continue;
    if (!dryRun) {
      await removeEntry(path.join(mirrorDir, name));
    }
    result.removed.push(name);
  }

  if (!dryRun) {
    if (Object.keys(nextEntries).length === 0) {
      delete manifest.realms[realmUrl];
    } else {
      manifest.realms[realmUrl] = {
        localDir: toPosix(path.relative(root, localDir)),
        entries: nextEntries,
      };
    }
    await saveMirrorManifest(mirrorDir, manifest);
  }

  result.removed.sort();
  result.linked.sort();
  result.copied.sort();
  return result;
}

/**
 * Call-site wrapper for `pull` / `sync` / `watch`: honour the opt-out, run the
 * reconcile, report it, and swallow anything that goes wrong. The transfer that
 * precedes it has already succeeded by this point, so a mirror problem is worth
 * a warning and nothing more — it must never turn a good sync into a failure.
 */
export async function reconcileSkillsMirror(
  options: MirrorRealmSkillsOptions & { enabled?: boolean },
): Promise<SkillsMirrorResult | null> {
  if (options.enabled === false || isSkillsMirrorDisabled()) return null;

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

  const prefix = options.dryRun ? '[DRY RUN] Would ' : '';
  const mirrorDir = path.join(result.root, '.claude', 'skills');
  if (result.linked.length > 0) {
    console.log(
      `\n${prefix}${options.dryRun ? 'expose' : 'Exposed'} ${result.linked.length} realm skill(s) to Claude Code in ${mirrorDir}:`,
    );
    for (const name of result.linked) {
      const how = result.copied.includes(name) ? ' (copied)' : '';
      console.log(`  ${DIM}/${name}${RESET}${how}`);
    }
  }
  for (const name of result.removed) {
    console.log(
      `${prefix}${options.dryRun ? 'remove' : 'Removed'} stale skill: ${name}`,
    );
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
    // body links to, not skills; only a directory holding SKILL.md qualifies.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!(await isDirectory(path.join(skillsDir, entry.name)))) continue;
    if (!(await pathPresent(path.join(skillsDir, entry.name, 'SKILL.md')))) {
      continue;
    }
    found.push(entry.name);
  }
  return found.sort();
}

/**
 * Decide whether this realm may write `<mirrorDir>/<name>`. An entry the
 * manifest attributes to this realm is ours to refresh; an entry attributed to
 * a different realm, or present on disk without any manifest record, belongs
 * to someone else and is left alone.
 */
async function claimEntry(args: {
  mirrorDir: string;
  name: string;
  source: string;
  realmUrl: string;
  manifest: SkillsMirrorManifest;
  priorEntries: Record<string, ManifestEntry>;
}): Promise<
  | { ok: true; replace: boolean; existingKind?: MirrorEntryKind }
  | { ok: false; reason: string }
> {
  const { mirrorDir, name, realmUrl, manifest, priorEntries } = args;
  const target = path.join(mirrorDir, name);
  const owned = priorEntries[name];

  for (const [otherRealm, realm] of Object.entries(manifest.realms)) {
    if (otherRealm === realmUrl) continue;
    if (realm.entries[name] !== undefined) {
      return {
        ok: false,
        reason: `already mirrored from ${otherRealm}`,
      };
    }
  }

  if (!(await pathPresent(target))) {
    return { ok: true, replace: false };
  }
  if (owned) {
    return { ok: true, replace: true, existingKind: owned.kind };
  }
  return {
    ok: false,
    reason:
      'a directory of that name already exists and was not written by boxel',
  };
}

/**
 * Write one mirror entry, preferring a symlink. Returns the kind written, or
 * null when neither a symlink nor a copy could be created.
 */
async function writeEntry(
  target: string,
  source: string,
  replace: boolean,
): Promise<MirrorEntryKind | null> {
  if (replace) {
    await removeEntry(target);
  }

  // Relative so the mirror survives the whole tree being moved or mounted at
  // a different path (a factory workspace in a container, for instance).
  const linkTarget = path.relative(path.dirname(target), source);
  try {
    await fs.symlink(linkTarget, target, 'dir');
    return 'symlink';
  } catch {
    // Windows without developer mode, a filesystem without symlink support, a
    // container mount that forbids them — fall back to a copy.
  }

  try {
    await fs.cp(source, target, { recursive: true, dereference: true });
    return 'copy';
  } catch {
    return null;
  }
}

async function removeEntry(target: string): Promise<void> {
  // A symlinked entry must be unlinked rather than recursed into: `rm -r` on
  // the link path would delete the realm checkout's skill through it.
  try {
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink() || stats.isFile()) {
      await fs.unlink(target);
      return;
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  await fs.rm(target, { recursive: true, force: true });
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
    if (typeof r.localDir !== 'string') return false;
    if (typeof r.entries !== 'object' || r.entries === null) return false;
    for (const entry of Object.values(r.entries as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) return false;
      const e = entry as Record<string, unknown>;
      if (typeof e.skill !== 'string') return false;
      if (e.kind !== 'symlink' && e.kind !== 'copy') return false;
    }
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

/** Present on disk, following no symlink — a broken link still counts. */
async function pathPresent(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
