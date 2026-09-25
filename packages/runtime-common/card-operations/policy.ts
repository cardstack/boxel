import stableStringify from 'safe-stable-stringify';

import { now } from '../clock.ts';
import type { ResolvedCodeRef } from '../code-ref.ts';
import { computeContentHash } from '../content-hash.ts';
import { isFilterRefersToNonexistentTypeError } from '../definition-lookup.ts';
import type { Definition } from '../definitions.ts';
import type { IndexedInstanceSource } from '../index-query-engine.ts';
import { logger } from '../log.ts';
import { rri } from '../realm-identifiers.ts';
import { compilePolicyFilter } from './policy-filter.ts';
import type {
  OperationQueryFilterTemplate,
  PolicyIssue,
  PolicyIssueCode,
} from './types.ts';

// A realm's policy compiled for the gate: the RealmPolicy card that the realm's
// `realm.json` names, with every `where` parsed and canonicalized under BXL's
// `policy` profile, and every grant on a query carrying the search filter its
// predicate compiles to.
//
// Only what compiled is here. A rule or grant that did not compile is left out
// and recorded in `issues`. So a grant whose predicate failed can never be
// mistaken for a grant that has no condition. A card that could not be loaded
// compiles to no rules at all, so it grants nothing.
//
// The compiled policy holds no decision. What a predicate says about one
// caller and one card depends on data that changes without the policy
// changing, so only the policy itself is cached.
export interface CompiledRealmPolicy {
  // The policy card, as the realm's pointer names it.
  card: string;
  // The card's `meta.version`: the fingerprint of the stored source this was
  // compiled from. Absent when the card could not be read.
  version: string | undefined;
  rules: CompiledPolicyRule[];
  issues: PolicyIssue[];
}

export interface CompiledPolicyRule {
  // The card type the rule governs, resolved against the policy card's URL.
  targetType: ResolvedCodeRef;
  grants: CompiledOperationGrant[];
}

export interface CompiledOperationGrant {
  operation: string;
  // Absent for a grant with no condition.
  where?: CompiledPolicyPredicate;
  // For a grant on a query, the search filter the grant admits: the cards of
  // the rule's type that its predicate holds for, as a wire filter template
  // whose `{ $ref: 'actor' }` markers a search fills in with the caller. A
  // search the policy scopes composes it into the caller's filter rather than
  // judging each card it finds.
  //
  // Absent on every other grant. A `read` grant never has one: reading a card
  // whose id you were given and enumerating every card of a type are
  // different powers. Absent too on a query grant whose predicate has no
  // filter, which is recorded as a `policy-not-filterable` issue. That grant
  // admits no search, and its predicate is kept as it is.
  filter?: OperationQueryFilterTemplate;
}

export interface CompiledPolicyPredicate {
  // The predicate as the author wrote it.
  source: string;
  // The canonical BXL that the `policy` profile accepted.
  canonical: string;
  // Whether the author annotated the predicate as reading a snapshot tier.
  snapshot: boolean;
}

// The type every policy card adopts from. It is defined in the catalog realm,
// which a deployment serves under this prefix.
export const realmPolicyRef: ResolvedCodeRef = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

// What compiling reads and resolves. The realm provides each of these on its
// own authority, never the caller's. A policy card commonly lives in a realm
// the caller cannot read, and reading it under the caller's authority would
// need the policy to be loaded already.
export interface PolicyCompileEnvironment {
  // The policy card's row as its index visit recorded it, read directly and
  // not through any realm's request handling. Its rendering plays no part: a
  // card whose render failed still says what it grants.
  readCard(url: URL): Promise<IndexedInstanceSource | undefined>;
  resolveCodeRef(
    codeRef: { module: string; name: string },
    relativeTo: URL,
  ): ResolvedCodeRef | undefined;
  lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition>;
  // The URL a module identifier names. A module in a prefix-mapped realm is
  // identified in prefix form, and this resolves it to the URL of the realm
  // that serves it.
  toURL(identifier: string): URL;
  // Whether a card's adoption chain, as the index records it, makes it a
  // RealmPolicy.
  isPolicyCard(types: string[]): boolean;
}

