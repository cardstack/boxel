/**
 * migrate-index-to-workspace — switch realm index cards from the legacy
 * default index (`CardsGrid`, or its `IndexCard` alias) to `Workspace`.
 *
 * A realm's index card is the `index.json` at its root. `Workspace` bundles the
 * whole CardsGrid experience under its Library tab, so a realm that never
 * customized its index can move across without losing anything. A realm that
 * adopts something bespoke is left alone unless it is named with `--include`.
 *
 * Only `data.meta.adoptsFrom` is rewritten. Attributes and relationships are
 * carried over untouched, and anything a file carries beyond `adoptsFrom` is
 * called out in the report so it can be eyeballed before the run is applied.
 * The module form each realm already uses is preserved — `@cardstack/base/…`
 * stays a prefix, an absolute base-realm URL stays absolute — because the
 * publish handler and the prerender fast path recognize both
 * (`DEFAULT_REALM_INDEX_ADOPTIONS` in `handlers/handle-publish-realm.ts`).
 *
 * Every applied run writes a rollback manifest holding each file's original
 * bytes; `--rollback <manifest>` restores them. The manifest is plain JSON
 * read and written by node, so a rollback needs nothing installed in the
 * container beyond the runtime that produced it.
 *
 * Migrated realms need a reindex — the deployed server does not watch EFS, so
 * an on-disk edit is invisible to the index until one is triggered. The report
 * ends with the realm paths to feed `/_grafana-reindex?realm=<path>`.
 *
 * Usage:
 *   node scripts/migrate-index-to-workspace.ts [flags] <realm-dir> [<realm-dir> …]
 *   node scripts/migrate-index-to-workspace.ts [flags] --persistent <root>
 *   node scripts/migrate-index-to-workspace.ts [flags] --realms-root <dir>
 *   node scripts/migrate-index-to-workspace.ts --rollback <manifest>
 *
 * Flags:
 *   --dry-run              Report what would change; write nothing. Default is
 *                          to apply, so a first pass should always be a dry run.
 *   --persistent <root>    Scan the realm trees the deployed server mounts: the
 *                          public realms directly under <root> (see
 *                          PUBLIC_REALM_DIRS) plus every <root>/realms/<user>/<realm>.
 *   --realms-root <dir>    Scan every <dir>/<user>/<realm> as a realm root.
 *                          Repeatable; this is the user-realms half of --persistent.
 *   --published            Also scan the published snapshots under
 *                          <realms-root>/_published/<disk-id>. Off by default:
 *                          a snapshot is regenerated from its source realm on
 *                          the next publish, so migrating the source and
 *                          republishing is the path that keeps the two in step.
 *   --include <realm-dir>  Migrate this realm even though its index adopts a
 *                          bespoke card — the hand-rolled-workspace case.
 *                          Repeatable. Matches a scanned realm by path suffix,
 *                          so `--include buck/mar10` names /persistent/realms/buck/mar10.
 *   --manifest <file>      Where to write the rollback manifest
 *                          (default ./migrate-index-to-workspace-manifest.json).
 *   --json                 Emit the full report as JSON instead of a table.
 *   --rollback <file>      Restore every file recorded in a manifest and exit.
 *
 * Examples:
 *   # Preview every realm the deployed server mounts
 *   node scripts/migrate-index-to-workspace.ts --dry-run --persistent /persistent
 *
 *   # Apply, also migrating two realms whose index is a hand-rolled workspace
 *   node scripts/migrate-index-to-workspace.ts --persistent /persistent \
 *     --include ctse/demo --include buck/mar10
 *
 *   # Undo
 *   node scripts/migrate-index-to-workspace.ts \
 *     --rollback ./migrate-index-to-workspace-manifest.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { PUBLISHED_DIRECTORY_NAME } from '@cardstack/runtime-common/constants';

// The realms mounted by name in scripts/start-staging.sh and
// scripts/start-production.sh. KEEP IN SYNC with those --path arguments.
// `submissions` is passed there as ${SUBMISSION_REALM_PATH}, which resolves
// under the same root.
const PUBLIC_REALM_DIRS = [
  'base',
  'boxel-homepage',
  'catalog',
  'experiments',
  'openrouter',
  'skills',
  'software-factory',
  'submissions',
];

// The base-realm exports recognized as a realm's *default* index — the ones a
// realm gets without customizing anything, and so the ones safe to move to
// Workspace wholesale. `IndexCard` is here because `packages/base/index.gts` is
// a one-line re-export of CardsGrid under its historical name, so a realm
// adopting it is on CardsGrid too.
const LEGACY_INDEX_EXPORTS: { module: string; name: string }[] = [
  { module: 'cards-grid', name: 'CardsGrid' },
  { module: 'index', name: 'IndexCard' },
];

const WORKSPACE_EXPORT = { module: 'workspace', name: 'Workspace' };

export type AdoptsFrom = { module: string; name: string };

export type Classification =
  | { kind: 'legacy'; adoptsFrom: AdoptsFrom; target: AdoptsFrom }
  | { kind: 'workspace'; adoptsFrom: AdoptsFrom }
  | { kind: 'bespoke'; adoptsFrom: AdoptsFrom }
  | { kind: 'relative'; adoptsFrom: AdoptsFrom }
  | { kind: 'unusable'; reason: string };

/**
 * Split a base-realm module specifier into its prefix and last segment, or
 * return undefined when it doesn't address the base realm at all.
 *
 * Both live forms are accepted: the `@cardstack/base/` prefix and an absolute
 * URL whose path ends in `/base/<export>` — which covers the canonical
 * `https://cardstack.com/base/…` as well as the deployment-URL spellings
 * (`https://realms-staging.stack.cards/base/…`, `https://app.boxel.ai/base/…`)
 * that predate the RRI migration and may still sit in an untouched realm.
 */
