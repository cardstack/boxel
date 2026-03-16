import {
  fieldPairs,
  forceArray,
  getAccessibleRealmTokens,
  matrixLogin,
  parseArgs,
  printJson,
  searchRealm,
} from './lib/boxel.mjs';

let args = parseArgs(process.argv.slice(2));
if (!args.realm) {
  throw new Error(
    'Usage: npm run boxel:search -- --realm <realm-url> [--type-name Ticket --type-module <module>] [--eq field=value] [--contains field=value]',
  );
}

let matrixAuth = await matrixLogin();
let realmTokens = await getAccessibleRealmTokens(matrixAuth);
let realmUrl = Array.isArray(args.realm) ? args.realm[0] : args.realm;
let jwt = realmTokens[realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`];

let query = {};
let filter = {};

if (args['type-name'] && args['type-module']) {
  filter.type = {
    module: args['type-module'],
    name: args['type-name'],
  };
}

let eq = fieldPairs(args.eq);
if (Object.keys(eq).length > 0) {
  filter.eq = eq;
}

let contains = fieldPairs(args.contains);
if (Object.keys(contains).length > 0) {
  filter.contains = contains;
}

if (Object.keys(filter).length > 0) {
  query.filter = filter;
}

let sortValues = forceArray(args.sort);
if (sortValues.length > 0) {
  query.sort = sortValues.map((entry) => {
    let [by, direction = 'asc'] = entry.split(':');
    let sort = { by, direction };
    if (args['type-name'] && args['type-module']) {
      sort.on = {
        module: args['type-module'],
        name: args['type-name'],
      };
    }
    return sort;
  });
}

if (args.size || args.page) {
  query.page = {};
  if (args.size) {
    query.page.size = Number(args.size);
  }
  if (args.page) {
    query.page.number = Number(args.page);
  }
}

let results = await searchRealm({ realmUrl, jwt, query });
printJson(results);
