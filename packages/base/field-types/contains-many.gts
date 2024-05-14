export class ContainsMany<FieldT extends FieldDefConstructor>
  implements Field<FieldT, any[] | null>
{
  readonly fieldType = 'containsMany';
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

  getter(instance: BaseDef): BaseInstanceType<FieldT> {
    return getter(instance, this);
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
    return [...instances].map((instance) => {
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
    values: BaseInstanceType<FieldT>[],
    doc: JSONAPISingleResourceDocument,
    _visited: Set<string>,
    opts?: SerializeOpts,
  ): JSONAPIResource {
    if (primitive in this.card) {
      return {
        attributes: {
          [this.name]:
            values === null
              ? null
              : values.map((value) =>
                  callSerializeHook(this.card, value, doc, undefined, opts),
                ),
        },
      };
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
    _identityContext: undefined,
    instancePromise: Promise<BaseDef>,
    _loadedValue: any,
    relativeTo: URL | undefined,
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
