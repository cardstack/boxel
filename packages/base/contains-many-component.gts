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
} from './card-api';
import {
  type BoxComponentSignature,
  getBoxComponent,
  DefaultFormatConsumer,
  PermissionsConsumer,
} from './field-component';
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
    <PermissionsConsumer as |permissions|>
      <div class='contains-many-editor' data-test-contains-many={{@field.name}}>
        {{#if @arrayField.children.length}}
          <ul class='list'>
            {{#each @arrayField.children as |boxedElement i|}}
              <li class='editor' data-test-item={{i}}>
                {{#if permissions.canWrite}}
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
    </PermissionsConsumer>
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
