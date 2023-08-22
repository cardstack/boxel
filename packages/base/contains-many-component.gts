import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  primitive,
  type Box,
  type Format,
  type Field,
  type FieldDef,
  type BaseDef,
} from './card-api';
import { getBoxComponent, getPluralViewComponent } from './field-component';
import type { ComponentLike } from '@glint/template';
import { Button, IconButton } from '@cardstack/boxel-ui';

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
    <div data-test-contains-many={{this.args.field.name}}>
      {{#if @arrayField.children.length}}
        <ul class='list'>
          {{#each @arrayField.children as |boxedElement i|}}
            <li class='editor' data-test-item={{i}}>
              {{#let
                (getBoxComponent
                  (this.args.cardTypeFor @field boxedElement)
                  @format
                  boxedElement
                  @field
                )
                as |Item|
              }}
                <Item />
              {{/let}}
              <IconButton
                @icon='icon-trash'
                @width='20px'
                @height='20px'
                class='remove'
                {{on 'click' (fn this.remove i)}}
                data-test-remove={{i}}
                aria-label='Remove'
              />
            </li>
          {{/each}}
        </ul>
      {{/if}}
      <Button
        @size='small'
        {{on 'click' this.add}}
        type='button'
        data-test-add-new
      >+ Add New</Button>
    </div>
    <style>
      .editor {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--boxel-sp-xs);
        align-items: center;
      }

      .list {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--boxel-sp);
      }

      .list > li + li {
        margin-top: var(--boxel-sp);
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
}): ComponentLike<{ Args: {}; Blocks: {} }> {
  if (format === 'edit') {
    return class ContainsManyEditorTemplate extends GlimmerComponent {
      <template>
        <ContainsManyEditor
          @model={{model}}
          @arrayField={{arrayField}}
          @field={{field}}
          @format={{format}}
          @cardTypeFor={{cardTypeFor}}
        />
      </template>
    };
  } else {
    return getPluralViewComponent(arrayField, field, format, cardTypeFor);
  }
}
