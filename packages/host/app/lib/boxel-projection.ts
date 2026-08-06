import { themeScope } from '@cardstack/boxel-ui/helpers';

import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  getAncestor,
  identifyCard,
  isBaseDefInstance,
  isFieldDef,
  isFileDef,
  Loader,
  maybeRelativeReference,
  moduleFrom,
  relativeTo as relativeToSymbol,
  resolveRRIReference,
  rri,
  type BoxelDescription,
  type BoxelKind,
  type BoxelValueReference,
  type CodeRef,
  type FieldDescription,
  type FormatDescription,
  type InstancePresentation,
  type JSONValue,
  type LooseSingleCardDocument,
  type RealmResourceIdentifier,
  type ResolvedField,
} from '@cardstack/runtime-common';

import type {
  BaseDef,
  BaseDefConstructor,
  CardDef,
  Field,
} from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';

type CardAPIModule = typeof CardAPI;

/**
 * The Host-side semantic projection of one canonical instance: the cloneable
 * description, resolved fields, and presentation that every execution tier
 * consumes as one `BoxelRenderRecord` shape (RP-14.4). Direct assembles its
 * record from this projection locally; boundary tiers adopt it so trusted
 * semantics materialize exactly once, Host-side, and cross as data (RP-5.4).
 */
export interface HostBoxelProjection {
  boxel: BoxelDescription;
  instanceId: string | null;
  fields: ResolvedField[];
  presentation: InstancePresentation;
  /**
   * Present only when this projection observed a `linksTo`/`linksToMany`
   * field not yet in RP-7.1's `present` state (still loading, or a
   * `linksToMany` slot not yet resolved). RP-7.3: the field renders absent
   * now and settles to the loaded card once resolution completes — main
   * gets this for free from Glimmer's own tracking, so a boundary tier that
   * captured this projection once needs an explicit way to observe the same
   * settle and re-project (RP-15.4's cross-tier obligation).
   *
   * Resolves once at least one previously-pending field changes state, with
   * a *fresh* projection reflecting whatever is true then (which may still
   * carry its own `onSettle` if something else is still pending). Resolves
   * to `undefined` if `signal` aborts first or the wait's bound elapses —
   * never rejects, never hangs a caller that stops observing.
   *
   * A function value, so it is never itself part of the cloneable record:
   * `structuredClone` cannot carry it, and no tier may retain a live
   * instance reference through it — the closure captured here re-derives
   * its own fresh, cloneable `HostBoxelProjection` on each settle rather
   * than exposing the canonical instance. Every consumer of this projection
   * (e.g. `capsule-boxel-runtime.ts`'s `adoptHostProjection`) must strip
   * this field before cloning the rest.
   */
  onSettle?: (signal: AbortSignal) => Promise<HostBoxelProjection | undefined>;
}

export interface HostBoxelProjectionOptions {
  /**
   * Writability is contextual authority supplied by the Host. The semantic
   * runtime never infers permission merely because it can read a value.
   */
  writableFields?: ReadonlySet<string>;
  /**
   * Convert an absolute instance URL to its registered scoped-identifier
   * form (`VirtualNetwork.unresolveURL`, e.g. `https://cardstack.com/base/
   * Theme/x` → `@cardstack/base/Theme/x`). A themed card's realm/prerender
   * pipeline stamps and compiles its theme stylesheet against a Theme
   * card's id in exactly this normalized form
   * (`unresolveResourceInstanceURLs` in `runtime-common/url.ts` runs on
   * every realm-served document); an execution document instead
   * deliberately keeps every instance id absolute for cross-boundary module
   * identity stability (RP-8.4, `useAbsoluteURL` in `boxel-execution.ts`'s
   * `requestFor`). Deriving the theme scope token from the raw absolute id
   * therefore produces a token that never matches the installed
   * stylesheet's selector. Omit to leave the theme's instance id
   * unnormalized.
   */
  unresolveURL?: (url: string) => string;
  /**
   * RP-7.2: the field getter is the lazy-load trigger — `presentRelationship
   * Values` below reads it before anything else. That trigger only actually
   * starts a fetch when the field's own owning instance is wired to a store
   * that can fetch (`getStore()`/the `stores` identity map in
   * card-api.gts): guaranteed for the canonical root instance the classic
   * (main) render path always reads through, not guaranteed for a nested
   * `contains()` field's own sub-instance (a themed card's `cardInfo.theme`,
   * reached by walking into `cardInfo`) — main's render never distinguishes
   * the two, so a Boxel that reads a not-loaded nested link can silently
   * never fetch it.
   *
   * Supplying this closes that gap explicitly: `presentRelationshipValues`
   * routes every `not-loaded` reference it finds through the same
   * store/card-service the classic path uses (`StoreService.get` in
   * `services/boxel-execution.ts`), then writes the resolved value directly
   * onto the field. The very next `getRelationshipMembershipState` read
   * (RP-7.1, e.g. `waitForAnyRelationshipToSettle`'s poll, already running
   * as part of RP-7.3) then sees the field as present and the existing
   * settle → republish → `@model` refresh chain takes over unchanged.
   */
  ensureRelationshipLoaded?: (reference: string) => Promise<unknown>;
}