// The environment the cache needs beyond compiling: which card the realm's
// pointer names right now.
export interface RealmPolicyCacheEnvironment extends PolicyCompileEnvironment {
  policyCard(): Promise<string | undefined>;
}

// The per-realm compiled-policy cache.
//
// An entry answers every read from memory until an index moves under one of
// its inputs. Its inputs are the policy card, and the module of every type its
// rules name. After such a move, the next read revalidates the entry: it reads
// the card's `meta.version` again and looks up those definitions again. The
// policy is recompiled only when one of them changed. So an edit to an
// unrelated card in the same realm costs a revalidation, and no compile. A
// renamed field changes its type's definition, and that recompiles.
//
// A move also starts that revalidation in the background. So in steady state
// the next read finds the entry warm, and the compile happens at index time
// rather than on the request that follows it. A read that finds the cache cold
// compiles on demand.
//
// An entry is also revalidated once it has gone `MAX_UNVALIDATED_MS` without
// one. The signals below are best-effort, and a move that never reaches this
// process would otherwise leave the entry answered as it is for good,
// including a grant that has since been removed. The bound makes a lost
// signal cost one revalidation rather than an unending stale policy.
//
// Moves reach the cache from `noteRealmIndexMoved`. The realm calls it for its
// own index swaps. The realm server calls it for the swaps of realms it has not
// mounted. A policy card or a type's module usually lives in a realm other than
// the one it governs, so this is what reaches an entry when that realm's index
// moves.
export class RealmPolicyCache {
  #env: RealmPolicyCacheEnvironment;
  #current: Compilation | undefined;
  // Set when an index under one of `#current`'s inputs has moved since it was
  // last validated.
  #stale = false;
  // Refreshes in flight. Each is told about every move that lands while it
  // runs, so a refresh that read an input before that input moved is not kept.
  #inFlight = new Set<Refresh>();
  // The refresh a read may join: the latest one, while no move has landed
  // under an input it is known to read.
  #joinable:
    | { refresh: Refresh; promise: Promise<CompiledRealmPolicy> }
    | undefined;
  #registered = false;
  // When `#current` was last known to match the index: the moment the read
  // that built or revalidated it began.
  #validatedAt = 0;
  // How often compiling and revalidating actually happen, for tests that
  // assert on it rather than on the result alone.
  readonly stats = { compiles: 0, revalidations: 0 };

  constructor(env: RealmPolicyCacheEnvironment) {
    this.#env = env;
  }

  // The realm's compiled policy, or undefined for a realm that has no policy.
  async get(): Promise<CompiledRealmPolicy | undefined> {
    let card = await this.#env.policyCard();
    if (!card) {
      this.#current = undefined;
      this.#stale = false;
      return undefined;
    }
    let current = this.#current;
    if (
      current &&
      current.compiled.card === card &&
      !this.#stale &&
      now() - this.#validatedAt < MAX_UNVALIDATED_MS
    ) {
      return current.compiled;
    }
    return await this.#refresh(card);
  }

  // The index of the realm at `realmURL` has moved.
  indexMoved(realmURL: string): void {
    for (let refresh of this.#inFlight) {
      refresh.moved.push(realmURL);
    }
    let joinable = this.#joinable;
    if (joinable && readsFrom(joinable.refresh.inputs, realmURL)) {
      this.#joinable = undefined;
    }
    let current = this.#current;
    if (!current || !readsFrom(current.inputs, realmURL)) {
      return;
    }
    this.#stale = true;
    this.get().catch((e: unknown) => {
      log.warn(
        `refreshing the compiled policy ${current.compiled.card} after ${realmURL} was indexed failed: ${e}`,
      );
    });
  }

  // Drops the cached compilation and zeroes the counts, so a test starts from
  // a cold cache.
  clear(): void {
    this.#current = undefined;
    this.#stale = false;
    this.#joinable = undefined;
    this.stats.compiles = 0;
    this.stats.revalidations = 0;
  }

