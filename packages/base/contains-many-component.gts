import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  primitive,
  type Box,
  type BoxComponent,
  type Format,
  type Field,
  type FieldDef,
  type BaseDef,
  type CardDef,
} from './card-api';
import { initSharedState } from './shared-state';
import {
  type BoxComponentSignature,
  getBoxComponent,
  DefaultFormatsConsumer,
  PermissionsConsumer,
} from './field-component';
import { Button, IconButton } from '@cardstack/boxel-ui/components';
import {
  getPlural,
  fields,
  type ResolvedCodeRef,
  Loader,
  loadCardDef,
  uuidv4,
  isCardInstance,
} from '@cardstack/runtime-common';
import { IconTrash, FourLines, IconPlus } from '@cardstack/boxel-ui/icons';
import { task } from 'ember-concurrency';
import { action } from '@ember/object';
import {
  SortableGroupModifier as sortableGroup,
  SortableHandleModifier as sortableHandle,
  SortableItemModifier as sortableItem,
} from '@cardstack/boxel-ui/modifiers';

interface ContainsManyEditorSignature {
  Args: {
    model: Box<FieldDef>;
    arrayField: Box<FieldDef[]>;
    field: Field<typeof FieldDef>;
    cardTypeFor(
      field: Field<typeof BaseDef>,
      boxedElement: Box<BaseDef>,
      overrides?: () => Map<string, typeof BaseDef> | undefined,
    ): typeof BaseDef;
    typeConstraint?: ResolvedCodeRef;
  };
}

class ContainsManyEditor extends GlimmerComponent<ContainsManyEditorSignature> {
  private sortableGroupId = uuidv4();

  @action
  setItems(items: any) {
    this.args.arrayField.set(items);
  }

