/**
 * Non-auth helpers used by factory scripts and modules.
 *
 * Auth (Matrix login, realm-server tokens, per-realm tokens) used to live
 * here but is now owned by `@cardstack/boxel-cli`. Production code should
 * use `ensureActiveProfile`, `createRealmFetch`, `createServerFetch`, and
 * `createRealm` from that package instead of re-implementing the flow.
 */

import { ensureTrailingSlash, SupportedMimeType } from './realm-operations';
import { formatErrorResponse } from './error-format';

export type SearchSort = {
  by: string;
  direction: string;
  on?: {
    module: string;
    name: string;
  };
};

export type SearchQuery = {
  filter?: Record<string, unknown>;
  sort?: SearchSort[];
  page?: {
    size?: number;
    number?: number;
  };
};

export type SearchResultCard = {
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
};

export type SearchResultDocument = {
  data?: SearchResultCard[];
} & Record<string, unknown>;

export type ParsedArgValue = string | boolean | string[];
export type ParsedArgs = Record<string, ParsedArgValue | undefined> & {
  _: string[];
};

export async function searchRealm(input: {
  realmUrl: string;
  jwt?: string;
  query: SearchQuery;
}): Promise<SearchResultDocument> {
  let response = await fetch(
    new URL('./_search', ensureTrailingSlash(input.realmUrl)),
    {
      method: 'QUERY',
      headers: {
        Accept: SupportedMimeType.CardJson,
        'Content-Type': SupportedMimeType.JSON,
        ...(input.jwt ? { Authorization: input.jwt } : {}),
      },
      body: JSON.stringify(input.query),
    },
  );

  if (!response.ok) {
    let text = await formatErrorResponse(response);
    throw new Error(`Search failed: ${response.status} ${text}`);
  }

  return (await response.json()) as SearchResultDocument;
}

export function parseArgs(argv: string[]): ParsedArgs {
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

export function forceArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function fieldPairs(
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

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
