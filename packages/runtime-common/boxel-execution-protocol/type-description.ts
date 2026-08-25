/**
 * What a consumer needs to know about a Boxel type, as data.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

import type * as JSONTypes from 'json-typescript';

import type { CodeRef } from '../code-ref.ts';
import type { Cloneable } from './cloneable.ts';
import type { ProtocolEnvelope } from './version.ts';

// Stated as types rather than as `as const` arrays: an exported array reads
// as a vocabulary a gate enforces, and nothing enforces these two. The gate
// that would — a per-record shape check over a `BoxelDescription` — belongs
// with the projection pipeline that produces one.
export type BoxelKind = 'card' | 'field' | 'file';

export type FieldKind = 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';

/**
 * One field a Boxel type declares.
 *
 * Deliberately no `Field` object, no field-class constructor, no serializer,
 * no getter, and no component definition: those stay with the runtime that
 * loaded the type.
 *
 * The member names deliberately avoid `fieldType`. Main's own descriptor
 * (RP-3.6) uses that name for the *kind* string — `contains`, `linksTo` — so
 * reusing it here for the type's code ref would give one name two meanings
 * across two sections of the same spec. `type` is the ref, `kind` is the kind,
 * and neither reads as the other.
 *
 * Configuration is absent here on purpose. Resolution runs with the owning
 * root instance as `this` and memoizes per `(instance, fieldName)`
 * (RP-5.1–5.2), so a description of a *type* has nothing to resolve against.
 * The resolved data belongs to `ResolvedField`, which an instance-aware
 * operation produces.
 */
export type FieldDescription = Cloneable<{
  fieldName: string;
  type: CodeRef;
  kind: FieldKind;
  isComputed: boolean;
}>;

/**
 * One field as an instance actually has it: the type's declaration plus the
 * configuration resolved against the instance that owns it.
 *
 * This is what `getFields`/`getField` answer with. `resolvedConfiguration` is
 * the resolved configuration *data*, never the functions that produced it — a
 * configuration function runs with its semantic owner and only its result
 * crosses (RP-5.4) — and is `null` for a field that configures nothing.
 *
 * The field's *value* is deliberately absent: it lives in the instance
 * projection's `model`, and carrying it twice would let the two disagree.
 */
export type ResolvedField = Cloneable<{
  fieldName: string;
  type: CodeRef;
  kind: FieldKind;
  isComputed: boolean;
  resolvedConfiguration: JSONTypes.Value | null;
}>;

/**
 * One format a type can render, and who supplies it. The format is an open
 * string so a new authored format needs no protocol release; the provider
 * identifies the executable owner without transferring its definition.
 */
export type FormatDescription = Cloneable<{
  format: string;
  provider: {
    kind: 'authored' | 'trusted-base';
    ref: CodeRef;
  };
}>;

/** The author-declared statics the Host reads to present a type (RP-11.1). */
export type TypePresentation = Cloneable<{
  displayName: string;
  headerColor: string | null;
  prefersWideFormat: boolean;
}>;

/** Everything a consumer needs to know about a type, as data. */
export type BoxelDescription = Cloneable<
  ProtocolEnvelope & {
    ref: CodeRef;
    boxelKind: BoxelKind;
    ancestors: CodeRef[];
    fields: FieldDescription[];
    formats: FormatDescription[];
    presentation: TypePresentation;
    executionHints: {
      // An author may always ask for a stronger cage; nothing here can ask
      // for a weaker one (RP-6.1).
      prefersFullSandbox: boolean;
    };
  }
>;
