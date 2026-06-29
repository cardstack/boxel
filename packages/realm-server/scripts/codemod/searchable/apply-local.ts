// Apply the derived `searchable` annotations to a repo-backed realm's source
// (base / experiments / openrouter / software-factory in the monorepo; catalog
// / skills / homepage in their own repos). Dry-run by default (prints a diff +
// report); pass `--write` to edit in place. Output is recast's (untouched code
// preserved byte-for-byte); final formatting of touched regions is the commit's
// `eslint --fix`, not standalone prettier (which reformats .gts templates).
//
//   node scripts/codemod/searchable/apply-local.ts \
//     --realm-root ../experiments-realm \
//     --realm-url https://realms-staging.stack.cards/experiments/ \
//     --realm-url https://realms.boxel.ai/experiments/ \
//     --derivation staging.derivation.json \
//     --derivation prod.derivation.json \
//     [--write]
//
// Each `--realm-url` is a deployed URL this repo realm maps to (staging + prod);
// derived defs under those URLs union by realm-relative key, so the annotation
// reflects the maximal depth observed across environments. Observed routes are
// HOISTED to the class that declares the head field (a route the DB attributed
// to `Customer` for an inherited `Contact` field is applied on `Contact`); a
// route whose field is declared OUTSIDE this realm (e.g. base CardDef's
// `cardInfo`) is left shallow and reported.

import {
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  mkdtempSync,
} from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { routesToFieldSearchable, type DerivedDef } from './derive.ts';
import {
  transformSearchable,
  type ClassPolicy,
  type SkippedField,
} from './transform.ts';
import {
  buildClassGraph,
  findDeclaringClass,
  pruneRoute,
  type SourceModule,
} from './class-graph.ts';

interface Args {
  realmRoot: string;
  realmUrls: string[];
  derivations: string[];
  write: boolean;
  stripIsUsed: boolean;
}

function parseArgs(argv: string[]): Args {
  let realmRoot = '';
  let realmUrls: string[] = [];
  let derivations: string[] = [];
  let write = false;
  let stripIsUsed = false;
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a === '--write') write = true;
    else if (a === '--strip-isused') stripIsUsed = true;
    else if (a === '--realm-root') realmRoot = argv[++i];
    else if (a === '--realm-url') realmUrls.push(argv[++i]);
    else if (a === '--derivation') derivations.push(argv[++i]);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!realmRoot || realmUrls.length === 0 || derivations.length === 0) {
    throw new Error(
      'usage: --realm-root <dir> --realm-url <url>… --derivation <json>… [--write] [--strip-isused]',
    );
  }
  return { realmRoot, realmUrls, derivations, write, stripIsUsed };
}

function collectSourceFiles(root: string): string[] {
  let out: string[] = [];
  let walk = (dir: string) => {
    for (let entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      let p = join(dir, entry);
      let st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (p.endsWith('.gts') || p.endsWith('.ts')) out.push(p);
    }
  };
  walk(root);
  return out;
}

function relModulePath(root: string, file: string): string {
  return relative(root, file)
    .replace(/\\/g, '/')
    .replace(/\.(gts|ts)$/, '');
}

// relKey (`<relpath>/<ClassName>`) -> unioned routes, scoped to realm URLs.
function buildRawRoutes(
  derivations: string[],
  realmUrls: Set<string>,
): Map<string, Set<string>> {
  let routesByRelKey = new Map<string, Set<string>>();
  for (let path of derivations) {
    let payload = JSON.parse(readFileSync(path, 'utf8')) as {
      defs: DerivedDef[];
    };
    for (let def of payload.defs) {
      if (!realmUrls.has(def.realmURL)) continue;
      if (!def.defKey.startsWith(def.realmURL)) continue;
      let relKey = def.defKey.slice(def.realmURL.length);
      let set = routesByRelKey.get(relKey);
      if (!set) routesByRelKey.set(relKey, (set = new Set()));
      for (let r of def.routes) set.add(r);
    }
  }
  return routesByRelKey;
}

function gitDiff(original: string, updated: string, label: string): string {
  let dir = mkdtempSync(join(tmpdir(), 'searchable-diff-'));
  let a = join(dir, 'a');
  let b = join(dir, 'b');
  writeFileSync(a, original);
  writeFileSync(b, updated);
  try {
    execFileSync(
      'git',
      ['--no-pager', 'diff', '--no-index', '--no-color', a, b],
      {
        encoding: 'utf8',
      },
    );
    return '';
  } catch (err: any) {
    return ((err.stdout as string) ?? '')
      .replace(new RegExp(a, 'g'), `a/${label}`)
      .replace(new RegExp(b, 'g'), `b/${label}`);
  }
}

