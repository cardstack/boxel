import { themeScope } from '@cardstack/boxel-ui/helpers';

import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  getAncestor,
  identifyCard,
  isBaseDefInstance,
  isFieldDef,
  isFileDef,
  Loader,
  moduleFrom,
  relativeTo as relativeToSymbol,
  resolveRRIReference,
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
/**
 * Fully cloneable by construction — RP-7.3's settle behavior needs no
 * side-channel here: every tier's live reads observe settlement through
 * tracking (Direct natively, Capsule via the live model, RP-20.2), and a
 * mounted Sandbox child receives it through the RP-20.5 instance push,
 * whose serialized document carries whatever has settled by push time.
 */
export interface HostBoxelProjection {
  boxel: BoxelDescription;
  instanceId: string | null;
  fields: ResolvedField[];
  presentation: InstancePresentation;
}

export interface HostBoxelProjectionOptions {
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
 * RP-20.2's live model — main's pattern, translated. On main, N views of
 * one card stay in sync because they all READ the same live instance's
 * tracked fields; Glimmer autotracking re-renders each binding in place on
 * any field set. There is no delivery pipeline to build or serialize —
 * the framework's render pass IS the pipeline. This proxy gives a Capsule
 * `@model` exactly that property: every property read projects the
 * canonical instance's CURRENT value (a tracked read via `peekAtField`,
 * so the binding re-renders on mutation), returning only cloneable
 * projected data — never a live instance.
 *
 * Reads are DELIBERATELY PURE (the sync root-cause lesson,
 * docs/boxel-sync-root-cause-2026-08-06.md): no relationship getter reads
 * (the lazy-load trigger stays materialize's job), no write-backs, no
 * settle registration. A relationship subtree still pending at read time
 * answers with the materialize-time `fallback` value rather than
 * regressing to absent; settlement republishes a full generation through
 * the session as before. `fallback` also carries what only materialize
 * can compute: the instance id and RP-4.4 model extensions.
 *
 * Purity is a tested contract (rp-continuity): reads fire zero
 * `subscribeToChanges` notifications and dirty nothing.
 */
export function createLiveBoxelModel(
  instance: BaseDef,
  api: CardAPIModule,
  fallback: Record<string, JSONValue>,
  /**
   * A tracked read consumed by every property access — the bridge from
   * card-api's imperative change notifications (`subscribeToChanges`) into
   * Glimmer autotracking. `peekAtField` alone tracks a TrackedArray's item
   * mutations but NOT the field slot itself, so a save echo that replaces
   * a whole array/composite would freeze the model mid-word without this.
   * The cell's writer must be a pure observer: bump-only, no reads of the
   * instance, nothing else.
   */
  version?: () => unknown,
): Record<string, JSONValue> {
  let readField = (fieldName: string): JSONValue | undefined => {
    // Establishes the version dependency BEFORE the value read, so a
    // notification arriving between the two invalidates this frame.
    version?.();
    let field = (
      api.getFields(instance, { includeComputeds: true }) as Record<
        string,
        Field<BaseDefConstructor> | undefined
      >
    )[fieldName];
    if (!field) {
      return fallback[fieldName];
    }
    let sawPending = false;
    let value = projectValue(
      instance,
      fieldName,
      field.fieldType,
      api,
      () => {
        sawPending = true;
      },
      undefined,
      undefined,
      true,
    );
    return sawPending && fieldName in fallback
      ? fallback[fieldName]
      : (value as JSONValue);
  };
  let allKeys = () => [
    ...new Set([
      ...Object.keys(fallback),
      ...Object.keys(api.getFields(instance, { includeComputeds: true })),
    ]),
  ];
  return new Proxy({} as Record<string, JSONValue>, {
    get: (_target, property) =>
      typeof property === 'string' ? readField(property) : undefined,
    has: (_target, property) =>
      typeof property === 'string' && allKeys().includes(property),
    ownKeys: () => allKeys(),
    getOwnPropertyDescriptor: (_target, property) =>
      typeof property === 'string' && allKeys().includes(property)
        ? {
            configurable: true,
            enumerable: true,
            value: readField(property),
          }
        : undefined,
  });
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
  return {
    boxel: describeBoxelType(instance.constructor as BaseDefConstructor, api),
    instanceId: boxelInstanceId(instance),
    fields: resolveBoxelFields(
      instance,
      api,
      undefined,
      options.ensureRelationshipLoaded,
    ),
    presentation: projectInstancePresentation(
      instance,
      api,
      options.unresolveURL,
    ),
  };
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
    // `cardTheme` is CardDef's COMPUTED linksTo mirror of `cardInfo.theme`.
    // Neither `peekAtField` nor membership sees it (both read the framework
    // bucket, and a computed relationship's value never lands there) — main
    // reads it as an ORDINARY property read (`card.cardTheme` in
    // field-component.gts), which runs the compute. The compute's own read
    // of `cardInfo.theme` is RP-7.2's sanctioned lazy-load trigger — the
    // exact read main performs on every themed render.
    let theme =
      'cardTheme' in api.getFields(instance, { includeComputeds: true })
        ? (instance as unknown as Record<string, unknown>).cardTheme
        : undefined;
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
  themeId = normalizeThemeId(themeId, instance, unresolveURL);
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
 * Reproduce, for a theme instance id, the id form the theme's own served
 * document (and therefore its compiled stylesheet) actually carries.
 * `cardInfo.theme` is always a relationship NESTED under the `cardInfo`
 * composite, and main's `Contains.serialize` drops `opts` when serializing
 * a composite's own relationships (`callSerializeHook(this.card, value,
 * doc)` — no `maybeRelativeReference` threads through), so a nested theme
 * id is NEVER relativized on main: it serves absolute, and
 * `field-component.gts`'s live render reads `card.cardTheme.id` — also
 * absolute. The only transformation a served document applies is the
 * realm-server's `unresolveResourceInstanceURLs` (registered realms map to
 * their scoped-identifier prefix), reproduced here via `unresolveURL`.
 */
function normalizeThemeId(
  themeId: string,
  instance: BaseDef,
  unresolveURL?: (url: string) => string,
): string {
  let modelRelativeTo = instanceRelativeTo(instance);
  let absolute = modelRelativeTo
    ? resolveRRIReference(themeId, modelRelativeTo)
    : themeId;
  return unresolveURL ? unresolveURL(absolute) : absolute;
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
  // Main reads presentation strings as ORDINARY property reads
  // (`card.cardTitle` in chrome and templates), which lets an authored
  // prototype getter SHADOW the framework field — a common authoring
  // pattern (`get cardTitle() { ... }` on a CardDef). `peekAtField` reads
  // only the framework data bucket and misses the shadow, so the projected
  // title regressed to the computed default. The ordinary read executes at
  // most an authored getter — exactly what main executes for the same
  // value on every render.
  if (!(fieldName in api.getFields(instance, { includeComputeds: true }))) {
    return null;
  }
  let value = (instance as unknown as Record<string, unknown>)[fieldName];
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
  pure = false,
): JSONValue | BoxelValueReference | BoxelValueReference[] {
  if (fieldType === 'linksTo' || fieldType === 'linksToMany') {
    let present = presentRelationshipValues(
      instance,
      fieldName,
      api,
      onPending,
      ensureLoaded,
      pure,
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
            pure,
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
          pure,
        ) as JSONValue)
      : null;
  }
  let value = api.peekAtField(instance, fieldName);
  if (fieldType === 'containsMany') {
    return Array.isArray(value)
      ? value.map((entry) =>
          projectExpandedValue(entry, api, onPending, seen, ensureLoaded, pure),
        )
      : [];
  }
  return projectExpandedValue(value, api, onPending, seen, ensureLoaded, pure);
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
  pure = false,
): CardDef[] {
  if (!pure) {
    // The lazy-load trigger (RP-7.2) — materialize-time only. A pure
    // refresh read (RP-20.2) must never start a load: materialize already
    // triggered every load on this same instance, so membership below is
    // readable without it.
    void (instance as unknown as Record<string, unknown>)[fieldName];
  }
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
  if (ensureLoaded && !pure) {
    // A not-loaded slot's `reference` is the relationship's own serialized
    // href, which may be RELATIVE (`../files/report.pdf`). Resolve it
    // against the owning instance exactly like card-api's `lazilyLoadLink`
    // does (`resolveRef(link, instance.id ?? instance[relativeTo])`) —
    // handing the store a relative id can only ever miss.
    let base = instanceRelativeTo(instance);
    for (let entry of notLoaded) {
      let reference = base
        ? resolveRRIReference(entry.reference, base)
        : entry.reference;
      void ensureLoaded(reference).then((resolved) => {
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
  pure = false,
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
        pure,
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
