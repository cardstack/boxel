/**
 * Host-import manifest — v3 contract-drift gate.
 *
 * Root cause of two of the five wardrobe-run field failures: agents (and
 * the workspace skills they read) carried a stale memory of
 * `@cardstack/boxel-host/commands/...` after the host renamed the
 * directory to `tools/`. Every static gate passed — the import only
 * exploded at runtime in the operator's browser.
 *
 * The fix is to stop hand-maintaining the catalogue: derive it from the
 * host source that ships with this checkout (`packages/host/app/tools`),
 * inject it into the agent's context as a generated skill, and statically
 * fail any `@cardstack/boxel-host/tools|commands/...` import that isn't in
 * it — at validation time, in-process, before anything reaches a browser.
 */

import { readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import type { ResolvedSkill } from './factory-agent/types.ts';
import { logger } from './logger.ts';

const log = logger('host-import-manifest');

/** Default host tools source directory, relative to the factory package. */
export function defaultHostToolsDir(packageRoot: string): string {
  return resolve(packageRoot, '../host/app/tools');
}

/**
 * Derive the list of valid `@cardstack/boxel-host/tools/<name>` module
 * names from the host build's source tree. Recursive; nested entries
 * come back as `subdir/name`. Returns undefined when the directory is
 * unreadable (factory deployed without the host checkout) — callers
 * degrade to no gate rather than failing the run.
 */
export async function deriveHostToolImports(
  hostToolsDir: string,
): Promise<string[] | undefined> {
  try {
    let entries = await readdir(hostToolsDir, {
      recursive: true,
      withFileTypes: true,
    });
    let names: string[] = [];
    for (let entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      let abs = join(entry.parentPath, entry.name);
      let rel = relative(hostToolsDir, abs)
        .split(sep)
        .join('/')
        .replace(/\.ts$/, '');
      names.push(rel);
    }
    names.sort();
    log.info(`Derived host-tools manifest: ${names.length} modules`);
    return names;
  } catch (error) {
    log.warn(
      `Could not derive host-tools manifest from ${hostToolsDir}: ${String(error)} — import gate disabled`,
    );
    return undefined;
  }
}

/**
 * The generated skill injected into every agent context: the closed
 * catalogue of host-tool import paths. Kills the phantom-import failure
 * mode at the source — the model no longer has to remember whether it's
 * `commands/` or `tools/`, or guess module names.
 */
export function buildHostToolsSkill(names: string[]): ResolvedSkill {
  return {
    name: 'host-tools-import-manifest',
    content: [
      '# Host tool imports (generated from the host build — authoritative)',
      '',
      'Host commands are imported from `@cardstack/boxel-host/tools/<name>`.',
      'The `@cardstack/boxel-host/commands/...` path NO LONGER EXISTS — the',
      'directory was renamed to `tools/`. Any import not in the list below',
      'fails validation before your code reaches the realm.',
      '',
      'Valid module names:',
      '',
      ...names.map((n) => `- \`@cardstack/boxel-host/tools/${n}\``),
      '',
      'Each module default-exports the command class (e.g.',
      "`import GetCardTypeSchemaCommand from '@cardstack/boxel-host/tools/get-card-type-schema';`).",
    ].join('\n'),
  };
}

export interface HostImportViolation {
  /** The bad import specifier as written. */
  specifier: string;
  /** Actionable fix, when one can be inferred. */
  suggestion?: string;
}

const HOST_IMPORT_RE =
  /(?:from\s+|import\s*\(\s*)['"](@cardstack\/boxel-host\/[^'"]+)['"]/g;

/**
 * Scan one module source for `@cardstack/boxel-host` imports that don't
 * resolve against the manifest. Only the `tools/` (and legacy
 * `commands/`) namespaces are gated — other boxel-host subpaths pass
 * untouched, so the gate can't false-positive on surfaces it doesn't
 * catalogue.
 */
export function findHostImportViolations(
  source: string,
  manifest: ReadonlySet<string>,
): HostImportViolation[] {
  let violations: HostImportViolation[] = [];
  for (let match of source.matchAll(HOST_IMPORT_RE)) {
    let specifier = match[1];
    let subpath = specifier.slice('@cardstack/boxel-host/'.length);
    if (subpath.startsWith('commands/')) {
      let name = subpath.slice('commands/'.length);
      violations.push({
        specifier,
        suggestion: manifest.has(name)
          ? `the host renamed commands/ to tools/ — use '@cardstack/boxel-host/tools/${name}'`
          : `the commands/ directory no longer exists (renamed to tools/), and no tool named '${name}' exists either — check the host-tools-import-manifest skill for the valid list`,
      });
      continue;
    }
    if (subpath.startsWith('tools/')) {
      let name = subpath.slice('tools/'.length);
      if (!manifest.has(name)) {
        let near = closestManifestEntry(name, manifest);
        violations.push({
          specifier,
          suggestion: near
            ? `no such host tool — did you mean '@cardstack/boxel-host/tools/${near}'?`
            : `no such host tool — check the host-tools-import-manifest skill for the valid list`,
        });
      }
    }
  }
  return violations;
}

/** Cheap nearest-name lookup: prefix/substring containment both ways. */
function closestManifestEntry(
  name: string,
  manifest: ReadonlySet<string>,
): string | undefined {
  let lower = name.toLowerCase();
  let best: string | undefined;
  for (let entry of manifest) {
    let e = entry.toLowerCase();
    if (e === lower) return entry;
    if (e.includes(lower) || lower.includes(e)) {
      if (!best || entry.length < best.length) {
        best = entry;
      }
    }
  }
  return best;
}
