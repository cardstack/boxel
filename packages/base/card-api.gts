import Modifier from 'ember-modifier';
import GlimmerComponent from '@glimmer/component';
import { flatMap, merge, isEqual } from 'lodash';
import { TrackedWeakMap } from 'tracked-built-ins';
import { WatchedArray } from './watched-array';
import { on } from '@ember/modifier';
import { BoxelInput } from '@cardstack/boxel-ui';
import pick from '@cardstack/boxel-ui/helpers/pick';
import { getBoxComponent } from './field-component';
import { getContainsManyComponent } from './contains-many-component';
import { getLinksToEditor } from './links-to-editor';
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
  NotLoaded,
  NotReady,
  getField,
  isField,
  primitive,
  identifyCard,
  loadCard,
  humanReadable,
  maybeURL,
  maybeRelativeURL,
  type Meta,
  type CardFields,
  type Relationship,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type CardDocument,
  type CardResource,
  type Actions,
  type RealmInfo,
} from '@cardstack/runtime-common';
import type { ComponentLike } from '@glint/template';

export { primitive, isField };
export const serialize = Symbol('cardstack-serialize');
export const deserialize = Symbol('cardstack-deserialize');
export const useIndexBasedKey = Symbol('cardstack-use-index-based-key');
export const fieldDecorator = Symbol('cardstack-field-decorator');
export const fieldType = Symbol('cardstack-field-type');
export const queryableValue = Symbol('cardstack-queryable-value');
export const relativeTo = Symbol('cardstack-relative-to');
export const realmInfo = Symbol('cardstack-realm-info');
export const realmURL = Symbol('cardstack-realm-url');
// intentionally not exporting this so that the outside world
// cannot mark a card as being saved
const isSavedInstance = Symbol('cardstack-is-saved-instance');

export type BaseInstanceType<T extends BaseDefConstructor> = T extends {
  [primitive]: infer P;
}
  ? P
  : InstanceType<T>;
export type PartialBaseInstanceType<T extends BaseDefConstructor> = T extends {
  [primitive]: infer P;
}
  ? P | null
  : Partial<InstanceType<T>>;
export type FieldsTypeFor<T extends BaseDef> = {
  [Field in keyof T]: ComponentLike<{ Args: {}; Blocks: {} }> &
    (T[Field] extends ArrayLike<unknown>
      ? ComponentLike<{ Args: {}; Blocks: {} }>[]
      : T[Field] extends BaseDef
      ? FieldsTypeFor<T[Field]>
      : unknown);
};
export type Format = 'isolated' | 'embedded' | 'edit';
export type FieldType = 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';

type Setter = { setters: { [fieldName: string]: Setter } } & ((
  value: any,
) => void);

interface Options {
  computeVia?: string | (() => unknown);
  // there exists cards that we only ever run in the host without
  // the isolated renderer (RoomCard), which means that we cannot
  // use the rendering mechanism to tell if a card is used or not,
  // in which case we need to tell the runtime that a card is
  // explictly being used.
  isUsed?: true;
}

interface NotLoadedValue {
  type: 'not-loaded';
  reference: string;
}

