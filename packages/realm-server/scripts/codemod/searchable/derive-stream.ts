// Entrypoint: read NDJSON instance rows from stdin, derive `searchable` per
// card def, write the derivation JSON to stdout (or to the path in argv[2]).
//
// Each stdin line is `{"def": "<types[0]>", "realm": "<realm_url>", "doc": <search_doc>}`.
// Produced read-only from the deployed DB via the SSM tunnel, e.g.:
//
//   bash scripts/.../dbq.sh staging 55432 -A -t -c "
//     SELECT json_build_object('def', types->>0, 'realm', realm_url, 'doc', search_doc)::text
//     FROM boxel_index
//     WHERE type='instance' AND is_deleted IS NOT TRUE AND types->>0 IS NOT NULL
//   " | NODE_NO_WARNINGS=1 node scripts/codemod/searchable/derive-stream.ts staging.derivation.json
//
// The DB read stays entirely in psql (authenticated as claude_readonly_user);
// this script never opens a DB connection.

import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

import { DerivationAccumulator } from './derive.ts';

async function main(): Promise<void> {
  let outPath = process.argv[2];
  let acc = new DerivationAccumulator();
  let rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  let total = 0;
  let bad = 0;
  for await (let raw of rl) {
    let line = raw.trim();
    if (!line) {
      continue;
    }
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      bad += 1;
      continue;
    }
    if (!row || typeof row.def !== 'string') {
      continue;
    }
    acc.add(row.def, typeof row.realm === 'string' ? row.realm : '', row.doc);
    total += 1;
  }

  let defs = acc.results();
  let payload = {
    generatedFrom: 'boxel_index search docs',
    instanceRows: total,
    unparseableRows: bad,
    defCount: defs.length,
    defs,
  };
  let json = JSON.stringify(payload, null, 2);
  if (outPath) {
    writeFileSync(outPath, json);
    process.stderr.write(
      `Derived ${defs.length} def(s) from ${total} instance row(s)` +
        (bad ? ` (${bad} unparseable rows skipped)` : '') +
        ` → ${outPath}\n`,
    );
  } else {
    process.stdout.write(json + '\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
