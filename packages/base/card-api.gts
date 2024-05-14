import Modifier from 'ember-modifier';
import { action } from '@ember/object';
import GlimmerComponent from '@glimmer/component';
import { flatMap, merge, isEqual } from 'lodash';
import { TrackedWeakMap } from 'tracked-built-ins';
import { WatchedArray } from './watched-array';
import { BoxelInput, FieldContainer } from '@cardstack/boxel-ui/components';
import { cn, eq, pick } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { startCase } from 'lodash';
import {
  getBoxComponent,
  type BoxComponent,
  DefaultFormatConsumer,
} from './field-component';
import { getContainsManyComponent } from './contains-many-component';
import { LinksToEditor } from './links-to-editor';
import { getLinksToManyComponent } from './links-to-many-component';
import {
  SupportedMimeType,
  Deferred,
  isCardResource,
  Loader,
  isSingleCardDocument,
  isRelationship,
  isNotLoadedError,
  isNotReadyError,
  CardError,
  CardContextName,
  NotLoaded,
  NotReady,
  getField,
  isField,
  primitive,
  identifyCard,
  isCardDef,
  isCardInstance as _isCardInstance,
  loadCard,
  humanReadable,
  maybeURL,
  maybeRelativeURL,
  moduleFrom,
  getCard,
  trackCard,
  type Meta,
  type CardFields,
  type Relationship,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type CardDocument,
  type CardResource,
  type Format,
  type Actions,
  type RealmInfo,
} from '@cardstack/runtime-common';
import type { ComponentLike } from '@glint/template';
import { initSharedState } from './shared-state';
import { ContainsMany } from 'field-types/contains-many';
import { Contains } from 'field-types/contains';
import { LinksTo } from 'field-types/links-to';
import { LinksToMany } from 'field-types/links-to-many';
import { Box } from 'field-types/box';
import { Field } from 'field-types/utils';
import { BaseDef, BaseInstanceType } from 'base-def';
import { CardDef } from 'card-def';
import { isCardOrField } from 'utils';

export { primitive, isField, Box, type BoxComponent };
export const serialize = Symbol.for('cardstack-serialize');
export const deserialize = Symbol.for('cardstack-deserialize');
export const fieldType = Symbol.for('cardstack-field-type');
export const queryableValue = Symbol.for('cardstack-queryable-value');
export const formatQuery = Symbol.for('cardstack-format-query');
export const relativeTo = Symbol.for('cardstack-relative-to');
export const realmInfo = Symbol.for('cardstack-realm-info');
export const realmURL = Symbol.for('cardstack-realm-url');

export const formats: Format[] = ['isolated', 'embedded', 'edit', 'atom'];

interface NotLoadedValue {
  type: 'not-loaded';
  reference: string;
}

function isNotLoadedValue(val: any): val is NotLoadedValue {
  if (!val || typeof val !== 'object') {
    return false;
  }
  if (!('type' in val) || !('reference' in val)) {
    return false;
  }
  let { type, reference } = val;
  if (typeof type !== 'string' || typeof reference !== 'string') {
    return false;
  }
  return type === 'not-loaded';
}

interface NotReadyValue {
  type: 'not-ready';
  instance: BaseDef;
  fieldName: string;
}

function isNotReadyValue(value: any): value is NotReadyValue {
  if (value && typeof value === 'object') {
    return (
      'type' in value &&
      value.type === 'not-ready' &&
      'instance' in value &&
      isCardOrField(value.instance) &&
      'fieldName' in value &&
      typeof value.fieldName === 'string'
    );
  } else {
    return false;
  }
}

interface StaleValue {
  type: 'stale';
  staleValue: any;
}

type CardChangeSubscriber = (
  instance: BaseDef,
  fieldName: string,
  fieldValue: any,
) => void;

function isStaleValue(value: any): value is StaleValue {
  if (value && typeof value === 'object') {
    return 'type' in value && value.type === 'stale' && 'staleValue' in value;
  } else {
    return false;
  }
}
const recomputePromises = initSharedState(
  'recomputePromises',
  () => new WeakMap<BaseDef, Promise<any>>(),
);
const identityContexts = initSharedState(
  'identityContexts',
  () => new WeakMap<BaseDef, IdentityContext>(),
);
const subscribers = initSharedState(
  'subscribers',
  () => new WeakMap<BaseDef, Set<CardChangeSubscriber>>(),
);