export interface CardContext {
  actions?: Actions;
  cardComponentModifier?: typeof Modifier<{
    Args: {
      Named: {
        card: CardDef;
        format: Format | 'data';
        fieldType: FieldType | undefined;
        fieldName: string | undefined;
      };
    };
  }>;
  renderedIn?: Component<any>;
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
      isCard(value.instance) &&
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

type CardChangeSubscriber = (fieldName: string, fieldValue: any) => void;

function isStaleValue(value: any): value is StaleValue {
  if (value && typeof value === 'object') {
    return 'type' in value && value.type === 'stale' && 'staleValue' in value;
  } else {
    return false;
  }
}
const deserializedData = new WeakMap<BaseDef, Map<string, any>>();
const recomputePromises = new WeakMap<BaseDef, Promise<any>>();
const identityContexts = new WeakMap<BaseDef, IdentityContext>();
const subscribers = new WeakMap<BaseDef, Set<CardChangeSubscriber>>();

// our place for notifying Glimmer when a card is ready to re-render (which will
// involve rerunning async computed fields)
const cardTracking = new TrackedWeakMap<object, any>();

const isBaseInstance = Symbol('isBaseInstance');

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

export interface Field<
  CardT extends BaseDefConstructor = BaseDefConstructor,
  SearchT = any,
> {
  card: CardT;
  name: string;
  fieldType: FieldType;
  computeVia: undefined | string | (() => unknown);
  // there exists cards that we only ever run in the host without
  // the isolated renderer (RoomCard), which means that we cannot
  // use the rendering mechanism to tell if a card is used or not,
  // in which case we need to tell the runtime that a card is
  // explictly being used.
  isUsed?: undefined | true;
  serialize(
    value: any,
    doc: JSONAPISingleResourceDocument,
    visited: Set<string>,
    opts?: SerializeOpts,
  ): JSONAPIResource;
  deserialize(
    value: any,
    doc: LooseSingleCardDocument | CardDocument,
    relationships: JSONAPIResource['relationships'] | undefined,
    fieldMeta: CardFields[string] | undefined,
    identityContext: IdentityContext | undefined,
    instancePromise: Promise<BaseDef>,
    loadedValue: any,
    relativeTo: URL | undefined,
  ): Promise<any>;
  emptyValue(instance: BaseDef): any;
  validate(instance: BaseDef, value: any): void;
  component(
    model: Box<BaseDef>,
    format: Format,
    context?: CardContext,
  ): ComponentLike<{ Args: {}; Blocks: {} }>;
  getter(instance: BaseDef): BaseInstanceType<CardT>;
  queryableValue(value: any, stack: BaseDef[]): SearchT;
  queryMatcher(
    innerMatcher: (innerValue: any) => boolean | null,
  ): (value: SearchT) => boolean | null;
  handleNotLoadedError(
    instance: BaseInstanceType<CardT>,
    e: NotLoaded,
    opts?: RecomputeOptions,
  ): Promise<
    BaseInstanceType<CardT> | BaseInstanceType<CardT>[] | undefined | void
  >;
}

function callSerializeHook(
  card: typeof BaseDef,
  value: any,
  doc: JSONAPISingleResourceDocument,
  visited: Set<string> = new Set(),
  opts?: SerializeOpts,
) {
  if (value != null) {
    return card[serialize](value, doc, visited, opts);
  } else {
    return null;
  }
}

function cardTypeFor(
  field: Field<typeof BaseDef>,
  boxedElement: Box<BaseDef>,
): typeof BaseDef {
  if (primitive in field.card) {
    return field.card;
  }
  return Reflect.getPrototypeOf(boxedElement.value)!
    .constructor as typeof BaseDef;
}

function resourceFrom(
  doc: CardDocument | undefined,
  resourceId: string | undefined,
): LooseCardResource | undefined {
  if (doc == null) {
    return undefined;
  }
  let data: CardResource[];
  if (isSingleCardDocument(doc)) {
    if (resourceId == null) {
      return doc.data;
    }
    data = [doc.data];
  } else {
    data = doc.data;
  }
  let res = [...data, ...(doc.included ?? [])].find(
    (resource) => resource.id === resourceId,
  );
  return res;
}

function getter<CardT extends BaseDefConstructor>(
  instance: BaseDef,
  field: Field<CardT>,
): BaseInstanceType<CardT> {
  let deserialized = getDataBucket(instance);
  // this establishes that our field should rerender when cardTracking for this card changes
  cardTracking.get(instance);

  if (field.computeVia) {
    let value = deserialized.get(field.name);
    if (isStaleValue(value)) {
      value = value.staleValue;
    } else if (
      !deserialized.has(field.name) &&
      typeof field.computeVia === 'function' &&
      field.computeVia.constructor.name !== 'AsyncFunction'
    ) {
      value = field.computeVia.bind(instance)();
      deserialized.set(field.name, value);
    } else if (
      !deserialized.has(field.name) &&
      (typeof field.computeVia === 'string' ||
        typeof field.computeVia === 'function')
    ) {
      throw new NotReady(instance, field.name, field.computeVia);
    }
    return value;
  } else {
    if (deserialized.has(field.name)) {
      return deserialized.get(field.name);
    }
    let value = field.emptyValue(instance);
    deserialized.set(field.name, value);
    return value;
  }
}

class ContainsMany<FieldT extends FieldDefConstructor>
  implements Field<FieldT, any[]>
{
  readonly fieldType = 'containsMany';
  constructor(
    private cardThunk: () => FieldT,
    readonly computeVia: undefined | string | (() => unknown),
    readonly name: string,
    readonly isUsed: undefined | true,
  ) {}

  get card(): FieldT {
    return this.cardThunk();
  }

  getter(instance: BaseDef): BaseInstanceType<FieldT> {
    return getter(instance, this);
  }

  queryableValue(instances: any[] | null, stack: BaseDef[]): any[] {
    if (instances == null) {
      return [];
    }

    // Need to replace the WatchedArray proxy with an actual array because the
    // WatchedArray proxy is not structuredClone-able, and hence cannot be
    // communicated over the postMessage boundary between worker and DOM.
    // TODO: can this be simplified since we don't have the worker anymore?
    return [...instances].map((instance) => {
      return this.card[queryableValue](instance, stack);
    });
  }

  queryMatcher(
    innerMatcher: (innerValue: any) => boolean | null,
  ): (value: any[]) => boolean | null {
    return (value) => {
      if (value.length === 0) {
        return innerMatcher(null);
      }
      return value.some((innerValue) => {
        return innerMatcher(innerValue);
      });
    };
  }

  serialize(
    values: BaseInstanceType<FieldT>[],
    doc: JSONAPISingleResourceDocument,
    _visited: Set<string>,
    opts?: SerializeOpts,
  ): JSONAPIResource {
    if (primitive in this.card) {
      return {
        attributes: {
          [this.name]: values.map((value) =>
            callSerializeHook(this.card, value, doc, undefined, opts),
          ),
        },
      };
    } else {
      let relationships: Record<string, Relationship> = {};
      let serialized = values.map((value, index) => {
        let resource: JSONAPISingleResourceDocument['data'] = callSerializeHook(
          this.card,
          value,
          doc,
          undefined,
          opts,
        );
        if (resource.relationships) {
          for (let [fieldName, relationship] of Object.entries(
            resource.relationships as Record<string, Relationship>,
          )) {
            relationships[`${this.name}.${index}.${fieldName}`] = relationship; // warning side-effect
          }
        }
        if (this.card === Reflect.getPrototypeOf(value)!.constructor) {
          // when our implementation matches the default we don't need to include
          // meta.adoptsFrom
          delete resource.meta?.adoptsFrom;
        }
        if (resource.meta && Object.keys(resource.meta).length === 0) {
          delete resource.meta;
        }
        return resource;
      });

      let result: JSONAPIResource = {
        attributes: {
          [this.name]: serialized.map((resource) => resource.attributes),
        },
      };
      if (Object.keys(relationships).length > 0) {
        result.relationships = relationships;
      }

      if (serialized.some((resource) => resource.meta)) {
        result.meta = {
          fields: {
            [this.name]: serialized.map((resource) => resource.meta ?? {}),
          },
        };
      }

      return result;
    }
  }

  async deserialize(
    value: any[],
    doc: CardDocument,
    relationships: JSONAPIResource['relationships'] | undefined,
    fieldMeta: CardFields[string] | undefined,
    _identityContext: undefined,
    instancePromise: Promise<BaseDef>,
    _loadedValue: any,
    relativeTo: URL | undefined,
  ): Promise<BaseInstanceType<FieldT>[]> {
    if (!Array.isArray(value)) {
      throw new Error(`Expected array for field value ${this.name}`);
    }
    if (fieldMeta && !Array.isArray(fieldMeta)) {
      throw new Error(
        `fieldMeta for contains-many field '${
          this.name
        }' is not an array: ${JSON.stringify(fieldMeta, null, 2)}`,
      );
    }
    let metas: Partial<Meta>[] = fieldMeta ?? [];
    return new WatchedArray(
      (arrayValue) =>
        instancePromise.then((instance) => {
          notifySubscribers(instance, field.name, arrayValue);
          logger.log(recompute(instance));
        }),
      await Promise.all(
        value.map(async (entry, index) => {
          if (primitive in this.card) {
            return this.card[deserialize](entry, relativeTo, doc);
          } else {
            let meta = metas[index];
            let resource: LooseCardResource = {
              attributes: entry,
              meta: makeMetaForField(meta, this.name, this.card),
            };
            if (relationships) {
              resource.relationships = Object.fromEntries(
                Object.entries(relationships)
                  .filter(([fieldName]) =>
                    fieldName.startsWith(`${this.name}.`),
                  )
                  .map(([fieldName, relationship]) => {
                    let relName = `${this.name}.${index}`;
                    return [
                      fieldName.startsWith(`${relName}.`)
                        ? fieldName.substring(relName.length + 1)
                        : fieldName,
                      relationship,
                    ];
                  }),
              );
            }
            return (
              await cardClassFromResource(resource, this.card, relativeTo)
            )[deserialize](resource, relativeTo, doc);
          }
        }),
      ),
    );
  }

  emptyValue(instance: BaseDef) {
    return new WatchedArray((value) => {
      notifySubscribers(instance, this.name, value);
      logger.log(recompute(instance));
    });
  }

  validate(instance: BaseDef, value: any) {
    if (value && !Array.isArray(value)) {
      throw new Error(`Expected array for field value ${this.name}`);
    }
    return new WatchedArray((value) => {
      notifySubscribers(instance, this.name, value);
      logger.log(recompute(instance));
    }, value);
  }

  async handleNotLoadedError<T extends BaseDef>(instance: T, _e: NotLoaded) {
    throw new Error(
      `cannot load missing field for non-linksTo or non-linksToMany field ${instance.constructor.name}.${this.name}`,
    );
  }

  component(
    model: Box<BaseDef>,
    format: Format,
  ): ComponentLike<{ Args: {}; Blocks: {} }> {
    let fieldName = this.name as keyof BaseDef;
    let arrayField = model.field(
      fieldName,
      useIndexBasedKey in this.card,
    ) as unknown as Box<BaseDef[]>;
    return getContainsManyComponent({
      model,
      arrayField,
      field: this,
      format,
      cardTypeFor,
    });
  }
}

class Contains<CardT extends FieldDefConstructor> implements Field<CardT, any> {
  readonly fieldType = 'contains';
  constructor(
    private cardThunk: () => CardT,
    readonly computeVia: undefined | string | (() => unknown),
    readonly name: string,
    readonly isUsed: undefined | true,
  ) {}

