// The vectors' cards as the host's live-query matcher reads them, and the
// matcher's answer for a card read as a truth value.
//
// The matcher reads cards through the card API; the cards here are minimal
// stand-ins carrying exactly the parts it reads: a class identity, a field
// per name (primitive, compound or link, single or a list), and the field's
// value: a primitive, or an instance of the compound or linked type.
import {
  isBaseInstance,
  isField,
  primitive,
} from '@cardstack/runtime-common/constants';
import { exportIdentitySymbolKey } from '@cardstack/runtime-common/export-identity-plugin';
import {
  isClientEvaluable,
  matchInstanceAgainstFilter,
  type CardAPIForMatching,
} from '@cardstack/runtime-common/instance-filter-matcher';
import { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';

import {
  isPlural,
  isPrimitive,
  truthOf,
  type Disagreement,
  type VectorField,
  type Vectors,
} from './conformance.ts';

const MODULE = 'http://query-verification/model';
export const ref = (name: string) => ({ module: MODULE, name });

class Primitive {
  static baseDef = true;
  static [primitive] = true;
}

type Instance = { values: Record<string, unknown> };
type Def = { new (): Instance };

export function matcherFor(vectors: Vectors) {
  let classes = new Map<string, Def>();

  let define = (
    name: string,
    parent: Def | undefined,
    isCard: boolean,
    fields: Record<string, VectorField>,
  ): Def => {
    let C: Def = parent
      ? class extends (parent as any) {}
      : class {
          static baseDef = true;
          declare values: Record<string, unknown>;
        };
    if (isCard && !parent) (C as any).isCardDef = true;
    if (!parent) {
      Object.defineProperty(C.prototype, isBaseInstance, { value: true });
    }
    Object.defineProperty(C, Symbol.for(exportIdentitySymbolKey), {
      value: [MODULE, name],
    });
    for (let [fieldName, field] of Object.entries(fields)) {
      let get = function (this: Instance) {
        return this.values[fieldName];
      };
      (get as any)[isField] = {
        name: fieldName,
        get card() {
          return isPrimitive(field) ? Primitive : classFor(field.of);
        },
        fieldType: field.type,
      };
      Object.defineProperty(C.prototype, fieldName, { get });
    }
    classes.set(name, C);
    return C;
  };

  let classFor = (name: string): Def => {
    let known = classes.get(name);
    if (known) return known;
    if (vectors.defs[name]) {
      let def = vectors.defs[name];
      return define(name, undefined, def.kind === 'card', def.fields);
    }
    let parents = vectors.types[name];
    return parents.length
      ? define(name, classFor(parents[0]), true, {})
      : define(name, undefined, true, vectors.fields);
  };

  let fieldsOf = (name: string) => vectors.defs[name]?.fields ?? vectors.fields;

  let build = (type: string, doc: Record<string, unknown>): Instance => {
    let inst = new (classFor(type))();
    inst.values = {};
    for (let [name, field] of Object.entries(fieldsOf(type))) {
      let raw = doc[name];
      let one = (v: unknown) =>
        isPrimitive(field) || v == null
          ? v
          : build(field.of, v as Record<string, unknown>);
      inst.values[name] = isPlural(field)
        ? Array.isArray(raw)
          ? raw.map(one)
          : undefined
        : one(raw);
    }
    return inst;
  };

  let api: CardAPIForMatching = {
    getQueryableValue: (field, value) =>
      field.fieldType === 'containsMany' || field.fieldType === 'linksToMany'
        ? Array.isArray(value)
          ? value
          : []
        : (value ?? null),
    formatQueryValue: (_field, value) => value,
    peekAtField: (inst, name) => (inst as unknown as Instance).values[name],
    isQueryTaintedField: () => false,
    isNonPresentLink: () => false,
    getCardMeta: () => undefined,
    primitive,
    virtualNetwork: new VirtualNetwork(),
  };

  let instances = vectors.cards.map((card) => ({
    card,
    inst: build(card.type, card.doc) as any,
  }));

  // Holds the matcher to `expect` for `filter` on every card; `undefined`
  // when the matcher leaves the filter to the server.
  return function check(
    caseName: string,
    form: string,
    filter: any,
    expect: string,
  ): Disagreement[] | undefined {
    if (!isClientEvaluable(filter)) return undefined;
    let out: Disagreement[] = [];
    instances.forEach(({ card, inst }, i) => {
      let yes = matchInstanceAgainstFilter(inst, filter, api);
      let no = matchInstanceAgainstFilter(inst, { not: filter } as any, api);
      let actual =
        yes === 'unresolvable' || no === 'unresolvable'
          ? 'unresolvable'
          : truthOf(yes === 'match', no === 'match');
      if (actual !== expect[i]) {
        out.push({
          case: caseName,
          form,
          card,
          expected: expect[i] as any,
          actual,
        });
      }
    });
    return out;
  };
}
