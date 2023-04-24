import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import {
  restartableTask,
  type EncapsulatedTaskDescriptor as Descriptor,
} from 'ember-concurrency';
import { getBoxComponent } from './field-component';
import { type Card, type Box, type Field } from './card-api';
import {
  chooseCard,
  baseCardRef,
  identifyCard,
} from '@cardstack/runtime-common';
import type { ComponentLike } from '@glint/template';
import { CardContainer } from '@cardstack/boxel-ui';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';

interface Signature {
  Args: {
    model: Box<Card | null>;
    field: Field<typeof Card>;
  };
}

class LinksToEditor extends GlimmerComponent<Signature> {
  <template>
    <div class='links-to-editor'>
      {{#if this.isEmpty}}
        <div data-test-empty-link>{{! PLACEHOLDER CONTENT }}</div>
        <button {{on 'click' this.choose}} data-test-choose-card>
          + Add New
        </button>
      {{else}}
        <CardContainer class='links-to-editor__item'>
          <this.linkedCard />
        </CardContainer>
        <button
          class='icon-button'
          {{on 'click' this.remove}}
          data-test-remove-card
          disabled={{this.isEmpty}}
          aria-label='Remove'
        >
          {{svgJar 'icon-minus-circle' width='20px' height='20px'}}
        </button>
      {{/if}}
    </div>
  </template>

  choose = () => {
    (this.chooseCard as unknown as Descriptor<any, any[]>).perform();
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
        `can't make field component with box value of null for field ${this.args.field.name}`
      );
    }
    let card = Reflect.getPrototypeOf(this.args.model.value)!
      .constructor as typeof Card;
    return getBoxComponent(card, 'embedded', this.args.model as Box<Card>);
  }

  private chooseCard = restartableTask(async () => {
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let chosenCard: Card | undefined = await chooseCard(
      { filter: { type } },
      { offerToCreate: type }
    );
    if (chosenCard) {
      this.args.model.value = chosenCard;
    }
  });
}

export function getLinksToEditor(
  model: Box<Card | null>,
  field: Field<typeof Card>
): ComponentLike<{ Args: {}; Blocks: {} }> {
  return class LinksToEditTemplate extends GlimmerComponent {
    <template>
      <LinksToEditor @model={{model}} @field={{field}} />
    </template>
  };
}