  get card(): CardT {
    return this.cardThunk();
  }

  getter(instance: BaseDef): BaseInstanceType<CardT> {
    return getter(instance, this);
  }

  queryableValue(instance: any, stack: BaseDef[]): any {
    if (primitive in this.card) {
      let result = this.card[queryableValue](instance, stack);
      assertScalar(result, this.card);
      return result;
    }
    if (instance == null) {
      return null;
    }
    return this.card[queryableValue](instance, stack);
  }

  queryMatcher(
    innerMatcher: (innerValue: any) => boolean | null,
  ): (value: any) => boolean | null {
    return (value) => innerMatcher(value);
  }

  serialize(
    value: InstanceType<CardT>,
    doc: JSONAPISingleResourceDocument,
  ): JSONAPIResource {
    let serialized: JSONAPISingleResourceDocument['data'] & {
      meta: Record<string, any>;
    } = callSerializeHook(this.card, value, doc);
    if (primitive in this.card) {
      return { attributes: { [this.name]: serialized } };
    } else {
      let resource: JSONAPIResource = {
        attributes: {
          [this.name]: serialized?.attributes,
        },
      };
      if (serialized == null) {
        return resource;
      }
      if (serialized.relationships) {
        resource.relationships = {};
        for (let [fieldName, relationship] of Object.entries(
          serialized.relationships as Record<string, Relationship>,
        )) {
          resource.relationships[`${this.name}.${fieldName}`] = relationship;
        }
      }

      if (this.card === Reflect.getPrototypeOf(value)!.constructor) {
        // when our implementation matches the default we don't need to include
        // meta.adoptsFrom
        delete serialized.meta.adoptsFrom;
      }

      if (Object.keys(serialized.meta).length > 0) {
        resource.meta = {
          fields: { [this.name]: serialized.meta },
        };
      }
      return resource;
    }
  }

  async deserialize(
    value: any,
    doc: CardDocument,
    relationships: JSONAPIResource['relationships'] | undefined,
    fieldMeta: CardFields[string] | undefined,
    _identityContext: undefined,
    _instancePromise: Promise<BaseDef>,
    _loadedValue: any,
    relativeTo: URL | undefined,
  ): Promise<BaseInstanceType<CardT>> {
    if (primitive in this.card) {
      return this.card[deserialize](value, relativeTo, doc);
    }
    if (fieldMeta && Array.isArray(fieldMeta)) {
      throw new Error(
        `fieldMeta for contains field '${
          this.name
        }' is an array: ${JSON.stringify(fieldMeta, null, 2)}`,
      );
    }
    let meta: Partial<Meta> | undefined = fieldMeta;
    let resource: LooseCardResource = {
      attributes: value,
      meta: makeMetaForField(meta, this.name, this.card),
    };
    if (relationships) {
      resource.relationships = Object.fromEntries(
        Object.entries(relationships)
          .filter(([fieldName]) => fieldName.startsWith(`${this.name}.`))
          .map(([fieldName, relationship]) => [
            fieldName.startsWith(`${this.name}.`)
              ? fieldName.substring(this.name.length + 1)
              : fieldName,
            relationship,
          ]),
      );
    }
    return (await cardClassFromResource(resource, this.card, relativeTo))[
      deserialize
    ](resource, relativeTo, doc);
  }

  emptyValue(_instance: BaseDef) {
    if (primitive in this.card) {
      return undefined;
    } else {
      return new this.card();
    }
  }

  validate(_instance: BaseDef, value: any) {
    if (primitive in this.card) {
      // todo: primitives could implement a validation symbol
    } else {
      if (value != null && !(value instanceof this.card)) {
        throw new Error(
          `tried set ${value} as field ${this.name} but it is not an instance of ${this.card.name}`,
        );
      }
    }
    return value;
  }

  async handleNotLoadedError<T extends BaseDef>(instance: T, _e: NotLoaded) {
    throw new Error(
      `cannot load missing field for non-linksTo or non-linksToMany field ${instance.constructor.name}.${this.name}`,
    );
  }

  component(
    model: Box<BaseDef>,
    format: Format,
    context?: CardContext,
  ): ComponentLike<{ Args: {}; Blocks: {} }> {
    return fieldComponent(this, model, format, context);
  }
}

class LinksTo<CardT extends CardDefConstructor> implements Field<CardT> {
  readonly fieldType = 'linksTo';
  constructor(
    private cardThunk: () => CardT,
    readonly computeVia: undefined | string | (() => unknown),
    readonly name: string,
    readonly isUsed: undefined | true,
  ) {}

  get card(): CardT {
    return this.cardThunk();
  }

  getter(instance: CardDef): BaseInstanceType<CardT> {
    let deserialized = getDataBucket(instance);
    // this establishes that our field should rerender when cardTracking for this card changes
    cardTracking.get(instance);
    let maybeNotLoaded = deserialized.get(this.name);
    if (isNotLoadedValue(maybeNotLoaded)) {
      throw new NotLoaded(instance, maybeNotLoaded.reference, this.name);
    }
    return getter(instance, this);
  }

  queryableValue(instance: any, stack: CardDef[]): any {
    if (primitive in this.card) {
      throw new Error(
        `the linksTo field '${this.name}' contains a primitive card '${this.card.name}'`,
      );
    }
    if (instance == null) {
      return null;
    }
    return this.card[queryableValue](instance, stack);
  }

  queryMatcher(
    innerMatcher: (innerValue: any) => boolean | null,
  ): (value: any) => boolean | null {
    return (value) => innerMatcher(value);
  }

  serialize(
    value: InstanceType<CardT>,
    doc: JSONAPISingleResourceDocument,
    visited: Set<string>,
    opts?: SerializeOpts,
  ) {
    if (isNotLoadedValue(value)) {
      return {
        relationships: {
          [this.name]: {
            links: {
              self: makeRelativeURL(value.reference, opts),
            },
          },
        },
      };
    }
    if (value == null) {
      return {
        relationships: {
          [this.name]: {
            links: { self: null },
          },
        },
      };
    }
    if (visited.has(value.id)) {
      return {
        relationships: {
          [this.name]: {
            links: {
              self: makeRelativeURL(value.id, opts),
            },
            data: { type: 'card', id: value.id },
          },
        },
      };
    }
    visited.add(value.id);

    let serialized = callSerializeHook(this.card, value, doc, visited, opts) as
      | (JSONAPIResource & { id: string; type: string })
      | null;
    if (serialized) {
      if (!value[isSavedInstance]) {
        throw new Error(
          `the linksTo field '${this.name}' cannot be serialized with an unsaved card`,
        );
      }
      let resource: JSONAPIResource = {
        relationships: {
          [this.name]: {
            links: {
              self: makeRelativeURL(value.id, opts),
            },
            // we also write out the data form of the relationship
            // which correlates to the included resource
            data: { type: 'card', id: value.id },
          },
        },
      };
      if (
        !(doc.included ?? []).find((r) => r.id === value.id) &&
        doc.data.id !== value.id
      ) {
        doc.included = doc.included ?? [];
        doc.included.push(serialized);
      }
      return resource;
    }
    return {
      relationships: {
        [this.name]: {
          links: { self: null },
        },
      },
    };
  }