/**
 * One `linksTo`/`linksToMany` field observed mid-resolution (RP-7.1: not yet
 * `present`, not yet a terminal failure) while building a projection.
 */
interface PendingRelationship {
  instance: BaseDef;
  fieldName: string;
}

/**
 * Project the cloneable semantic record inputs from a canonical instance.
 *
 * This is the one pipeline behind `buildBoxelRenderRecord()`: it executes with
 * the runtime that owns the live instance and produces only cloneable data, so
 * every tier's record agrees by construction rather than by re-derivation.
 */
export function projectHostBoxelSemantics(
  instance: BaseDef,
  api: CardAPIModule,
  options: HostBoxelProjectionOptions = {},
): HostBoxelProjection {
  let pending: PendingRelationship[] = [];
  let projection: HostBoxelProjection = {
    boxel: describeBoxelType(instance.constructor as BaseDefConstructor, api),
    instanceId: boxelInstanceId(instance),
    fields: resolveBoxelFields(
      instance,
      api,
      options.writableFields,
      (relationship) => pending.push(relationship),
      options.ensureRelationshipLoaded,
    ),
    presentation: projectInstancePresentation(
      instance,
      api,
      options.unresolveURL,
    ),
  };
  if (pending.length > 0) {
    projection.onSettle = (signal) =>
      waitThenReproject(pending, instance, api, options, signal);
  }
  return projection;
}

const SETTLE_FAST_POLL_TICKS = 20;
const SETTLE_SLOW_POLL_INTERVAL_MS = 100;
const SETTLE_MAX_WAIT_MS = 15_000;

async function waitThenReproject(
  pending: PendingRelationship[],
  instance: BaseDef,
  api: CardAPIModule,
  options: HostBoxelProjectionOptions,
  signal: AbortSignal,
): Promise<HostBoxelProjection | undefined> {
  let settled = await waitForAnyRelationshipToSettle(pending, api, signal);
  if (!settled || signal.aborted) {
    return undefined;
  }
  return projectHostBoxelSemantics(instance, api, options);
}

/**
 * Wait until at least one of `pending`'s relationship fields is no longer
 * `not-loaded`/in-flight (RP-7.1), then resolve `true`. Never triggers a new
 * load itself — `resolveBoxelFields` already started resolution the moment it
 * found the field pending (RP-7.2); this only observes
 * `getRelationshipMembershipState`, RP-7.1's sanctioned read.
 *
 * Bounded on two axes: `signal` ties this to whatever owns the wait (a
 * destroyed execution session aborts it), and `SETTLE_MAX_WAIT_MS` bounds it
 * even with no `signal` abort, so a relationship that genuinely never
 * settles cannot leak a wait forever. Polls a burst of microtask ticks first
 * — the common side-loaded case (RP-8.3) settles within one or two ticks,
 * since resolution is already in flight and just needs its own microtask to
 * land the field's bumped loading signal (`field-support.ts`) — then falls
 * back to a coarser interval for a slower, e.g. network-bound, settle (a
 * query-backed field, RP-7.6).
 */
async function waitForAnyRelationshipToSettle(
  pending: PendingRelationship[],
  api: CardAPIModule,
  signal: AbortSignal,
): Promise<boolean> {
  let stillPending = () =>
    pending.some((candidate) =>
      isPendingRelationship(candidate.instance, candidate.fieldName, api),
    );
  for (let tick = 0; tick < SETTLE_FAST_POLL_TICKS; tick++) {
    if (signal.aborted) {
      return false;
    }
    if (!stillPending()) {
      return true;
    }
    await Promise.resolve();
  }
  let deadline = Date.now() + SETTLE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) {
      return false;
    }
    if (!stillPending()) {
      return true;
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, SETTLE_SLOW_POLL_INTERVAL_MS),
    );
  }
  return false;
}

function isPendingRelationship(
  instance: BaseDef,
  fieldName: string,
  api: CardAPIModule,
): boolean {
  let { isLoading, membership } = api.getRelationshipMembershipState(
    instance as unknown as CardDef,
    fieldName,
  );
  return (
    isLoading ||
    membership === undefined ||
    membership.some((entry) => entry.kind === 'not-loaded')
  );
}

