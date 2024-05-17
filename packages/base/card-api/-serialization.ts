import {
  type CardDocument,
  type CardResource,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type Relationship,
  identifyCard,
  isCardInstance as _isCardInstance,
  isCardResource,
  primitive,
  Deferred,
  getField,
  isSingleCardDocument,
  maybeURL,
  maybeRelativeURL,
  Meta,
  Loader,
  loadCard,
  humanReadable,
} from '@cardstack/runtime-common';
import {
  type BaseDef,
  type BaseDefConstructor,
  type BaseInstanceType,
} from './-base-def';
import { IdentityContext, identityContexts } from './-identity-context';
import {
  type JSONAPIResource,
  type JSONAPISingleResourceDocument,
  deserialize,
  isSavedInstance,
  realmInfo,
  realmURL,
  relativeTo,
  serialize,
} from './-constants';
import { type CardDef } from './-card-def';
import { isCardOrField } from './-type-utils';
import { merge } from 'lodash';
import {
  getDataBucket,
  getFields,
  getter,
  isNotLoadedValue,
  peekAtField,
  recompute,
  type SerializeOpts,
} from './-fields/storage';
import { migrateSubscribers } from './-subscriptions';
import { logger } from './-logger';

export function serializeCardResource(
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

export async function _createFromSerialized<T extends BaseDefConstructor>(
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

// The typescript `is` type here refuses to work unless it's in this file.
function isCardInstance(instance: any): instance is CardDef {
  return _isCardInstance(instance);
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

export function callSerializeHook(
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

export function resourceFrom(
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

export function makeMetaForField(
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
