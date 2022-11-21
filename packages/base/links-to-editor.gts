import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { restartableTask, type EncapsulatedTaskDescriptor as Descriptor} from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { getBoxComponent } from './field-component';
import {
  type Card,
  type Box,
  type Field
} from './card-api';
import {
  chooseCard,
  baseCardRef,
  identifyCard,
} from '@cardstack/runtime-common';
import type { ComponentLike } from '@glint/template';
import { initStyleSheet, attachStyles } from './attach-styles';


interface Signature {
  Args: {
    model: Box<Card | null>;
    field: Field<typeof Card>;
  }
}

let linksToEditorStyles = initStyleSheet(`
  this {
    background-color: #fff;
    border: 1px solid #ddd;
    border-radius: 20px;
    padding: 1rem;
  }
  button {
    margin-top: 1rem;
    font: inherit;
    font-weight: 600;
    border: none;
    background-color: white;
    padding: 0.5em 0;
    text-transform: capitalize;
  }
  button:hover {
    color: #00EBE5;
  }
`);

class LinksToEditor extends GlimmerComponent<Signature> {
  <template>
    <div {{attachStyles linksToEditorStyles}}>
      {{#if this.isEmpty}}
        <div data-test-empty-link>{{!-- PLACEHOLDER CONTENT --}}</div>
        <button {{on "click" this.choose}} data-test-choose-card>
          + Add {{@field.name}}
        </button>
      {{else}}
        <this.linkedCard/>
        <button {{on "click" this.remove}} data-test-remove-card disabled={{this.isEmpty}}>
          Remove {{@field.name}}
        </button>
      {{/if}}
    </div>
  </template>

  choose = () => {
    taskFor(this.chooseCard as unknown as Descriptor<any, any[]>).perform();
  }

  remove = () => {
    this.args.model.value = null;
  }

  get isEmpty() {
    return this.args.model.value == null;
  }

  get linkedCard() {
    if (this.args.model.value == null) {
      throw new Error(`can't make field component with box value of null for field ${this.args.field.name}`);
    }
    let card = Reflect.getPrototypeOf(this.args.model.value)!.constructor as typeof Card;
    return getBoxComponent(card, 'embedded', this.args.model as Box<Card>);
  }

  @restartableTask private async chooseCard() {
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    let chosenCard: Card | undefined = await chooseCard(
      { filter: { type }},
      { offerToCreate: type }
    );
    if (chosenCard) {
      this.args.model.value = chosenCard;
    }
  }
};

export function getLinksToEditor(
  model: Box<Card | null>,
  field: Field<typeof Card>,
): ComponentLike<{ Args: {}, Blocks: {} }> {
  return class LinksToEditTemplate extends GlimmerComponent {
    <template>
      <LinksToEditor @model={{model}} @field={{field}} />
    </template>
  };
}
