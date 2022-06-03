import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq, gt } from '../helpers/truth-helpers';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { CardInspector } from '../lib/schema-util';
import CardEditor, { NewCardArgs } from './card-editor';
import { cardDefinitions } from '../resources/card-definitions';
import type RouterService from '@ember/routing/router-service';

interface Signature {
  Args: {
    module: Record<string, any>;
    src: string;
    inspector: CardInspector;
  }
}

export default class SchemaInspector extends Component<Signature> {
  <template>
    {{#if (gt this.cards.length 1)}}
      <p class="card-chooser">
        Cards:
        {{#each this.cards as |card index|}}
          <button {{on "click" (fn this.select index)}}
            class="card-button {{if (eq this.selectedIndex index) 'selected'}}"
            data-test-card-name={{card.localName}}
            disabled={{if (eq this.selectedIndex index) true false}}>
            {{card.localName}}
          </button>
        {{/each}}
      </p>
    {{else if (eq this.cards.length 0)}}
      No cards found in this module
    {{/if}}

    {{#if this.selectedCard}}
      <h2 class="selected-card">{{this.selectedCard.localName}} Card</h2>

      {{! TODO Render the card schema of the selected card }}

      {{#if this.selectedCard.exportedAs}}
        {{#if this.showEditor}}
          <CardEditor
            @card={{this.cardArgs}}
            @module={{@module}}
            @onCancel={{this.onCancel}}
            @onSave={{this.onSave}}
          />
        {{else}}
          <button data-test-create-card {{on "click" this.create}}>Create New {{this.selectedCard.localName}}</button>
        {{/if}}
      {{else}}
        (Note that non-exported cards are not able to be instantiated)
      {{/if}}
    {{/if}}
  </template>

  @tracked showEditor = false;
  @tracked selectedIndex = 0;
  @service declare router: RouterService;
  definitions = cardDefinitions(this, () => this.args.src, () => this.args.inspector);

  get cards() {
    return this.definitions?.cards ?? [];
  }

  get cardArgs(): NewCardArgs {
    if (!this.selectedCard) {
      throw new Error('No card selected');
    }
    if (!this.selectedCard.exportedAs) {
      throw new Error(`Cannot instantiate internal card ${this.selectedCard.localName}`);
    }

    return {
      type: 'new',
      class: this.args.module[this.selectedCard.exportedAs],
      name: this.selectedCard.exportedAs,
    }
  }

  get selectedCard() {
    return this.cards[this.selectedIndex];
  }

  @action
  select(index: number) {
    this.selectedIndex = index;
  }

  @action
  onCancel() {
    this.showEditor = false;
  }

  @action
  onSave(path: string) {
    this.router.transitionTo({ queryParams: { path } });
  }

  @action
  create() {
    if (!this.selectedCard) {
      return;
    }
    this.showEditor = true;
  }
}