// our place for notifying Glimmer when a card is ready to re-render (which will
// involve rerunning async computed fields)
const cardTracking = initSharedState(
  'cardTracking',
  () => new TrackedWeakMap<object, any>(),
);

class Logger {
  private promises: Promise<any>[] = [];

  log(promise: Promise<any>) {
    this.promises.push(promise);
    // make an effort to resolve the promise at the time it is logged
    (async () => {
      try {
        await promise;
      } catch (e: any) {
        console.error(`encountered error performing recompute on card`, e);
      }
    })();
  }

  async flush() {
    let results = await Promise.allSettled(this.promises);
    for (let result of results) {
      if (result.status === 'rejected') {
        console.error(`Promise rejected`, result.reason);
        if (result.reason instanceof Error) {
          console.error(result.reason.stack);
        }
      }
    }
  }
}

let logger = new Logger();
export async function flushLogs() {
  await logger.flush();
}

export class IdentityContext {
  readonly identities = new Map<string, CardDef>();
}

type JSONAPIResource =
  | {
      attributes: Record<string, any>;
      relationships?: Record<string, Relationship>;
      meta?: Record<string, any>;
    }
  | {
      attributes?: Record<string, any>;
      relationships: Record<string, Relationship>;
      meta?: Record<string, any>;
    };

export interface JSONAPISingleResourceDocument {
  data: Partial<JSONAPIResource> & { id?: string; type: string };
  included?: (Partial<JSONAPIResource> & { id: string; type: string })[];
}

export function isCompoundField(card: any) {
  return (
    isCardOrField(card) &&
    'isFieldDef' in card.constructor &&
    !(primitive in card)
  );
}

export function subscribeToChanges(
  fieldOrCard: BaseDef,
  subscriber: CardChangeSubscriber,
) {
  let changeSubscribers = subscribers.get(fieldOrCard);
  if (changeSubscribers && changeSubscribers.has(subscriber)) {
    return;
  }

  if (!changeSubscribers) {
    changeSubscribers = new Set();
    subscribers.set(fieldOrCard, changeSubscribers);
  }

  changeSubscribers.add(subscriber);

  let fields = getFields(fieldOrCard, {
    usedFieldsOnly: true,
    includeComputeds: false,
  });
  Object.keys(fields).forEach((fieldName) => {
    let value = peekAtField(fieldOrCard, fieldName);
    if (isCardOrField(value)) {
      subscribeToChanges(value, subscriber);
    }
  });
}

export function unsubscribeFromChanges(
  fieldOrCard: BaseDef,
  subscriber: CardChangeSubscriber,
) {
  let changeSubscribers = subscribers.get(fieldOrCard);
  if (!changeSubscribers) {
    return;
  }
  changeSubscribers.delete(subscriber);

  let fields = getFields(fieldOrCard, {
    usedFieldsOnly: true,
    includeComputeds: false,
  });
  Object.keys(fields).forEach((fieldName) => {
    let value = peekAtField(fieldOrCard, fieldName);
    if (isCardOrField(value)) {
      unsubscribeFromChanges(value, subscriber);
    }
  });
}

function migrateSubscribers(oldFieldOrCard: BaseDef, newFieldOrCard: BaseDef) {
  let changeSubscribers = subscribers.get(oldFieldOrCard);
  if (changeSubscribers) {
    changeSubscribers.forEach((changeSubscriber) =>
      subscribeToChanges(newFieldOrCard, changeSubscriber),
    );
    changeSubscribers.forEach((changeSubscriber) =>
      unsubscribeFromChanges(oldFieldOrCard, changeSubscriber),
    );
  }
}

function getUsedFields(instance: BaseDef): string[] {
  return [...getDataBucket(instance)?.keys()];
}

type Scalar =
  | string
  | number
  | boolean
  | null
  | undefined
  | (string | null | undefined)[]
  | (number | null | undefined)[]
  | (boolean | null | undefined)[];

