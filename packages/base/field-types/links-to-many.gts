export class LinksToMany<FieldT extends CardDefConstructor>
  implements Field<FieldT, any[] | null>
{
  readonly fieldType = 'linksToMany';
  constructor(
    private cardThunk: () => FieldT,
    readonly computeVia: undefined | string | (() => unknown),
    readonly name: string,
    readonly description: string | undefined,
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
  ): (value: any[] | null) => boolean | null {
    return (value) => {
      if (Array.isArray(value) && value.length === 0) {
        return innerMatcher(null);
      }
      return (
        Array.isArray(value) &&
        value.some((innerValue) => {
          return innerMatcher(innerValue);
        })
      );
    };
  }

  serialize(
    values: BaseInstanceType<FieldT>[] | null | undefined,
    doc: JSONAPISingleResourceDocument,
    visited: Set<string>,
    opts?: SerializeOpts,
  ) {
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
          return cachedInstance;
        }
        let resourceId = new URL(value.links.self, relativeTo).href;
        let resource = resourceFrom(doc, resourceId);
        if (!resource) {
          if (loadedValues && Array.isArray(loadedValues)) {
            let loadedValue = loadedValues.find(
              (v) => isCardOrField(v) && 'id' in v && v.id === resourceId,
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
        let clazz = await cardClassFromResource(
          resource,
          this.card,
          relativeTo,
        );
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
        ) as BaseInstanceType<FieldT>;
        return deserialized;
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
          `tried set ${value.constructor.name} as field '${this.name}' but it is not an instance of ${this.card.name}`,
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
