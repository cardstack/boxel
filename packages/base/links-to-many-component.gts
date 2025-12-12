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
  CreateCardFn,
  CardCrudFunctions,
} from './card-api';
import {
  BoxComponentSignature,
  DefaultFormatsConsumer,
  PermissionsConsumer,
  getBoxComponent,
} from './field-component';
import { Button, IconButton, Pill } from '@cardstack/boxel-ui/components';
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
  uuidv4,
  CardCrudFunctionsContextName,
} from '@cardstack/runtime-common';
import {
  IconMinusCircle,
  IconX,
  FourLines,
  IconPlus,
} from '@cardstack/boxel-ui/icons';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
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
      overrides?: () => Map<string, typeof BaseDef> | undefined,
    ): typeof BaseDef;
    childFormat: 'atom' | 'fitted';
    typeConstraint?: ResolvedCodeRef;
    createCard?: CreateCardFn;
  };
}

class LinksToManyEditor extends GlimmerComponent<Signature> {
  @consume(CardContextName) declare cardContext: CardContext;
  @consume(CardCrudFunctionsContextName)
  declare cardCrudFunctions: CardCrudFunctions;
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
      selectedCards
        ?.map((card: any) =>
          card ? { not: { eq: { id: card.id } } } : undefined,
        )
        .filter(Boolean) ?? [];
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
        createNewCard: this.cardCrudFunctions?.createCard,
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
      overrides?: () => Map<string, typeof BaseDef> | undefined,
    ): typeof BaseDef;
    add: () => void;
    remove: (i: number) => void;
  };
}

class LinksToManyStandardEditor extends GlimmerComponent<LinksToManyStandardEditorSignature> {
  @consume(CardContextName) declare cardContext: CardContext;
  private sortableGroupId = uuidv4();

  @action
  setItems(items: any) {
    this.args.arrayField.set(items);
  }

  get decoratedChildren() {
    // Returning a fresh wrapper object with a nonce-backed key ensures we refresh
    // the child component identity after reordering. That keeps templates that
    // read directly from @model (instead of <@fields>) in sync.
    return this.args.arrayField.children.map((child, index) => ({
      box: child,
      index,
      key: index,
    }));
  }

  get noItems() {
    return this.args.arrayField.children.length === 0;
  }

