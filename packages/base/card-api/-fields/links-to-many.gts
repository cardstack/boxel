import {
  type FieldType,
  type JSONAPISingleResourceDocument,
  type JSONAPIResource,
  fieldType,
  queryableValue,
  deserialize,
  useIndexBasedKey,
  isSavedInstance,
  realmURL,
  RecomputeOptions,
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
  recompute,
  getDataBucket,
  cardTracking,
  isNotLoadedValue,
  NotLoadedValue,
} from './storage';
import { callSerializeHook, createFromSerialized } from '../-serialization';
import {
  type CardDocument,
  type Relationship,
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
import { WatchedArray } from '../../watched-array';
import { notifySubscribers } from '../-subscriptions';
import { logger } from '../-logger';
import { resourceFrom } from '../-serialization';
import { type Box } from '../-box';
import {
  RealmSessionConsumer,
  type BoxComponent,
  getBoxComponent,
  DefaultFormatConsumer,
  BoxComponentSignature,
} from '../-components/field-component';
import { cardTypeFor, isCardOrField } from '../-type-utils';
import { type CardDef, type CardDefConstructor } from '../-card-def';
import { identityContexts, IdentityContext } from '../-identity-context';
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
import {
  restartableTask,
  type EncapsulatedTaskDescriptor as Descriptor,
} from 'ember-concurrency';
import {
  chooseCard,
  baseCardRef,
  identifyCard,
  getPlural,
  CardContextName,
} from '@cardstack/runtime-common';
import { IconMinusCircle, IconX } from '@cardstack/boxel-ui/icons';
import { eq } from '@cardstack/boxel-ui/helpers';
import { consume } from 'ember-provide-consume-context';
import { CardContext } from '../-components/utils';
import { FieldDef } from '../-field-def';

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
          options?.description,
          options?.isUsed,
        ),
      );
    },
  } as any;
}
linksToMany[fieldType] = 'linksToMany' as FieldType;

class LinksToMany<FieldT extends CardDefConstructor>
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

interface LinksToManyEditorSignature {
  Args: {
    model: Box<CardDef>;
    arrayField: Box<CardDef[]>;
    field: Field<typeof CardDef>;
    cardTypeFor(
      field: Field<typeof BaseDef>,
      boxedElement: Box<BaseDef>,
    ): typeof BaseDef;
    childFormat: 'atom' | 'embedded';
  };
}

class LinksToManyEditor extends GlimmerComponent<LinksToManyEditorSignature> {
  @consume(CardContextName) declare cardContext: CardContext;

