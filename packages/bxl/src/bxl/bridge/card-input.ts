// How Boxel cards become the value a BXL expression reads.
//
// A card graph is legitimately cyclic — a Claim links to a Policy whose
// query-backed `claims` contains that same Claim — while jq's data model
// is JSON: acyclic by construction, with no native cycle detection. This
// module is the boundary between the two:
//
// - `materializeCardInput` wraps the compute target in a lazy view that
//   materializes fields only as the program touches them. Path access
//   (`.claims[0].paidAmount`) costs the fields it reads plus each
//   traversed card's `id` (the cycle guard consults it), and
//   structural operations (`unique`, `tojson`, `==`, `to_entries`)
//   enumerate a card's field map on demand instead of seeing an opaque
//   empty object. Re-entering a value already on the current traversal
//   path — the definition of a cycle — produces a bounded `{ id }`
//   reference instead of recursing, the same clip the platform's
//   `queryableValue` applies when it builds search docs. A depth cap
//   backstops pathological acyclic graphs with a clear error.
// - `unwrapMaterializedCardInput` restores raw values on the way out, so
//   program outputs — and everything downstream of them: memoization,
//   `{ as }` materialization, the serializer — never hold a lazy view.
//
// The Boxel field metadata itself arrives out-of-band. This module does
// not import `https://cardstack.com/base/card-api`, because Node's ESM
// loader rejects `https:` schemes at module-load time — a static import
// would break every consumer that runs outside a realm (tests, tooling,
// the realm-server). Two bridges exist, tried in order:
//
// 1. Instance-carried: card-api stamps its own `getFields` onto
//    `BaseDef.prototype` under the cross-realm symbol below, so a value
//    made by any card-api copy resolves the copy that created it —
//    correct even when several loader universes are alive at once.
// 2. `globalThis.__cardstackGetFields`: the ambient fallback a host
//    registers, for values that carry no stamp. For a card-api instance
//    (marked with the registered `isBaseInstance` symbol) this fallback
//    is ambiguous — the ambient copy may not be the one that created the
//    value — so that case logs a one-time warning. Plain classes resolve
//    through the ambient copy silently: their field map is empty either
//    way, and the plain-copy fallback is their intended behavior.
//
// Absent both, the field-aware paths degrade rather than throw.

import { checkRuntimeBudget } from '../../jqtools/evaluate/runtimeState.ts';

export type GetFieldsFn = (
  instance: unknown,
  options?: { includeComputeds?: boolean },
) => Record<
  string,
  {
    fieldType?: string;
    card?: unknown;
    computeVia?: (...args: unknown[]) => unknown;
  }
>;

export const GET_FIELDS_KEY = '__cardstackGetFields' as const;
const GET_FIELDS_BRIDGE = Symbol.for('cardstack.getFields');
const IS_BASE_INSTANCE = Symbol.for('isBaseInstance');

function getCardstackGetFields(): GetFieldsFn | undefined {
  const fn = (globalThis as unknown as Record<string, unknown>)[GET_FIELDS_KEY];
  return typeof fn === 'function' ? (fn as GetFieldsFn) : undefined;
}

let warnedAmbientGetFields = false;

export function getFieldsFor(value: object): GetFieldsFn | undefined {
  const fn = (value as Record<symbol, unknown>)[GET_FIELDS_BRIDGE];
  if (typeof fn === 'function') {
    return fn as GetFieldsFn;
  }
  const ambient = getCardstackGetFields();
  if (ambient && !warnedAmbientGetFields && IS_BASE_INSTANCE in value) {
    warnedAmbientGetFields = true;
    console.warn(
      '@cardstack/bxl: resolving field metadata for a card-api value ' +
        'through the ambient __cardstackGetFields global because the ' +
        'value carries no instance-scoped bridge. When more than one ' +
        'card-api copy is loaded, the ambient copy may not be the one ' +
        'that created this value, and field-aware materialization can ' +
        'silently degrade.',
    );
  }
  return ambient;
}

