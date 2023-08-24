import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  type CardDef,
  BaseDef,
  type Box,
  type Format,
  type Field,
  CardContext,
} from './card-api';
import { getBoxComponent, getPluralViewComponent } from './field-component';
import type { ComponentLike } from '@glint/template';
import { AddButton, IconButton } from '@cardstack/boxel-ui';
import {
  restartableTask,
  type EncapsulatedTaskDescriptor as Descriptor,
} from 'ember-concurrency';
import {
  chooseCard,
  baseCardRef,
  identifyCard,
  getPlural,
} from '@cardstack/runtime-common';

interface Signature {
  Args: {
    model: Box<CardDef>;
    arrayField: Box<CardDef[]>;
    format: Format;
    field: Field<typeof CardDef>;
    cardTypeFor(
      field: Field<typeof BaseDef>,
      boxedElement: Box<BaseDef>,
    ): typeof BaseDef;
    context?: CardContext;
  };
}

class LinksToManyEditor extends GlimmerComponent<Signature> {
  <template>
    <div data-test-links-to-many={{this.args.field.name}}>
      {{#if @arrayField.children.length}}
        <ul class='list'>
          {{#each @arrayField.children as |boxedElement i|}}
            <li class='editor' data-test-item={{i}}>
              {{#let
                (getBoxComponent
                  (this.args.cardTypeFor @field boxedElement)
                  'embedded'
                  boxedElement
                  @field
                  @context
                )
                as |Item|
              }}
                <Item />
              {{/let}}
              <div class='remove-button-container'>
                <IconButton
                  @variant='primary'
                  @icon='icon-minus-circle'
                  @width='20px'
                  @height='20px'
                  class='remove'
                  {{on 'click' (fn this.remove i)}}
                  aria-label='Remove'
                  data-test-remove-card
                  data-test-remove={{i}}
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
      .list > li + li {
        margin-top: var(--boxel-sp);
      }
      .editor {
        position: relative;
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
        --icon-color: var(--boxel-light);
      }
      .remove:hover {
        --icon-bg: var(--boxel-dark);
        --icon-border: var(--boxel-dark);
      }
    </style>
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
    let filter = { every: [{ type }, ...selectedCardsQuery] };
    let chosenCard: CardDef | undefined = await chooseCard(
      { filter },
      {
        offerToCreate: type,
        multiSelect: true,
        createNewCard: this.args.context?.actions?.createCard,
      },
    );
    if (chosenCard) {
      selectedCards = [...selectedCards, chosenCard];
      (this.args.model.value as any)[this.args.field.name] = selectedCards;
    }
  });

  remove = (index: number) => {
    let cards = (this.args.model.value as any)[this.args.field.name];
    cards = cards.filter((_c: CardDef, i: number) => i !== index);
    (this.args.model.value as any)[this.args.field.name] = cards;
  };
}

export function getLinksToManyComponent({
  model,
  arrayField,
  format,
  field,
  cardTypeFor,
  context,
}: {
  model: Box<CardDef>;
  arrayField: Box<CardDef[]>;
  format: Format;
  field: Field<typeof CardDef>;
  cardTypeFor(
    field: Field<typeof BaseDef>,
    boxedElement: Box<BaseDef>,
  ): typeof BaseDef;
  context?: CardContext;
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
          @context={{context}}
        />
      </template>
    };
  } else {
    return getPluralViewComponent(
      arrayField,
      field,
      format,
      cardTypeFor,
      context,
    );
  }
}