async function main(): Promise<void> {
  let args = parseArgs(process.argv.slice(2));
  let root = resolve(args.realmRoot);

  // 1) Parse the realm's source into a class graph.
  let files = collectSourceFiles(root);
  let modules: SourceModule[] = files.map((file) => ({
    filename: file,
    modPath: relModulePath(root, file),
    source: readFileSync(file, 'utf8'),
  }));
  let graph = buildClassGraph(modules);

  // 2) Raw observed routes per leaf def, then HOIST to the declaring class.
  let raw = buildRawRoutes(args.derivations, new Set(args.realmUrls));
  let finalRoutes = new Map<string, Set<string>>();
  let noLocalClass: { relKey: string; fields: Record<string, unknown> }[] = [];
  let platformInherited: { leaf: string; route: string; base: string }[] = [];
  let unresolved: { leaf: string; route: string }[] = [];

  for (let [leafRelKey, routes] of raw) {
    if (!graph.has(leafRelKey)) {
      // No local source file — a hosted-only card (handled by the deployed
      // crawl) or a moved/renamed def. Don't apply here.
      noLocalClass.push({
        relKey: leafRelKey,
        fields: routesToFieldSearchable(routes),
      });
      continue;
    }
    for (let route of routes) {
      let head = route.includes('.')
        ? route.slice(0, route.indexOf('.'))
        : route;
      let decl = findDeclaringClass(graph, leafRelKey, head);
      if (decl.kind === 'local') {
        let set = finalRoutes.get(decl.relKey);
        if (!set) finalRoutes.set(decl.relKey, (set = new Set()));
        set.add(route);
      } else if (decl.kind === 'external') {
        platformInherited.push({
          leaf: leafRelKey,
          route,
          base: decl.externalName,
        });
      } else {
        unresolved.push({ leaf: leafRelKey, route });
      }
    }
  }

  // 2b) PRUNE each hoisted route against declared types: drop segments that
  //     cross a polymorphic field (unsearchable cruft) or aren't declared.
  let prunedRoutes = new Map<string, Set<string>>();
  let droppedPolymorphic: {
    relKey: string;
    route: string;
    kept: string | null;
  }[] = [];
  let droppedUnresolved: {
    relKey: string;
    route: string;
    kept: string | null;
  }[] = [];
  let unvalidated: { relKey: string; route: string; kept: string | null }[] =
    [];
  for (let [relKey, routes] of finalRoutes) {
    for (let route of routes) {
      let { kept, reason } = pruneRoute(graph, relKey, route);
      if (reason === 'polymorphic')
        droppedPolymorphic.push({ relKey, route, kept });
      else if (reason === 'unresolved')
        droppedUnresolved.push({ relKey, route, kept });
      else if (reason === 'unvalidated')
        unvalidated.push({ relKey, route, kept });
      if (kept) {
        let set = prunedRoutes.get(relKey);
        if (!set) prunedRoutes.set(relKey, (set = new Set()));
        set.add(kept);
      }
    }
  }

  // 3) Apply per file.
  let changedFiles: string[] = [];
  let allSkipped: SkippedField[] = [];
  let unparseable: { file: string; error: string }[] = [];
  let appliedRelKeys = new Set<string>();

  for (let mod of modules) {
    let policyForClass = (
      className: string | null,
    ): ClassPolicy | undefined => {
      if (!className) return undefined;
      let relKey = `${mod.modPath}/${className}`;
      let routes = prunedRoutes.get(relKey);
      if (!routes) return undefined;
      appliedRelKeys.add(relKey);
      return { observed: routesToFieldSearchable(routes) };
    };

    let result;
    try {
      result = transformSearchable(mod.source, {
        filename: mod.filename,
        policyForClass,
        stripIsUsed: args.stripIsUsed,
      });
    } catch (err) {
      unparseable.push({
        file: mod.filename,
        error: (err as Error).message.split('\n')[0],
      });
      continue;
    }
    allSkipped.push(...result.skipped);
    if (result.status !== 'transformed') continue;

    // recast preserves untouched code (and <template> blocks) byte-for-byte;
    // the inserted `searchable` is already repo-style (single-quoted, inline).
    // We deliberately DON'T run standalone prettier here — for .gts/.ts the repo
    // formats via eslint (eslint-plugin-prettier), and standalone prettier's
    // template path reformats unrelated lines in drifted files. The commit's
    // `eslint --fix` finalizes the touched regions.
    let formatted = result.output;
    if (formatted === mod.source) continue;
    changedFiles.push(mod.filename);

    let rel = relative(process.cwd(), mod.filename);
    process.stdout.write(`\n=== ${rel} ===\n`);
    for (let c of result.changes) {
      let bits: string[] = [];
      if (c.setSearchable !== undefined)
        bits.push(`searchable=${JSON.stringify(c.setSearchable)}`);
      if (c.strippedIsUsed) bits.push('stripped isUsed');
      process.stdout.write(
        `  ${c.className}.${c.fieldName} (${c.fieldType}): ${bits.join(', ')}\n`,
      );
    }
    if (!args.write)
      process.stdout.write(gitDiff(mod.source, formatted, rel) + '\n');
    else writeFileSync(mod.filename, formatted);
  }

  // 4) Report.
  let verb = args.write ? 'Wrote' : 'Would change';
  process.stdout.write(`\n--- summary ---\n`);
  process.stdout.write(
    `Scanned ${files.length} source file(s) under ${root}\n`,
  );
  process.stdout.write(`${verb} ${changedFiles.length} file(s)\n`);

  if (platformInherited.length > 0) {
    process.stdout.write(
      `\n${platformInherited.length} route(s) left SHALLOW — field inherited from outside this realm (e.g. base CardDef.cardInfo):\n`,
    );
    for (let p of platformInherited.sort((x, y) =>
      x.route.localeCompare(y.route),
    )) {
      process.stdout.write(
        `  ↪ ${p.leaf}  route="${p.route}"  (declared on external ${p.base})\n`,
      );
    }
  }

  if (droppedPolymorphic.length > 0) {
    let truncated = droppedPolymorphic.filter((d) => d.kept);
    process.stdout.write(
      `\n${droppedPolymorphic.length} route(s) pruned at a POLYMORPHIC field (unsearchable cruft, dropped):\n`,
    );
    for (let d of droppedPolymorphic.slice(0, 25)) {
      process.stdout.write(
        `  ✂ ${d.relKey} "${d.route}"${d.kept ? ` → kept "${d.kept}"` : ' → dropped'}\n`,
      );
    }
    if (droppedPolymorphic.length > 25)
      process.stdout.write(`  …(+${droppedPolymorphic.length - 25} more)\n`);
    process.stdout.write(
      `  (${truncated.length} truncated to a shorter route, ${droppedPolymorphic.length - truncated.length} fully dropped)\n`,
    );
  }

  if (droppedUnresolved.length > 0) {
    process.stdout.write(
      `\n${droppedUnresolved.length} route(s) pruned at a NON-DECLARED field (subtype bloat / typo):\n`,
    );
    for (let d of droppedUnresolved.slice(0, 25)) {
      process.stdout.write(
        `  ✂ ${d.relKey} "${d.route}"${d.kept ? ` → kept "${d.kept}"` : ' → dropped'}\n`,
      );
    }
    if (droppedUnresolved.length > 25)
      process.stdout.write(`  …(+${droppedUnresolved.length - 25} more)\n`);
  }

  if (unvalidated.length > 0) {
    process.stdout.write(
      `\n${unvalidated.length} route(s) kept but NOT fully validated (target type not in loaded source — review):\n`,
    );
    for (let d of unvalidated.slice(0, 25)) {
      process.stdout.write(
        `  ? ${d.relKey} "${d.route}"${d.kept ? ` → kept "${d.kept}"` : ''}\n`,
      );
    }
    if (unvalidated.length > 25)
      process.stdout.write(`  …(+${unvalidated.length - 25} more)\n`);
  }

  let unappliedFinal = [...prunedRoutes.keys()].filter(
    (k) => !appliedRelKeys.has(k),
  );
  if (unappliedFinal.length > 0) {
    process.stdout.write(
      `\n${unappliedFinal.length} class(es) had hoisted routes but no class matched in source (review):\n`,
    );
    for (let k of unappliedFinal.sort()) {
      process.stdout.write(
        `  • ${k} → ${JSON.stringify(routesToFieldSearchable(prunedRoutes.get(k)!))}\n`,
      );
    }
  }

  if (noLocalClass.length > 0) {
    process.stdout.write(
      `\n${noLocalClass.length} derived def(s) have NO local source (hosted-only / deferred to deployed crawl):\n`,
    );
    let withRoutes = noLocalClass.filter(
      (n) => Object.keys(n.fields).length > 0,
    );
    for (let n of withRoutes.sort((a, b) => a.relKey.localeCompare(b.relKey))) {
      process.stdout.write(`  • ${n.relKey} → ${JSON.stringify(n.fields)}\n`);
    }
    let shallowOnly = noLocalClass.length - withRoutes.length;
    if (shallowOnly > 0) {
      process.stdout.write(`  (+${shallowOnly} more with no annotations)\n`);
    }
  }

  if (unresolved.length > 0) {
    process.stdout.write(
      `\n${unresolved.length} route(s) with an unresolvable class chain (review):\n`,
    );
    for (let u of unresolved)
      process.stdout.write(`  ? ${u.leaf}  route="${u.route}"\n`);
  }

  if (allSkipped.length > 0) {
    process.stdout.write(
      `\n${allSkipped.length} field(s) skipped (could not modify):\n`,
    );
    for (let s of allSkipped)
      process.stdout.write(`  ⚠ ${s.className}.${s.fieldName}: ${s.reason}\n`);
  }

  if (unparseable.length > 0) {
    process.stdout.write(
      `\n${unparseable.length} unparseable file(s) (left untouched):\n`,
    );
    for (let u of unparseable)
      process.stdout.write(
        `  ⚠ ${relative(process.cwd(), u.file)}: ${u.error}\n`,
      );
  }

  if (!args.write && changedFiles.length > 0)
    process.stdout.write('\nRe-run with --write to apply.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
