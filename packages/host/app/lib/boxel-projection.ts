import { themeScope } from '@cardstack/boxel-ui/helpers';

import {
  cardDefFormats,
  fieldDefFormats,
  fileDefFormats,
  getAncestor,
  identifyCard,
  isBaseDefInstance,
  isFieldDef,
  isFileDef,
  moduleFrom,
} from '@cardstack/runtime-common';
import type {
  BoxelDescription,
  BoxelKind,
  BoxelValueReference,
  FieldDescription,
  FieldKind,
  FormatDescription,
  InstancePresentation,
  InstanceProjection,
  ResolvedField,
  TypePresentation,
} from '@cardstack/runtime-common/boxel-execution-protocol';
import { defineMember } from '@cardstack/runtime-common/boxel-execution-protocol/untrusted-input';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';
import type { Format } from '@cardstack/runtime-common/formats';
import type { RealmResourceIdentifier } from '@cardstack/runtime-common/realm-identifiers';

import { isTrustedModule } from './trusted-modules';

import type {
  BaseDef,
  BaseDefConstructor,
  CardDef,
  Field,
} from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';

type CardAPIModule = typeof CardAPI;

/**
 * One JSON value, taken from the record that defines what a model may hold
 * rather than from the `json-typescript` package the protocol module reads it
 * out of. The Host does not depend on that package, and a hand-written copy of
 * the type would be a second definition of "what is data" beside the one the
 * boundary actually enforces.
 */
type JsonValue = InstanceProjection['model'][string];

/**
 * The one place a live Boxel type or instance is read into inert values.
 *
 * The projection pipeline has two halves and this file is the first:
 * everything that touches the Card API, the Loader, or a live instance
 * happens here, and `boxel-render-record.ts` assembles the protocol's records
 * out of what this produced without reading anything live. The split is what
 * makes the second half provably pure, and one capture is what keeps
 * `describeBoxel`, `getFields` and `projectInstance` from being able to
 * disagree — three answers built from one read of one instance.
 *
 * There is exactly one of these. A second one is the failure this design
 * exists to prevent: competing builders each agree with themselves, so nothing
 * goes red until two of them are compared, and by then every consumer has
 * grown a preference for one of the answers.
 *
 * What leaves here is values, never the objects they came from — a plain graph
 * of strings, numbers, booleans, nulls, arrays and plain objects. The
 * assembler re-reads that graph through the protocol's own normalizer, so an
 * accessor or a class instance that reached a captured member is refused there
 * rather than at the far side of a boundary.
 *
 * Where this reads is the runtime that owns the instance. Direct owns the
 * Host's, so an authored `computeVia` runs here exactly as it runs on every
 * render main performs — what makes the result tier-neutral is that the record
 * carries the value and not the code, so another tier computes the same member
 * with its own copy of the same authored function.
 */

/**
 * A type's description, minus the envelope the assembler stamps.
 *
 * Spelled as an `Omit` of the record rather than as its own shape, so a member
 * added to `BoxelDescription` is a compile error here rather than a member the
 * capture silently stops supplying.
 */
export type CapturedBoxelType = Omit<
  BoxelDescription,
  'protocolVersion' | 'requiredFeatures'
>;

/**
 * An instance's projection, minus the envelope and the revision.
 *
 * `revision` is absent because it orders one runtime's projections of one
 * instance against each other (RP-14.1) — a fact about the runtime issuing
 * them rather than about the instance, which the capture would have to invent
 * a clock to supply.
 */
export type CapturedBoxelInstance = Omit<
  InstanceProjection,
  'protocolVersion' | 'requiredFeatures' | 'revision'
>;

/** One instance read once: its type, its projection, and its fields. */
export interface CapturedBoxelSemantics {
  type: CapturedBoxelType;
  instance: CapturedBoxelInstance;
  fields: ResolvedField[];
}

