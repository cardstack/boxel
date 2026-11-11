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
import {
  getSerializer,
  type SerializerName,
} from '@cardstack/runtime-common/serializers';
import { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';

import {
  isPlural,
  isPrimitive,
  SERIALIZED,
  truthOf,
  type Disagreement,
  type VectorField,
  type Vectors,
} from './conformance.ts';

const serializerOf = (field: VectorField) =>
  (SERIALIZED as readonly string[]).includes(field.of)
    ? getSerializer(field.of as SerializerName)
    : undefined;

const MODULE = 'http://query-verification/model';
export const ref = (name: string) => ({ module: MODULE, name });

const primitives = new Map<string, unknown>();
const primitiveFor = (of: string) => {
  if (!primitives.has(of)) {
    primitives.set(
      of,
      class {
        static baseDef = true;
        static [primitive] = true;
        static serializerName = of;
      },
    );
  }
  return primitives.get(of);
};

type Instance = { values: Record<string, unknown> };
type Def = { new (): Instance };

export async function matcherFor(vectors: Vectors) {
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
          return isPrimitive(field)
            ? primitiveFor(field.of)
            : classFor(field.of);
        },
        fieldType: field.type,
        vectorField: field,
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

  // An instance holds what its card JSON deserializes to (a `Date`, a
  // `bigint`), as a loaded card does.
  let build = async (
    type: string,
    doc: Record<string, unknown>,
  ): Promise<Instance> => {
    let inst = new (classFor(type))();
    inst.values = {};
    for (let [name, field] of Object.entries(fieldsOf(type))) {
      let raw = doc[name];
      let serializer = serializerOf(field);
      let one = async (v: unknown) =>
        serializer
          ? await serializer.deserialize.call(undefined as any, v)
          : isPrimitive(field) || v == null
            ? v
            : await build(field.of, v as Record<string, unknown>);
      inst.values[name] = isPlural(field)
        ? Array.isArray(raw)
          ? await Promise.all(raw.map(one))
          : undefined
        : await one(raw);
    }
    return inst;
  };

  // `getQueryableValue` and `formatQueryValue` as `card-api` has them: a
  // primitive's value goes through its serializer's `queryableValue`, and a
  // query value through its `formatQuery` when it has one.
  let queryable = (field: VectorField, value: unknown) => {
    let serializer = serializerOf(field);
    return serializer && value != null
      ? (serializer.queryableValue(value, []) ?? null)
      : (value ?? null);
  };
  let api: CardAPIForMatching = {
    getQueryableValue: (field, value) => {
      let vf = (field as any).vectorField as VectorField;
      if (
        field.fieldType === 'containsMany' ||
        field.fieldType === 'linksToMany'
      ) {
        return Array.isArray(value) ? value.map((v) => queryable(vf, v)) : [];
      }
      return queryable(vf, value);
    },
    formatQueryValue: (field, value) => {
      let serializer = serializerOf((field as any).vectorField);
      return serializer?.formatQuery?.(value) ?? value;
    },
    peekAtField: (inst, name) => (inst as unknown as Instance).values[name],
    isQueryTaintedField: () => false,
    isNonPresentLink: () => false,
    getCardMeta: () => undefined,
    primitive,
    virtualNetwork: new VirtualNetwork(),
  };

  let instances = await Promise.all(
    vectors.cards.map(async (card) => ({
      card,
      inst: (await build(card.type, { ...card.doc, ...card.attrs })) as any,
    })),
  );

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