export function safeFieldMap(
  value: unknown,
  options?: { includeComputeds?: boolean },
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const getFields = getFieldsFor(value);
  if (!getFields) return null;
  try {
    return getFields(value, {
      includeComputeds: options?.includeComputeds ?? false,
    });
  } catch {
    return null;
  }
}

/**
 * How many nested object hops a single materialization may traverse.
 * The cycle guard already clips every re-entered value, so only a
 * genuinely deep acyclic chain of distinct cards (or deeply nested
 * contained JSON) can approach this — at which point failing with a
 * clear error beats letting the walk churn.
 */
export const MAX_CARD_INPUT_DEPTH = 256;

/** Hands the lazy view's raw target back; see the get trap below. */
const MATERIALIZED_TARGET = Symbol('bxl.materializedCardInputTarget');

/**
 * Whether a value is the lazy view over a card graph. Lazy views only
 * ever descend from a wrapped run input, so a run whose input is not a
 * view cannot produce one in its outputs — callers use this to skip
 * output unwrapping entirely on plain-JSON evaluations.
 */
export function isMaterializedCardInput(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as Record<symbol, unknown>)[MATERIALIZED_TARGET] !== undefined
  );
}

interface AncestorEntry {
  target: object;
  /**
   * The target's `id` at wrap time when the target is a card;
   * `undefined` for non-cards, which never participate in id-based
   * clipping — ordinary JSON is free to carry `id` values that collide
   * with a card's without being that card.
   */
  cardId: unknown;
  /** Property name through which the target was reached, for errors. */
  via: string;
}

function isCard(value: object): boolean {
  return GET_FIELDS_BRIDGE in value || IS_BASE_INSTANCE in value;
}

function idOf(value: object): unknown {
  try {
    return (value as { id?: unknown }).id;
  } catch {
    // An `id` getter that throws (e.g. a not-ready proxy) just means the
    // value can't participate in id-based cycle clipping.
    return undefined;
  }
}

function cardIdOf(value: object): unknown {
  return isCard(value) ? idOf(value) : undefined;
}

function formatPathSegment(via: string): string {
  return /^\d+$/.test(via) ? `[${via}]` : `.${via}`;
}

function describePath(ancestors: AncestorEntry[]): string {
  const segments = ancestors.map((entry) => entry.via);
  // Deep-graph errors would otherwise embed hundreds of segments; the
  // ends are what identify the offending fields.
  const shown =
    segments.length > 12
      ? [...segments.slice(0, 6), '…', ...segments.slice(-5)]
      : segments;
  return shown
    .map((via, index) => (index === 0 ? via : formatPathSegment(via)))
    .join('');
}

function readOnlyViolation(action: string, prop: string | symbol): never {
  throw new TypeError(
    `BXL materialized card inputs are read-only: cannot ${action} ` +
      `property ${String(prop)}`,
  );
}

/**
 * Wrap a compute target in the lazy, cycle-guarded view described in the
 * module docs. Primitives, functions, and non-plain non-card objects
 * (Dates, RegExps, …) pass through untouched.
 */
export function materializeCardInput(value: unknown): unknown {
  return wrapValue(value, [], '$');
}

function wrapValue(
  value: unknown,
  ancestors: AncestorEntry[],
  via: string,
): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Materialization hops count toward the active runtime budget, so
  // `maxSteps` / `maxMillis` bound graph traversal exactly like they
  // bound program evaluation.
  checkRuntimeBudget();

  const cardId = cardIdOf(value);
  for (const ancestor of ancestors) {
    // Cycle guard, mirroring the platform's `queryableValue`: object
    // identity alone misses a logical cycle when the same card re-enters
    // as a different object instance (query resolution producing fresh
    // objects mid-walk), so cards also clip by id. Non-card values clip
    // by identity only.
    if (
      ancestor.target === value ||
      (cardId != null && ancestor.cardId === cardId)
    ) {
      return { id: idOf(value) };
    }
  }

  if (ancestors.length >= MAX_CARD_INPUT_DEPTH) {
    throw new Error(
      `BXL input materialization exceeded ${MAX_CARD_INPUT_DEPTH} nested ` +
        `hops at ${describePath(ancestors)}${formatPathSegment(via)} — the ` +
        `graph is deeper than any cycle-clipped card graph should be`,
    );
  }

  if (Array.isArray(value)) {
    return wrapArray(value, ancestors, via);
  }

  if (isCard(value)) {
    return wrapCard(value, ancestors, via);
  }

  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    return wrapPlainObject(value, ancestors, via);
  }

  // Anything else — Date, RegExp, Map, class instances without field
  // metadata — passes through raw: wrapping would break their
  // brand-checked methods, and they carry no card links to guard.
  return value;
}