  #refresh(card: string): Promise<CompiledRealmPolicy> {
    let joinable = this.#joinable;
    if (joinable && joinable.refresh.card === card) {
      return joinable.promise;
    }
    if (!this.#registered) {
      this.#registered = true;
      policyCaches.add(new WeakRefConstructor(this));
    }
    let current = this.#current;
    let refresh: Refresh = {
      card,
      inputs: current?.compiled.card === card ? [...current.inputs] : [card],
      moved: [],
    };
    this.#inFlight.add(refresh);
    let promise = this.#run(refresh).finally(() => {
      this.#inFlight.delete(refresh);
      if (this.#joinable?.refresh === refresh) {
        this.#joinable = undefined;
      }
    });
    this.#joinable = { refresh, promise };
    return promise;
  }

  async #run(refresh: Refresh): Promise<CompiledRealmPolicy> {
    let { card } = refresh;
    let startedAt = now();
    let row = await this.#env.readCard(new URL(card));
    let current = this.#current;
    let compilation: Compilation | undefined;
    if (current && current.compiled.card === card) {
      if (await stillCurrent(current, row, this.#env)) {
        this.stats.revalidations++;
        compilation = current;
      }
    }
    if (!compilation) {
      this.stats.compiles++;
      compilation = await compilePolicy(card, row, this.#env, (url) =>
        refresh.inputs.push(url),
      );
      if (compilation.compiled.issues.length > 0) {
        log.warn(
          `the policy ${card} compiled with issues: ${compilation.compiled.issues
            .map((issue) => `${issue.path || '(card)'}: ${issue.message}`)
            .join('; ')}`,
        );
      }
    }
    // Kept only when no move landed under one of its inputs while this ran. A
    // kept entry is answered from memory until the next move, so keeping one
    // built from a read that a later move superseded would keep serving what
    // that move replaced. Answered either way: it is the policy as this read
    // found it.
    let inputs = compilation.inputs;
    if (!refresh.moved.some((moved) => readsFrom(inputs, moved))) {
      this.#current = compilation;
      this.#stale = false;
      this.#validatedAt = startedAt;
    }
    return compilation.compiled;
  }
}

// How long an entry is answered from memory without a revalidation, however
// quiet the signals are. It is the same five seconds the live search cache
// allows a result whose dependency it cannot see, for the same reason: it is
// the staleness bound for what the signals miss. A revalidation is one narrow
// index read plus the definition lookups, and a steady stream of reads pays it
// once per interval rather than once per read.
const MAX_UNVALIDATED_MS = 5_000;

// Every realm's policy cache in this process. A move in one realm has to
// reach a cache held by another realm, and a realm server mounts realms
// lazily, so the realm whose index moved may not be mounted here at all. Held
// weakly, so a cache goes when its realm does. A cache registers when it
// first compiles, so a realm with no policy is never here.
const policyCaches = new Set<WeakHandle<RealmPolicyCache>>();

// `WeakRef`, reached without naming its type. `packages/postgres` typechecks
// the realm, and so this module, under a `lib` that predates it. Every runtime
// the realm runs in has it.
interface WeakHandle<T> {
  deref(): T | undefined;
}
const WeakRefConstructor = (
  globalThis as unknown as {
    WeakRef: new <T extends object>(target: T) => WeakHandle<T>;
  }
).WeakRef;

// The index of the realm at `realmURL` has moved: its index swapped, here or on
// a peer. Every compiled policy in the process that reads from that realm is
// revalidated.
export function noteRealmIndexMoved(realmURL: string): void {
  for (let ref of policyCaches) {
    let cache = ref.deref();
    if (!cache) {
      policyCaches.delete(ref);
      continue;
    }
    cache.indexMoved(realmURL);
  }
}

interface Compilation {
  compiled: CompiledRealmPolicy;
  // What the card's row was when this was compiled, in the terms
  // `rowIdentity` states it.
  row: string;
  // Fingerprints of the definitions that the rules' types resolved to, keyed
  // by code ref. A missing fingerprint marks a type with no definition.
  definitions: Map<string, { codeRef: ResolvedCodeRef; fingerprint?: string }>;
  // URLs whose realm's index moving could change what this compiles to.
  inputs: string[];
}

interface Refresh {
  card: string;
  // The URLs this refresh is known to read so far. The modules its rules
  // name are learned as it compiles.
  inputs: string[];
  // Every realm whose index moved while this ran.
  moved: string[];
}