  async deserialize(
    value: any,
    doc: CardDocument,
    _relationships: undefined,
    _fieldMeta: undefined,
    identityContext: IdentityContext,
    _instancePromise: Promise<CardDef>,
    loadedValue: any,
    relativeTo: URL | undefined,
  ): Promise<BaseInstanceType<CardT> | null | NotLoadedValue> {
    if (!isRelationship(value)) {
      throw new Error(
        `linkTo field '${
          this.name
        }' cannot deserialize non-relationship value ${JSON.stringify(value)}`,
      );
    }
    if (value?.links?.self == null) {
      return null;
    }
    let cachedInstance = identityContext.identities.get(value.links.self);
    if (cachedInstance) {
      return cachedInstance as BaseInstanceType<CardT>;
    }
    let resourceId = new URL(value.links.self, relativeTo).href;
    let resource = resourceFrom(doc, resourceId);
    if (!resource) {
      if (loadedValue !== undefined) {
        return loadedValue;
      }
      return {
        type: 'not-loaded',
        reference: value.links.self,
      };
    }
    return (await cardClassFromResource(resource, this.card, relativeTo))[
      deserialize
    ](resource, relativeTo, doc, identityContext);
  }

  emptyValue(_instance: CardDef) {
    return null;
  }

  validate(_instance: CardDef, value: any) {
    // we can't actually place this in the constructor since that would break cards whose field type is themselves
    // so the next opportunity we have to test this scenario is during field assignment
    if (primitive in this.card) {
      throw new Error(
        `the linksTo field '${this.name}' contains a primitive card '${this.card.name}'`,
      );
    }
    if (value) {
      if (isNotLoadedValue(value)) {
        return value;
      }
      if (!(value instanceof this.card)) {
        throw new Error(
          `tried set ${value} as field '${this.name}' but it is not an instance of ${this.card.name}`,
        );
      }
    }
    return value;
  }

  async handleNotLoadedError(
    instance: BaseInstanceType<CardT>,
    e: NotLoaded,
    opts?: RecomputeOptions,
  ): Promise<BaseInstanceType<CardT> | undefined> {
    let deserialized = getDataBucket(instance as BaseDef);
    let identityContext =
      identityContexts.get(instance as BaseDef) ?? new IdentityContext();
    // taking advantage of the identityMap regardless of whether loadFields is set
    let fieldValue = identityContext.identities.get(e.reference as string);

    if (fieldValue !== undefined) {
      deserialized.set(this.name, fieldValue);
      return fieldValue as BaseInstanceType<CardT>;
    }

    if (opts?.loadFields) {
      fieldValue = await this.loadMissingField(
        instance,
        e,
        identityContext,
        instance[relativeTo],
      );
      deserialized.set(this.name, fieldValue);
      return fieldValue as BaseInstanceType<CardT>;
    }

    return;
  }

  private async loadMissingField(
    instance: CardDef,
    notLoaded: NotLoadedValue | NotLoaded,
    identityContext: IdentityContext,
    relativeTo: URL | undefined,
  ): Promise<CardDef> {
    let { reference: maybeRelativeReference } = notLoaded;
    let reference = new URL(
      maybeRelativeReference as string,
      instance.id ?? relativeTo, // new instances may not yet have an ID, in that case fallback to the relativeTo
    ).href;
    let loader = Loader.getLoaderFor(createFromSerialized);

    if (!loader) {
      throw new Error('Could not find a loader, this should not happen');
    }

    let response = await loader.fetch(reference, {
      headers: { Accept: SupportedMimeType.CardJson },
    });
    if (!response.ok) {
      let cardError = await CardError.fromFetchResponse(reference, response);
      cardError.deps = [reference];
      cardError.additionalErrors = [
        new NotLoaded(instance, reference, this.name),
      ];
      throw cardError;
    }
    let json = await response.json();
    if (!isSingleCardDocument(json)) {
      throw new Error(
        `instance ${reference} is not a card document. it is: ${JSON.stringify(
          json,
          null,
          2,
        )}`,
      );
    }

    let fieldInstance = (await createFromSerialized(
      json.data,
      json,
      new URL(json.data.id),
      loader,
      {
        identityContext,
      },
    )) as CardDef; // a linksTo field could only be a composite card
    return fieldInstance;
  }

