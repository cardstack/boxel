import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  BaseDef,
  type CardContext,
  type Box,
  type BoxComponent,
  type CardDef,
  type Field,
  type FieldDef,
  type Format,
} from './card-api';
import {
  BoxComponentSignature,
  DefaultFormatsConsumer,
  PermissionsConsumer,
  getBoxComponent,
} from './field-component';
import { AddButton, IconButton, Pill } from '@cardstack/boxel-ui/components';
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
  RealmURLContextName,
  getNarrowestType,
  Loader,
  isCardInstance,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { IconMinusCircle, IconX, FourLines } from '@cardstack/boxel-ui/icons';
import { eq } from '@cardstack/boxel-ui/helpers';
import { consume } from 'ember-provide-consume-context';
import {
  SortableGroupModifier as sortableGroup,
  SortableHandleModifier as sortableHandle,
  SortableItemModifier as sortableItem,
} from '@cardstack/boxel-ui/modifiers';

import { action } from '@ember/object';
import { initSharedState } from './shared-state';

interface Signature {
  Element: HTMLElement;
  Args: {
    model: Box<CardDef>;
    arrayField: Box<CardDef[]>;
    field: Field<typeof CardDef>;
    cardTypeFor(
      field: Field<typeof BaseDef>,
      boxedElement: Box<BaseDef>,
    ): typeof BaseDef;
    childFormat: 'atom' | 'fitted';
    typeConstraint?: ResolvedCodeRef;
  };
}

class LinksToManyEditor extends GlimmerComponent<Signature> {
  @consume(CardContextName) declare cardContext: CardContext;
  @consume(RealmURLContextName) declare realmURL: URL | undefined;

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
          ...attributes
        />
      {{else}}
        <LinksToManyStandardEditor
          @model={{@model}}
          @arrayField={{@arrayField}}
          @field={{@field}}
          @cardTypeFor={{@cardTypeFor}}
          @add={{this.add}}
          @remove={{this.remove}}
          ...attributes
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
    if (this.args.typeConstraint) {
      type = await getNarrowestType(this.args.typeConstraint, type, myLoader());
    }
    let filter = {
      every: [{ type }, ...selectedCardsQuery],
    };
    let cardId = await chooseCard(
      { filter },
      {
        offerToCreate: {
          ref: type,
          relativeTo: undefined,
          realmURL: this.realmURL,
        },
        multiSelect: true,
        createNewCard: this.cardContext?.actions?.createCard,
        consumingRealm: this.realmURL,
      },
    );
    if (cardId) {
      let card = await this.cardContext.store.get(cardId);
      if (isCardInstance(card)) {
        selectedCards = [...selectedCards, card];
        (this.args.model.value as any)[this.args.field.name] = selectedCards;
      }
    }
  });

  remove = (index: number) => {
    let cards = (this.args.model.value as any)[this.args.field.name];
    cards = cards.filter((_c: CardDef, i: number) => i !== index);
    (this.args.model.value as any)[this.args.field.name] = cards;
  };
}

interface LinksToManyStandardEditorSignature {
  Element: HTMLElement;
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

  @action
  setItems(items: any) {
    this.args.arrayField.set(items);
  }