/**
 * Reads a Boxel type into the values a `BoxelDescription` is built from.
 *
 * Configuration is deliberately not read here: resolution runs with the owning
 * root instance as `this` and memoizes per `(instance, fieldName)`
 * (RP-5.1–5.2), so a type has nothing to resolve against. `captureBoxelFields`
 * is the instance-aware counterpart that produces resolved configuration.
 */
export function captureBoxelType(
  boxelType: BaseDefConstructor,
  api: CardAPIModule,
): CapturedBoxelType {
  let kind = boxelKindOf(boxelType);
  return {
    ref: codeRefFor(boxelType),
    boxelKind: kind,
    ancestors: ancestorRefs(boxelType),
    fields: Object.entries(
      api.getFields(boxelType, { includeComputeds: true }),
    ).map(([fieldName, field]) => describeField(fieldName, field, boxelType)),
    formats: formatDescriptions(boxelType, kind),
    presentation: typePresentation(boxelType),
    executionHints: {
      // An author may always ask for a stronger cage; nothing here can ask for
      // a weaker one (RP-6.1), so this reads as a positive-only signal — any
      // value but `true` leaves the type where classification put it.
      prefersFullSandbox:
        (boxelType as BaseDefConstructor & { prefersFullSandbox?: unknown })
          .prefersFullSandbox === true,
    },
  };
}

/**
 * Reads a live instance into the values an `InstanceProjection` and its
 * `ResolvedField`s are built from.
 *
 * The three are produced together because they are three views of one read:
 * the field list says what the instance declares and the model says what those
 * declarations currently hold, and a card whose fields and model were read at
 * different moments describes a state the instance was never in.
 */
export function captureBoxelInstance(
  instance: BaseDef,
  api: CardAPIModule,
): CapturedBoxelSemantics {
  let boxelType = instance.constructor as BaseDefConstructor;
  return {
    type: captureBoxelType(boxelType, api),
    instance: {
      id: instanceId(instance),
      type: codeRefFor(boxelType),
      model: captureModel(instance, api),
      presentation: capturePresentation(instance, api),
    },
    fields: captureBoxelFields(instance, api),
  };
}

/**
 * Every field an instance declares, with the configuration resolved against
 * that instance (RP-5.1–5.2).
 *
 * The field's value is deliberately absent: it lives in the projection's
 * model, and carrying it in both places is how the two learn to disagree.
 */
export function captureBoxelFields(
  instance: BaseDef,
  api: CardAPIModule,
): ResolvedField[] {
  let boxelType = instance.constructor as BaseDefConstructor;
  return Object.entries(
    api.getFields(instance, { includeComputeds: true }),
  ).map(([fieldName, field]) => ({
    ...describeField(fieldName, field, boxelType),
    resolvedConfiguration:
      dataValue(resolveFieldConfiguration(api, field, instance)) ?? null,
  }));
}

/**
 * A type's fields with nothing resolved against an instance.
 *
 * This is what `getFields` answers with when it was handed a type rather than
 * an instance. Every `resolvedConfiguration` is `null` — not because these
 * fields configure nothing, but because resolution has no `this` to run with
 * (RP-5.1). Constructing a throwaway instance to give it one would run an
 * authored constructor to answer a question about a declaration, and answer it
 * against a card no user has.
 */
export function captureUnresolvedFields(
  boxelType: BaseDefConstructor,
  api: CardAPIModule,
): ResolvedField[] {
  return Object.entries(
    api.getFields(boxelType, { includeComputeds: true }),
  ).map(([fieldName, field]) => ({
    ...describeField(fieldName, field, boxelType),
    resolvedConfiguration: null,
  }));
}

