import {
  parseAddressRanges,
  parseRateLimit,
  type AddressRange,
  type AnonymousRateLimit,
} from '../anonymous-access.ts';
import { loadBxlTransform } from './transforms.ts';

// ============================================================================
// The expressions a grant carries besides its `where`, which settle how it
// treats callers who aren't signed in.
//
// - `actingUser`: the Matrix user a write such a caller makes is made as.
// - `blocklist`: the addresses the grant refuses.
// - `rateLimitRequests` and `rateLimitWindowSeconds`: how many requests one
//   address may make through the grant in a window.
//
// Each is BXL, parsed under the `policy` profile like a `where`, and evaluated
// against the governed realm's `realm.json` `config` (`realmConfig()`) and the
// policy card's own fields (`policy()`). So a grant can name a value, keep it
// on the policy card, or leave it with the realm it governs.
//
// The blocklist and the rate limit are settled once per request, at admission,
// before anything about the target is resolved, so they read nothing of the
// target: a blocked or over-limit address is answered the same whatever card
// it names, and costs the realm no card read. `actingUser` is settled for a
// write, once the target is known, so it may also read the target
// (`instance()`). None of them reads `actor()`: the caller they are evaluated
// for is always one who isn't signed in.
// ============================================================================

export type GrantExpressionName =
  | 'actingUser'
  | 'blocklist'
  | 'rateLimitRequests'
  | 'rateLimitWindowSeconds';

export const GRANT_EXPRESSION_NAMES: readonly GrantExpressionName[] = [
  'actingUser',
  'blocklist',
  'rateLimitRequests',
  'rateLimitWindowSeconds',
];

export interface CompiledGrantExpression {
  // The expression as the author wrote it.
  source: string;
  // The canonical BXL that the `policy` profile accepted.
  canonical: string;
  // Set when the expression reads the target, which only `actingUser` may.
  readsInstance?: true;
}

// What an expression is evaluated against. A slot left out is one the
// expression may not read, and reading it is an evaluation failure.
export interface GrantExpressionContext {
  realmConfig?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  instance?: Record<string, unknown>;
}

export type GrantExpressionValue =
  | { value: unknown }
  // Why it produced no value, without the BXL message, which can quote a
  // stored value.
  | { failed: string };

export async function evaluateGrantExpression(
  expression: CompiledGrantExpression,
  context: GrantExpressionContext,
): Promise<GrantExpressionValue> {
  try {
    let bxl = await loadBxlTransform();
    let value = bxl.runBxlTransform(
      expression.canonical,
      null,
      {
        ...(context.realmConfig ? { realmConfig: context.realmConfig } : {}),
        ...(context.policy ? { policy: context.policy } : {}),
        ...(context.instance ? { instance: context.instance } : {}),
      },
      { syntax: 'solidified' },
    );
    return { value };
  } catch (e: unknown) {
    return { failed: errorKind(e) };
  }
}

function errorKind(e: unknown): string {
  if (!(e instanceof Error)) {
    return typeof e;
  }
  let name = e.name !== 'Error' ? e.name : e.constructor.name;
  let phase = (e as { phase?: unknown }).phase;
  return typeof phase === 'string' ? `${name} (${phase})` : name;
}

// ----------------------------------------------------------------------------
// Reading what an expression produced.
// ----------------------------------------------------------------------------

// A blocklist as an expression produced it: a comma-separated string of
// addresses and ranges, or a list of them, given as a list or as a string
// holding a JSON list. Blank entries of a comma-separated string are dropped,
// so `""` is an empty list. Anything else, and any entry that is neither an
// address nor a range, is kept as written in `invalid`: a grant with any
// admits no caller at all, since dropping an entry would let in the address
// its author meant to keep out.
export function readBlocklist(value: unknown): {
  ranges: AddressRange[];
  invalid: string[];
} {
  let entries: unknown[];
  if (Array.isArray(value)) {
    entries = value;
  } else if (typeof value === 'string') {
    let trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return { ranges: [], invalid: [value] };
      }
      if (!Array.isArray(parsed)) {
        return { ranges: [], invalid: [value] };
      }
      entries = parsed;
    } else {
      entries = trimmed
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    }
  } else {
    return { ranges: [], invalid: [JSON.stringify(value) ?? String(value)] };
  }
  return parseAddressRanges(entries);
}

// One half of a rate limit as an expression produced it: a whole number
// within the bounds a written limit has, or undefined.
export function readRateLimitPart(
  part: 'requests' | 'windowSeconds',
  value: unknown,
): number | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }
  // Checked as half of a limit whose other half is the smallest valid value,
  // so the bounds are `parseRateLimit`'s own.
  let limit = parseRateLimit(
    part === 'requests'
      ? { requests: value, windowSeconds: 1 }
      : { requests: 1, windowSeconds: value },
  );
  return limit ? value : undefined;
}

// The limit a grant counts its callers against, each half from its
// expression where that produced one and from the platform's limit
// otherwise, so a grant that opens anything to callers who aren't signed in
// is never unlimited.
export interface GrantRateLimit extends AnonymousRateLimit {
  requestsFrom: 'grant' | 'platform';
  windowSecondsFrom: 'grant' | 'platform';
}

