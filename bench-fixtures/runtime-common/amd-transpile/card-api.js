import GlimmerComponent from '@glimmer/component';
import { isEqual } from 'lodash';
import { WatchedArray } from './watched-array';
import { BoxelInput, CopyButton } from '@cardstack/boxel-ui/components';
import { markdownEscape, not } from '@cardstack/boxel-ui/helpers';
import { getBoxComponent, CardCrudFunctionsConsumer, DefaultFormatsConsumer } from './field-component';
import { getContainsManyComponent } from './contains-many-component';
import { LinksToEditor } from './links-to-editor';
import { getLinksToManyComponent } from './links-to-many-component';
import { assertIsSerializerName, baseRef, CardContextName, Deferred, byteStreamToUint8Array, fields, fieldSerializer, fieldsUntracked, formats, getAncestor, getMenuItems, getField, getSerializer, humanReadable, identifyCard, inferContentType, isBaseInstance, isCardError, isCardInstance as _isCardInstance, isCardResource, isFileMetaResource, isFileDef, isField, isFieldInstance, isRelationship, loadCardDef, loadCardDocument, Loader, localId, meta, primitive, realmURL, relativeTo, uuidv4, NumberSerializer, FileMetaResourceType, CardResourceType, loadFileMetaDocument, trackRuntimeFileDependency, trackRuntimeInstanceDependency, trackRuntimeModuleDependency, runtimeNonQueryDependencyContext, runtimeQueryDependencyContext, resolveCardReference, cardIdToURL } from '@cardstack/runtime-common';
import { captureQueryFieldSeedData, ensureQueryFieldSearchResource, validateRelationshipQuery } from './query-field-support';
import { isSavedInstance } from './-private';
import { initSharedState } from './shared-state';
import DefaultFittedTemplate from './default-templates/fitted';
import DefaultEmbeddedTemplate from './default-templates/embedded';
import DefaultCardDefTemplate from './default-templates/isolated-and-edit';
import DefaultAtomViewTemplate from './default-templates/atom';
import DefaultHeadTemplate from './default-templates/head';
import MissingTemplate from './default-templates/missing-template';
import FieldDefEditTemplate from './default-templates/field-edit';
import MarkdownTemplate from './default-templates/markdown';
import DefaultMarkdownFallbackTemplate from './default-templates/markdown-fallback';
import { markdownImage } from './markdown-helpers';
import FileDefEditTemplate from './default-templates/file-def-edit';
import ImageDefAtomTemplate from './default-templates/image-def-atom';
import ImageDefEmbeddedTemplate from './default-templates/image-def-embedded';
import ImageDefFittedTemplate from './default-templates/image-def-fitted';
import ImageDefIsolatedTemplate from './default-templates/image-def-isolated';
import CaptionsIcon from '@cardstack/boxel-icons/captions';
import FileIcon from '@cardstack/boxel-icons/file';
import LetterCaseIcon from '@cardstack/boxel-icons/letter-case';
import MarkdownIcon from '@cardstack/boxel-icons/align-box-left-middle';
import RectangleEllipsisIcon from '@cardstack/boxel-icons/rectangle-ellipsis';
import TextAreaIcon from '@cardstack/boxel-icons/align-left';
import ThemeIcon from '@cardstack/boxel-icons/palette';
import ImportIcon from '@cardstack/boxel-icons/import';
import FilePencilIcon from '@cardstack/boxel-icons/file-pencil';
import WandIcon from '@cardstack/boxel-icons/wand';
import HashIcon from '@cardstack/boxel-icons/hash';
// normalizeEnumOptions used by enum moved to packages/base/enum.gts
import PatchThemeCommand from '@cardstack/boxel-host/commands/patch-theme';
import CopyAndEditCommand from '@cardstack/boxel-host/commands/copy-and-edit';
import { md5 } from 'super-fast-md5';
import { callSerializeHook, cardClassFromResource, deserialize, makeMetaForField, makeRelativeURL, serialize, serializeCard, serializeCardResource, serializeFileDef, resourceFrom, getCardMeta } from './card-serialization';
import { assertScalar, entangleWithCardTracking, getDataBucket, getFieldDescription, getFieldOverrides, getFields, getter, isArrayOfCardOrField, isCard, isCardOrField, isNotLoadedValue, notifyCardTracking, peekAtField, propagateRealmContext, realmContext, relationshipMeta, setFieldDescription, setRealmContextOnField } from './field-support';
import { TextInputValidator } from './text-input-validator';
import { getDefaultCardMenuItems } from './menu-items';
import { getDefaultFileMenuItems } from './file-menu-items';
import { setComponentTemplate } from "@ember/component";
import { createTemplateFactory } from "@ember/template-factory";
import "./card-api.gts.CiAgLmNzcy1maWVsZC1jb250YWluZXJbZGF0YS1zY29wZWRjc3MtM2QyZmM5ZTQwZS05OGI3N2FiNzE2XSB7CiAgICAtLWZpZWxkLWJnOiB2YXIoLS1jYXJkLCB2YXIoLS1ib3hlbC0xMDApKTsKICAgIC0tZmllbGQtZmc6IHZhcigtLWNhcmQtZm9yZWdyb3VuZCwgdmFyKC0tYm94ZWwtZGFyaykpOwogICAgLS1maWVsZC1ib3JkZXI6IHZhcigKICAgICAgLS1ib3JkZXIsCiAgICAgIGNvbG9yLW1peChpbiBva2xhYiwgdmFyKC0tZmllbGQtZmcpIDIwJSwgdmFyKC0tZmllbGQtYmcpKQogICAgKTsKICAgIHBvc2l0aW9uOiByZWxhdGl2ZTsKICB9CiAgLmNzcy1maWVsZC1jb3B5LWJ1dHRvbltkYXRhLXNjb3BlZGNzcy0zZDJmYzllNDBlLTk4Yjc3YWI3MTZdIHsKICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTsKICAgIHRvcDogdmFyKC0tYm94ZWwtc3AteHMpOwogICAgcmlnaHQ6IHZhcigtLWJveGVsLXNwLXhzKTsKICB9CiAgLmNzcy1maWVsZFtkYXRhLXNjb3BlZGNzcy0zZDJmYzllNDBlLTk4Yjc3YWI3MTZdIHsKICAgIG1hcmdpbi1ibG9jazogMDsKICAgIHBhZGRpbmc6IHZhcigtLWJveGVsLXNwKTsKICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWZpZWxkLWJnKTsKICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWZpZWxkLWJvcmRlcik7CiAgICBib3JkZXItcmFkaXVzOiB2YXIoLS1yYWRpdXMsIHZhcigtLWJveGVsLWJvcmRlci1yYWRpdXMpKTsKICAgIGNvbG9yOiB2YXIoLS1maWVsZC1mZyk7CiAgICBmb250LWZhbWlseTogdmFyKAogICAgICAtLWZvbnQtbW9ubywKICAgICAgdmFyKC0tYm94ZWwtbW9ub3NwYWNlLWZvbnQtZmFtaWx5LCBtb25vc3BhY2UpCiAgICApOwogICAgZm9udC1zaXplOiB2YXIoLS1ib3hlbC1mb250LXNpemUteHMpOwogICAgd2hpdGUtc3BhY2U6IHByZS13cmFwOwogIH0KICAuY3NzLWZpZWxkW2RhdGEtc2NvcGVkY3NzLTNkMmZjOWU0MGUtOThiNzdhYjcxNl06OnBsYWNlaG9sZGVyIHsKICAgIG9wYWNpdHk6IDAuNTsKICB9Cg%3D%3D.glimmer-scoped.css";
export const BULK_GENERATED_ITEM_COUNT = 3;
export { deserialize, getCardMeta, getDataBucket, getFieldDescription, getFields, peekAtField, isCard, isField, isFileDef, localId, meta, primitive, realmURL, relativeTo, relationshipMeta, serialize, serializeCard, serializeFileDef, ensureQueryFieldSearchResource, getStore };
export const useIndexBasedKey = Symbol.for('cardstack-use-index-based-key');
export const fieldDecorator = Symbol.for('cardstack-field-decorator');
export const queryableValue = Symbol.for('cardstack-queryable-value');
export const formatQuery = Symbol.for('cardstack-format-query');
export const realmInfo = Symbol.for('cardstack-realm-info');
export const emptyValue = Symbol.for('cardstack-empty-value');

// this is expressing the idea that the fields of a
// card may contain undefined, but even when that's
// true all the symbols and the `constructor` property
// can still be relied on.

export { formats };

// Opaque configuration passed to field format components and validators

// Configuration may be provided as a static object or a function of the parent instance

