
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import {
  chooseCard,
  baseCardRef,
  Loader,
} from '@cardstack/runtime-common';
import type { ComponentLike } from '@glint/template';
import type { Card, Field, Box, Format } from './card-api';

interface Signature {
  Args: {
    model: Box<Card>;
    field: Field<typeof Card>;
    fieldComponent: (field: Field<typeof Card>, model: Box<Card>, format: Format) => ComponentLike<{ Args: {}, Blocks: {} }>;
  }
}
export class LinksToEditor extends Component<Signature> {
  <template>
    <button {{on "click" this.choose}} data-test-choose-card>Choose</button>
    <button {{on "click" this.remove}} data-test-remove-card disabled={{this.isEmpty}}>Remove</button>
    {{#if this.isEmpty}}
      <div data-test-empty-link>[empty]</div>
    {{else}}
      <this.linkedCard/>
    {{/if}}
  </template>

  choose = () => {
    taskFor(this.chooseCard).perform();
  }

  remove = () => {
    (this.args.model.value as any)[this.args.field.name] = null;
  }

  get isEmpty() {
    return (this.args.model.value as any)[this.args.field.name] == null;
  }

  get linkedCard() {
    return this.args.fieldComponent(this.args.field, this.args.model, 'embedded');
  }

  @restartableTask private async chooseCard(this: LinksToEditor) {
    let currentlyChosen = !this.isEmpty ? (this.args.model.value as any)[this.args.field.name]["id"] as string : undefined;
    let type = Loader.identify(this.args.field.card) ?? baseCardRef;
    let chosenCard = await chooseCard(
      {
        filter: {
          every: [
            { type },
            // omit the currently chosen card from the chooser
            ...(currentlyChosen ? [{
              not: {
                eq: { id: currentlyChosen },
                on: baseCardRef,
              }
            }] : [])
          ]
        }
      }
    );
    if (chosenCard) {
      (this.args.model.value as any)[this.args.field.name] = chosenCard;
    }
  }
};