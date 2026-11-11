import {
  ensureTrailingSlash,
  humanReadable,
  rri,
  type BaseOperation,
  type Loader,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { loadCardDef } from '@cardstack/runtime-common/code-ref';

import type { BaseDef, CardDef } from '@cardstack/base/card-api';
import type * as OperationsModule from '@cardstack/base/operations';

// The checks an operation named as data passes before it is sent, shared by
// the invoke-card-operation tool and the realm runner's `realm.operations`, so
// both refuse the same names with the same sentences.

// A bucket of callable operations, in the terms a name that arrived as data
// reaches them by. `operations()` is overloaded per scope so a card author
// gets the members their class carries and nothing else; a caller that is
// handed the name instead of writing it reads the bucket as the record the
// implementation answers with.
export type OperationsBucket = Record<string, unknown>;

// The one member of a card's bucket that is not an operation: it opens a batch
// and takes a builder rather than a payload.
export const BATCH_MEMBER = 'atomic';

export function baseOf(
  name: string,
  declarations: Record<string, OperationsModule.OperationDeclaration>,
): BaseOperation {
  return (declarations[name]?.base ?? name) as BaseOperation;
}

// Which names a caller may invoke by name: the operations a type's author
// declared, and the plain `create`.
//
// The behaviors every card carries - reading it, patching it, removing it,
// appending to a collection - are left out although `operations()` offers
// them, because each is already the job of a tool that describes its own
// payload, and one of them removes a card. Offering them here would put a
// delete of any card behind a name the caller supplies. A `delete` an author
// declared stays reachable: that is a named action its type published.
//
// A query is left out for a different reason - it answers a live set of search
// results rather than a value - and the batch member is not an operation at
// all.
export function offeredHere(
  name: string,
  scope: 'instance' | 'type',
  base: BaseOperation,
  declarations: Record<string, OperationsModule.OperationDeclaration>,
): boolean {
  if (declarations[name]) {
    return base !== 'query';
  }
  return base === 'create' && scope === 'type';
}

export function invocableNames(
  buckets: { scope: 'instance' | 'type'; bucket: OperationsBucket }[],
  declarations: Record<string, OperationsModule.OperationDeclaration>,
): string[] {
  let names = new Set<string>();
  for (let { scope, bucket } of buckets) {
    for (let name of Object.keys(bucket)) {
      if (name === BATCH_MEMBER) {
        continue;
      }
      if (offeredHere(name, scope, baseOf(name, declarations), declarations)) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

// Every param the declaration names needs a value, which is the realm's own
// rule for an invocation; asking it here means a caller hears which name it
// left out without a request being sent or a write lock being taken.
//
// A declaration carrying an `input` program is exempt, and that is the whole
// reason this is not a blanket check: `input` runs over the payload before the
// realm's params check and is most often there precisely to supply a param the
// caller did not send, so refusing here would refuse an invocation the realm
// would have carried out.
export function assertPayloadSuppliesParams(
  name: string,
  declaration: OperationsModule.OperationDeclaration | undefined,
  payload: Record<string, unknown> | undefined,
): void {
  if (!declaration?.params || declaration.input) {
    return;
  }
  for (let key of Object.keys(declaration.params)) {
    if (own(payload, key) === undefined) {
      throw new Error(
        `operation "${name}" requires a value for params("${key}")`,
      );
    }
  }
}

function own(
  record: Record<string, unknown> | undefined,
  key: string,
): unknown {
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }
  return record[key];
}

// The def as a refusal names it. The class's own name first: `displayName` is
// declared on `CardDef` itself, so a type that does not set one of its own
// reports as "Card", which tells a caller nothing about the card they named.
export function defNameOf(card: CardDef): string {
  return typeNameOf(card.constructor as typeof CardDef);
}

export function typeNameOf(type: typeof BaseDef): string {
  let owner = type as { displayName?: string; name?: string };
  return owner.name || owner.displayName || 'this card';
}

// An operation that acts on the card it is invoked on, as its type declares
// it. Refuses a name the card does not carry with the list of the ones it
// does, a query, and a behavior every card carries. Answers the declaration's
// base, so the caller knows whether the answer is a write or a document.
export function assertInstanceOperation(
  operationsModule: typeof OperationsModule,
  card: CardDef,
  name: string,
): BaseOperation {
  let declarations = operationsModule.getDeclaredOperations(card);
  let bucket = (
    operationsModule.operations as (target: unknown) => OperationsBucket
  )(card);
  let base = baseOf(name, declarations);
  // A declared query is not offered here either, but it gets its own refusal
  // that says where its results are read instead.
  if (declarations[name] && base === 'query') {
    throw new Error(
      `"${name}" is a query operation: it answers a live set of search results, not a value. Search with realm.cards.search or realm.entries.search instead.`,
    );
  }
  if (
    name === BATCH_MEMBER ||
    typeof bucket[name] !== 'function' ||
    !offeredHere(name, 'instance', base, declarations)
  ) {
    let names = invocableNames([{ scope: 'instance', bucket }], declarations);
    throw new Error(
      `"${name}" is not an operation ${defNameOf(card)} declares. ${
        names.length > 0
          ? `It declares: ${names.join(', ')}`
          : 'It declares none'
      }`,
    );
  }
  return base;
}

// The class an operation on a type names. A relative module is read from the
// root of the realm the operation runs in, as a path in that realm is.
export async function loadOperationType(
  name: string,
  type: ResolvedCodeRef,
  realm: string,
  loader: Loader,
): Promise<typeof BaseDef> {
  try {
    return await loadCardDef(type, {
      loader,
      relativeTo: rri(ensureTrailingSlash(realm)),
    });
  } catch (error) {
    throw new Error(
      `cannot run "${name}": ${humanReadable(type)} did not load: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// An operation that acts on a type rather than on one of its cards, invoked
// through the class itself: the plain `create`, and a declared operation the
// type carries in that scope, such as a declared create. Refuses what
// `assertInstanceOperation` refuses, listing the names the type carries in
// this scope. Answers the base, as `assertInstanceOperation` does.
//
// The bucket is built here, from the class, and building it names the class
// by its module and export, so a class no module exports is refused by
// `operations()` itself.
export function assertTypeOperation(
  operationsModule: typeof OperationsModule,
  type: typeof BaseDef,
  name: string,
): BaseOperation {
  let declarations = operationsModule.getDeclaredOperations(type);
  let bucket = (
    operationsModule.operations as (target: unknown) => OperationsBucket
  )(type);
  let base = baseOf(name, declarations);
  if (declarations[name] && base === 'query') {
    throw new Error(
      `"${name}" is a query operation: it answers a live set of search results, not a value. Search with search-entries, or realm.cards.search or realm.entries.search in run-realm-code, instead.`,
    );
  }
  if (
    name === BATCH_MEMBER ||
    typeof bucket[name] !== 'function' ||
    !offeredHere(name, 'type', base, declarations)
  ) {
    let names = invocableNames([{ scope: 'type', bucket }], declarations);
    throw new Error(
      `"${name}" is not an operation ${typeNameOf(type)} carries on the type itself${
        declarations[name]
          ? ': it acts on one of its cards, so it is invoked on that card'
          : ''
      }. ${
        names.length > 0
          ? `On the type it carries: ${names.join(', ')}`
          : 'It carries none on the type'
      }`,
    );
  }
  return base;
}