export function describeBoxelType(
  boxelType: BaseDefConstructor,
  api: CardAPIModule,
): BoxelDescription {
  let ref = requiredCodeRef(boxelType);
  let fields = Object.entries(
    api.getFields(boxelType, { includeComputeds: true }),
  ).map(([fieldName, field]): FieldDescription => {
    return {
      fieldName,
      fieldType: requiredCodeRef(field.card),
      kind: field.fieldType,
      isComputed: Boolean(field.computeVia),
    };
  });

  return {
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    requiredFeatures: [],
    ref,
    boxelKind: boxelKind(boxelType),
    ancestors: ancestorRefs(boxelType),
    fields,
    formats: formatDescriptions(boxelType, api.formats),
    presentation: {
      displayName:
        typeof boxelType.displayName === 'string'
          ? boxelType.displayName
          : boxelType.name,
      headerColor:
        typeof (boxelType as typeof boxelType & { headerColor?: unknown })
          .headerColor === 'string'
          ? (boxelType as typeof boxelType & { headerColor: string })
              .headerColor
          : null,
      prefersWideFormat:
        (boxelType as typeof boxelType & { prefersWideFormat?: unknown })
          .prefersWideFormat === true,
    },
    executionHints: {
      prefersFullSandbox:
        (boxelType as typeof boxelType & { prefersFullSandbox?: unknown })
          .prefersFullSandbox === true,
    },
  };
}

export function resolveBoxelFields(
  instance: BaseDef,
  api: CardAPIModule,
  writableFields?: ReadonlySet<string>,
  onPendingRelationship?: (pending: PendingRelationship) => void,
  ensureLoaded?: (reference: string) => Promise<unknown>,
): ResolvedField[] {
  return Object.entries(
    api.getFields(instance, { includeComputeds: true }),
  ).map(([fieldName, field]): ResolvedField => {
    let description = api.getFieldDescription(instance, fieldName);
    let presentation: Record<string, JSONValue> = {};
    if (description) {
      presentation.description = description;
    }
    return {
      fieldName,
      fieldType: requiredCodeRef(field.card),
      kind: field.fieldType,
      value: projectValue(
        instance,
        fieldName,
        field.fieldType,
        api,
        onPendingRelationship,
        undefined,
        ensureLoaded,
      ),
      resolvedConfiguration:
        projectJSONValue(resolveFieldConfiguration(api, field, instance)) ??
        null,
      presentation,
      writable: !field.computeVia && (writableFields?.has(fieldName) ?? false),
    };
  });
}

export function projectInstancePresentation(
  instance: BaseDef,
  api: CardAPIModule,
  unresolveURL?: (url: string) => string,
): InstancePresentation {
  return {
    title: stringField(instance, 'cardTitle', api),
    summary: stringField(instance, 'cardDescription', api),
    thumbnailURL: stringField(instance, 'cardThumbnailURL', api),
    theme: boxelReference(fieldValue(instance, 'cardTheme', api)),
    ...projectThemePresentation(instance, api, unresolveURL),
  };
}

/**
 * Host-side equivalent of `isThemeCard`/`themeId`/`themeCss` in
 * `@cardstack/base/field-component.gts`: an instance that declares its own
 * `cssVariables` (a Theme card, or a card built on the same shape) scopes to
 * its own identity; otherwise scope to its linked `cardTheme`, if any. Both
 * branches run with full Store/computed-field access (RP-5.4) and reduce to
 * the same plain `themeScope()` token
 * (`@cardstack/boxel-ui/helpers/theme-scoped-css.ts`) main derives, so a
 * boundary tier's stamped `data-boxel-theme-scope` attribute matches the
 * selector the theme stylesheet was compiled against.
 *
 * The theme id this function starts from crosses the execution boundary
 * absolute (RP-8.4, `useAbsoluteURL: true` in `boxel-execution.ts`'s
 * `requestFor`) — `normalizeThemeId` below reproduces the id form the
 * theme's realm-served document (and therefore its compiled stylesheet)
 * actually uses instead.
 *
 * Alongside the scope token, `themeCss` and `cssImports` cross too — the
 * remaining inputs of main's trusted `CardContainer` invocation
 * (`@themeScope`/`@themeCss`/`@cssImports` in `field-component.gts`). A
 * boundary tier renders no `field-component` chrome of its own (the Capsule
 * slot mounts the card's template directly), so its Host-owned wrapper must
 * be able to make that identical invocation, or a themed card silently
 * loses its stylesheet, fonts, and the container's token derivation.
 */
