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
import { Button, IconButton } from '@cardstack/boxel-ui';

interface Signature {
  Args: {
    model: Box<CardDef | null>;
    field: Field<typeof CardDef>;
    context?: CardContext;
  };
}

class LinksToEditor extends GlimmerComponent<Signature> {
  <template>
    <div class='links-to-editor {{if this.isEmpty "empty"}}'>
      {{#if this.isEmpty}}
        <Button @size='small' {{on 'click' this.choose}} data-test-choose-card>
          Choose
        </Button>
        {{#if @context.actions.createCard}}
          <Button @size='small' {{on 'click' this.create}} data-test-create-new>
            Create New
          </Button>
        {{/if}}
      {{else}}
        <this.linkedCard />
        <IconButton
          @icon='icon-minus-circle'
          @width='20px'
          @height='20px'
          class='remove'
          aria-label='Remove'
          {{on 'click' this.remove}}
          disabled={{this.isEmpty}}
          data-test-remove-card
        />
      {{/if}}
    </div>
    <style>
      .links-to-editor {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--boxel-sp-xs);
        align-items: center;
      }

      .empty {
        display: block;
      }

      .remove {
        --icon-bg: var(--boxel-highlight);
        --icon-border: var(--icon-bg);
        --icon-color: var(--boxel-light);
      }

      .remove:hover {
        --icon-bg: var(--boxel-dark);
      }
    </style>
  </template>

  choose = () => {
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
    let chosenCard: CardDef | undefined = this.args.context?.actions?.createCard
      ? await chooseCard({ filter: { type } })
      : await chooseCard({ filter: { type } }, { offerToCreate: type });
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