function assertScalar(
  scalar: any,
  fieldCard: typeof BaseDef,
): asserts scalar is Scalar {
  if (Array.isArray(scalar)) {
    if (
      scalar.find(
        (i) =>
          !['undefined', 'string', 'number', 'boolean'].includes(typeof i) &&
          i !== null,
      )
    ) {
      throw new Error(
        `expected queryableValue for field type ${
          fieldCard.name
        } to be scalar but was ${typeof scalar}`,
      );
    }
  } else if (
    !['undefined', 'string', 'number', 'boolean'].includes(typeof scalar) &&
    scalar !== null
  ) {
    throw new Error(
      `expected queryableValue for field type ${
        fieldCard.name
      } to be scalar but was ${typeof scalar}`,
    );
  }
}

export function getQueryableValue(
  field: Field<typeof BaseDef>,
  value: any,
  stack?: BaseDef[],
): any;
export function getQueryableValue(
  fieldCard: typeof BaseDef,
  value: any,
  stack?: BaseDef[],
): any;
export function getQueryableValue(
  fieldOrCard: Field<typeof BaseDef> | typeof BaseDef,
  value: any,
  stack: BaseDef[] = [],
): any {
  if ('baseDef' in fieldOrCard) {
    let result = fieldOrCard[queryableValue](value, stack);
    if (primitive in fieldOrCard) {
      assertScalar(result, fieldOrCard);
    }
    return result;
  }
  return fieldOrCard.queryableValue(value, stack);
}

export function formatQueryValue(
  field: Field<typeof BaseDef>,
  queryValue: any,
): any {
  return field.card[formatQuery](queryValue);
}

type RelationshipMeta = NotLoadedRelationship | LoadedRelationship;
interface NotLoadedRelationship {
  type: 'not-loaded';
  reference: string;
  // TODO add a loader (which may turn this into a class)
  // load(): Promise<CardInstanceType<CardT>>;
}
interface LoadedRelationship {
  type: 'loaded';
  card: CardDef | null;
}

export function relationshipMeta(
  instance: CardDef,
  fieldName: string,
): RelationshipMeta | RelationshipMeta[] | undefined {
  let field = getField(
    Reflect.getPrototypeOf(instance)!.constructor as typeof BaseDef,
    fieldName,
  );
  if (!field) {
    throw new Error(
      `the card ${instance.constructor.name} does not have a field '${fieldName}'`,
    );
  }
  if (!(field.fieldType === 'linksTo' || field.fieldType === 'linksToMany')) {
    return undefined;
  }
  let related = getter(instance, field) as CardDef; // only compound cards can be linksTo fields
  if (field.fieldType === 'linksToMany') {
    if (!Array.isArray(related)) {
      throw new Error(
        `expected ${fieldName} to be an array but was ${typeof related}`,
      );
    }
    return related.map((rel) => {
      if (isNotLoadedValue(rel)) {
        return { type: 'not-loaded', reference: rel.reference };
      } else {
        return { type: 'loaded', card: rel ?? null };
      }
    });
  }

  if (isNotLoadedValue(related)) {
    return { type: 'not-loaded', reference: related.reference };
  } else {
    return { type: 'loaded', card: related ?? null };
  }
}

function serializedGet<CardT extends BaseDefConstructor>(
  model: InstanceType<CardT>,
  fieldName: string,
  doc: JSONAPISingleResourceDocument,
  visited: Set<string>,
  opts?: SerializeOpts,
): JSONAPIResource {
  let field = getField(model.constructor, fieldName);
  if (!field) {
    throw new Error(
      `tried to serializedGet field ${fieldName} which does not exist in card ${model.constructor.name}`,
    );
  }
  return field.serialize(peekAtField(model, fieldName), doc, visited, opts);
}

