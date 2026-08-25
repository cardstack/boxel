/**
 * One instance's state as data, with linked values as references rather than
 * expanded graphs.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

import type * as JSONTypes from 'json-typescript';

import type { CodeRef } from '../code-ref.ts';
import type { RealmResourceIdentifier } from '../realm-identifiers.ts';
import type { Cloneable } from './cloneable.ts';
import { isPlainRecord, readMember } from './untrusted-input.ts';
import type { ProtocolEnvelope } from './version.ts';

/**
 * How a linked value appears in a projection: an identity and a type, which
 * the recipient resolves through the canonical Store — never the linked
 * card's own data. A card holding a link to a card holding a link does not
 * hand its recipient a graph to walk.
 */
export type BoxelValueReference = Cloneable<{
  $boxel: {
    id: RealmResourceIdentifier | null;
    type: CodeRef;
  };
}>;

/**
 * Reads a projected value as a link reference, or answers `undefined`.
 *
 * One read-and-return rather than a predicate beside a rebuild. Splitting them
 * meant the check and the rebuild reached the same member through different
 * channels — `.` for one, a property descriptor for the other — and a Proxy
 * needs no state at all to answer them differently. What came back was a value
 * typed `BoxelValueReference` carrying a live function, which the caller then
 * resolved through the Store and `structuredClone` refused.
 *
 * Exact by design, at every level: a `$boxel` marker carrying anything beyond
 * `id` and `type`, or sitting beside sibling members, is an expanded graph
 * wearing a reference's clothes. Member names are read as own data — a
 * non-enumerable extra is still an extra — and every value the result carries
 * was validated as the string it claims to be, so nothing here rests on a cast.
 */
export function readBoxelValueReference(
  value: unknown,
): BoxelValueReference | undefined {
  try {
    if (!isPlainRecord(value) || !hasExactOwnKeys(value, ['$boxel'])) {
      return undefined;
    }
    let marker = readMember(value, '$boxel');
    if (!isPlainRecord(marker) || !hasExactOwnKeys(marker, ['id', 'type'])) {
      return undefined;
    }
    let id = readMember(marker, 'id');
    if (!(id === null || typeof id === 'string')) {
      return undefined;
    }
    let type = readExactCodeRef(readMember(marker, 'type'));
    if (type === undefined) {
      return undefined;
    }
    return { $boxel: { id: id as RealmResourceIdentifier | null, type } };
  } catch {
    // A predicate whose contract is to answer must not throw instead: a marker
    // built from a throwing accessor is simply not a reference.
    return undefined;
  }
}

/**
 * Whether a projected value is a link reference rather than data.
 *
 * Defined as the read succeeding, so the two can never disagree. Prefer
 * `readBoxelValueReference` wherever the answer is acted on — this reports
 * about the caller's object and leaves the caller holding it.
 */
export function isBoxelValueReference(
  value: unknown,
): value is BoxelValueReference {
  return readBoxelValueReference(value) !== undefined;
}

/**
 * Whether an object's own property names are exactly `expected` — enumerable
 * or not.
 *
 * `Object.keys` would skip a non-enumerable member, and a member the check
 * skipped is still reachable by whoever holds the object. That is how an
 * entire card rides inside a value that answers "reference".
 */
function hasExactOwnKeys(source: object, expected: string[]): boolean {
  let names = Object.getOwnPropertyNames(source);
  if (names.length !== expected.length) {
    return false;
  }
  let sorted = [...names].sort();
  let wanted = [...expected].sort();
  return (
    sorted.every((name, index) => name === wanted[index]) &&
    Object.getOwnPropertySymbols(source).length === 0
  );
}

/**
 * How deep an `ancestorOf` / `fieldOf` chain may nest before it is refused.
 * Real refs are one or two levels; the bound exists because the value is the
 * far side's to shape.
 */
const MAX_CODE_REF_DEPTH = 16;

/**
 * Reads a code ref carrying its own members and nothing else, rebuilt.
 *
 * Stricter than `isCodeRef`, and deliberately not delegating to it. That
 * predicate answers "can this be read as a ref", which is right for a document
 * whose resources may carry more than one reader needs; here the question is
 * whether a value is a reference *instead of* data, and a ref admitting extra
 * members lets an entire card ride inside `type`. It also reads through `.`,
 * so a value it validated is not the value a descriptor read returns — which
 * is the whole reason this rebuilds rather than reporting.
 *
 * A predicate whose contract is to answer must not throw, so the traversal is
 * bounded here: `isCodeRef` recurses without a bound of its own.
 */
