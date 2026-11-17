// ============================================================================
// Whether a policy predicate reads anything of the card it judges.
//
// A predicate reads the caller (`actor()`), the governed realm's settings
// (`realmConfig()`), the policy card's own fields (`policy()`) and the card
// it judges. One that reads nothing of the card holds or fails for every card
// alike: `realmConfig("reviewers") | any(. == actor())` says who the caller
// is, and nothing about which card they asked for. A search can settle such a
// predicate once, for its caller, before it composes anything, where a
// predicate that reads the card has to become a filter over the index (see
// `policy-query.ts`).
//
// The answer here is decided from the predicate's syntax alone, as BXL's
// `policy` profile parsed it, so it needs no definition and is settled when
// the policy compiles.
//
// It is sound in one direction only. A predicate this calls card-independent
// produces the same outputs whatever card it is run against. One that reads
// nothing of the card can still be refused, which keeps it on the path every
// other predicate takes. So every use of a value that may come from the card
// counts as a read of it:
//
// - a path (`.status`, `.[]`, `.[0]`), `..`, a format (`@base64`), and any
//   builtin run on it, since a builtin may read its input;
// - testing it for truth, comparing it, or doing arithmetic with it;
// - indexing, slicing or iterating it, and a computed object key;
// - binding it to a variable, since a destructuring pattern reads what it
//   binds and the parsed tree does not mark one;
// - `instance()`, which reads the card whatever its input;
// - a context path (`Record`, `$new`, `@User`), which the gate does not bind,
//   and a construct the policy profile refuses (`def`, `reduce`, `foreach`).
//
// The card itself flows through `|`, `,`, an array or object it is put in, a
// branch of `if`, the body of `try` and the right side of `//`, and is read
// wherever it lands. Passing a value along never makes how many outputs there
// are, or whether an error is raised, depend on it, so a value passed along and
// then dropped,
// as in `[.] | true`, reads nothing. Every part of the predicate is walked,
// wherever its outputs go, so a read is found even in a part whose outputs
// are dropped. The predicate's own output is tested for truth, so a predicate
// that answers with the card reads it.
// ============================================================================

// Whether `body`, a predicate as BXL's `policy` profile parsed it, reads
// nothing of the card it judges.
export function readsNothingOfTheCard(body: unknown): boolean {
  try {
    use(walk(body, true));
    return true;
  } catch (e: unknown) {
    if (e instanceof ReadsTheCard) {
      return false;
    }
    throw e;
  }
}

// Thrown at the first use of a value that may come from the card, and caught
// where the walk began.
class ReadsTheCard extends Error {}

// A value is used: anything that may come from the card is read.
function use(fromCard: boolean): void {
  if (fromCard) {
    throw new ReadsTheCard();
  }
}

// An Excel formula computes from its arguments and never reads its input.
const FORMULA_NAME = /^[A-Z][A-Z0-9_.]*$/;

// Calls that read nothing of their input: the caller, and the realm's and
// the policy card's settings.
const CONTEXT_CALLS = new Set(['actor/0', 'realmConfig/0', 'policy/0']);