function childAncestors(
  target: object,
  ancestors: AncestorEntry[],
  via: string,
): AncestorEntry[] {
  return [...ancestors, { target, cardId: cardIdOf(target), via }];
}

/** Traps shared by every facade: reads forward to the raw target (so
 *  card getters see their real `this`) and wrap what they return;
 *  writes fail loudly rather than silently landing on the facade. */
function commonTraps(
  target: object,
  chain: AncestorEntry[],
): Pick<
  ProxyHandler<object>,
  | 'getPrototypeOf'
  | 'set'
  | 'defineProperty'
  | 'deleteProperty'
  | 'preventExtensions'
> & { readChild(prop: string | symbol): unknown } {
  return {
    readChild(prop: string | symbol) {
      // `Reflect.get` without a receiver binds getters to the raw
      // target — card-api getters key internal state by instance
      // identity, so they must never see the facade as `this`.
      const raw = Reflect.get(target, prop);
      if (typeof prop === 'symbol') {
        return raw;
      }
      return wrapValue(raw, chain, prop);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(target);
    },
    // Writes fail with a branded error naming the view, not the bare
    // "trap returned falsish" TypeError a false return would produce.
    set(_facade, prop) {
      readOnlyViolation('set', prop);
    },
    defineProperty(_facade, prop) {
      readOnlyViolation('define', prop);
    },
    deleteProperty(_facade, prop) {
      readOnlyViolation('delete', prop);
    },
    // A frozen facade would violate the ownKeys invariant on every later
    // read; refuse loudly instead of being silently poisoned.
    preventExtensions() {
      return false;
    },
  };
}

