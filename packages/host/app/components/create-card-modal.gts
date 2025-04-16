import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { action } from '@ember/object';

import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { enqueueTask } from 'ember-concurrency';

import { consume } from 'ember-provide-consume-context';

import {
  Deferred,
  RealmPaths,
  GetCardContextName,
  type getCard,
  type CodeRef,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  moduleFrom,
  codeRefWithAbsoluteURL,
} from '@cardstack/runtime-common/code-ref';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import CardEditor from './card-editor';
import ModalContainer from './modal-container';

import type CardService from '../services/card-service';
import type StoreService from '../services/store';

export default class CreateCardModal extends Component {
  <template>
    {{#let this.currentRequest.cardResource.card as |card|}}
      {{#if card}}
        <ModalContainer
          @title='Create New Card'
          @onClose={{fn this.save undefined}}
          data-test-create-new-card={{card.constructor.name}}
        >
          <:content>
            <CardEditor @card={{card}} @onSave={{this.save}} />
          </:content>
        </ModalContainer>
      {{/if}}
    {{/let}}
  </template>

  @consume(GetCardContextName) private declare getCard: getCard;
  @service private declare cardService: CardService;
  @service private declare store: StoreService;
  @tracked private currentRequest:
    | {
        cardResource: ReturnType<getCard>;
        deferred: Deferred<string | undefined>;
      }
    | undefined = undefined;

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CREATE_NEW_CARD = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CREATE_NEW_CARD;
    });
  }

  async create(
    ref: CodeRef,
    relativeTo: URL | undefined,
    opts?: {
      realmURL?: URL;
      doc?: LooseSingleCardDocument;
    },
  ): Promise<undefined | string> {
    return (await this._create.perform(ref, relativeTo, opts)) as
      | string
      | undefined;
  }

  private _create = enqueueTask(
    async (
      ref: CodeRef,
      relativeTo: URL | undefined, // this relativeTo should be the spec ID that the CodeRef comes from
      opts?: {
        doc?: LooseSingleCardDocument;
        realmURL?: URL;
      },
    ): Promise<string | undefined> => {
      let cardModule = new URL(moduleFrom(ref), relativeTo);
      // we make the code ref use an absolute URL for safety in
      // the case it's being created in a different realm than where the card
      // definition comes from
      if (
        opts?.realmURL &&
        !new RealmPaths(opts.realmURL).inRealm(cardModule)
      ) {
        ref = codeRefWithAbsoluteURL(ref, relativeTo);
      }
      let doc: LooseSingleCardDocument = opts?.doc ?? {
        data: {
          meta: {
            adoptsFrom: ref,
            ...(opts?.realmURL ? { realmURL: opts.realmURL.href } : {}),
          },
        },
      };

      let maybeUrl = await this.store.create(doc, relativeTo);
      if (typeof maybeUrl === 'string') {
        let url = maybeUrl;
        let cardResource = this.getCard(this, () => url);
        this.currentRequest = {
          cardResource,
          deferred: new Deferred(),
        };
        return await this.currentRequest.deferred.promise;
      }
      console.error(
        `could not create card: ${JSON.stringify(maybeUrl, null, 2)}`,
      );
      return undefined;
    },
  );

  @action save(card?: CardDef): void {
    if (this.currentRequest) {
      this.currentRequest.deferred.fulfill(card?.id);
      this.currentRequest = undefined;
    }
  }
}