function describeField(
  fieldName: string,
  field: Field<BaseDefConstructor>,
  owner: BaseDefConstructor,
): FieldDescription {
  let type = identifyCard(field.card);
  if (!type) {
    throw new Error(
      `Cannot describe field '${fieldName}' of Boxel type '${owner.name}': ` +
        `its type has no code reference, so no consumer could name it`,
    );
  }
  return {
    fieldName,
    type,
    kind: field.fieldType as FieldKind,
    isComputed: Boolean(field.computeVia),
    // Carried beside `isComputed` rather than folded into one writability
    // flag, because render-time writability is
    // `(not computeVia) ∧ (not queryDefinition) ∧ permissions.canWrite`
    // (RP-9.1) and the third term is context the Host pushes, not a fact about
    // the field. A record answering "writable" would have to either guess the
    // permissions or answer for whichever surface happened to build it.
    isQueryBacked: Boolean(field.queryDefinition),
  };
}

/**
 * The formats a type can render, and who supplies each one.
 *
 * The inventory is per kind (RP-2.2) and slot resolution is plain static
 * inheritance (RP-2.3), so the provider is the nearest class in the ancestry
 * that declares the slot as its own static. Classifying that class by whether
 * its module is Host-owned is what tells an authored format from a
 * trusted-Base fallback: a card that declares no `fitted` renders Base's, and
 * a consumer that could not tell the two apart would treat Base's default as
 * authored output — and cage a render that has no authored code in it.
 *
 * A slot no class in the ancestry declares is absent from the inventory rather
 * than present-and-undefined. Main resolves such a slot to `undefined` and
 * fails the render (RP-2.9); describing it as a format a consumer may ask for
 * would promise a render that cannot happen.
 */
function formatDescriptions(
  boxelType: BaseDefConstructor,
  kind: BoxelKind,
): FormatDescription[] {
  return formatInventory(kind).flatMap((format): FormatDescription[] => {
    let provider = formatProvider(boxelType, format);
    if (!provider) {
      return [];
    }
    let ref = identifyCard(provider);
    if (!ref) {
      return [];
    }
    return [
      {
        format,
        provider: {
          kind: isTrustedModule(moduleFrom(ref)) ? 'trusted-base' : 'authored',
          ref,
        },
      },
    ];
  });
}

/**
 * The renderable slots a kind declares (RP-2.2).
 *
 * `format` is an open string on the record so a new authored format needs no
 * protocol release (RP-14.1); this list is only where the search starts.
 */
function formatInventory(kind: BoxelKind): Format[] {
  switch (kind) {
    case 'field':
      return fieldDefFormats;
    case 'file':
      return fileDefFormats;
    case 'card':
      return cardDefFormats;
  }
}

function formatProvider(
  boxelType: BaseDefConstructor,
  format: string,
): BaseDefConstructor | undefined {
  let current: BaseDefConstructor | undefined = boxelType;
  while (current) {
    if (Object.prototype.hasOwnProperty.call(current, format)) {
      return current;
    }
    current = getAncestor(current);
  }
  return undefined;
}

/** The author-declared statics the Host reads to present a type (RP-11.1). */
function typePresentation(boxelType: BaseDefConstructor): TypePresentation {
  let statics = boxelType as BaseDefConstructor & {
    headerColor?: unknown;
    prefersWideFormat?: unknown;
  };
  return {
    // `displayName` is the author's; the class's own `name` is what main falls
    // back to when an author declared none.
    displayName:
      typeof boxelType.displayName === 'string'
        ? boxelType.displayName
        : boxelType.name,
    headerColor:
      typeof statics.headerColor === 'string' ? statics.headerColor : null,
    prefersWideFormat: statics.prefersWideFormat === true,
  };
}

function boxelKindOf(boxelType: BaseDefConstructor): BoxelKind {
  if (isFileDef(boxelType)) {
    return 'file';
  }
  if (isFieldDef(boxelType)) {
    return 'field';
  }
  return 'card';
}

function ancestorRefs(boxelType: BaseDefConstructor): CodeRef[] {
  let refs: CodeRef[] = [];
  let current = getAncestor(boxelType);
  while (current) {
    let ref = identifyCard(current);
    if (ref) {
      refs.push(ref);
    }
    current = getAncestor(current);
  }
  return refs;
}

