/**
 * Host-import manifest — contract-drift gate.
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

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ResolvedSkill } from './factory-agent/types.ts';
import { logger } from './logger.ts';

const log = logger('host-import-manifest');

/**
 * Default host tools shim registry, relative to the factory package.
 * The REGISTRY — not the file tree — is the authoritative contract: a
 * module resolves at runtime only under the name `shimHostTools`
 * registers it with, which is flat even for files in subdirectories
 * (`bot-requests/create-listing-pr-request.ts` registers as
 * `create-listing-pr-request`).
 */
export function defaultHostToolsRegistry(packageRoot: string): string {
  return resolve(packageRoot, '../host/app/tools/index.ts');
}

const SHIM_REGISTRATION_RE =
  /shimHostToolModule\(\s*virtualNetwork,\s*'([^']+)'/g;

/**
 * Derive the list of valid `@cardstack/boxel-host/tools/<name>` module
 * names from the host's shim registry source. Returns undefined when
 * the registry is unreadable (factory deployed without the host
 * checkout) — callers degrade to no gate rather than failing the run.
 */
export async function deriveHostToolImports(
  hostToolsRegistryPath: string,
): Promise<string[] | undefined> {
  try {
    let source = await readFile(hostToolsRegistryPath, 'utf8');
    let names = [...source.matchAll(SHIM_REGISTRATION_RE)].map((m) => m[1]);
    if (names.length === 0) {
      log.warn(
        `No shim registrations found in ${hostToolsRegistryPath} — import gate disabled`,
      );
      return undefined;
    }
    names.sort();
    log.info(`Derived host-tools manifest: ${names.length} modules`);
    return names;
  } catch (error) {
    log.warn(
      `Could not derive host-tools manifest from ${hostToolsRegistryPath}: ${String(error)} — import gate disabled`,
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
      'Always write `tools/` — the older `@cardstack/boxel-host/commands/<name>`',
      'spelling still resolves as a legacy alias, but `tools/` is canonical.',
      'Any import whose NAME is not in the list below fails validation',
      'before your code reaches the realm.',
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
      // The host's shim registry deliberately keeps `commands/<name>` as
      // a legacy alias for every registered tool, so a known name here
      // resolves at runtime and is NOT a violation — the injected skill
      // steers new code toward the canonical `tools/` spelling instead.
      let name = subpath.slice('commands/'.length);
      if (!manifest.has(name)) {
        let near = closestManifestEntry(name, manifest);
        violations.push({
          specifier,
          suggestion: near
            ? `no host tool named '${name}' — did you mean '@cardstack/boxel-host/tools/${near}'?`
            : `no host tool named '${name}' — check the host-tools-import-manifest skill for the valid list`,
        });
      }
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