async function getDeserializedValue<CardT extends BaseDefConstructor>({
  card,
  loadedValue,
  fieldName,
  value,
  resource,
  modelPromise,
  doc,
  identityContext,
  relativeTo,
}: {
  card: CardT;
  loadedValue: any;
  fieldName: string;
  value: any;
  resource: LooseCardResource;
  modelPromise: Promise<BaseDef>;
  doc: LooseSingleCardDocument | CardDocument;
  identityContext: IdentityContext;
  relativeTo: URL | undefined;
}): Promise<any> {
  let field = getField(card, fieldName);
  if (!field) {
    throw new Error(`could not find field ${fieldName} in card ${card.name}`);
  }
  let result = await field.deserialize(
    value,
    doc,
    resource.relationships,
    resource.meta.fields?.[fieldName],
    identityContext,
    modelPromise,
    loadedValue,
    relativeTo,
  );
  return result;
}

export interface SerializeOpts {
  includeComputeds?: boolean;
  includeUnrenderedFields?: boolean;
  maybeRelativeURL?: ((possibleURL: string) => string) | null; // setting this to null will force all URL's to be absolute
  omitFields?: [typeof BaseDef];
}

function serializeCardResource(
  model: CardDef,
  doc: JSONAPISingleResourceDocument,
  opts?: SerializeOpts,
  visited: Set<string> = new Set(),
): LooseCardResource {
  let adoptsFrom = identifyCard(model.constructor, opts?.maybeRelativeURL);
  if (!adoptsFrom) {
    throw new Error(`bug: could not identify card: ${model.constructor.name}`);
  }
  let { includeUnrenderedFields: remove, ...fieldOpts } = opts ?? {};
  let { id: removedIdField, ...fields } = getFields(model, {
    ...fieldOpts,
    usedFieldsOnly: !opts?.includeUnrenderedFields,
  });
  let fieldResources = Object.entries(fields)
    .filter(([_fieldName, field]) =>
      opts?.omitFields ? !opts.omitFields.includes(field.card) : true,
    )
    .map(([fieldName]) => serializedGet(model, fieldName, doc, visited, opts));
  return merge(
    {
      attributes: {},
    },
    ...fieldResources,
    {
      type: 'card',
      meta: { adoptsFrom },
    },
    model.id ? { id: model.id } : undefined,
  );
}

export function serializeCard(
  model: CardDef,
  opts?: SerializeOpts,
): LooseSingleCardDocument {
  let doc = {
    data: { type: 'card', ...(model.id != null ? { id: model.id } : {}) },
  };
  let modelRelativeTo = model[relativeTo];
  let data = serializeCardResource(model, doc, {
    ...opts,
    // if opts.maybeRelativeURL is null that is our indication
    // that the caller wants all the URL's to be absolute
    ...(opts?.maybeRelativeURL !== null
      ? {
          maybeRelativeURL(possibleURL: string) {
            let url = maybeURL(possibleURL, modelRelativeTo);
            if (!url) {
              throw new Error(
                `could not determine url from '${maybeRelativeURL}' relative to ${modelRelativeTo}`,
              );
            }
            if (!modelRelativeTo) {
              return url.href;
            }
            return maybeRelativeURL(url, modelRelativeTo, model[realmURL]);
          },
        }
      : {}),
  });
  merge(doc, { data });
  if (!isSingleCardDocument(doc)) {
    throw new Error(
      `Expected serialized card to be a SingleCardDocument, but is was: ${JSON.stringify(
        doc,
        null,
        2,
      )}`,
    );
  }
  return doc;
}

// you may need to use this type for the loader passed in the opts
export type LoaderType = NonNullable<
  NonNullable<Parameters<typeof createFromSerialized>[3]>
>;

// TODO Currently our deserialization process performs 2 tasks that probably
// need to be disentangled:
// 1. convert the data from a wire format to the native format
// 2. absorb async to load computeds
//
// Consider the scenario where the server is providing the client the card JSON,
// in this case the server has already processed the computed, and all we really
// need to do is purely the conversion of the data from the wire format to the
// native format which should be async. Instead our client is re-doing the work
// to calculate the computeds that the server has already done.

