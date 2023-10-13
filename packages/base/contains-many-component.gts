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
import { getBoxComponent, getPluralViewComponent } from './field-component';
import { AddButton, IconButton } from '@cardstack/boxel-ui';
import { getPlural } from '@cardstack/runtime-common';

interface Signature {
  Args: {
    model: Box<FieldDef>;
    arrayField: Box<FieldDef[]>;
    format: Format;
    field: Field<typeof FieldDef>;
    cardTypeFor(
      field: Field<typeof BaseDef>,
      boxedElement: Box<BaseDef>,
    ): typeof BaseDef;
  };
}

class ContainsManyEditor extends GlimmerComponent<Signature> {
  <template>
    <div data-test-contains-many={{@field.name}}>
      {{#if @arrayField.children.length}}
        <ul class='list'>
          {{#each @arrayField.children as |boxedElement i|}}
            <li class='editor' data-test-item={{i}}>
              {{#let
                (getBoxComponent
                  (@cardTypeFor @field boxedElement) @format boxedElement @field
                )
                as |Item|
              }}
                <Item @format={{@format}} />
              {{/let}}
              <div class='remove-button-container'>
                <IconButton
                  @icon='icon-trash'
                  @width='20px'
                  @height='20px'
                  class='remove'
                  {{on 'click' (fn this.remove i)}}
                  data-test-remove={{i}}
                  aria-label='Remove'
                />
              </div>
            </li>
          {{/each}}
        </ul>
      {{/if}}
      <AddButton
        class='add-new'
        @variant='full-width'
        {{on 'click' this.add}}
        data-test-add-new
      >
        Add
        {{getPlural @field.card.displayName}}
      </AddButton>
    </div>
    <style>
      .list {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--boxel-sp);
      }
      .editor {
        position: relative;
        cursor: pointer;
        padding: var(--boxel-sp);
        border-radius: var(--boxel-form-control-border-radius);
      }
      .editor:hover {
        background-color: var(--boxel-light-100);
      }
      .remove-button-container {
        position: absolute;
        top: 0;
        left: 100%;
        height: 100%;
        display: flex;
        align-items: center;
      }
      .remove {
        --icon-color: var(--boxel-red);
      }
      .remove:hover {
        --icon-color: var(--boxel-error-200);
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

export function getContainsManyComponent({
  model,
  arrayField,
  format,
  field,
  cardTypeFor,
}: {
  model: Box<FieldDef>;
  arrayField: Box<FieldDef[]>;
  format: Format;
  field: Field<typeof FieldDef>;
  cardTypeFor(
    field: Field<typeof BaseDef>,
    boxedElement: Box<BaseDef>,
  ): typeof BaseDef;
}): BoxComponent {
  if (format === 'edit') {
    return <template>
      <ContainsManyEditor
        @model={{model}}
        @arrayField={{arrayField}}
        @field={{field}}
        @format={{format}}
        @cardTypeFor={{cardTypeFor}}
      />
    </template>;
  } else {
    return getPluralViewComponent(arrayField, field, format, cardTypeFor);
  }
}