  component(
    model: Box<CardDef>,
    format: Format,
    context?: CardContext,
  ): ComponentLike<{ Args: {}; Blocks: {} }> {
    if (format === 'edit') {
      let innerModel = model.field(
        this.name as keyof BaseDef,
      ) as unknown as Box<CardDef | null>;
      return getLinksToEditor(innerModel, this, context);
    }
    return fieldComponent(this, model, format, context);
  }
}

class LinksToMany<FieldT extends CardDefConstructor>
  implements Field<FieldT, any[]>
{
  readonly fieldType = 'linksToMany';
  constructor(
    private cardThunk: () => FieldT,
    readonly computeVia: undefined | string | (() => unknown),
    readonly name: string,
    readonly isUsed: undefined | true,
  ) {}

  get card(): FieldT {
    return this.cardThunk();
  }

  getter(instance: CardDef): BaseInstanceType<FieldT> {
    let deserialized = getDataBucket(instance);
    cardTracking.get(instance);
    let maybeNotLoaded = deserialized.get(this.name);
    if (maybeNotLoaded) {
      let notLoadedRefs: string[] = [];
      for (let entry of maybeNotLoaded) {
        if (isNotLoadedValue(entry)) {
          notLoadedRefs = [...notLoadedRefs, entry.reference];
        }
      }
      if (notLoadedRefs.length > 0) {
        throw new NotLoaded(instance, notLoadedRefs, this.name);
      }
    }

    return getter(instance, this);
  }

  queryableValue(instances: any[] | null, stack: CardDef[]): any[] {
    if (instances == null) {
      return [];
    }

    // Need to replace the WatchedArray proxy with an actual array because the
    // WatchedArray proxy is not structuredClone-able, and hence cannot be
    // communicated over the postMessage boundary between worker and DOM.
    // TODO: can this be simplified since we don't have the worker anymore?
    return [...instances].map((instance) => {
      if (primitive in instance) {
        throw new Error(
          `the linksToMany field '${this.name}' contains a primitive card '${instance.name}'`,
        );
      }
      if (isNotLoadedValue(instance)) {
        return { id: instance.reference };
      }
      return this.card[queryableValue](instance, stack);
    });
  }

  queryMatcher(
    innerMatcher: (innerValue: any) => boolean | null,
  ): (value: any[]) => boolean | null {
    return (value) => {
      if (value.length === 0) {
        return innerMatcher(null);
      }
      return value.some((innerValue) => {
        return innerMatcher(innerValue);
      });
    };
  }

  serialize(
    values: BaseInstanceType<FieldT>[] | null | undefined,
    doc: JSONAPISingleResourceDocument,
    visited: Set<string>,
    opts?: SerializeOpts,
  ) {
    if (values == undefined || values.length === 0) {
      return {
        relationships: {
          [this.name]: {
            links: { self: null },
          },
        },
      };
    }

    if (!Array.isArray(values)) {
      throw new Error(`Expected array for field value ${this.name}`);
    }

    let relationships: Record<string, Relationship> = {};
    values.map((value, i) => {
      if (isNotLoadedValue(value)) {
        relationships[`${this.name}\.${i}`] = {
          links: {
            self: makeRelativeURL(value.reference, opts),
          },
          data: { type: 'card', id: value.reference },
        };
        return;
      }
      if (visited.has(value.id)) {
        relationships[`${this.name}\.${i}`] = {
          links: {
            self: makeRelativeURL(value.id, opts),
          },
          data: { type: 'card', id: value.id },
        };
        return;
      }
      visited.add(value.id);
      let serialized: JSONAPIResource & { id: string; type: string } =
        callSerializeHook(this.card, value, doc, visited, opts);
      if (!value[isSavedInstance]) {
        throw new Error(
          `the linksToMany field '${this.name}' cannot be serialized with an unsaved card`,
        );
      }
      if (serialized.meta && Object.keys(serialized.meta).length === 0) {
        delete serialized.meta;
      }
      if (
        !(doc.included ?? []).find((r) => r.id === value.id) &&
        doc.data.id !== value.id
      ) {
        doc.included = doc.included ?? [];
        doc.included.push(serialized);
      }
      relationships[`${this.name}\.${i}`] = {
        links: {
          self: makeRelativeURL(value.id, opts),
        },
        data: { type: 'card', id: value.id },
      };
    });

    return { relationships };
  }

  async deserialize(
    values: any,
    doc: CardDocument,
    _relationships: undefined,
    _fieldMeta: undefined,
    identityContext: IdentityContext,
    instancePromise: Promise<BaseDef>,
    loadedValues: any,
    relativeTo: URL | undefined,
  ): Promise<(BaseInstanceType<FieldT> | NotLoadedValue)[]> {
    if (!Array.isArray(values) && values.links.self === null) {
      return [];
    }

    let resources: Promise<BaseInstanceType<FieldT> | NotLoadedValue>[] =
      values.map(async (value: Relationship) => {
        if (!isRelationship(value)) {
          throw new Error(
            `linksToMany field '${
              this.name
            }' cannot deserialize non-relationship value ${JSON.stringify(
              value,
            )}`,
          );
        }
        if (value.links.self == null) {
          return null;
        }
        let cachedInstance = identityContext.identities.get(value.links.self);
        if (cachedInstance) {
          return cachedInstance;
        }
        let resourceId = new URL(value.links.self, relativeTo).href;
        let resource = resourceFrom(doc, resourceId);
        if (!resource) {
          if (loadedValues && Array.isArray(loadedValues)) {
            let loadedValue = loadedValues.find(
              (v) => isCard(v) && v.id === resourceId,
            );
            if (loadedValue) {
              return loadedValue;
            }
          }
          return {
            type: 'not-loaded',
            reference: value.links.self,
          };
        }
        return (await cardClassFromResource(resource, this.card, relativeTo))[
          deserialize
        ](resource, relativeTo, doc, identityContext);
      });

    return new WatchedArray(
      (value) =>
        instancePromise.then((instance) => {
          notifySubscribers(instance, this.name, value);
          logger.log(recompute(instance));
        }),
      await Promise.all(resources),
    );
  }

  emptyValue(instance: BaseDef) {
    return new WatchedArray((value) => {
      notifySubscribers(instance, this.name, value);
      logger.log(recompute(instance));
    });
  }

  validate(instance: BaseDef, values: any[] | null) {
    if (primitive in this.card) {
      throw new Error(
        `the linksToMany field '${this.name}' contains a primitive card '${this.card.name}'`,
      );
    }

    if (values == null) {
      return values;
    }

    if (!Array.isArray(values)) {
      throw new Error(`Expected array for field value ${this.name}`);
    }

    for (let value of values) {
      if (!isNotLoadedValue(value) && !(value instanceof this.card)) {
        throw new Error(
          `tried set ${value} as field '${this.name}' but it is not an instance of ${this.card.name}`,
        );
      }
    }

    return new WatchedArray((value) => {
      notifySubscribers(instance, this.name, value);
      logger.log(recompute(instance));
    }, values);
  }

  async handleNotLoadedError<T extends CardDef>(
    instance: T,
    e: NotLoaded,
    opts?: RecomputeOptions,
  ): Promise<T[] | undefined> {
    let result: T[] | undefined;
    let fieldValues: CardDef[] = [];
    let identityContext =
      identityContexts.get(instance) ?? new IdentityContext();

    for (let ref of e.reference) {
      // taking advantage of the identityMap regardless of whether loadFields is set
      let value = identityContext.identities.get(ref);
      if (value !== undefined) {
        fieldValues.push(value);
      }
    }

    if (opts?.loadFields) {
      fieldValues = await this.loadMissingFields(
        instance,
        e,
        identityContext,
        instance[relativeTo],
      );
    }

    if (fieldValues.length === e.reference.length) {
      let values: T[] = [];
      let deserialized = getDataBucket(instance);

      for (let field of deserialized.get(this.name)) {
        if (isNotLoadedValue(field)) {
          // replace the not-loaded values with the loaded cards
          values.push(
            fieldValues.find(
              (v) =>
                v.id === new URL(field.reference, instance[relativeTo]).href,
            )! as T,
          );
        } else {
          // keep existing loaded cards
          values.push(field);
        }
      }

      deserialized.set(this.name, values);
      result = values as T[];
    }

    return result;
  }

  private async loadMissingFields(
    instance: CardDef,
    notLoaded: NotLoaded,
    identityContext: IdentityContext,
    relativeTo: URL | undefined,
  ): Promise<CardDef[]> {
    let refs = (notLoaded.reference as string[]).map(
      (ref) => new URL(ref, instance.id ?? relativeTo).href, // new instances may not yet have an ID, in that case fallback to the relativeTo
    );
    let loader = Loader.getLoaderFor(createFromSerialized);

    if (!loader) {
      throw new Error('Could not find a loader, this should not happen');
    }

    let errors = [];
    let fieldInstances: CardDef[] = [];

    for (let reference of refs) {
      let response = await loader.fetch(reference, {
        headers: { Accept: SupportedMimeType.CardJson },
      });
      if (!response.ok) {
        let cardError = await CardError.fromFetchResponse(reference, response);
        cardError.deps = [reference];
        cardError.additionalErrors = [
          new NotLoaded(instance, reference, this.name),
        ];
        errors.push(cardError);
      } else {
        let json = await response.json();
        if (!isSingleCardDocument(json)) {
          throw new Error(
            `instance ${reference} is not a card document. it is: ${JSON.stringify(
              json,
              null,
              2,
            )}`,
          );
        }
        let fieldInstance = (await createFromSerialized(
          json.data,
          json,
          new URL(json.data.id),
          loader,
          {
            identityContext,
          },
        )) as CardDef; // A linksTo field could only be a composite card
        fieldInstances.push(fieldInstance);
      }
    }
    if (errors.length) {
      throw errors;
    }
    return fieldInstances;
  }

  component(
    model: Box<CardDef>,
    format: Format,
    context?: CardContext,
  ): ComponentLike<{ Args: {}; Blocks: {} }> {
    let fieldName = this.name as keyof BaseDef;
    let arrayField = model.field(
      fieldName,
      useIndexBasedKey in this.card,
    ) as unknown as Box<CardDef[]>;
    return getLinksToManyComponent({
      model,
      arrayField,
      field: this,
      format,
      cardTypeFor,
      context,
    });
  }
}

function fieldComponent(
  field: Field<typeof BaseDef>,
  model: Box<BaseDef>,
  format: Format,
  context?: CardContext,
): ComponentLike<{ Args: {}; Blocks: {} }> {
  let fieldName = field.name as keyof BaseDef;
  let card: typeof BaseDef;
  if (primitive in field.card) {
    card = field.card;
  } else {
    card =
      (model.value[fieldName]?.constructor as typeof BaseDef) ?? field.card;
  }
  let innerModel = model.field(fieldName) as unknown as Box<BaseDef>;
  return getBoxComponent(card, format, innerModel, field, context);
}

// our decorators are implemented by Babel, not TypeScript, so they have a
// different signature than Typescript thinks they do.
export const field = function (
  _target: BaseDefConstructor,
  key: string | symbol,
  { initializer }: { initializer(): any },
) {
  return initializer().setupField(key);
} as unknown as PropertyDecorator;
(field as any)[fieldDecorator] = undefined;

export function containsMany<FieldT extends FieldDefConstructor>(
  field: FieldT,
  options?: Options,
): BaseInstanceType<FieldT>[] {
  return {
    setupField(fieldName: string) {
      return makeDescriptor(
        new ContainsMany(
          cardThunk(field),
          options?.computeVia,
          fieldName,
          options?.isUsed,
        ),
      );
    },
  } as any;
}
containsMany[fieldType] = 'contains-many' as FieldType;

export function contains<FieldT extends FieldDefConstructor>(
  field: FieldT,
  options?: Options,
): BaseInstanceType<FieldT> {
  return {
    setupField(fieldName: string) {
      return makeDescriptor(
        new Contains(
          cardThunk(field),
          options?.computeVia,
          fieldName,
          options?.isUsed,
        ),
      );
    },
  } as any;
}
contains[fieldType] = 'contains' as FieldType;

export function linksTo<CardT extends CardDefConstructor>(
  cardOrThunk: CardT | (() => CardT),
  options?: Options,
): BaseInstanceType<CardT> {
  return {
    setupField(fieldName: string) {
      return makeDescriptor(
        new LinksTo(
          cardThunk(cardOrThunk),
          options?.computeVia,
          fieldName,
          options?.isUsed,
        ),
      );
    },
  } as any;
}
linksTo[fieldType] = 'linksTo' as FieldType;

export function linksToMany<CardT extends CardDefConstructor>(
  cardOrThunk: CardT | (() => CardT),
  options?: Options,
): BaseInstanceType<CardT>[] {
  return {
    setupField(fieldName: string) {
      return makeDescriptor(
        new LinksToMany(
          cardThunk(cardOrThunk),
          options?.computeVia,
          fieldName,
          options?.isUsed,
        ),
      );
    },
  } as any;
}
linksToMany[fieldType] = 'linksToMany' as FieldType;

// TODO: consider making this abstract
export class BaseDef {
  // this is here because CardBase has no public instance methods, so without it
  // typescript considers everything a valid card.
  [isBaseInstance] = true;
  declare ['constructor']: BaseDefConstructor;
  static baseDef: undefined;
  static data?: Record<string, any>; // TODO probably refactor this away all together
  static displayName = 'Base';

