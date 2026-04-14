// This should be first
import '../src/setup-logger';

import { ensureActiveProfile, createRealmFetch } from '@cardstack/boxel-cli';
import {
  fieldPairs,
  forceArray,
  parseArgs,
  printJson,
  type SearchQuery,
  type SearchSort,
} from '../src/boxel';
import { ensureTrailingSlash, SupportedMimeType } from '../src/realm-operations';
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

  let searchUrl = `${ensureTrailingSlash(realmUrl)}_search`;
  let response = await realmFetch(searchUrl, {
    method: 'QUERY',
    headers: {
      Accept: SupportedMimeType.CardJson,
      'Content-Type': SupportedMimeType.JSON,
    },
    body: JSON.stringify(query),
  });

  if (!response.ok) {
    let text = await response.text();
    throw new Error(`Search failed: ${response.status} ${text}`);
  }

  let results = await response.json();
  printJson(results);
}

main().catch((error: unknown) => {
  let message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  log.error(message);
  process.exit(1);
});
