// Checks the value store against the index it derives from, read-only
// (runtime-common/value-store-check.ts): every live card has its card row
// and no other card has one, and a sample of cards per realm holds exactly
// the rows its search keys extract. Run it after migrating to the value
// store (the add-boxel-index-values bridge) and whenever search results
// look short. Exits 1 when it finds a breach.
//
//   pnpm check-value-store [--realm <url>] [--sample <n>]

import '../setup-logger.ts';
import { PgAdapter } from '@cardstack/postgres';
import {
  checkValueStore,
  query,
  valueStoreRealms,
} from '@cardstack/runtime-common';

async function main() {
  let args = process.argv.slice(2);
  let flag = (name: string) => {
    let at = args.indexOf(`--${name}`);
    return at >= 0 ? args[at + 1] : undefined;
  };
  let adapter = new PgAdapter({ autoMigrate: false });
  let host = { dbAdapter: adapter, query: (e: any) => query(adapter, e) };
  let breaches = 0;
  try {
    let realms = flag('realm')
      ? [flag('realm') as string]
      : await valueStoreRealms(host);
    for (let realm of realms) {
      let problems = await checkValueStore(host, realm, {
        sample: Number(flag('sample') ?? 200),
      });
      for (let p of problems) {
        breaches++;
        console.log(
          `${p.realm}: ${p.kind} ${p.count} (for example ${p.examples.join(', ')})`,
        );
      }
    }
    console.log(
      breaches === 0
        ? `The value store is in step with the index (${realms.length} realms).`
        : `${breaches} breach(es) found.`,
    );
  } finally {
    await adapter.close();
  }
  process.exit(breaches === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Failed to check the value store:', err);
  process.exit(2);
});