function readsFrom(inputs: string[], realmURL: string): boolean {
  return inputs.some((input) => input.startsWith(realmURL));
}

// Everything in a policy card's row that compiling reads, as one fingerprint.
// The source fingerprint alone is not enough: a row reindexed from unchanged
// bytes keeps its `meta.version`, yet a changed card definition can change the
// adoption chain the row records and the attributes it serialized. Either one
// changes what the policy compiles to.
function rowIdentity(row: IndexedInstanceSource | undefined): string {
  if (!row) {
    return 'missing';
  }
  return computeContentHash(
    stableStringify({
      version: row.sourceContentHash,
      error: row.error?.message,
      types: row.types,
      rules: (row.instance?.attributes as { rules?: unknown } | undefined)
        ?.rules,
    }) ?? '',
  );
}

async function stillCurrent(
  compilation: Compilation,
  row: IndexedInstanceSource | undefined,
  env: PolicyCompileEnvironment,
): Promise<boolean> {
  if (rowIdentity(row) !== compilation.row) {
    return false;
  }
  for (let { codeRef, fingerprint } of compilation.definitions.values()) {
    if ((await definitionFingerprint(codeRef, env)) !== fingerprint) {
      return false;
    }
  }
  return true;
}

// The definition's fingerprint, or undefined when the type has no definition.
// Only the lookup's own "no such type" counts as that. Any other failure, a
// database or network error, is thrown: the read fails and nothing is kept, so
// the next read tries again. Kept as a missing type, it would drop the rule
// until something next moved in that type's realm.
async function definitionFingerprint(
  codeRef: ResolvedCodeRef,
  env: PolicyCompileEnvironment,
): Promise<string | undefined> {
  return (await fingerprintedDefinition(codeRef, env))?.fingerprint;
}

async function fingerprintedDefinition(
  codeRef: ResolvedCodeRef,
  env: PolicyCompileEnvironment,
): Promise<{ definition: Definition; fingerprint: string } | undefined> {
  let definition: Definition;
  try {
    definition = await env.lookupDefinition(codeRef);
  } catch (e: unknown) {
    if (isFilterRefersToNonexistentTypeError(e)) {
      return undefined;
    }
    throw e;
  }
  return {
    definition,
    fingerprint: computeContentHash(stableStringify(definition) ?? ''),
  };
}