function wrapArray(
  target: unknown[],
  ancestors: AncestorEntry[],
  via: string,
): object {
  const chain = childAncestors(target, ancestors, via);
  const { readChild, ...traps } = commonTraps(target, chain);

  // The facade is an empty array — `Array.isArray` sees through the
  // proxy to it — with no own entries, so no proxy invariant constrains
  // what the traps report (`length` aside, which every array carries).
  return new Proxy([] as unknown[], {
    ...traps,
    get(_facade, prop) {
      if (prop === MATERIALIZED_TARGET) {
        return target;
      }
      return readChild(prop);
    },
    has(_facade, prop) {
      return Reflect.has(target, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_facade, prop) {
      if (prop === 'length') {
        // Mirror the facade's own `length` shape (non-configurable,
        // writable) with the target's value, as the invariant requires.
        return {
          value: target.length,
          writable: true,
          enumerable: false,
          configurable: false,
        };
      }
      const desc = Reflect.getOwnPropertyDescriptor(target, prop);
      if (!desc) {
        return undefined;
      }
      return {
        enumerable: desc.enumerable ?? true,
        configurable: true,
        get: () => readChild(prop),
      };
    },
  });
}

function wrapCard(
  target: object,
  ancestors: AncestorEntry[],
  via: string,
): object {
  const chain = childAncestors(target, ancestors, via);
  const { readChild, ...traps } = commonTraps(target, chain);

  // Resolved on first enumeration only — pure path access never pays
  // for the field map. Computeds are included: an expression aggregating
  // over another card sees that card as its search doc would.
  let fieldKeys: string[] | null | undefined;
  const resolveFieldKeys = () => {
    if (fieldKeys === undefined) {
      const map = safeFieldMap(target, { includeComputeds: true });
      const keys = map ? Object.keys(map) : [];
      fieldKeys = keys.length > 0 ? keys : null;
    }
    return fieldKeys;
  };

  return new Proxy(
    {},
    {
      ...traps,
      get(_facade, prop) {
        if (prop === MATERIALIZED_TARGET) {
          return target;
        }
        return readChild(prop);
      },
      has(_facade, prop) {
        if (typeof prop === 'string' && resolveFieldKeys()?.includes(prop)) {
          return true;
        }
        return Reflect.has(target, prop);
      },
      ownKeys() {
        // Field keys are what jq enumeration should see; the target's own
        // keys ride along to satisfy anyone introspecting the raw shape.
        const own = Reflect.ownKeys(target);
        const keys = resolveFieldKeys();
        if (!keys) {
          return own;
        }
        const seen = new Set(own);
        return [...own, ...keys.filter((key) => !seen.has(key))];
      },
      getOwnPropertyDescriptor(_facade, prop) {
        const desc = Reflect.getOwnPropertyDescriptor(target, prop);
        const isField =
          typeof prop === 'string' && !!resolveFieldKeys()?.includes(prop);
        if (!desc && !isField) {
          return undefined;
        }
        return {
          enumerable: isField ? true : (desc?.enumerable ?? true),
          configurable: true,
          get: () => readChild(prop),
        };
      },
    },
  );
}

function wrapPlainObject(
  target: object,
  ancestors: AncestorEntry[],
  via: string,
): object {
  const chain = childAncestors(target, ancestors, via);
  const { readChild, ...traps } = commonTraps(target, chain);

  return new Proxy(
    {},
    {
      ...traps,
      get(_facade, prop) {
        if (prop === MATERIALIZED_TARGET) {
          return target;
        }
        return readChild(prop);
      },
      has(_facade, prop) {
        return Reflect.has(target, prop);
      },
      ownKeys() {
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(_facade, prop) {
        const desc = Reflect.getOwnPropertyDescriptor(target, prop);
        if (!desc) {
          return undefined;
        }
        return {
          enumerable: desc.enumerable ?? true,
          configurable: true,
          get: () => readChild(prop),
        };
      },
    },
  );
}

/**
 * Deep-replace lazy views with their raw targets in a program output.
 * jq-built containers (plain objects and arrays) are walked; a lazy view
 * ends its branch — its raw target is the original graph, already in its
 * final shape. Values that were never wrapped come back unchanged, so
 * this is a no-op for programs evaluated over plain JSON.
 */
export function unwrapMaterializedCardInput(value: unknown): unknown {
  return unwrap(value, new Map());
}

function unwrap(value: unknown, memo: Map<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const target = (value as Record<symbol, unknown>)[MATERIALIZED_TARGET];
  if (target !== undefined) {
    return target;
  }
  // Aliasing: a container jq binds once and embeds several times must
  // resolve to ONE unwrapped result, or later occurrences would keep
  // their lazy views.
  if (memo.has(value)) {
    return memo.get(value);
  }
  // Pre-register the identity mapping so a cycle in a raw (never-wrapped)
  // graph — reachable through the general-purpose entry points — resolves
  // to the original object instead of recursing. Containers that embed a
  // lazy view are jq-built and therefore acyclic, so for them this
  // placeholder is always overwritten with the rebuilt form below.
  memo.set(value, value);

  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((entry) => {
      const unwrapped = unwrap(entry, memo);
      changed ||= unwrapped !== entry;
      return unwrapped;
    });
    const result = changed ? out : value;
    memo.set(value, result);
    return result;
  }

  if (Object.getPrototypeOf(value) === Object.prototype) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const unwrapped = unwrap(entry, memo);
      changed ||= unwrapped !== entry;
      out[key] = unwrapped;
    }
    const result = changed ? out : value;
    memo.set(value, result);
    return result;
  }

  return value;
}
