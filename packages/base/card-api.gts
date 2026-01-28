import Modifier from 'ember-modifier';
import GlimmerComponent from '@glimmer/component';
import { isEqual } from 'lodash';
import { WatchedArray } from './watched-array';
import { BoxelInput, CopyButton } from '@cardstack/boxel-ui/components';
import { type MenuItemOptions, not } from '@cardstack/boxel-ui/helpers';
import {
  getBoxComponent,
  type BoxComponent,
  CardCrudFunctionsConsumer,
  DefaultFormatsConsumer,
} from './field-component';
import { getContainsManyComponent } from './contains-many-component';
import { LinksToEditor } from './links-to-editor';
import { getLinksToManyComponent } from './links-to-many-component';
import {
  assertIsSerializerName,
  baseRef,
  CardContextName,
  CardError,
  CodeRef,
  CommandContext,
  Deferred,
  fields,
  fieldSerializer,
  fieldsUntracked,
  formats,
  getAncestor,
  getMenuItems,
  getField,
  getSerializer,
  humanReadable,
  identifyCard,
  isBaseInstance,
  isCardError,
  isCardInstance as _isCardInstance,
  isCardResource,
  isFileMetaResource,
  isFileDef,
  isField,
  isFieldInstance,
  isRelationship,
  loadCardDef,
  loadCardDocument,
  Loader,
  localId,
  LocalPath,
  meta,
  primitive,
  realmURL,
  relativeTo,
  SingleCardDocument,
  uuidv4,
  type Format,
  type Meta,
  type CardFields,
  type Relationship,
  type ResourceID,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type CardDocument,
  type CardResourceMeta,
  type ResolvedCodeRef,
  type getCard,
  type getCards,
  type getCardCollection,
  type Store,
  type PrerenderedCardComponentSignature,
  type ErrorEntry,
  type Query,
  type QueryWithInterpolations,
  type QueryResultsMeta,
  FileMetaResourceType,
  CardResourceType,
  loadFileMetaDocument,
  CardResource,
  LooseLinkableResource,
  LooseSingleResourceDocument,
} from '@cardstack/runtime-common';
import {
  captureQueryFieldSeedData,
  ensureQueryFieldSearchResource,
  validateRelationshipQuery,
} from './query-field-support';
import type { ComponentLike } from '@glint/template';
import { initSharedState } from './shared-state';
import DefaultFittedTemplate from './default-templates/fitted';
import DefaultEmbeddedTemplate from './default-templates/embedded';
import DefaultCardDefTemplate from './default-templates/isolated-and-edit';
import DefaultAtomViewTemplate from './default-templates/atom';
import DefaultHeadTemplate from './default-templates/head';
import MissingTemplate from './default-templates/missing-template';
import FieldDefEditTemplate from './default-templates/field-edit';
import MarkdownTemplate from './default-templates/markdown';
import CaptionsIcon from '@cardstack/boxel-icons/captions';
import LetterCaseIcon from '@cardstack/boxel-icons/letter-case';
import MarkdownIcon from '@cardstack/boxel-icons/align-box-left-middle';
import RectangleEllipsisIcon from '@cardstack/boxel-icons/rectangle-ellipsis';
import TextAreaIcon from '@cardstack/boxel-icons/align-left';
import ThemeIcon from '@cardstack/boxel-icons/palette';
import ImportIcon from '@cardstack/boxel-icons/import';
import FilePencilIcon from '@cardstack/boxel-icons/file-pencil';
import WandIcon from '@cardstack/boxel-icons/wand';
// normalizeEnumOptions used by enum moved to packages/base/enum.gts
import PatchThemeCommand from '@cardstack/boxel-host/commands/patch-theme';
import CopyAndEditCommand from '@cardstack/boxel-host/commands/copy-and-edit';

import {
  callSerializeHook,
  cardClassFromResource,
  deserialize,
  makeMetaForField,
  makeRelativeURL,
  serialize,
  serializeCard,
  serializeCardResource,
  resourceFrom,
  type DeserializeOpts,
  type JSONAPIResource,
  type JSONAPISingleResourceDocument,
  type SerializeOpts,
  getCardMeta,
} from './card-serialization';
import {
  assertScalar,
  entangleWithCardTracking,
  getDataBucket,
  getFieldDescription,
  getFieldOverrides,
  getFields,
  getter,
  isArrayOfCardOrField,
  isCard,
  isCardOrField,
  isNotLoadedValue,
  notifyCardTracking,
  peekAtField,
  propagateRealmContext,
  realmContext,
  relationshipMeta,
  setFieldDescription,
  setRealmContextOnField,
  type NotLoadedValue,
} from './field-support';
import { type GetMenuItemParams, getDefaultCardMenuItems } from './menu-items';
import {
  LinkableDocument,
  SingleFileMetaDocument,
} from '@cardstack/runtime-common/document-types';
import type { FileMetaResource } from '@cardstack/runtime-common';
import type { FileDef } from './file-api';

export const BULK_GENERATED_ITEM_COUNT = 3;

interface CardOrFieldTypeIconSignature {
  Element: SVGElement;
}

export type CardOrFieldTypeIcon = ComponentLike<CardOrFieldTypeIconSignature>;

export {
  deserialize,
  getCardMeta,
  getDataBucket,
  getFieldDescription,
  getFields,
  isCard,
  isField,
  isFileDef,
  localId,
  meta,
  primitive,
  realmURL,
  relativeTo,
  relationshipMeta,
  serialize,
  serializeCard,
  ensureQueryFieldSearchResource,
  getStore,
  type BoxComponent,
  type DeserializeOpts,
  type GetMenuItemParams,
  type JSONAPISingleResourceDocument,
  type ResourceID,
  type SerializeOpts,
};

export const useIndexBasedKey = Symbol.for('cardstack-use-index-based-key');
export const fieldDecorator = Symbol.for('cardstack-field-decorator');
export const queryableValue = Symbol.for('cardstack-queryable-value');
export const formatQuery = Symbol.for('cardstack-format-query');
export const realmInfo = Symbol.for('cardstack-realm-info');
export const emptyValue = Symbol.for('cardstack-empty-value');
// intentionally not exporting this so that the outside world
// cannot mark a card as being saved
const isSavedInstance = Symbol.for('cardstack-is-saved-instance');

export type BaseInstanceType<T extends BaseDefConstructor> = T extends {
  [primitive]: infer P;
}
  ? P
  : InstanceType<T>;

// this is expressing the idea that the fields of a
// card may contain undefined, but even when that's
// true all the symbols and the `constructor` property
// can still be relied on.
type PartialFields<T> = {
  [Property in keyof T]: Property extends symbol
    ? T[Property]
    : Property extends 'constructor'
    ? T[Property]
    : T[Property] | undefined;
};

export type PartialBaseInstanceType<T extends BaseDefConstructor> = T extends {
  [primitive]: infer P;
}
  ? P | null
  : PartialFields<InstanceType<T>> & {
      [fields]: Record<string, BaseDefConstructor>;
      [fieldsUntracked]: Record<string, BaseDefConstructor>;
    };
export type FieldsTypeFor<T extends BaseDef> = {
  [Field in keyof T]: BoxComponent &
    (T[Field] extends ArrayLike<unknown>
      ? BoxComponent[]
      : T[Field] extends BaseDef
      ? FieldsTypeFor<T[Field]>
      : unknown);
};
export { formats, type Format };
export type FieldType = 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
// Opaque configuration passed to field format components and validators
export type FieldConfiguration = Record<string, any>;
// Configuration may be provided as a static object or a function of the parent instance
export type ConfigurationInput<T> =
  | FieldConfiguration
  | ((this: Readonly<T>) => FieldConfiguration | undefined);
export type FieldFormats = {
  ['fieldDef']: Format;
  ['cardDef']: Format;
};
type Setter = (value: any) => void;

interface Options {
  computeVia?: () => unknown;
  description?: string;
  // there exists cards that we only ever run in the host without
  // the isolated renderer (RoomField), which means that we cannot
  // use the rendering mechanism to tell if a card is used or not,
  // in which case we need to tell the runtime that a card is
  // explicitly being used.
  isUsed?: true;
  // Optional: per-usage configuration provider merged with FieldDef-level configuration
  configuration?: ConfigurationInput<any>;
}

interface RelationshipOptions extends Options {
  query?: QueryWithInterpolations;
}

export interface CardContext<T extends CardDef = CardDef> {
  commandContext?: CommandContext;
  cardComponentModifier?: typeof Modifier<{
    Args: {
      Named: {
        card?: CardDef;
        cardId?: string;
        format: Format | 'data';
        fieldType: FieldType | undefined;
        fieldName: string | undefined;
      };
    };
  }>;
  prerenderedCardSearchComponent: typeof GlimmerComponent<PrerenderedCardComponentSignature>;
  getCard: getCard<T>;
  getCards: getCards;
  getCardCollection: getCardCollection;
  store: Store;
  // Optional runtime mode/submode hints used by cards that render differently per context.
  mode?: 'host' | 'operator';
  submode?: 'interact' | 'code' | 'host';
}

export interface FieldConstructor<T> {
  cardThunk: () => T;
  computeVia: undefined | (() => unknown);
  declaredCardThunk?: () => T;
  isUsed?: true;
  isPolymorphic?: true;
  name: string;
  queryDefinition?: QueryWithInterpolations;
}

type CardChangeSubscriber = (
  instance: BaseDef,
  fieldName: string,
  fieldValue: any,
) => void;

const stores = initSharedState(
  'stores',
  () => new WeakMap<BaseDef, CardStore>(),
);
const subscribers = initSharedState(
  'subscribers',
  () => new WeakMap<BaseDef, Set<CardChangeSubscriber>>(),
);
const subscriberConsumer = initSharedState(
  'subscriberConsumer',
  () => new WeakMap<BaseDef, { fieldOrCard: BaseDef; fieldName: string }>(),
);
const inflightLinkLoads = initSharedState(
  'inflightLinkLoads',
  () => new WeakMap<CardDef, Map<string, Promise<unknown>>>(),
);

export function instanceOf(instance: BaseDef, clazz: typeof BaseDef): boolean {
  let instanceClazz: typeof BaseDef | null = instance.constructor;
  let codeRefInstance: CodeRef | undefined;
  let codeRefClazz = identifyCard(clazz);
  if (!codeRefClazz) {
    return instance instanceof (clazz as any);
  }
  do {
    codeRefInstance = instanceClazz ? identifyCard(instanceClazz) : undefined;
    if (isEqual(codeRefInstance, codeRefClazz)) {
      return true;
    }
    instanceClazz = instanceClazz ? getAncestor(instanceClazz) ?? null : null;
  } while (codeRefInstance && !isEqual(codeRefInstance, baseRef));
  return false;
}

class Logger {
  private promises: Promise<any>[] = [];