// Whether what `node` produces may come from the card, where `input` says
// whether its input may. Throws `ReadsTheCard` where the node uses such a
// value.
function walk(node: unknown, input: boolean): boolean {
  if (!isNode(node)) {
    throw new ReadsTheCard();
  }
  switch (node.type) {
    case 'literal':
      if (node.valueType === 'interpolated-string') {
        for (let part of asArray(node.parts)) {
          if (typeof part !== 'string') {
            use(walk(part, input));
          }
        }
      }
      return false;
    case 'path': {
      let parts = asArray(node.parts);
      if (parts.length === 0) {
        return input;
      }
      use(input);
      for (let part of parts) {
        if (!isNode(part)) {
          throw new ReadsTheCard();
        }
        // A computed index and a slice's bounds are evaluated over the
        // path's own input.
        for (let operand of [part.expr, part.from, part.to]) {
          if (operand !== undefined) {
            use(walk(operand, input));
          }
        }
      }
      return false;
    }
    case 'variable':
      // Only a value already used can be bound, so no variable holds
      // anything of the card.
      return false;
    case 'format':
    case 'recursiveDescent':
      use(input);
      return false;
    case 'call':
      return call(node, input);
    case 'binary':
      return binary(node, input);
    case 'unary':
      use(walk(node.expr, input));
      return false;
    case 'if': {
      let produced = false;
      let branches = [
        { cond: node.cond, then: node.then },
        ...asArray(node.elifs).map((branch) => branch as AstNode),
      ];
      for (let branch of branches) {
        use(walk(branch.cond, input));
        produced = walk(branch.then, input) || produced;
      }
      return (
        (node.else === undefined ? input : walk(node.else, input)) || produced
      );
    }
    case 'try': {
      let produced = walk(node.body, input);
      // The handler's input is the error, which a used value never reaches.
      return node.catch === undefined
        ? produced
        : walk(node.catch, false) || produced;
    }
    case 'array':
      return node.expr === undefined ? false : walk(node.expr, input);
    case 'object': {
      let produced = false;
      for (let entry of asArray(node.entries)) {
        let { key, value } = entry as { key?: unknown; value?: unknown };
        if (value === undefined) {
          // `{name}` is `{name: .name}`, and `{$name}` is `{name: $name}`.
          if (!String(key).startsWith('$')) {
            use(input);
          }
          continue;
        }
        if (typeof key !== 'string') {
          use(walk(key, input));
        }
        produced = walk(value, input) || produced;
      }
      return produced;
    }
    case 'index':
      use(walk(node.expr, input));
      if (typeof node.index !== 'string') {
        use(walk(node.index, input));
      }
      return false;
    case 'slice':
      use(walk(node.expr, input));
      for (let bound of [node.from, node.to]) {
        if (bound !== undefined) {
          use(walk(bound, input));
        }
      }
      return false;
    case 'iterator':
      use(walk(node.expr, input));
      return false;
    case 'binding':
      use(walk(node.expr, input));
      return walk(node.next, input);
    case 'label':
      return walk(node.next, input);
    case 'break':
      return false;
    default:
      // A context path, a construct the policy profile refuses, or anything
      // else the walk does not model.
      throw new ReadsTheCard();
  }
}

function call(node: AstNode, input: boolean): boolean {
  let name = String(node.name);
  let args = asArray(node.args);
  let key = `${name}/${args.length}`;
  if (CONTEXT_CALLS.has(key)) {
    return false;
  }
  if (key === 'realmConfig/1' || key === 'policy/1') {
    use(walk(args[0], input));
    return false;
  }
  if (name === 'instance' || name === 'params') {
    throw new ReadsTheCard();
  }
  if (FORMULA_NAME.test(name)) {
    // A formula's arguments run over its input, and it computes its output
    // from theirs.
    for (let arg of args) {
      use(walk(arg, input));
    }
    return false;
  }
  // Any other builtin may read its input. Once the input is known to hold
  // nothing of the card, so does everything an argument runs over: the
  // input, its items, what lies beneath it, or another argument's outputs,
  // each of which is used here.
  use(input);
  for (let arg of args) {
    use(walk(arg, false));
  }
  return false;
}

function binary(node: AstNode, input: boolean): boolean {
  let operator = String(node.operator);
  switch (operator) {
    case '|':
      return walk(node.right, walk(node.left, input));
    case ',': {
      // Both sides are walked, so a read on the right is found even where
      // the left already carries the card.
      let left = walk(node.left, input);
      let right = walk(node.right, input);
      return left || right;
    }
    case '//':
      use(walk(node.left, input));
      return walk(node.right, input);
    default:
      // `and`, `or`, a comparison, arithmetic or an assignment: each side is
      // used, and an assignment changes its input.
      if (ASSIGNMENTS.has(operator)) {
        use(input);
      }
      use(walk(node.left, input));
      use(walk(node.right, input));
      return false;
  }
}

const ASSIGNMENTS = new Set(['=', '|=', '+=', '-=', '*=', '/=', '%=', '//=']);

type AstNode = { type: string } & Record<string, unknown>;

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
