import Component from '@glimmer/component';
import type {
  CardRef,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { enqueueTask } from 'ember-concurrency';
import { service } from '@ember/service';
import type CardService from '../services/card-service';
import type { Card } from 'https://cardstack.com/base/card-api';
import CardEditor from './card-editor';
import { Modal, CardContainer, Header } from '@cardstack/boxel-ui';

export default class CreateCardModal extends Component {
  <template>
    {{#let this.currentRequest.card as |card|}}
      {{#if card}}
        <Modal
          @size='large'
          @isOpen={{true}}
          @onClose={{fn this.save undefined}}
          style={{this.styleString}}
          data-test-create-new-card={{card.constructor.name}}
        >
          <CardContainer class='dialog-box' @displayBoundaries={{true}}>
            <Header @title='Create New Card'>
              <button
                {{on 'click' (fn this.save undefined)}}
                class='dialog-box__close'
              >⨯</button>
            </Header>
            <div class='dialog-box__content'>
              <CardEditor @card={{card}} @onSave={{this.save}} />
            </div>
          </CardContainer>
        </Modal>
      {{/if}}
    {{/let}}
  </template>

  @service declare cardService: CardService;
  @tracked currentRequest:
    | {
        card: Card;
        deferred: Deferred<Card | undefined>;
      }
    | undefined = undefined;
  @tracked zIndex = 20;

  constructor(owner: unknown, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CREATE_NEW_CARD = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CREATE_NEW_CARD;
    });
  }

  get styleString() {
    return htmlSafe(`z-index: ${this.zIndex}`);
  }

  async create<T extends Card>(
    ref: CardRef,
    relativeTo: URL | undefined,
    opts?: { doc?: LooseSingleCardDocument },
  ): Promise<undefined | T> {
    this.zIndex++;
    return (await this._create.perform(ref, relativeTo, opts)) as T | undefined;
  }

  private _create = enqueueTask(
    async <T extends Card>(
      ref: CardRef,
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

  @action save(card?: Card): void {
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
