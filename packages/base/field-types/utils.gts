export type FieldType = 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';

export interface Field<
  CardT extends BaseDefConstructor = BaseDefConstructor,
  SearchT = any,
> {
  card: CardT;
  name: string;
  fieldType: FieldType;
  computeVia: undefined | string | (() => unknown);
  description: undefined | string;
  // there exists cards that we only ever run in the host without
  // the isolated renderer (RoomField), which means that we cannot
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
  component(model: Box<BaseDef>): BoxComponent;
  getter(instance: BaseDef): BaseInstanceType<CardT>;
  queryableValue(value: any, stack: BaseDef[]): SearchT;
  // TODO remove this after feature flag is removed
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

export function cardTypeFor(
  field: Field<typeof BaseDef>,
  boxedElement: Box<BaseDef>,
): typeof BaseDef {
  if (primitive in field.card) {
    return field.card;
  }
  return Reflect.getPrototypeOf(boxedElement.value)!
    .constructor as typeof BaseDef;
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

export async function cardClassFromResource<CardT extends BaseDefConstructor>(
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

export function makeRelativeURL(
  maybeURL: string,
  opts?: SerializeOpts,
): string {
  return opts?.maybeRelativeURL ? opts.maybeRelativeURL(maybeURL) : maybeURL;
}
