// Marks a card or field definition that a module makes by calling a function,
// such as `enumField`, rather than by writing a class:
//
//   import { markDefinition } from '@cardstack/base';
//   export const Status = markDefinition(enumField(StringField, { ... }));
//
// A class a module writes is given its identity by the compiler. A class a
// call returns has no body in the module to carry it, so the compiler tags the
// binding a call to this function is the value of, under the name it is
// exported by. It only recognizes this function imported from
// `@cardstack/base`, and only as the value of an exported binding or the
// module's default export; anywhere else is a compile error.
//
// At runtime it returns what it is given.
export function markDefinition<T>(definition: T): T {
  return definition;
}