  <template>
    <PermissionsConsumer as |permissions|>
      <div class='contains-many-editor' data-test-contains-many={{@field.name}}>
        {{#if @arrayField.children.length}}
          <ul
            {{sortableGroup
              groupName=this.sortableGroupId
              onChange=this.setItems
            }}
            class='list'
            data-test-list={{@field.name}}
          >
            {{#each @arrayField.children as |boxedElement i|}}
              <li
                class='editor
                  {{if permissions.canWrite "can-write" "read-only"}}'
                data-test-item={{i}}
                {{sortableItem
                  groupName=this.sortableGroupId
                  model=boxedElement.value
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
                    data-test-sort-handle
                    data-test-sort={{i}}
                  />
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
        {{#if permissions.canWrite}}
          <Button
            class='add-new'
            @kind='muted'
            @size='tall'
            @rectangular={{true}}
            {{on 'click' this.add}}
            data-test-add-new
          >
            <IconPlus class='icon' width='12px' height='12px' alt='plus' />
            Add
            {{getPlural @field.card.displayName}}
          </Button>
        {{/if}}
      </div>
    </PermissionsConsumer>
    <style scoped>
      .contains-many-editor {
        --remove-icon-size: var(--boxel-icon-lg);
      }
      .contains-many-editor :deep(.compound-field.edit-format .add-new) {
        border: 1px solid var(--border, var(--boxel-border-color));
      }
      .list {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--boxel-sp);
      }
      .editor {
        position: relative;
        display: grid;
      }
      .editor.read-only {
        grid-template-columns: 1fr;
      }
      .editor.can-write {
        grid-template-columns: var(--boxel-icon-lg) 1fr var(--remove-icon-size);
      }
      .editor + .editor {
        margin-top: var(--boxel-sp-xs);
      }
      .item-container {
        padding: var(--boxel-sp);
        background-color: var(--muted, var(--boxel-100));
        border-radius: var(--boxel-form-control-border-radius);
        transition: background-color var(--boxel-transition);
      }
      .remove {
        --icon-color: currentColor;
        --icon-stroke-width: 1.5px;
        align-self: auto;
        outline: 0;
        order: 1;
      }
      .remove:focus,
      .remove:hover {
        --icon-color: var(--destructive, var(--boxel-danger));
        outline: 0;
      }
      .remove:focus + .item-container,
      .remove:hover + .item-container,
      .sort:active ~ .item-container,
      .sort:hover ~ .item-container {
        background-color: var(--accent, var(--boxel-200));
        color: var(--accent-foreground);
      }
      .sort:active ~ .item-container {
        box-shadow: var(--boxel-box-shadow-hover);
      }
      .add-new {
        gap: var(--boxel-sp-xxxs);
        width: fit-content;
        letter-spacing: var(--boxel-lsp-xs);
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

  addField = task(async () => {
    let newValue: FieldDef | null =
      primitive in this.args.field.card ? null : new this.args.field.card();
    if (this.args.typeConstraint) {
      let subclassField = await loadCardDef(this.args.typeConstraint, {
        loader: myLoader(),
      });
      newValue = new subclassField();
    }
    (this.args.model.value as any)[this.args.field.name].push(newValue);
  });

  add = () => {
    this.addField.perform();
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

const overridesCache = initSharedState(
  'overridesCache',
  () => new WeakMap<CardDef, Map<string, typeof BaseDef>>(),
);

function setOverrides(maybeInstance: any) {
  if (isCardInstance(maybeInstance)) {
    let instance = maybeInstance;
    let overrides = new Map<string, typeof BaseDef>(
      Object.entries(instance[fields]!),
    );
    overridesCache.set(instance, overrides);
  }
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
    overrides?: () => Map<string, typeof BaseDef> | undefined,
  ): typeof BaseDef;
}): BoxComponent {
  // Wrap the the components in a function so that the template is reactive
  // to changes in the model (this is essentially a helper)
  let getComponents = () =>
    arrayField.children.map((child) =>
      getBoxComponent(
        cardTypeFor(field, child, () =>
          isCardInstance(model.value as CardDef)
            ? overridesCache.get(model.value as CardDef)
            : undefined,
        ),
        child,
        field,
      ),
    );
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
      console.warn(
        'We intentionally DO NOT render a contains-many editor when the plural field is nested inside another field. The decision of what to display is complex and should be user-defined',
      );
      return false;
    }
    if (isComputed) {
      return false;
    }
    return (format ?? defaultFormat) === 'edit';
  }
  let containsManyComponent = class ContainsManyComponent extends GlimmerComponent<BoxComponentSignature> {
    <template>
      <DefaultFormatsConsumer as |defaultFormats|>
        {{setOverrides model.value}}
        {{#if (shouldRenderEditor @format defaultFormats.fieldDef isComputed)}}
          <ContainsManyEditor
            @model={{model}}
            @arrayField={{arrayField}}
            @field={{field}}
            @cardTypeFor={{cardTypeFor}}
            @typeConstraint={{@typeConstraint}}
          />
        {{else}}
          {{#let
            (coalesce @format defaultFormats.fieldDef)
            as |effectiveFormat|
          }}
            <div
              class='plural-field containsMany-field
                {{effectiveFormat}}-format
                {{unless arrayField.children.length "empty"}}'
              data-test-plural-view={{field.fieldType}}
              data-test-plural-view-format={{effectiveFormat}}
              ...attributes
            >
              {{#each (getComponents) as |Item i|}}
                <div class='containsMany-item' data-test-plural-view-item={{i}}>
                  <Item
                    @format={{getPluralChildFormat effectiveFormat model}}
                  />
                </div>
              {{/each}}
            </div>
          {{/let}}
        {{/if}}
      </DefaultFormatsConsumer>
      <style scoped>
        @layer {
          .containsMany-field.edit-format {
            padding: var(--boxel-sp-sm);
            background-color: var(--muted, var(--boxel-100));
            border: none !important;
            border-radius: var(--boxel-border-radius);
          }
          .containsMany-field.atom-format {
            display: contents;
          }
          .containsMany-field.atom-format > .containsMany-item {
            display: inline;
          }
          .containsMany-field.embedded-format {
            display: grid;
            gap: var(--boxel-sp);
          }
        }
      </style>
    </template>
  };
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

function myLoader(): Loader {
  // we know this code is always loaded by an instance of our Loader, which sets
  // import.meta.loader.

  // When type-checking realm-server, tsc sees this file and thinks
  // it will be transpiled to CommonJS and so it complains about this line. But
  // this file is always loaded through our loader and always has access to import.meta.
  // @ts-ignore
  return (import.meta as any).loader;
}