  static getDisplayName(instance: BaseDef) {
    return instance.constructor.displayName;
  }

  static [serialize](
    value: any,
    doc: JSONAPISingleResourceDocument,
    visited?: Set<string>,
    opts?: SerializeOpts,
  ): any {
    // note that primitive can only exist in field definition
    if (primitive in this) {
      // primitive cards can override this as need be
      return value;
    } else {
      return serializeCardResource(value, doc, opts, visited);
    }
  }

  static [queryableValue](value: any, stack: BaseDef[] = []): any {
    if (primitive in this) {
      return value;
    } else {
      if (value == null) {
        return null;
      }
      if (stack.includes(value)) {
        return { id: value.id };
      }
      return Object.fromEntries(
        Object.entries(
          getFields(value, { includeComputeds: true, usedFieldsOnly: true }),
        ).map(([fieldName, field]) => {
          let rawValue = peekAtField(value, fieldName);
          if (field?.fieldType === 'linksToMany') {
            return [
              fieldName,
              field.queryableValue(rawValue, [value, ...stack]),
            ];
          }
          if (isNotLoadedValue(rawValue)) {
            return [fieldName, { id: rawValue.reference }];
          }
          return [
            fieldName,
            getQueryableValue(field!, value[fieldName], [value, ...stack]),
          ];
        }),
      );
    }
  }

  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    data: any,
    relativeTo: URL | undefined,
    doc?: CardDocument,
    identityContext?: IdentityContext,
  ): Promise<BaseInstanceType<T>> {
    if (primitive in this) {
      // primitive cards can override this as need be
      return data;
    }
    return _createFromSerialized(this, data, doc, relativeTo, identityContext);
  }

  static getComponent(
    card: BaseDef,
    format: Format,
    field?: Field,
    context?: CardContext,
  ) {
    return getComponent(card, format, field, context);
  }

  static assignInitialFieldValue(
    instance: BaseDef,
    fieldName: string,
    value: any,
  ) {
    (instance as any)[fieldName] = value;
  }

  constructor(data?: Record<string, any>) {
    if (data !== undefined) {
      for (let [fieldName, value] of Object.entries(data)) {
        this.constructor.assignInitialFieldValue(this, fieldName, value);
      }
    }
  }
}

export function isCard(card: any): card is CardDef {
  return card && typeof card === 'object' && isBaseInstance in card;
}

export class Component<
  CardT extends BaseDefConstructor,
> extends GlimmerComponent<SignatureFor<CardT>> {}

export class FieldDef extends BaseDef {
  static displayName = 'Field';
}

class IDField extends FieldDef {
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      {{! template-lint-disable require-input-label }}
      <input
        type='text'
        value={{@model}}
        {{on 'input' (pick 'target.value' @set)}}
      />
    </template>
  };
}

export class StringField extends FieldDef {
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput @value={{@model}} @onInput={{@set}} />
    </template>
  };
}

export class CardDef extends BaseDef {
  [isSavedInstance] = false;
  [relativeTo]: URL | undefined = undefined; // perhaps can be refactored away all together
  [realmInfo]: RealmInfo | undefined = undefined;
  [realmURL]: URL | undefined = undefined;
  @field id = contains(IDField);
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field thumbnailURL = contains(StringField); // TODO: this will probably be an image or image url field card when we have it
  static displayName = 'Card';

