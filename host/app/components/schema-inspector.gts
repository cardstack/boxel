import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq, gt } from '../helpers/truth-helpers';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { CardInspector, FieldDefinition } from '../lib/schema-util';
import get from 'lodash/get';
import CardEditor, { NewCardArgs } from './card-editor';
import { cardDefinitions } from '../resources/card-definitions';
import { LinkTo } from '@ember/routing';
//@ts-ignore glint seems to this that 'hash' is unused, even though we actually use it in the template below
import { hash } from '@ember/helper';
import type { FieldType } from '../lib/card-api';
import type { CardReference, ExternalReference } from '@cardstack/runtime-common/module-syntax';
import type RouterService from '@ember/routing/router-service';

interface Signature {
  Args: {
    url: string;
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

      {{#each this.selectedCard.fields as |field|}}
        <div class="field" data-test-field={{fieldName field}}>
          <span class="field-name">{{fieldName field}}:</span>
          <span class="field-type">{{fieldType field}}</span>
          <span class="field-card">
            {{#let (fieldCard field) as |cardRef|}}
              {{#if (eq (get cardRef 'type') 'internal')}}
                {{#let (get this.cards (get cardRef 'classIndex')) as |fieldCard|}}
                  '{{fieldCard.localName}}' card
                {{/let}}
              {{else}}
                {{#let (getCardPath cardRef this.args.url) as |path|}}
                  {{#if path}}
                    <LinkTo @route="application" @query={{hash path=path}}>
                      {{externalCardName cardRef}}
                    </LinkTo>
                  {{else}}
                    {{externalCardName cardRef}}
                  {{/if}}
                {{/let}}
              {{/if}}
            {{/let}}
          </span>
        </div>
      {{/each}}

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
  definitions = cardDefinitions(this, () => this.args.src, () => this.args.inspector, () => this.args.url);

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
  onSave(url: string) {
    let path = new URL(url).pathname;
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

function fieldName([fieldName, ]: [fieldName: string, fieldDefinition: FieldDefinition]): string {
  return fieldName;
}

function fieldType([_fieldName, fieldDefinition ]: [fieldName: string, fieldDefinition: FieldDefinition]): FieldType {
  return fieldDefinition.type;
}

function fieldCard([_fieldName, fieldDefinition ]: [fieldName: string, fieldDefinition: FieldDefinition]): CardReference {
  return fieldDefinition.card;
}

function externalCardName(ref: ExternalReference): string {
  if (ref.name === 'default') {
    return `${ref.module} card`;
  }

  return `'${ref.name}' card of ${ref.module}`;
}

function getCardPath(ref: ExternalReference, currentPath: string): string | undefined {
  if ((ref.module.startsWith('.') || ref.module.startsWith('/')) && !ref.module.startsWith('//')) {
    let url = new URL(ref.module, currentPath);
    return url.pathname;
  }
  return undefined;
}