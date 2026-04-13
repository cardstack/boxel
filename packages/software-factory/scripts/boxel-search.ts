// This should be first
import '../src/setup-logger';

import { ensureActiveProfile, createRealmFetch } from '@cardstack/boxel-cli';
import {
  fieldPairs,
  forceArray,
  parseArgs,
  printJson,
  searchRealm,
  type SearchQuery,
  type SearchSort,
} from '../src/boxel';
import { logger } from '../src/logger';

let log = logger('boxel-search');

async function main(): Promise<void> {
  let args = parseArgs(process.argv.slice(2));
  if (typeof args.realm !== 'string') {
    throw new Error(
      'Usage: npm run boxel:search -- --realm <realm-url> [--type-name Issue --type-module <module>] [--eq field=value] [--contains field=value]',
    );
  }

  await ensureActiveProfile();
  let realmUrl = args.realm;
  let realmFetch = createRealmFetch(realmUrl);

  let query: SearchQuery = {};
  let filter: Record<string, unknown> = {};

  if (
    typeof args['type-name'] === 'string' &&
    typeof args['type-module'] === 'string'
  ) {
    filter.type = {
      module: args['type-module'],
      name: args['type-name'],
    };
  }

  let eq = fieldPairs(typeof args.eq === 'boolean' ? undefined : args.eq);
  if (Object.keys(eq).length > 0) {
    filter.eq = eq;
  }

  let contains = fieldPairs(
    typeof args.contains === 'boolean' ? undefined : args.contains,
  );
  if (Object.keys(contains).length > 0) {
    filter.contains = contains;
  }

  if (Object.keys(filter).length > 0) {
    query.filter = filter;
  }

  let sortValues = forceArray(
    typeof args.sort === 'boolean' ? undefined : args.sort,
  );
  if (sortValues.length > 0) {
    query.sort = sortValues.map((entry): SearchSort => {
      let [by, direction = 'asc'] = entry.split(':');
      let sort: SearchSort = { by, direction };
      if (
        typeof args['type-name'] === 'string' &&
        typeof args['type-module'] === 'string'
      ) {
        sort.on = {
          module: args['type-module'],
          name: args['type-name'],
        };
      }
      return sort;
    });
  }

  if (typeof args.size === 'string' || typeof args.page === 'string') {
    query.page = {};
    if (typeof args.size === 'string') {
      query.page.size = Number(args.size);
    }
    if (typeof args.page === 'string') {
      query.page.number = Number(args.page);
    }
  }

  // searchRealm in src/boxel.ts builds its own headers via the optional
  // `jwt` field. We want auth via createRealmFetch instead — patch
  // globalThis.fetch for the duration of the call so searchRealm picks
  // up our auth-aware fetch transparently. The script is short-lived;
  // there are no other concurrent fetches to worry about.
  let originalFetch = globalThis.fetch;
  globalThis.fetch = realmFetch;
  try {
    let results = await searchRealm({ realmUrl, query });
    printJson(results);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error: unknown) => {
  let message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  log.error(message);
  process.exit(1);
});
