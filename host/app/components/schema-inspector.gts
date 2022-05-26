import Component from '@glimmer/component';
import { Card } from '../lib/card-api';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq, gt } from '../helpers/truth-helpers';
import isObject from 'lodash/isObject';
import { tracked } from '@glimmer/tracking';
import LocalRealm from '../services/local-realm';
import { service } from '@ember/service';
import CardCreator from './card-creator';
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

      {{#if this.showCreate}}
        <CardCreator
          @cardClass={{this.selected.card}}
          @module={{@module}}
          @name={{this.selected.name}}
          @onCancel={{this.onCancel}}
        />
      {{else}}
        <button {{on "click" this.create}}>Create New {{this.selected.name}}</button>
      {{/if}}
    {{/if}}
  </template>

  @tracked showCreate = false;
  @tracked
  selected: { name: string; card: typeof Card; } | undefined =
    this.numCards > 0
      ? Object.fromEntries(
        Object.entries(this.cards)[0].map((val, i) => i === 0 ? ['name', val] : ['card', val])
      ) as { name: string; card: typeof Card; }
      : undefined;

  @service declare localRealm: LocalRealm;
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

  @action
  select(name: string, card: typeof Card) {
    this.selected = { name, card };
  }

  @action
  onCancel() {
    this.showCreate = false;
  }

  @action
  create() {
    if (!this.selected) {
      return;
    }
    this.showCreate = true;
  }
}