async function compilePolicy(
  card: string,
  row: IndexedInstanceSource | undefined,
  env: PolicyCompileEnvironment,
  onInput: (url: string) => void,
): Promise<Compilation> {
  let issues: PolicyIssue[] = [];
  let definitions: Compilation['definitions'] = new Map();
  let inputs = [card];
  let rules: CompiledPolicyRule[] = [];
  let issue = (code: PolicyIssueCode, path: string, message: string) =>
    issues.push({ code, path, message });
  let compiled = (): Compilation => ({
    compiled: {
      card,
      version: row?.sourceContentHash ?? undefined,
      rules,
      issues,
    },
    row: rowIdentity(row),
    definitions,
    inputs,
  });

  // A type's definition, recorded as an input of this compilation: a change to
  // the definition, or to the realm whose module defines the type, is a change
  // to what the policy compiles to. The types a rule names are read here, and
  // so is every type a search filter's field path crosses into.
  let readDefinition = async (
    codeRef: ResolvedCodeRef,
  ): Promise<Definition | undefined> => {
    let moduleURL = safeURL(codeRef.module, env);
    if (moduleURL && !inputs.includes(moduleURL)) {
      inputs.push(moduleURL);
      onInput(moduleURL);
    }
    let found = await fingerprintedDefinition(codeRef, env);
    definitions.set(`${codeRef.module}#${codeRef.name}`, {
      codeRef,
      fingerprint: found?.fingerprint,
    });
    return found?.definition;
  };
  // A grant on a query carries the search filter its predicate compiles to,
  // or has none and records why. No other grant carries one.
  let withFilter = async (
    grant: CompiledOperationGrant,
    predicate: unknown,
    targetType: ResolvedCodeRef,
    definition: Definition,
    grantPath: string,
  ): Promise<CompiledOperationGrant> => {
    if (!isQueryGrant(grant.operation, definition)) {
      return grant;
    }
    let parser = await loadBxl();
    let outcome = await compilePolicyFilter(targetType, definition, predicate, {
      lookupDefinition: readDefinition,
      validateBxlAst: (node, options) => parser.validateBxlAst(node, options),
    });
    if ('problem' in outcome) {
      issue(
        'policy-not-filterable',
        `${grantPath}.where`,
        `the grant is on a query, and its \`where\` does not compile to a search filter: ${outcome.problem}`,
      );
      return grant;
    }
    return { ...grant, filter: outcome.filter };
  };

  if (!row) {
    issue(
      'policy-card-missing',
      '',
      `the realm's policy card ${card} is not in the index`,
    );
    return compiled();
  }
  if (!row.instance) {
    issue(
      'policy-card-unloadable',
      '',
      `the realm's policy card ${card} did not load: ${row.error?.message}`,
    );
    return compiled();
  }
  if (!attempt(() => env.isPolicyCard(row.types ?? []))) {
    issue(
      'not-a-policy',
      '',
      `the realm's policy card ${card} is not a RealmPolicy`,
    );
    return compiled();
  }

  let authored = row.instance.attributes?.rules;
  if (authored != null && !Array.isArray(authored)) {
    issue('invalid-rule', 'rules', '`rules` is not a list');
    return compiled();
  }
  let cardURL = new URL(card);
  for (let [ruleIndex, rule] of (authored ?? []).entries()) {
    let rulePath = `rules[${ruleIndex}]`;
    let targetType = asCodeRef(rule?.targetType);
    if (!targetType) {
      issue(
        'invalid-rule',
        `${rulePath}.targetType`,
        '`targetType` is not a code ref with a module and a name',
      );
      continue;
    }
    let resolved = attempt(() => env.resolveCodeRef(targetType, cardURL));
    if (!resolved) {
      issue(
        'unresolved-type',
        `${rulePath}.targetType`,
        `\`targetType\` ${targetType.name} from ${targetType.module} does not resolve against the policy card`,
      );
      continue;
    }
    let definition = await readDefinition(resolved);
    if (!definition) {
      issue(
        'unresolved-type',
        `${rulePath}.targetType`,
        `no definition of ${resolved.name} was found in ${resolved.module}`,
      );
      continue;
    }

    let grants: CompiledOperationGrant[] = [];
    let authoredGrants = rule?.grants ?? [];
    if (!Array.isArray(authoredGrants)) {
      issue('invalid-rule', `${rulePath}.grants`, '`grants` is not a list');
      continue;
    }
    for (let [grantIndex, grant] of authoredGrants.entries()) {
      let grantPath = `${rulePath}.grants[${grantIndex}]`;
      let operation = grant?.operation;
      if (typeof operation !== 'string' || operation.length === 0) {
        issue(
          'invalid-grant',
          `${grantPath}.operation`,
          'the grant names no operation',
        );
        continue;
      }
      let where = readPredicate(grant?.where);
      if (where === 'malformed') {
        issue(
          'invalid-grant',
          `${grantPath}.where`,
          '`where` is neither BXL source nor `{ bxl, snapshot }`',
        );
        continue;
      }
      if (!where) {
        grants.push(
          await withFilter(
            { operation },
            undefined,
            resolved,
            definition,
            grantPath,
          ),
        );
        continue;
      }
      let outcome = await compilePredicate(where.source);
      if ('problem' in outcome) {
        issue('invalid-predicate', `${grantPath}.where`, outcome.problem);
        continue;
      }
      grants.push(
        await withFilter(
          {
            operation,
            where: {
              source: where.source,
              canonical: outcome.canonical,
              snapshot: where.snapshot,
            },
          },
          outcome.body,
          resolved,
          definition,
          grantPath,
        ),
      );
    }
    rules.push({ targetType: resolved, grants });
  }
  return compiled();
}