function codeRefFor(boxelType: BaseDefConstructor): CodeRef {
  let ref = identifyCard(boxelType);
  if (!ref) {
    throw new Error(
      `Cannot describe Boxel type '${boxelType.name}' before it has a code reference`,
    );
  }
  return ref;
}

function instanceId(instance: BaseDef): RealmResourceIdentifier | null {
  let id = (instance as BaseDef & { id?: unknown }).id;
  return typeof id === 'string' ? (id as RealmResourceIdentifier) : null;
}

/**
 * The instance's declared field values, as data.
 *
 * Two rules divide the field kinds, and they are what bounds a projection at
 * all:
 *
 * - `contains` / `containsMany` values are embedded composite data, never a
 *   separate resource (RP-3.3), so they expand in place.
 * - `linksTo` / `linksToMany` name a separate resource, so they cross as
 *   `{$boxel:{id,type}}` identity and nothing else (RP-14.1). A card linking a
 *   card linking a card hands its recipient no graph to walk; the recipient
 *   resolves an identity through the canonical Store, which stays the single
 *   owner of card data.
 *
 * A field whose compute throws is not caught. Main has no error boundary
 * around computes — a throwing `computeVia` fails the render and chrome
 * presents the error (RP-4.5) — so swallowing it here would make this
 * projection answer where main refuses, and every tier reading the projection
 * would render a card main cannot.
 */
function captureModel(
  instance: BaseDef,
  api: CardAPIModule,
): Record<string, JsonValue> {
  let model: Record<string, JsonValue> = {};
  for (let [fieldName, field] of Object.entries(
    api.getFields(instance, { includeComputeds: true }),
  )) {
    defineMember(
      model,
      fieldName,
      captureFieldValue(
        instance,
        fieldName,
        field.fieldType,
        api,
        new WeakSet(),
      ),
    );
  }
  return model;
}

function captureFieldValue(
  instance: BaseDef,
  fieldName: string,
  kind: Field<BaseDefConstructor>['fieldType'],
  api: CardAPIModule,
  seen: WeakSet<object>,
): JsonValue {
  if (kind === 'linksTo' || kind === 'linksToMany') {
    let slots = linkSlots(instance, fieldName, api);
    return kind === 'linksToMany' ? slots : (slots[0] ?? null);
  }
  let value = api.peekAtField(instance, fieldName);
  if (kind === 'containsMany') {
    return Array.isArray(value)
      ? value.map((entry) => captureValue(entry, api, seen))
      : [];
  }
  return captureValue(value, api, seen);
}

/**
 * One link field's slots, in document order, as identity references.
 *
 * Reading the field's own getter first is what starts resolution at all: the
 * field getter is the lazy-load trigger (RP-7.2), and for a query-backed field
 * it is what creates the search resource whose membership is read below. This
 * is the read a live template performs on every render, over the same
 * canonical instance, so it is main's behavior rather than new authority.
 *
 * Only a `present` slot yields a reference. The other four states (RP-7.1)
 * have a reference string but no loaded value, and therefore no *actual*
 * class — a reference built from the field's declared type would name a
 * supertype of whatever eventually loads, and every trust decision follows an
 * instance's actual class, never a field's declared type. They project as
 * `null`, which is what the ordinary getter answers for them anyway. Slot
 * positions survive, so a plural field's length is the length a template
 * iterating it sees (RP-7.5).
 *
 * Which state a non-present slot is in is not carried here. The ordinary
 * getter cannot tell them apart either — `getRelationshipMembershipState` is
 * the only sanctioned structured observation (RP-7.1) — and the broken-link
 * presentation that consumes it (RP-7.4) is chrome the Host renders, not model
 * data a card reads.
 */
function linkSlots(
  instance: BaseDef,
  fieldName: string,
  api: CardAPIModule,
): (BoxelValueReference | null)[] {
  void (instance as unknown as Record<string, unknown>)[fieldName];
  let { membership } = api.getRelationshipMembershipState(
    instance as CardDef,
    fieldName,
  );
  return (membership ?? []).map((slot) =>
    slot.kind === 'present' ? boxelReference(slot.value) : null,
  );
}

