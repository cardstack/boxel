import { AsyncLocalStorage } from 'node:async_hooks';
import QUnit from 'qunit';
import { IndexQueryEngine } from '@cardstack/runtime-common';
import stringify from 'safe-stable-stringify';

// The value-store paths carry a realm policy's grant when every grant that
// admits the caller admits every card of a type (store-grant.ts in
// runtime-common's query engine). This holds every policy-scoped search a
// suite runs to the general read's answer: each engine search that carries a
// `grantFilter` runs twice, once told to read its grants the general way
// (`grantsOnGeneralPath`) and once as it would, and the two answers (rows,
// totals, facets, facet statistics and every other member of the result)
// must be identical. A difference fails the test that ran the search.
//
// It also records, for each such search, whether a store path carried the
// grant, so a suite can say which of its searches the store answered.

export interface PolicyStoreObservation {
  // policy-scoped searches compared, and how many a store path carried
  compared: number;
  carried: number;
  // each difference, as the search and the two answers
  mismatches: string[];
  // per search compared, in order: whether a store path carried its grant
  searches: { carried: boolean }[];
}

type AnyFn = (...args: any[]) => Promise<any>;

interface Patched {
  observation: PolicyStoreObservation;
  restore: () => void;
}

const engineProto = IndexQueryEngine.prototype as unknown as Record<
  string,
  AnyFn
>;

// Installs the comparison on every engine until `restore` is called.
export function comparePolicyStorePaths(): Patched {
  let observation: PolicyStoreObservation = {
    compared: 0,
    carried: 0,
    mismatches: [],
    searches: [],
  };
  let originals = {
    search: engineProto.search,
    searchColumns: engineProto.searchColumns,
    storeScope: engineProto.storeScope,
  };
  // The scopes the store paths read, for the compared search running in
  // this async context; set within one, so its own reads are not compared
  // again.
  let running = new AsyncLocalStorage<{ grant: boolean }[]>();
  engineProto.storeScope = async function (
    this: unknown,
    filter: unknown,
    realmURL: URL,
    opts: { grantFilter?: unknown; grantsOnGeneralPath?: true },
  ) {
    let scope = await originals.storeScope.call(this, filter, realmURL, opts);
    let scopes = running.getStore();
    if (scopes && opts?.grantFilter && !opts.grantsOnGeneralPath) {
      scopes.push({ grant: Boolean(scope?.grant) });
    }
    return scope;
  };
  let wrap = (name: 'search' | 'searchColumns', optsAt: number): AnyFn =>
    async function (this: unknown, ...args: any[]) {
      let original = originals[name];
      let opts = args[optsAt] as
        | { grantFilter?: unknown; grantsOnGeneralPath?: true }
        | undefined;
      // Only the outermost search of a policy-scoped request: the reads it
      // makes of its own are compared as part of it.
      if (
        !opts?.grantFilter ||
        opts.grantsOnGeneralPath ||
        running.getStore()
      ) {
        return await original.apply(this, args);
      }
      let generalArgs = [...args];
      generalArgs[optsAt] = { ...opts, grantsOnGeneralPath: true };
      let general: unknown;
      let generalError: unknown;
      try {
        general = await running.run([], () =>
          original.apply(this, generalArgs),
        );
      } catch (e) {
        generalError = e;
      }
      let read: { grant: boolean }[] = [];
      let found: unknown;
      let foundError: unknown;
      try {
        found = await running.run(read, () => original.apply(this, args));
      } catch (e) {
        foundError = e;
      }
      let carried = read.some((s) => s.grant);
      observation.compared++;
      if (carried) {
        observation.carried++;
      }
      observation.searches.push({ carried });
      let answer = (value: unknown, error: unknown): string =>
        error !== undefined
          ? `error: ${String((error as Error)?.message ?? error)}`
          : (stringify(value) ?? 'undefined');
      let a = answer(general, generalError);
      let b = answer(found, foundError);
      if (a !== b) {
        let message =
          `a policy-scoped ${name} answered differently on the value-store path` +
          ` (query ${String(stringify(args[1])).slice(0, 600)}):\n` +
          `  general: ${a.slice(0, 2000)}\n  store:   ${b.slice(0, 2000)}`;
        observation.mismatches.push(message);
        throw new Error(message);
      }
      if (foundError !== undefined) {
        throw foundError;
      }
      return found;
    };
  engineProto.search = wrap('search', 2);
  engineProto.searchColumns = wrap('searchColumns', 2);
  return {
    observation,
    restore() {
      engineProto.search = originals.search;
      engineProto.searchColumns = originals.searchColumns;
      engineProto.storeScope = originals.storeScope;
    },
  };
}

// For a QUnit module: every policy-scoped search its tests run is compared,
// and a test whose searches differ fails, with the difference. A test whose
// searches all agree gains no assertion, so `assert.expect` counts hold.
//
// `except` names tests that count the statements or index reads a search
// makes, which the second read doubles; their searches are not compared.
export function setupPolicyStoreDifferential(
  hooks: NestedHooks,
  { except = [] }: { except?: string[] } = {},
): PolicyStoreObservation {
  let current: Patched | undefined;
  let total: PolicyStoreObservation = {
    compared: 0,
    carried: 0,
    mismatches: [],
    searches: [],
  };
  hooks.beforeEach(function () {
    let name = QUnit.config.current?.testName;
    if (name !== undefined && except.includes(name)) {
      return;
    }
    current = comparePolicyStorePaths();
  });
  hooks.afterEach(function (assert) {
    let patched = current;
    current = undefined;
    patched?.restore();
    if (!patched) {
      return;
    }
    let { observation } = patched;
    total.compared += observation.compared;
    total.carried += observation.carried;
    total.searches.push(...observation.searches);
    total.mismatches.push(...observation.mismatches);
    for (let message of observation.mismatches) {
      assert.pushResult({
        result: false,
        actual: message,
        expected: 'the general read’s answer',
        message: 'a policy-scoped search answers as the general read does',
      });
    }
  });
  hooks.after(function () {
    console.log(
      `# policy-store differential: ${QUnit.config.current?.module?.name ?? ''}: ${total.compared} policy-scoped searches compared, ${total.carried} carried by a store path, ${total.mismatches.length} differences`,
    );
  });
  return total;
}
