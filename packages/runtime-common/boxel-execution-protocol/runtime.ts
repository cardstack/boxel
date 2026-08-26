/**
 * The operations every tier's runtime offers, and the handles they trade in.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

import type { CodeRef } from '../code-ref.ts';
import type { LooseSingleCardDocument } from '../index.ts';
import type { RealmResourceIdentifier } from '../realm-identifiers.ts';
import type { LooseCardResource } from '../resource-types.ts';
import type { InstanceProjection } from './instance-projection.ts';
import type { BoxelDescription, ResolvedField } from './type-description.ts';

/**
 * Why an instance is being materialized. `createFromSerialized` carries it,
 * because the answer changes what a runtime is allowed to be lenient about:
 * an indexing pass must fail loudly on a definition it cannot identify, where
 * an interactive surface shows an error card and carries on. Collapsing the
 * two lets an indexing failure ride as a rendering failure — which is how a
 * single unidentifiable card takes a whole indexing shard with it.
 */
export const MATERIALIZATION_PURPOSES = [
  'host-display',
  'code-preview',
  'interactive-edit',
  'command-validation',
  'indexing',
] as const;

export type MaterializationPurpose = (typeof MATERIALIZATION_PURPOSES)[number];

/**
 * A runtime-local identity for an object that never leaves its runtime.
 *
 * The handle is a string, so it is cloneable and crosses freely; what it names
 * — a loaded class, a materialized instance — does not.
 *
 * A handle is an identifier, NOT a capability, and the distinction is the
 * issuing runtime's to enforce. Nothing about the type makes a handle
 * unguessable or scopes it to the consumer it was issued to; a registry that
 * mints sequential ids and resolves any handle for any caller satisfies this
 * type completely. A channel that accepts a handle from across a boundary
 * must therefore check that the peer sending it was the peer it was issued
 * to — holding a well-formed handle is not evidence of anything.
 */
declare const runtimeHandleBrand: unique symbol;

declare const boxelTypeHandleBrand: unique symbol;

declare const boxelInstanceHandleBrand: unique symbol;

export type RuntimeHandle = string & {
  readonly [runtimeHandleBrand]: true;
};

export type BoxelTypeHandle = RuntimeHandle & {
  readonly [boxelTypeHandleBrand]: true;
};

export type BoxelInstanceHandle = RuntimeHandle & {
  readonly [boxelInstanceHandleBrand]: true;
};

export const BOXEL_EXECUTION_MODES = ['direct', 'capsule', 'sandbox'] as const;

export type BoxelExecutionMode = (typeof BOXEL_EXECUTION_MODES)[number];

/**
 * What every tier's runtime offers, and nothing else (RP-14.2).
 *
 * Every argument and every result here is a handle, a record this module
 * proves cloneable, or a JSON:API document — which is what makes one interface
 * serve a local call, a call into a Compartment, and a call across a message
 * port without changing shape.
 *
 * The documents are the exception worth naming: `LooseCardResource` and
 * `LooseSingleCardDocument` do NOT satisfy `Cloneable`, and cannot be made to
 * — their `Meta` and `Relationship` members are index-signature-less
 * interfaces, and their attribute bags are `any`. They are cloneable in
 * practice because the wire format they describe is JSON, but that is a
 * property of the format rather than something proved here.
 *
 * Three things are deliberately absent:
 *
 * - **Mutation.** Writing is not an operation a tier may perform on its own;
 *   it is a `set` capability the Host grants, revokes, and re-authorizes on
 *   every use (RP-9.8).
 * - **Rendering.** Producing a mountable component is process-local and its
 *   result is not cloneable, so it cannot be a member of a tier-neutral
 *   interface. A tier's adapter offers its own render entry point beside this
 *   interface; what crosses is the projection, not the component.
 * - **Invoking an authored action.** An action belongs to a component
 *   instance, so it is the component runtime's to invoke — the result crosses
 *   back as a `ComponentUpdate`.
 *
 * The set is closed in the sense that matters: a tier needing a *cross-
 * boundary* behavior these cannot express is a spec change. A tier-local
 * capability its own Host code calls directly — source volatility, instance
 * sync — is not an operation on this interface and does not belong here.
 */
export interface BoxelRuntime {
  readonly mode: BoxelExecutionMode;

  loadBoxel(ref: CodeRef): Promise<BoxelTypeHandle>;

  createFromSerialized(
    resource: LooseCardResource,
    document: LooseSingleCardDocument,
    relativeTo: RealmResourceIdentifier | undefined,
    purpose: MaterializationPurpose,
  ): Promise<BoxelInstanceHandle>;

  describeBoxel(boxel: BoxelTypeHandle): Promise<BoxelDescription>;

  getFields(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
  ): Promise<ResolvedField[]>;

  getField(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
    fieldName: string,
  ): Promise<ResolvedField | undefined>;

  projectInstance(instance: BoxelInstanceHandle): Promise<InstanceProjection>;

  serializeCard(
    instance: BoxelInstanceHandle,
  ): Promise<LooseSingleCardDocument>;

  dispose(handle: RuntimeHandle): Promise<void>;
}

export const BOXEL_RUNTIME_OPERATIONS = [
  'loadBoxel',
  'createFromSerialized',
  'describeBoxel',
  'getFields',
  'getField',
  'projectInstance',
  'serializeCard',
  'dispose',
] as const;

export type BoxelRuntimeOperation = (typeof BOXEL_RUNTIME_OPERATIONS)[number];

/**
 * The list above and the interface name the same operations, proved rather
 * than maintained. `Exact` resolves to its first argument, so this costs
 * nothing; instantiating it in both directions means a method added to
 * `BoxelRuntime` without a list entry, or a list entry naming no method,
 * fails to compile here.
 *
 * Without it the two drift silently, and a transport that dispatches by name
 * off the list stops offering an operation the interface promises.
 */
type Exact<A extends B, B> = A;

export type BoxelRuntimeOperationsAreExact = Exact<
  BoxelRuntimeOperation,
  Exclude<keyof BoxelRuntime, 'mode'>
> &
  Exact<Exclude<keyof BoxelRuntime, 'mode'>, BoxelRuntimeOperation>;
