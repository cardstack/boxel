import Component from '@glimmer/component';
import type { ExportedCardRef } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { taskFor } from 'ember-concurrency-ts';
import { enqueueTask } from 'ember-concurrency'
import type { Card } from 'https://cardstack.com/base/card-api';
import { cardInstance, type CardInstance } from '../resources/card-instance';
import CardEditor from './card-editor';

export default class CreateCardModal extends Component {
  <template>
    {{#if this.currentRequest.ref}}
      <dialog class="dialog-box" open data-test-create-new-card={{this.currentRequest.ref.name}}>
        <button {{on "click" (fn this.save undefined)}} type="button">X Close</button>
        <h1>Create New Card: {{this.currentRequest.ref.name}}</h1>
        {{#if this.currentRequest.card.instance}}
          <CardEditor
            @card={{this.currentRequest.card.instance}}
            @onSave={{this.save}}
          />
        {{/if}}
      </dialog>
    {{/if}}
  </template>

  @tracked currentRequest: {
    ref: ExportedCardRef;
    card: CardInstance;
    deferred: Deferred<Card | undefined>;
  } | undefined = undefined;

  constructor(owner: unknown, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CREATE_NEW_CARD = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CREATE_NEW_CARD;
    });
  }

  async create<T extends Card>(ref: ExportedCardRef): Promise<undefined | T> {
    return await taskFor(this._create).perform(ref) as T | undefined;
  }

  @enqueueTask private async _create<T extends Card>(ref: ExportedCardRef): Promise<undefined | T> {
    this.currentRequest = {
      ref,
      card: cardInstance(this, () => ({ meta: { adoptsFrom: ref }})),
      deferred: new Deferred(),
    };
    let card = await this.currentRequest.deferred.promise;
    if (card) {
      return card as T;
    } else {
      return undefined;
    }
  }

  @action save(card?: Card): void {
    if (this.currentRequest) {
      this.currentRequest.deferred.resolve(card);
      this.currentRequest = undefined;
    }
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CreateCardModal: typeof CreateCardModal;
   }
}