function projectThemePresentation(
  instance: BaseDef,
  api: CardAPIModule,
  unresolveURL?: (url: string) => string,
): Pick<InstancePresentation, 'themeScope' | 'themeCss' | 'cssImports'> {
  const none = { themeScope: null, themeCss: null, cssImports: null };
  let ownCssVariables = fieldValue(instance, 'cssVariables', api);
  let themeId: string | null;
  let cssVariables: unknown;
  let themeSource: BaseDef;
  if (typeof ownCssVariables === 'string') {
    themeId = boxelInstanceId(instance);
    cssVariables = ownCssVariables;
    themeSource = instance;
  } else {
    let theme = fieldValue(instance, 'cardTheme', api);
    if (!isBaseDefInstance(theme)) {
      return none;
    }
    themeId = boxelInstanceId(theme);
    cssVariables = fieldValue(theme, 'cssVariables', api);
    themeSource = theme;
  }
  if (!themeId || typeof cssVariables !== 'string') {
    return none;
  }
  themeId = normalizeThemeId(themeId, instance, api, unresolveURL);
  let scope = themeScope(themeId, cssVariables) ?? null;
  if (!scope) {
    return none;
  }
  let imports = fieldValue(themeSource, 'cssImports', api);
  let cssImports = Array.isArray(imports)
    ? imports.filter((entry): entry is string => typeof entry === 'string')
    : null;
  return {
    themeScope: scope,
    themeCss: cssVariables,
    cssImports: cssImports && cssImports.length > 0 ? cssImports : null,
  };
}

/**
 * Reproduce, for an already-absolute theme instance id, the id form the
 * theme's own served document (and therefore its compiled stylesheet)
 * actually carries. Main's `field-component.gts` render, and the realm's
 * index/prerender pipeline, both see `card.cardTheme.id` after ordinary
 * (non-`useAbsoluteURL`) serialization, which takes one of two forms:
 *
 * - Same realm as `instance`: a path relative to `instance`'s own id.
 *   Reproduced here with the identical functions and inputs
 *   `@cardstack/base/card-serialization.ts`'s `serializeCard` uses for its
 *   own internal `maybeRelativeReference` callback (`resolveRRIReference`
 *   then `maybeRelativeReference`, against the instance's own id/realm) —
 *   not a re-derived approximation.
 * - A registered realm (Base, Catalog) or no realm context: `unresolveURL`
 *   (`HostBoxelProjectionOptions.unresolveURL`) maps it to its
 *   scoped-identifier prefix form when one is registered. Applied after
 *   relativization, so it is a no-op on an already-relativized same-realm
 *   path (which matches no `http(s)://` prefix or registered target) and
 *   only takes effect when relativization left the id absolute.
 * - Neither: the absolute id, unchanged.
 */
function normalizeThemeId(
  themeId: string,
  instance: BaseDef,
  api: CardAPIModule,
  unresolveURL?: (url: string) => string,
): string {
  let modelRelativeTo = instanceRelativeTo(instance);
  let relativized: string;
  if (modelRelativeTo) {
    let absolute = resolveRRIReference(themeId, modelRelativeTo);
    let realmURLString = api.getCardMeta(instance, 'realmURL');
    let realmURL = realmURLString ? new URL(realmURLString) : undefined;
    relativized = maybeRelativeReference(
      rri(absolute),
      modelRelativeTo,
      realmURL,
    );
  } else {
    relativized = themeId;
  }
  return unresolveURL ? unresolveURL(relativized) : relativized;
}

// `card-serialization.ts`'s `serializeCard` computes its own relativization
// base as `model.id ?? model[relativeTo]` — the same priority order (an
// unsaved instance has no `id`, only the `relativeTo` symbol its Box chain
// carries).
function instanceRelativeTo(
  instance: BaseDef,
): RealmResourceIdentifier | undefined {
  let id = boxelInstanceId(instance);
  if (id) {
    return id as RealmResourceIdentifier;
  }
  let inherited = (instance as BaseDef & Record<symbol, unknown>)[
    relativeToSymbol
  ];
  if (inherited instanceof URL) {
    return inherited.href as RealmResourceIdentifier;
  }
  return inherited as RealmResourceIdentifier | undefined;
}