  static assignInitialFieldValue(
    instance: BaseDef,
    fieldName: string,
    value: any,
  ) {
    if (fieldName === 'id') {
      // we need to be careful that we don't trigger the ambient recompute() in our setters
      // when we are instantiating an instance that is placed in the identityMap that has
      // not had it's field values set yet, as computeds will be run that may assume dependent
      // fields are available when they are not (e.g. CatalogEntry.isPrimitive trying to load
      // it's 'ref' field). In this scenario, only the 'id' field is available. the rest of the fields
      // will be filled in later, so just set the 'id' directly in the deserialized cache to avoid
      // triggering the recompute.
      let deserialized = getDataBucket(instance);
      deserialized.set('id', value);
    } else {
      super.assignInitialFieldValue(instance, fieldName, value);
    }
  }
}

export type BaseDefConstructor = typeof BaseDef;
export type CardDefConstructor = typeof CardDef;
export type FieldDefConstructor = typeof FieldDef;

export function subscribeToChanges(
  card: CardDef,
  subscriber: CardChangeSubscriber,
) {
  let changeSubscribers = subscribers.get(card);
  if (!changeSubscribers) {
    changeSubscribers = new Set();
    subscribers.set(card, changeSubscribers);
  }
  changeSubscribers.add(subscriber);
}

export function unsubscribeFromChanges(
  card: CardDef,
  subscriber: CardChangeSubscriber,
) {
  let changeSubscribers = subscribers.get(card);
  if (!changeSubscribers) {
    return;
  }
  changeSubscribers.delete(subscriber);
}