function readExactCodeRef(
  ref: unknown,
  depth = MAX_CODE_REF_DEPTH,
): CodeRef | undefined {
  if (depth <= 0 || !isPlainRecord(ref)) {
    return undefined;
  }
  // A ref inheriting a discriminator reads as one form here and another at the
  // Store, so the prototype is part of the shape.
  let prototype = Object.getPrototypeOf(ref);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  let discriminator = readMember(ref, 'type');
  if (discriminator === 'ancestorOf') {
    if (!hasExactOwnKeys(ref, ['card', 'type'])) {
      return undefined;
    }
    let card = readExactCodeRef(readMember(ref, 'card'), depth - 1);
    return card === undefined ? undefined : { type: 'ancestorOf', card };
  }
  if (discriminator === 'fieldOf') {
    if (!hasExactOwnKeys(ref, ['card', 'field', 'type'])) {
      return undefined;
    }
    let field = readMember(ref, 'field');
    let card = readExactCodeRef(readMember(ref, 'card'), depth - 1);
    if (typeof field !== 'string' || card === undefined) {
      return undefined;
    }
    return { type: 'fieldOf', card, field };
  }
  if (!hasExactOwnKeys(ref, ['module', 'name'])) {
    return undefined;
  }
  let module = readMember(ref, 'module');
  let name = readMember(ref, 'name');
  if (typeof module !== 'string' || typeof name !== 'string') {
    return undefined;
  }
  return { module: module as RealmResourceIdentifier, name };
}

/**
 * One instance's state, as data.
 *
 * `model` carries declared field values and the JSON-safe results of getters
 * the owning runtime evaluated. Linked values appear as
 * `BoxelValueReference`s — the projection is one instance deep, never an
 * expanded graph. The type system cannot state that rule (a reference is
 * structurally an object like any other), so the producer holds it: the
 * projection pipeline knows each field's kind and emits a reference for every
 * `linksTo`/`linksToMany`. `isBoxelValueReference` is how a consumer tells
 * the two apart.
 *
 * `revision` orders projections of one instance against each other. It is not
 * an etag and carries no server meaning — main's write path has no revision
 * token (RP-9.6) — it exists so a recipient can drop a projection that a
 * newer one has already superseded in flight.
 */
export type InstanceProjection = Cloneable<
  ProtocolEnvelope & {
    id: RealmResourceIdentifier | null;
    type: CodeRef;
    revision: number;
    model: Record<string, JSONTypes.Value>;
    presentation: InstancePresentation;
  }
>;

/**
 * What the Host's own chrome needs in order to wrap an instance, derived
 * Host-side and crossed as data.
 *
 * The theme members are why this record exists rather than being read out of
 * `model`. A themed card's stylesheet lives on a *linked* Theme card, which a
 * projection carries only as a reference — resolving it is exactly the graph
 * walk the projection forbids. So the Host resolves the theme once, against
 * the canonical instance, and the three derived strings cross:
 *
 * - `themeScope` is the `data-boxel-theme-scope` token, a content hash of the
 *   theme's id and CSS (RP-11.3), so shared themes emit one stylesheet and
 *   prerendered HTML stays stable across processes.
 * - `themeCss` is the theme's raw custom-property block, from which the
 *   scoped stylesheet compiles.
 * - `cssImports` are the stylesheet imports the theme depends on, typically
 *   font faces.
 *
 * A tier makes the same trusted `CardContainer` invocation main makes from
 * these; without them a themed card renders unthemed, which is not a degraded
 * theme but a different design.
 *
 * `isThemed` is carried rather than derived, because neither `theme` nor
 * `themeCss` implies it. Base answers the question two different ways
 * (`hasTheme`, `field-component.gts`): an ordinary card is themed when it
 * links a Theme, but a Theme card previewing its own CSS is themed when that
 * CSS is non-empty — and such a card links no Theme at all, so `theme` is
 * `null` while the three derived strings are not. Reading `theme !== null` as
 * "themed" renders a Theme card's own preview without the CSS it exists to
 * show; reading `themeCss !== null` gets the converse wrong, since a card
 * linking a Theme whose variables are empty is still themed.
 */
export type InstancePresentation = Cloneable<{
  title: string | null;
  summary: string | null;
  thumbnailURL: string | null;
  isThemed: boolean;
  theme: BoxelValueReference | null;
  themeScope: string | null;
  themeCss: string | null;
  cssImports: string[] | null;
}>;
