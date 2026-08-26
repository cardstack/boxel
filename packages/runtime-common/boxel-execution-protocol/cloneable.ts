import type * as JSONTypes from 'json-typescript';

/**
 * The compile-time proof that a record is inert data.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

/**
 * The inert-data check. `Cloneable<T>` resolves to `T`, so it costs consumers
 * nothing, but a member typed as a function, a class instance, a DOM node, a
 * `Map`, `Set`, `Date`, `Promise`, `RegExp`, `symbol`, `bigint`, `object`, or
 * `unknown` fails the constraint and the module does not compile.
 *
 * What it does not catch is `any`, which satisfies the constraint at any
 * depth — `any` opts out of the type system here exactly as it does
 * everywhere else. A record member typed `any` gets no check at all.
 *
 * The constraint rests on the implicit index signature TypeScript infers for
 * an object type alias, so two consequences follow. Records here are type
 * aliases: an interface *without* an index signature cannot satisfy the
 * constraint however inert its members are (one *with* an index signature
 * satisfies it fine — that is why `JSONTypes.Value`, built from interfaces,
 * works throughout). And a member whose type transitively resolves to an
 * index-signature-less interface is rejected, so turning a neighbor's type
 * alias into an interface surfaces as an error here rather than there.
 */
type JsonData =
  | JSONTypes.Primitive
  | undefined
  | readonly JsonData[]
  | { readonly [key: string]: JsonData };

export type Cloneable<T extends JsonData> = T;
