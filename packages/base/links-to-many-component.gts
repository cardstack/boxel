import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn, get } from '@ember/helper';
import {
  BaseDef,
  type CardContext,
  type Box,
  type BoxComponent,
  type CardDef,
  type Field,
  type FieldDef,
  type Format,
  type LinkableDefConstructor,
  CreateCardFn,
  CardCrudFunctions,
  isFileDef,
  brokenLinkFormat,
} from './card-api';
import BrokenLinkTemplate from './default-templates/broken-link-template';
import { getRelationship, type RelationshipState } from './field-support';
import { rawArrayValues } from './watched-array';
import {
  BoxComponentSignature,
  DefaultFormatsConsumer,
  PermissionsConsumer,
  getBoxComponent,
} from './field-component';
import { Button, IconButton, Pill } from '@cardstack/boxel-ui/components';
import { restartableTask } from 'ember-concurrency';
import {
  chooseCard,
  chooseFile,
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
  CardErrorJSONAPI,
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
    field: Field<LinkableDefConstructor>;
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
    this.chooseCard.perform();
  };

  private chooseCard = restartableTask(async () => {
    if (isFileDef(this.args.field.card)) {
      let fileType = identifyCard(this.args.field.card);
      let fileTypeName = this.args.field.card.displayName;
      let file = await chooseFile(
        fileType ? { fileType, fileTypeName } : undefined,
      );
      if (file) {
        // Rebuild from the raw backing array so any broken sibling slot keeps
        // its sentinel instead of collapsing to `undefined` (per-slot reads are
        // masked). The new file is appended after the existing entries.
        let existing = rawArrayValues(
          (this.args.model.value as any)[this.args.field.name] ?? [],
        );
        (this.args.model.value as any)[this.args.field.name] = [
          ...existing,
          file,
        ];
      }
      return;
    }
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
      let cardsOrCardErrors = (await Promise.all(
        cardId.map((id: string) => this.cardContext.store.get(id)),
      )) as (CardDef | CardErrorJSONAPI)[];
      let newCards = cardsOrCardErrors.filter((card) =>
        isCardInstance(card),
      ) as CardDef[];
      if (newCards.length > 0) {
        // `selectedCards` above is the masked read used only to build the
        // already-selected query filter. Rebuild the field from the raw backing
        // array so broken sibling slots keep their sentinels rather than
        // collapsing to `undefined` on append.
        let existing = rawArrayValues(
          (this.args.model.value as any)[this.args.field.name] ?? [],
        );
        (this.args.model.value as any)[this.args.field.name] = [
          ...existing,
          ...newCards,
        ];
      }
    }
  });

  remove = (index: number) => {
    // Drop the slot by position on the raw backing array so the other slots —
    // including any broken sentinels — are preserved verbatim. Filtering the
    // masked field value would turn every other broken slot into `undefined`.
    let raw = rawArrayValues<CardDef>(
      (this.args.model.value as any)[this.args.field.name] ?? [],
    );
    (this.args.model.value as any)[this.args.field.name] = raw.filter(
      (_c, i) => i !== index,
    );
  };
}