export function boxelInstanceId(value: BaseDef): string | null {
  for (let key of ['id', 'url', 'sourceUrl']) {
    let candidate = (value as unknown as Record<string, unknown>)[key];
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return null;
}

/**
 * Project the execution request document without mutating its input.
 *
 * The returned copy carries JSON-safe semantics supplied by trusted Boxel
 * types merged into the primary resource's attributes. Authored getters and
 * computeVia functions still execute only in their selected runtime; this walk
 * merely lets nested trusted Base values retain public getter semantics such
 * as CurrencyField.symbol so they cross the boundary as data (RP-5.4).
 *
 * The Store-backed instance never crosses the boundary. Only values whose
 * constructors resolve to a trusted module are evaluated, and only cloneable
 * results are copied into the projected document.
 */
export function projectBoxelExecutionDocument(
  card: BaseDef,
  document: LooseSingleCardDocument,
  api: CardAPIModule,
  isTrustedModule: (moduleIdentifier: string) => boolean,
): LooseSingleCardDocument {
  let projected = structuredClone(document);
  let resource = projected.data;
  if (!resource) {
    return projected;
  }
  projectTrustedBoxelSemantics(
    card,
    resource.attributes ?? (resource.attributes = {}),
    api,
    isTrustedModule,
  );
  return projected;
}

function projectTrustedBoxelSemantics(
  boxel: BaseDef,
  snapshot: Record<string, unknown>,
  api: CardAPIModule,
  isTrustedModule: (identifier: string) => boolean,
  visited = new WeakSet<object>(),
  declaredType?: BaseDefConstructor,
): void {
  if (visited.has(boxel)) {
    return;
  }
  visited.add(boxel);

  let fields = (
    declaredType
      ? api.getFields(declaredType, { includeComputeds: false })
      : api.getFields(boxel, { includeComputeds: false })
  ) as Record<string, Field<BaseDefConstructor>>;
  for (let [fieldName, field] of Object.entries(fields)) {
    if (field.fieldType !== 'contains' && field.fieldType !== 'containsMany') {
      continue;
    }
    let projectedValue = snapshot[fieldName];
    let liveValue: unknown;
    if (declaredType) {
      // Trusted nested projection uses a deliberately inert receiver rather
      // than a live Base instance. Its own values are the bounded snapshot;
      // asking Base to peek can throw for declared defaults that are absent.
      liveValue = snapshot[fieldName];
    } else {
      liveValue = api.peekAtField(boxel, fieldName) as unknown;
    }
    if (field.fieldType === 'containsMany') {
      if (!Array.isArray(liveValue) || !Array.isArray(projectedValue)) {
        continue;
      }
      for (let [index, entry] of liveValue.entries()) {
        projectNestedBoxelSemantics(
          entry,
          projectedValue[index],
          field.card,
          api,
          isTrustedModule,
          visited,
        );
      }
    } else {
      projectNestedBoxelSemantics(
        liveValue,
        projectedValue,
        field.card,
        api,
        isTrustedModule,
        visited,
      );
    }
  }
}

function projectNestedBoxelSemantics(
  boxel: unknown,
  snapshot: unknown,
  boxelType: BaseDefConstructor,
  api: CardAPIModule,
  isTrustedModule: (identifier: string) => boolean,
  visited: WeakSet<object>,
): void {
  if (
    !boxel ||
    typeof boxel !== 'object' ||
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot)
  ) {
    return;
  }
  // Field metadata is the canonical type identity. Values produced by Base
  // deserialization may be wrapped or subclassed, so their runtime
  // `constructor` is not a reliable Loader lookup key.
  let identity = Loader.identify(boxelType);
  let projected = snapshot as Record<string, unknown>;
  if (!identity || !isTrustedModule(identity.module)) {
    // Authored FieldDefs are structural waypoints, not trusted semantic
    // owners. Traverse their declared contained fields so trusted Base values
    // below them are not pruned, but never evaluate an authored getter or
    // computeVia in the Host.
    projectTrustedBoxelSemantics(
      boxel as BaseDef,
      projected,
      api,
      isTrustedModule,
      visited,
    );
    return;
  }
  // Evaluate trusted Base semantics against the bounded snapshot itself. A
  // deserialized nested value can be a wrapper whose own constructor is not
  // the declared Field type; the field prototype is the stable semantic
  // contract. Do not run its constructor or pass the live Store object.
  let receiver = Object.create(boxelType.prototype) as Record<string, unknown>;
  for (let [name, value] of Object.entries(projected)) {
    // Define inert own data directly. Assignment would invoke Base's field
    // setters and reject the intentionally plain nested boundary records.
    Object.defineProperty(receiver, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  projectTrustedBoxelSemantics(
    receiver as unknown as BaseDef,
    projected,
    api,
    isTrustedModule,
    visited,
    boxelType,
  );
  projectTrustedGetters(receiver, boxelType, projected, isTrustedModule);
}

function projectTrustedGetters(
  boxel: object,
  boxelType: BaseDefConstructor,
  snapshot: Record<string, unknown>,
  isTrustedModule: (identifier: string) => boolean,
): void {
  let prototype = boxelType.prototype as object | null;
  let declaredType: BaseDefConstructor | undefined = boxelType;
  while (prototype && prototype !== Object.prototype) {
    let constructor = (prototype as { constructor?: { prototype?: object } })
      .constructor;
    let identity =
      (declaredType ? Loader.identify(declaredType) : undefined) ??
      (constructor ? Loader.identify(constructor) : undefined);
    if (!identity || !isTrustedModule(identity.module)) {
      break;
    }
    for (let name of Object.getOwnPropertyNames(prototype)) {
      if (
        name === 'constructor' ||
        Object.prototype.hasOwnProperty.call(snapshot, name)
      ) {
        continue;
      }
      let getter = Object.getOwnPropertyDescriptor(prototype, name)?.get;
      if (!getter) {
        continue;
      }
      try {
        let projected = cloneBoundaryValue(getter.call(boxel));
        if (projected !== boundaryValueUnavailable) {
          snapshot[name] = projected;
        }
      } catch {
        // One optional trusted getter must not erase independent semantics.
      }
    }
    declaredType = undefined;
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
}

const boundaryValueUnavailable = Symbol('boundary-value-unavailable');

function cloneBoundaryValue(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown | typeof boundaryValueUnavailable {
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
  if (value === undefined) {
    return boundaryValueUnavailable;
  }
  if (value instanceof URL) {
    return value.href;
  }
  if (typeof value !== 'object' || seen.has(value)) {
    return boundaryValueUnavailable;
  }
  if (Loader.identify(value.constructor)) {
    return boundaryValueUnavailable;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    let result: unknown[] = [];
    for (let item of value) {
      let projected = cloneBoundaryValue(item, seen);
      if (projected === boundaryValueUnavailable) {
        return boundaryValueUnavailable;
      }
      result.push(projected);
    }
    return result;
  }
  let result: Record<string, unknown> = {};
  for (let [key, item] of Object.entries(value)) {
    let projected = cloneBoundaryValue(item, seen);
    if (projected !== boundaryValueUnavailable) {
      result[key] = projected;
    }
  }
  return result;
}

/**
 * Field configuration became a public Card API operation after some deployed
 * Base realm versions. Keep its execution with the runtime that owns the live
 * Field and instance, while retaining compatibility with those older Base
 * modules. This mirrors Base's shallow merge semantics; it does not transfer
 * either configuration provider across an execution boundary.
 */
function resolveFieldConfiguration(
  api: CardAPIModule,
  field: Field<BaseDefConstructor>,
  instance: BaseDef,
): unknown {
  let publicResolver = (
    api as CardAPIModule & {
      resolveFieldConfiguration?: (
        field: Field<BaseDefConstructor>,
        instance: BaseDef,
      ) => unknown;
    }
  ).resolveFieldConfiguration;
  if (publicResolver) {
    return publicResolver(field, instance);
  }

  let fromType = evaluateConfiguration(
    (field.card as typeof field.card & { configuration?: unknown })
      .configuration,
    instance,
  );
  let fromUsage = evaluateConfiguration(
    (field as typeof field & { configuration?: unknown }).configuration,
    instance,
  );
  return mergeConfigurations(fromType, fromUsage);
}

function evaluateConfiguration(value: unknown, instance: BaseDef): unknown {
  return typeof value === 'function'
    ? (value as (this: BaseDef) => unknown).call(instance)
    : value;
}

function mergeConfigurations(typeValue: unknown, usageValue: unknown): unknown {
  if (!isPlainObject(typeValue)) {
    return usageValue ?? typeValue;
  }
  if (!isPlainObject(usageValue)) {
    return usageValue ?? typeValue;
  }

  let result: Record<string, unknown> = { ...typeValue };
  for (let [key, value] of Object.entries(usageValue)) {
    if (value === undefined) {
      continue;
    }
    result[key] =
      isPlainObject(value) && isPlainObject(result[key])
        ? { ...result[key], ...value }
        : value;
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredCodeRef(boxelType: BaseDefConstructor): CodeRef {
  let ref = identifyCard(boxelType);
  if (!ref) {
    throw new Error(
      `Cannot describe Boxel type '${boxelType.name}' before it has a code reference`,
    );
  }
  return ref;
}

function boxelKind(boxelType: BaseDefConstructor): BoxelKind {
  if (isFileDef(boxelType)) {
    return 'file';
  }
  if (isFieldDef(boxelType)) {
    return 'field';
  }
  return 'card';
}

function ancestorRefs(boxelType: BaseDefConstructor): CodeRef[] {
  let result: CodeRef[] = [];
  let current = getAncestor(boxelType);
  while (current) {
    let ref = identifyCard(current);
    if (ref) {
      result.push(ref);
    }
    current = getAncestor(current);
  }
  return result;
}

function formatDescriptions(
  boxelType: BaseDefConstructor,
  knownFormats: string[],
): FormatDescription[] {
  return knownFormats.flatMap((format): FormatDescription[] => {
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
          kind: isTrustedBaseRef(ref) ? 'trusted-base' : 'authored',
          ref,
        },
      },
    ];
  });
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

function isTrustedBaseRef(ref: CodeRef): boolean {
  let module = moduleFrom(ref);
  return (
    module.startsWith('@cardstack/base/') ||
    module.startsWith('https://cardstack.com/base/')
  );
}

function stringField(
  instance: BaseDef,
  fieldName: string,
  api: CardAPIModule,
): string | null {
  let value = fieldValue(instance, fieldName, api);
  return typeof value === 'string' ? value : null;
}

function fieldValue(
  instance: BaseDef,
  fieldName: string,
  api: CardAPIModule,
): unknown {
  if (!(fieldName in api.getFields(instance, { includeComputeds: true }))) {
    return undefined;
  }
  return api.peekAtField(instance, fieldName);
}

/**
 * Project one field's runtime value into the record's canonical value shape.
 *
 * `contains`/`containsMany` values are embedded composite data, never a
 * separate resource (RP-3.3): `@model` must keep them reachable the same
 * way the live instance does (RP-3.2), so they cross fully expanded.
 * `linksTo`/`linksToMany` name a separate resource; RP-7.1 governs which
 * slots have a value to expand. That governance is `getRelationshipMembershipState`
 * — "the only sanctioned structured observation" of link state — never a
 * heuristic over the raw peeked value: `peekAtField` on a relationship field
 * reads the data bucket directly and can hand back an array that is still
 * mid-resolution (declared links not yet swapped in, or a query-backed field
 * whose search hasn't reported results yet, RP-7.6); treating that as "already
 * absent" silently drops slots a live template would still show once loaded.
 * A **present** slot (whether resolved from `included`, RP-8.3, or the
 * store's own query results, RP-7.6) expands the same way a composite does.
 * Every other RP-7.1 state has nothing to expand and projects as absent.
 */
function projectValue(
  instance: BaseDef,
  fieldName: string,
  fieldType: Field<BaseDefConstructor>['fieldType'],
  api: CardAPIModule,
  onPending: ((pending: PendingRelationship) => void) | undefined,
  seen = new WeakSet<object>(),
  ensureLoaded?: (reference: string) => Promise<unknown>,
): JSONValue | BoxelValueReference | BoxelValueReference[] {
  if (fieldType === 'linksTo' || fieldType === 'linksToMany') {
    let present = presentRelationshipValues(
      instance,
      fieldName,
      api,
      onPending,
      ensureLoaded,
    );
    if (fieldType === 'linksToMany') {
      let projected = present.map(
        (target) =>
          projectExpandedValue(
            target,
            api,
            onPending,
            seen,
            ensureLoaded,
          ) as JSONValue,
      );
      return projected;
    }
    return present.length > 0
      ? (projectExpandedValue(
          present[0],
          api,
          onPending,
          seen,
          ensureLoaded,
        ) as JSONValue)
      : null;
  }
  let value = api.peekAtField(instance, fieldName);
  if (fieldType === 'containsMany') {
    return Array.isArray(value)
      ? value.map((entry) =>
          projectExpandedValue(entry, api, onPending, seen, ensureLoaded),
        )
      : [];
  }
  return projectExpandedValue(value, api, onPending, seen, ensureLoaded);
}

/**
 * Every slot of a `linksTo`/`linksToMany` field currently in the RP-7.1
 * `present` state, in document order. Reports the field to `onPending` when
 * it is not (yet) fully settled (RP-7.3), so a caller can watch for it to
 * settle later without re-deriving which fields those were.
 *
 * Reading the field's own getter first (`instance[fieldName]`) is what
 * starts resolution at all (RP-7.2: "the field getter is the lazy-load
 * trigger") — for a declared link this swaps a not-loaded slot for its real
 * value once available, and for a query-backed field (RP-7.6) it is what
 * creates the field's search resource in the first place; without this read
 * `getRelationshipMembershipState`'s query branch has no resource to report
 * membership from and always sees "in flight". This mirrors exactly what a
 * live template read already does on main; it is not new authority, since
 * this runs Host-side over the same canonical instance a trusted render
 * would use.
 */
function presentRelationshipValues(
  instance: BaseDef,
  fieldName: string,
  api: CardAPIModule,
  onPending: ((pending: PendingRelationship) => void) | undefined,
  ensureLoaded?: (reference: string) => Promise<unknown>,
): CardDef[] {
  void (instance as unknown as Record<string, unknown>)[fieldName];
  let { isLoading, membership } = api.getRelationshipMembershipState(
    instance as unknown as CardDef,
    fieldName,
  );
  let notLoaded = (membership ?? []).filter(
    (entry) => entry.kind === 'not-loaded',
  );
  if (
    onPending &&
    (isLoading || membership === undefined || notLoaded.length > 0)
  ) {
    onPending({ instance, fieldName });
  }
  if (ensureLoaded) {
    for (let entry of notLoaded) {
      void ensureLoaded(entry.reference).then((resolved) => {
        if (!isBaseDefInstance(resolved)) {
          // A `CardErrorJSONAPI` (broken link) or an unresolved reference —
          // leave the not-loaded sentinel as-is. `lazilyLoadLink`
          // (card-api.gts) plants the structured failure sentinel itself
          // once its own attempt (the getter read above already triggered
          // it) settles; this is only a defensive no-op when the
          // store/card-service path this closure calls resolves
          // differently.
          return;
        }
        try {
          (instance as unknown as Record<string, unknown>)[fieldName] =
            resolved;
        } catch {
          // A computed field (e.g. `cardTheme`) has no setter — the
          // declared field it mirrors (`cardInfo.theme`) is walked
          // separately (as part of expanding `cardInfo`'s own fields) and
          // settles there instead.
        }
      });
    }
  }
  return (membership ?? [])
    .filter((entry) => entry.kind === 'present')
    .map((entry) => entry.value);
}

/**
 * Expand one loaded `BaseDefInstance`'s own declared fields recursively so
 * nested attributes survive the boundary — a `contains` composite's own
 * fields, or a present `linksTo`/`linksToMany` target's fields the same way
 * (RP-7.1). Depth is bounded by what is actually present: a nested
 * relationship that is not itself present projects as absent through the
 * same `projectValue` call, never a fetch triggered by this walk beyond the
 * one-slot lazy-load trigger `presentRelationshipValues` already documents.
 * Identity (`id`) rides along through the target's own declared `id` field
 * (every `CardDef` has one); a `contains` composite has none, matching
 * RP-3.3.
 */
function projectExpandedValue(
  value: unknown,
  api: CardAPIModule,
  onPending: ((pending: PendingRelationship) => void) | undefined,
  seen: WeakSet<object>,
  ensureLoaded?: (reference: string) => Promise<unknown>,
): JSONValue {
  if (!isBaseDefInstance(value)) {
    return projectJSONValue(value) ?? null;
  }
  if (seen.has(value)) {
    // A cyclic value graph (RP-8.2's identity map makes this reachable for
    // linksTo, e.g. two cards linking to each other) degrades to its
    // identity reference rather than recursing forever.
    return (boxelReference(value) as unknown as JSONValue) ?? null;
  }
  seen.add(value);
  try {
    let result: Record<string, JSONValue> = {};
    for (let [name, field] of Object.entries(
      api.getFields(value, { includeComputeds: true }),
    )) {
      result[name] = projectValue(
        value as BaseDef,
        name,
        field.fieldType,
        api,
        onPending,
        seen,
        ensureLoaded,
      ) as JSONValue;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function boxelReference(value: unknown): BoxelValueReference | null {
  if (!isBaseDefInstance(value)) {
    return null;
  }
  let ref = identifyCard(value.constructor as BaseDefConstructor);
  if (!ref) {
    return null;
  }
  return {
    $boxel: {
      id: boxelInstanceId(value),
      type: ref,
    },
  };
}

function projectJSONValue(
  value: unknown,
  seen = new WeakSet<object>(),
): JSONValue | undefined {
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
  if (Array.isArray(value)) {
    return value.map((item) => projectJSONValue(item, seen) ?? null);
  }
  if (typeof value !== 'object' || value === undefined) {
    return undefined;
  }
  if (isBaseDefInstance(value)) {
    return boxelReference(value) as unknown as JSONValue;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);
  let result: Record<string, JSONValue> = {};
  for (let [key, item] of Object.entries(value)) {
    let projected = projectJSONValue(item, seen);
    if (projected !== undefined) {
      result[key] = projected;
    }
  }
  seen.delete(value);
  return result;
}