// use an interface loader and not the class Loader
export async function createFromSerialized<T extends BaseDefConstructor>(
  resource: LooseCardResource,
  doc: LooseSingleCardDocument | CardDocument,
  relativeTo: URL | undefined,
  loader: Loader,
  opts?: { identityContext?: IdentityContext },
): Promise<BaseInstanceType<T>> {
  let identityContext = opts?.identityContext ?? new IdentityContext();
  let {
    meta: { adoptsFrom },
  } = resource;
  let card: typeof BaseDef | undefined = await loadCard(adoptsFrom, {
    loader,
    relativeTo,
  });
  if (!card) {
    throw new Error(`could not find card: '${humanReadable(adoptsFrom)}'`);
  }
  return await _createFromSerialized(
    card as T,
    resource as any,
    doc,
    relativeTo,
    identityContext,
  );
}

export async function updateFromSerialized<T extends BaseDefConstructor>(
  instance: BaseInstanceType<T>,
  doc: LooseSingleCardDocument,
): Promise<BaseInstanceType<T>> {
  let identityContext = identityContexts.get(instance);
  if (!identityContext) {
    identityContext = new IdentityContext();
    identityContexts.set(instance, identityContext);
  }
  if (!instance[relativeTo] && doc.data.id) {
    instance[relativeTo] = new URL(doc.data.id);
  }

  if (isCardInstance(instance)) {
    if (!instance[realmInfo] && doc.data.meta.realmInfo) {
      instance[realmInfo] = doc.data.meta.realmInfo;
    }
    if (!instance[realmURL] && doc.data.meta.realmURL) {
      instance[realmURL] = new URL(doc.data.meta.realmURL);
    }
  }
  return await _updateFromSerialized(instance, doc.data, doc, identityContext);
}

// The typescript `is` type here refuses to work unless it's in this file.
function isCardInstance(instance: any): instance is CardDef {
  return _isCardInstance(instance);
}

async function _createFromSerialized<T extends BaseDefConstructor>(
  card: T,
  data: T extends { [primitive]: infer P } ? P : LooseCardResource,
  doc: LooseSingleCardDocument | CardDocument | undefined,
  _relativeTo: URL | undefined,
  identityContext: IdentityContext = new IdentityContext(),
): Promise<BaseInstanceType<T>> {
  if (primitive in card) {
    return card[deserialize](data, _relativeTo);
  }
  let resource: LooseCardResource | undefined;
  if (isCardResource(data)) {
    resource = data;
  }
  if (!resource) {
    let adoptsFrom = identifyCard(card);
    if (!adoptsFrom) {
      throw new Error(
        `bug: could not determine identity for card '${card.name}'`,
      );
    }
    // in this case we are dealing with an empty instance
    resource = { meta: { adoptsFrom } };
  }
  if (!doc) {
    doc = { data: resource };
  }
  let instance: BaseInstanceType<T> | undefined;
  if (resource.id != null) {
    instance = identityContext.identities.get(resource.id) as
      | BaseInstanceType<T>
      | undefined;
  }
  if (!instance) {
    instance = new card({ id: resource.id }) as BaseInstanceType<T>;
    instance[relativeTo] = _relativeTo;
    if (isCardInstance(instance)) {
      instance[realmInfo] = data?.meta?.realmInfo;
      instance[realmURL] = data?.meta?.realmURL
        ? new URL(data.meta.realmURL)
        : undefined;
    }
  }
  identityContexts.set(instance, identityContext);
  return await _updateFromSerialized(instance, resource, doc, identityContext);
}