export function splitBaseModule(
  module: string,
): { prefix: string; segment: string } | undefined {
  let prefixMatch = /^(@cardstack\/base\/)([^/]+)$/.exec(module);
  if (prefixMatch) {
    return { prefix: prefixMatch[1], segment: prefixMatch[2] };
  }
  let urlMatch = /^(https?:\/\/.*\/base\/)([^/]+)$/.exec(module);
  if (urlMatch) {
    return { prefix: urlMatch[1], segment: urlMatch[2] };
  }
  return undefined;
}

/**
 * Decide what to do with one index card's adoption.
 *
 * A relative specifier gets its own verdict rather than being folded into
 * `bespoke`: inside the base realm `./cards-grid` *is* the default index, but
 * in a user realm it names that realm's own module. Nothing on disk
 * distinguishes the two, so the script reports relative adoptions and rewrites
 * none of them.
 */
export function classify(adoptsFrom: unknown): Classification {
  if (
    !adoptsFrom ||
    typeof adoptsFrom !== 'object' ||
    typeof (adoptsFrom as AdoptsFrom).module !== 'string' ||
    typeof (adoptsFrom as AdoptsFrom).name !== 'string'
  ) {
    return { kind: 'unusable', reason: 'no data.meta.adoptsFrom' };
  }
  let from = adoptsFrom as AdoptsFrom;
  if (from.module.startsWith('.')) {
    return { kind: 'relative', adoptsFrom: from };
  }
  let split = splitBaseModule(from.module);
  if (!split) {
    return { kind: 'bespoke', adoptsFrom: from };
  }
  if (
    split.segment === WORKSPACE_EXPORT.module &&
    from.name === WORKSPACE_EXPORT.name
  ) {
    return { kind: 'workspace', adoptsFrom: from };
  }
  let legacy = LEGACY_INDEX_EXPORTS.find(
    (candidate) =>
      candidate.module === split.segment && candidate.name === from.name,
  );
  if (!legacy) {
    return { kind: 'bespoke', adoptsFrom: from };
  }
  return {
    kind: 'legacy',
    adoptsFrom: from,
    target: {
      module: `${split.prefix}${WORKSPACE_EXPORT.module}`,
      name: WORKSPACE_EXPORT.name,
    },
  };
}

