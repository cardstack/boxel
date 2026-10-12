// ============================================================================
// The caller who isn't signed in, as a policy reads them.
//
// Such a caller's `actor()` is the fixed text `"anonymous"`. A grant opens to
// them only where its `where` says so: it compares `actor()` with that text in
// a way that can hold for them. Everything here reads a predicate's syntax
// tree, so the rule is settled when the policy compiles.
// ============================================================================

// What `actor()` answers for a caller who isn't signed in. It isn't a Matrix
// user id, so no signed-in caller can ever be it.
export const ANONYMOUS_ACTOR = 'anonymous';

// Whether a grant whose `where` is `body` opens to callers who aren't signed
// in. It does where the predicate compares `actor()` with the fixed anonymous
// value, and where that comparison can hold for such a caller. A card field
// that happens to hold that text names no caller, and a comparison that only
// ever keeps such a caller out, such as `actor() != "anonymous"`, guards a
// grant written for signed-in callers rather than opening it to anyone else.
export function namesAnonymous(
  bxl: { visitBxlAst(node: unknown, visitor: (node: unknown) => void): void },
  body: unknown,
): boolean {
  return (
    comparesActorWithAnonymous(bxl, body) &&
    settleActor(body, 'anonymous') !== false
  );
}

function comparesActorWithAnonymous(
  bxl: { visitBxlAst(node: unknown, visitor: (node: unknown) => void): void },
  body: unknown,
): boolean {
  let found = false;
  bxl.visitBxlAst(body, (node) => {
    let { type, operator, left, right } = node as {
      type?: unknown;
      operator?: unknown;
      left?: unknown;
      right?: unknown;
    };
    if (
      type === 'binary' &&
      (operator === '==' || operator === '!=') &&
      ((isActorCall(left) && fixedText(right) === ANONYMOUS_ACTOR) ||
        (isActorCall(right) && fixedText(left) === ANONYMOUS_ACTOR))
    ) {
      found = true;
    }
  });
  return found;
}

// A predicate as it reads for one kind of caller, with what that kind settles
// about `actor()` worked out: `true` or `false` where the whole predicate is
// settled, and otherwise the predicate with each settled part folded away.
//
// - For a caller who isn't signed in, `actor()` is `"anonymous"`, so every
//   call is that text, and a comparison of it with other text is settled.
// - For a signed-in caller, `actor()` is a Matrix user id, which is never
//   `"anonymous"`, so a comparison of the two is settled and every other use
//   of `actor()` is left for the search to fill in.
//
// Then `and`, `or`, `not` and the `AND`, `OR` and `NOT` calls are folded
// wherever a side is settled. Anything else holding a settled part is left as
// it is, so the filter compiler judges it as written.
export function settleActor(
  body: unknown,
  caller: 'signed-in' | 'anonymous',
): unknown {
  let folded = fold(body, caller);
  let value = settledValue(folded);
  return value === undefined ? folded : value;
}

const SETTLED_TRUE = { type: 'literal', value: true, valueType: 'boolean' };
const SETTLED_FALSE = { type: 'literal', value: false, valueType: 'boolean' };

function settledValue(node: unknown): boolean | undefined {
  let { type, valueType, value } = node as {
    type?: unknown;
    valueType?: unknown;
    value?: unknown;
  };
  return type === 'literal' && valueType === 'boolean'
    ? (value as boolean)
    : undefined;
}

function asSettled(value: boolean) {
  return value ? SETTLED_TRUE : SETTLED_FALSE;
}

function isActorCall(node: unknown): boolean {
  let { type, name, arity } = node as {
    type?: unknown;
    name?: unknown;
    arity?: unknown;
  };
  return type === 'call' && name === 'actor' && (arity ?? 0) === 0;
}