  <template>
    <PermissionsConsumer as |permissions|>
      {{#if @arrayField.children.length}}
        <ul
          {{sortableGroup groupName=@field.name onChange=this.setItems}}
          class='list'
          data-test-list={{@field.name}}
          ...attributes
        >
          {{#each @arrayField.children as |boxedElement i|}}
            <li
              class='editor'
              data-test-item={{i}}
              {{sortableItem groupName=@field.name model=boxedElement.value}}
            >
              {{#if permissions.canWrite}}
                <IconButton
                  {{sortableHandle}}
                  @variant='primary'
                  @icon={{FourLines}}
                  @width='18px'
                  @height='18px'
                  class='sort'
                  aria-label='Sort'
                  data-test-sort-card
                  data-test-sort={{i}}
                />
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
                  (@cardTypeFor @field boxedElement) boxedElement @field
                )
                as |Item|
              }}
                <Item @format='fitted' />
              {{/let}}
            </li>
          {{/each}}
        </ul>
      {{/if}}

      {{#if permissions.canWrite}}
        <AddButton
          class='add-new'
          @variant='full-width'
          @iconWidth='12px'
          @iconHeight='12px'
          {{on 'click' @add}}
          data-test-add-new
        >
          Add
          {{getPlural @field.card.displayName}}
        </AddButton>
      {{/if}}
    </PermissionsConsumer>
    <style scoped>
      .list {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--boxel-sp);
      }
      .list > li + li {
        padding-top: var(--boxel-sp);
      }
      .editor {
        position: relative;
        display: grid;
        grid-template-columns: var(--boxel-icon-lg) 1fr var(--boxel-icon-lg);
      }
      .remove {
        --icon-color: var(--boxel-light);
        --icon-border: var(--boxel-dark);
        --icon-bg: var(--boxel-dark);
        align-self: auto;
        outline: 0;
        order: 1;
      }
      .remove:focus,
      .remove:hover {
        --icon-bg: var(--boxel-highlight);
        --icon-border: var(--boxel-highlight);
      }
      .remove:focus + :deep(.boxel-card-container.fitted-format),
      .remove:hover + :deep(.boxel-card-container.fitted-format) {
        box-shadow:
          0 0 0 1px var(--boxel-light-500),
          var(--boxel-box-shadow-hover);
      }
      .add-new {
        width: calc(100% - var(--boxel-icon-xxl));
        margin-left: var(--boxel-icon-lg);
        /* for alignment due to sort handle */
      }
      .sort {
        cursor: move;
        cursor: grab;
      }
      .sort:active {
        cursor: grabbing;
      }
      :deep(.is-dragging) {
        z-index: 99;
        transform: translateY(var(--boxel-sp));
      }
    </style>
  </template>
}

interface LinksToManyCompactEditorSignature {
  Element: HTMLElement;
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
    <div class='boxel-pills' data-test-pills ...attributes>
      {{#each @arrayField.children as |boxedElement i|}}
        {{#let
          (getBoxComponent
            (@cardTypeFor @field boxedElement) boxedElement @field
          )
          as |Item|
        }}
          <Pill class='item-pill' data-test-pill-item={{i}}>
            <Item @format='atom' @displayContainer={{false}} />
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
          </Pill>
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
    <style scoped>
      .boxel-pills {
        --boxel-add-button-pill-font: var(--boxel-font-sm);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
      }
      .remove-item-button {
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
      }
      .remove-item-button:hover {
        --icon-color: var(--boxel-600);
        color: var(--boxel-600);
      }
      .item-pill :deep(.atom-default-template:hover) {
        text-decoration: underline;
      }
      .item-pill:has(button:hover) {
        color: var(--boxel-600);
        border-color: var(--boxel-600);
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
  return 'fitted';
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
const componentCache = initSharedState(
  'linksToManyComponentCache',
  () => new WeakMap<Box<BaseDef[]>, { component: BoxComponent }>(),
);

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
  let stable = componentCache.get(arrayField);
  if (stable) {
    return stable.component;
  }
  let getComponents = () =>
    arrayField.children.map((child) =>
      getBoxComponent(cardTypeFor(field, child), child, field),
    ); // Wrap the the components in a function so that the template is reactive to changes in the model (this is essentially a helper)
  let isComputed = !!field.computeVia;
  let linksToManyComponent = class LinksToManyComponent extends GlimmerComponent<BoxComponentSignature> {
    <template>
      <DefaultFormatsConsumer as |defaultFormats|>
        {{#if (shouldRenderEditor @format defaultFormats.cardDef isComputed)}}
          <LinksToManyEditor
            @model={{model}}
            @arrayField={{arrayField}}
            @field={{field}}
            @cardTypeFor={{cardTypeFor}}
            @childFormat={{getEditorChildFormat
              @format
              defaultFormats.cardDef
              model
            }}
            @typeConstraint={{@typeConstraint}}
            ...attributes
          />
        {{else}}
          {{#let
            (coalesce @format defaultFormats.cardDef)
            (if (eq @displayContainer false) false true)
            as |effectiveFormat displayContainer|
          }}
            <div
              class='plural-field linksToMany-field
                {{effectiveFormat}}-effectiveFormat
                {{unless arrayField.children.length "empty"}}
                display-container-{{displayContainer}}'
              data-test-plural-view-field={{field.name}}
              data-test-plural-view={{field.fieldType}}
              data-test-plural-view-format={{effectiveFormat}}
              ...attributes
            >
              {{#each (getComponents) as |Item i|}}
                <Item
                  @format={{effectiveFormat}}
                  @displayContainer={{@displayContainer}}
                  class='linksToMany-item'
                  data-test-plural-view-item={{i}}
                />
              {{/each}}
            </div>
          {{/let}}
        {{/if}}
      </DefaultFormatsConsumer>
      <style scoped>
        @layer {
          .linksToMany-field.fitted-effectiveFormat
            > .linksToMany-item
            + .linksToMany-item,
          .linksToMany-field.embedded-effectiveFormat
            > .linksToMany-item
            + .linksToMany-item {
            margin-top: var(--boxel-sp);
          }
          .linksToMany-field.atom-effectiveFormat.display-container-false {
            display: contents;
          }
          .linksToMany-field.atom-effectiveFormat.display-container-true {
            display: inline-flex;
            gap: var(--boxel-sp-sm);
          }
        }
      </style>
    </template>
  };
  let proxy = new Proxy(linksToManyComponent, {
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
  stable = {
    component: proxy as unknown as BoxComponent,
  };

  componentCache.set(arrayField, stable);
  return stable.component;
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
