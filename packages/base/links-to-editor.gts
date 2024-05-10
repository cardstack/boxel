import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import {
  restartableTask,
  type EncapsulatedTaskDescriptor as Descriptor,
} from 'ember-concurrency';
import { DefaultFormatProvider, getBoxComponent } from './field-component';
import {
  type CardDef,
  type BaseDef,
  type Box,
  type Field,
  CardContext,
} from './card-api';
import {
  chooseCard,
  baseCardRef,
  identifyCard,
  CardContextName,
} from '@cardstack/runtime-common';
import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
import { IconMinusCircle } from '@cardstack/boxel-ui/icons';
import { consume } from 'ember-provide-consume-context';

interface Signature {
  Args: {
    model: Box<CardDef | null>;
    field: Field<typeof CardDef>;
  };
}

export class LinksToEditor extends GlimmerComponent<Signature> {
  @consume(CardContextName) declare cardContext: CardContext;

  <template>
    <div class='links-to-editor' data-test-links-to-editor={{@field.name}}>
      {{#if this.isEmpty}}
        <AddButton
          class='add-new'
          @variant='full-width'
          @hideIcon={{true}}
          {{on 'click' this.add}}
          data-test-add-new
        >
          Link
          {{@field.card.displayName}}
        </AddButton>
      {{else}}
        <IconButton
          @variant='primary'
          @icon={{IconMinusCircle}}
          @width='20px'
          @height='20px'
          class='remove'
          {{on 'click' this.remove}}
          disabled={{this.isEmpty}}
          aria-label='Remove'
          data-test-remove-card
        />
        <DefaultFormatProvider @value='embedded'>
          <this.linkedCard />
        </DefaultFormatProvider>
      {{/if}}
    </div>
    <style>
      .links-to-editor {
        --remove-icon-size: var(--boxel-icon-lg);
        position: relative;
        display: grid;
        grid-template-columns: 1fr var(--remove-icon-size);
      }
      .links-to-editor > :deep(.boxel-card-container.embedded-format) {
        order: -1;
      }
      .remove {
        --icon-color: var(--boxel-light);
        align-self: center;
        outline: 0;
      }
      .remove:focus,
      .remove:hover {
        --icon-bg: var(--boxel-dark);
        --icon-border: var(--boxel-dark);
      }
      .remove:focus + :deep(.boxel-card-container.embedded-format),
      .remove:hover + :deep(.boxel-card-container.embedded-format) {
        box-shadow:
          0 0 0 1px var(--boxel-light-500),
          var(--boxel-box-shadow-hover);
      }
    </style>
  </template>

  add = () => {
    (this.chooseCard as unknown as Descriptor<any, any[]>).perform();
  };

  create = () => {
    (this.createCard as unknown as Descriptor<any, any[]>).perform();
  };

  remove = () => {
    this.args.model.value = null;
  };

  get isEmpty() {
    return this.args.model.value == null;
  }

  get linkedCard() {
    if (this.args.model.value == null) {
      throw new Error(
        `can't make field component with box value of null for field ${this.args.field.name}`,
      );
    }
    let card = Reflect.getPrototypeOf(this.args.model.value)!
      .constructor as typeof BaseDef;
    return getBoxComponent(
      card,
      this.args.model as Box<BaseDef>,
      this.args.field,
    );
  }

  private chooseCard = restartableTask(async () => {
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let chosenCard: CardDef | undefined = await chooseCard(
      { filter: { type } },
      {
        offerToCreate: { ref: type, relativeTo: undefined },
        createNewCard: this.cardContext?.actions?.createCard,
      },
    );
    if (chosenCard) {
      this.args.model.value = chosenCard;
    }
  });

  private createCard = restartableTask(async () => {
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let newCard: CardDef | undefined =
      await this.cardContext?.actions?.createCard(type, undefined, {
        isLinkedCard: true,
      });
    if (newCard) {
      this.args.model.value = newCard;
    }
  });
}
