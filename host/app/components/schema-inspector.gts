import Component from '@glimmer/component';
import { Card } from '../lib/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq, gt } from '../helpers/truth-helpers';
import isObject from 'lodash/isObject';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import CardEditor, { NewCardArgs } from './card-editor';
import type RouterService from '@ember/routing/router-service';

export default class SchemaInspector extends Component<{ Args: { module: Record<string, any> } }> {
  <template>
    {{#if (gt this.numCards 1)}}
      <p class="card-chooser">
        Cards:
        {{#each-in this.cards as |name card|}}
          <button {{on "click" (fn this.select name card)}}
            class="card-button {{if (eq this.selected.name name) 'selected'}}"
            data-test-card-name={{name}}
            disabled={{if (eq this.selected.name name) true false}}>
            {{name}}
          </button>
        {{/each-in}}
      </p>
    {{else if (eq this.numCards 0)}}
      No cards found in this module
    {{/if}}

    {{#if this.selected}}
      <h2 class="selected-card">{{this.selected.name}} Card</h2>

      {{! TODO Render the card schema of the selected card }}

      {{#if this.showEditor}}
        <CardEditor
          @card={{this.cardArgs}}
          @module={{@module}}
          @onCancel={{this.onCancel}}
          @onSave={{this.onSave}}
        />
      {{else}}
        <button data-test-create-card {{on "click" this.create}}>Create New {{this.selected.name}}</button>
      {{/if}}
    {{/if}}
  </template>

  @tracked showEditor = false;
  @tracked
  selected: { name: string; card: typeof Card; } | undefined =
    this.numCards > 0
      ? Object.fromEntries(
        Object.entries(this.cards)[0].map((val, i) => i === 0 ? ['name', val] : ['card', val])
      ) as { name: string; card: typeof Card; }
      : undefined;

  @service declare router: RouterService;

  get numCards() {
    return Object.keys(this.cards).length;
  }

  get cards() {
    let cards = {} as { [exportName: string]: typeof Card };
    for (let [ exportName, value ] of Object.entries(this.args.module)) {
      let maybeCard = value as typeof Card;
      if (!isObject(maybeCard)) {
        continue;
      }
      if ('baseCard' in maybeCard) {
        cards[exportName] = maybeCard;
      }
    }
    return cards;
  }

  get cardArgs(): NewCardArgs {
    if (!this.selected) {
      throw new Error('No card selected');
    }
    return {
      type: 'new',
      class: this.selected.card,
      name: this.selected.name,
    }
  }

  @action
  select(name: string, card: typeof Card) {
    this.selected = { name, card };
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
    if (!this.selected) {
      return;
    }
    this.showEditor = true;
  }
}