const stores = initSharedState('stores', () => new WeakMap());
const subscribers = initSharedState('subscribers', () => new WeakMap());
const subscriberConsumer = initSharedState('subscriberConsumer', () => new WeakMap());
const inflightLinkLoads = initSharedState('inflightLinkLoads', () => new WeakMap());
export function instanceOf(instance, clazz) {
  let instanceClazz = instance.constructor;
  let codeRefInstance;
  let codeRefClazz = identifyCard(clazz);
  if (!codeRefClazz) {
    return instance instanceof clazz;
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
  promises = [];
  // TODO this doesn't look like it's used anymore. in the past this was used to
  // keep track of async when eagerly running computes after a property had been set.
  // consider removing this.
  log(promise) {
    this.promises.push(promise);
    // make an effort to resolve the promise at the time it is logged
    (async () => {
      try {
        await promise;
      } catch (e) {
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
function cardTypeFor(field, boxedElement, overrides) {
  let override;
  if (overrides) {
    let valueKey = `${field.name}${boxedElement ? '.' + boxedElement.name : ''}`;
    override = boxedElement?.value ? overrides()?.get(valueKey) : undefined;
  } else {
    override = boxedElement?.value && typeof boxedElement.value === 'object' ? getFieldOverrides(boxedElement.value)?.get(field.name) : undefined;
  }
  if (primitive in field.card) {
    return override ?? field.card;
  }
  if (boxedElement === undefined || boxedElement.value == null) {
    return field.card;
  }
  return Reflect.getPrototypeOf(boxedElement.value).constructor;
}
function assertNoDeserializeOverride(cardClass) {
  if (!(primitive in cardClass) && Object.prototype.hasOwnProperty.call(cardClass, deserialize)) {
    throw new Error(`${cardClass.name} overrides [deserialize] directly. Composite fields must use a registered fieldSerializer instead.`);
  }
}
class ContainsMany {
  fieldType = 'containsMany';
  cardThunk;
  computeVia;
  name;
  description;
  isUsed;
  isPolymorphic;
  configuration;
  constructor({
    cardThunk,
    computeVia,
    name,
    isUsed,
    isPolymorphic
  }) {
    this.cardThunk = cardThunk;
    this.computeVia = computeVia;
    this.name = name;
    this.isUsed = isUsed;
    this.isPolymorphic = isPolymorphic;
  }
  get card() {
    return this.cardThunk();
  }
  getter(instance) {
    let deserialized = getDataBucket(instance);
    entangleWithCardTracking(instance);
    let maybeNotLoaded = deserialized.get(this.name);
    // a not loaded error can blow up thru a computed containsMany field that consumes a link
    if (isNotLoadedValue(maybeNotLoaded)) {
      lazilyLoadLink(instance, this, maybeNotLoaded.reference);
      return this.emptyValue(instance);
    }
    let results = getter(instance, this);
    propagateRealmContext(results, instance);
    return results;
  }
  queryableValue(instances, stack) {
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
    let results = [...instances].map(instance => {
      return this.card[queryableValue](instance, stack);
    }).filter(i => i != null);
    return results.length === 0 ? null : results;
  }
  serialize(values, doc, _visited, opts) {
    // this can be a not loaded value happen when the containsMany is a
    // computed that consumes a linkTo field that is not loaded
    if (isNotLoadedValue(values)) {
      return {
        attributes: {}
      };
    }
    let serialized = values === null ? null : values.map(value => callSerializeHook(this.card, value, doc, undefined, opts));
    if (primitive in this.card) {
      if (opts?.overrides) {
        let meta = {};
        if (Array.isArray(serialized)) {
          for (let [index] of serialized.entries()) {
            let fieldName = `${this.name}.${index}`;
            let override = opts.overrides.get(fieldName);
            if (!override) {
              continue;
            }
            meta.fields = meta.fields ?? {};
            meta.fields[fieldName] = {
              adoptsFrom: identifyCard(override, opts?.useAbsoluteURL ? undefined : opts?.maybeRelativeURL)
            };
          }
        }
        return {
          attributes: {
            [this.name]: serialized
          },
          meta
        };
      } else {
        return {
          attributes: {
            [this.name]: serialized
          }
        };
      }
    } else {
      let relationships = {};
      let serialized = values === null ? null : values.map((value, index) => {
        let resource = callSerializeHook(this.card, value, doc, undefined, opts);
        if (resource.relationships) {
          for (let [fieldName, relationship] of Object.entries(resource.relationships)) {
            relationships[`${this.name}.${index}.${fieldName}`] = relationship; // warning side-effect
          }
        }
        if (this.card === Reflect.getPrototypeOf(value).constructor) {
          // when our implementation matches the default we don't need to include
          // meta.adoptsFrom
          delete resource.meta?.adoptsFrom;
        }
        if (resource.meta && Object.keys(resource.meta).length === 0) {
          delete resource.meta;
        }
        return resource;
      });
      let result = {
        attributes: {
          [this.name]: serialized === null ? null : serialized.map(resource => resource.attributes)
        }
      };
      if (Object.keys(relationships).length > 0) {
        result.relationships = relationships;
      }
      if (serialized && serialized.some(resource => resource.meta)) {
        result.meta = {
          fields: {
            [this.name]: serialized.map(resource => resource.meta ?? {})
          }
        };
      }
      return result;
    }
  }
  async deserialize(value, doc, relationships, fieldMeta, store, instancePromise, _loadedValue, relativeTo, opts) {
    if (value == null) {
      return null;
    }
    if (!Array.isArray(value)) {
      throw new Error(`Expected array for field value ${this.name}`);
    }
    if (fieldMeta && !Array.isArray(fieldMeta)) {
      throw new Error(`fieldMeta for contains-many field '${this.name}' is not an array: ${JSON.stringify(fieldMeta, null, 2)}`);
    }
    let metas = fieldMeta ?? [];
    return new WatchedArray((prevArrayValue, arrayValue) => instancePromise.then(instance => {
      applySubscribersToInstanceValue(instance, this, prevArrayValue, arrayValue);
      notifySubscribers(instance, field.name, arrayValue);
      notifyCardTracking(instance);
    }), await Promise.all(value.map(async (entry, index) => {
      if (primitive in this.card) {
        if (fieldSerializer in this.card) {
          assertIsSerializerName(this.card[fieldSerializer]);
          let serializer = getSerializer(this.card[fieldSerializer]);
          return serializer.deserialize(entry, relativeTo, doc, store, opts);
        }
        return entry;
      } else {
        if (fieldSerializer in this.card) {
          assertIsSerializerName(this.card[fieldSerializer]);
          let serializer = getSerializer(this.card[fieldSerializer]);
          entry = await serializer.deserialize(entry, relativeTo, doc, store, opts);
        }
        let meta = metas[index];
        let resource = {
          attributes: entry,
          meta: makeMetaForField(meta, this.name, this.card)
        };
        if (relationships) {
          resource.relationships = Object.fromEntries(Object.entries(relationships).filter(([fieldName]) => fieldName.startsWith(`${this.name}.`)).map(([fieldName, relationship]) => {
            let relName = `${this.name}.${index}`;
            return [fieldName.startsWith(`${relName}.`) ? fieldName.substring(relName.length + 1) : fieldName, relationship];
          }));
        }
        let cardClass = await cardClassFromResource(resource, this.card, relativeTo);
        assertNoDeserializeOverride(cardClass);
        return cardClass[deserialize](resource, relativeTo, doc, store, opts);
      }
    })));
  }
  emptyValue(instance) {
    return new WatchedArray((oldValue, value) => {
      applySubscribersToInstanceValue(instance, this, oldValue, value);
      notifySubscribers(instance, this.name, value);
      notifyCardTracking(instance);
    });
  }
  validate(instance, values) {
    if (values && !Array.isArray(values)) {
      throw new Error(`field validation error: Expected array for field value of field '${this.name}'`);
    }
    if (values == null) {
      return values;
    }
    if (!(primitive in this.card)) {
      for (let [index, item] of values.entries()) {
        if (item != null && !instanceOf(item, this.card)) {
          throw new Error(`field validation error: tried set instance of ${values.constructor.name} at index ${index} of field '${this.name}' but it is not an instance of ${this.card.name}`);
        }
      }
    }
    return new WatchedArray((oldValue, value) => {
      applySubscribersToInstanceValue(instance, this, oldValue, value);
      notifySubscribers(instance, this.name, value);
      notifyCardTracking(instance);
    }, values);
  }
  component(model) {
    let fieldName = this.name;
    let arrayField = model.field(fieldName, useIndexBasedKey in this.card);
    return getContainsManyComponent({
      model,
      arrayField,
      field: this,
      cardTypeFor
    });
  }
}
class Contains {
  fieldType = 'contains';
  cardThunk;
  computeVia;
  name;
  description;
  isUsed;
  isPolymorphic;
  configuration;
  constructor({
    cardThunk,
    computeVia,
    name,
    isUsed,
    isPolymorphic
  }) {
    this.cardThunk = cardThunk;
    this.computeVia = computeVia;
    this.name = name;
    this.isUsed = isUsed;
    this.isPolymorphic = isPolymorphic;
  }
  get card() {
    return this.cardThunk();
  }
  getter(instance) {
    let deserialized = getDataBucket(instance);
    entangleWithCardTracking(instance);
    let maybeNotLoaded = deserialized.get(this.name);
    // a not loaded error can blow up thru a computed contains field that consumes a link
    if (isNotLoadedValue(maybeNotLoaded)) {
      lazilyLoadLink(instance, this, maybeNotLoaded.reference);
      return undefined;
    }
    let value = getter(instance, this);
    propagateRealmContext(value, instance);
    return value;
  }
  queryableValue(instance, stack) {
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
  serialize(value, doc, _visited, opts) {
    // this can be a not loaded value happen when the contains is a
    // computed that consumes a linkTo field that is not loaded
    if (isNotLoadedValue(value)) {
      return {
        attributes: {}
      };
    }
    if (primitive in this.card) {
      let serialized = callSerializeHook(this.card, value, doc, undefined, opts);
      if (this.isPolymorphic) {
        return {
          attributes: {
            [this.name]: serialized
          },
          meta: {
            fields: {
              [this.name]: {
                adoptsFrom: identifyCard(this.card, opts?.useAbsoluteURL ? undefined : opts?.maybeRelativeURL)
              }
            }
          }
        };
      } else {
        return {
          attributes: {
            [this.name]: serialized
          }
        };
      }
    } else {
      let serialized = callSerializeHook(this.card, value, doc);
      let resource = {
        attributes: {
          [this.name]: serialized?.attributes
        }
      };
      if (serialized == null) {
        return resource;
      }
      if (serialized.relationships) {
        resource.relationships = {};
        for (let [fieldName, relationship] of Object.entries(serialized.relationships)) {
          resource.relationships[`${this.name}.${fieldName}`] = relationship;
        }
      }
      if (this.card === Reflect.getPrototypeOf(value).constructor && !this.isPolymorphic) {
        // when our implementation matches the default we don't need to include
        // meta.adoptsFrom
        delete serialized.meta.adoptsFrom;
      }
      if (Object.keys(serialized.meta).length > 0) {
        resource.meta = {
          fields: {
            [this.name]: serialized.meta
          }
        };
      }
      return resource;
    }
  }
  async deserialize(value, doc, relationships, fieldMeta, store, _instancePromise, _loadedValue, relativeTo, opts) {
    if (primitive in this.card) {
      if (fieldSerializer in this.card) {
        assertIsSerializerName(this.card[fieldSerializer]);
        let serializer = getSerializer(this.card[fieldSerializer]);
        return serializer.deserialize(value, relativeTo, doc, store, opts);
      }
      return value;
    }
    if (fieldSerializer in this.card) {
      assertIsSerializerName(this.card[fieldSerializer]);
      let serializer = getSerializer(this.card[fieldSerializer]);
      value = await serializer.deserialize(value, relativeTo, doc, store, opts);
    }
    if (fieldMeta && Array.isArray(fieldMeta)) {
      throw new Error(`fieldMeta for contains field '${this.name}' is an array: ${JSON.stringify(fieldMeta, null, 2)}`);
    }
    let meta = fieldMeta;
    let resource = {
      attributes: value,
      meta: makeMetaForField(meta, this.name, this.card)
    };
    if (relationships) {
      resource.relationships = Object.fromEntries(Object.entries(relationships).filter(([fieldName]) => fieldName.startsWith(`${this.name}.`)).map(([fieldName, relationship]) => [fieldName.startsWith(`${this.name}.`) ? fieldName.substring(this.name.length + 1) : fieldName, relationship]));
    }
    let cardClass = await cardClassFromResource(resource, this.card, relativeTo);
    assertNoDeserializeOverride(cardClass);
    return cardClass[deserialize](resource, relativeTo, doc, store, opts);
  }
  emptyValue(_instance) {
    if (primitive in this.card) {
      return this.card[emptyValue];
    } else {
      return new this.card();
    }
  }
  validate(_instance, value) {
    if (!(primitive in this.card)) {
      let expectedCard = this.card;
      if (value != null && !instanceOf(value, expectedCard)) {
        throw new Error(`field validation error: tried set instance of ${value.constructor.name} as field '${this.name}' but it is not an instance of ${expectedCard.name}`);
      }
    }
    return value;
  }
  component(model) {
    return fieldComponent(this, model);
  }
}
class LinksTo {
  fieldType = 'linksTo';
  cardThunk;
  declaredCardThunk;
  computeVia;
  name;
  description;
  isUsed;
  isPolymorphic;
  configuration;
  queryDefinition;
  constructor({
    cardThunk,
    declaredCardThunk,
    computeVia,
    name,
    isUsed,
    isPolymorphic,
    queryDefinition
  }) {
    this.cardThunk = cardThunk;
    this.declaredCardThunk = declaredCardThunk ?? cardThunk;
    this.computeVia = computeVia;
    this.name = name;
    this.isUsed = isUsed;
    this.isPolymorphic = isPolymorphic;
    this.queryDefinition = queryDefinition;
  }
  get card() {
    return this.cardThunk();
  }
  get declaredCardResolver() {
    return this.declaredCardThunk;
  }
  getter(instance) {
    let deserialized = getDataBucket(instance);
    entangleWithCardTracking(instance);
    if (this.queryDefinition) {
      let dependencyTrackingContext = runtimeQueryDependencyContext({
        queryField: this.name,
        consumer: instance.id,
        source: 'card-api:linksTo:getter'
      });
      let searchResource = ensureQueryFieldSearchResource(getStore(instance), instance, this, dependencyTrackingContext);
      let records = searchResource?.instances ?? [];
      let value = records[0];
      trackRuntimeRelationshipDependency(value, this.card, dependencyTrackingContext);
      return value;
    }
    let maybeNotLoaded = deserialized.get(this.name);
    if (isNotLoadedValue(maybeNotLoaded)) {
      lazilyLoadLink(instance, this, maybeNotLoaded.reference);
      return undefined;
    }
    let value = getter(instance, this);
    trackRuntimeRelationshipDependency(value, this.card);
    return value;
  }
  queryableValue(instance, stack) {
    if (primitive in this.card) {
      throw new Error(`the linksTo field '${this.name}' contains a primitive card '${this.card.name}'`);
    }
    if (instance == null) {
      return null;
    }
    return this.card[queryableValue](instance, stack);
  }
  serialize(value, doc, visited, opts) {
    let relationshipType = isFileDef(this.card) ? FileMetaResourceType : CardResourceType;
    if (isNotLoadedValue(value)) {
      return {
        relationships: {
          [this.name]: {
            links: {
              self: makeRelativeURL(value.reference, opts)
            },
            data: {
              type: relationshipType,
              id: value.reference
            }
          }
        }
      };
    }
    if (value == null) {
      return {
        relationships: {
          [this.name]: {
            links: {
              self: null
            }
          }
        }
      };
    }
    if (isFileDef(this.card) && !value.id) {
      throw new Error(`linksTo field '${this.name}' cannot serialize a FileDef without an id`);
    }
    if (visited.has(value.id)) {
      return {
        relationships: {
          [this.name]: {
            links: {
              self: makeRelativeURL(value.id, opts)
            },
            data: {
              type: relationshipType,
              id: value.id
            }
          }
        }
      };
    }
    if (visited.has(value[localId])) {
      return {
        relationships: {
          [this.name]: {
            data: {
              type: relationshipType,
              lid: value[localId]
            }
          }
        }
      };
    }
    visited.add(value.id ?? value[localId]);
    let serialized = callSerializeHook(this.card, value, doc, visited, opts);
    if (serialized) {
      let resource = {
        relationships: {
          [this.name]: {
            ...(value.id ? {
              links: {
                self: makeRelativeURL(value.id, opts)
              },
              data: {
                type: relationshipType,
                id: value.id
              }
            } : {
              data: {
                type: relationshipType,
                lid: value[localId]
              }
            })
          }
        }
      };
      if (!(doc.included ?? []).find(r => 'id' in r && r.id === value.id) && doc.data.id !== value.id || !value.id && !(doc.included ?? []).find(r => 'lid' in r && r.lid === value[localId]) && doc.data.lid !== value[localId]) {
        doc.included = doc.included ?? [];
        doc.included.push(serialized);
      }
      return resource;
    }
    return {
      relationships: {
        [this.name]: {
          links: {
            self: null
          }
        }
      }
    };
  }
  async deserialize(value, doc, _relationships, _fieldMeta, store, _instancePromise, loadedValue, relativeTo, opts) {
    if (!isRelationship(value)) {
      throw new Error(`linkTo field '${this.name}' cannot deserialize non-relationship value ${JSON.stringify(value)}`);
    }
    if (Array.isArray(value.data)) {
      throw new Error(`linksTo field '${this.name}' cannot deserialize a list of resource ids`);
    }
    let resourceId = value.data && 'id' in value.data ? value.data?.id : undefined;
    let reference = value.links?.self ?? resourceId;
    if (reference == null || reference === '') {
      return null;
    }
    let href = resolveCardReference(reference, relativeTo);
    let cachedInstance = isFileDef(this.card) ? store.getFileMeta(href) : store.getCard(href);
    if (cachedInstance && instanceOf(cachedInstance, this.card)) {
      cachedInstance[isSavedInstance] = true;
      return cachedInstance;
    }
    //links.self is used to tell the consumer of this payload how to get the resource via HTTP. data.id is used to tell the
    //consumer of this payload how to get the resource from the side loaded included bucket. we need to strictly only
    //consider data.id when calling the resourceFrom() function (which actually loads the resource out of the included
    //bucket). we should never used links.self as part of that consideration. If there is a missing data.id in the resource entity
    //that means that the serialization is incorrect and is not JSON-API compliant.
    let resource = resourceId != null ? resourceFrom(doc, resourceId) : undefined;
    if (!resource) {
      if (loadedValue !== undefined) {
        return loadedValue;
      }
      return {
        type: 'not-loaded',
        reference
      };
    }
    let clazz = await cardClassFromResource(resource, this.card, relativeTo);
    let deserialized = await clazz[deserialize](resource, relativeTo, doc, store, opts);
    if ('isSavedInstance' in deserialized) {
      deserialized[isSavedInstance] = true;
    }
    return deserialized;
  }
  emptyValue(_instance) {
    return null;
  }
  validate(_instance, value) {
    // we can't actually place this in the constructor since that would break cards whose field type is themselves
    // so the next opportunity we have to test this scenario is during field assignment
    if (primitive in this.card) {
      throw new Error(`field validation error: the linksTo field '${this.name}' contains a primitive card '${this.card.name}'`);
    }
    if (value) {
      if (isNotLoadedValue(value)) {
        return value;
      }
      if (isFileDef(this.card) && !value.id) {
        throw new Error(`field validation error: the linksTo field '${this.name}' cannot reference a FileDef without an id`);
      }
      if (!instanceOf(value, this.card)) {
        console.warn('linksTo instance mismatch', JSON.stringify({
          expected: identifyCard(this.card),
          actual: identifyCard(value.constructor)
        }));
        throw new Error(`field validation error: tried set ${value.constructor.name} as field '${this.name}' but it is not an instance of ${this.card.name}`);
      }
    }
    return value;
  }
  captureQueryFieldSeedData(instance, value, resource) {
    if (this.queryDefinition) {
      captureQueryFieldSeedData(instance, this.name, value ? [value] : [], resource);
    }
  }
  component(model) {
    let isComputed = !!this.computeVia || !!this.queryDefinition;
    let fieldName = this.name;
    let linksToField = this;
    let getInnerModel = () => {
      let innerModel = model.field(fieldName);
      return innerModel;
    };
    let isFileDefField = isFileDef(linksToField.card);
    function shouldRenderEditor(format, defaultFormat, isComputed) {
      return (format ?? defaultFormat) === 'edit' && !isComputed;
    }
    function getChildFormat(format, defaultFormat, model, isFileDefField) {
      let effectiveFormat = format ?? defaultFormat;
      if (effectiveFormat === 'edit' && ('isCardDef' in model.value.constructor && model.value.constructor.isCardDef || isFileDefField)) {
        return 'fitted';
      }
      return effectiveFormat;
    }
    return class LinksToComponent extends GlimmerComponent {
      static {
        setComponentTemplate(createTemplateFactory(
        /*
          <CardCrudFunctionsConsumer as |cardCrudFunctions|>
          <DefaultFormatsConsumer as |defaultFormats|>
            {{#if
              (shouldRenderEditor @format defaultFormats.cardDef isComputed)
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
        */
        {
          "id": "fqBLOyuE",
          "block": "[[[8,[32,0],null,null,[[\"default\"],[[[[1,\"\\n  \"],[8,[32,1],null,null,[[\"default\"],[[[[1,\"\\n\"],[41,[28,[32,2],[[30,3],[30,2,[\"cardDef\"]],[32,3]],null],[[[1,\"      \"],[8,[32,4],[[17,4]],[[\"@model\",\"@field\",\"@typeConstraint\",\"@createCard\"],[[28,[32,5],null,null],[32,6],[30,5],[30,1,[\"createCard\"]]]],null],[1,\"\\n\"]],[]],[[[44,[[28,[32,7],[[32,6],[32,8]],null]],[[[1,\"        \"],[8,[30,6],[[17,4]],[[\"@format\",\"@displayContainer\"],[[28,[32,9],[[30,3],[30,2,[\"cardDef\"]],[32,8],[32,10]],null],[30,7]]],null],[1,\"\\n\"]],[6]]]],[]]],[1,\"  \"]],[2]]]]],[1,\"\\n\"]],[1]]]]]],[\"cardCrudFunctions\",\"defaultFormats\",\"@format\",\"&attrs\",\"@typeConstraint\",\"FieldComponent\",\"@displayContainer\"],[\"if\",\"let\"]]",
          "moduleName": "packages/runtime-common/card-api.gts",
          "scope": () => [CardCrudFunctionsConsumer, DefaultFormatsConsumer, shouldRenderEditor, isComputed, LinksToEditor, getInnerModel, linksToField, fieldComponent, model, getChildFormat, isFileDefField],
          "isStrictMode": true
        }), this);
      }
    };
  }
}
class LinksToMany {
  fieldType = 'linksToMany';
  cardThunk;
  declaredCardThunk;
  declaredCardCache;
  computeVia;
  name;
  isUsed;
  isPolymorphic;
  configuration;
  queryDefinition;
  constructor({
    cardThunk,
    declaredCardThunk,
    computeVia,
    name,
    isUsed,
    isPolymorphic,
    queryDefinition
  }) {
    this.cardThunk = cardThunk;
    this.declaredCardThunk = declaredCardThunk ?? cardThunk;
    this.computeVia = computeVia;
    this.name = name;
    this.isUsed = isUsed;
    this.isPolymorphic = isPolymorphic;
    this.queryDefinition = queryDefinition;
  }
  get card() {
    return this.cardThunk();
  }
  get declaredCard() {
    if (!this.declaredCardCache) {
      this.declaredCardCache = this.declaredCardThunk();
    }
    return this.declaredCardCache;
  }
  get declaredCardResolver() {
    return this.declaredCardThunk;
  }
  getter(instance) {
    entangleWithCardTracking(instance);
    if (this.computeVia) {
      return getter(instance, this);
    }
    let deserialized = getDataBucket(instance);
    if (this.queryDefinition) {
      let dependencyTrackingContext = runtimeQueryDependencyContext({
        queryField: this.name,
        consumer: instance.id,
        source: 'card-api:linksToMany:getter'
      });
      let searchResource = ensureQueryFieldSearchResource(getStore(instance), instance, this, dependencyTrackingContext);
      let records = searchResource.instances ?? [];
      trackRuntimeRelationshipDependencies(records, this.card, dependencyTrackingContext);
      return records;
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
      lazilyLoadLink(instance, this, value.reference, {
        value
      });
      return this.emptyValue(instance);
    }
    if (!Array.isArray(value)) {
      throw new Error(`LinksToMany field '${this.name}' expected array but got ${typeof value}`);
    }
    let notLoadedRefs = [];
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
        if (isNotLoadedValue(entry) && !entry.loading) {
          lazilyLoadLink(instance, this, entry.reference, {
            value
          });
          entry.loading = true;
        }
      }
    }
    trackRuntimeRelationshipDependencies(value, this.card);
    return value;
  }
  queryableValue(instances, stack) {
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
    let results = [...instances].map(instance => {
      if (instance == null) {
        return null;
      }
      if (primitive in instance) {
        throw new Error(`the linksToMany field '${this.name}' contains a primitive card '${instance.name}'`);
      }
      if (isNotLoadedValue(instance)) {
        return {
          id: instance.reference
        };
      }
      return this.card[queryableValue](instance, stack);
    }).filter(i => i != null);
    return results.length === 0 ? null : results;
  }
  serialize(values, doc, visited, opts) {
    // Check for skip-serialization marker for computed fields that can't be computed
    if (values && typeof values === 'object' && 'type' in values && values.type === 'skip-serialization') {
      return {
        relationships: {}
      };
    }
    // this can be a not loaded value happen when the linksToMany is a
    // computed that consumes a linkTo field that is not loaded
    if (isNotLoadedValue(values)) {
      return {
        relationships: {}
      };
    }
    if (values == null || values.length === 0) {
      return {
        relationships: {
          [this.name]: {
            links: {
              self: null
            }
          }
        }
      };
    }
    if (!Array.isArray(values)) {
      throw new Error(`Expected array for field value ${this.name}`);
    }
    let relationshipType = isFileDef(this.card) ? FileMetaResourceType : CardResourceType;
    let relationships = {};
    values.map((value, i) => {
      if (value == null) {
        relationships[`${this.name}\.${i}`] = {
          links: {
            self: null
          },
          data: null
        };
        return;
      }
      if (isNotLoadedValue(value)) {
        relationships[`${this.name}\.${i}`] = {
          links: {
            self: makeRelativeURL(value.reference, opts)
          },
          data: {
            type: relationshipType,
            id: value.reference
          }
        };
        return;
      }
      if (isFileDef(this.card) && !value.id) {
        throw new Error(`linksToMany field '${this.name}' cannot serialize a FileDef without an id`);
      }
      if (visited.has(value.id)) {
        relationships[`${this.name}\.${i}`] = {
          links: {
            self: makeRelativeURL(value.id, opts)
          },
          data: {
            type: relationshipType,
            id: value.id
          }
        };
        return;
      }
      if (visited.has(value[localId])) {
        relationships[`${this.name}\.${i}`] = {
          data: {
            type: relationshipType,
            lid: value[localId]
          }
        };
        return;
      }
      visited.add(value.id ?? value[localId]);
      let serialized = callSerializeHook(this.card, value, doc, visited, opts);
      if (serialized.meta && Object.keys(serialized.meta).length === 0) {
        delete serialized.meta;
      }
      if (!(doc.included ?? []).find(r => 'id' in r && r.id === value.id) && doc.data.id !== value.id || !value.id && !(doc.included ?? []).find(r => 'lid' in r && r.lid === value[localId]) && doc.data.lid !== value[localId]) {
        doc.included = doc.included ?? [];
        doc.included.push(serialized);
      }
      relationships[`${this.name}\.${i}`] = {
        ...(value.id ? {
          links: {
            self: makeRelativeURL(value.id, opts)
          },
          data: {
            type: relationshipType,
            id: value.id
          }
        } : {
          data: {
            type: relationshipType,
            lid: value[localId]
          }
        })
      };
    });
    return {
      relationships
    };
  }
  async deserialize(values, doc, _relationships, _fieldMeta, store, instancePromise, loadedValues, relativeTo, opts) {
    let relationships;
    if (Array.isArray(values)) {
      relationships = values;
    } else {
      if (!isRelationship(values)) {
        throw new Error(`linksToMany field '${this.name}' cannot deserialize non-relationship value ${JSON.stringify(values)}`);
      }
      if (!Array.isArray(values.data)) {
        return [];
      }
      relationships = values.data.map(entry => ({
        links: {
          self: entry && 'id' in entry ? entry.id ?? null : null
        },
        data: entry
      }));
    }
    let resources = relationships.map(async value => {
      if (!isRelationship(value)) {
        throw new Error(`linksToMany field '${this.name}' cannot deserialize non-relationship value ${JSON.stringify(value)}`);
      }
      if (Array.isArray(value.data)) {
        throw new Error(`linksToMany field '${this.name}' cannot deserialize a list of resource ids`);
      }
      // links.self is used to tell the consumer of this payload how to get the resource via HTTP.
      // data.id is used to tell the consumer how to find the resource in the included bucket.
      // Prefer data.id for resourceFrom(), and fall back to links.self when data.id is missing
      let resourceId = value.data && 'id' in value.data ? value.data?.id : undefined;
      let reference = value.links?.self ?? resourceId;
      if (reference == null) {
        return null;
      }
      let normalizedReference = resolveCardReference(reference, relativeTo);
      let cachedInstance = isFileDef(this.card) ? store.getFileMeta(normalizedReference) : store.getCard(normalizedReference);
      if (cachedInstance && instanceOf(cachedInstance, this.card)) {
        cachedInstance[isSavedInstance] = true;
        return cachedInstance;
      }
      if (!resourceId) {
        resourceId = normalizedReference;
      }
      if (loadedValues && Array.isArray(loadedValues)) {
        let loadedValue = loadedValues.find(v => isCardOrField(v) && 'id' in v && v.id === resourceId);
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
          reference
        };
      }
      let clazz = await cardClassFromResource(resource, this.card, relativeTo);
      let deserialized = await clazz[deserialize](resource, relativeTo, doc, store, opts);
      if ('isSavedInstance' in deserialized) {
        deserialized[isSavedInstance] = true;
      }
      return deserialized;
    });
    return new WatchedArray((oldValue, value) => instancePromise.then(instance => {
      applySubscribersToInstanceValue(instance, this, oldValue, value);
      notifySubscribers(instance, this.name, value);
      notifyCardTracking(instance);
    }), await Promise.all(resources));
  }
  emptyValue(instance) {
    return new WatchedArray((oldValue, value) => {
      applySubscribersToInstanceValue(instance, this, oldValue, value);
      notifySubscribers(instance, this.name, value);
      notifyCardTracking(instance);
    });
  }
  validate(instance, values) {
    if (primitive in this.card) {
      throw new Error(`field validation error: the linksToMany field '${this.name}' contains a primitive card '${this.card.name}'`);
    }
    if (values == null) {
      return values;
    }
    if (!Array.isArray(values)) {
      throw new Error(`field validation error: Expected array for field value of field '${this.name}'`);
    }
    let expectedCard = this.declaredCard;
    for (let value of values) {
      if (!isNotLoadedValue(value) && value != null && !instanceOf(value, expectedCard)) {
        throw new Error(`field validation error: tried set ${value.constructor.name} as field '${this.name}' but it is not an instance of ${expectedCard.name}`);
      }
      if (!isNotLoadedValue(value) && value != null && isFileDef(expectedCard) && !value.id) {
        throw new Error(`field validation error: the linksToMany field '${this.name}' cannot reference a FileDef without an id`);
      }
    }
    return new WatchedArray((oldValue, value) => {
      applySubscribersToInstanceValue(instance, this, oldValue, value);
      notifySubscribers(instance, this.name, value);
      notifyCardTracking(instance);
    }, values);
  }
  captureQueryFieldSeedData(instance, value, resource) {
    if (this.queryDefinition) {
      captureQueryFieldSeedData(instance, this.name, value, resource);
    }
  }
  component(model) {
    let fieldName = this.name;
    let arrayField = model.field(fieldName, useIndexBasedKey in this.card);
    return getLinksToManyComponent({
      model,
      arrayField,
      field: this,
      cardTypeFor
    });
  }
}
function fieldComponent(field, model) {
  let fieldName = field.name;
  let card;
  let override = model.value && typeof model.value === 'object' ? getFieldOverrides(model.value)?.get(field.name) : undefined;
  if (primitive in field.card) {
    card = override ?? field.card;
  } else {
    card = model.value[fieldName]?.constructor ?? override ?? field.card;
  }
  let innerModel = model.field(fieldName);
  return getBoxComponent(card, innerModel, field);
}
// our decorators are implemented by Babel, not TypeScript, so they have a
// different signature than Typescript thinks they do.
export const field = function (target, key, {
  initializer
}) {
  if (typeof key === 'symbol') {
    throw new Error(`the @field decorator only supports string field names, not symbols`);
  }
  if (!(target instanceof BaseDef)) {
    throw new Error(`the @field decorator can only be used inside classes that extend BaseDef`);
  }
  let init = initializer();
  let descriptor = init.setupField(key, target);
  if (init.description) {
    setFieldDescription(target.constructor, key, init.description);
  }
  return descriptor;
};
field[fieldDecorator] = undefined;
export function containsMany(field, options) {
  return {
    setupField(fieldName, _ownerPrototype) {
      let {
        computeVia,
        isUsed
      } = options ?? {};
      let instance = new ContainsMany({
        cardThunk: cardThunk(field),
        computeVia,
        name: fieldName,
        isUsed
      });
      instance.configuration = options?.configuration;
      return makeDescriptor(instance);
    },
    description: options?.description
  };
}
export function contains(field, options) {
  return {
    setupField(fieldName, _ownerPrototype) {
      let {
        computeVia,
        isUsed
      } = options ?? {};
      let instance = new Contains({
        cardThunk: cardThunk(field),
        computeVia,
        name: fieldName,
        isUsed
      });
      instance.configuration = options?.configuration;
      return makeDescriptor(instance);
    },
    description: options?.description
  };
}
export function linksTo(cardOrThunk, options) {
  return {
    setupField(fieldName, ownerPrototype) {
      let {
        computeVia,
        isUsed,
        query
      } = options ?? {};
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
        queryDefinition: query
      });
      instance.configuration = options?.configuration;
      return makeDescriptor(instance);
    },
    description: options?.description
  };
}
export function linksToMany(cardOrThunk, options) {
  return {
    setupField(fieldName, ownerPrototype) {
      let {
        computeVia,
        isUsed,
        query
      } = options ?? {};
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
        queryDefinition: query
      });
      instance.configuration = options?.configuration;
      return makeDescriptor(instance);
    },
    description: options?.description
  };
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
  [relativeTo] = undefined;
  [meta] = undefined;
  static baseDef;
  static data;
  static displayName = 'Base';
  static icon;
  static getDisplayName(instance) {
    return instance.constructor.displayName;
  }
  static getIconComponent(instance) {
    return instance.constructor.icon;
  }
  get [realmURL]() {
    return undefined; // override in CardDef, FieldDef
  }
  static [emptyValue];
  static [serialize](value, doc, visited, opts) {
    // note that primitive can only exist in field definition
    if (primitive in this) {
      // primitive cards can override this as need be
      return value;
    } else {
      return serializeCardResource(value, doc, opts, visited);
    }
  }
  static [formatQuery](value) {
    if (primitive in this) {
      return value;
    }
    throw new Error(`Cannot format query value for composite card/field`);
  }
  static [queryableValue](value, stack = []) {
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
      let valueId = value.id;
      if (stack.includes(value)) {
        return {
          id: valueId
        };
      }
      function makeAbsoluteURL(maybeRelativeURL) {
        if (!value[relativeTo]) {
          return maybeRelativeURL;
        }
        return resolveCardReference(maybeRelativeURL, value[relativeTo]);
      }
      return Object.fromEntries(Object.entries(getFields(value, {
        includeComputeds: true,
        usedLinksToFieldsOnly: true
      })).map(([fieldName, field]) => {
        let rawValue = peekAtField(value, fieldName);
        if (field?.fieldType === 'linksToMany') {
          return [fieldName, field.queryableValue(rawValue, [value, ...stack])?.map(v => {
            return {
              ...v,
              id: makeAbsoluteURL(v.id)
            };
          }) ?? null];
        }
        if (isNotLoadedValue(rawValue)) {
          let normalizedId = rawValue.reference;
          if (value[relativeTo]) {
            normalizedId = resolveCardReference(normalizedId, value[relativeTo]);
          }
          return [fieldName, {
            id: makeAbsoluteURL(rawValue.reference)
          }];
        }
        return [fieldName, getQueryableValue(field, value[fieldName], [value, ...stack])];
      }));
    }
  }
  static async [deserialize](data, relativeTo, doc, store, opts) {
    if (primitive in this) {
      return data;
    }
    return _createFromSerialized(this, data, doc, relativeTo, store, opts);
  }
  static getComponent(card, field, opts) {
    return getComponent(card, field, opts);
  }
  static assignInitialFieldValue(instance, fieldName, value) {
    instance[fieldName] = value;
  }
  constructor(data) {
    if (data !== undefined) {
      for (let [fieldName, value] of Object.entries(data)) {
        this.constructor.assignInitialFieldValue(this, fieldName, value);
      }
    }
  }
}
export class Component extends GlimmerComponent {}
export class FieldDef extends BaseDef {
  // this changes the shape of the class type FieldDef so that a CardDef
  // class type cannot masquerade as a FieldDef class type
  static isFieldDef = true;
  static displayName = 'Field';
  static icon = RectangleEllipsisIcon;
  [realmContext];
  get [realmURL]() {
    let realmURLString = this[realmContext];
    return realmURLString ? new URL(realmURLString) : undefined;
  }
  // Optional provider for default configuration, merged with per-usage configuration
  static configuration;
  static embedded = MissingTemplate;
  static edit = FieldDefEditTemplate;
  static atom = DefaultAtomViewTemplate;
  static fitted = MissingTemplate;
  // Default `markdown` fallback (CS-10784): renders the field's HTML embedded
  // template into a hidden source container, then converts it to markdown via
  // turndown (registered on `globalThis` by `packages/host`). Subclasses can
  // override `static markdown` to author bespoke markdown directly.
  static markdown = DefaultMarkdownFallbackTemplate;
}
export class ReadOnlyField extends FieldDef {
  static [primitive];
  static [useIndexBasedKey];
  static embedded = class Embedded extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{@model}}
      */
      {
        "id": "YHIRqK09",
        "block": "[[[1,[30,1]]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
  static edit = class Edit extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{@model}}
      */
      {
        "id": "YHIRqK09",
        "block": "[[[1,[30,1]]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
  // CS-10785: emit plain text, escaped so markdown metacharacters in the
  // raw string (e.g. `*`, `#`, `1.`) don't trigger formatting when the
  // value is interpolated into a surrounding markdown document.
  static markdown = class Markdown extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{markdownEscape @model}}
      */
      {
        "id": "8wTS6aGw",
        "block": "[[[1,[28,[32,0],[[30,1]],null]]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "scope": () => [markdownEscape],
        "isStrictMode": true
      }), this);
    }
  };
}
export class StringField extends FieldDef {
  static displayName = 'String';
  static icon = LetterCaseIcon;
  static [primitive];
  static [useIndexBasedKey];
  static embedded = class Embedded extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{@model}}
      */
      {
        "id": "YHIRqK09",
        "block": "[[[1,[30,1]]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
  static edit = class Edit extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <BoxelInput
        @value={{@model}}
        @onInput={{@set}}
        @disabled={{not @canEdit}}
      />
      */
      {
        "id": "9TpFsXRk",
        "block": "[[[8,[32,0],null,[[\"@value\",\"@onInput\",\"@disabled\"],[[30,1],[30,2],[28,[32,1],[[30,3]],null]]],null]],[\"@model\",\"@set\",\"@canEdit\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "scope": () => [BoxelInput, not],
        "isStrictMode": true
      }), this);
    }
  };
  static atom = class Atom extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{@model}}
      */
      {
        "id": "YHIRqK09",
        "block": "[[[1,[30,1]]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
  // CS-10785: plain text, escaped. Same rationale as ReadOnlyField.
  // Explicit `BaseDefComponent` annotation so subclass overrides (e.g.
  // TextAreaField, MarkdownField, MaybeBase64Field) aren't forced to
  // structurally match this inline class shape.
  static markdown = class Markdown extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{markdownEscape @model}}
      */
      {
        "id": "8wTS6aGw",
        "block": "[[[1,[28,[32,0],[[30,1]],null]]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "scope": () => [markdownEscape],
        "isStrictMode": true
      }), this);
    }
  };
}
// TODO: This is a simple workaround until the thumbnailURL is converted into an actual image field
export class MaybeBase64Field extends StringField {
  static embedded = class Embedded extends Component {
    get isBase64() {
      return this.args.model?.startsWith('data:');
    }
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{#if this.isBase64}}
        <em>(Base64 encoded value)</em>
      {{else}}
        {{@model}}
      {{/if}}
      */
      {
        "id": "it6vWVk8",
        "block": "[[[41,[30,0,[\"isBase64\"]],[[[1,\"  \"],[10,\"em\"],[12],[1,\"(Base64 encoded value)\"],[13],[1,\"\\n\"]],[]],[[[1,\"  \"],[1,[30,1]],[1,\"\\n\"]],[]]]],[\"@model\"],[\"if\"]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
  static atom = MaybeBase64Field.embedded;
  // CS-10785: suppress embedded base64 payloads from the markdown emission —
  // they're never useful to downstream markdown consumers and would blow up
  // the output size. Non-base64 strings are escaped like a StringField.
  static markdown = class Markdown extends Component {
    get isBase64() {
      return this.args.model?.startsWith('data:');
    }
    get escaped() {
      return markdownEscape(this.args.model);
    }
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{#if this.isBase64}}
        [binary content]
      {{else}}
        {{this.escaped}}
      {{/if}}
      */
      {
        "id": "zeq9QLA6",
        "block": "[[[41,[30,0,[\"isBase64\"]],[[[1,\"  [binary content]\\n\"]],[]],[[[1,\"  \"],[1,[30,0,[\"escaped\"]]],[1,\"\\n\"]],[]]]],[],[\"if\"]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
}
export class TextAreaField extends StringField {
  static displayName = 'TextArea';
  static icon = TextAreaIcon;
  static edit = class Edit extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <BoxelInput
        class='boxel-text-area'
        @value={{@model}}
        @onInput={{@set}}
        @type='textarea'
        @readonly={{not @canEdit}}
      />
      */
      {
        "id": "EXP9MhVa",
        "block": "[[[8,[32,0],[[24,0,\"boxel-text-area\"]],[[\"@value\",\"@onInput\",\"@type\",\"@readonly\"],[[30,1],[30,2],\"textarea\",[28,[32,1],[[30,3]],null]]],null]],[\"@model\",\"@set\",\"@canEdit\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "scope": () => [BoxelInput, not],
        "isStrictMode": true
      }), this);
    }
  };
  // CS-10785: escape the content and convert single `\n` to a CommonMark
  // hard-break (`  \n`) so a multi-line text area renders as stacked lines
  // rather than collapsing into one paragraph. Empty-line paragraph breaks
  // (`\n\n`) are preserved — the regex touches every newline, producing
  // `  \n  \n`, which is still a valid paragraph separator.
  // Explicit `BaseDefComponent` annotation so subclass overrides (e.g.
  // CSSField) aren't forced to structurally match this inline class shape.
  static markdown = class Markdown extends Component {
    get escapedWithBreaks() {
      let escaped = markdownEscape(this.args.model);
      return escaped.replace(/\n/g, '  \n');
    }
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{this.escapedWithBreaks}}
      */
      {
        "id": "UJL+8pmH",
        "block": "[[[1,[30,0,[\"escapedWithBreaks\"]]]],[],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
}
// enumField has moved to packages/base/enum.gts
export class CSSField extends TextAreaField {
  static displayName = 'CSS Field';
  static embedded = class Embedded extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <div class='css-field-container'>
        {{#if @model.length}}
          <CopyButton class='css-field-copy-button' @textToCopy={{@model}} />
        {{/if}}
        <pre class='css-field' data-test-css-field>{{if
            @model
            @model
            '/* No CSS defined *\/'
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
      */
      {
        "id": "jSEjNwGk",
        "block": "[[[10,0],[14,0,\"css-field-container\"],[14,\"data-scopedcss-3d2fc9e40e-98b77ab716\",\"\"],[12],[1,\"\\n\"],[41,[30,1,[\"length\"]],[[[1,\"    \"],[8,[32,0],[[24,0,\"css-field-copy-button\"],[24,\"data-scopedcss-3d2fc9e40e-98b77ab716\",\"\"]],[[\"@textToCopy\"],[[30,1]]],null],[1,\"\\n\"]],[]],null],[1,\"  \"],[10,\"pre\"],[14,0,\"css-field\"],[14,\"data-test-css-field\",\"\"],[14,\"data-scopedcss-3d2fc9e40e-98b77ab716\",\"\"],[12],[1,[52,[30,1],[30,1],\"/* No CSS defined */\"]],[13],[1,\"\\n\"],[13],[1,\"\\n\"]],[\"@model\"],[\"if\"]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "scope": () => [CopyButton],
        "isStrictMode": true
      }), this);
    }
  };
  // CS-10785: emit the CSS in a fenced code block with a `css` info string.
  // The fence is computed as the longest run of backticks in the content
  // plus one (minimum 3), so embedded triple-backtick sequences in CSS
  // content can't prematurely close the block. Content itself is not
  // escaped — inside a fenced block, CommonMark treats it as literal.
  static markdown = class Markdown extends Component {
    get fenced() {
      let value = this.args.model ?? '';
      let longestRun = 0;
      let match = value.match(/`+/g);
      if (match) {
        for (let run of match) {
          if (run.length > longestRun) longestRun = run.length;
        }
      }
      let fence = '`'.repeat(Math.max(3, longestRun + 1));
      return `${fence}css\n${value}\n${fence}`;
    }
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{this.fenced}}
      */
      {
        "id": "TzwMj1CX",
        "block": "[[[1,[30,0,[\"fenced\"]]]],[],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
}
export class MarkdownField extends StringField {
  static displayName = 'Markdown';
  static icon = MarkdownIcon;
  static embedded = class MarkdownViewTemplate extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <MarkdownTemplate @content={{@model}} />
      */
      {
        "id": "kWsCu+W2",
        "block": "[[[8,[32,0],null,[[\"@content\"],[[30,1]]],null]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "scope": () => [MarkdownTemplate],
        "isStrictMode": true
      }), this);
    }
  };
  static atom = class MarkdownViewTemplate extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <MarkdownTemplate @content={{@model}} />
      */
      {
        "id": "kWsCu+W2",
        "block": "[[[8,[32,0],null,[[\"@content\"],[[30,1]]],null]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "scope": () => [MarkdownTemplate],
        "isStrictMode": true
      }), this);
    }
  };
  static edit = class Edit extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <BoxelInput
        class='boxel-text-area'
        @type='textarea'
        @value={{@model}}
        @onInput={{@set}}
        @disabled={{not @canEdit}}
        @readonly={{not @canEdit}}
      />
      */
      {
        "id": "/YICgnf7",
        "block": "[[[8,[32,0],[[24,0,\"boxel-text-area\"]],[[\"@type\",\"@value\",\"@onInput\",\"@disabled\",\"@readonly\"],[\"textarea\",[30,1],[30,2],[28,[32,1],[[30,3]],null],[28,[32,1],[[30,3]],null]]],null]],[\"@model\",\"@set\",\"@canEdit\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "scope": () => [BoxelInput, not],
        "isStrictMode": true
      }), this);
    }
  };
  // CS-10785: raw markdown passthrough. Content is already authored as
  // markdown, so interpolating a value with `#`, `*`, etc. must NOT
  // double-escape. This overrides the StringField inherited `static
  // markdown` to suppress escaping.
  static markdown = class Markdown extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{@model}}
      */
      {
        "id": "YHIRqK09",
        "block": "[[[1,[30,1]]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
}
export function deserializeForUI(value) {
  let validationError = NumberSerializer.validate(value);
  if (validationError) {
    return null;
  }
  return NumberSerializer.deserializeSync(value);
}
export function serializeForUI(val) {
  let serialized = NumberSerializer.serialize(val);
  if (serialized != null) {
    return String(serialized);
  }
  return undefined;
}
export class NumberField extends FieldDef {
  static displayName = 'Number';
  static icon = HashIcon;
  static [primitive];
  static [fieldSerializer] = 'number';
  static [useIndexBasedKey];
  static embedded = class View extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{@model}}
      */
      {
        "id": "YHIRqK09",
        "block": "[[[1,[30,1]]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
  static atom = this.embedded;
  static edit = class Edit extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <BoxelInput
        @value={{this.textInputValidator.asString}}
        @onInput={{this.textInputValidator.onInput}}
        @errorMessage={{this.textInputValidator.errorMessage}}
        @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
        @disabled={{not @canEdit}}
      />
      */
      {
        "id": "I9I+qs/C",
        "block": "[[[8,[32,0],null,[[\"@value\",\"@onInput\",\"@errorMessage\",\"@state\",\"@disabled\"],[[30,0,[\"textInputValidator\",\"asString\"]],[30,0,[\"textInputValidator\",\"onInput\"]],[30,0,[\"textInputValidator\",\"errorMessage\"]],[52,[30,0,[\"textInputValidator\",\"isInvalid\"]],\"invalid\",\"none\"],[28,[32,1],[[30,1]],null]]],null]],[\"@canEdit\"],[\"if\"]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "scope": () => [BoxelInput, not],
        "isStrictMode": true
      }), this);
    }
    textInputValidator = new TextInputValidator(() => this.args.model, inputVal => this.args.set(inputVal), deserializeForUI, serializeForUI, NumberSerializer.validate);
  };
  // CS-10785: render the number as text. `markdownEscape` handles the null/
  // undefined case (empty string) and also protects against line-start
  // `1.`/`2.` etc. being interpreted as ordered list markers when this
  // value gets interpolated into a larger markdown document.
  static markdown = class Markdown extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{markdownEscape @model}}
      */
      {
        "id": "8wTS6aGw",
        "block": "[[[1,[28,[32,0],[[30,1]],null]]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "scope": () => [markdownEscape],
        "isStrictMode": true
      }), this);
    }
  };
}
// Throw this error from extractAttributes when the file content doesn't match this FileDef's
// expectations so the extractor can fall back to a superclass/base FileDef.
export class FileContentMismatchError extends Error {
  name = 'FileContentMismatchError';
}
export class FileDef extends BaseDef {
  static displayName = 'File';
  static isFileDef = true;
  static icon = FileIcon;
  [isSavedInstance] = true;
  get [realmURL]() {
    let realmURLString = getCardMeta(this, 'realmURL');
    return realmURLString ? new URL(realmURLString) : undefined;
  }
  static assignInitialFieldValue(instance, fieldName, value) {
    if (fieldName === 'id') {
      // Similar to CardDef, set 'id' directly in the deserialized cache
      // to avoid triggering recomputes during instantiation
      let deserialized = getDataBucket(instance);
      deserialized.set('id', value);
    } else {
      super.assignInitialFieldValue(instance, fieldName, value);
    }
  }
  static {
    dt7948.g(this.prototype, "id", [field], function () {
      return contains(ReadOnlyField);
    });
  }
  #id = (dt7948.i(this, "id"), void 0);
  static {
    dt7948.g(this.prototype, "sourceUrl", [field], function () {
      return contains(StringField);
    });
  }
  #sourceUrl = (dt7948.i(this, "sourceUrl"), void 0);
  static {
    dt7948.g(this.prototype, "url", [field], function () {
      return contains(StringField);
    });
  }
  #url = (dt7948.i(this, "url"), void 0);
  static {
    dt7948.g(this.prototype, "name", [field], function () {
      return contains(StringField);
    });
  }
  #name = (dt7948.i(this, "name"), void 0);
  static {
    dt7948.g(this.prototype, "contentType", [field], function () {
      return contains(StringField);
    });
  }
  #contentType = (dt7948.i(this, "contentType"), void 0);
  static {
    dt7948.g(this.prototype, "contentHash", [field], function () {
      return contains(StringField);
    });
  }
  #contentHash = (dt7948.i(this, "contentHash"), void 0);
  static {
    dt7948.g(this.prototype, "contentSize", [field], function () {
      return contains(NumberField);
    });
  }
  #contentSize = (dt7948.i(this, "contentSize"), void 0);
  static embedded = class View extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{@model.name}}
      */
      {
        "id": "n7QMmKbC",
        "block": "[[[1,[30,1,[\"name\"]]]],[\"@model\"],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
  static fitted = this.embedded;
  static isolated = this.embedded;
  static atom = this.embedded;
  static edit = FileDefEditTemplate;
  // Default `markdown` fallback (CS-10784): inherits from FieldDef but
  // restated explicitly so this class's own slot is set rather than relying on
  // prototype lookup — the format-resolution code reads slots via bracket
  // notation on the resolved class (`(cls as any)[format]`), which traverses
  // the prototype chain, but having an own property keeps subclass overrides
  // less surprising.
  static markdown = DefaultMarkdownFallbackTemplate;
  static async extractAttributes(url, getStream, options = {}) {
    let parsed = new URL(url);
    let name = decodeURIComponent(parsed.pathname.split('/').pop() ?? parsed.pathname);
    let contentType = inferContentType(name);
    let contentHash = options.contentHash;
    let contentSize = options.contentSize;
    if (!contentHash || contentSize === undefined) {
      let bytes = await byteStreamToUint8Array(await getStream());
      if (!contentHash) {
        try {
          contentHash = md5(bytes);
        } catch {
          contentHash = md5(new TextDecoder().decode(bytes));
        }
      }
      if (contentSize === undefined) {
        contentSize = bytes.byteLength;
      }
    }
    return {
      sourceUrl: url,
      url,
      name,
      contentType,
      contentHash,
      contentSize
    };
  }
  serialize() {
    return {
      sourceUrl: this.sourceUrl,
      url: this.url,
      name: this.name,
      contentType: this.contentType,
      contentHash: this.contentHash,
      contentSize: this.contentSize
    };
  }
  [getMenuItems](params) {
    return getDefaultFileMenuItems(this, params);
  }
}
export function createFileDef({
  url,
  sourceUrl,
  name,
  contentType,
  contentHash,
  contentSize
}) {
  return new FileDef({
    url,
    sourceUrl,
    name,
    contentType,
    contentHash,
    contentSize
  });
}
export { getDefaultFileMenuItems } from './file-menu-items';
export class ImageDef extends FileDef {
  static displayName = 'Image';
  static acceptTypes = 'image/*';
  static {
    dt7948.g(this.prototype, "width", [field], function () {
      return contains(NumberField);
    });
  }
  #width = (dt7948.i(this, "width"), void 0);
  static {
    dt7948.g(this.prototype, "height", [field], function () {
      return contains(NumberField);
    });
  }
  #height = (dt7948.i(this, "height"), void 0);
  static isolated = ImageDefIsolatedTemplate;
  static atom = ImageDefAtomTemplate;
  static embedded = ImageDefEmbeddedTemplate;
  static fitted = ImageDefFittedTemplate;
  // CS-10787: emit a markdown image reference. If no URL is available we
  // fall back to a placeholder that names the image — useful to downstream
  // consumers (e.g. an LLM ingesting the markdown) without a broken link.
  static markdown = class Markdown extends Component {
    get text() {
      let model = this.args.model;
      if (!model) {
        return '';
      }
      let url = model.url ?? model.sourceUrl ?? '';
      let name = model.name ?? '';
      if (!url && !name) {
        return '';
      }
      return markdownImage(name, url);
    }
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        {{this.text}}
      */
      {
        "id": "SxyHmVEf",
        "block": "[[[1,[30,0,[\"text\"]]]],[],[]]",
        "moduleName": "packages/runtime-common/card-api.gts",
        "isStrictMode": true
      }), this);
    }
  };
}
export class CardInfoField extends FieldDef {
  static displayName = 'Card Info';
  static {
    dt7948.g(this.prototype, "name", [field], function () {
      return contains(StringField);
    });
  }
  #name = (dt7948.i(this, "name"), void 0);
  static {
    dt7948.g(this.prototype, "summary", [field], function () {
      return contains(StringField);
    });
  }
  #summary = (dt7948.i(this, "summary"), void 0);
  static {
    dt7948.g(this.prototype, "cardThumbnail", [field], function () {
      return linksTo(() => ImageDef);
    });
  }
  #cardThumbnail = (dt7948.i(this, "cardThumbnail"), void 0);
  static {
    dt7948.g(this.prototype, "cardThumbnailURL", [field], function () {
      return contains(MaybeBase64Field);
    });
  }
  #cardThumbnailURL = (dt7948.i(this, "cardThumbnailURL"), void 0);
  static {
    dt7948.g(this.prototype, "theme", [field], function () {
      return linksTo(() => Theme);
    });
  }
  #theme = (dt7948.i(this, "theme"), void 0);
  static {
    dt7948.g(this.prototype, "notes", [field], function () {
      return contains(MarkdownField);
    });
  }
  #notes = (dt7948.i(this, "notes"), void 0);
}
export class CardDef extends BaseDef {
  [localId] = uuidv4();
  [isSavedInstance] = false;
  get [fieldsUntracked]() {
    let overrides = getFieldOverrides(this);
    return overrides ? Object.fromEntries(getFieldOverrides(this)) : undefined;
  }
  get [fields]() {
    entangleWithCardTracking(this);
    return this[fieldsUntracked];
  }
  set [fields](overrides) {
    let existingOverrides = getFieldOverrides(this);
    for (let [fieldName, clazz] of Object.entries(overrides)) {
      existingOverrides.set(fieldName, clazz);
    }
    // notify glimmer to rerender this card
    notifyCardTracking(this);
  }
  static {
    dt7948.g(this.prototype, "id", [field], function () {
      return contains(ReadOnlyField);
    });
  }
  #id = (dt7948.i(this, "id"), void 0);
  static {
    dt7948.g(this.prototype, "cardInfo", [field], function () {
      return contains(CardInfoField);
    });
  }
  #cardInfo = (dt7948.i(this, "cardInfo"), void 0);
  static {
    dt7948.g(this.prototype, "cardTitle", [field], function () {
      return contains(StringField, {
        computeVia: function () {
          return this.cardInfo.name?.trim()?.length ? this.cardInfo.name : `Untitled ${this.constructor.displayName}`;
        }
      });
    });
  }
  #cardTitle = (dt7948.i(this, "cardTitle"), void 0);
  static {
    dt7948.g(this.prototype, "cardDescription", [field], function () {
      return contains(StringField, {
        computeVia: function () {
          return this.cardInfo.summary;
        }
      });
    });
  }
  #cardDescription = (dt7948.i(this, "cardDescription"), void 0);
  static {
    dt7948.g(this.prototype, "cardTheme", [field], function () {
      return linksTo(() => Theme, {
        computeVia: function () {
          return this.cardInfo.theme;
        }
      });
    });
  }
  #cardTheme = (dt7948.i(this, "cardTheme"), void 0);
  static {
    dt7948.g(this.prototype, "cardThumbnailURL", [field], function () {
      return contains(MaybeBase64Field, {
        computeVia: function () {
          return this.cardInfo.cardThumbnailURL;
        }
      });
    });
  }
  #cardThumbnailURL = (dt7948.i(this, "cardThumbnailURL"), void 0); // TODO: this will probably be an image or image url field card when we have it
  // UPDATE: we now have a Base64ImageField card. we can probably refactor this
  // to use it directly now (or wait until a better image field comes along)
  static displayName = 'Card';
  static isCardDef = true;
  static icon = CaptionsIcon;
  static assignInitialFieldValue(instance, fieldName, value) {
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
  static embedded = DefaultEmbeddedTemplate;
  static fitted = DefaultFittedTemplate;
  static isolated = DefaultCardDefTemplate;
  static edit = DefaultCardDefTemplate;
  static atom = DefaultAtomViewTemplate;
  static head = DefaultHeadTemplate;
  // Default `markdown` fallback (CS-10784): renders the card's HTML isolated
  // template into a hidden source container, then converts it to markdown via
  // turndown (registered on `globalThis` by `packages/host`). Subclasses can
  // override `static markdown` to author bespoke markdown directly.
  static markdown = DefaultMarkdownFallbackTemplate;
  static get hasCustomEditTemplate() {
    return this.edit !== CardDef.edit;
  }
  static get hasCustomIsolatedTemplate() {
    return this.isolated !== CardDef.isolated;
  }
  static prefersWideFormat = false;
  static headerColor = null;
  constructor(data) {
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
  get [realmURL]() {
    let realmURLString = getCardMeta(this, 'realmURL');
    return realmURLString ? new URL(realmURLString) : undefined;
  }
  [getMenuItems](params) {
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
  static {
    dt7948.g(this.prototype, "cssVariables", [field], function () {
      return contains(CSSField, {
        description: 'CSS variable definitions that build on shadcn variables (typically for :root and .dark selectors) injected into the CardContainer.'
      });
    });
  }
  #cssVariables = (dt7948.i(this, "cssVariables"), void 0);
  static {
    dt7948.g(this.prototype, "cssImports", [field], function () {
      return containsMany(CssImportField, {
        description: 'CSS links (e.g. Google Fonts) imported via the CardContainer.'
      });
    });
  }
  #cssImports = (dt7948.i(this, "cssImports"), void 0);
  [getMenuItems](params) {
    let menuItems = super[getMenuItems](params);
    if (params.menuContext === 'interact' && params.commandContext && this.id) {
      menuItems = [...menuItems, {
        label: 'Copy and Edit',
        action: async () => {
          if (!params.commandContext || !this.id) {
            return;
          }
          let cmd = new CopyAndEditCommand(params.commandContext);
          await cmd.execute({
            card: this
          });
        },
        icon: FilePencilIcon,
        disabled: !this.id
      }, {
        label: 'Modify Theme via AI',
        action: async () => {
          let cmd = new PatchThemeCommand(params.commandContext);
          await cmd.execute({
            cardId: this.id
          });
        },
        icon: WandIcon,
        disabled: !this.id
      }];
    }
    return menuItems;
  }
}
export function subscribeToChanges(fieldOrCard, subscriber, enclosing) {
  if (isArrayOfCardOrField(fieldOrCard)) {
    fieldOrCard.forEach((item, i) => {
      subscribeToChanges(item, subscriber, enclosing ? {
        fieldOrCard: enclosing.fieldOrCard,
        fieldName: `${enclosing.fieldName}.${i}`
      } : undefined);
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
    includeComputeds: false
  });
  Object.keys(fields).forEach(fieldName => {
    let field = getField(fieldOrCard, fieldName);
    if (field && (field.fieldType === 'contains' || field.fieldType === 'containsMany')) {
      let value = peekAtField(fieldOrCard, fieldName);
      if (isCardOrField(value) || isArrayOfCardOrField(value)) {
        subscribeToChanges(value, subscriber, {
          fieldOrCard: enclosing?.fieldOrCard ?? fieldOrCard,
          fieldName: enclosing?.fieldName ? `${enclosing.fieldName}.${fieldName}` : fieldName
        });
      }
    }
  });
}
export function unsubscribeFromChanges(fieldOrCard, subscriber, visited = new Set()) {
  if (isArrayOfCardOrField(fieldOrCard)) {
    fieldOrCard.forEach(item => {
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
    includeComputeds: false
  });
  Object.keys(fields).forEach(fieldName => {
    let field = getField(fieldOrCard, fieldName);
    if (field && (field.fieldType === 'contains' || field.fieldType === 'containsMany')) {
      let value = peekAtField(fieldOrCard, fieldName);
      if (isCardOrField(value) || isArrayOfCardOrField(value)) {
        unsubscribeFromChanges(value, subscriber);
      }
    }
  });
}
function applySubscribersToInstanceValue(instance, field, oldValue, newValue) {
  let changeSubscribers = undefined;
  if (field.fieldType === 'contains' || field.fieldType === 'containsMany') {
    changeSubscribers = subscribers.get(instance);
  } else if (isArrayOfCardOrField(oldValue) && oldValue[0] && subscribers.has(oldValue[0])) {
    changeSubscribers = subscribers.get(oldValue[0]);
  } else if (isCardOrField(oldValue)) {
    changeSubscribers = subscribers.get(oldValue);
  }
  if (!changeSubscribers) {
    return;
  }
  let toArray = function (item) {
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
  let addedItems = newItems.filter(item => !oldItems.includes(item));
  let removedItems = oldItems.filter(item => !newItems.includes(item));
  addedItems.forEach((item, i) => changeSubscribers.forEach(subscriber => subscribeToChanges(item, subscriber, {
    fieldOrCard: instance,
    fieldName: `${field.name}.${i}`
  })));
  removedItems.forEach(item => changeSubscribers.forEach(subscriber => unsubscribeFromChanges(item, subscriber)));
}
function lazilyLoadLink(instance, field, link, pluralArgs) {
  let inflightLoads = inflightLinkLoads.get(instance);
  if (!inflightLoads) {
    inflightLoads = new Map();
    inflightLinkLoads.set(instance, inflightLoads);
  }
  let reference = resolveCardReference(link, instance.id ?? instance[relativeTo]);
  let key = `${field.name}/${reference}`;
  let promise = inflightLoads.get(key);
  let store = getStore(instance);
  if (promise) {
    store.trackLoad(promise);
    return;
  }
  let deferred = new Deferred();
  inflightLoads.set(key, deferred.promise);
  store.trackLoad(
  // we wrap the promise with a catch that will prevent the rejections from bubbling up but
  // not interfere with the original deferred. this prevents QUnit from being really noisy
  // and reporting a "global error" even though that is a normal operating circumstance for
  // the rendering when it encounters an error. the original deferred.promise still
  // rejects as expected for anyone awaiting it, but it won't cause unnecessary noise in QUnit.
  deferred.promise.then(() => {}, () => {}));
  let dependencyTrackingContext = runtimeNonQueryDependencyContext({
    source: 'card-api:lazilyLoadLink',
    consumer: instance.id
  });
  void (async () => {
    let isFileLink = isFileDef(field.card);
    try {
      let fieldValue;
      if (isFileLink) {
        let fileMetaDoc = await store.loadFileMetaDocument(reference, {
          dependencyTrackingContext
        });
        if (isCardError(fileMetaDoc)) {
          let cardError = fileMetaDoc;
          let referenceForDeps = reference;
          cardError.deps = [referenceForDeps];
          throw cardError;
        }
        fieldValue = await createFromSerialized(fileMetaDoc.data, fileMetaDoc, cardIdToURL(fileMetaDoc.data.id), {
          store,
          dependencyTrackingContext
        });
      } else {
        let cardDoc = await store.loadCardDocument(reference, {
          dependencyTrackingContext
        });
        if (isCardError(cardDoc)) {
          let cardError = cardDoc;
          let referenceForDeps = reference;
          cardError.deps = [referenceForDeps];
          throw cardError;
        }
        fieldValue = await createFromSerialized(cardDoc.data, cardDoc, cardIdToURL(cardDoc.data.id), {
          store,
          dependencyTrackingContext
        });
      }
      if (pluralArgs) {
        let {
          value
        } = pluralArgs;
        let indices = [];
        for (let [index, item] of value.entries()) {
          if (!isNotLoadedValue(item)) {
            continue;
          }
          let notLoadedRef = resolveCardReference(item.reference, instance.id ?? instance[relativeTo]);
          if (reference === notLoadedRef) {
            indices.push(index);
          }
        }
        for (let index of indices) {
          value[index] = fieldValue;
        }
      } else {
        instance[field.name] = fieldValue;
      }
    } catch (e) {
      // we replace the node-loaded value with a null
      // TODO in the future consider recording some link meta that this reference is actually missing
      instance[field.name] = null;
      let error = e;
      let isMissingFile = isCardError(error) && error.status === 404 || typeof error?.message === 'string' && /not found/i.test(error.message);
      let referenceForMissingFile = isFileLink || reference.endsWith('.json') ? reference : `${reference}.json`;
      let payloadError = {
        title: isMissingFile ? 'Link Not Found' : error?.message ?? 'Card Error',
        status: isMissingFile ? 404 : error?.status ?? 500,
        message: isMissingFile ? `missing file ${referenceForMissingFile}` : error?.message ?? String(e),
        stack: error?.stack
      };
      let deps = new Set([referenceForMissingFile]);
      if (isCardError(error)) {
        for (let dep of error.deps ?? []) {
          deps.add(dep);
        }
        if (error.additionalErrors?.length) {
          payloadError.additionalErrors = error.additionalErrors.map(additionalError => {
            let normalized = additionalError;
            return {
              title: normalized.title,
              status: normalized.status,
              message: normalized.message,
              stack: normalized.stack
            };
          });
        }
      }
      payloadError.deps = [...deps];
      let payload = JSON.stringify({
        type: 'error',
        error: payloadError
      });
      // We use a custom event for render errors--otherwise QUnit will report a "global error"
      // when we use a promise rejection to signal to the prerender that there was an error
      // even though everything is working as designed. QUnit is very noisy about these errors...
      const event = new CustomEvent('boxel-render-error', {
        detail: {
          reason: payload
        }
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
function trackRuntimeRelationshipDependency(value, declaredCard, dependencyTrackingContext) {
  if (!value || isNotLoadedValue(value)) {
    return;
  }
  let id = value.id;
  if (typeof id !== 'string') {
    return;
  }
  if (isFileDef(declaredCard)) {
    trackRuntimeFileDependency(id, dependencyTrackingContext);
    trackRuntimeRelationshipModuleDependencies(value, dependencyTrackingContext);
    return;
  }
  trackRuntimeInstanceDependency(id, dependencyTrackingContext);
  trackRuntimeRelationshipModuleDependencies(value, dependencyTrackingContext);
}
function trackRuntimeRelationshipDependencies(values, declaredCard, dependencyTrackingContext) {
  for (let value of values) {
    trackRuntimeRelationshipDependency(value, declaredCard, dependencyTrackingContext);
  }
}
function trackRuntimeRelationshipModuleDependencies(value, dependencyTrackingContext) {
  if (!value || typeof value !== 'object') {
    return;
  }
  let ctor = Reflect.getPrototypeOf(value)?.constructor;
  if (typeof ctor !== 'function') {
    return;
  }
  let identity = Loader.identify(ctor);
  if (!identity) {
    return;
  }
  trackRuntimeModuleDependency(identity.module, dependencyTrackingContext);
  let loader = Loader.getLoaderFor(ctor);
  if (!loader) {
    return;
  }
  // getKnownConsumedModules is fast now: the Loader caches the dependency
  // graph traversal result in collectKnownModuleDependencies, and
  // trimModuleIdentifier uses string ops + a cache instead of URL
  // construction. No need for a caller-side skip cache here.
  for (let dep of loader.getKnownConsumedModules(identity.module)) {
    trackRuntimeModuleDependency(dep, dependencyTrackingContext);
  }
}
export function setId(instance, id) {
  let field = getField(instance, 'id');
  if (field) {
    setField(instance, field, id);
  }
}
export function isSaved(instance) {
  return instance[isSavedInstance] === true;
}
export function getQueryableValue(fieldOrCard, value, stack = []) {
  if ('baseDef' in fieldOrCard) {
    let result = fieldOrCard[queryableValue](value, stack);
    if (primitive in fieldOrCard) {
      assertScalar(result, fieldOrCard);
    }
    return result;
  }
  return fieldOrCard.queryableValue(value, stack);
}
export function formatQueryValue(field, queryValue) {
  let serializer;
  if (primitive in field.card && fieldSerializer in field.card) {
    assertIsSerializerName(field.card[fieldSerializer]);
    serializer = getSerializer(field.card[fieldSerializer]);
  }
  return serializer?.formatQuery?.(queryValue) ?? field.card[formatQuery](queryValue);
}
async function getDeserializedValue({
  card,
  loadedValue,
  fieldName,
  value,
  resource,
  modelPromise,
  doc,
  store,
  relativeTo,
  opts
}) {
  let field = getField(isCardInstance(value) ? value : card, fieldName);
  if (!field) {
    throw new Error(`could not find field ${fieldName} in card ${card.name}`);
  }
  let result = await field.deserialize(value, doc, resource.relationships, resource.meta.fields?.[fieldName], store, modelPromise, loadedValue, relativeTo, opts);
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
export async function createFromSerialized(resource, doc, relativeTo, opts) {
  let store = opts?.store ?? new FallbackCardStore();
  let localIdValue = 'lid' in resource && typeof resource.lid === 'string' ? resource.lid : undefined;
  let defaultContext = runtimeNonQueryDependencyContext({
    source: 'card-api:createFromSerialized',
    consumer: resource.id ?? localIdValue,
    consumerKind: isFileMetaResource(resource) ? 'file' : 'instance'
  });
  let context = opts?.dependencyTrackingContext ?? defaultContext;
  let {
    meta: {
      adoptsFrom
    }
  } = resource;
  let card = await loadCardDef(adoptsFrom, {
    loader: myLoader(),
    relativeTo,
    dependencyTrackingContext: context
  });
  if (!card) {
    throw new Error(`could not find card: '${humanReadable(adoptsFrom)}'`);
  }
  return card[deserialize](resource, relativeTo, doc, store, opts);
}
export async function updateFromSerialized(instance, doc, store = getStore(instance), opts) {
  stores.set(instance, store);
  if (!instance[relativeTo] && doc.data.id) {
    instance[relativeTo] = cardIdToURL(doc.data.id);
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
    opts
  });
}
// The typescript `is` type here refuses to work unless it's in this file.
function isCardInstance(instance) {
  return _isCardInstance(instance);
}
async function _createFromSerialized(card, data, doc, _relativeTo, store = new FallbackCardStore(), opts) {
  let resource;
  if (isCardResource(data) || isFileMetaResource(data)) {
    resource = data;
  }
  if (!resource) {
    let adoptsFrom = identifyCard(card);
    if (!adoptsFrom) {
      throw new Error(`bug: could not determine identity for card '${card.name}'`);
    }
    // in this case we are dealing with an empty instance
    resource = {
      meta: {
        adoptsFrom
      }
    };
  }
  if (!doc) {
    doc = {
      data: resource
    };
  }
  let instance;
  if (resource.id != null || resource.lid != null) {
    let resourceId = resource.id ?? resource.lid;
    let cachedInstance = isFileMetaResource(resource) || isFileDef(card) ? store.getFileMeta(resourceId) : store.getCard(resourceId);
    if (cachedInstance && instanceOf(cachedInstance, card)) {
      instance = cachedInstance;
    }
  }
  if (!instance) {
    instance = new card({
      id: resource.id,
      [localId]: resource.lid
    });
    instance[relativeTo] = _relativeTo;
  }
  stores.set(instance, store);
  return await _updateFromSerialized({
    instance,
    resource,
    doc,
    store,
    opts
  });
}
async function _updateFromSerialized({
  instance,
  resource,
  doc,
  store,
  opts
}) {
  // because our store uses a tracked map for its identity map all the assembly
  // work that we are doing to deserialize the instance below is "live". so we
  // add the actual instance silently in a non-tracked way and only track it at
  // the very end.
  let card = Reflect.getPrototypeOf(instance).constructor;
  if (resource.id != null) {
    if (isFileMetaResource(resource) || isFileDef(card)) {
      store.setFileMetaNonTracked(resource.id, instance);
    } else {
      store.setCardNonTracked(resource.id, instance);
    }
  }
  let deferred = new Deferred();
  let nonNestedRelationships = Object.fromEntries(Object.entries(resource.relationships ?? {}).filter(([fieldName]) => !fieldName.includes('.')));
  let linksToManyRelationships = Object.entries(resource.relationships ?? {}).filter(([fieldName]) => fieldName.split('.').length === 2 && fieldName.split('.')[1].match(/^\d+$/)).reduce((result, [fieldName, value]) => {
    let name = fieldName.split('.')[0];
    result[name] = result[name] || [];
    result[name].push(value);
    return result;
  }, Object.create(null));
  let existingOverrides = getFieldOverrides(instance);
  let loadedValues = getDataBucket(instance);
  let instanceRelativeTo = instance[relativeTo] ?? ('id' in instance && typeof instance.id === 'string' ? cardIdToURL(instance.id) : undefined);
  function getFieldMeta(fieldsMeta, key) {
    let entry = fieldsMeta?.[key];
    return Array.isArray(entry) ? undefined : entry;
  }
  function getFieldMetaArray(fieldsMeta, key) {
    let entry = fieldsMeta?.[key];
    return Array.isArray(entry) ? entry : undefined;
  }
  function isAssignableToField(overrideCard, fieldCard) {
    let current = overrideCard;
    while (current) {
      if (current === fieldCard) {
        return true;
      }
      current = getAncestor(current) ?? undefined;
    }
    return false;
  }
  function applyFieldOverride(fieldName, overrideCard, field) {
    if (!overrideCard) {
      return false;
    }
    if (field && !isAssignableToField(overrideCard, field.card)) {
      return false;
    }
    if (existingOverrides.get(fieldName) === overrideCard) {
      return false;
    }
    existingOverrides.set(fieldName, overrideCard);
    return true;
  }
  async function setDeserializedFieldOverride(fieldName, resource, field, serializedFieldOverride) {
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
      relativeTo: instanceRelativeTo ?? (resource.id && typeof resource.id === 'string' ? cardIdToURL(resource.id) : undefined),
      dependencyTrackingContext: opts?.dependencyTrackingContext
    });
    if (!override) {
      return false;
    }
    return applyFieldOverride(fieldName, override, field);
  }
  function applyLinkOverrideFromValue(fieldName, field, value) {
    let changed = false;
    if (field.fieldType === 'linksTo') {
      if (isCardInstance(value)) {
        changed = applyFieldOverride(fieldName, value.constructor, field);
      }
    } else if (field.fieldType === 'linksToMany') {
      if (Array.isArray(value)) {
        let linked = value.find(entry => isCardInstance(entry));
        if (linked) {
          changed = applyFieldOverride(fieldName, linked.constructor, field);
        }
      }
    }
    if (changed) {
      return getField(instance, fieldName) ?? field;
    }
    return field;
  }
  let values = await Promise.all(Object.entries({
    ...resource.attributes,
    ...nonNestedRelationships,
    ...linksToManyRelationships,
    ...(resource.id !== undefined ? {
      id: resource.id
    } : {})
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
            overrideApplied = (await setDeserializedFieldOverride(key, resource, field, getFieldMeta(resourceMetaFields, key))) || overrideApplied;
          }
        } else {
          overrideApplied = (await setDeserializedFieldOverride(fieldName, resource, field, getFieldMeta(resourceMetaFields, fieldName))) || overrideApplied;
        }
      } else {
        let metas = getFieldMetaArray(resourceMetaFields, fieldName);
        if (metas) {
          for (let [index, meta] of metas.entries()) {
            overrideApplied = (await setDeserializedFieldOverride(`${fieldName}.${index}`, resource, field, meta)) || overrideApplied;
          }
        }
      }
    } else if (field.fieldType === 'contains') {
      overrideApplied = (await setDeserializedFieldOverride(fieldName, resource, field, getFieldMeta(resourceMetaFields, fieldName))) || overrideApplied;
    }
    if (overrideApplied) {
      field = getField(instance, fieldName) ?? field;
    }
    // Prefer the deserialization context ([relativeTo]) when available; fall back to the instance id
    let relativeToVal = instance[relativeTo] ?? ('id' in instance && typeof instance.id === 'string' ? cardIdToURL(instance.id) : undefined);
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
      opts
    });
    field = applyLinkOverrideFromValue(fieldName, field, deserializedValue);
    return [field, deserializedValue];
  }));
  let realmURLString = getCardMeta(instance, 'realmURL') ?? resource.meta?.realmURL;
  // this block needs to be synchronous
  {
    let wasSaved = false;
    let originalId;
    if (isCardInstance(instance)) {
      wasSaved = instance[isSavedInstance];
      originalId = instance.id; // the instance is a composite card
      instance[isSavedInstance] = false;
    }
    let deserialized = getDataBucket(instance);
    for (let [field, value] of values) {
      if (!field) {
        continue;
      }
      if (field.name === 'id' && wasSaved && originalId !== value) {
        throw new Error(`cannot change the id for saved instance ${originalId}`);
      }
      propagateRealmContext(value, realmURLString);
      field.validate(instance, value);
      // Before updating field's value, we also have to make sure
      // the subscribers also subscribes to a new value.
      let existingValue = deserialized.get(field.name);
      if (isCardOrField(existingValue) || isArrayOfCardOrField(existingValue) || isCardOrField(value) || isArrayOfCardOrField(value)) {
        applySubscribersToInstanceValue(instance, field, existingValue, value);
      }
      deserialized.set(field.name, value);
      field.captureQueryFieldSeedData?.(instance, value, resource);
    }
    // assign the realm meta before we compute as computeds may be relying on this
    if (!isFieldInstance(instance) && resource.id != null) {
      instance[meta] = resource.meta;
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
export function setCardAsSavedForTest(instance, id) {
  if (id != null) {
    let deserialized = getDataBucket(instance);
    deserialized.set('id', id);
  }
  instance[isSavedInstance] = true;
}
export function searchDoc(instance) {
  return getQueryableValue(instance.constructor, instance);
}
function makeDescriptor(field) {
  let descriptor = {
    enumerable: true
  };
  descriptor.get = function () {
    return field.getter(this);
  };
  if (field.computeVia) {
    descriptor.set = function () {
      // computeds should just no-op when an assignment occurs
    };
  } else {
    descriptor.set = function (value) {
      if (field.card === ReadOnlyField && isCardInstance(this) && this[isSavedInstance]) {
        throw new Error(`cannot assign a value to the field '${field.name}' on the saved card '${this[field.name]}' because it is a read-only field`);
      }
      setField(this, field, value);
    };
  }
  descriptor.get[isField] = field;
  return descriptor;
}
function setField(instance, field, value) {
  propagateRealmContext(value, instance);
  // TODO: refactor validate to not have a return value and accomplish this normalization another way
  value = field.validate(instance, value);
  let deserialized = getDataBucket(instance);
  deserialized.set(field.name, value);
  notifySubscribers(instance, field.name, value);
  notifyCardTracking(instance);
}
function notifySubscribers(instance, fieldName, value, visited = new WeakSet()) {
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
    notifySubscribers(consumer.fieldOrCard, `${consumer.fieldName}.${fieldName}`, value, visited);
  }
}
function cardThunk(cardOrThunk) {
  if (!cardOrThunk) {
    throw new Error(`cardOrThunk was ${cardOrThunk}. There might be a cyclic dependency in one of your fields.
      Use '() => CardName' format for the fields with the cycle in all related cards.
      e.g.: '@field friend = linksTo(() => Person)'`);
  }
  return 'baseDef' in cardOrThunk ? () => cardOrThunk : cardOrThunk;
}
export function getComponent(model, field, opts) {
  let box = Box.create(model);
  let boxComponent = getBoxComponent(model.constructor, box, field, opts);
  return boxComponent;
}
export class Box {
  static create(model) {
    return new Box({
      type: 'root',
      model
    });
  }
  state;
  constructor(state) {
    this.state = state;
  }
  get value() {
    if (this.state.type === 'root') {
      return this.state.model;
    } else {
      return this.state.containingBox.value[this.state.fieldName];
    }
  }
  get name() {
    return this.state.type === 'derived' ? this.state.fieldName : undefined;
  }
  set value(v) {
    if (this.state.type === 'root') {
      throw new Error(`can't set topmost model`);
    } else {
      let value = this.state.containingBox.value;
      if (Array.isArray(value)) {
        let index = parseInt(this.state.fieldName);
        if (typeof index !== 'number') {
          throw new Error(`Cannot set a value on an array item with non-numeric index '${String(this.state.fieldName)}'`);
        }
        this.state.containingBox.value[index] = v;
        return;
      }
      this.state.containingBox.value[this.state.fieldName] = v;
    }
  }
  set = value => {
    this.value = value;
  };
  fieldBoxes = new Map();
  field(fieldName, useIndexBasedKeys = false) {
    let box = this.fieldBoxes.get(fieldName);
    if (!box) {
      box = new Box({
        type: 'derived',
        containingBox: this,
        fieldName: fieldName,
        useIndexBasedKeys
      });
      this.fieldBoxes.set(fieldName, box);
    }
    return box;
  }
  prevChildren = [];
  prevValues = [];
  get children() {
    if (this.state.type === 'root') {
      throw new Error('tried to call children() on root box');
    }
    let value = this.value;
    if (value == null) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new Error(`tried to call children() on Boxed non-array value ${value} for ${String(this.state.fieldName)}`);
    }
    let {
      prevChildren,
      prevValues,
      state
    } = this;
    let newChildren = value.map((element, index) => {
      let found = prevChildren.find((_oldBox, i) => state.useIndexBasedKeys ? index === i : this.prevValues[i] === element);
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
          useIndexBasedKeys: false
        });
      }
    });
    this.prevChildren = newChildren;
    this.prevValues = value.slice();
    return newChildren;
  }
}
function getStore(instance) {
  return stores.get(instance) ?? new FallbackCardStore();
}
function myLoader() {
  // we know this code is always loaded by an instance of our Loader, which sets
  // import.meta.loader.
  // When type-checking realm-server, tsc sees this file and thinks
  // it will be transpiled to CommonJS and so it complains about this line. But
  // this file is always loaded through our loader and always has access to import.meta.
  // @ts-ignore
  return import.meta.loader;
}
class FallbackCardStore {
  #instances = new Map();
  #fileMetaInstances = new Map();
  #inFlight = new Set();
  #loadGeneration = 0;
  getCard(id) {
    id = id.replace(/\.json$/, '');
    return this.#instances.get(id);
  }
  getFileMeta(id) {
    id = id.replace(/\.json$/, '');
    return this.#fileMetaInstances.get(id);
  }
  setCard(id, instance) {
    id = id.replace(/\.json$/, '');
    return this.#instances.set(id, instance);
  }
  setFileMeta(id, instance) {
    id = id.replace(/\.json$/, '');
    return this.#fileMetaInstances.set(id, instance);
  }
  setCardNonTracked(id, instance) {
    id = id.replace(/\.json$/, '');
    return this.#instances.set(id, instance);
  }
  setFileMetaNonTracked(id, instance) {
    id = id.replace(/\.json$/, '');
    return this.#fileMetaInstances.set(id, instance);
  }
  makeTracked(_id) {}
  trackLoad(load) {
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
      if (this.#inFlight.size === 0 && this.#loadGeneration === observedGeneration) {
        return;
      }
      observedGeneration = this.#loadGeneration;
    }
  }
  async loadCardDocument(url, opts) {
    trackRuntimeInstanceDependency(url, opts?.dependencyTrackingContext);
    let promise = loadCardDocument(fetch, url);
    this.trackLoad(promise);
    return await promise;
  }
  async loadFileMetaDocument(url, opts) {
    trackRuntimeFileDependency(url, opts?.dependencyTrackingContext);
    let promise = loadFileMetaDocument(fetch, url);
    this.trackLoad(promise);
    return await promise;
  }
  getSearchResource(_parent, _getQuery, _getRealms, _opts) {
    return {
      instances: [],
      instancesByRealm: [],
      isLoading: false,
      meta: {
        page: {
          total: 0
        }
      },
      errors: undefined
    };
  }
}