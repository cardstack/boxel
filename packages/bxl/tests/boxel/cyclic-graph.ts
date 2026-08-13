// Cyclic-graph materialization suite.
//
// A Boxel card graph is legitimately cyclic — a Claim links to a Policy
// whose query-backed `claims` contains that same Claim — while jq's data
// model is acyclic JSON. The computeVia factory bridges the two with a
// lazy, cycle-guarded view of the compute target (see
// `src/bxl/bridge/card-input.ts`). This suite pins that contract:
//
//   - re-entering a value on the traversal path yields a bounded `{ id }`
//     reference (by object identity AND by id, so a fresh instance of an
//     already-visited card clips too);
//   - structural operations (`unique`, `==`, `tojson`, `keys`) terminate
//     on cyclic graphs and see a card's real field map, not an opaque
//     empty object;
//   - program outputs are unwrapped back to raw values — identity with
//     the underlying graph is preserved for downstream consumers;
//   - the depth cap and the runtime budget fail fast with clear errors
//     instead of unbounded churn.

import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert';
import { expression, jq, fx } from '../../src/index.ts';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
  } catch (error) {
    fail++;
    failures.push(`  ${name}\n    ${(error as Error).message.split('\n')[0]}`);
  }
}

// ------------------------------------------------------------------ Card stand-ins
//
// Mimics card-api's shape: field state lives outside the instance (here a
// private field), fields read through prototype getters, and the class
// hierarchy carries the `getFields` stamp under the cross-realm symbol.
// The private-field access doubles as a canary: if materialization ever
// binds a getter to its facade instead of the raw instance, the brand
// check throws.

const GET_FIELDS_BRIDGE = Symbol.for('cardstack.getFields');

type FieldMap = Record<string, { fieldType: string; card?: unknown }>;
const fieldMaps = new Map<unknown, FieldMap>();

abstract class StubBase {
  abstract get id(): string | undefined;
}
Object.defineProperty(StubBase.prototype, GET_FIELDS_BRIDGE, {
  value: (instance: object) => fieldMaps.get(instance.constructor) ?? {},
  enumerable: false,
});

interface ClaimState {
  id: string;
  claimStatus: string;
  paidAmount: number;
  policy: () => unknown;
}

class ClaimStub extends StubBase {
  #state: ClaimState;
  constructor(state: ClaimState) {
    super();
    this.#state = state;
  }
  get id() {
    return this.#state.id;
  }
  get claimStatus() {
    return this.#state.claimStatus;
  }
  get paidAmount() {
    return this.#state.paidAmount;
  }
  get policy() {
    return this.#state.policy();
  }
}
fieldMaps.set(ClaimStub, {
  id: { fieldType: 'contains' },
  claimStatus: { fieldType: 'contains' },
  paidAmount: { fieldType: 'contains' },
  policy: { fieldType: 'linksTo' },
});

interface PolicyState {
  id: string;
  annualPremium: number;
  claims: ClaimStub[];
}

class PolicyStub extends StubBase {
  #state: PolicyState;
  constructor(state: PolicyState) {
    super();
    this.#state = state;
  }
  get id() {
    return this.#state.id;
  }
  get annualPremium() {
    return this.#state.annualPremium;
  }
  get claims() {
    return this.#state.claims;
  }
}
fieldMaps.set(PolicyStub, {
  id: { fieldType: 'contains' },
  annualPremium: { fieldType: 'contains' },
  claims: { fieldType: 'linksToMany' },
});

/** A Policy whose claims all link back to it — a true reference cycle. */
function makeCyclicPolicy(
  claimSpecs: Array<Pick<ClaimState, 'id' | 'claimStatus' | 'paidAmount'>>,
  policyFor?: (policy: PolicyStub) => () => unknown,
) {
  const state: PolicyState = { id: 'pol-1', annualPremium: 12000, claims: [] };
  const policy = new PolicyStub(state);
  const backEdge = policyFor ? policyFor(policy) : () => policy;
  state.claims = claimSpecs.map(
    (spec) => new ClaimStub({ ...spec, policy: backEdge }),
  );
  return policy;
}

const run = (source: string, self: object) => {
  const strings = Object.assign([source], {
    raw: [source],
  }) as unknown as TemplateStringsArray;
  return expression(jq(strings)).call(self);
};

// ------------------------------------------------------------------ Bounded { id } references

check('walking the back-edge yields a bounded { id } reference', () => {
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
  ]);
  deepStrictEqual(run('.claims[0].policy', policy), { id: 'pol-1' });
});

check('fields beyond the clip read as null, id stays reachable', () => {
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
  ]);
  strictEqual(run('.claims[0].policy.id', policy), 'pol-1');
  strictEqual(run('.claims[0].policy.annualPremium', policy), null);
});

check('a fresh instance of a visited card clips by id', () => {
  // Query resolution can hand back a different object for the same card
  // mid-walk; identity alone would miss that cycle.
  const policy = makeCyclicPolicy(
    [{ id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 }],
    (original) => () =>
      new PolicyStub({
        id: original.id!,
        annualPremium: original.annualPremium,
        claims: original.claims,
      }),
  );
  deepStrictEqual(run('.claims[0].policy', policy), { id: 'pol-1' });
});

