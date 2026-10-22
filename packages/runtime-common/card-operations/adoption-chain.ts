import type { ResolvedCodeRef } from '../code-ref.ts';
import type { Definition } from '../definitions.ts';
import type { RealmResourceIdentifier } from '../realm-identifiers.ts';

// ============================================================================
// Reading the types an adoption chain records.
//
// A chain records a type and each type it descends from, in order, by internal
// key. A class its module exports is keyed by the module and the name joined
// with `/`. A class its module does not export has no name a key could hold, so
// it is keyed by where it was reached from: `<key>/ancestor` for the class a
// type extends, `<key>/fields/<field>` for the type of a field. Such a class has
// no definition entry, since entries are built only for a module's exports.
//
// So a key's spelling does not say which it is. A type exported from a module
// under a `fields/` directory, or from a `fields` module, is keyed `…/fields/…`
// too, and a class exported under the name `ancestor` is keyed `…/ancestor`.
// What does say is where the class sits. A class its module does not export can
// be extended, or declared as a field's type, only inside that module, so the
// type its key says it was reached from, and the type before it in the chain,
// which extends it, are both in its module.
// ============================================================================

// The type the key at `index` in `chain` names, with its definition. `read`
// answers a type's definition, or undefined when the realm has no definition of
// it.
//
// Undefined when the key names no type the realm defines: a class its module
// does not export, a type whose definition is missing, or a key with no module
// and name in it. A class its module does not export is recognized from the
// chain alone, and is never read as a type in whatever module its key's
// spelling points to. The chain's first key has no type before it to say
// where it sits, so a first key spelled as an unexported class's is not read
// at all: it might be one. A caller that has read the first type's own entry
// judges the chain from its second key.
export async function chainType(
  chain: readonly string[],
  index: number,
  read: (codeRef: ResolvedCodeRef) => Promise<Definition | undefined>,
): Promise<{ codeRef: ResolvedCodeRef; definition: Definition } | undefined> {
  let key = chain[index];
  if (
    index === 0
      ? reachedFrom(key) !== undefined
      : isUnexportedClass(key, chain[index - 1])
  ) {
    return undefined;
  }
  let codeRef = typeRefOf(key);
  let definition = codeRef ? await read(codeRef) : undefined;
  return codeRef && definition ? { codeRef, definition } : undefined;
}

// Whether `key` is an unexported class's: spelled as one, and reached from a
// type in the module of `subclass`, the type the chain records as extending
// it. Each key is read as a module and a name to compare where the two sit.
function isUnexportedClass(key: string, subclass: string): boolean {
  let from = reachedFrom(key);
  let origin = from ? typeRefOf(from) : undefined;
  let extender = typeRefOf(subclass);
  return Boolean(origin && extender && origin.module === extender.module);
}

const ANCESTOR = '/ancestor';
const FIELDS = '/fields/';

// The key of the type an unexported class's key says the class was reached
// from, if `key` is spelled as one: the type it is the ancestor of, or the
// type whose field it is. A field's name holds no `/`, so only the last
// segment can be one.
function reachedFrom(key: string): string | undefined {
  if (key.endsWith(ANCESTOR)) {
    return key.slice(0, -ANCESTOR.length);
  }
  let fields = key.lastIndexOf(FIELDS);
  let field = key.slice(fields + FIELDS.length);
  if (fields > 0 && field.length > 0 && !field.includes('/')) {
    return key.slice(0, fields);
  }
  return undefined;
}

// A key read as a module and a name, split at its last `/`.
function typeRefOf(key: string): ResolvedCodeRef | undefined {
  let lastSlash = key.lastIndexOf('/');
  if (lastSlash <= 0 || lastSlash === key.length - 1) {
    return undefined;
  }
  return {
    module: key.slice(0, lastSlash) as RealmResourceIdentifier,
    name: key.slice(lastSlash + 1),
  };
}
