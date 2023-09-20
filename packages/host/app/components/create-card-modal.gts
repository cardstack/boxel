import Component from '@glimmer/component';
import type {
  CodeRef,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { enqueueTask } from 'ember-concurrency';
import { service } from '@ember/service';
import type Owner from '@ember/owner';
import type CardService from '../services/card-service';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import CardEditor from './card-editor';
import ModalContainer from './modal-container';

export default class CreateCardModal extends Component {
  <template>
    {{#let this.currentRequest.card as |card|}}
      {{#if card}}
        <ModalContainer
          @title='Create New Card'
          @onClose={{fn this.save undefined}}
          @zIndex={{this.zIndex}}
          data-test-create-new-card={{card.constructor.name}}
        >
          <:content>
            <CardEditor @card={{card}} @onSave={{this.save}} />
          </:content>
        </ModalContainer>
      {{/if}}
    {{/let}}
  </template>

  @service declare cardService: CardService;
  @tracked currentRequest:
    | {
        card: CardDef;
        deferred: Deferred<CardDef | undefined>;
      }
    | undefined = undefined;
  @tracked zIndex = 20;

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CREATE_NEW_CARD = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CREATE_NEW_CARD;
    });
  }

  async create<T extends CardDef>(
    ref: CodeRef,
    relativeTo: URL | undefined,
    opts?: { doc?: LooseSingleCardDocument },
  ): Promise<undefined | T> {
    this.zIndex++;
    return (await this._create.perform(ref, relativeTo, opts)) as T | undefined;
  }

  private _create = enqueueTask(
    async <T extends CardDef>(
      ref: CodeRef,
      relativeTo: URL | undefined,
      opts?: { doc?: LooseSingleCardDocument },
    ) => {
      let doc: LooseSingleCardDocument = opts?.doc ?? {
        data: { meta: { adoptsFrom: ref } },
      };
      this.currentRequest = {
        card: await this.cardService.createFromSerialized(
          doc.data,
          doc,
          relativeTo ?? this.cardService.defaultURL,
        ),
        deferred: new Deferred(),
      };
      let card = await this.currentRequest.deferred.promise;
      if (card) {
        return card as T;
      } else {
        return undefined;
      }
    },
  );

  @action save(card?: CardDef): void {
    if (this.currentRequest) {
      this.currentRequest.deferred.fulfill(card);
      this.currentRequest = undefined;
    }
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CreateCardModal: typeof CreateCardModal;
  }
}
