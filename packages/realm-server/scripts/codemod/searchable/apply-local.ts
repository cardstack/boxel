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
  rmSync,
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
  isCardDef,
  type SourceModule,
} from './class-graph.ts';

// Routes that resolve to a field on one of these platform-root types are left
// shallow (their declaring def is the universal base, so annotating it deepens
// every card's search doc). In practice that is CardDef.cardInfo.
const PLATFORM_ROOT_CLASSES = new Set(['CardDef', 'FieldDef', 'BaseDef']);

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
  if (!realmRoot) {
    throw new Error(
      'usage: --realm-root <dir> [--realm-url <url>… --derivation <json>…] [--write] [--strip-isused]',
    );
  }
  // Strip-only mode: `--strip-isused` with no derivation removes every `isUsed`
  // option and adds no `searchable` (so a realm that already carries its
  // `searchable` annotations is edited only to drop the now-inert `isUsed` —
  // provably behavior-neutral). A derivation, when given, adds `searchable` and
  // needs the realm URL(s) it maps to so defs match by prefix.
  if (derivations.length === 0 && !stripIsUsed) {
    throw new Error(
      'nothing to do: pass --derivation <json>… (add searchable) and/or --strip-isused (remove isUsed)',
    );
  }
  if (derivations.length > 0 && realmUrls.length === 0) {
    throw new Error('--derivation requires at least one --realm-url');
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

// relKey (`<relpath>/<ClassName>`) -> unioned routes for this realm. Matching is
// by DEFKEY PREFIX, not the row's realm_url: a def's internal key (`types[0]`)
// can use either the realm's https URL OR a `@cardstack/<realm>/` canonical
// prefix (base / catalog / skills register the latter), and the same canonical
// def is shared across every realm that instantiates it. So pass every prefix
// form a realm's defs can carry (its staging + prod URLs and, for the platform
// realms, the `@cardstack/<realm>/` form); each def is stripped of whichever
// prefix it matches. A def whose key matches none of this realm's prefixes
// (e.g. an `@cardstack/base/...` def instantiated inside catalog) is left to its
// own realm's run.
function buildRawRoutes(
  derivations: string[],
  prefixes: string[],
): { routesByRelKey: Map<string, Set<string>>; instanceRelKeys: Set<string> } {
  let routesByRelKey = new Map<string, Set<string>>();
  // Every def of this realm that HAD indexed instances (even if all its
  // relationships stayed shallow → empty routes). Used to tell a shallow-but-
  // observed def (leave alone) from a zero-instance def (default to depth-1).
  let instanceRelKeys = new Set<string>();
  for (let path of derivations) {
    let payload = JSON.parse(readFileSync(path, 'utf8')) as {
      defs: DerivedDef[];
    };
    for (let def of payload.defs) {
      let prefix = prefixes.find((p) => def.defKey.startsWith(p));
      if (!prefix) continue;
      let relKey = def.defKey.slice(prefix.length);
      instanceRelKeys.add(relKey);
      if (def.routes.length === 0) continue;
      let set = routesByRelKey.get(relKey);
      if (!set) routesByRelKey.set(relKey, (set = new Set()));
      for (let r of def.routes) set.add(r);
    }
  }
  return { routesByRelKey, instanceRelKeys };
}

function gitDiff(original: string, updated: string, label: string): string {
  let dir = mkdtempSync(join(tmpdir(), 'searchable-diff-'));
  let a = join(dir, 'a');
  let b = join(dir, 'b');
  try {
    writeFileSync(a, original);
    writeFileSync(b, updated);
    try {
      execFileSync(
        'git',
        ['--no-pager', 'diff', '--no-index', '--no-color', a, b],
        { encoding: 'utf8' },
      );
      return '';
    } catch (err: any) {
      // git diff exits non-zero when there IS a diff. Rewrite the temp paths to
      // the realm-relative label via literal split/join (the paths can contain
      // regex metacharacters, so a RegExp would be wrong).
      return ((err.stdout as string) ?? '')
        .split(a)
        .join(`a/${label}`)
        .split(b)
        .join(`b/${label}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  let args = parseArgs(process.argv.slice(2));
  let root = resolve(args.realmRoot);

  // 1) Read the realm's source files.
  let files = collectSourceFiles(root);
  let modules: SourceModule[] = files.map((file) => ({
    filename: file,
    modPath: relModulePath(root, file),
    source: readFileSync(file, 'utf8'),
  }));

  // `searchable` planning. EMPTY in strip-only mode (no --derivation): there is
  // nothing to plan, and we skip parsing the whole realm into a class graph
  // just to strip `isUsed`. Populated below only when a derivation is given.
  let graph: ReturnType<typeof buildClassGraph> | undefined;
  let prunedRoutes = new Map<string, Set<string>>();
  let instanceRelKeys = new Set<string>();
  let noLocalClass: { relKey: string; fields: Record<string, unknown> }[] = [];
  let platformInherited: { leaf: string; route: string; base: string }[] = [];
  let unresolved: { leaf: string; route: string }[] = [];
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

  if (args.derivations.length > 0) {
    // Parse the realm's source into a class graph.
    graph = buildClassGraph(modules);

    // 2) Raw observed routes per leaf def, then HOIST to the declaring class.
    let built = buildRawRoutes(args.derivations, args.realmUrls);
    instanceRelKeys = built.instanceRelKeys;
    let raw = built.routesByRelKey;
    let finalRoutes = new Map<string, Set<string>>();

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
        if (
          decl.kind === 'local' &&
          PLATFORM_ROOT_CLASSES.has(graph.get(decl.relKey)!.className)
        ) {
          // The head field is declared by a platform-root type (CardDef's
          // `cardInfo`, etc.). Annotating it deepens EVERY card's search doc — a
          // platform-wide blast radius we deliberately leave shallow (deepen later
          // via a base edit + reindex if ever wanted). Holds even when processing
          // base itself, where CardDef is a local class.
          platformInherited.push({
            leaf: leafRelKey,
            route,
            base: graph.get(decl.relKey)!.className,
          });
        } else if (decl.kind === 'local') {
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
  }

  // 3) Apply per file.
  let changedFiles: string[] = [];
  let allSkipped: SkippedField[] = [];
  let unparseable: { file: string; error: string }[] = [];
  let appliedRelKeys = new Set<string>();

  for (let mod of modules) {
    let policyForClass = (
      exportName: string | null,
    ): ClassPolicy | undefined => {
      // Strip-only mode (no derivation): never apply a `searchable` policy —
      // not the observed routes and not the zero-instance depth-1 default — so
      // the only edit is the `isUsed` strip below.
      if (args.derivations.length === 0) return undefined;
      if (!exportName) return undefined;
      let relKey = `${mod.modPath}/${exportName}`;
      let routes = prunedRoutes.get(relKey);
      if (routes) {
        appliedRelKeys.add(relKey);
        return { observed: routesToFieldSearchable(routes) };
      }
      // No observed routes. If the def had indexed instances, its relationships
      // were genuinely shallow — leave them. If it had ZERO instances (absent
      // from the derivation) and is an instantiable card def, default its
      // relationships to depth-1 (`searchable: true`) for resilience.
      if (!instanceRelKeys.has(relKey) && isCardDef(graph!, relKey)) {
        appliedRelKeys.add(relKey);
        return { defaultRelationshipsToTrue: true };
      }
      return undefined;
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