// The text a node is where it is a string literal with nothing interpolated.
export function fixedText(node: unknown): string | undefined {
  let { type, valueType, value, interpolated } = node as {
    type?: unknown;
    valueType?: unknown;
    value?: unknown;
    interpolated?: unknown;
  };
  return type === 'literal' &&
    valueType === 'string' &&
    interpolated !== true &&
    typeof value === 'string'
    ? value
    : undefined;
}

function fold(node: unknown, caller: 'signed-in' | 'anonymous'): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => fold(item, caller));
  }
  if (typeof node !== 'object' || node === null) {
    return node;
  }
  if (isActorCall(node)) {
    return caller === 'anonymous'
      ? {
          type: 'literal',
          value: ANONYMOUS_ACTOR,
          valueType: 'string',
          interpolated: false,
        }
      : node;
  }
  let record = node as Record<string, unknown>;
  let { type, operator } = record;
  if (type === 'binary' && (operator === '==' || operator === '!=')) {
    let left = fold(record.left, caller);
    let right = fold(record.right, caller);
    let equal: boolean | undefined;
    let leftText = fixedText(left);
    let rightText = fixedText(right);
    if (leftText !== undefined && rightText !== undefined) {
      equal = leftText === rightText;
    } else if (
      caller === 'signed-in' &&
      ((isActorCall(left) && rightText === ANONYMOUS_ACTOR) ||
        (isActorCall(right) && leftText === ANONYMOUS_ACTOR))
    ) {
      equal = false;
    }
    if (equal !== undefined) {
      return asSettled(operator === '==' ? equal : !equal);
    }
    return { ...record, left, right };
  }
  if (type === 'binary' && (operator === 'and' || operator === 'or')) {
    let left = fold(record.left, caller);
    let right = fold(record.right, caller);
    let absorbing = operator === 'or';
    for (let [side, other] of [
      [left, right],
      [right, left],
    ]) {
      let value = settledValue(side);
      if (value === absorbing) {
        return asSettled(absorbing);
      }
      if (value === !absorbing) {
        return other;
      }
    }
    return { ...record, left, right };
  }
  // `X | not`, which is how `NOT(X)` and `not` read.
  if (type === 'binary' && operator === '|') {
    let left = fold(record.left, caller);
    let right = fold(record.right, caller);
    let {
      type: rightType,
      name,
      arity,
    } = right as {
      type?: unknown;
      name?: unknown;
      arity?: unknown;
    };
    let value = settledValue(left);
    if (
      value !== undefined &&
      rightType === 'call' &&
      name === 'not' &&
      (arity ?? 0) === 0
    ) {
      return asSettled(!value);
    }
    return { ...record, left, right };
  }
  // `AND([...])` and `OR([...])`, whose single argument is a list built with
  // `,`.
  if (
    type === 'call' &&
    (record.name === 'AND' || record.name === 'OR') &&
    Array.isArray(record.args) &&
    record.args.length === 1 &&
    (record.args[0] as { type?: unknown }).type === 'array'
  ) {
    let absorbing = record.name === 'OR';
    let items = commaItems((record.args[0] as { expr?: unknown }).expr).map(
      (item) => fold(item, caller),
    );
    if (items.some((item) => settledValue(item) === absorbing)) {
      return asSettled(absorbing);
    }
    let open = items.filter((item) => settledValue(item) === undefined);
    if (open.length === 0) {
      return asSettled(!absorbing);
    }
    return {
      ...record,
      args: [{ ...(record.args[0] as object), expr: commaList(open) }],
    };
  }
  let copy: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(record)) {
    copy[key] = fold(value, caller);
  }
  return copy;
}

function commaItems(node: unknown): unknown[] {
  let { type, operator, left, right } = node as {
    type?: unknown;
    operator?: unknown;
    left?: unknown;
    right?: unknown;
  };
  return type === 'binary' && operator === ','
    ? [...commaItems(left), ...commaItems(right)]
    : [node];
}

function commaList(items: unknown[]): unknown {
  return items.reduce((left, right) => ({
    type: 'binary',
    operator: ',',
    left,
    right,
  }));
}
