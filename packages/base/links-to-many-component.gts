import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  type Card,
  CardBase,
  type Box,
  type Format,
  type Field,
  CardContext,
} from './card-api';
import { getBoxComponent, getPluralViewComponent } from './field-component';
import type { ComponentLike } from '@glint/template';
import { Button, IconButton } from '@cardstack/boxel-ui';
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
    model: Box<Card>;
    arrayField: Box<Card[]>;
    format: Format;
    field: Field<typeof Card>;
    cardTypeFor(
      field: Field<typeof CardBase>,
      boxedElement: Box<CardBase>
    ): typeof CardBase;
    context?: CardContext;
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
                <Item />
              {{/let}}
              <IconButton
                @icon='icon-minus-circle'
                @width='20px'
                @height='20px'
                class='icon-button'
                {{on 'click' (fn this.remove i)}}
                data-test-remove-card
                data-test-remove={{i}}
                aria-label='Remove'
              />
            </li>
          {{/each}}
        </ul>
      {{/if}}
      <Button @size='small' {{on 'click' this.add}} data-test-add-new>
        Choose
      </Button>
      {{#if @context.actions.createCard}}
        <Button @size='small' {{on 'click' this.create}} data-test-create-new>
          Create New
        </Button>
      {{/if}}
    </div>
  </template>

  add = () => {
    (this.chooseCard as unknown as Descriptor<any, any[]>).perform();
  };

  create = () => {
    (this.createCard as unknown as Descriptor<any, any[]>).perform();
  };

  private chooseCard = restartableTask(async () => {
    let selectedCards = (this.args.model.value as any)[this.args.field.name];
    let selectedCardsQuery =
      selectedCards?.map((card: any) => ({ not: { eq: { id: card.id } } })) ??
      [];
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let filter = { every: [{ type }, ...selectedCardsQuery] };
    let chosenCard: Card | undefined = this.args.context?.actions?.createCard
      ? await chooseCard({ filter })
      : await chooseCard({ filter }, { offerToCreate: type });
    if (chosenCard) {
      selectedCards = [...selectedCards, chosenCard];
      (this.args.model.value as any)[this.args.field.name] = selectedCards;
    }
  });

  private createCard = restartableTask(async () => {
    let cards = (this.args.model.value as any)[this.args.field.name];
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let newCard: Card | undefined =
      await this.args.context?.actions?.createCard(type, undefined, {
        isLinkedCard: true,
      });
    if (newCard) {
      cards = [...cards, newCard];
      (this.args.model.value as any)[this.args.field.name] = cards;
    }
  });

  remove = (index: number) => {
    let cards = (this.args.model.value as any)[this.args.field.name];
    cards = cards.filter((_c: Card, i: number) => i !== index);
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
  model: Box<Card>;
  arrayField: Box<Card[]>;
  format: Format;
  field: Field<typeof Card>;
  cardTypeFor(
    field: Field<typeof CardBase>,
    boxedElement: Box<CardBase>
  ): typeof CardBase;
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
    return getPluralViewComponent(arrayField, field, format, cardTypeFor);
  }
}
