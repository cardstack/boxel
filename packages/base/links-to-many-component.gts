import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  type CardDef,
  BaseDef,
  type Box,
  type BoxComponent,
  type Format,
  type Field,
  CardContext,
} from './card-api';
import { getBoxComponent, getPluralViewComponent } from './field-component';
import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
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
import { IconMinusCircle, IconX } from '@cardstack/boxel-ui/icons';
import { eq } from '@cardstack/boxel-ui/helpers';

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
      {{#if (eq @format 'edit')}}
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
                    @icon={{IconMinusCircle}}
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
      {{else}}
        <div class='boxel-pills' data-test-pills>
          {{#each @arrayField.children as |boxedElement i|}}
            {{#let
              (getBoxComponent
                (this.args.cardTypeFor @field boxedElement)
                'atom'
                boxedElement
                @field
                @context
              )
              as |Item|
            }}
              <div class='boxel-pills-container' data-test-pill-item={{i}}>
                <div
                  class='boxel-pill'
                >
                  <Item />
                </div>
                <div class='remove-item-button-container'>
                  <IconButton
                    @variant='primary'
                    @icon={{IconX}}
                    @width='14px'
                    @height='14px'
                    class='remove-item-button'
                    {{on 'click' (fn this.remove i)}}
                    aria-label='Remove'
                    data-test-remove-card
                    data-test-remove={{i}}
                  />
                </div>
              </div>
            {{/let}}
          {{/each}}
          <AddButton
            class='add-new'
            @variant='pill'
            @iconWidth='14px'
            @iconHeight='14px'
            {{on 'click' this.add}}
            data-test-add-new
          >
            Add
            {{@field.card.displayName}}
          </AddButton>
        </div>
      {{/if}}
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
      .boxel-pills {
        display: flex;
        flex-wrap: wrap;

        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        --boxel-add-button-pill-font: var(--boxel-font-xs);
        gap: var(--boxel-sp-xs);
      }
      .boxel-pills-container {
        position: relative;
        height: fit-content;
      }
      .boxel-pill .atom-card {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-lg) var(--boxel-sp-xxxs)
          var(--boxel-sp-xs);
        color: var(--boxel-dark);
      }
      .remove-item-button-container {
        position: absolute;
        right: 0;
        top: 0;
        height: 100%;

        display: flex;
        align-items: center;
        padding-right: var(--boxel-sp-xxs);
      }
      .remove-item-button {
        --icon-color: var(--boxel-dark);
        width: 14px;
        height: 14px;
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
}): BoxComponent {
  if (format === 'edit' || format === 'atom') {
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