// What a grant's blocklist and rate limit settle to for one request: the
// addresses it refuses, and the limit it counts the rest against.
export interface GrantTraffic {
  blocklist: {
    ranges: AddressRange[];
    // Entries that are neither an address nor a range, as written.
    invalid: string[];
    // Why the expression produced nothing.
    failed?: string;
  };
  limit: GrantRateLimit;
}

// Whether a grant's blocklist closes it to every caller who isn't signed in:
// it produced nothing, or something that isn't a list of addresses.
export function blocklistCloses(traffic: GrantTraffic): boolean {
  return (
    traffic.blocklist.failed !== undefined ||
    traffic.blocklist.invalid.length > 0
  );
}

// The blocklist and rate limit `grant` settles to. Each half of the limit
// that the grant leaves out, or whose expression produces no limit, is the
// platform's.
export async function settleTraffic(
  grant: {
    blocklist?: CompiledGrantExpression;
    rateLimitRequests?: CompiledGrantExpression;
    rateLimitWindowSeconds?: CompiledGrantExpression;
  },
  context: Pick<GrantExpressionContext, 'realmConfig' | 'policy'>,
  platformLimit: AnonymousRateLimit,
): Promise<GrantTraffic> {
  let blocklist: GrantTraffic['blocklist'] = { ranges: [], invalid: [] };
  if (grant.blocklist) {
    let value = await evaluateGrantExpression(grant.blocklist, context);
    blocklist =
      'failed' in value
        ? { ranges: [], invalid: [], failed: value.failed }
        : readBlocklist(value.value);
  }
  let part = async (
    name: 'requests' | 'windowSeconds',
    expression: CompiledGrantExpression | undefined,
  ): Promise<number | undefined> => {
    if (!expression) {
      return undefined;
    }
    let value = await evaluateGrantExpression(expression, context);
    return 'failed' in value ? undefined : readRateLimitPart(name, value.value);
  };
  let requests = await part('requests', grant.rateLimitRequests);
  let windowSeconds = await part('windowSeconds', grant.rateLimitWindowSeconds);
  return {
    blocklist,
    limit: {
      requests: requests ?? platformLimit.requests,
      windowSeconds: windowSeconds ?? platformLimit.windowSeconds,
      requestsFrom: requests === undefined ? 'platform' : 'grant',
      windowSecondsFrom: windowSeconds === undefined ? 'platform' : 'grant',
    },
  };
}

// Who `expression` names for a write to `instance`: a value that is a Matrix
// user id, which `check` then judges, or why it names no one.
export async function settleActingUser(
  expression: CompiledGrantExpression,
  context: GrantExpressionContext,
  check: (
    user: string,
  ) => Promise<{ user: string } | { failure: 'not-a-matrix-id' | 'no-write' }>,
): Promise<
  | { user: string }
  | { failure: 'expression-failed' | 'not-a-matrix-id' | 'no-write' }
> {
  let value = await evaluateGrantExpression(expression, context);
  if ('failed' in value) {
    return { failure: 'expression-failed' };
  }
  if (typeof value.value !== 'string' || value.value === ANONYMOUS_ACTOR) {
    return { failure: 'not-a-matrix-id' };
  }
  return await check(value.value);
}

// ----------------------------------------------------------------------------
// Compiling.
// ----------------------------------------------------------------------------

export type GrantExpressionProblem = {
  code:
    | 'invalid-grant-expression'
    | 'grant-expression-reads-target'
    | 'grant-expression-wrong-type';
  problem: string;
  // For an expression of the wrong kind, which is kept, the expression
  // compiled.
  compiled?: CompiledGrantExpression;
};

// The parts of BXL compiling uses, as `policy.ts` states them.
export interface GrantExpressionParser {
  parseBxlAst(
    source: string,
    options: { profile: 'policy' },
  ): {
    body: unknown;
    canonicalSource: string;
    profileIssues: {
      code: string;
      severity: 'error' | 'warning';
      message: string;
    }[];
  };
  visitBxlAst(node: unknown, visitor: (node: unknown) => void): void;
}

// The request-context calls an expression may make. The profile denies every
// one, and the denial is matched in its message, as `where`'s exceptions are.
const ADMITTED_CALL_DENIAL =
  / does not allow call (?:instance|realmConfig|policy):/;

const WHAT_EACH_PRODUCES: Record<GrantExpressionName, string> = {
  actingUser: 'a Matrix user id, such as `"@writer:example.org"`',
  blocklist:
    'addresses and ranges, as a comma-separated string or a list, such as `"192.0.2.1, 10.0.0.0/8"`',
  rateLimitRequests: 'a whole number of requests, such as `300`',
  rateLimitWindowSeconds: 'a whole number of seconds, such as `60`',
};