async function _updateFromSerialized<T extends BaseDefConstructor>(
  instance: BaseInstanceType<T>,
  resource: LooseCardResource,
  doc: LooseSingleCardDocument | CardDocument,
  identityContext: IdentityContext,
): Promise<BaseInstanceType<T>> {
  if (resource.id != null) {
    identityContext.identities.set(resource.id, instance as CardDef); // the instance must be a composite card since we are updating it from a resource
  }
  let deferred = new Deferred<BaseDef>();
  let card = Reflect.getPrototypeOf(instance)!.constructor as T;
  let nonNestedRelationships = Object.fromEntries(
    Object.entries(resource.relationships ?? {}).filter(
      ([fieldName]) => !fieldName.includes('.'),
    ),
  );
  let linksToManyRelationships: Record<string, Relationship[]> = Object.entries(
    resource.relationships ?? {},
  )
    .filter(
      ([fieldName]) =>
        fieldName.split('.').length === 2 &&
        fieldName.split('.')[1].match(/^\d+$/),
    )
    .reduce((result, [fieldName, value]) => {
      let name = fieldName.split('.')[0];
      result[name] = result[name] || [];
      result[name].push(value);
      return result;
    }, Object.create(null));

  let loadedValues = getDataBucket(instance);
  let values = (await Promise.all(
    Object.entries(
      {
        ...resource.attributes,
        ...nonNestedRelationships,
        ...linksToManyRelationships,
        ...(resource.id !== undefined ? { id: resource.id } : {}),
      } ?? {},
    ).map(async ([fieldName, value]) => {
      let field = getField(card, fieldName);
      if (!field) {
        // This happens when the instance has a field that is not in the definition. It can happen when
        // instance or definition is updated and the other is not. In this case we will just ignore the
        // mismatch and try to serialize it anyway so that the client can see still see the instance data
        // and have a chance to fix it so that it adheres to the definiton
        return [];
      }
      let relativeToVal = instance[relativeTo];
      return [
        fieldName,
        await getDeserializedValue({
          card,
          loadedValue: loadedValues.get(fieldName),
          fieldName,
          value,
          resource,
          modelPromise: deferred.promise,
          doc,
          identityContext,
          relativeTo: relativeToVal,
        }),
      ];
    }),
  )) as [keyof BaseInstanceType<T>, any][];

  // this block needs to be synchronous
  {
    let wasSaved = false;
    let originalId: string | undefined;
    if (isCardInstance(instance)) {
      wasSaved = instance[isSavedInstance];
      originalId = (instance as CardDef).id; // the instance is a composite card
      instance[isSavedInstance] = false;
    }
    for (let [fieldName, value] of values) {
      if (fieldName === 'id' && wasSaved && originalId !== value) {
        throw new Error(
          `cannot change the id for saved instance ${originalId}`,
        );
      }
      let deserialized = getDataBucket(instance);

      // Before updating field's value, we also have to make sure
      // the subscribers also subscribes to a new value.
      let existingValue = deserialized.get(fieldName as string);
      if (
        isCardOrField(existingValue) &&
        isCardOrField(value) &&
        existingValue !== value
      ) {
        migrateSubscribers(existingValue, value);
      }
      deserialized.set(fieldName as string, value);
      logger.log(recompute(instance));
    }
    if (isCardInstance(instance) && resource.id != null) {
      // importantly, we place this synchronously after the assignment of the model's
      // fields, such that subsequent assignment of the id field when the model is
      // saved will throw
      instance[isSavedInstance] = true;
    }
  }

  deferred.fulfill(instance);
  return instance;
}

export function setCardAsSavedForTest(instance: CardDef): void {
  instance[isSavedInstance] = true;
}

export async function searchDoc<CardT extends BaseDefConstructor>(
  instance: InstanceType<CardT>,
): Promise<Record<string, any>> {
  return getQueryableValue(instance.constructor, instance) as Record<
    string,
    any
  >;
}

function notifySubscribers(instance: BaseDef, fieldName: string, value: any) {
  let changeSubscribers = subscribers.get(instance);
  if (changeSubscribers) {
    for (let subscriber of changeSubscribers) {
      subscriber(instance, fieldName, value);
    }
  }
}

export function getComponent(model: BaseDef, field?: Field): BoxComponent {
  let box = Box.create(model);
  let boxComponent = getBoxComponent(
    model.constructor as BaseDefConstructor,
    box,
    field,
  );
  return boxComponent;
}