/**
 * The Workspace adoption to write into a realm whose index adopts a bespoke
 * card. There is no existing base-realm specifier to take a form from, so this
 * picks the `@cardstack/base/` prefix — the form new realms are created with
 * (`handlers/create-realm.ts`).
 */
export function forcedTarget(): AdoptsFrom {
  return {
    module: `@cardstack/base/${WORKSPACE_EXPORT.module}`,
    name: WORKSPACE_EXPORT.name,
  };
}

/**
 * Rewrite an index card's adoption, preserving the file's own formatting.
 *
 * Card JSON on disk comes in two shapes — the compact single line the realm
 * server writes, and the pretty-printed form used by realms authored in the
 * repo. Matching whichever the file already uses keeps the change to the one
 * line that actually differs, which is what makes a `diff` of the run readable.
 */
export function rewriteIndexJson(source: string, target: AdoptsFrom): string {
  let doc = JSON.parse(source);
  doc.data.meta.adoptsFrom = { module: target.module, name: target.name };
  // `trimEnd` first: the realm server writes card JSON as one line plus a
  // trailing newline, and counting that newline would read the file as
  // pretty-printed and reflow the whole thing.
  let pretty = source.trimEnd().includes('\n');
  let out = pretty ? JSON.stringify(doc, null, 2) : JSON.stringify(doc);
  return source.endsWith('\n') ? `${out}\n` : out;
}

/** Keys a legacy index card carries beyond `meta.adoptsFrom`. */
export function extraKeys(source: string): string[] {
  let doc;
  try {
    doc = JSON.parse(source);
  } catch {
    return [];
  }
  let data = doc?.data ?? {};
  let extras: string[] = [];
  for (let key of Object.keys(data)) {
    if (key === 'type' || key === 'meta') {
      continue;
    }
    extras.push(`data.${key}`);
  }
  for (let key of Object.keys(data.meta ?? {})) {
    if (key === 'adoptsFrom') {
      continue;
    }
    extras.push(`data.meta.${key}`);
  }
  return extras.sort();
}

type RealmReport = {
  realmDir: string;
  indexPath: string;
  classification: Classification;
  /** Set when --include named this realm and its index is bespoke/relative. */
  forced: boolean;
  willMigrate: boolean;
  extras: string[];
};

type ManifestEntry = { path: string; original: string };

function isDirectory(path: string): boolean {
  try {
    return readdirSync(path, { withFileTypes: true }) !== undefined;
  } catch {
    return false;
  }
}

function childDirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Every `<root>/<user>/<realm>` two levels under a realms root.
 *
 * `_published` is skipped for the same reason `lib/realm-registry-backfill.ts`
 * skips it when walking owners: it is not a username, it is the flat
 * `_published/<disk-id>` tree of publish snapshots. `discoverPublishedRealms`
 * covers that tree, and only when it is asked for.
 */
export function discoverUserRealms(realmsRoot: string): string[] {
  let found: string[] = [];
  for (let user of childDirs(realmsRoot)) {
    if (user === PUBLISHED_DIRECTORY_NAME) {
      continue;
    }
    let userDir = join(realmsRoot, user);
    for (let realm of childDirs(userDir)) {
      found.push(join(userDir, realm));
    }
  }
  return found;
}

/** Every `<root>/_published/<disk-id>` — one level, unlike the owner tree. */
export function discoverPublishedRealms(realmsRoot: string): string[] {
  let publishedRoot = join(realmsRoot, PUBLISHED_DIRECTORY_NAME);
  return childDirs(publishedRoot).map((diskId) => join(publishedRoot, diskId));
}

