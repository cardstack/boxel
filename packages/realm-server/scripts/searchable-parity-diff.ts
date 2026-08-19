/**
 * searchable-parity-diff — compare a realm's LIVE search docs (store-driven,
 * from `boxel_index`) against the searchable-driven generator's output, per card.
 *
 * This is the realm-scale parity validator for the "generate search doc from
 * field definitions only" project. It is meaningful only once a realm's cards
 * carry `searchable` annotations that make the new generator reproduce the
 * depth the store-driven path produces; without those annotations the two
 * paths differ by design (the searchable-driven spec keeps `{ id }` for every
 * relationship; the store-driven path omits unused links via
 * `usedLinksToFieldsOnly`). The CI fixture test in
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
 * found. The comparison logic (`diffDoc`) is shared with the generation tests
 * via `@cardstack/runtime-common` so both judge parity identically. `_cardType`
 * (appended by the prerender meta route, not the generator) is ignored. With
 * `--ignore-shallow-links`, a relationship that is `{ id }`-only (or null) on one
 * side and absent on the other is treated as equivalent — the known, intended
 * `{ id }`-vs-omitted difference, ignored at any nesting depth (a pulled-in card
 * carries the same shallow base-card links) — so the report surfaces only
 * divergences that matter (changed references, lost expansions, real data).
 *
 * Usage:
 *   node packages/realm-server/scripts/searchable-parity-diff.ts \
 *     --live live.json --generated generated.json [--ignore-shallow-links]
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { diffDoc } from '@cardstack/runtime-common';

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
  for (let url of urls) {
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
      for (let d of docDiffs) console.log(`    ${d}`);
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

// Run only when invoked directly as a script — importing the pure functions
// above (e.g. from a test) must not execute the file I/O in `main`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