check('a diamond is not a cycle: shared values materialize fully', () => {
  // Two claims sharing one policy is re-entry only along a single path;
  // reads that do not loop back are untouched.
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
    { id: 'clm-2', claimStatus: 'Closed', paidAmount: 780 },
  ]);
  deepStrictEqual(run('[.claims[] | .paidAmount]', policy), [3200, 780]);
  strictEqual(run('[.claims[] | .paidAmount] | add', policy), 3980);
});

// ------------------------------------------------------------------ Structural operations

check('unique distinguishes cards by materialized fields', () => {
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
    { id: 'clm-2', claimStatus: 'Closed', paidAmount: 780 },
  ]);
  strictEqual(run('[.claims[]] | unique | length', policy), 2);
});

check('equality compares materialized fields across the cycle', () => {
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
    { id: 'clm-2', claimStatus: 'Closed', paidAmount: 780 },
  ]);
  strictEqual(
    run('if (.claims[0]) == (.claims[1]) then 1 else 0 end', policy),
    0,
  );
  strictEqual(
    run('if (.claims[0]) == (.claims[0]) then 1 else 0 end', policy),
    1,
  );
});

check('keys enumerates the card field map', () => {
  const policy = makeCyclicPolicy([]);
  deepStrictEqual(run('keys', policy), ['annualPremium', 'claims', 'id']);
});

check('tojson terminates, embedding the bounded reference', () => {
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
  ]);
  // Rooted at the claim: its policy is a first visit and materializes in
  // full; the policy's claims loop back to the claim, which clips there.
  const doc = JSON.parse(run('tojson', policy.claims[0]) as string) as {
    id: string;
    policy: { id: string; claims: Array<{ id: string; policy: unknown }> };
  };
  strictEqual(doc.id, 'clm-1');
  strictEqual(doc.policy.id, 'pol-1');
  deepStrictEqual(doc.policy.claims, [{ id: 'clm-1' }]);
});

check('a walk rooted at the cycle owner clips its own re-entry', () => {
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
  ]);
  const doc = JSON.parse(run('.claims[0] | tojson', policy) as string) as {
    id: string;
    policy: unknown;
  };
  strictEqual(doc.id, 'clm-1');
  // The traversal began at the policy, so the claim's back-edge is
  // already a re-entry.
  deepStrictEqual(doc.policy, { id: 'pol-1' });
});

check('plain-object cycles terminate too', () => {
  // The general guard also covers non-card values that alias each other.
  interface Node {
    name: string;
    next: Node | null;
  }
  const a: Node = { name: 'a', next: null };
  const b: Node = { name: 'b', next: a };
  a.next = b;
  const doc = JSON.parse(run('tojson', a) as string) as {
    next: { next: { id: undefined } };
  };
  strictEqual(doc.next.next.id, undefined);
});

// ------------------------------------------------------------------ Output unwrapping

check('outputs hand back the raw graph, not the lazy view', () => {
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
  ]);
  strictEqual(run('.', policy), policy);
  strictEqual(run('.claims', policy), policy.claims);
  strictEqual(run('.claims[0]', policy), policy.claims[0]);
});

check('outputs nested in jq-built containers unwrap as well', () => {
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
  ]);
  const out = run('{ first: .claims[0], count: 1 }', policy) as {
    first: unknown;
    count: number;
  };
  strictEqual(out.first, policy.claims[0]);
  strictEqual(out.count, 1);
});

check('fx expressions read through the view unchanged', () => {
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
  ]);
  strictEqual(expression(fx`ROUND(AnnualPremium / 12, 2)`).call(policy), 1000);
});

// ------------------------------------------------------------------ Fail-fast backstops

check('a graph deeper than the cap fails with a clear error', () => {
  interface Deep {
    child: Deep | null;
  }
  const root: Deep = { child: null };
  let cursor = root;
  for (let i = 0; i < 300; i++) {
    cursor.child = { child: null };
    cursor = cursor.child;
  }
  throws(
    () => run('tojson', root),
    (error: Error) => {
      match(error.message, /exceeded 256 nested\s+hops/);
      return true;
    },
  );
});

check('materialization hops count toward the runtime step budget', () => {
  const policy = makeCyclicPolicy(
    Array.from({ length: 200 }, (_, i) => ({
      id: `clm-${i}`,
      claimStatus: 'Open',
      paidAmount: i,
    })),
  );
  const strings = Object.assign(['. | tojson | length'], {
    raw: ['. | tojson | length'],
  }) as unknown as TemplateStringsArray;
  const compute = expression(jq(strings), {
    runtimeLimits: { maxSteps: 50 },
  });
  throws(
    () => compute.call(policy),
    (error: Error) => {
      match(error.message, /step runtime limit/);
      return true;
    },
  );
});

check('getters bind the raw instance, never the facade', () => {
  // ClaimStub/PolicyStub read state through a private field; a getter
  // invoked with the facade as `this` would fail its brand check. Any
  // value coming back proves the binding.
  const policy = makeCyclicPolicy([
    { id: 'clm-1', claimStatus: 'Open', paidAmount: 3200 },
  ]);
  strictEqual(run('.claims[0].paidAmount', policy), 3200);
});

check('values without field metadata pass through raw', () => {
  const when = new Date('2026-01-15T00:00:00Z');
  const holder = { when };
  ok(run('.when', holder) === when);
});

console.log(
  `BXL Boxel cyclic-graph materialization: ${pass}/${pass + fail} cases passed`,
);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