  <template>
    <div class='links-to-many-editor' data-test-links-to-many={{@field.name}}>
      {{#if (eq @childFormat 'atom')}}
        <LinksToManyCompactEditor
          @model={{@model}}
          @arrayField={{@arrayField}}
          @field={{@field}}
          @cardTypeFor={{@cardTypeFor}}
          @add={{this.add}}
          @remove={{this.remove}}
        />
      {{else}}
        <LinksToManyStandardEditor
          @model={{@model}}
          @arrayField={{@arrayField}}
          @field={{@field}}
          @cardTypeFor={{@cardTypeFor}}
          @add={{this.add}}
          @remove={{this.remove}}
        />
      {{/if}}
    </div>
  </template>

  add = () => {
    (this.chooseCard as unknown as Descriptor<any, any[]>).perform();
  };

  private chooseCard = restartableTask(async () => {
    let selectedCards = (this.args.model.value as any)[this.args.field.name];
    let selectedCardsQuery =
      selectedCards?.map((card: any) => ({ not: { eq: { id: card.id } } })) ??
      [];
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let filter = { every: [{ type }, ...selectedCardsQuery] };
    let chosenCard: CardDef | undefined = await chooseCard(
      { filter },
      {
        offerToCreate: { ref: type, relativeTo: undefined },
        multiSelect: true,
        createNewCard: this.cardContext?.actions?.createCard,
      },
    );
    if (chosenCard) {
      selectedCards = [...selectedCards, chosenCard];
      (this.args.model.value as any)[this.args.field.name] = selectedCards;
    }
  });

  remove = (index: number) => {
    let cards = (this.args.model.value as any)[this.args.field.name];
    cards = cards.filter((_c: CardDef, i: number) => i !== index);
    (this.args.model.value as any)[this.args.field.name] = cards;
  };
}

interface LinksToManyStandardEditorSignature {
  Args: {
    model: Box<CardDef>;
    arrayField: Box<CardDef[]>;
    field: Field<typeof CardDef>;
    cardTypeFor(
      field: Field<typeof BaseDef>,
      boxedElement: Box<BaseDef>,
    ): typeof BaseDef;
    add: () => void;
    remove: (i: number) => void;
  };
}

class LinksToManyStandardEditor extends GlimmerComponent<LinksToManyStandardEditorSignature> {
  @consume(CardContextName) declare cardContext: CardContext;

  <template>
    <RealmSessionConsumer as |realmSession|>
      {{#if @arrayField.children.length}}
        <ul class='list'>
          {{#each @arrayField.children as |boxedElement i|}}
            <li class='editor' data-test-item={{i}}>
              {{#if realmSession.canWrite}}
                <IconButton
                  @variant='primary'
                  @icon={{IconMinusCircle}}
                  @width='20px'
                  @height='20px'
                  class='remove'
                  {{on 'click' (fn @remove i)}}
                  aria-label='Remove'
                  data-test-remove-card
                  data-test-remove={{i}}
                />
              {{/if}}
              {{#let
                (getBoxComponent
                  (this.args.cardTypeFor @field boxedElement)
                  boxedElement
                  @field
                )
                as |Item|
              }}
                <Item @format='embedded' />
              {{/let}}
            </li>
          {{/each}}
        </ul>
      {{/if}}

      {{#if realmSession.canWrite}}
        <AddButton
          class='add-new'
          @variant='full-width'
          {{on 'click' @add}}
          data-test-add-new
        >
          Add
          {{getPlural @field.card.displayName}}
        </AddButton>
      {{/if}}
    </RealmSessionConsumer>
    <style>
      .list {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--boxel-sp);
      }
      .list > li + li {
        margin-top: var(--boxel-sp);
      }
      .editor {
        position: relative;
        display: grid;
        grid-template-columns: 1fr var(--boxel-icon-lg);
      }
      .editor > :deep(.boxel-card-container.embedded-format) {
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
      .add-new {
        width: calc(100% - var(--boxel-icon-lg));
      }
    </style>
  </template>
}

interface LinksToManyCompactEditorSignature {
  Args: {
    model: Box<CardDef>;
    arrayField: Box<CardDef[]>;
    field: Field<typeof CardDef>;
    cardTypeFor(
      field: Field<typeof BaseDef>,
      boxedElement: Box<BaseDef>,
    ): typeof BaseDef;
    add: () => void;
    remove: (i: number) => void;
  };
}
class LinksToManyCompactEditor extends GlimmerComponent<LinksToManyCompactEditorSignature> {
  @consume(CardContextName) declare cardContext: CardContext;

  <template>
    <div class='boxel-pills' data-test-pills>
      {{#each @arrayField.children as |boxedElement i|}}
        {{#let
          (getBoxComponent
            (this.args.cardTypeFor @field boxedElement) boxedElement @field
          )
          as |Item|
        }}
          <div class='boxel-pills-container' data-test-pill-item={{i}}>
            <div class='boxel-pill'>
              <Item @format='atom' />
            </div>
            <IconButton
              @variant='primary'
              @icon={{IconX}}
              @width='10px'
              @height='10px'
              class='remove-item-button'
              {{on 'click' (fn @remove i)}}
              aria-label='Remove'
              data-test-remove-card
              data-test-remove={{i}}
            />
          </div>
        {{/let}}
      {{/each}}
      <AddButton
        class='add-new'
        @variant='pill'
        @iconWidth='12px'
        @iconHeight='12px'
        {{on 'click' @add}}
        data-test-add-new
      >
        Add
        {{@field.card.displayName}}
      </AddButton>
    </div>
    <style>
      .boxel-pills {
        display: flex;
        flex-wrap: wrap;

        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        --boxel-add-button-pill-font: var(--boxel-font-sm);
        gap: var(--boxel-sp-xs);
      }
      .boxel-pills-container {
        position: relative;
        height: fit-content;
      }
      .boxel-pill .atom-format.display-container-true {
        display: flex;
        justify-content: center;
        align-items: center;
        padding-right: var(--boxel-sp-lg);
        color: var(--boxel-dark);
      }
      .remove-item-button {
        --icon-color: var(--boxel-dark);
        position: absolute;
        right: 0;
        top: 0;

        width: 22px;
        height: 100%;
        display: flex;
        align-items: center;
        padding-right: var(--boxel-sp-xxs);
      }
    </style>
  </template>
}

function getEditorChildFormat(
  format: Format | undefined,
  defaultFormat: Format,
  model: Box<FieldDef>,
) {
  if (
    (format ?? defaultFormat) === 'edit' &&
    'isFieldDef' in model.value.constructor &&
    model.value.constructor.isFieldDef
  ) {
    return 'atom';
  }
  return 'embedded';
}

function coalesce<T>(arg1: T | undefined, arg2: T): T {
  return arg1 ?? arg2;
}

function shouldRenderEditor(
  format: Format | undefined,
  defaultFormat: Format,
  isComputed: boolean,
) {
  return (format ?? defaultFormat) === 'edit' && !isComputed;
}

export function getLinksToManyComponent({
  model,
  arrayField,
  field,
  cardTypeFor,
}: {
  model: Box<CardDef>;
  arrayField: Box<CardDef[]>;
  field: Field<typeof CardDef>;
  cardTypeFor(
    field: Field<typeof BaseDef>,
    boxedElement: Box<BaseDef>,
  ): typeof BaseDef;
}): BoxComponent {
  let getComponents = () =>
    arrayField.children.map((child) =>
      getBoxComponent(cardTypeFor(field, child), child, field),
    ); // Wrap the the components in a function so that the template is reactive to changes in the model (this is essentially a helper)
  let isComputed = !!field.computeVia;
  let linksToManyComponent = class LinksToManyComponent extends GlimmerComponent<BoxComponentSignature> {
    <template>
      <DefaultFormatConsumer as |defaultFormat|>
        {{#if (shouldRenderEditor @format defaultFormat isComputed)}}
          <LinksToManyEditor
            @model={{model}}
            @arrayField={{arrayField}}
            @field={{field}}
            @cardTypeFor={{cardTypeFor}}
            @childFormat={{getEditorChildFormat @format defaultFormat model}}
          />
        {{else}}
          {{#let (coalesce @format defaultFormat) as |effectiveFormat|}}
            <div
              class='plural-field linksToMany-field
                {{effectiveFormat}}-effectiveFormat
                {{unless arrayField.children.length "empty"}}'
              data-test-plural-view={{field.fieldType}}
              data-test-plural-view-format={{effectiveFormat}}
            >
              {{#each (getComponents) as |Item i|}}
                <div data-test-plural-view-item={{i}}>
                  <Item @format={{effectiveFormat}} />
                </div>
              {{/each}}
            </div>
          {{/let}}
        {{/if}}
      </DefaultFormatConsumer>
      <style>
        .linksToMany-field.embedded-format > div + div {
          margin-top: var(--boxel-sp);
        }
        .linksToMany-field.atom-format {
          display: flex;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-sm);
          border: var(--boxel-border);
          border-radius: var(--boxel-border-radius);
        }
      </style>
    </template>
  };
  return new Proxy(linksToManyComponent, {
    get(target, property, received) {
      // proxying the bare minimum of an Array in order to render within a
      // template. add more getters as necessary...
      let components = getComponents();

      if (property === Symbol.iterator) {
        return components[Symbol.iterator];
      }
      if (property === 'length') {
        return components.length;
      }
      if (typeof property === 'string' && property.match(/\d+/)) {
        return components[parseInt(property)];
      }
      return Reflect.get(target, property, received);
    },
    getPrototypeOf() {
      // This is necessary for Ember to be able to locate the template associated
      // with a proxied component. Our Proxy object won't be in the template WeakMap,
      // but we can pretend our Proxy object inherits from the true component, and
      // Ember's template lookup respects inheritance.
      return linksToManyComponent;
    },
  });
}