function getDataBucket<T extends BaseDef>(instance: T): Map<string, any> {
  let deserialized = deserializedData.get(instance);
  if (!deserialized) {
    deserialized = new Map();
    deserializedData.set(instance, deserialized);
  }
  return deserialized;
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

export function isSaved(instance: CardDef): boolean {
  return instance[isSavedInstance] === true;
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

function peekAtField(instance: BaseDef, fieldName: string): any {
  let field = getField(
    Reflect.getPrototypeOf(instance)!.constructor as typeof BaseDef,
    fieldName,
  );
  if (!field) {
    throw new Error(
      `the card ${instance.constructor.name} does not have a field '${fieldName}'`,
    );
  }
  return getter(instance, field);
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
  let fieldResources = Object.keys(fields).map((fieldName) =>
    serializedGet(model, fieldName, doc, visited, opts),
  );
  return merge(
    {},
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
  if (instance instanceof CardDef) {
    if (!instance[relativeTo] && doc.data.id) {
      instance[relativeTo] = new URL(doc.data.id);
    }
    if (!instance[realmInfo] && doc.data.meta.realmInfo) {
      instance[realmInfo] = doc.data.meta.realmInfo;
    }
    if (!instance[realmURL] && doc.data.meta.realmURL) {
      instance[realmURL] = new URL(doc.data.meta.realmURL);
    }
  }
  return await _updateFromSerialized(instance, doc.data, doc, identityContext);
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
    if (instance instanceof CardDef) {
      instance[relativeTo] = _relativeTo;
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
        throw new Error(
          `could not find field '${fieldName}' in card '${card.name}'`,
        );
      }
      let relativeToVal: URL | undefined;
      if (instance instanceof CardDef) {
        relativeToVal = instance[relativeTo];
      }
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
    if (instance instanceof CardDef) {
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
      deserialized.set(fieldName as string, value);
      logger.log(recompute(instance));
    }
    if (instance instanceof CardDef && resource.id != null) {
      // importantly, we place this synchronously after the assignment of the model's
      // fields, such that subsequent assignment of the id field when the model is
      // saved will throw
      instance[isSavedInstance] = true;
    }
  }

  deferred.fulfill(instance);
  return instance;
}

export async function searchDoc<CardT extends BaseDefConstructor>(
  instance: InstanceType<CardT>,
): Promise<Record<string, any>> {
  return getQueryableValue(instance.constructor, instance) as Record<
    string,
    any
  >;
}

function makeMetaForField(
  meta: Partial<Meta> | undefined,
  fieldName: string,
  fallback: typeof BaseDef,
): Meta {
  let adoptsFrom = meta?.adoptsFrom ?? identifyCard(fallback);
  if (!adoptsFrom) {
    throw new Error(`bug: cannot determine identity for field '${fieldName}'`);
  }
  let fields: NonNullable<LooseCardResource['meta']['fields']> = {
    ...(meta?.fields ?? {}),
  };
  return {
    adoptsFrom,
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
}

async function cardClassFromResource<CardT extends BaseDefConstructor>(
  resource: LooseCardResource | undefined,
  fallback: CardT,
  relativeTo: URL | undefined,
): Promise<CardT> {
  let cardIdentity = identifyCard(fallback);
  if (!cardIdentity) {
    throw new Error(
      `bug: could not determine identity for card '${fallback.name}'`,
    );
  }
  if (resource && !isEqual(resource.meta.adoptsFrom, cardIdentity)) {
    let loader = Loader.getLoaderFor(fallback);

    if (!loader) {
      throw new Error('Could not find a loader, this should not happen');
    }

    let card: typeof BaseDef | undefined = await loadCard(
      resource.meta.adoptsFrom,
      { loader, relativeTo: resource.id ? new URL(resource.id) : relativeTo },
    );
    if (!card) {
      throw new Error(
        `could not find card: '${humanReadable(resource.meta.adoptsFrom)}'`,
      );
    }
    return card as CardT;
  }
  return fallback;
}

function makeDescriptor<
  CardT extends BaseDefConstructor,
  FieldT extends BaseDefConstructor,
>(field: Field<FieldT>) {
  let descriptor: any = {
    enumerable: true,
  };
  descriptor.get = function (this: BaseInstanceType<CardT>) {
    return field.getter(this);
  };
  if (field.computeVia) {
    descriptor.set = function () {
      // computeds should just no-op when an assignment occurs
    };
  } else {
    descriptor.set = function (this: BaseInstanceType<CardT>, value: any) {
      if (
        (field.card as typeof BaseDef) === IDField &&
        this instanceof CardDef &&
        this[isSavedInstance]
      ) {
        throw new Error(
          `cannot assign a value to the field '${
            field.name
          }' on the saved card '${
            (this as any)[field.name]
          }' because it is the card's identifier`,
        );
      }
      value = field.validate(this, value);
      let deserialized = getDataBucket(this);
      deserialized.set(field.name, value);
      // invalidate all computed fields because we don't know which ones depend on this one
      for (let computedFieldName of Object.keys(getComputedFields(this))) {
        if (deserialized.has(computedFieldName)) {
          let currentValue = deserialized.get(computedFieldName);
          if (!isStaleValue(currentValue)) {
            deserialized.set(computedFieldName, {
              type: 'stale',
              staleValue: currentValue,
            } as StaleValue);
          }
        }
      }
      notifySubscribers(this, field.name, value);
      logger.log(recompute(this));
    };
  }
  (descriptor.get as any)[isField] = field;
  return descriptor;
}

function notifySubscribers(card: BaseDef, fieldName: string, value: any) {
  let changeSubscribers = subscribers.get(card);
  if (changeSubscribers) {
    for (let subscriber of changeSubscribers) {
      subscriber(fieldName, value);
    }
  }
}

function cardThunk<CardT extends BaseDefConstructor>(
  cardOrThunk: CardT | (() => CardT),
): () => CardT {
  if (!cardOrThunk) {
    throw new Error(
      `cardOrThunk was ${cardOrThunk}. There might be a cyclic dependency in one of your fields.
      Use '() => CardName' format for the fields with the cycle in all related cards.
      e.g.: '@field friend = linksTo(() => Person)'`,
    );
  }
  return (
    'baseDef' in cardOrThunk ? () => cardOrThunk : cardOrThunk
  ) as () => CardT;
}

export type SignatureFor<CardT extends BaseDefConstructor> = {
  Args: {
    model: PartialBaseInstanceType<CardT>;
    fields: FieldsTypeFor<InstanceType<CardT>>;
    set: Setter;
    fieldName: string | undefined;
    context?: CardContext;
  };
};

export function getComponent(
  model: BaseDef,
  format: Format,
  field?: Field,
  context?: CardContext,
): ComponentLike<{ Args: {}; Blocks: {} }> {
  let box = Box.create(model);
  let component = getBoxComponent(
    model.constructor as BaseDefConstructor,
    format,
    box,
    field,
    context,
  );
  return component;
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
              if (item && isCard(item) && !stack.includes(item)) {
                await _loadModel(item, [item, ...stack]);
              }
            }
          } else if (isCard(value) && !stack.includes(value)) {
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

export function getFields(
  card: typeof BaseDef,
  opts?: { usedFieldsOnly?: boolean; includeComputeds?: boolean },
): { [fieldName: string]: Field<BaseDefConstructor> };
export function getFields<T extends BaseDef>(
  card: T,
  opts?: { usedFieldsOnly?: boolean; includeComputeds?: boolean },
): { [P in keyof T]?: Field<BaseDefConstructor> };
export function getFields(
  cardInstanceOrClass: BaseDef | typeof BaseDef,
  opts?: { usedFieldsOnly?: boolean; includeComputeds?: boolean },
): { [fieldName: string]: Field<BaseDefConstructor> } {
  let obj: object | null;
  let usedFields: string[] = [];
  if (isCard(cardInstanceOrClass)) {
    // this is a card instance
    obj = Reflect.getPrototypeOf(cardInstanceOrClass);
    usedFields = getUsedFields(cardInstanceOrClass);
  } else {
    // this is a card class
    obj = (cardInstanceOrClass as typeof BaseDef).prototype;
  }
  let fields: { [fieldName: string]: Field<BaseDefConstructor> } = {};
  while (obj?.constructor.name && obj.constructor.name !== 'Object') {
    let descs = Object.getOwnPropertyDescriptors(obj);
    let currentFields = flatMap(Object.keys(descs), (maybeFieldName) => {
      if (maybeFieldName !== 'constructor') {
        let maybeField = getField(
          (isCard(cardInstanceOrClass)
            ? cardInstanceOrClass.constructor
            : cardInstanceOrClass) as typeof BaseDef,
          maybeFieldName,
        );
        if (
          opts?.usedFieldsOnly &&
          !usedFields.includes(maybeFieldName) &&
          !maybeField?.isUsed
        ) {
          return [];
        }
        if (maybeField?.computeVia && !opts?.includeComputeds) {
          return [];
        }
        if (maybeField) {
          return [[maybeFieldName, maybeField]];
        }
      }
      return [];
    });
    fields = { ...fields, ...Object.fromEntries(currentFields) };
    obj = Reflect.getPrototypeOf(obj);
  }
  return fields;
}

function getComputedFields<T extends BaseDef>(
  card: T,
): { [P in keyof T]?: Field<BaseDefConstructor> } {
  let fields = Object.entries(getFields(card, { includeComputeds: true })) as [
    string,
    Field<BaseDefConstructor>,
  ][];
  let computedFields = fields.filter(([_, field]) => field.computeVia);
  return Object.fromEntries(computedFields) as {
    [P in keyof T]?: Field<BaseDefConstructor>;
  };
}

export class Box<T> {
  static create<T>(model: T): Box<T> {
    return new Box({ type: 'root', model });
  }

  private state:
    | {
        type: 'root';
        model: any;
      }
    | {
        type: 'derived';
        containingBox: Box<any>;
        fieldName: string | number | symbol;
        useIndexBasedKeys: boolean;
      };

  private constructor(state: Box<T>['state']) {
    this.state = state;
  }

  get value(): T {
    if (this.state.type === 'root') {
      return this.state.model;
    } else {
      return this.state.containingBox.value[this.state.fieldName];
    }
  }

  get name() {
    return this.state.type === 'derived' ? this.state.fieldName : undefined;
  }

  set value(v: T) {
    if (this.state.type === 'root') {
      throw new Error(`can't set topmost model`);
    } else {
      let value = this.state.containingBox.value;
      if (Array.isArray(value) && typeof this.state.fieldName !== 'number') {
        throw new Error(
          `Cannot set a value on an array item with non-numeric index '${String(
            this.state.fieldName,
          )}'`,
        );
      }
      this.state.containingBox.value[this.state.fieldName] = v;
    }
  }

  set = <V extends T>(value: V): void => {
    this.value = value;
  };

  private fieldBoxes = new Map<string, Box<unknown>>();

  field<K extends keyof T>(fieldName: K, useIndexBasedKeys = false): Box<T[K]> {
    let box = this.fieldBoxes.get(fieldName as string);
    if (!box) {
      box = new Box({
        type: 'derived',
        containingBox: this,
        fieldName,
        useIndexBasedKeys,
      });
      this.fieldBoxes.set(fieldName as string, box);
    }
    return box as Box<T[K]>;
  }

  private prevChildren: Box<ElementType<T>>[] = [];

  get children(): Box<ElementType<T>>[] {
    if (this.state.type === 'root') {
      throw new Error('tried to call children() on root box');
    }
    let value = this.value;
    if (!Array.isArray(value)) {
      throw new Error(
        `tried to call children() on Boxed non-array value ${value} for ${String(
          this.state.fieldName,
        )}`,
      );
    }

    let { prevChildren, state } = this;
    let newChildren: Box<ElementType<T>>[] = value.map((element, index) => {
      let found = prevChildren.find((oldBox, i) =>
        state.useIndexBasedKeys ? index === i : oldBox.value === element,
      );
      if (found) {
        if (state.useIndexBasedKeys) {
          // note that the underlying box already has the correct value so there
          // is nothing to do in this case. also, we are currently inside a rerender.
          // mutating a watched array in a rerender will spawn another rerender which
          // infinitely recurses.
        } else {
          prevChildren.splice(prevChildren.indexOf(found), 1);
          if (found.state.type === 'root') {
            throw new Error('bug');
          }
          found.state.fieldName = index;
        }
        return found;
      } else {
        return new Box({
          type: 'derived',
          containingBox: this,
          fieldName: index,
          useIndexBasedKeys: false,
        });
      }
    });
    this.prevChildren = newChildren;
    return newChildren;
  }
}

type ElementType<T> = T extends (infer V)[] ? V : never;

function makeRelativeURL(maybeURL: string, opts?: SerializeOpts): string {
  return opts?.maybeRelativeURL ? opts.maybeRelativeURL(maybeURL) : maybeURL;
}
