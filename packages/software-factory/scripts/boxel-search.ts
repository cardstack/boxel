import {
  fieldPairs,
  forceArray,
  getAccessibleRealmTokens,
  matrixLogin,
  parseArgs,
  printJson,
  searchRealm,
  type SearchQuery,
  type SearchSort,
} from './lib/boxel';

async function main(): Promise<void> {
  let args = parseArgs(process.argv.slice(2));
  if (typeof args.realm !== 'string') {
    throw new Error(
      'Usage: npm run boxel:search -- --realm <realm-url> [--type-name Ticket --type-module <module>] [--eq field=value] [--contains field=value]',
    );
  }

  let matrixAuth = await matrixLogin();
  let realmTokens = await getAccessibleRealmTokens(matrixAuth);
  let realmUrl = args.realm;
  let jwt = realmTokens[realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`];

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

  let results = await searchRealm({ realmUrl, jwt, query });
  printJson(results);
}

main().catch((error: unknown) => {
  let message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exit(1);
});
