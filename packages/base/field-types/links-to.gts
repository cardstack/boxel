export class LinksTo<CardT extends CardDefConstructor> implements Field<CardT> {
  readonly fieldType = 'linksTo';
  constructor(
    private cardThunk: () => CardT,
    readonly computeVia: undefined | string | (() => unknown),
    readonly name: string,
    readonly description: string | undefined,
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
    let loader = Loader.getLoaderFor(this.card)!;
    let cardResource = getCard(new URL(value.links.self, relativeTo), {
      cachedOnly: true,
      loader,
    });
    await cardResource.loaded;
    let cachedInstance =
      cardResource.card ?? identityContext.identities.get(value.links.self);
    if (cachedInstance) {
      cachedInstance[isSavedInstance] = true;
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

    let clazz = await cardClassFromResource(resource, this.card, relativeTo);
    let deserialized = await clazz[deserialize](
      resource,
      relativeTo,
      doc,
      identityContext,
    );
    deserialized[isSavedInstance] = true;
    deserialized = trackCard(
      loader,
      deserialized,
      deserialized[realmURL]!,
    ) as BaseInstanceType<CardT>;
    return deserialized;
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
          `tried set ${value.constructor.name} as field '${this.name}' but it is not an instance of ${this.card.name}`,
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

  component(model: Box<CardDef>): BoxComponent {
    let isComputed = !!this.computeVia;
    let fieldName = this.name as keyof CardDef;
    let linksToField = this;
    let getInnerModel = () => {
      let innerModel = model.field(fieldName);
      return innerModel as unknown as Box<CardDef | null>;
    };
    function shouldRenderEditor(
      format: Format | undefined,
      defaultFormat: Format,
      isComputed: boolean,
    ) {
      return (format ?? defaultFormat) === 'edit' && !isComputed;
    }
    return class LinksToComponent extends GlimmerComponent<{
      Args: { Named: { format?: Format; displayContainer?: boolean } };
      Blocks: {};
    }> {
      <template>
        <DefaultFormatConsumer as |defaultFormat|>
          {{#if (shouldRenderEditor @format defaultFormat isComputed)}}
            <LinksToEditor @model={{(getInnerModel)}} @field={{linksToField}} />
          {{else}}
            {{#let (fieldComponent linksToField model) as |FieldComponent|}}
              <FieldComponent
                @format={{@format}}
                @displayContainer={{@displayContainer}}
              />
            {{/let}}
          {{/if}}
        </DefaultFormatConsumer>
      </template>
    };
  }
}