  // TODO this doesn't look like it's used anymore. in the past this was used to
  // keep track of async when eagerly running computes after a property had been set.
  // consider removing this.
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

export interface StoreSearchResource<T extends CardDef = CardDef> {
  readonly instances: T[];
  readonly instancesByRealm: { realm: string; cards: T[] }[];
  readonly isLoading: boolean;
  readonly meta: QueryResultsMeta;
  readonly errors?: ErrorEntry[];
}

export type GetSearchResourceFuncOpts = {
  isLive?: boolean;
  doWhileRefreshing?: (() => void) | undefined;
  seed?: {
    cards: CardDef[];
    searchURL?: string;
    realms?: string[];
  };
};
export type GetSearchResourceFunc<T extends CardDef = CardDef> = (
  parent: object,
  getQuery: () => Query | undefined,
  getRealms?: () => string[] | undefined,
  opts?: GetSearchResourceFuncOpts,
) => StoreSearchResource<T>;

export interface CardStore {
  get(url: string): CardDef | undefined;
  set(url: string, instance: CardDef): void;
  setNonTracked(id: string, instance: CardDef): void;
  makeTracked(id: string): void;
  loadCardDocument(url: string): Promise<SingleCardDocument | CardError>;
  loadFileMetaDocument(
    url: string,
  ): Promise<SingleFileMetaDocument | CardError>;
  trackLoad(load: Promise<unknown>): void;
  loaded(): Promise<void>;
  getSearchResource: GetSearchResourceFunc;
}

export interface Field<
  CardT extends BaseDefConstructor = BaseDefConstructor,
  SearchT = any,
> {
  card: CardT;
  name: string;
  fieldType: FieldType;
  computeVia: undefined | (() => unknown);
  // Optional per-usage configuration stored on the field descriptor
  configuration?: ConfigurationInput<any>;
  // Declarative relationship query definition, if provided
  queryDefinition?: QueryWithInterpolations;
  captureQueryFieldSeedData?(
    instance: BaseDef,
    value: any,
    resource: LooseCardResource,
  ): void;
  // there exists cards that we only ever run in the host without
  // the isolated renderer (RoomField), which means that we cannot
  // use the rendering mechanism to tell if a card is used or not,
  // in which case we need to tell the runtime that a card is
  // explicitly being used.
  isUsed?: true;
  isPolymorphic?: true;
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
    store: CardStore | undefined,
    instancePromise: Promise<BaseDef>,
    loadedValue: any,
    relativeTo: URL | undefined,
    opts?: DeserializeOpts,
  ): Promise<any>;
  emptyValue(instance: BaseDef): any;
  validate(instance: BaseDef, value: any): void;
  component(model: Box<BaseDef>): BoxComponent;
  getter(instance: BaseDef): BaseInstanceType<CardT> | undefined;
  queryableValue(value: any, stack: BaseDef[]): SearchT;
}

function cardTypeFor(
  field: Field<typeof BaseDef>,
  boxedElement?: Box<BaseDef>,
  overrides?: () => Map<string, typeof BaseDef> | undefined,
): typeof BaseDef {
  let override: typeof BaseDef | undefined;
  if (overrides) {
    let valueKey = `${field.name}${
      boxedElement ? '.' + boxedElement.name : ''
    }`;
    override = boxedElement?.value ? overrides()?.get(valueKey) : undefined;
  } else {
    override =
      boxedElement?.value && typeof boxedElement.value === 'object'
        ? getFieldOverrides(boxedElement.value)?.get(field.name)
        : undefined;
  }
  if (primitive in field.card) {
    return override ?? field.card;
  }
  if (boxedElement === undefined || boxedElement.value == null) {
    return field.card;
  }
  return Reflect.getPrototypeOf(boxedElement.value)!
    .constructor as typeof BaseDef;
}

