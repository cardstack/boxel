import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import {
  restartableTask,
  type EncapsulatedTaskDescriptor as Descriptor,
} from 'ember-concurrency';
import { getBoxComponent } from './field-component';
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
} from '@cardstack/runtime-common';
import type { ComponentLike } from '@glint/template';
import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
import { IconMinusCircle } from '@cardstack/boxel-ui/icons';

interface Signature {
  Args: {
    model: Box<CardDef | null>;
    field: Field<typeof CardDef>;
    context?: CardContext;
  };
}

class LinksToEditor extends GlimmerComponent<Signature> {
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
        <this.linkedCard />
        <div class='remove-button-container'>
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
        </div>
      {{/if}}
    </div>
    <style>
      .links-to-editor {
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
      'embedded',
      this.args.model as Box<BaseDef>,
      this.args.field,
      this.args.context,
    );
  }

  private chooseCard = restartableTask(async () => {
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let chosenCard: CardDef | undefined = await chooseCard(
      { filter: { type } },
      {
        offerToCreate: { ref: type, relativeTo: undefined },
        createNewCard: this.args.context?.actions?.createCard,
      },
    );
    if (chosenCard) {
      this.args.model.value = chosenCard;
    }
  });

  private createCard = restartableTask(async () => {
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let newCard: CardDef | undefined =
      await this.args.context?.actions?.createCard(type, undefined, {
        isLinkedCard: true,
      });
    if (newCard) {
      this.args.model.value = newCard;
    }
  });
}

export function getLinksToEditor(
  model: Box<CardDef | null>,
  field: Field<typeof CardDef>,
  context?: CardContext,
): ComponentLike<{ Args: {}; Blocks: {} }> {
  return class LinksToEditTemplate extends GlimmerComponent {
    <template>
      <LinksToEditor @model={{model}} @field={{field}} @context={{context}} />
    </template>
  };
}