function classifyRealm(realmDir: string): RealmReport {
  let indexPath = join(realmDir, 'index.json');
  if (!existsSync(indexPath)) {
    return {
      realmDir,
      indexPath,
      classification: { kind: 'unusable', reason: 'no index.json' },
      forced: false,
      willMigrate: false,
      extras: [],
    };
  }
  let source: string;
  try {
    source = readFileSync(indexPath, 'utf8');
  } catch (err) {
    return {
      realmDir,
      indexPath,
      classification: {
        kind: 'unusable',
        reason: `unreadable: ${(err as Error).message}`,
      },
      forced: false,
      willMigrate: false,
      extras: [],
    };
  }
  let doc: any;
  try {
    doc = JSON.parse(source);
  } catch (err) {
    return {
      realmDir,
      indexPath,
      classification: {
        kind: 'unusable',
        reason: `invalid JSON: ${(err as Error).message}`,
      },
      forced: false,
      willMigrate: false,
      extras: [],
    };
  }
  return {
    realmDir,
    indexPath,
    classification: classify(doc?.data?.meta?.adoptsFrom),
    forced: false,
    willMigrate: false,
    extras: extraKeys(source),
  };
}

/** `--include buck/mar10` names /persistent/realms/buck/mar10. */
function matchesInclude(realmDir: string, include: string): boolean {
  let normalized = include.replace(/\/+$/, '');
  return (
    realmDir === resolve(normalized) ||
    realmDir === normalized ||
    realmDir.endsWith(`${sep}${normalized}`)
  );
}