// Whether a grant is on a query: the base `query`, which a search with a
// filter of the caller's own is authorized under, or a named operation the
// rule's type declares on it.
function isQueryGrant(operation: string, definition: Definition): boolean {
  let declared =
    definition.operations &&
    Object.prototype.hasOwnProperty.call(definition.operations, operation)
      ? definition.operations[operation]
      : undefined;
  return (declared?.base ?? operation) === 'query';
}

function asCodeRef(
  value: unknown,
): { module: string; name: string } | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  let { module, name } = value as { module?: unknown; name?: unknown };
  return typeof module === 'string' && typeof name === 'string'
    ? { module, name }
    : undefined;
}

function safeURL(
  identifier: string,
  env: PolicyCompileEnvironment,
): string | undefined {
  return attempt(() => env.toURL(identifier).href);
}

// What `fn` answers, or undefined when it throws. Compiling records a problem
// with the policy as an issue rather than throwing it, and a value that cannot
// be resolved is a problem with the policy, so the step that needed it counts
// as having found nothing.
function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// A `where` as the policy card stores it: a bare string of BXL source, or
// `{ bxl, snapshot: true }` for a predicate that reads a snapshot tier. Absent
// or null means the grant has no condition.
function readPredicate(
  value: unknown,
): { source: string; snapshot: boolean } | undefined | 'malformed' {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return { source: value, snapshot: false };
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    let { bxl, snapshot } = value as { bxl?: unknown; snapshot?: unknown };
    if (
      typeof bxl === 'string' &&
      (snapshot === undefined || typeof snapshot === 'boolean')
    ) {
      return { source: bxl, snapshot: snapshot === true };
    }
  }
  return 'malformed';
}

// The request-context calls a policy predicate reads: who is asking, the card
// it asks about, and the governed realm's own settings. The `policy` profile
// denies every request-context call, because a request's payload is not an
// authorization input. A predicate is still written against its caller and its
// target, so these three are admitted. `params()` is not admitted. It reads
// the payload, and a caller-supplied value must not decide its own
// authorization.
//
// The profile reports a denied call only in its message, so the exception is
// matched there. If that wording changes, nothing matches. The calls are then
// refused rather than admitted, so a drift fails closed.
const ADMITTED_CALL_DENIAL =
  / does not allow call (?:actor|instance|realmConfig):/;

async function compilePredicate(
  source: string,
): Promise<{ canonical: string; body: unknown } | { problem: string }> {
  let bxl = await loadBxl();
  let program;
  try {
    program = bxl.parseBxlAst(source, { profile: 'policy' });
  } catch (e: unknown) {
    return {
      problem: `\`where\` does not parse: ${e instanceof Error ? e.message : String(e)}`,
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
  // A `where` with nothing in it parses to a program with no body, which the
  // profile has nothing to refuse. It is not a grant with no condition: that
  // is written by leaving `where` out, and an empty one is what an editor
  // leaves behind when the predicate is cleared. Read as unconditional, it
  // would widen access on a slip.
  if (program.body == null) {
    return {
      problem: '`where` is empty; a grant with no condition leaves `where` out',
    };
  }
  if (refusals.length > 0) {
    return {
      problem: `the \`policy\` profile refuses \`where\`: ${refusals
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join('; ')}`,
    };
  }
  return { canonical: program.canonicalSource, body: program.body };
}

// BXL, and the shape of what this module asks of it.
//
// Stated here rather than imported, and loaded through a specifier TypeScript
// cannot follow, for the reason `transforms.ts` gives: this module is reached
// from `runtime-common/realm`, and reaching for `@cardstack/bxl` statically
// would pull its sources into the typecheck program of every package that
// reaches the realm. `bxl-mirror-check.ts` holds this shape against the real
// one.
export interface BxlPolicyParser {
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
  validateBxlAst(
    node: unknown,
    options: { profile: 'predicate' },
  ): {
    code: string;
    severity: 'error' | 'warning';
    message: string;
  }[];
}

let bxl: Promise<BxlPolicyParser> | undefined;

function loadBxl(): Promise<BxlPolicyParser> {
  // The cast is what keeps the specifier opaque to TypeScript; see above.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  bxl ??= import('@cardstack/bxl' as string).then(
    (module) => module as BxlPolicyParser,
  );
  return bxl;
}

const log = logger('realm:policy');