// The expression compiled, or why it can't be used. `actingUser` may read the
// target; the others are settled before the target is known, and may not.
// An expression that can only ever produce a value of the wrong kind is
// reported too, since it can never do what its field is for.
export function compileGrantExpression(
  bxl: GrantExpressionParser,
  name: GrantExpressionName,
  source: string,
): CompiledGrantExpression | GrantExpressionProblem {
  let program;
  try {
    program = bxl.parseBxlAst(source, { profile: 'policy' });
  } catch (e: unknown) {
    return {
      code: 'invalid-grant-expression',
      problem: `\`${name}\` has a syntax error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (program.body == null) {
    return {
      code: 'invalid-grant-expression',
      problem: `\`${name}\` is empty.\n\nTo leave it unset, remove it.`,
    };
  }
  let refusals = program.profileIssues.filter(
    (issue) =>
      issue.severity === 'error' &&
      !(
        issue.code === 'policy-call-banned' &&
        ADMITTED_CALL_DENIAL.test(issue.message)
      ),
  );
  let calls = new Set<string>();
  bxl.visitBxlAst(program.body, (node) => {
    let { type, name: called } = node as { type?: unknown; name?: unknown };
    if (type === 'call' && typeof called === 'string') {
      calls.add(called);
    }
  });
  if (calls.has('actor')) {
    return {
      code: 'grant-expression-reads-target',
      problem: `\`${name}\` uses \`actor()\`, but it's only used for callers who aren't signed in, for whom \`actor()\` is always \`'anonymous'\``,
    };
  }
  if (calls.has('instance') && name !== 'actingUser') {
    return {
      code: 'grant-expression-reads-target',
      problem: `\`${name}\` uses \`instance()\`, but it's settled before the card a request names is read, so a blocked or over-limit address gets the same answer whatever card it asks for.\n\nRead the value from \`realmConfig()\` or \`policy()\`, or write it out.`,
    };
  }
  if (refusals.length > 0) {
    return {
      code: 'invalid-grant-expression',
      problem: `\`${name}\` uses something a grant can't use:\n${refusals
        .map((issue) => `- ${issue.code}: ${issue.message}`)
        .join('\n')}`,
    };
  }
  let compiled: CompiledGrantExpression = {
    source,
    canonical: program.canonicalSource,
    ...(calls.has('instance') ? { readsInstance: true as const } : {}),
  };
  let constant = literalValue(program.body);
  if (constant !== NOT_A_LITERAL && !producesRightKind(name, constant.value)) {
    return {
      code: 'grant-expression-wrong-type',
      problem: `\`${name}\` is always ${JSON.stringify(constant.value)}, but it has to produce ${WHAT_EACH_PRODUCES[name]}`,
      compiled,
    };
  }
  return compiled;
}

const NOT_A_LITERAL = Symbol('not a literal');

// The value of an expression that is a single literal: a string, a number, a
// boolean, null, or a negated number. Anything computed is not one.
function literalValue(
  node: unknown,
): { value: unknown } | typeof NOT_A_LITERAL {
  let { type, valueType, value, interpolated, operator, expr } = node as {
    type?: unknown;
    valueType?: unknown;
    value?: unknown;
    interpolated?: unknown;
    operator?: unknown;
    expr?: unknown;
  };
  if (type === 'literal' && interpolated !== true) {
    return valueType === 'null' ? { value: null } : { value };
  }
  if (type === 'unary' && operator === '-') {
    let negated = literalValue(expr);
    return negated !== NOT_A_LITERAL && typeof negated.value === 'number'
      ? { value: -negated.value }
      : NOT_A_LITERAL;
  }
  return NOT_A_LITERAL;
}

function producesRightKind(name: GrantExpressionName, value: unknown): boolean {
  switch (name) {
    case 'actingUser':
      // Whether the user exists and may write is the realm's to say when the
      // write is decided, but the magic caller is never one.
      return typeof value === 'string' && value !== ANONYMOUS_ACTOR;
    case 'blocklist':
      return readBlocklist(value).invalid.length === 0;
    case 'rateLimitRequests':
      return readRateLimitPart('requests', value) !== undefined;
    case 'rateLimitWindowSeconds':
      return readRateLimitPart('windowSeconds', value) !== undefined;
  }
}

// ----------------------------------------------------------------------------
// The caller who isn't signed in, as a policy reads them.
// ----------------------------------------------------------------------------

// What `actor()` answers for a caller who isn't signed in. It isn't a Matrix
// user id, so no signed-in caller can ever be it.
export const ANONYMOUS_ACTOR = 'anonymous';

// Whether a predicate names the caller who isn't signed in: whether the
// literal `'anonymous'` appears anywhere in it. Only a grant whose `where`
// does admits such a caller, so a grant written for signed-in callers never
// starts admitting anyone, whatever its `where` would say for one.
export function namesAnonymous(
  bxl: Pick<GrantExpressionParser, 'visitBxlAst'>,
  body: unknown,
): boolean {
  let found = false;
  bxl.visitBxlAst(body, (node) => {
    let { type, valueType, value, interpolated } = node as {
      type?: unknown;
      valueType?: unknown;
      value?: unknown;
      interpolated?: unknown;
    };
    if (
      type === 'literal' &&
      valueType === 'string' &&
      interpolated !== true &&
      value === ANONYMOUS_ACTOR
    ) {
      found = true;
    }
  });
  return found;
}
