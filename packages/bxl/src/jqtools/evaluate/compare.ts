import { Type, typeOf } from './utils/utils.js';

const typesOrder: Record<Type, number> = {
  null: 0,
  boolean: 1,
  number: 2,
  string: 3,
  array: 4,
  object: 5,
};

function compareTypes(a: Type, b: Type) {
  return typesOrder[a] - typesOrder[b];
}

export function compare(a: any, b: any): number {
  const typeA = typeOf(a);
  const typesCompare = compareTypes(typeA, typeOf(b));
  if (typesCompare !== 0) {
    return typesCompare;
  }

  switch (typeA) {
    case Type.null:
      return 0;
    case Type.boolean:
    case Type.number:
      return a - b;
    case Type.string:
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const ai = a.codePointAt(i) ?? -1;
        const bi = b.codePointAt(i) ?? -1;
        const comp = ai - bi;
        if (comp !== 0) return comp;
      }
      return 0;
    case Type.array:
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === undefined) return -1;
        if (b[i] === undefined) return 1;
        const comp = compare(a[i], b[i]);
        if (comp !== 0) return comp;
      }
      return 0;
    case Type.object:
      const aKeys = Object.keys(a).sort();
      const bKeys = Object.keys(b).sort();
      const keysComp = compare(aKeys, bKeys);
      if (keysComp !== 0) return keysComp;
      const aValues = aKeys.map((key) => a[key]);
      const bValues = bKeys.map((key) => b[key]);
      return compare(aValues, bValues);
  }
}