/**
 * One value as data: a composite expanded through its own declared fields, a
 * card as a reference, anything else as JSON.
 */
function captureValue(
  value: unknown,
  api: CardAPIModule,
  seen: WeakSet<object>,
): JsonValue {
  if (!isBaseDefInstance(value)) {
    return dataValue(value) ?? null;
  }
  if (seen.has(value)) {
    // The identity map makes one instance reachable twice inside a single
    // composite tree (RP-8.2). Degrading the second reach to identity keeps
    // the walk finite without deciding which path was the real one.
    return boxelReference(value);
  }
  seen.add(value);
  try {
    let expanded: Record<string, JsonValue> = {};
    for (let [fieldName, field] of Object.entries(
      api.getFields(value, { includeComputeds: true }),
    )) {
      defineMember(
        expanded,
        fieldName,
        captureFieldValue(value, fieldName, field.fieldType, api, seen),
      );
    }
    captureTrustedGetters(value, expanded);
    return expanded;
  } finally {
    seen.delete(value);
  }
}

/**
 * The plain prototype getters a trusted Base value exposes, evaluated once
 * Host-side and carried as data (RP-5.4).
 *
 * A plain class getter is not a field: `getFields` cannot see it, it is never
 * serialized, and it is reachable only as `@model.x` (RP-4.4). So a currency
 * field's `symbol` is present on the live instance and absent from every
 * field-derived view of it, and a tier holding only the field-derived view
 * renders a different card than main does.
 *
 * Only trusted Base classes are read. An authored getter runs in the tier that
 * owns the authored code (RP-5.4), so evaluating one here would both execute
 * authored code where it does not belong and produce a value the authored tier
 * computes again anyway. The chain is walked while the owning class stays
 * trusted and stops at the first class that is not, so a trusted Base value an
 * author subclassed contributes its Base getters and none of the author's.
 *
 * A field of the same name wins: the field is the serialized, indexed,
 * `<@fields.x/>`-reachable one, and a getter shadowing it here would make the
 * model disagree with the field list built from the same read.
 *
 * A getter that throws, or that answers with something other than data, is
 * omitted rather than propagated. This walk reads every getter a class exposes
 * where a render reads only the ones its template names, so a throw here is a
 * value main might never have asked for; failing the whole projection on it
 * would refuse renders main completes.
 */
