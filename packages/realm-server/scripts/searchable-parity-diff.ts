/**
 * searchable-parity-diff — compare a realm's LIVE search docs (store-driven,
 * from `boxel_index`) against the searchable-driven generator's output, per card.
 *
 * This is the POST-MIGRATION parity validator for the "generate search doc from
 * field definitions only" project. It is meaningful only after the migration
 * (CS-11723) has annotated a realm's cards with `searchable` so the new
 * generator reproduces today's depth; before then the two paths differ by
 * design (the new spec keeps `{ id }` for every relationship; the store-driven
 * path omits unused links via `usedLinksToFieldsOnly`). The CI fixture test in
 * `packages/host/tests/integration/searchable-search-doc-test.gts` covers the
 * generator's behavior; this script is the realm-scale before/after check.
 *
 * It takes two JSON files, each a map of `{ <cardURL>: <searchDoc> }`:
 *   --live <file>        the store-driven docs. Gather from staging/prod
 *                        read-only (see the `aws-access` + `indexing-diagnostics`
 *                        skills), e.g. over the SSM psql tunnel:
 *                          SELECT url, search_doc FROM boxel_index
 *                          WHERE realm_url = $1 AND type = 'instance';
 *                        then shape the rows into `{ url: search_doc }`.
 *   --generated <file>   the `searchDocFromFields` output for the same cards,
 *                        produced in a host environment (the generator needs the
 *                        loader/store; it can't run in plain node). Pull the
 *                        realm source with `boxel realm pull`, index/load it,
 *                        and dump `await searchDocFromFields(instance)` per card.
 *
 * Output: a per-card report of real divergences and a non-zero exit if any are
 * found. `_cardType` (appended by the prerender meta route, not the generator)
 * is ignored. With `--ignore-shallow-links`, a relationship that is `{ id }`-only
 * (or null) on one side and absent on the other is treated as equivalent — the
 * known, intended `{ id }`-vs-omitted difference — so the report surfaces only
 * divergences that matter for the cutover (changed expansions, missing data).
 *
 * Usage:
 *   node packages/realm-server/scripts/searchable-parity-diff.ts \
 *     --live live.json --generated generated.json [--ignore-shallow-links]
 */
import { readFileSync } from 'fs';

type SearchDoc = Record<string, unknown>;
type DocMap = Record<string, SearchDoc>;

function parseArgs(argv: string[]) {
  let args: {
    live?: string;
    generated?: string;
    ignoreShallowLinks: boolean;
  } = { ignoreShallowLinks: false };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a === '--live') args.live = argv[++i];
    else if (a === '--generated') args.generated = argv[++i];
    else if (a === '--ignore-shallow-links') args.ignoreShallowLinks = true;
  }
  if (!args.live || !args.generated) {
    throw new Error(
      'usage: searchable-parity-diff --live <file> --generated <file> [--ignore-shallow-links]',
    );
  }
  return args as {
    live: string;
    generated: string;
    ignoreShallowLinks: boolean;
  };
}

// A relationship slot captured as `{ id }`-only (or null) carries no contained
// data — it's a bare reference. The store-driven path omits unused links
// entirely while the new path keeps the `{ id }`; under --ignore-shallow-links
// both forms are treated as "no data here".
function isShallowLink(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== 'object') return false;
  let keys = Object.keys(value as object);
  return keys.length === 1 && keys[0] === 'id';
}

function diffDoc(
  live: SearchDoc,
  generated: SearchDoc,
  ignoreShallowLinks: boolean,
): string[] {
  let diffs: string[] = [];
  let strip = (d: SearchDoc) => {
    let { _cardType, ...rest } = d;
    return rest;
  };
  let l = strip(live ?? {});
  let g = strip(generated ?? {});
  let keys = new Set([...Object.keys(l), ...Object.keys(g)]);
  for (let key of [...keys].sort()) {
    let lv = (l as SearchDoc)[key];
    let gv = (g as SearchDoc)[key];
    if (ignoreShallowLinks && isShallowLink(lv) && isShallowLink(gv)) {
      continue;
    }
    let ls = JSON.stringify(lv);
    let gs = JSON.stringify(gv);
    if (ls !== gs) {
      diffs.push(
        `    ${key}: live=${ls ?? 'absent'} generated=${gs ?? 'absent'}`,
      );
    }
  }
  return diffs;
}

function main() {
  let { live, generated, ignoreShallowLinks } = parseArgs(
    process.argv.slice(2),
  );
  let liveDocs = JSON.parse(readFileSync(live, 'utf8')) as DocMap;
  let generatedDocs = JSON.parse(readFileSync(generated, 'utf8')) as DocMap;

  let urls = new Set([...Object.keys(liveDocs), ...Object.keys(generatedDocs)]);
  let divergent = 0;
  let onlyLive = 0;
  let onlyGenerated = 0;
  for (let url of [...urls].sort()) {
    if (!(url in generatedDocs)) {
      onlyLive++;
      console.log(`MISSING from generated: ${url}`);
      continue;
    }
    if (!(url in liveDocs)) {
      onlyGenerated++;
      console.log(`MISSING from live: ${url}`);
      continue;
    }
    let docDiffs = diffDoc(
      liveDocs[url],
      generatedDocs[url],
      ignoreShallowLinks,
    );
    if (docDiffs.length > 0) {
      divergent++;
      console.log(`DIVERGENT ${url}`);
      for (let d of docDiffs) console.log(d);
    }
  }

  console.log(
    `\n${urls.size} cards compared — ${divergent} divergent, ${onlyLive} live-only, ${onlyGenerated} generated-only` +
      (ignoreShallowLinks ? ' (shallow-link differences ignored)' : ''),
  );
  if (divergent > 0 || onlyLive > 0 || onlyGenerated > 0) {
    process.exitCode = 1;
  }
}

main();
