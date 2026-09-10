import {
  BXL_VOLATILE_CALLS,
  bxlToStorageExpression,
  parseBxlAst,
  tokenizeNativeJq,
} from '@cardstack/bxl';
import { prepareBxlMutation } from '@cardstack/bxl/mutation';

// ============================================================================
// Emitting and checking the BXL a lowered operation carries.
//
// Everything here works on program text alone. Field paths are checked
// against the type's definition by the lowering pass; BXL's own schema-aware
// machinery is deliberately not used, because the mutation schema it wants is
// the whole reachable definition graph and lowering has one definition plus a
// lookup. So a program's canonical form and its syntactic validity come from
// here, and what its paths mean comes from the definition.
// ============================================================================

// A mutation schema is what BXL's readable-syntax compiler resolves a display
// label like `[Due Date]` against. A declaration names fields by key, never
// by label, so no schema is needed — and passing an empty one keeps the parse
// check from walking the definition graph.
const NO_SCHEMA = { fields: [] };

// A path segment safe to write bare after a `.`; anything else is subscripted
// as a string so a hyphen or space cannot be read as an operator.
const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function bxlLiteral(value: string | number | boolean | null): string {
  return JSON.stringify(value);
}

// A dotted field path as a BXL location: `.address.city`, or
// `.["odd key"].city` when a segment is not a bare identifier.
export function bxlFieldPath(dottedPath: string): string {
  let source = '';
  for (let segment of dottedPath.split('.')) {
    source += BARE_IDENTIFIER.test(segment)
      ? `.${segment}`
      : `.[${JSON.stringify(segment)}]`;
  }
  return source;
}

export function bxlObjectKey(key: string): string {
  return BARE_IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

export interface ProgramCheck {
  // The canonical program text, present only when the program parsed.
  source?: string;
  // Why it did not parse, when it did not.
  error?: string;
}

// Canonicalize and syntax-check a mutation program — a sequence of `;`-
// terminated assignments and structural calls (`append`, `assert`, …).
//
// `syntax` says which spelling the source is in: `readable` for what an
// author wrote (Excel-style `=` comparisons, display labels), `solidified`
// for what this module emits. Either way the canonical form comes back, so
// one program shape reaches the realm whichever spelling produced it.
//
// BXL's `mutation` profile is enforced here, which is what rules out a
// volatile or side-effecting call in a program that plans a write.
export function checkMutationProgram(
  source: string,
  syntax: 'readable' | 'solidified',
): ProgramCheck {
  try {
    let prepared = prepareBxlMutation(source, {
      schema: NO_SCHEMA,
      targetKind: 'card',
      syntax,
    });
    return { source: prepared.canonicalSource };
  } catch (err: any) {
    return { error: err?.message ?? String(err) };
  }
}

// Canonicalize and syntax-check a single BXL expression — the `input` and
// `output` stages, which shape a payload and project a result rather than
// planning a write.
//
// The `compute` profile is the permissive one: an expression here may read
// the request context (`params()`, `actor()`, `instance()`) and may be
// volatile. Volatility is not an error, it is recorded — see
// `usesVolatileCall`.
export function checkExpressionProgram(source: string): ProgramCheck {
  let canonical: string;
  try {
    canonical = bxlToStorageExpression(source).source;
  } catch (err: any) {
    return { error: err?.message ?? String(err) };
  }
  try {
    parseBxlAst(canonical, { readableSyntax: false, profile: 'compute' });
  } catch (err: any) {
    return { error: err?.message ?? String(err) };
  }
  return { source: canonical };
}

// Whether a program calls anything whose value changes between runs, which is
// what disqualifies an operation from the client's optimistic path.
//
// Read off the token stream rather than the AST so one scan covers both
// program flavors: a mutation program's `append(…)` statements are not an
// expression the AST parser accepts. A name in a string literal is a `str`
// token and never matches; a field access (`.today`) is preceded by the `.`
// operator, and an object key (`{now: 1}`) is followed by `:` — neither is a
// call. An unparseable program counts as volatile, so nothing is optimistic
// on the strength of text this cannot read.
export function usesVolatileCall(source: string): boolean {
  let tokens: { type: string; value: unknown }[];
  try {
    tokens = tokenizeNativeJq(source, { readableSyntax: false }) as {
      type: string;
      value: unknown;
    }[];
  } catch {
    return true;
  }
  return tokens.some((token, index) => {
    if (token.type !== 'ident') {
      return false;
    }
    if (!BXL_VOLATILE_CALLS.has(String(token.value).toUpperCase())) {
      return false;
    }
    return tokens[index - 1]?.value !== '.' && tokens[index + 1]?.value !== ':';
  });
}

// The param keys a program reads through the `params()` builtin, so a typo
// inside raw program text is caught the way a typo in a clause is. Only a
// literal key is visible here — `params(.someExpression)` names no key this
// can check, and is left to the realm.
export function paramKeysRead(source: string): string[] {
  let tokens: { type: string; value: unknown }[];
  try {
    tokens = tokenizeNativeJq(source, { readableSyntax: false }) as {
      type: string;
      value: unknown;
    }[];
  } catch {
    return [];
  }
  let keys: string[] = [];
  for (let [index, token] of tokens.entries()) {
    if (
      token.type !== 'ident' ||
      String(token.value) !== 'params' ||
      tokens[index - 1]?.value === '.'
    ) {
      continue;
    }
    let key = tokens[index + 2];
    if (tokens[index + 1]?.value === '(' && key?.type === 'str') {
      keys.push(String(key.value));
    }
  }
  return keys;
}
