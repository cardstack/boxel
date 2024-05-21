import FieldDef, { type FieldDefConstructor } from '../../field-def';
import {
  type FieldType,
  type JSONAPISingleResourceDocument,
  type JSONAPIResource,
  fieldType,
  queryableValue,
  deserialize,
  useIndexBasedKey,
  Format,
} from '../-constants';
import { cardThunk, type BaseInstanceType, type BaseDef } from '../-base-def';
import { makeDescriptor } from './decorator';
import { cardClassFromResource, type Options } from './utils';
import { getter, type Field, type SerializeOpts, recompute } from './storage';
import { callSerializeHook } from '../-serialization';
import {
  primitive,
  type CardDocument,
  type CardFields,
  type LooseCardResource,
  type Meta,
  type NotLoaded,
  type Relationship,
} from '@cardstack/runtime-common';
import { WatchedArray } from '../../watched-array';
import { notifySubscribers } from '../-subscriptions';
import { logger } from '../-logger';
import { makeMetaForField } from '../-serialization';
import { type Box } from '../-box';
import {
  RealmSessionConsumer,
  type BoxComponent,
  getBoxComponent,
  DefaultFormatConsumer,
  BoxComponentSignature,
} from '../-components/field-component';
import { cardTypeFor } from '../-type-utils';

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
          options?.description,
          options?.isUsed,
        ),
      );
    },
  } as any;
}
containsMany[fieldType] = 'contains-many' as FieldType;

class ContainsMany<FieldT extends FieldDefConstructor>
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
          notifySubscribers(instance, this.name, arrayValue);
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

import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
import { getPlural } from '@cardstack/runtime-common';
import { IconTrash } from '@cardstack/boxel-ui/icons';
import { TemplateOnlyComponent } from '@ember/component/template-only';

interface ContainsManyEditorSignature {
  Args: {
    model: Box<FieldDef>;
    arrayField: Box<FieldDef[]>;
    field: Field<typeof FieldDef>;
    cardTypeFor(
      field: Field<typeof BaseDef>,
      boxedElement: Box<BaseDef>,
    ): typeof BaseDef;
  };
}

class ContainsManyEditor extends GlimmerComponent<ContainsManyEditorSignature> {
  <template>
    <RealmSessionConsumer as |realmSession|>
      <div class='contains-many-editor' data-test-contains-many={{@field.name}}>
        {{#if @arrayField.children.length}}
          <ul class='list'>
            {{#each @arrayField.children as |boxedElement i|}}
              <li class='editor' data-test-item={{i}}>
                {{#if realmSession.canWrite}}
                  <IconButton
                    @icon={{IconTrash}}
                    @width='18px'
                    @height='18px'
                    class='remove'
                    {{on 'click' (fn this.remove i)}}
                    data-test-remove={{i}}
                    aria-label='Remove'
                  />
                {{/if}}
                <div class='item-container'>
                  {{#let
                    (getBoxComponent
                      (@cardTypeFor @field boxedElement) boxedElement @field
                    )
                    as |Item|
                  }}
                    <Item />
                  {{/let}}
                </div>
              </li>
            {{/each}}
          </ul>
        {{/if}}
        {{#if realmSession.canWrite}}
          <AddButton
            class='add-new'
            @variant='full-width'
            {{on 'click' this.add}}
            data-test-add-new
          >
            Add
            {{getPlural @field.card.displayName}}
          </AddButton>
        {{/if}}
      </div>
    </RealmSessionConsumer>
    <style>
      .contains-many-editor {
        --remove-icon-size: var(--boxel-icon-lg);
      }
      .list {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--boxel-sp);
      }
      .editor {
        position: relative;
        display: grid;
        grid-template-columns: 1fr var(--remove-icon-size);
      }
      .editor :deep(.boxel-input:hover) {
        border-color: var(--boxel-form-control-border-color);
      }
      .editor + .editor {
        margin-top: var(--boxel-sp-xs);
      }
      .item-container {
        padding: var(--boxel-sp);
        background-color: var(--boxel-100);
        border-radius: var(--boxel-form-control-border-radius);
        order: -1;
        transition: background-color var(--boxel-transition);
      }
      .remove {
        --icon-color: var(--boxel-dark);
        --icon-stroke-width: 1.5px;
      }
      .remove:focus,
      .remove:hover {
        --icon-color: var(--boxel-red);
        outline: 0;
      }
      .remove:focus + .item-container,
      .remove:hover + .item-container {
        background-color: var(--boxel-200);
      }
      .add-new {
        width: calc(100% - var(--remove-icon-size));
      }
    </style>
  </template>

  add = () => {
    // TODO probably each field card should have the ability to say what a new item should be
    let newValue =
      primitive in this.args.field.card ? null : new this.args.field.card();
    (this.args.model.value as any)[this.args.field.name].push(newValue);
  };

  remove = (index: number) => {
    (this.args.model.value as any)[this.args.field.name].splice(index, 1);
  };
}

function getPluralChildFormat(effectiveFormat: Format, model: Box<FieldDef>) {
  if (
    effectiveFormat === 'edit' &&
    'isFieldDef' in model.value.constructor &&
    model.value.constructor.isFieldDef
  ) {
    return 'atom';
  }
  return effectiveFormat;
}

function coalesce<T>(arg1: T | undefined, arg2: T): T {
  return arg1 ?? arg2;
}

export function getContainsManyComponent({
  model,
  arrayField,
  field,
  cardTypeFor,
}: {
  model: Box<FieldDef>;
  arrayField: Box<FieldDef[]>;
  field: Field<typeof FieldDef>;
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
  function shouldRenderEditor(
    format: Format | undefined,
    defaultFormat: Format,
    isComputed: boolean,
  ) {
    if (
      'isFieldDef' in model.value.constructor &&
      model.value.constructor.isFieldDef
    ) {
      return false;
    }
    if (isComputed) {
      return false;
    }
    return (format ?? defaultFormat) === 'edit';
  }
  let containsManyComponent: TemplateOnlyComponent<BoxComponentSignature> =
    <template>
      <DefaultFormatConsumer as |defaultFormat|>
        {{#if (shouldRenderEditor @format defaultFormat isComputed)}}
          <ContainsManyEditor
            @model={{model}}
            @arrayField={{arrayField}}
            @field={{field}}
            @cardTypeFor={{cardTypeFor}}
          />
        {{else}}
          {{#let (coalesce @format defaultFormat) as |effectiveFormat|}}
            <div
              class='plural-field containsMany-field
                {{effectiveFormat}}-format
                {{unless arrayField.children.length "empty"}}'
              data-test-plural-view={{field.fieldType}}
              data-test-plural-view-format={{effectiveFormat}}
            >
              {{#each (getComponents) as |Item i|}}
                <div data-test-plural-view-item={{i}}>
                  <Item
                    @format={{getPluralChildFormat effectiveFormat model}}
                  />
                </div>
              {{/each}}
            </div>
          {{/let}}
        {{/if}}
      </DefaultFormatConsumer>
      <style>
        .containsMany-field.edit-format {
          padding: var(--boxel-sp-sm);
          background-color: var(--boxel-100);
          border: none !important;
          border-radius: var(--boxel-border-radius);
        }
      </style>
    </template>;
  return new Proxy(containsManyComponent, {
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
      return containsManyComponent;
    },
  });
}