interface LinksToManyStandardEditorSignature {
  Element: HTMLElement;
  Args: {
    model: Box<CardDef>;
    arrayField: Box<CardDef[]>;
    field: Field<LinkableDefConstructor>;
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
    //
    // `broken` carries the per-slot terminal failure state (read once here via a
    // pure `getRelationship`) so a broken element shows the placeholder + remove
    // affordance instead of trying to render a sentinel as a card. The `{{#each}}`
    // still keys on the stable index `key`, so adding this never changes block
    // identity and an input elsewhere in the edit form keeps focus.
    let broken = brokenSlotsFor(this.args.model, this.args.field.name);
    // `raw` is the per-slot backing value handed to ember-sortable as its item
    // model. A broken slot's masked value is `undefined` (non-unique and lossy
    // across a reorder), so we pass the raw entry — the card for a present slot,
    // the sentinel object for a broken one — as an opaque, stable token. This is
    // never inspected here; it only keeps reorder from dropping broken slots.
    let raw = rawArrayValues(this.args.arrayField.value ?? []);
    return this.args.arrayField.children.map((child, index) => ({
      box: child,
      index,
      key: index,
      broken: broken[index],
      raw: raw[index],
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
              {{sortableItem groupName=this.sortableGroupId model=entry.raw}}
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
              {{#if entry.broken}}
                <BrokenLinkTemplate
                  @brokenUrl={{entry.broken.reference}}
                  @errorDoc={{entry.broken.errorDoc}}
                  @state={{entry.broken.kind}}
                  @format='fitted'
                  data-test-plural-view-item={{entry.index}}
                />
              {{else}}
                {{#let
                  (getBoxComponent
                    (@cardTypeFor @field entry.box) entry.box @field
                  )
                  as |Item|
                }}
                  <Item @format='fitted' />
                {{/let}}
              {{/if}}
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
        grid-template-columns: auto 1fr auto;
        gap: var(--boxel-sp-xs);
        align-items: center;
      }
      .remove {
        --icon-color: var(--background, var(--boxel-light));
        --icon-border: var(--foreground, var(--boxel-dark));
        --icon-bg: var(--foreground, var(--boxel-dark));
        --boxel-icon-button-width: var(--boxel-icon-med);
        --boxel-icon-button-height: var(--boxel-icon-med);
        outline: 0;
        order: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
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
        margin-left: calc(var(--boxel-icon-med) + var(--boxel-sp-xs));
        /* for alignment due to sort handle */
      }
      .add-new.no-items {
        margin-left: 0;
      }
      .sort {
        cursor: move;
        cursor: grab;
        --boxel-icon-button-width: var(--boxel-icon-med);
        --boxel-icon-button-height: var(--boxel-icon-med);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 5px;
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
    field: Field<LinkableDefConstructor>;
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

  // Per-slot broken-link state, read once per render via a pure
  // `getRelationship`. The `{{#each}}` keeps keying on the stable child box, so
  // this only drives the inner branch that swaps a broken card for the
  // placeholder and never destabilizes a sibling pill mid-edit.
  get brokenSlots() {
    return brokenSlotsFor(this.args.model, this.args.field.name);
  }

  <template>
    <div class='boxel-pills' data-test-pills ...attributes>
      {{#let this.brokenSlots as |brokenSlots|}}
        {{#each @arrayField.children as |boxedElement i|}}
          {{#let (get brokenSlots i) as |broken|}}
            {{#if broken}}
              <Pill class='item-pill' data-test-pill-item={{i}}>
                <BrokenLinkTemplate
                  @brokenUrl={{broken.reference}}
                  @errorDoc={{broken.errorDoc}}
                  @state={{broken.kind}}
                  @format='atom'
                  data-test-plural-view-item={{i}}
                />
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
            {{else}}
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
            {{/if}}
          {{/let}}
        {{/each}}
      {{/let}}
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

function getPluralChildFormat(
  effectiveFormat: Format,
  model: Box<FieldDef>,
  isFileDef: boolean,
) {
  if (
    effectiveFormat === 'edit' &&
    (('isCardDef' in model.value.constructor &&
      model.value.constructor.isCardDef) ||
      isFileDef)
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

type BrokenSlot = Extract<RelationshipState, { kind: 'error' | 'not-found' }>;

// Per-slot broken-link state for a `linksToMany` field, index-aligned with
// `arrayField.children`: a terminal failure (`error` / `not-found`) at slot `i`
// surfaces here; every other kind — `present`, `not-loaded`, `not-set` — is
// `undefined`, so the caller falls through to its normal per-item render.
//
// `getRelationship` is a pure read (it never retriggers `lazilyLoadLink`) and
// returns a FRESH array on every call, so callers MUST NOT key a `{{#each}}` on
// these entries; read it once per render and index into the result by the slot
// position the surrounding loop already keys on. A computed whole-field sentinel
// surfaces as a one-element array while the field getter yields an empty child
// list, so the lengths can differ — indexing by the child position is safe
// because the extra entry is never read.
function brokenSlotsFor(
  model: Box<CardDef>,
  fieldName: string,
): (BrokenSlot | undefined)[] {
  let owner = model.value;
  if (owner == null) {
    return [];
  }
  let state = getRelationship(owner, fieldName);
  let states = Array.isArray(state) ? state : [state];
  return states.map((rel) =>
    rel.kind === 'error' || rel.kind === 'not-found' ? rel : undefined,
  );
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
  field: Field<LinkableDefConstructor>;
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
  // Read per-slot broken-link state once per render (a pure read), index-aligned
  // with getComponents() above. The `{{#each}}` keeps keying on the stable
  // per-child component identity; this only feeds the inner branch that swaps in
  // the placeholder, so a broken slot never destabilizes its siblings.
  let getBrokenSlots = () => brokenSlotsFor(model, field.name);
  let isComputed = !!field.computeVia || !!field.queryDefinition;
  let isFileDefField = isFileDef(field.card);
  let linksToManyComponent = class LinksToManyComponent extends GlimmerComponent<BoxComponentSignature> {
    <template>
      <DefaultFormatsConsumer as |defaultFormats|>
        {{#if (shouldRenderEditor @format defaultFormats.cardDef isComputed)}}
          {{#if field.edit}}
            {{!-- Per-usage edit override on a linksToMany. Contract
                  mirrors containsMany: the override receives the
                  containing card as @model, the current values array
                  as @values, and a pre-bound default LinksToManyEditor
                  as @defaultEditor so it can wrap the standard iteration
                  / add / remove UI without reimplementing it. --}}
            <field.edit
              @model={{model.value}}
              @values={{arrayField.value}}
              @defaultEditor={{(component
                LinksToManyEditor
                model=model
                arrayField=arrayField
                field=field
                cardTypeFor=cardTypeFor
                childFormat=(getEditorChildFormat
                  @format
                  defaultFormats.cardDef
                  model
                )
                typeConstraint=@typeConstraint
              )}}
            />
          {{else}}
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
          {{/if}}
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
              {{#let (getBrokenSlots) as |brokenSlots|}}
                {{#each (getComponents) as |Item i|}}
                  <div class='linksToMany-itemContainer'>
                    {{#let (get brokenSlots i) as |broken|}}
                      {{#if broken}}
                        <BrokenLinkTemplate
                          @brokenUrl={{broken.reference}}
                          @errorDoc={{broken.errorDoc}}
                          @state={{broken.kind}}
                          @format={{brokenLinkFormat
                            effectiveFormat
                            effectiveFormat
                          }}
                          data-test-plural-view-item={{i}}
                        />
                      {{else}}
                        <Item
                          @format={{getPluralChildFormat
                            effectiveFormat
                            model
                            isFileDefField
                          }}
                          @displayContainer={{@displayContainer}}
                          class='linksToMany-item'
                          data-test-plural-view-item={{i}}
                        />
                      {{/if}}
                    {{/let}}
                  </div>
                {{/each}}
              {{/let}}
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
