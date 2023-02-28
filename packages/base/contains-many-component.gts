import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  primitive,
  type Card,
  type Box,
  type Format,
  type Field,
} from './card-api';
import { getBoxComponent, type ComponentOptions } from './field-component';
import type { ComponentLike } from '@glint/template';
import {
  initStyleSheet,
  attachStyles,
} from '@cardstack/boxel-ui/attach-styles';
import { CardContainer } from '@cardstack/boxel-ui';

interface Signature {
  Args: {
    model: Box<Card>;
    arrayField: Box<Card[]>;
    format: Format;
    field: Field<typeof Card>;
    cardTypeFor(
      field: Field<typeof Card>,
      boxedElement: Box<Card>
    ): typeof Card;
  };
}

let containsManyStyles = initStyleSheet(`
  this {
    padding: var(--boxel-sp);
  }
  .contains-many-editor {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .contains-many-editor > li + li {
    margin-top: var(--boxel-sp);
    padding-top: var(--boxel-sp);
    border-top: 1px solid var(--boxel-border-color);
  }
`);

class ContainsManyEditor extends GlimmerComponent<Signature> {
  <template>
    <CardContainer
      @displayBoundaries={{true}}
      {{attachStyles containsManyStyles}}
      data-test-contains-many={{this.args.field.name}}
    >
      <ul class='contains-many-editor'>
        {{#each @arrayField.children as |boxedElement i|}}
          <li data-test-item={{i}}>
            {{#let
              (getBoxComponent
                (this.args.cardTypeFor @field boxedElement) @format boxedElement
              )
              as |Item|
            }}
              <Item />
            {{/let}}
            <button
              {{on 'click' (fn this.remove i)}}
              type='button'
              data-test-remove={{i}}
            >Remove</button>
          </li>
        {{/each}}
      </ul>
      <button {{on 'click' this.add}} type='button' data-test-add-new>+ Add New</button>
    </CardContainer>
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
  opts,
}: {
  model: Box<Card>;
  arrayField: Box<Card[]>;
  format: Format;
  field: Field<typeof Card>;
  cardTypeFor(field: Field<typeof Card>, boxedElement: Box<Card>): typeof Card;
  opts?: ComponentOptions;
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
    return class ContainsMany extends GlimmerComponent {
      <template>
        {{#each arrayField.children as |boxedElement|}}
          {{#let
            (getBoxComponent
              (cardTypeFor field boxedElement) format boxedElement opts
            )
            as |Item|
          }}
            <Item />
          {{/let}}
        {{/each}}
      </template>
    };
  }
}
