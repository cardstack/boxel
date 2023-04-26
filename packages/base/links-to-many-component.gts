import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { type Primitive, type Box, type Format, type Field } from './card-api';
import { getBoxComponent, getPluralViewComponent } from './field-component';
import type { ComponentLike } from '@glint/template';
import { CardContainer, Button, IconButton } from '@cardstack/boxel-ui';
import {
  restartableTask,
  type EncapsulatedTaskDescriptor as Descriptor,
} from 'ember-concurrency';
import {
  chooseCard,
  baseCardRef,
  identifyCard,
} from '@cardstack/runtime-common';

interface Signature {
  Args: {
    model: Box<Primitive>;
    arrayField: Box<Primitive[]>;
    format: Format;
    field: Field<typeof Primitive>;
    cardTypeFor(
      field: Field<typeof Primitive>,
      boxedElement: Box<Primitive>
    ): typeof Primitive;
  };
}

class LinksToManyEditor extends GlimmerComponent<Signature> {
  <template>
    <div
      class='contains-many-editor'
      data-test-links-to-many={{this.args.field.name}}
    >
      {{#if @arrayField.children.length}}
        <ul>
          {{#each @arrayField.children as |boxedElement i|}}
            <li class='links-to-editor' data-test-item={{i}}>
              {{#let
                (getBoxComponent
                  (this.args.cardTypeFor @field boxedElement)
                  'embedded'
                  boxedElement
                )
                as |Item|
              }}
                <CardContainer class='links-to-editor__item'>
                  <Item />
                </CardContainer>
              {{/let}}
              <IconButton
                @icon='icon-minus-circle'
                @width='20px'
                @height='20px'
                class='remove-button'
                {{on 'click' (fn this.remove i)}}
                data-test-remove-card
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
    let chosenCard: Primitive | undefined = await chooseCard(
      {
        filter: {
          every: [{ type }, ...selectedCardsQuery],
        },
      },
      { offerToCreate: type }
    );
    if (chosenCard) {
      selectedCards.push(chosenCard);
    }
  });

  remove = (index: number) => {
    (this.args.model.value as any)[this.args.field.name].splice(index, 1);
  };
}

export function getLinksToManyComponent({
  model,
  arrayField,
  format,
  field,
  cardTypeFor,
}: {
  model: Box<Primitive>;
  arrayField: Box<Primitive[]>;
  format: Format;
  field: Field<typeof Primitive>;
  cardTypeFor(
    field: Field<typeof Primitive>,
    boxedElement: Box<Primitive>
  ): typeof Primitive;
}): ComponentLike<{ Args: {}; Blocks: {} }> {
  if (format === 'edit') {
    return class LinksToManyEditorTemplate extends GlimmerComponent {
      <template>
        <LinksToManyEditor
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