function captureTrustedGetters(
  value: BaseDef,
  expanded: Record<string, JsonValue>,
): void {
  let prototype = Object.getPrototypeOf(value) as object | null;
  while (prototype && prototype !== Object.prototype) {
    let owner = (prototype as { constructor?: BaseDefConstructor }).constructor;
    let ref = owner ? identifyCard(owner) : undefined;
    if (!ref || !isTrustedModule(moduleFrom(ref))) {
      return;
    }
    for (let name of Object.getOwnPropertyNames(prototype)) {
      if (
        name === 'constructor' ||
        Object.prototype.hasOwnProperty.call(expanded, name)
      ) {
        continue;
      }
      let getter = Object.getOwnPropertyDescriptor(prototype, name)?.get;
      if (!getter) {
        continue;
      }
      try {
        let projected = dataValue(getter.call(value));
        if (projected !== undefined) {
          defineMember(expanded, name, projected);
        }
      } catch {
        // Named above: a getter this walk asked for and a render would not.
      }
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
}

/**
 * What the Host's own chrome needs in order to wrap this instance (RP-11).
 *
 * Every member is read the way main reads it. `cardTitle`, `cardDescription`
 * and `cardThumbnailURL` are ordinary property reads rather than data-bucket
 * peeks, because they are computed mirrors of `cardInfo` (RP-11.2) that an
 * authored prototype getter may shadow — a peek reads the framework bucket and
 * misses the shadow, so the projected title would regress to the computed
 * default on exactly the cards that took the trouble to set one.
 */
function capturePresentation(
  instance: BaseDef,
  api: CardAPIModule,
): InstancePresentation {
  return {
    title: readString(instance, 'cardTitle', api),
    summary: readString(instance, 'cardDescription', api),
    thumbnailURL: readString(instance, 'cardThumbnailURL', api),
    ...captureTheme(instance, api),
  };
}

/**
 * The theme members a themed card's trusted `CardContainer` invocation
 * requires (RP-11.3), derived Host-side from the canonical instance.
 *
 * They are derived rather than resolved from the projection because a themed
 * card's stylesheet lives on a *linked* Theme card, which the projection
 * carries only as a reference — resolving that reference is exactly the graph
 * walk a projection forbids. So the Host resolves it once, here, and the
 * derived strings cross as data. Without them a themed card renders unthemed,
 * which is not a degraded theme but a different design.
 *
 * The branch reproduces `field-component.gts`'s own `isThemeCard` / `themeCss`
 * / `hasTheme` / `themeId` / `getCssImports`, which are module-private there. A
 * card declaring its own `cssVariables` through a `CSSField` is a Theme card
 * and scopes to its own identity; every other card scopes to the Theme its
 * `cardTheme` mirror links.
 *
 * `isThemed` is carried rather than derived from the other members because
 * Base answers it two ways: an ordinary card is themed when it links a Theme,
 * and a Theme card previewing its own CSS is themed when that CSS is
 * non-empty — and such a card links no Theme at all. Reading `theme !== null`
 * as "themed" renders a Theme card's preview without the CSS it exists to
 * show; reading `themeCss !== null` gets the converse wrong, since a card
 * linking a Theme whose variables are empty is still themed.
 */
function captureTheme(
  instance: BaseDef,
  api: CardAPIModule,
): Pick<
  InstancePresentation,
  'isThemed' | 'theme' | 'themeScope' | 'themeCss' | 'cssImports'
> {
  const unthemed = {
    isThemed: false,
    theme: null,
    themeScope: null,
    themeCss: null,
    cssImports: null,
  };
  let source: BaseDef;
  let themeId: string | null;
  let themeCss: string | null;
  let theme: BoxelValueReference | null;
  if (fieldTypedAs(instance, 'cssVariables', 'CSSField', api)) {
    themeCss = readString(instance, 'cssVariables', api);
    if (!themeCss?.trim()) {
      // A Theme card with nothing in its variables is not previewing a theme,
      // which is exactly where Base's two answers differ: the linked branch
      // below stays themed on empty variables and this one does not.
      return unthemed;
    }
    source = instance;
    themeId = instanceId(instance);
    theme = null;
  } else {
    // `cardTheme` is CardDef's computed `linksTo` mirror of `cardInfo.theme`,
    // and main reads it as an ordinary property read. A peek would miss it
    // entirely: a computed relationship's value never lands in the framework
    // bucket. The compute's own read of `cardInfo.theme` is RP-7.2's lazy-load
    // trigger — the read main performs on every themed render.
    let linked = hasField(instance, 'cardTheme', api)
      ? (instance as unknown as Record<string, unknown>).cardTheme
      : undefined;
    if (!isBaseDefInstance(linked)) {
      return unthemed;
    }
    source = linked;
    themeId = instanceId(linked);
    themeCss = readString(linked, 'cssVariables', api);
    theme = boxelReference(linked);
  }
  return {
    isThemed: true,
    theme,
    // Null where the content hash cannot be formed — an unsaved Theme card
    // previewing its own CSS has no id to hash. Main falls back to a
    // per-process guid there, and a guid is not a scope this record can carry:
    // the token has to be stable across processes so prerendered HTML and a
    // live render agree (RP-11.3), and a per-process one is neither derivable
    // by a consumer nor comparable between tiers. A Host wrapper does what
    // main does with the null.
    themeScope: themeScope(themeId, themeCss) ?? null,
    themeCss,
    cssImports: cssImportsOf(source, api),
  };
}

/**
 * The stylesheet imports a theme depends on, typically font faces.
 *
 * Read off the theme source the same way main's `getCssImports` does — the
 * card's own `cssImports` when it declares one through a `CssImportField`,
 * which is what makes a Theme card previewing itself carry its own fonts.
 */
function cssImportsOf(source: BaseDef, api: CardAPIModule): string[] | null {
  if (!fieldTypedAs(source, 'cssImports', 'CssImportField', api)) {
    return null;
  }
  let imports = (source as unknown as Record<string, unknown>).cssImports;
  if (!Array.isArray(imports)) {
    return null;
  }
  let entries = imports.filter(
    (entry): entry is string => typeof entry === 'string',
  );
  return entries.length > 0 ? entries : null;
}

/**
 * Whether an instance carries a field of `fieldName` whose declared type is
 * the Base class named by `typeName`.
 *
 * The name check is main's own (`isThemeCard` / `getCssImports` in
 * `field-component.gts`): a card is a Theme because its `cssVariables` is a
 * `CSSField`, not because it happens to have a member spelled that way.
 */
function fieldTypedAs(
  instance: BaseDef,
  fieldName: string,
  typeName: string,
  api: CardAPIModule,
): boolean {
  let field = (
    api.getFields(instance, { includeComputeds: true }) as Record<
      string,
      Field<BaseDefConstructor> | undefined
    >
  )[fieldName];
  return field?.card?.name === typeName;
}

function hasField(
  instance: BaseDef,
  fieldName: string,
  api: CardAPIModule,
): boolean {
  return fieldName in api.getFields(instance, { includeComputeds: true });
}

function readString(
  instance: BaseDef,
  fieldName: string,
  api: CardAPIModule,
): string | null {
  if (!hasField(instance, fieldName, api)) {
    return null;
  }
  let value = (instance as unknown as Record<string, unknown>)[fieldName];
  return typeof value === 'string' ? value : null;
}

function boxelReference(value: BaseDef): BoxelValueReference {
  let ref = identifyCard(value.constructor as BaseDefConstructor);
  if (!ref) {
    throw new Error(
      `Cannot reference a '${value.constructor.name}' instance whose type has no code reference`,
    );
  }
  return { $boxel: { id: instanceId(value), type: ref } };
}

/**
 * Field configuration resolved against the instance that owns it (RP-5.2).
 *
 * Read off the Card API module rather than imported, because the module is the
 * one the Loader served for this instance's Base realm, and a deployed Base
 * realm predating the operation has none. A card whose Base cannot resolve
 * configuration configures nothing, which is what it did before the operation
 * existed.
 */
function resolveFieldConfiguration(
  api: CardAPIModule,
  field: Field<BaseDefConstructor>,
  instance: BaseDef,
): unknown {
  let resolve = (
    api as CardAPIModule & {
      resolveFieldConfiguration?: (
        field: Field<BaseDefConstructor>,
        instance: BaseDef,
      ) => unknown;
    }
  ).resolveFieldConfiguration;
  return resolve ? resolve(field, instance) : undefined;
}

/**
 * One value as data, or `undefined` when it is not data at all.
 *
 * `undefined` is the answer for a function, a symbol, a class instance, and
 * anything else the boundary would refuse, so a caller can tell "this member
 * is absent" from "this member is null" — which is what lets the trusted-getter
 * walk omit a member rather than record a null the live instance never held.
 *
 * A `URL` becomes its href and a `Date` its ISO string, the spellings every
 * other view of the same value already uses.
 */
function dataValue(
  value: unknown,
  seen = new WeakSet<object>(),
): JsonValue | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof URL) {
    return value.href;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => dataValue(entry, seen) ?? null);
    }
    let prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    let plain: Record<string, JsonValue> = {};
    for (let [key, entry] of Object.entries(value)) {
      let projected = dataValue(entry, seen);
      if (projected !== undefined) {
        defineMember(plain, key, projected);
      }
    }
    return plain;
  } finally {
    seen.delete(value);
  }
}