  <template>
    <PermissionsConsumer as |permissions|>
      {{#if this.decoratedChildren.length}}
        <ul
          {{sortableGroup
            groupName=this.sortableGroupId
            onChange=this.setItems
          }}
          class='list'
          data-test-list={{@field.name}}
          ...attributes
        >
          {{#each this.decoratedChildren key='key' as |entry|}}
            <li
              class='editor {{if permissions.canWrite "can-write" "read-only"}}'
              data-test-item={{entry.index}}
              {{sortableItem
                groupName=this.sortableGroupId
                model=entry.box.value
              }}
            >
              {{#if permissions.canWrite}}
                <IconButton
                  {{sortableHandle}}
                  @icon={{FourLines}}
                  @width='18px'
                  @height='18px'
                  class='sort'
                  aria-label='Sort'
                  data-test-sort-card
                  data-test-sort={{entry.index}}
                />
                <IconButton
                  @icon={{IconMinusCircle}}
                  @width='20px'
                  @height='20px'
                  class='remove'
                  {{on 'click' (fn @remove entry.index)}}
                  aria-label='Remove'
                  data-test-remove-card
                  data-test-remove={{entry.index}}
                />
              {{/if}}
              {{#let
                (getBoxComponent
                  (@cardTypeFor @field entry.box) entry.box @field
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
        <Button
          class={{cn 'add-new' no-items=this.noItems}}
          @kind='muted'
          @size='tall'
          @rectangular={{true}}
          {{on 'click' @add}}
          data-test-add-new={{@field.name}}
        >
          <IconPlus class='icon' width='12px' height='12px' alt='plus' />
          Add
          {{getPlural @field.card.displayName}}
        </Button>
      {{/if}}
    </PermissionsConsumer>
    <style scoped>
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
        min-height: 65px;
      }
      .editor.read-only {
        grid-template-columns: 1fr;
      }
      .editor.can-write {
        grid-template-columns: var(--boxel-icon-sm) 1fr var(--boxel-icon-sm);
        gap: var(--boxel-sp-xs);
      }
      .remove {
        --icon-color: var(--background, var(--boxel-light));
        --icon-border: var(--foreground, var(--boxel-dark));
        --icon-bg: var(--foreground, var(--boxel-dark));
        --boxel-icon-button-width: var(--boxel-icon-sm);
        align-self: auto;
        outline: 0;
        order: 1;
        justify-content: end;
      }
      .remove:focus,
      .remove:hover {
        --icon-bg: var(--primary, var(--boxel-highlight));
        --icon-border: var(--primary, var(--boxel-highlight));
      }
      .remove:focus + :deep(.boxel-card-container),
      .remove:hover + :deep(.boxel-card-container),
      .sort:focus ~ :deep(.boxel-card-container),
      .sort:hover ~ :deep(.boxel-card-container) {
        box-shadow:
          0 0 0 1px var(--border, var(--boxel-300)),
          var(--boxel-box-shadow);
      }
      .add-new {
        gap: var(--boxel-sp-xxxs);
        width: fit-content;
        letter-spacing: var(--boxel-lsp-xs);
        margin-left: calc(var(--boxel-icon-sm) + var(--boxel-sp-xs));
        /* for alignment due to sort handle */
      }
      .add-new.no-items {
        margin-left: 0;
      }
      .sort {
        cursor: move;
        cursor: grab;
        --boxel-icon-button-width: var(--boxel-icon-sm);
        justify-content: start;
      }
      .sort:active {
        cursor: grabbing;
      }
      .sort:active ~ :deep(.boxel-card-container) {
        box-shadow:
          0 0 0 1px var(--border, var(--boxel-300)),
          var(--boxel-box-shadow-hover);
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
      overrides?: () => Map<string, typeof BaseDef> | undefined,
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
      <Button
        class='compact-add-new'
        @size='small'
        @kind='primary'
        @rectangular={{true}}
        {{on 'click' @add}}
        data-test-add-new={{@field.name}}
      >
        <IconPlus class='icon' width='12px' height='12px' alt='plus' />
        Add
        {{@field.card.displayName}}
      </Button>
    </div>
    <style scoped>
      .boxel-pills {
        --pill-border-radius: var(--boxel-border-radius-sm);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        border: 1px solid var(--border, var(--boxel-form-control-border-color));
        border-radius: var(--boxel-form-control-border-radius);
      }
      .remove-item-button {
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
      }
      .remove-item-button:hover {
        --icon-color: var(--card-foreground, var(--boxel-600));
        color: var(--card-foreground, var(--boxel-600));
      }
      .item-pill :deep(.atom-default-template:hover) {
        text-decoration: underline;
        cursor: pointer;
      }
      .item-pill {
        --pill-background-color: var(--card);
        --pill-font-color: var(--card-foreground);
      }
      .item-pill:has(button:hover) {
        --icon-color: var(--muted-foreground, var(--boxel-600));
        --pill-font-color: var(--muted-foreground, var(--boxel-600));
        --pill-border-color: var(--muted-foreground, var(--boxel-600));
      }
      .compact-add-new {
        gap: var(--boxel-sp-xxxs);
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

function getPluralChildFormat(effectiveFormat: Format, model: Box<FieldDef>) {
  if (
    effectiveFormat === 'edit' &&
    'isCardDef' in model.value.constructor &&
    model.value.constructor.isCardDef
  ) {
    return 'fitted';
  }
  return effectiveFormat;
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
    overrides?: () => Map<string, typeof BaseDef> | undefined,
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
                <div class='linksToMany-itemContainer'>
                  <Item
                    @format={{getPluralChildFormat effectiveFormat model}}
                    @displayContainer={{@displayContainer}}
                    class='linksToMany-item'
                    data-test-plural-view-item={{i}}
                  />
                </div>
              {{/each}}
            </div>
          {{/let}}
        {{/if}}
      </DefaultFormatsConsumer>
      <style scoped>
        @layer {
          .linksToMany-field.fitted-effectiveFormat
            > .linksToMany-itemContainer
            + .linksToMany-itemContainer,
          .linksToMany-field.embedded-effectiveFormat
            > .linksToMany-itemContainer
            + .linksToMany-itemContainer {
            margin-top: var(--boxel-sp);
          }
          .linksToMany-field.atom-effectiveFormat.display-container-false {
            display: contents;
          }
          .linksToMany-field.atom-effectiveFormat.display-container-true {
            display: inline-flex;
            gap: var(--boxel-sp-sm);
          }
          .linksToMany-field.fitted-effectiveFormat
            > .linksToMany-itemContainer {
            height: 65px;
          }
        }
      </style>
    </template>
  };
  let proxy = new Proxy(linksToManyComponent, {
    get(target, property, received) {
      // proxying the bare minimum of an Array in order to render within a
      // template. add more getters as necessary...
      if (property === Symbol.iterator) {
        // getComponents() is in the "hot" path, don't touch it unless absolutely necessary
        let components = getComponents();
        return components[Symbol.iterator];
      }
      if (property === 'length') {
        return arrayField.children.length;
      }
      if (typeof property === 'string' && property.match(/\d+/)) {
        let child = arrayField.children[parseInt(property)];
        if (!child) {
          return undefined;
        }
        return getBoxComponent(cardTypeFor(field, child), child, field);
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