interface RecomputeOptions {
  loadFields?: true;
  // for host initiated renders (vs indexer initiated renders), glimmer will expect
  // all the fields to be available synchronously, in which case we need to buffer the
  // async in the recompute using this option
  recomputeAllFields?: true;
}
export async function recompute(
  card: BaseDef,
  opts?: RecomputeOptions,
): Promise<void> {
  // Note that after each async step we check to see if we are still the
  // current promise, otherwise we bail
  let done: () => void;
  let recomputePromise = new Promise<void>((res) => (done = res));
  recomputePromises.set(card, recomputePromise);

  // wait a full micro task before we start - this is simple debounce
  await Promise.resolve();
  if (recomputePromises.get(card) !== recomputePromise) {
    return;
  }

  async function _loadModel<T extends BaseDef>(
    model: T,
    stack: BaseDef[] = [],
  ): Promise<void> {
    let pendingFields = new Set<string>(
      Object.keys(
        getFields(model, {
          includeComputeds: true,
          usedFieldsOnly: !opts?.recomputeAllFields,
        }),
      ),
    );
    do {
      for (let fieldName of [...pendingFields]) {
        let value = await getIfReady(
          model,
          fieldName as keyof T,
          undefined,
          opts,
        );
        if (!isNotReadyValue(value) && !isStaleValue(value)) {
          pendingFields.delete(fieldName);
          if (recomputePromises.get(card) !== recomputePromise) {
            return;
          }
          if (Array.isArray(value)) {
            for (let item of value) {
              if (item && isCardOrField(item) && !stack.includes(item)) {
                await _loadModel(item, [item, ...stack]);
              }
            }
          } else if (isCardOrField(value) && !stack.includes(value)) {
            await _loadModel(value, [value, ...stack]);
          }
        }
      }
      // TODO should we have a timeout?
    } while (pendingFields.size > 0);
  }

  await _loadModel(card);
  if (recomputePromises.get(card) !== recomputePromise) {
    return;
  }

  // notify glimmer to rerender this card
  cardTracking.set(card, true);
  done!();
}

export async function getIfReady<T extends BaseDef, K extends keyof T>(
  instance: T,
  fieldName: K,
  compute: () => T[K] | Promise<T[K]> = () => instance[fieldName],
  opts?: RecomputeOptions,
): Promise<T[K] | T[K][] | NotReadyValue | StaleValue | undefined> {
  let result: T[K] | T[K][] | undefined;
  let deserialized = getDataBucket(instance);
  let maybeStale = deserialized.get(fieldName as string);
  let field = getField(
    Reflect.getPrototypeOf(instance)!.constructor as typeof BaseDef,
    fieldName as string,
  );
  if (isStaleValue(maybeStale)) {
    if (!field) {
      throw new Error(
        `the field '${fieldName as string} does not exist in card ${
          instance.constructor.name
        }'`,
      );
    }
    let { computeVia: _computeVia } = field;
    if (!_computeVia) {
      throw new Error(
        `the field '${fieldName as string}' is not a computed field in card ${
          instance.constructor.name
        }`,
      );
    }
    let computeVia = _computeVia as (() => T[K] | Promise<T[K]>) | string;
    compute =
      typeof computeVia === 'function'
        ? computeVia.bind(instance)
        : () => (instance as any)[computeVia as string]();
  }
  try {
    //To avoid race conditions,
    //the computeVia function should not perform asynchronous computation
    //if it is not an async function.
    //This ensures that other functions are not executed
    //by the runtime before this function is finished.
    let computeResult = compute();
    result =
      computeResult instanceof Promise ? await computeResult : computeResult;
  } catch (e: any) {
    if (isNotLoadedError(e)) {
      let card = Reflect.getPrototypeOf(instance)!
        .constructor as typeof BaseDef;
      let field: Field = getField(card, fieldName as string)!;
      return (await field.handleNotLoadedError(instance, e, opts)) as
        | T[K]
        | T[K][]
        | undefined;
    } else if (isNotReadyError(e)) {
      let { instance: depModel, computeVia, fieldName: depField } = e;
      let nestedCompute =
        typeof computeVia === 'function'
          ? computeVia.bind(depModel)
          : () => depModel[computeVia as string]();
      await getIfReady(depModel, depField, nestedCompute, opts);
      return { type: 'not-ready', instance, fieldName: fieldName as string };
    } else {
      throw e;
    }
  }

  //Only update the value of computed field.
  if (field?.computeVia) {
    deserialized.set(fieldName as string, result);
  }
  return result;
}

type ElementType<T> = T extends (infer V)[] ? V : never;

declare module 'ember-provide-consume-context/context-registry' {
  export default interface ContextRegistry {
    [CardContextName]: CardContext;
  }
}
