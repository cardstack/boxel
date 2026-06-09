// This should be first
import '../src/setup-logger.ts';

import { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { logger } from '../src/logger.ts';

let log = logger('boxel-search');

type SearchSort = {
  by: string;
  direction: string;
  on?: {
    module: string;
    name: string;
  };
};

type SearchQuery = {
  filter?: Record<string, unknown>;
  sort?: SearchSort[];
  page?: {
    size?: number;
    number?: number;
  };
};

type ParsedArgValue = string | boolean | string[];
type ParsedArgs = Record<string, ParsedArgValue | undefined> & {
  _: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  let args: ParsedArgs = { _: [] };

  for (let index = 0; index < argv.length; index++) {
    let token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    let key = token.slice(2);
    let next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    let existingValue = args[key];
    if (existingValue === undefined) {
      args[key] = next;
    } else if (Array.isArray(existingValue)) {
      existingValue.push(next);
    } else if (typeof existingValue === 'string') {
      args[key] = [existingValue, next];
    } else {
      args[key] = next;
    }
    index++;
  }

  return args;
}

function forceArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function fieldPairs(
  values: string | string[] | undefined,
): Record<string, string> {
  let result: Record<string, string> = {};
  for (let entry of forceArray(values)) {
    let index = entry.indexOf('=');
    if (index === -1) {
      throw new Error(
        `Expected field pair in the form field=value, received: ${entry}`,
      );
    }
    result[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return result;
}

async function main(): Promise<void> {
  let args = parseArgs(process.argv.slice(2));
  if (typeof args.realm !== 'string') {
    throw new Error(
      'Usage: npm run boxel:search -- --realm <realm-url> [--type-name Issue --type-module <module>] [--eq field=value] [--contains field=value]',
    );
  }

  let realmUrl = args.realm;
  let client = new BoxelCLIClient();

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

  let result = await client.search(realmUrl, query as Record<string, unknown>);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  let message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  log.error(message);
  process.exit(1);
});