function parseArgs(argv: string[]) {
  let args = {
    dryRun: false,
    json: false,
    published: false,
    dirs: [] as string[],
    realmsRoots: [] as string[],
    include: [] as string[],
    manifest: './migrate-index-to-workspace-manifest.json',
    rollback: undefined as string | undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    switch (arg) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--published':
        args.published = true;
        break;
      case '--persistent': {
        let root = argv[++i];
        if (!root) {
          throw new Error('--persistent requires a directory');
        }
        for (let name of PUBLIC_REALM_DIRS) {
          args.dirs.push(join(root, name));
        }
        args.realmsRoots.push(join(root, 'realms'));
        break;
      }
      case '--realms-root': {
        let root = argv[++i];
        if (!root) {
          throw new Error('--realms-root requires a directory');
        }
        args.realmsRoots.push(root);
        break;
      }
      case '--include': {
        let realm = argv[++i];
        if (!realm) {
          throw new Error('--include requires a realm directory');
        }
        args.include.push(realm);
        break;
      }
      case '--manifest': {
        let file = argv[++i];
        if (!file) {
          throw new Error('--manifest requires a file path');
        }
        args.manifest = file;
        break;
      }
      case '--rollback': {
        let file = argv[++i];
        if (!file) {
          throw new Error('--rollback requires a manifest path');
        }
        args.rollback = file;
        break;
      }
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown flag: ${arg}`);
        }
        args.dirs.push(arg);
    }
  }
  return args;
}

function rollback(manifestPath: string): number {
  let entries: ManifestEntry[] = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ).files;
  for (let entry of entries) {
    writeFileSync(entry.path, entry.original);
    console.log(`restored ${entry.path}`);
  }
  console.log(`\nRestored ${entries.length} file(s) from ${manifestPath}.`);
  return 0;
}

function describe(report: RealmReport): string {
  let { classification: c } = report;
  switch (c.kind) {
    case 'legacy':
      return `${c.adoptsFrom.name} (${c.adoptsFrom.module}) -> ${c.target.name} (${c.target.module})`;
    case 'workspace':
      return `already Workspace`;
    case 'bespoke':
      return report.forced
        ? `${c.adoptsFrom.name} (${c.adoptsFrom.module}) -> Workspace [--include]`
        : `bespoke: ${c.adoptsFrom.name} (${c.adoptsFrom.module})`;
    case 'relative':
      return report.forced
        ? `${c.adoptsFrom.name} (${c.adoptsFrom.module}) -> Workspace [--include]`
        : `relative: ${c.adoptsFrom.name} (${c.adoptsFrom.module})`;
    case 'unusable':
      return `skipped: ${c.reason}`;
  }
}

export function main(argv: string[]): number {
  let args = parseArgs(argv);
  if (args.rollback) {
    return rollback(args.rollback);
  }

  let realmDirs = [...args.dirs];
  for (let root of args.realmsRoots) {
    realmDirs.push(...discoverUserRealms(root));
    if (args.published) {
      realmDirs.push(...discoverPublishedRealms(root));
    }
  }
  realmDirs = [...new Set(realmDirs)].filter((dir) => isDirectory(dir)).sort();

  if (realmDirs.length === 0) {
    console.error(
      'No realm directories to scan. Pass realm directories, --persistent <root>, or --realms-root <dir>.',
    );
    return 1;
  }

  let reports = realmDirs.map(classifyRealm);
  let unmatchedIncludes = new Set(args.include);
  for (let report of reports) {
    let hit = args.include.find((include) =>
      matchesInclude(report.realmDir, include),
    );
    if (hit) {
      unmatchedIncludes.delete(hit);
      if (
        report.classification.kind === 'bespoke' ||
        report.classification.kind === 'relative'
      ) {
        report.forced = true;
      }
    }
    report.willMigrate =
      report.classification.kind === 'legacy' || report.forced;
  }

  let migrating = reports.filter((report) => report.willMigrate);
  let manifest: ManifestEntry[] = [];
  if (!args.dryRun) {
    for (let report of migrating) {
      let source = readFileSync(report.indexPath, 'utf8');
      let target =
        report.classification.kind === 'legacy'
          ? report.classification.target
          : forcedTarget();
      let rewritten = rewriteIndexJson(source, target);
      // Re-parse before committing to disk. A malformed write here would
      // error-index the realm's index card, which is the one card whose
      // absence is most visible.
      JSON.parse(rewritten);
      manifest.push({ path: report.indexPath, original: source });
      writeFileSync(report.indexPath, rewritten);
    }
    if (manifest.length > 0) {
      writeFileSync(
        args.manifest,
        `${JSON.stringify({ files: manifest }, null, 2)}\n`,
      );
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          dryRun: args.dryRun,
          manifest: args.dryRun || manifest.length === 0 ? null : args.manifest,
          realms: reports.map((report) => ({
            realmDir: report.realmDir,
            classification: report.classification,
            forced: report.forced,
            willMigrate: report.willMigrate,
            extras: report.extras,
          })),
          unmatchedIncludes: [...unmatchedIncludes],
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      args.dryRun
        ? `Dry run over ${reports.length} realm(s):\n`
        : `Migrated ${migrating.length} of ${reports.length} realm(s):\n`,
    );
    for (let report of reports) {
      let mark = report.willMigrate ? '*' : ' ';
      console.log(`${mark} ${report.realmDir}\n    ${describe(report)}`);
      if (report.extras.length > 0) {
        console.log(`    carries: ${report.extras.join(', ')}`);
      }
    }
    let counts = new Map<string, number>();
    for (let report of reports) {
      let key = report.willMigrate
        ? 'migrate'
        : `leave (${report.classification.kind})`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    console.log('');
    for (let [key, count] of [...counts].sort()) {
      console.log(`  ${count} ${key}`);
    }
    if (!args.dryRun && manifest.length > 0) {
      console.log(
        `\nRollback manifest: ${args.manifest}\n  node scripts/migrate-index-to-workspace.ts --rollback ${args.manifest}`,
      );
    }
    if (migrating.length > 0) {
      console.log('\nReindex these realms (they were changed on disk):');
      for (let report of migrating) {
        console.log(`  ${report.realmDir}`);
      }
    }
  }

  if (unmatchedIncludes.size > 0) {
    console.error(
      `\n--include named ${unmatchedIncludes.size} realm(s) that were not scanned: ${[...unmatchedIncludes].join(', ')}`,
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
