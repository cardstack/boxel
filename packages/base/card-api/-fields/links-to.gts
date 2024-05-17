import GlimmerComponent from '@glimmer/component';
import {
  type FieldType,
  type JSONAPISingleResourceDocument,
  type JSONAPIResource,
  fieldType,
  queryableValue,
  deserialize,
  isSavedInstance,
  realmURL,
  type RecomputeOptions,
  relativeTo,
  Format,
} from '../-constants';
import { cardThunk, type BaseInstanceType, type BaseDef } from '../-base-def';
import { makeDescriptor } from './decorator';
import { cardClassFromResource, makeRelativeURL, type Options } from './utils';
import {
  getter,
  type Field,
  type SerializeOpts,
  getDataBucket,
  cardTracking,
  isNotLoadedValue,
  NotLoadedValue,
} from './storage';
import { callSerializeHook, createFromSerialized } from '../-serialization';
import {
  type CardDocument,
  primitive,
  NotLoaded,
  isRelationship,
  Loader,
  getCard,
  trackCard,
  SupportedMimeType,
  CardError,
  isSingleCardDocument,
} from '@cardstack/runtime-common';
import { resourceFrom } from '../-serialization';
import { type Box } from '../-box';
import {
  DefaultFormatConsumer,
  type BoxComponent,
  fieldComponent,
  RealmSessionConsumer,
  DefaultFormatProvider,
  getBoxComponent,
} from '../-components/field-component';
import { type CardDef, type CardDefConstructor } from '../-card-def';
import { identityContexts, IdentityContext } from '../-identity-context';
import { on } from '@ember/modifier';
import {
  restartableTask,
  type EncapsulatedTaskDescriptor as Descriptor,
} from 'ember-concurrency';
import {
  chooseCard,
  baseCardRef,
  identifyCard,
  CardContextName,
} from '@cardstack/runtime-common';
import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
import { IconMinusCircle } from '@cardstack/boxel-ui/icons';
import { consume } from 'ember-provide-consume-context';
import { and } from '@cardstack/boxel-ui/helpers';
import { CardContext } from '../-components/utils';

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
          options?.description,
          options?.isUsed,
        ),
      );
    },
  } as any;
}
linksTo[fieldType] = 'linksTo' as FieldType;

class LinksTo<CardT extends CardDefConstructor> implements Field<CardT> {
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

interface LinksToEditorSignature {
  Args: {
    model: Box<CardDef | null>;
    field: Field<typeof CardDef>;
  };
}

export class LinksToEditor extends GlimmerComponent<LinksToEditorSignature> {
  @consume(CardContextName) declare cardContext: CardContext;

  <template>
    <RealmSessionConsumer as |realmSession|>
      <div class='links-to-editor' data-test-links-to-editor={{@field.name}}>
        {{#if (and realmSession.canWrite this.isEmpty)}}
          <AddButton
            class='add-new'
            @variant='full-width'
            @hideIcon={{true}}
            {{on 'click' this.add}}
            data-test-add-new
          >
            Link
            {{@field.card.displayName}}
          </AddButton>
        {{else}}
          {{#if realmSession.canWrite}}
            <IconButton
              @variant='primary'
              @icon={{IconMinusCircle}}
              @width='20px'
              @height='20px'
              class='remove'
              {{on 'click' this.remove}}
              disabled={{this.isEmpty}}
              aria-label='Remove'
              data-test-remove-card
            />
          {{/if}}
          <DefaultFormatProvider @value='embedded'>
            <this.linkedCard />
          </DefaultFormatProvider>
        {{/if}}
      </div>
    </RealmSessionConsumer>
    <style>
      .links-to-editor {
        --remove-icon-size: var(--boxel-icon-lg);
        position: relative;
        display: grid;
        grid-template-columns: 1fr var(--remove-icon-size);
      }
      .links-to-editor > :deep(.boxel-card-container.embedded-format) {
        order: -1;
      }
      .remove {
        --icon-color: var(--boxel-light);
        align-self: center;
        outline: 0;
      }
      .remove:focus,
      .remove:hover {
        --icon-bg: var(--boxel-dark);
        --icon-border: var(--boxel-dark);
      }
      .remove:focus + :deep(.boxel-card-container.embedded-format),
      .remove:hover + :deep(.boxel-card-container.embedded-format) {
        box-shadow:
          0 0 0 1px var(--boxel-light-500),
          var(--boxel-box-shadow-hover);
      }
    </style>
  </template>

  add = () => {
    (this.chooseCard as unknown as Descriptor<any, any[]>).perform();
  };

  create = () => {
    (this.createCard as unknown as Descriptor<any, any[]>).perform();
  };

  remove = () => {
    this.args.model.value = null;
  };

  get isEmpty() {
    return this.args.model.value == null;
  }

  get linkedCard() {
    if (this.args.model.value == null) {
      throw new Error(
        `can't make field component with box value of null for field ${this.args.field.name}`,
      );
    }
    let card = Reflect.getPrototypeOf(this.args.model.value)!
      .constructor as typeof BaseDef;
    return getBoxComponent(
      card,
      this.args.model as Box<BaseDef>,
      this.args.field,
    );
  }

  private chooseCard = restartableTask(async () => {
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let chosenCard: CardDef | undefined = await chooseCard(
      { filter: { type } },
      {
        offerToCreate: { ref: type, relativeTo: undefined },
        createNewCard: this.cardContext?.actions?.createCard,
      },
    );
    if (chosenCard) {
      this.args.model.value = chosenCard;
    }
  });

  private createCard = restartableTask(async () => {
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let newCard: CardDef | undefined =
      await this.cardContext?.actions?.createCard(type, undefined, {
        isLinkedCard: true,
      });
    if (newCard) {
      this.args.model.value = newCard;
    }
  });
}
