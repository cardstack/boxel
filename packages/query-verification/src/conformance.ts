// Reads the conformance vectors the Lean model writes (vectors/*.json) and
// turns each evaluator's answers into the model's three truth values, so any
// evaluator can be held to them.
//
// An evaluator answers with a set of rows, which cannot say "unknown". Each
// filter is therefore also run as its `not`: a card in `f`'s answer is `t`,
// one in `not f`'s is `f`, and one in neither is `u`. A card in both is an
// evaluator contradicting itself.
import { readFileSync } from 'fs';

export type Truth = 't' | 'f' | 'u';

export interface VectorCard {
  id: string;
  type: string;
  doc: Record<string, unknown>;
}

export interface VectorCase {
  name: string;
  newer: Record<string, unknown>;
  lowered: Record<string, unknown>;
  older?: Record<string, unknown>;
  // A refused case (`contains` on a number field) has no answer to hold an
  // evaluator to; the server must refuse it.
  refused?: true;
  expect?: string;
}

// A field: how it holds its value, and of what: `string`, `number`, or a
// type named in `defs`.
export interface VectorField {
  type: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
  of: string;
}

export interface Vectors {
  // each card type with its parent, if any; every card type has `fields`
  types: Record<string, string[]>;
  fields: Record<string, VectorField>;
  // the compound field types and linked card types the fields reach
  defs: Record<
    string,
    { kind: 'field' | 'card'; fields: Record<string, VectorField> }
  >;
  cards: VectorCard[];
  cases: VectorCase[];
}

export const VECTOR_FILES = ['filters', 'paths'] as const;

export function readVectors(name: string = 'filters'): Vectors {
  return JSON.parse(
    readFileSync(new URL(`../vectors/${name}.json`, import.meta.url), 'utf8'),
  );
}

export const isPrimitive = (field: VectorField) =>
  field.of === 'string' || field.of === 'number';
export const isPlural = (field: VectorField) =>
  field.type === 'containsMany' || field.type === 'linksToMany';

// The vectors write a type as `$Name`; `ref` gives the code ref it stands for.
export function withTypeRefs<T>(value: T, ref: (name: string) => unknown): T {
  let walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x, k)]),
      );
    }
    if (
      (key === 'on' || key === 'type') &&
      typeof v === 'string' &&
      v.startsWith('$')
    ) {
      return ref(v.slice(1));
    }
    return v;
  };
  return walk(value) as T;
}

export function truthOf(
  inF: boolean,
  inNotF: boolean,
): Truth | 'contradiction' {
  if (inF && inNotF) return 'contradiction';
  return inF ? 't' : inNotF ? 'f' : 'u';
}

export interface Disagreement {
  case: string;
  form: string;
  card: VectorCard;
  expected: Truth;
  actual: string;
}

// One line per case and form, with the first few cards that disagree.
export function report(disagreements: Disagreement[], examples = 3): string {
  let groups = new Map<string, Disagreement[]>();
  for (let d of disagreements) {
    let key = `${d.case} [${d.form}]`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  let lines: string[] = [];
  for (let [key, ds] of groups) {
    lines.push(`${key}: ${ds.length} card(s) disagree`);
    for (let d of ds.slice(0, examples)) {
      lines.push(
        `    ${d.card.id} ${JSON.stringify(d.card.doc)}: expected ${d.expected}, got ${d.actual}`,
      );
    }
  }
  return lines.join('\n');
}