class ContainsMany<FieldT extends FieldDefConstructor>
  implements Field<FieldT, any[] | null>
{
  readonly fieldType = 'containsMany';
  private cardThunk: () => FieldT;
  readonly computeVia: undefined | (() => unknown);
  readonly name: string;
  readonly description: string | undefined;
  readonly isUsed: undefined | true;
  readonly isPolymorphic: undefined | true;
  configuration: ConfigurationInput<any> | undefined;
  constructor({
    cardThunk,
    computeVia,
    name,
    isUsed,
    isPolymorphic,
  }: FieldConstructor<FieldT>) {
    this.cardThunk = cardThunk;
    this.computeVia = computeVia;
    this.name = name;
    this.isUsed = isUsed;
    this.isPolymorphic = isPolymorphic;
  }

  get card(): FieldT {
    return this.cardThunk();
  }

  getter(instance: BaseDef): BaseInstanceType<FieldT> | undefined {
    let deserialized = getDataBucket(instance);
    entangleWithCardTracking(instance);
    let maybeNotLoaded = deserialized.get(this.name);
    // a not loaded error can blow up thru a computed containsMany field that consumes a link
    if (isNotLoadedValue(maybeNotLoaded)) {
      lazilyLoadLink(instance as CardDef, this, maybeNotLoaded.reference);
      return this.emptyValue(instance) as BaseInstanceType<FieldT>;
    }
    let results = getter(instance, this);
    propagateRealmContext(results, instance);
    return results;
  }

  queryableValue(instances: any[] | null, stack: BaseDef[]): any[] | null {
    if (instances === null || instances.length === 0) {
      // we intentionally use a "null" to represent an empty plural field as
      // this is a limitation to SQLite's json_tree() function when trying to match
      // plural fields that are empty
      return null;
    }

    // Need to replace the WatchedArray proxy with an actual array because the
    // WatchedArray proxy is not structuredClone-able, and hence cannot be
    // communicated over the postMessage boundary between worker and DOM.
    // TODO: can this be simplified since we don't have the worker anymore?
    let results = [...instances]
      .map((instance) => {
        return this.card[queryableValue](instance, stack);
      })
      .filter((i) => i != null);
    return results.length === 0 ? null : results;
  }

  serialize(
    values: BaseInstanceType<FieldT>[] | NotLoadedValue,
    doc: JSONAPISingleResourceDocument,
    _visited: Set<string>,
    opts?: SerializeOpts,
  ): JSONAPIResource {
    // this can be a not loaded value happen when the containsMany is a
    // computed that consumes a linkTo field that is not loaded
    if (isNotLoadedValue(values)) {
      return { attributes: {} };
    }
    let serialized =
      values === null
        ? null
        : values.map((value) =>
            callSerializeHook(this.card, value, doc, undefined, opts),
          );
    if (primitive in this.card) {
      if (opts?.overrides) {
        let meta: Partial<Meta> = {};
        if (Array.isArray(serialized)) {
          for (let [index] of serialized.entries()) {
            let fieldName = `${this.name}.${index}`;
            let override = opts.overrides.get(fieldName);
            if (!override) {
              continue;
            }
            meta.fields = meta.fields ?? {};
            meta.fields[fieldName] = {
              adoptsFrom: identifyCard(
                override,
                opts?.useAbsoluteURL ? undefined : opts?.maybeRelativeURL,
              ),
            };
          }
        }
        return {
          attributes: {
            [this.name]: serialized,
          },
          meta,
        };
      } else {
        return {
          attributes: {
            [this.name]: serialized,
          },
        };
      }
    } else {
      let relationships: Record<string, Relationship> = {};
      let serialized =
        values === null
          ? null
          : values.map((value, index) => {
              let resource: JSONAPISingleResourceDocument['data'] =
                callSerializeHook(this.card, value, doc, undefined, opts);
              if (resource.relationships) {
                for (let [fieldName, relationship] of Object.entries(
                  resource.relationships as Record<string, Relationship>,
                )) {
                  relationships[`${this.name}.${index}.${fieldName}`] =
                    relationship; // warning side-effect
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
          [this.name]:
            serialized === null
              ? null
              : serialized.map((resource) => resource.attributes),
        },
      };
      if (Object.keys(relationships).length > 0) {
        result.relationships = relationships;
      }

      if (serialized && serialized.some((resource) => resource.meta)) {
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
    store: CardStore,
    instancePromise: Promise<BaseDef>,
    _loadedValue: any,
    relativeTo: URL | undefined,
    opts: DeserializeOpts,
  ): Promise<BaseInstanceType<FieldT>[] | null> {
    if (value == null) {
      return null;
    }
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
      (prevArrayValue, arrayValue) =>
        instancePromise.then((instance) => {
          applySubscribersToInstanceValue(
            instance,
            this,
            prevArrayValue,
            arrayValue,
          );
          notifySubscribers(instance, field.name, arrayValue);
          notifyCardTracking(instance);
        }),
      await Promise.all(
        value.map(async (entry, index) => {
          if (primitive in this.card) {
            if (fieldSerializer in this.card) {
              assertIsSerializerName(this.card[fieldSerializer]);
              let serializer = getSerializer(this.card[fieldSerializer]);
              return serializer.deserialize<FieldT>(
                entry,
                relativeTo,
                doc,
                store,
                opts,
              );
            }
            return entry;
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
            )[deserialize](resource, relativeTo, doc, store, opts);
          }
        }),
      ),
    );
  }

  emptyValue(instance: BaseDef) {
    return new WatchedArray((oldValue, value) => {
      applySubscribersToInstanceValue(
        instance,
        this,
        oldValue as BaseDef[],
        value as BaseDef[],
      );
      notifySubscribers(instance, this.name, value);
      notifyCardTracking(instance);
    });
  }

  validate(instance: BaseDef, values: any[] | null) {
    if (values && !Array.isArray(values)) {
      throw new Error(
        `field validation error: Expected array for field value of field '${this.name}'`,
      );
    }
    if (values == null) {
      return values;
    }

    if (!(primitive in this.card)) {
      for (let [index, item] of values.entries()) {
        if (item != null && !instanceOf(item, this.card)) {
          throw new Error(
            `field validation error: tried set instance of ${values.constructor.name} at index ${index} of field '${this.name}' but it is not an instance of ${this.card.name}`,
          );
        }
      }
    }

    return new WatchedArray((oldValue, value) => {
      applySubscribersToInstanceValue(
        instance,
        this,
        oldValue as BaseDef[],
        value as BaseDef[],
      );
      notifySubscribers(instance, this.name, value);
      notifyCardTracking(instance);
    }, values);
  }

  component(model: Box<BaseDef>): BoxComponent {
    let fieldName = this.name as keyof BaseDef;
    let arrayField = model.field(
      fieldName,
      useIndexBasedKey in this.card,
    ) as unknown as Box<BaseDef[]>;

    return getContainsManyComponent({
      model,
      arrayField,
      field: this,
      cardTypeFor,
    });
  }
}

class Contains<CardT extends FieldDefConstructor> implements Field<CardT, any> {
  readonly fieldType = 'contains';
  private cardThunk: () => CardT;
  readonly computeVia: undefined | (() => unknown);
  readonly name: string;
  readonly description: string | undefined;
  readonly isUsed: undefined | true;
  readonly isPolymorphic: undefined | true;
  configuration: ConfigurationInput<any> | undefined;
  constructor({
    cardThunk,
    computeVia,
    name,
    isUsed,
    isPolymorphic,
  }: FieldConstructor<CardT>) {
    this.cardThunk = cardThunk;
    this.computeVia = computeVia;
    this.name = name;
    this.isUsed = isUsed;
    this.isPolymorphic = isPolymorphic;
  }

  get card(): CardT {
    return this.cardThunk();
  }

  getter(instance: BaseDef): BaseInstanceType<CardT> | undefined {
    let deserialized = getDataBucket(instance);
    entangleWithCardTracking(instance);
    let maybeNotLoaded = deserialized.get(this.name);
    // a not loaded error can blow up thru a computed contains field that consumes a link
    if (isNotLoadedValue(maybeNotLoaded)) {
      lazilyLoadLink(instance as CardDef, this, maybeNotLoaded.reference);
      return undefined;
    }
    let value = getter(instance, this);
    propagateRealmContext(value, instance);
    return value;
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

  serialize(
    value: InstanceType<CardT> | NotLoadedValue,
    doc: JSONAPISingleResourceDocument,
    _visited: Set<string>,
    opts?: SerializeOpts,
  ): JSONAPIResource {
    // this can be a not loaded value happen when the contains is a
    // computed that consumes a linkTo field that is not loaded
    if (isNotLoadedValue(value)) {
      return { attributes: {} };
    }

    if (primitive in this.card) {
      let serialized: JSONAPISingleResourceDocument['data'] & {
        meta: Record<string, any>;
      } = callSerializeHook(this.card, value, doc, undefined, opts);
      if (this.isPolymorphic) {
        return {
          attributes: { [this.name]: serialized },
          meta: {
            fields: {
              [this.name]: {
                adoptsFrom: identifyCard(
                  this.card,
                  opts?.useAbsoluteURL ? undefined : opts?.maybeRelativeURL,
                ),
              },
            },
          },
        };
      } else {
        return { attributes: { [this.name]: serialized } };
      }
    } else {
      let serialized: JSONAPISingleResourceDocument['data'] & {
        meta: Record<string, any>;
      } = callSerializeHook(this.card, value, doc);
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

      if (
        this.card === Reflect.getPrototypeOf(value)!.constructor &&
        !this.isPolymorphic
      ) {
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
    store: CardStore,
    _instancePromise: Promise<BaseDef>,
    _loadedValue: any,
    relativeTo: URL | undefined,
    opts: DeserializeOpts,
  ): Promise<BaseInstanceType<CardT>> {
    if (primitive in this.card) {
      if (fieldSerializer in this.card) {
        assertIsSerializerName(this.card[fieldSerializer]);
        let serializer = getSerializer(this.card[fieldSerializer]);
        return serializer.deserialize(value, relativeTo, doc, store, opts);
      }
      return value;
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
    ](resource, relativeTo, doc, store, opts);
  }

  emptyValue(_instance: BaseDef) {
    if (primitive in this.card) {
      return this.card[emptyValue];
    } else {
      return new this.card();
    }
  }

  validate(_instance: BaseDef, value: any) {
    if (!(primitive in this.card)) {
      let expectedCard = this.card;
      if (value != null && !instanceOf(value, expectedCard)) {
        throw new Error(
          `field validation error: tried set instance of ${value.constructor.name} as field '${this.name}' but it is not an instance of ${expectedCard.name}`,
        );
      }
    }
    return value;
  }

  component(model: Box<BaseDef>): BoxComponent {
    return fieldComponent(this, model);
  }
}

class LinksTo<CardT extends LinkableDefConstructor> implements Field<CardT> {
  readonly fieldType = 'linksTo';
  private cardThunk: () => CardT;
  private declaredCardThunk: () => CardT;
  readonly computeVia: undefined | (() => unknown);
  readonly name: string;
  readonly description: string | undefined;
  readonly isUsed: undefined | true;
  readonly isPolymorphic: undefined | true;
  readonly configuration?: ConfigurationInput<any>;
  readonly queryDefinition?: QueryWithInterpolations;
  constructor({
    cardThunk,
    declaredCardThunk,
    computeVia,
    name,
    isUsed,
    isPolymorphic,
    queryDefinition,
  }: FieldConstructor<CardT>) {
    this.cardThunk = cardThunk;
    this.declaredCardThunk = declaredCardThunk ?? cardThunk;
    this.computeVia = computeVia;
    this.name = name;
    this.isUsed = isUsed;
    this.isPolymorphic = isPolymorphic;
    this.queryDefinition = queryDefinition;
  }

  get card(): CardT {
    return this.cardThunk();
  }

  get declaredCardResolver(): () => CardT {
    return this.declaredCardThunk;
  }

  getter(instance: CardDef): BaseInstanceType<CardT> | undefined {
    let deserialized = getDataBucket(instance);
    entangleWithCardTracking(instance);

    if (this.queryDefinition) {
      let searchResource = ensureQueryFieldSearchResource(
        getStore(instance),
        instance,
        this,
      );
      let records = (searchResource as any)?.instances ?? ([] as any[]);
      return (records as any[])[0] as BaseInstanceType<CardT> | undefined;
    }

    let maybeNotLoaded = deserialized.get(this.name);
    if (isNotLoadedValue(maybeNotLoaded)) {
      lazilyLoadLink(instance, this, maybeNotLoaded.reference);
      return undefined;
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

  serialize(
    value: InstanceType<CardT> | NotLoadedValue,
    doc: JSONAPISingleResourceDocument,
    visited: Set<string>,
    opts?: SerializeOpts,
  ) {
    let relationshipType = isFileDef(this.card)
      ? FileMetaResourceType
      : CardResourceType;
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
    if (isFileDef(this.card) && !value.id) {
      throw new Error(
        `linksTo field '${this.name}' cannot serialize a FileDef without an id`,
      );
    }
    if (visited.has(value.id)) {
      return {
        relationships: {
          [this.name]: {
            links: {
              self: makeRelativeURL(value.id, opts),
            },
            data: { type: relationshipType, id: value.id },
          },
        },
      };
    }
    if (visited.has((value as CardDef)[localId])) {
      return {
        relationships: {
          [this.name]: {
            data: { type: relationshipType, lid: (value as CardDef)[localId] },
          },
        },
      };
    }

    visited.add(value.id ?? (value as CardDef)[localId]);

    let serialized = callSerializeHook(this.card, value, doc, visited, opts) as
      | (JSONAPIResource & { id: string; type: string })
      | null;
    if (serialized) {
      let resource: JSONAPIResource = {
        relationships: {
          [this.name]: {
            ...(value.id
              ? {
                  links: {
                    self: makeRelativeURL(value.id, opts),
                  },
                  data: { type: relationshipType, id: value.id },
                }
              : {
                  data: {
                    type: relationshipType,
                    lid: (value as CardDef)[localId],
                  },
                }),
          },
        },
      };
      if (
        (!(doc.included ?? []).find((r) => 'id' in r && r.id === value.id) &&
          doc.data.id !== value.id) ||
        (!value.id &&
          !(doc.included ?? []).find(
            (r) => 'lid' in r && r.lid === (value as CardDef)[localId],
          ) &&
          doc.data.lid !== (value as CardDef)[localId])
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
    store: CardStore,
    _instancePromise: Promise<CardDef>,
    loadedValue: any,
    relativeTo: URL | undefined,
    opts: DeserializeOpts,
  ): Promise<BaseInstanceType<CardT> | null | NotLoadedValue> {
    if (!isRelationship(value)) {
      throw new Error(
        `linkTo field '${
          this.name
        }' cannot deserialize non-relationship value ${JSON.stringify(value)}`,
      );
    }
    if (Array.isArray(value.data)) {
      throw new Error(
        `linksTo field '${this.name}' cannot deserialize a list of resource ids`,
      );
    }
    let reference = value.links?.self;
    if (reference == null || reference === '') {
      return null;
    }
    let cachedInstance = store.get(new URL(reference, relativeTo).href);
    if (cachedInstance) {
      cachedInstance[isSavedInstance] = true;
      return cachedInstance as BaseInstanceType<CardT>;
    }
    //links.self is used to tell the consumer of this payload how to get the resource via HTTP. data.id is used to tell the
    //consumer of this payload how to get the resource from the side loaded included bucket. we need to strictly only
    //consider data.id when calling the resourceFrom() function (which actually loads the resource out of the included
    //bucket). we should never used links.self as part of that consideration. If there is a missing data.id in the resource entity
    //that means that the serialization is incorrect and is not JSON-API compliant.
    let resource =
      value.data && 'id' in value.data
        ? resourceFrom(doc, value.data?.id)
        : undefined;
    if (!resource) {
      if (loadedValue !== undefined) {
        return loadedValue;
      }
      return {
        type: 'not-loaded',
        reference,
      };
    }

    let clazz = await cardClassFromResource(resource, this.card, relativeTo);
    let deserialized = await clazz[deserialize](
      resource,
      relativeTo,
      doc,
      store,
      opts,
    );
    if ('isSavedInstance' in deserialized) {
      (deserialized as CardDef)[isSavedInstance] = true;
    }
    return deserialized as BaseInstanceType<CardT>;
  }

  emptyValue(_instance: CardDef) {
    return null;
  }

  validate(_instance: CardDef, value: any) {
    // we can't actually place this in the constructor since that would break cards whose field type is themselves
    // so the next opportunity we have to test this scenario is during field assignment
    if (primitive in this.card) {
      throw new Error(
        `field validation error: the linksTo field '${this.name}' contains a primitive card '${this.card.name}'`,
      );
    }
    if (value) {
      if (isNotLoadedValue(value)) {
        return value;
      }
      if (isFileDef(this.card) && !value.id) {
        throw new Error(
          `field validation error: the linksTo field '${this.name}' cannot reference a FileDef without an id`,
        );
      }
      if (!instanceOf(value, this.card)) {
        console.warn(
          'linksTo instance mismatch',
          JSON.stringify({
            expected: identifyCard(this.card),
            actual: identifyCard(value.constructor as typeof BaseDef),
          }),
        );
        throw new Error(
          `field validation error: tried set ${value.constructor.name} as field '${this.name}' but it is not an instance of ${this.card.name}`,
        );
      }
    }
    return value;
  }

  captureQueryFieldSeedData(
    instance: BaseDef,
    value: CardDef,
    resource: LooseCardResource,
  ) {
    if (this.queryDefinition) {
      captureQueryFieldSeedData(
        instance,
        this.name,
        value ? [value] : [],
        resource,
      );
    }
  }

  component(model: Box<CardDef>): BoxComponent {
    let isComputed = !!this.computeVia || !!this.queryDefinition;
    let fieldName = this.name as keyof CardDef;
    let linksToField = this;
    let getInnerModel = () => {
      let innerModel = model.field(fieldName);
      return innerModel as unknown as Box<CardDef | null>;
    };
    let isFileDefField = isFileDef(linksToField.card);
    function shouldRenderEditor(
      format: Format | undefined,
      defaultFormat: Format,
      isComputed: boolean,
      isFileDef: boolean,
    ) {
      return (format ?? defaultFormat) === 'edit' && !isComputed && !isFileDef;
    }
    function getChildFormat(
      format: Format | undefined,
      defaultFormat: Format,
      model: Box<FieldDef>,
      isFileDefField: boolean,
    ) {
      let effectiveFormat = format ?? defaultFormat;
      if (
        effectiveFormat === 'edit' &&
        (('isCardDef' in model.value.constructor &&
          model.value.constructor.isCardDef) ||
          isFileDefField)
      ) {
        return 'fitted';
      }
      return effectiveFormat;
    }
    return class LinksToComponent extends GlimmerComponent<{
      Element: HTMLElement;
      Args: {
        Named: {
          format?: Format;
          displayContainer?: boolean;
          typeConstraint?: ResolvedCodeRef;
        };
      };
      Blocks: {};
    }> {
      <template>
        <CardCrudFunctionsConsumer as |cardCrudFunctions|>
          <DefaultFormatsConsumer as |defaultFormats|>
            {{#if
              (shouldRenderEditor
                @format defaultFormats.cardDef isComputed isFileDefField
              )
            }}
              <LinksToEditor
                @model={{(getInnerModel)}}
                @field={{linksToField}}
                @typeConstraint={{@typeConstraint}}
                @createCard={{cardCrudFunctions.createCard}}
                ...attributes
              />
            {{else}}
              {{#let (fieldComponent linksToField model) as |FieldComponent|}}
                <FieldComponent
                  @format={{getChildFormat
                    @format
                    defaultFormats.cardDef
                    model
                    isFileDefField
                  }}
                  @displayContainer={{@displayContainer}}
                  ...attributes
                />
              {{/let}}
            {{/if}}
          </DefaultFormatsConsumer>
        </CardCrudFunctionsConsumer>
      </template>
    };
  }
}

class LinksToMany<FieldT extends LinkableDefConstructor>
  implements Field<FieldT, any[] | null>
{
  readonly fieldType = 'linksToMany';
  private cardThunk: () => FieldT;
  private declaredCardThunk: () => FieldT;
  private declaredCardCache: FieldT | undefined;
  readonly computeVia: undefined | (() => unknown);
  readonly name: string;
  readonly isUsed: undefined | true;
  readonly isPolymorphic: undefined | true;
  readonly configuration?: ConfigurationInput<any>;
  readonly queryDefinition?: QueryWithInterpolations;
  constructor({
    cardThunk,
    declaredCardThunk,
    computeVia,
    name,
    isUsed,
    isPolymorphic,
    queryDefinition,
  }: FieldConstructor<FieldT>) {
    this.cardThunk = cardThunk;
    this.declaredCardThunk = declaredCardThunk ?? cardThunk;
    this.computeVia = computeVia;
    this.name = name;
    this.isUsed = isUsed;
    this.isPolymorphic = isPolymorphic;
    this.queryDefinition = queryDefinition;
  }

  get card(): FieldT {
    return this.cardThunk();
  }

  private get declaredCard(): FieldT {
    if (!this.declaredCardCache) {
      this.declaredCardCache = this.declaredCardThunk();
    }
    return this.declaredCardCache;
  }

  get declaredCardResolver(): () => FieldT {
    return this.declaredCardThunk;
  }

  getter(instance: CardDef): BaseInstanceType<FieldT> {
    entangleWithCardTracking(instance);
    if (this.computeVia) {
      return getter(instance, this);
    }

    let deserialized = getDataBucket(instance);

    if (this.queryDefinition) {
      let searchResource = ensureQueryFieldSearchResource(
        getStore(instance),
        instance,
        this,
      )!;
      let records = searchResource.instances ?? ([] as any[]);
      return records as BaseInstanceType<FieldT>;
    }

    // Non-query fields
    let value = deserialized.get(this.name);

    if (!value) {
      value = this.emptyValue(instance);
      deserialized.set(this.name, value);
    }

    if (isNotLoadedValue(value)) {
      value = this.emptyValue(instance);
      deserialized.set(this.name, value);
      lazilyLoadLink(instance, this, value.reference, { value });
      return this.emptyValue(instance) as BaseInstanceType<FieldT>;
    }

    if (!Array.isArray(value)) {
      throw new Error(
        `LinksToMany field '${
          this.name
        }' expected array but got ${typeof value}`,
      );
    }

    let notLoadedRefs: string[] = [];
    for (let entry of value) {
      if (isNotLoadedValue(entry)) {
        notLoadedRefs = [...notLoadedRefs, entry.reference];
      }
    }
    if (notLoadedRefs.length > 0) {
      // Important: we intentionally leave the NotLoadedValue sentinels inside the
      // WatchedArray so the lazy loader can swap them out in place once the linked
      // cards finish loading. Because the array identity never changes, Glimmer’s
      // tracking sees the mutation and re-renders when lazilyLoadLink replaces each
      // sentinel with a CardDef instance. Callers should treat these entries as
      // placeholders (e.g. check for constructor.getComponent) rather than assuming
      // every element is immediately renderable. Ideally the .value refactor can
      // iron out this kink.
      // TODO
      // Codex has offered a couple interim solutions to ease the burden on card
      // authors around this:
      // We can wrap the guard in a reusable helper/component so card authors don’t
      // have to think about the sentinel:
      //
      // - Helper – export something like `has-card-component` (just checks
      //   `value?.constructor?.getComponent`) from card-api. Then in templates
      //   they write: `{{#if (has-card-component card)}}…{{/if}}` or
      //   `{{#each (filter-loadable cards) as |c|}}`.
      //
      // - Component – provide a `LoadableCard` component that takes a card instance
      //   and renders the correct `CardContainer` only when the component is ready;
      //   otherwise it renders nothing or a skeleton. Card authors use
      //   `<LoadableCard @card={{card}}/>` instead of calling `getComponent`
      //   themselves.

      for (let entry of value) {
        if (isNotLoadedValue(entry) && !(entry as any).loading) {
          lazilyLoadLink(instance, this, entry.reference, { value });
          (entry as any).loading = true;
        }
      }
    }

    return value as BaseInstanceType<FieldT>;
  }

  queryableValue(instances: any[] | null, stack: CardDef[]): any[] | null {
    if (instances === null || instances.length === 0) {
      // we intentionally use a "null" to represent an empty plural field as
      // this is a limitation to SQLite's json_tree() function when trying to match
      // plural fields that are empty
      return null;
    }

    // Need to replace the WatchedArray proxy with an actual array because the
    // WatchedArray proxy is not structuredClone-able, and hence cannot be
    // communicated over the postMessage boundary between worker and DOM.
    // TODO: can this be simplified since we don't have the worker anymore?
    let results = [...instances]
      .map((instance) => {
        if (instance == null) {
          return null;
        }
        if (primitive in instance) {
          throw new Error(
            `the linksToMany field '${this.name}' contains a primitive card '${instance.name}'`,
          );
        }
        if (isNotLoadedValue(instance)) {
          return { id: instance.reference };
        }
        return this.card[queryableValue](instance, stack);
      })
      .filter((i) => i != null);
    return results.length === 0 ? null : results;
  }

  serialize(
    values: BaseInstanceType<FieldT>[] | null | NotLoadedValue | undefined,
    doc: JSONAPISingleResourceDocument,
    visited: Set<string>,
    opts?: SerializeOpts,
  ) {
    // Check for skip-serialization marker for computed fields that can't be computed
    if (
      values &&
      typeof values === 'object' &&
      'type' in values &&
      (values as any).type === 'skip-serialization'
    ) {
      return { relationships: {} };
    }

    // this can be a not loaded value happen when the linksToMany is a
    // computed that consumes a linkTo field that is not loaded
    if (isNotLoadedValue(values)) {
      return { relationships: {} };
    }

    if (values == null || values.length === 0) {
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

    let relationshipType = isFileDef(this.card)
      ? FileMetaResourceType
      : CardResourceType;
    let relationships: Record<string, Relationship> = {};
    values.map((value, i) => {
      if (value == null) {
        relationships[`${this.name}\.${i}`] = {
          links: {
            self: null,
          },
          data: null,
        };
        return;
      }
      if (isNotLoadedValue(value)) {
        relationships[`${this.name}\.${i}`] = {
          links: {
            self: makeRelativeURL(value.reference, opts),
          },
          data: { type: relationshipType, id: value.reference },
        };
        return;
      }
      if (isFileDef(this.card) && !value.id) {
        throw new Error(
          `linksToMany field '${this.name}' cannot serialize a FileDef without an id`,
        );
      }
      if (visited.has(value.id)) {
        relationships[`${this.name}\.${i}`] = {
          links: {
            self: makeRelativeURL(value.id, opts),
          },
          data: { type: relationshipType, id: value.id },
        };
        return;
      }
      if (visited.has((value as CardDef)[localId])) {
        relationships[`${this.name}\.${i}`] = {
          data: { type: relationshipType, lid: (value as CardDef)[localId] },
        };
        return;
      }

      visited.add(value.id ?? (value as CardDef)[localId]);
      let serialized: JSONAPIResource & ResourceID = callSerializeHook(
        this.card,
        value,
        doc,
        visited,
        opts,
      );
      if (serialized.meta && Object.keys(serialized.meta).length === 0) {
        delete serialized.meta;
      }
      if (
        (!(doc.included ?? []).find((r) => 'id' in r && r.id === value.id) &&
          doc.data.id !== value.id) ||
        (!value.id &&
          !(doc.included ?? []).find(
            (r) => 'lid' in r && r.lid === (value as CardDef)[localId],
          ) &&
          doc.data.lid !== (value as CardDef)[localId])
      ) {
        doc.included = doc.included ?? [];
        doc.included.push(serialized);
      }

      relationships[`${this.name}\.${i}`] = {
        ...(value.id
          ? {
              links: {
                self: makeRelativeURL(value.id, opts),
              },
              data: { type: relationshipType, id: value.id },
            }
          : {
              data: {
                type: relationshipType,
                lid: (value as CardDef)[localId],
              },
            }),
      };
    });

    return { relationships };
  }

  async deserialize(
    values: any,
    doc: CardDocument,
    _relationships: undefined,
    _fieldMeta: undefined,
    store: CardStore,
    instancePromise: Promise<BaseDef>,
    loadedValues: any,
    relativeTo: URL | undefined,
    opts: DeserializeOpts,
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
        if (Array.isArray(value.data)) {
          throw new Error(
            `linksToMany field '${this.name}' cannot deserialize a list of resource ids`,
          );
        }
        let reference = value.links?.self;
        if (reference == null) {
          return null;
        }
        let normalizedReference = new URL(reference, relativeTo).href;
        let cachedInstance = store.get(normalizedReference);

        if (cachedInstance) {
          (cachedInstance as CardDef)[isSavedInstance] = true;
          return cachedInstance;
        }
        // links.self is used to tell the consumer of this payload how to get the resource via HTTP.
        // data.id is used to tell the consumer how to find the resource in the included bucket.
        // Prefer data.id for resourceFrom(), but fall back to links.self when data.id is missing
        // (the array-style linksToMany format omits data.id).
        let resourceId =
          value.data && 'id' in value.data ? value.data?.id : undefined;
        if (!resourceId) {
          resourceId = normalizedReference;
        }
        if (loadedValues && Array.isArray(loadedValues)) {
          let loadedValue = loadedValues.find(
            (v) => isCardOrField(v) && 'id' in v && v.id === resourceId,
          );
          if (loadedValue) {
            return loadedValue;
          }
        }
        let resource = resourceFrom(doc, resourceId);
        if (!resource && reference !== normalizedReference) {
          resource = resourceFrom(doc, reference);
        }
        if (!resource) {
          return {
            type: 'not-loaded',
            reference,
          };
        }
        let clazz = await cardClassFromResource(
          resource,
          this.card,
          relativeTo,
        );
        let deserialized = await clazz[deserialize](
          resource,
          relativeTo,
          doc,
          store,
          opts,
        );
        if ('isSavedInstance' in deserialized) {
          (deserialized as CardDef)[isSavedInstance] = true;
        }
        return deserialized;
      });

    return new WatchedArray(
      (oldValue, value) =>
        instancePromise.then((instance) => {
          applySubscribersToInstanceValue(
            instance,
            this,
            oldValue as BaseDef[],
            value as BaseDef[],
          );
          notifySubscribers(instance, this.name, value);
          notifyCardTracking(instance);
        }),
      await Promise.all(resources),
    );
  }

  emptyValue(instance: BaseDef) {
    return new WatchedArray((oldValue, value) => {
      applySubscribersToInstanceValue(
        instance,
        this,
        oldValue as BaseDef[],
        value as BaseDef[],
      );
      notifySubscribers(instance, this.name, value);
      notifyCardTracking(instance);
    });
  }

  validate(instance: BaseDef, values: any[] | null) {
    if (primitive in this.card) {
      throw new Error(
        `field validation error: the linksToMany field '${this.name}' contains a primitive card '${this.card.name}'`,
      );
    }

    if (values == null) {
      return values;
    }

    if (!Array.isArray(values)) {
      throw new Error(
        `field validation error: Expected array for field value of field '${this.name}'`,
      );
    }

    let expectedCard = this.declaredCard;
    for (let value of values) {
      if (
        !isNotLoadedValue(value) &&
        value != null &&
        !instanceOf(value, expectedCard)
      ) {
        throw new Error(
          `field validation error: tried set ${value.constructor.name} as field '${this.name}' but it is not an instance of ${expectedCard.name}`,
        );
      }
      if (
        !isNotLoadedValue(value) &&
        value != null &&
        isFileDef(expectedCard) &&
        !value.id
      ) {
        throw new Error(
          `field validation error: the linksToMany field '${this.name}' cannot reference a FileDef without an id`,
        );
      }
    }

    return new WatchedArray((oldValue, value) => {
      applySubscribersToInstanceValue(
        instance,
        this,
        oldValue as BaseDef[],
        value as BaseDef[],
      );
      notifySubscribers(instance, this.name, value);
      notifyCardTracking(instance);
    }, values);
  }

  captureQueryFieldSeedData(
    instance: BaseDef,
    value: CardDef[],
    resource: LooseCardResource,
  ) {
    if (this.queryDefinition) {
      captureQueryFieldSeedData(instance, this.name, value, resource);
    }
  }

  component(model: Box<CardDef>): BoxComponent {
    let fieldName = this.name as keyof BaseDef;
    let arrayField = model.field(
      fieldName,
      useIndexBasedKey in this.card,
    ) as unknown as Box<CardDef[]>;
    return getLinksToManyComponent({
      model,
      arrayField,
      field: this,
      cardTypeFor,
    });
  }
}

function fieldComponent(
  field: Field<typeof BaseDef>,
  model: Box<BaseDef>,
): BoxComponent {
  let fieldName = field.name as keyof BaseDef;
  let card: typeof BaseDef;
  let override =
    model.value && typeof model.value === 'object'
      ? getFieldOverrides(model.value)?.get(field.name)
      : undefined;

  if (primitive in field.card) {
    card = override ?? field.card;
  } else {
    card =
      (model.value[fieldName]?.constructor as typeof BaseDef) ??
      override ??
      field.card;
  }
  let innerModel = model.field(fieldName) as unknown as Box<BaseDef>;
  return getBoxComponent(card, innerModel, field);
}

interface InternalFieldInitializer {
  setupField(
    name: string,
    ownerPrototype: BaseDef,
  ): {
    enumerable?: boolean;
    get(): unknown;
    set(value: unknown): void;
  };
  description: string | undefined;
}

// our decorators are implemented by Babel, not TypeScript, so they have a
// different signature than Typescript thinks they do.
export const field = function (
  target: BaseDef,
  key: string | symbol,
  { initializer }: { initializer(): any },
) {
  if (typeof key === 'symbol') {
    throw new Error(
      `the @field decorator only supports string field names, not symbols`,
    );
  }
  if (!(target instanceof BaseDef)) {
    throw new Error(
      `the @field decorator can only be used inside classes that extend BaseDef`,
    );
  }
  let init = initializer() as InternalFieldInitializer;
  let descriptor = init.setupField(key, target as BaseDef);
  if (init.description) {
    setFieldDescription(target.constructor, key as string, init.description);
  }
  return descriptor;
} as unknown as PropertyDecorator;
(field as any)[fieldDecorator] = undefined;

export function containsMany<FieldT extends FieldDefConstructor>(
  field: FieldT,
  options?: Options,
): BaseInstanceType<FieldT>[] {
  return {
    setupField(fieldName: string, _ownerPrototype: BaseDef) {
      let { computeVia, isUsed } = options ?? {};
      let instance = new ContainsMany({
        cardThunk: cardThunk(field),
        computeVia,
        name: fieldName,
        isUsed,
      });
      (instance as any).configuration = options?.configuration;
      return makeDescriptor(instance);
    },
    description: options?.description,
  } satisfies InternalFieldInitializer as any;
}

export function contains<FieldT extends FieldDefConstructor>(
  field: FieldT,
  options?: Options,
): BaseInstanceType<FieldT> {
  return {
    setupField(fieldName: string, _ownerPrototype: BaseDef) {
      let { computeVia, isUsed } = options ?? {};
      let instance = new Contains({
        cardThunk: cardThunk(field),
        computeVia,
        name: fieldName,
        isUsed,
      });
      (instance as any).configuration = options?.configuration;
      return makeDescriptor(instance);
    },
    description: options?.description,
  } satisfies InternalFieldInitializer as any;
}

export function linksTo<CardT extends LinkableDefConstructor>(
  cardOrThunk: CardT | (() => CardT),
  options?: RelationshipOptions,
): BaseInstanceType<CardT> {
  return {
    setupField(fieldName: string, ownerPrototype: BaseDef) {
      let { computeVia, isUsed, query } = options ?? {};
      let fieldCardThunk = cardThunk(cardOrThunk);
      if (query) {
        validateRelationshipQuery(ownerPrototype, fieldName, query);
      }
      let instance = new LinksTo({
        cardThunk: fieldCardThunk,
        declaredCardThunk: fieldCardThunk,
        computeVia,
        name: fieldName,
        isUsed,
        queryDefinition: query,
      });
      (instance as any).configuration = options?.configuration;
      return makeDescriptor(instance);
    },
    description: options?.description,
  } satisfies InternalFieldInitializer as any;
}

export function linksToMany<CardT extends LinkableDefConstructor>(
  cardOrThunk: CardT | (() => CardT),
  options?: RelationshipOptions,
): BaseInstanceType<CardT>[] {
  return {
    setupField(fieldName: string, ownerPrototype: BaseDef) {
      let { computeVia, isUsed, query } = options ?? {};
      let fieldCardThunk = cardThunk(cardOrThunk);
      if (query) {
        validateRelationshipQuery(ownerPrototype, fieldName, query);
      }
      let instance = new LinksToMany({
        cardThunk: fieldCardThunk,
        declaredCardThunk: fieldCardThunk,
        computeVia,
        name: fieldName,
        isUsed,
        queryDefinition: query,
      });
      (instance as any).configuration = options?.configuration;
      return makeDescriptor(instance);
    },
    description: options?.description,
  } satisfies InternalFieldInitializer as any;
}

// (moved below BaseDef & FieldDef declarations)

// TODO: consider making this abstract
export class BaseDef {
  // this is here because CardBase has no public instance methods, so without it
  // typescript considers everything a valid card.
  [isBaseInstance] = true;
  // [relativeTo] actually becomes really important for Card/Field separation. FieldDefs
  // may contain interior fields that have relative links. FieldDef's though have no ID.
  // So we need a [relativeTo] property that derives from the root document ID in order to
  // resolve relative links at the FieldDef level.
  [relativeTo]: URL | undefined = undefined;
  declare ['constructor']: BaseDefConstructor;
  static baseDef: undefined;
  static data?: Record<string, any>; // TODO probably refactor this away all together
  static displayName = 'Base';
  static icon: CardOrFieldTypeIcon;

  static getDisplayName(instance: BaseDef) {
    return instance.constructor.displayName;
  }
  static getIconComponent(instance: BaseDef) {
    return instance.constructor.icon;
  }

  get [realmURL](): URL | undefined {
    return undefined; // override in CardDef, FieldDef
  }

  static [emptyValue]: object | string | number | null | boolean | undefined;

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

  static [formatQuery](value: any): any {
    if (primitive in this) {
      return value;
    }
    throw new Error(`Cannot format query value for composite card/field`);
  }

  static [queryableValue](value: any, stack: BaseDef[] = []): any {
    if (primitive in this) {
      if (fieldSerializer in this) {
        assertIsSerializerName(this[fieldSerializer]);
        let serializer = getSerializer(this[fieldSerializer]);
        return serializer.queryableValue(value, stack);
      }
      return value;
    } else {
      if (value == null) {
        return null;
      }
      if (stack.includes(value)) {
        return { id: value.id };
      }
      function makeAbsoluteURL(maybeRelativeURL: string) {
        if (!value[relativeTo]) {
          return maybeRelativeURL;
        }
        return new URL(maybeRelativeURL, value[relativeTo]).href;
      }
      return Object.fromEntries(
        Object.entries(
          getFields(value, {
            includeComputeds: true,
            usedLinksToFieldsOnly: true,
          }),
        ).map(([fieldName, field]) => {
          let rawValue = peekAtField(value, fieldName);
          if (field?.fieldType === 'linksToMany') {
            return [
              fieldName,
              field
                .queryableValue(rawValue, [value, ...stack])
                ?.map((v: any) => {
                  return { ...v, id: makeAbsoluteURL(v.id) };
                }) ?? null,
            ];
          }
          if (isNotLoadedValue(rawValue)) {
            let normalizedId = rawValue.reference;
            if (value[relativeTo]) {
              normalizedId = new URL(normalizedId, value[relativeTo]).href;
            }
            return [fieldName, { id: makeAbsoluteURL(rawValue.reference) }];
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
    store?: CardStore,
    opts?: DeserializeOpts,
  ): Promise<BaseInstanceType<T>> {
    if (primitive in this) {
      return data;
    }
    return _createFromSerialized(this, data, doc, relativeTo, store, opts);
  }

  static getComponent(
    card: BaseDef,
    field?: Field,
    opts?: { componentCodeRef?: CodeRef },
  ) {
    return getComponent(card, field, opts);
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
export class Component<
  CardT extends BaseDefConstructor,
> extends GlimmerComponent<SignatureFor<CardT>> {}

export type CreateCardFn = (
  ref: CodeRef,
  relativeTo: URL | undefined,
  opts?: {
    closeAfterCreating?: boolean;
    realmURL?: URL; // the realm to create the card in
    localDir?: LocalPath; // the local directory path within the realm to create the card file
    doc?: LooseSingleCardDocument; // initial data for the card
    cardModeAfterCreation?: Format; // by default, the new card opens in the stack in edit mode
  },
) => Promise<string | undefined>;

export type ViewCardFn = (
  cardOrURL: CardDef | URL,
  format?: Format,
  opts?: {
    openCardInRightMostStack?: boolean;
    stackIndex?: number;
    fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany';
    fieldName?: string;
  },
) => void;

export type EditCardFn = (card: CardDef) => void;

export type SaveCardFn = (id: string) => void;

export type DeleteCardFn = (cardOrId: CardDef | URL | string) => Promise<void>;

export interface CardCrudFunctions {
  createCard: CreateCardFn;
  saveCard: SaveCardFn;
  editCard: EditCardFn;
  viewCard: ViewCardFn;
  deleteCard: DeleteCardFn;
}

export type BaseDefComponent = ComponentLike<{
  Blocks: {};
  Element: any;
  Args: {
    cardOrField: typeof BaseDef;
    fields: any;
    format: Format;
    model: any;
    set: Setter;
    fieldName: string | undefined;
    context?: CardContext;
    canEdit?: boolean;
    typeConstraint?: ResolvedCodeRef;
    // Resolved, merged field configuration (if applicable)
    configuration?: FieldConfiguration | undefined;
    createCard: CreateCardFn;
    viewCard: ViewCardFn;
    editCard: EditCardFn;
    saveCard: SaveCardFn;
  };
}>;

export class FieldDef extends BaseDef {
  // this changes the shape of the class type FieldDef so that a CardDef
  // class type cannot masquerade as a FieldDef class type
  static isFieldDef = true;
  static displayName = 'Field';
  static icon = RectangleEllipsisIcon;
  [realmContext]?: string;

  get [realmURL](): URL | undefined {
    let realmURLString = this[realmContext];
    return realmURLString ? new URL(realmURLString) : undefined;
  }

  // Optional provider for default configuration, merged with per-usage configuration
  static configuration?: ConfigurationInput<any>;

  static embedded: BaseDefComponent = MissingTemplate;
  static edit: BaseDefComponent = FieldDefEditTemplate;
  static atom: BaseDefComponent = DefaultAtomViewTemplate;
  static fitted: BaseDefComponent = MissingTemplate;
}

export class ReadOnlyField extends FieldDef {
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
}

export class StringField extends FieldDef {
  static displayName = 'String';
  static icon = LetterCaseIcon;
  static [primitive]: string;
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        @value={{@model}}
        @onInput={{@set}}
        @disabled={{not @canEdit}}
      />
    </template>
  };
  static atom = class Atom extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
}

// TODO: This is a simple workaround until the thumbnailURL is converted into an actual image field
export class MaybeBase64Field extends StringField {
  static embedded = class Embedded extends Component<typeof this> {
    get isBase64() {
      return this.args.model?.startsWith('data:');
    }
    <template>
      {{#if this.isBase64}}
        <em>(Base64 encoded value)</em>
      {{else}}
        {{@model}}
      {{/if}}
    </template>
  };
  static atom = MaybeBase64Field.embedded;
}

export class TextAreaField extends StringField {
  static displayName = 'TextArea';
  static icon = TextAreaIcon;
  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        class='boxel-text-area'
        @value={{@model}}
        @onInput={{@set}}
        @type='textarea'
        @readonly={{not @canEdit}}
      />
    </template>
  };
}

// enumField has moved to packages/base/enum.gts

export class CSSField extends TextAreaField {
  static displayName = 'CSS Field';
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='css-field-container'>
        {{#if @model.length}}
          <CopyButton class='css-field-copy-button' @textToCopy={{@model}} />
        {{/if}}
        <pre class='css-field' data-test-css-field>{{if
            @model
            @model
            '/* No CSS defined */'
          }}</pre>
      </div>
      <style scoped>
        .css-field-container {
          --field-bg: var(--card, var(--boxel-100));
          --field-fg: var(--card-foreground, var(--boxel-dark));
          --field-border: var(
            --border,
            color-mix(in oklab, var(--field-fg) 20%, var(--field-bg))
          );
          position: relative;
        }
        .css-field-copy-button {
          position: absolute;
          top: var(--boxel-sp-xs);
          right: var(--boxel-sp-xs);
        }
        .css-field {
          margin-block: 0;
          padding: var(--boxel-sp);
          background-color: var(--field-bg);
          border: 1px solid var(--field-border);
          border-radius: var(--radius, var(--boxel-border-radius));
          color: var(--field-fg);
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
          font-size: var(--boxel-font-size-xs);
          white-space: pre-wrap;
        }
        .css-field::placeholder {
          opacity: 0.5;
        }
      </style>
    </template>
  };
}

export class MarkdownField extends StringField {
  static displayName = 'Markdown';
  static icon = MarkdownIcon;

  static embedded = class MarkdownViewTemplate extends Component<
    typeof MarkdownField
  > {
    <template>
      <MarkdownTemplate @content={{@model}} />
    </template>
  };
  static atom = class MarkdownViewTemplate extends Component<
    typeof MarkdownField
  > {
    <template>
      <MarkdownTemplate @content={{@model}} />
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        class='boxel-text-area'
        @type='textarea'
        @value={{@model}}
        @onInput={{@set}}
        @disabled={{not @canEdit}}
        @readonly={{not @canEdit}}
      />
    </template>
  };
}

export class CardInfoField extends FieldDef {
  static displayName = 'Card Info';
  @field name = contains(StringField);
  @field summary = contains(StringField);
  @field cardThumbnailURL = contains(MaybeBase64Field);
  @field theme = linksTo(() => Theme);
  @field notes = contains(MarkdownField);
}

export class CardDef extends BaseDef {
  readonly [localId]: string = uuidv4();
  [isSavedInstance] = false;
  [meta]: CardResourceMeta | undefined = undefined;
  get [fieldsUntracked](): Record<string, typeof BaseDef> | undefined {
    let overrides = getFieldOverrides(this);
    return overrides ? Object.fromEntries(getFieldOverrides(this)) : undefined;
  }
  get [fields](): Record<string, typeof BaseDef> | undefined {
    entangleWithCardTracking(this);
    return this[fieldsUntracked];
  }
  set [fields](overrides: Record<string, typeof BaseDef>) {
    let existingOverrides = getFieldOverrides(this);
    for (let [fieldName, clazz] of Object.entries(overrides)) {
      existingOverrides.set(fieldName, clazz);
    }
    // notify glimmer to rerender this card
    notifyCardTracking(this);
  }
  @field id = contains(ReadOnlyField);
  @field cardInfo = contains(CardInfoField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: CardDef) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: CardDef) {
      return this.cardInfo.summary;
    },
  });
  // TODO: this will probably be an image or image url field card when we have it
  // UPDATE: we now have a Base64ImageField card. we can probably refactor this
  // to use it directly now (or wait until a better image field comes along)
  @field cardThumbnailURL = contains(MaybeBase64Field, {
    computeVia: function (this: CardDef) {
      return this.cardInfo.cardThumbnailURL;
    },
  });
  static displayName = 'Card';
  static isCardDef = true;
  static icon = CaptionsIcon;

  static assignInitialFieldValue(
    instance: BaseDef,
    fieldName: string,
    value: any,
  ) {
    if (fieldName === 'id') {
      // TODO: can we eliminate this conditional branch?

      // we need to be careful that we don't trigger the ambient recompute() in our setters
      // when we are instantiating an instance that is placed in the cardStore that has
      // not had it's field values set yet, as computeds may assume dependent fields are
      // available when they are not (e.g. Spec.isPrimitive trying to access its 'ref' field).
      // In this scenario, only the 'id' field is available. The rest of the fields will be
      // filled in later, so just set the 'id' directly in the deserialized cache to avoid
      // triggering the recompute.
      let deserialized = getDataBucket(instance);
      deserialized.set('id', value);
    } else {
      super.assignInitialFieldValue(instance, fieldName, value);
    }
  }

  static embedded: BaseDefComponent = DefaultEmbeddedTemplate;
  static fitted: BaseDefComponent = DefaultFittedTemplate;
  static isolated: BaseDefComponent = DefaultCardDefTemplate;
  static edit: BaseDefComponent = DefaultCardDefTemplate;
  static atom: BaseDefComponent = DefaultAtomViewTemplate;
  static head: BaseDefComponent = DefaultHeadTemplate;

  static prefersWideFormat = false; // whether the card is full-width in the stack
  static headerColor: string | null = null; // set string color value if the stack-item header has a background color

  constructor(
    data?: Record<string, any> & {
      [fields]?: Record<string, BaseDefConstructor>;
    },
  ) {
    super(data);
    if (data && localId in data && typeof data[localId] === 'string') {
      this[localId] = data[localId];
    }
    if (data && fields in data && data[fields]) {
      let overrides = getFieldOverrides(this);
      for (let [fieldName, clazz] of Object.entries(data[fields])) {
        overrides.set(fieldName, clazz);
      }
    }
  }

  get [realmInfo]() {
    return getCardMeta(this, 'realmInfo');
  }

  get [realmURL](): URL | undefined {
    let realmURLString: string | undefined = getCardMeta(this, 'realmURL');
    return realmURLString ? new URL(realmURLString) : undefined;
  }

  [getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
    return getDefaultCardMenuItems(this, params);
  }
}

export class CssImportField extends StringField {
  static displayName = 'CSS Import';
  static icon = ImportIcon;
}

export class Theme extends CardDef {
  static displayName = 'Theme';
  static icon = ThemeIcon;
  @field cssVariables = contains(CSSField, {
    description:
      'CSS variable definitions that build on shadcn variables (typically for :root and .dark selectors) injected into the CardContainer.',
  });
  @field cssImports = containsMany(CssImportField, {
    description:
      'CSS links (e.g. Google Fonts) imported via the CardContainer.',
  });

  [getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
    let menuItems = super[getMenuItems](params);
    if (params.menuContext === 'interact' && params.commandContext && this.id) {
      menuItems = [
        ...menuItems,
        {
          label: 'Copy and Edit',
          action: async () => {
            if (!params.commandContext || !this.id) {
              return;
            }
            let cmd = new CopyAndEditCommand(params.commandContext);
            await cmd.execute({
              card: this,
            });
          },
          icon: FilePencilIcon,
          disabled: !this.id,
        },
        {
          label: 'Modify Theme via AI',
          action: async () => {
            let cmd = new PatchThemeCommand(params.commandContext);
            await cmd.execute({
              cardId: this.id as unknown as string,
            });
          },
          icon: WandIcon,
          disabled: !this.id,
        },
      ];
    }
    return menuItems;
  }
}

export type BaseDefConstructor = typeof BaseDef;
export type CardDefConstructor = typeof CardDef;
export type FieldDefConstructor = typeof FieldDef;
export type FileDefConstructor = typeof FileDef;
export type LinkableDefConstructor = CardDefConstructor | FileDefConstructor;

export function subscribeToChanges(
  fieldOrCard: BaseDef | BaseDef[],
  subscriber: CardChangeSubscriber,
  enclosing?: { fieldOrCard: BaseDef; fieldName: string },
) {
  if (isArrayOfCardOrField(fieldOrCard)) {
    fieldOrCard.forEach((item, i) => {
      subscribeToChanges(
        item,
        subscriber,
        enclosing
          ? {
              fieldOrCard: enclosing.fieldOrCard,
              fieldName: `${enclosing.fieldName}.${i}`,
            }
          : undefined,
      );
    });
    return;
  }

  let changeSubscribers = subscribers.get(fieldOrCard);
  if (changeSubscribers && changeSubscribers.has(subscriber)) {
    return;
  }

  if (!changeSubscribers) {
    changeSubscribers = new Set();
    subscribers.set(fieldOrCard, changeSubscribers);
  }

  changeSubscribers.add(subscriber);
  if (enclosing) {
    subscriberConsumer.set(fieldOrCard, enclosing);
  }

  let fields = getFields(fieldOrCard, {
    usedLinksToFieldsOnly: true,
    includeComputeds: false,
  });
  Object.keys(fields).forEach((fieldName) => {
    let field = getField(fieldOrCard, fieldName) as Field<typeof BaseDef>;
    if (
      field &&
      (field.fieldType === 'contains' || field.fieldType === 'containsMany')
    ) {
      let value = peekAtField(fieldOrCard, fieldName);
      if (isCardOrField(value) || isArrayOfCardOrField(value)) {
        subscribeToChanges(value, subscriber, {
          fieldOrCard: enclosing?.fieldOrCard ?? fieldOrCard,
          fieldName: enclosing?.fieldName
            ? `${enclosing.fieldName}.${fieldName}`
            : fieldName,
        });
      }
    }
  });
}

export function unsubscribeFromChanges(
  fieldOrCard: BaseDef | BaseDef[],
  subscriber: CardChangeSubscriber,
  visited: Set<BaseDef> = new Set(),
) {
  if (isArrayOfCardOrField(fieldOrCard)) {
    fieldOrCard.forEach((item) => {
      unsubscribeFromChanges(item, subscriber);
    });
    return;
  }

  if (visited.has(fieldOrCard)) {
    return;
  }

  visited.add(fieldOrCard);
  let changeSubscribers = subscribers.get(fieldOrCard);
  if (!changeSubscribers) {
    return;
  }
  changeSubscribers.delete(subscriber);

  let fields = getFields(fieldOrCard, {
    usedLinksToFieldsOnly: true,
    includeComputeds: false,
  });
  Object.keys(fields).forEach((fieldName) => {
    let field = getField(fieldOrCard, fieldName) as Field<typeof BaseDef>;
    if (
      field &&
      (field.fieldType === 'contains' || field.fieldType === 'containsMany')
    ) {
      let value = peekAtField(fieldOrCard, fieldName);
      if (isCardOrField(value) || isArrayOfCardOrField(value)) {
        unsubscribeFromChanges(value, subscriber);
      }
    }
  });
}

function applySubscribersToInstanceValue(
  instance: BaseDef,
  field: Field<typeof BaseDef>,
  oldValue: BaseDef | BaseDef[],
  newValue: BaseDef | BaseDef[],
) {
  let changeSubscribers: Set<CardChangeSubscriber> | undefined = undefined;
  if (field.fieldType === 'contains' || field.fieldType === 'containsMany') {
    changeSubscribers = subscribers.get(instance);
  } else if (
    isArrayOfCardOrField(oldValue) &&
    oldValue[0] &&
    subscribers.has(oldValue[0])
  ) {
    changeSubscribers = subscribers.get(oldValue[0]);
  } else if (isCardOrField(oldValue)) {
    changeSubscribers = subscribers.get(oldValue);
  }

  if (!changeSubscribers) {
    return;
  }

  let toArray = function (item: BaseDef | BaseDef[]) {
    if (isCardOrField(item)) {
      return [item];
    } else if (isArrayOfCardOrField(item)) {
      return [...item];
    } else {
      return [];
    }
  };

  let oldItems = toArray(oldValue);
  let newItems = toArray(newValue);

  let addedItems = newItems.filter((item) => !oldItems.includes(item));
  let removedItems = oldItems.filter((item) => !newItems.includes(item));

  addedItems.forEach((item, i) =>
    changeSubscribers!.forEach((subscriber) =>
      subscribeToChanges(item, subscriber, {
        fieldOrCard: instance,
        fieldName: `${field.name}.${i}`,
      }),
    ),
  );

  removedItems.forEach((item) =>
    changeSubscribers!.forEach((subscriber) =>
      unsubscribeFromChanges(item, subscriber),
    ),
  );
}

function lazilyLoadLink(
  instance: CardDef,
  field: Field,
  link: string,
  pluralArgs?: { value: any[] },
) {
  let inflightLoads = inflightLinkLoads.get(instance);
  if (!inflightLoads) {
    inflightLoads = new Map();
    inflightLinkLoads.set(instance, inflightLoads);
  }
  let reference = new URL(link, instance.id ?? instance[relativeTo]).href;
  let key = `${field.name}/${reference}`;
  let promise = inflightLoads.get(key);
  let store = getStore(instance);
  if (promise) {
    store.trackLoad(promise);
    return;
  }
  let deferred = new Deferred<void>();
  inflightLoads.set(key, deferred.promise);
  store.trackLoad(
    // we wrap the promise with a catch that will prevent the rejections from bubbling up but
    // not interfere with the original deferred. this prevents QUnit from being really noisy
    // and reporting a "global error" even though that is a normal operating circumstance for
    // the rendering when it encounters an error. the original deferred.promise still
    // rejects as expected for anyone awaiting it, but it won't cause unnecessary noise in QUnit.
    deferred.promise.then(
      () => {},
      () => {},
    ),
  );
  (async () => {
    let isFileLink = isFileDef(field.card);
    try {
      let fieldValue: CardDef | FileDef;
      if (isFileLink) {
        let fileMetaDoc = await store.loadFileMetaDocument(reference);
        if (isCardError(fileMetaDoc)) {
          let cardError = fileMetaDoc;
          let referenceForDeps = reference;
          cardError.deps = [referenceForDeps];
          throw cardError;
        }
        fieldValue = (await createFromSerialized(
          fileMetaDoc.data,
          fileMetaDoc,
          new URL(fileMetaDoc.data.id!),
          { store },
        )) as FileDef;
      } else {
        let cardDoc = await store.loadCardDocument(reference);
        if (isCardError(cardDoc)) {
          let cardError = cardDoc;
          let referenceForDeps = reference;
          cardError.deps = [referenceForDeps];
          throw cardError;
        }
        fieldValue = (await createFromSerialized(
          cardDoc.data,
          cardDoc,
          new URL(cardDoc.data.id!),
          { store },
        )) as CardDef;
      }
      if (pluralArgs) {
        let { value } = pluralArgs;
        let indices: number[] = [];
        for (let [index, item] of value.entries()) {
          if (!isNotLoadedValue(item)) {
            continue;
          }
          let notLoadedRef = new URL(
            item.reference,
            instance.id ?? instance[relativeTo],
          ).href;
          if (reference === notLoadedRef) {
            indices.push(index);
          }
        }
        for (let index of indices) {
          value[index] = fieldValue;
        }
      } else {
        (instance as any)[field.name] = fieldValue;
      }
    } catch (e) {
      // we replace the node-loaded value with a null
      // TODO in the future consider recording some link meta that this reference is actually missing
      (instance as any)[field.name] = null;

      let error = e as Error;
      let isMissingFile =
        (isCardError(error) && error.status === 404) ||
        (typeof error?.message === 'string' &&
          /not found/i.test(error.message));
      let referenceForMissingFile =
        isFileLink || reference.endsWith('.json')
          ? reference
          : `${reference}.json`;
      let payloadError: {
        title: string;
        status: number;
        message: string;
        stack?: string;
        deps?: string[];
      } = {
        title: isMissingFile
          ? 'Link Not Found'
          : error?.message ?? 'Card Error',
        status: isMissingFile ? 404 : (error as any)?.status ?? 500,
        message: isMissingFile
          ? `missing file ${referenceForMissingFile}`
          : error?.message ?? String(e),
        stack: error?.stack,
      };
      if (isCardError(error) && error.deps?.length) {
        payloadError.deps = [...new Set(error.deps)];
      }
      let payload = JSON.stringify({
        type: 'error',
        error: payloadError,
      });
      // We use a custom event for render errors--otherwise QUnit will report a "global error"
      // when we use a promise rejection to signal to the prerender that there was an error
      // even though everything is working as designed. QUnit is very noisy about these errors...
      const event = new CustomEvent('boxel-render-error', {
        detail: { reason: payload },
      });
      globalThis.dispatchEvent(event);
    } finally {
      deferred.fulfill();
      inflightLoads.delete(key);
      if (inflightLoads.size === 0) {
        inflightLinkLoads.delete(instance);
      }
    }
  })();
}

export function setId(instance: CardDef, id: string) {
  let field = getField(instance, 'id');
  if (field) {
    setField(instance, field, id);
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

export function formatQueryValue(
  field: Field<typeof BaseDef>,
  queryValue: any,
): any {
  let serializer: ReturnType<typeof getSerializer> | undefined;
  if (primitive in field.card && fieldSerializer in field.card) {
    assertIsSerializerName(field.card[fieldSerializer]);
    serializer = getSerializer(field.card[fieldSerializer]);
  }
  return (
    serializer?.formatQuery?.(queryValue) ?? field.card[formatQuery](queryValue)
  );
}

async function getDeserializedValue<CardT extends BaseDefConstructor>({
  card,
  loadedValue,
  fieldName,
  value,
  resource,
  modelPromise,
  doc,
  store,
  relativeTo,
  opts,
}: {
  card: CardT;
  loadedValue: any;
  fieldName: string;
  value: any;
  resource: LooseCardResource;
  modelPromise: Promise<BaseDef>;
  doc: LooseSingleCardDocument | CardDocument;
  store: CardStore;
  relativeTo: URL | undefined;
  opts?: DeserializeOpts;
}): Promise<any> {
  let field = getField(isCardInstance(value) ? value : card, fieldName);
  if (!field) {
    throw new Error(`could not find field ${fieldName} in card ${card.name}`);
  }
  let result = await field.deserialize(
    value,
    doc,
    resource.relationships,
    resource.meta.fields?.[fieldName],
    store,
    modelPromise,
    loadedValue,
    relativeTo,
    opts,
  );
  return result;
}

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
  resource:
    | LooseLinkableResource<CardResource>
    | LooseLinkableResource<FileMetaResource>,
  doc:
    | LooseSingleResourceDocument<CardResource | FileMetaResource>
    | LinkableDocument,
  relativeTo: URL | undefined,
  opts?: DeserializeOpts & { store?: CardStore },
): Promise<BaseInstanceType<T>> {
  let store = opts?.store ?? new FallbackCardStore();
  let {
    meta: { adoptsFrom },
  } = resource;
  let card: typeof BaseDef | undefined = await loadCardDef(adoptsFrom, {
    loader: myLoader(),
    relativeTo,
  });
  if (!card) {
    throw new Error(`could not find card: '${humanReadable(adoptsFrom)}'`);
  }

  return card[deserialize](
    resource,
    relativeTo,
    doc as CardDocument,
    store,
    opts,
  ) as BaseInstanceType<T>;
}

export async function updateFromSerialized<T extends BaseDefConstructor>(
  instance: BaseInstanceType<T>,
  doc: LooseSingleCardDocument,
  store = getStore(instance),
  opts?: DeserializeOpts,
): Promise<BaseInstanceType<T>> {
  stores.set(instance, store);
  if (!instance[relativeTo] && doc.data.id) {
    instance[relativeTo] = new URL(doc.data.id);
  }

  if (isCardInstance(instance)) {
    if (!instance[meta] && doc.data.meta) {
      instance[meta] = doc.data.meta;
    }
  }
  return await _updateFromSerialized({
    instance,
    resource: doc.data,
    doc,
    store,
    opts,
  });
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
  store: CardStore = new FallbackCardStore(),
  opts?: DeserializeOpts,
): Promise<BaseInstanceType<T>> {
  let resource: LooseCardResource | undefined;
  if (isCardResource(data) || isFileMetaResource(data)) {
    resource = data as LooseCardResource;
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
  if (resource.id != null || resource.lid != null) {
    instance = store.get((resource.id ?? resource.lid)!) as
      | BaseInstanceType<T>
      | undefined;
  }
  if (!instance) {
    instance = new card({
      id: resource.id,
      [localId]: resource.lid,
    }) as BaseInstanceType<T>;
    instance[relativeTo] = _relativeTo;
  }
  stores.set(instance, store);
  return await _updateFromSerialized({
    instance,
    resource,
    doc,
    store,
    opts,
  });
}

async function _updateFromSerialized<T extends BaseDefConstructor>({
  instance,
  resource,
  doc,
  store,
  opts,
}: {
  instance: BaseInstanceType<T>;
  resource: LooseCardResource;
  doc: LooseSingleCardDocument | CardDocument;
  store: CardStore;
  opts?: DeserializeOpts;
}): Promise<BaseInstanceType<T>> {
  // because our store uses a tracked map for its identity map all the assembly
  // work that we are doing to deserialize the instance below is "live". so we
  // add the actual instance silently in a non-tracked way and only track it at
  // the very end.
  if (resource.id != null) {
    store.setNonTracked(resource.id, instance as CardDef);
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

  let existingOverrides = getFieldOverrides(instance);
  let loadedValues = getDataBucket(instance);
  let instanceRelativeTo =
    instance[relativeTo] ??
    ('id' in instance && typeof instance.id === 'string'
      ? new URL(instance.id)
      : undefined);

  function getFieldMeta(
    fieldsMeta: CardFields | undefined,
    key: string,
  ): Partial<Meta> | undefined {
    let entry = fieldsMeta?.[key];
    return Array.isArray(entry) ? undefined : entry;
  }

  function getFieldMetaArray(
    fieldsMeta: CardFields | undefined,
    key: string,
  ): Partial<Meta>[] | undefined {
    let entry = fieldsMeta?.[key];
    return Array.isArray(entry) ? entry : undefined;
  }
  function isAssignableToField(
    overrideCard: typeof BaseDef,
    fieldCard: typeof BaseDef,
  ): boolean {
    let current: typeof BaseDef | undefined = overrideCard;
    while (current) {
      if (current === fieldCard) {
        return true;
      }
      current = getAncestor(current) ?? undefined;
    }
    return false;
  }

  function applyFieldOverride(
    fieldName: string,
    overrideCard?: typeof BaseDef,
    field?: Field<typeof BaseDef, any>,
  ): boolean {
    if (!overrideCard) {
      return false;
    }
    if (
      field &&
      !isAssignableToField(overrideCard, field.card as typeof BaseDef)
    ) {
      return false;
    }
    if (existingOverrides.get(fieldName) === overrideCard) {
      return false;
    }
    existingOverrides.set(fieldName, overrideCard);
    return true;
  }
  async function setDeserializedFieldOverride(
    fieldName: string,
    resource: LooseCardResource,
    field: Field<typeof BaseDef, any>,
    serializedFieldOverride?: Partial<Meta>,
  ): Promise<boolean> {
    let overrideMeta = serializedFieldOverride;
    if (!overrideMeta) {
      overrideMeta = getFieldMeta(resource.meta?.fields, fieldName);
    }
    if (!overrideMeta || !overrideMeta.adoptsFrom) {
      return false;
    }
    let override = await loadCardDef(overrideMeta.adoptsFrom, {
      loader: myLoader(),
      // Prefer the deserialization context (instanceRelativeTo) so overrides resolve
      // relative to the document we fetched (e.g. catalog/index), then fall back to the resource id.
      relativeTo:
        instanceRelativeTo ??
        (resource.id && typeof resource.id === 'string'
          ? new URL(resource.id)
          : undefined),
    });
    if (!override) {
      return false;
    }
    return applyFieldOverride(fieldName, override, field);
  }

  function applyLinkOverrideFromValue(
    fieldName: string,
    field: Field<typeof BaseDef, any>,
    value: any,
  ): Field<typeof BaseDef, any> {
    let changed = false;
    if (field.fieldType === 'linksTo') {
      if (isCardInstance(value)) {
        changed = applyFieldOverride(
          fieldName,
          value.constructor as typeof BaseDef,
          field,
        );
      }
    } else if (field.fieldType === 'linksToMany') {
      if (Array.isArray(value)) {
        let linked = value.find((entry) => isCardInstance(entry));
        if (linked) {
          changed = applyFieldOverride(
            fieldName,
            linked.constructor as typeof BaseDef,
            field,
          );
        }
      }
    }
    if (changed) {
      return (getField(instance, fieldName) ?? field) as Field<T>;
    }
    return field;
  }

  let values = (await Promise.all(
    Object.entries({
      ...resource.attributes,
      ...nonNestedRelationships,
      ...linksToManyRelationships,
      ...(resource.id !== undefined ? { id: resource.id } : {}),
    }).map(async ([fieldName, value]) => {
      let field = getField(instance, fieldName);
      if (!field) {
        // This happens when the instance has a field that is not in the definition. It can happen when
        // instance or definition is updated and the other is not. In this case we will just ignore the
        // mismatch and try to serialize it anyway so that the client can see still see the instance data
        // and have a chance to fix it so that it adheres to the definition
        return [];
      }
      let resourceMetaFields = resource.meta?.fields;
      let overrideApplied = false;
      if (field.fieldType === 'containsMany') {
        if (primitive in field.card) {
          if (Array.isArray(value)) {
            for (let [index] of value.entries()) {
              let key = `${fieldName}.${index}`;
              overrideApplied =
                (await setDeserializedFieldOverride(
                  key,
                  resource,
                  field,
                  getFieldMeta(resourceMetaFields, key),
                )) || overrideApplied;
            }
          } else {
            overrideApplied =
              (await setDeserializedFieldOverride(
                fieldName,
                resource,
                field,
                getFieldMeta(resourceMetaFields, fieldName),
              )) || overrideApplied;
          }
        } else {
          let metas = getFieldMetaArray(resourceMetaFields, fieldName);
          if (metas) {
            for (let [index, meta] of metas.entries()) {
              overrideApplied =
                (await setDeserializedFieldOverride(
                  `${fieldName}.${index}`,
                  resource,
                  field,
                  meta,
                )) || overrideApplied;
            }
          }
        }
      } else if (field.fieldType === 'contains') {
        overrideApplied =
          (await setDeserializedFieldOverride(
            fieldName,
            resource,
            field,
            getFieldMeta(resourceMetaFields, fieldName),
          )) || overrideApplied;
      }
      if (overrideApplied) {
        field = (getField(instance, fieldName) ?? field) as Field<T>;
      }
      // Prefer the deserialization context ([relativeTo]) when available; fall back to the instance id
      let relativeToVal =
        instance[relativeTo] ??
        ('id' in instance && typeof instance.id === 'string'
          ? new URL(instance.id)
          : undefined);
      let deserializedValue = await getDeserializedValue({
        card,
        loadedValue: loadedValues.get(fieldName),
        fieldName,
        value,
        resource,
        modelPromise: deferred.promise,
        doc,
        store,
        relativeTo: relativeToVal,
        opts,
      });

      field = applyLinkOverrideFromValue(
        fieldName,
        field,
        deserializedValue,
      ) as Field<T>;
      return [field, deserializedValue];
    }),
  )) as [Field<T>, any][];

  let realmURLString =
    getCardMeta(instance as CardDef, 'realmURL') ?? resource.meta?.realmURL;

  // this block needs to be synchronous
  {
    let wasSaved = false;
    let originalId: string | undefined;
    if (isCardInstance(instance)) {
      wasSaved = instance[isSavedInstance];
      originalId = (instance as CardDef).id; // the instance is a composite card
      instance[isSavedInstance] = false;
    }
    let deserialized = getDataBucket(instance);

    for (let [field, value] of values) {
      if (!field) {
        continue;
      }
      if (field.name === 'id' && wasSaved && originalId !== value) {
        throw new Error(
          `cannot change the id for saved instance ${originalId}`,
        );
      }
      propagateRealmContext(value, realmURLString);
      field.validate(instance, value);

      // Before updating field's value, we also have to make sure
      // the subscribers also subscribes to a new value.
      let existingValue = deserialized.get(field.name as string);
      if (
        isCardOrField(existingValue) ||
        isArrayOfCardOrField(existingValue) ||
        isCardOrField(value) ||
        isArrayOfCardOrField(value)
      ) {
        applySubscribersToInstanceValue(instance, field, existingValue, value);
      }
      deserialized.set(field.name as string, value);
      field.captureQueryFieldSeedData?.(instance, value, resource);
    }

    // assign the realm meta before we compute as computeds may be relying on this
    if (isCardInstance(instance) && resource.id != null) {
      (instance as any)[meta] = resource.meta;
    }
    if (realmURLString && isFieldInstance(instance)) {
      setRealmContextOnField(instance, realmURLString);
    }
    notifyCardTracking(instance);
    if (isCardInstance(instance) && resource.id != null) {
      // importantly, we place this synchronously after the assignment of the model's
      // fields, such that subsequent assignment of the id field when the model is
      // saved will throw
      instance[isSavedInstance] = true;
    }
  }

  // now we make the instance "live" after it's all constructed
  if (resource.id != null) {
    store.makeTracked(resource.id);
  }

  deferred.fulfill(instance);
  return instance;
}

export function setCardAsSavedForTest(instance: CardDef, id?: string): void {
  if (id != null) {
    let deserialized = getDataBucket(instance);
    deserialized.set('id', id);
  }
  instance[isSavedInstance] = true;
}

export function searchDoc<CardT extends BaseDefConstructor>(
  instance: InstanceType<CardT>,
): Record<string, any> {
  return getQueryableValue(instance.constructor, instance) as Record<
    string,
    any
  >;
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
        (field.card as typeof BaseDef) === ReadOnlyField &&
        isCardInstance(this) &&
        this[isSavedInstance]
      ) {
        throw new Error(
          `cannot assign a value to the field '${
            field.name
          }' on the saved card '${
            (this as any)[field.name]
          }' because it is a read-only field`,
        );
      }
      setField(this, field, value);
    };
  }
  (descriptor.get as any)[isField] = field;
  return descriptor;
}

function setField(instance: BaseDef, field: Field, value: any) {
  propagateRealmContext(value, instance);
  // TODO: refactor validate to not have a return value and accomplish this normalization another way
  value = field.validate(instance, value);
  let deserialized = getDataBucket(instance);
  deserialized.set(field.name, value);
  notifySubscribers(instance, field.name, value);
  notifyCardTracking(instance);
}

function notifySubscribers(
  instance: BaseDef,
  fieldName: string,
  value: any,
  visited = new WeakSet<BaseDef>(),
) {
  if (visited.has(instance)) {
    return;
  }
  visited.add(instance);
  let changeSubscribers = subscribers.get(instance);
  if (changeSubscribers) {
    for (let subscriber of changeSubscribers) {
      subscriber(instance, fieldName, value);
    }
  }
  let consumer = subscriberConsumer.get(instance);
  if (consumer) {
    notifySubscribers(
      consumer.fieldOrCard,
      `${consumer.fieldName}.${fieldName}`,
      value,
      visited,
    );
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
    createCard?: CreateCardFn;
    viewCard?: ViewCardFn;
    editCard?: EditCardFn;
    saveCard?: SaveCardFn;
    canEdit?: boolean;
    configuration?: FieldConfiguration | undefined;
  };
};

export function getComponent(
  model: BaseDef,
  field?: Field,
  opts?: { componentCodeRef?: CodeRef },
): BoxComponent {
  let box = Box.create(model);
  let boxComponent = getBoxComponent(
    model.constructor as BaseDefConstructor,
    box,
    field,
    opts,
  );
  return boxComponent;
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
        fieldName: string;
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
      if (Array.isArray(value)) {
        let index = parseInt(this.state.fieldName);
        if (typeof index !== 'number') {
          throw new Error(
            `Cannot set a value on an array item with non-numeric index '${String(
              this.state.fieldName,
            )}'`,
          );
        }
        this.state.containingBox.value[index] = v;
        return;
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
        fieldName: fieldName as string,
        useIndexBasedKeys,
      });
      this.fieldBoxes.set(fieldName as string, box);
    }
    return box as Box<T[K]>;
  }

  private prevChildren: Box<ElementType<T>>[] = [];
  private prevValues: ElementType<T>[] = [];

  get children(): Box<ElementType<T>>[] {
    if (this.state.type === 'root') {
      throw new Error('tried to call children() on root box');
    }
    let value = this.value;
    if (value == null) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new Error(
        `tried to call children() on Boxed non-array value ${value} for ${String(
          this.state.fieldName,
        )}`,
      );
    }

    let { prevChildren, prevValues, state } = this;
    let newChildren: Box<ElementType<T>>[] = value.map((element, index) => {
      let found = prevChildren.find((_oldBox, i) =>
        state.useIndexBasedKeys ? index === i : this.prevValues[i] === element,
      );
      if (found) {
        if (state.useIndexBasedKeys) {
          // note that the underlying box already has the correct value so there
          // is nothing to do in this case. also, we are currently inside a rerender.
          // mutating a watched array in a rerender will spawn another rerender which
          // infinitely recurses.
        } else {
          let toRemoveIndex = prevChildren.indexOf(found);
          prevChildren.splice(toRemoveIndex, 1);
          prevValues.splice(toRemoveIndex, 1);
          if (found.state.type === 'root') {
            throw new Error('bug');
          }
          found.state.fieldName = String(index);
        }
        return found;
      } else {
        return new Box({
          type: 'derived',
          containingBox: this,
          fieldName: String(index),
          useIndexBasedKeys: false,
        });
      }
    });
    this.prevChildren = newChildren;
    this.prevValues = value.slice();
    return newChildren;
  }
}

type ElementType<T> = T extends (infer V)[] ? V : never;

declare module 'ember-provide-consume-context/context-registry' {
  export default interface ContextRegistry {
    [CardContextName]: CardContext;
  }
}

function getStore(instance: BaseDef): CardStore {
  return stores.get(instance as BaseDef) ?? new FallbackCardStore();
}

function myLoader(): Loader {
  // we know this code is always loaded by an instance of our Loader, which sets
  // import.meta.loader.

  // When type-checking realm-server, tsc sees this file and thinks
  // it will be transpiled to CommonJS and so it complains about this line. But
  // this file is always loaded through our loader and always has access to import.meta.
  // @ts-ignore
  return (import.meta as any).loader;
}

class FallbackCardStore implements CardStore {
  #instances: Map<string, CardDef> = new Map();
  #inFlight: Set<Promise<unknown>> = new Set();
  #loadGeneration = 0; // mirrors host store tracking to detect new loads

  get(id: string) {
    id = id.replace(/\.json$/, '');
    return this.#instances.get(id);
  }
  set(id: string, instance: CardDef) {
    id = id.replace(/\.json$/, '');
    return this.#instances.set(id, instance);
  }
  setNonTracked(id: string, instance: CardDef) {
    id = id.replace(/\.json$/, '');
    return this.#instances.set(id, instance);
  }
  makeTracked(_id: string) {}
  trackLoad(load: Promise<unknown>) {
    if (this.#inFlight.has(load)) {
      return;
    }
    this.#inFlight.add(load);
    this.#loadGeneration++;
    load.finally(() => {
      this.#inFlight.delete(load);
    });
  }
  async loaded() {
    let observedGeneration = this.#loadGeneration;
    while (true) {
      if (this.#inFlight.size === 0) {
        await Promise.resolve();
      } else {
        let pendingLoads = Array.from(this.#inFlight);
        await Promise.allSettled(pendingLoads);
      }
      if (
        this.#inFlight.size === 0 &&
        this.#loadGeneration === observedGeneration
      ) {
        return;
      }
      observedGeneration = this.#loadGeneration;
    }
  }
  async loadCardDocument(url: string) {
    let promise = loadCardDocument(fetch, url);
    this.trackLoad(promise);
    return await promise;
  }

  async loadFileMetaDocument(url: string) {
    let promise = loadFileMetaDocument(fetch, url);
    this.trackLoad(promise);
    return await promise;
  }

  getSearchResource<T extends CardDef = CardDef>(
    _parent: object,
    _getQuery: () => any,
    _getRealms?: () => string[] | undefined,
    _opts?: any,
  ): StoreSearchResource<T> {
    throw new Error('Method not implemented.');
  }
}
