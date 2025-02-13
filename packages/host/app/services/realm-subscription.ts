import Service, { service } from '@ember/service';

import { hasExecutableExtension } from '@cardstack/runtime-common';

import type {
  CardDef,
  IdentityContext,
} from 'https://cardstack.com/base/card-api';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type RealmService from './realm';

import type { CardResource } from '../resources/card-resource';

class ResettableIdentityContext implements IdentityContext {
  #cards = new Map<
    string,
    {
      card: CardDef | undefined;
    }
  >();

  get(url: string): CardDef | undefined {
    return this.#cards.get(url)?.card;
  }
  set(url: string, instance: CardDef | undefined): void {
    this.#cards.set(url, { card: instance });
  }
  delete(url: string): void {
    this.#cards.delete(url);
  }
  reset() {
    for (let url of this.#cards.keys()) {
      this.#cards.set(url, { card: undefined });
    }
  }
}

export default class RealmSubscriptionService extends Service {
  @service private declare realm: RealmService;
  @service private declare loaderService: LoaderService;
  @service private declare messageService: MessageService;
  @service private declare cardService: CardService;
  private subscribers: Map<
    string,
    {
      // it's possible to have the same card instance used in different
      // resources as the owners of the resources can differ
      resources: CardResource[];
      realm: string;
    }
  > = new Map();
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  identityContext = new ResettableIdentityContext();

  unloadResource(resource: CardResource) {
    let id = resource.url;
    if (!id) {
      return;
    }
    let subscriber = this.subscribers.get(id);
    if (subscriber) {
      let { resources, realm } = subscriber;
      const index = resources.indexOf(resource);
      if (index > -1) {
        resources.splice(index, 1);
      }
      if (resources.length === 0) {
        this.subscribers.delete(id);
        this.identityContext.delete(id);
      }

      // if there are no more subscribers to this realm then unsubscribe from realm
      let subscription = this.subscriptions.get(realm);
      if (
        subscription &&
        ![...this.subscribers.values()].find((s) => s.realm === realm)
      ) {
        subscription.unsubscribe();
        this.subscriptions.delete(realm);
      }
    }
  }

  private handleInvalidations = ({ type, data: dataStr }: MessageEvent) => {
    if (type !== 'index') {
      return;
    }
    let data = JSON.parse(dataStr);
    if (data.type !== 'incremental') {
      return;
    }
    let invalidations = data.invalidations as string[];

    if (invalidations.find((i) => hasExecutableExtension(i))) {
      // the invalidation included code changes too. in this case we
      // need to flush the loader so that we can pick up any updated
      // code before re-running the card
      this.loaderService.reset();
      // the code changes have destabilized our identity context so we
      // need to rebuild it
      this.identityContext.reset();
    }

    for (let invalidation of invalidations) {
      if (hasExecutableExtension(invalidation)) {
        // we already dealt with this
        continue;
      }
      let subscriber = this.subscribers.get(invalidation);
      if (subscriber) {
        let { resources } = subscriber;
        let liveCard = this.identityContext.get(invalidation);
        if (liveCard) {
          // Do not reload if the event is a result of a request that we made. Otherwise we risk overwriting
          // the inputs with past values. This can happen if the user makes edits in the time between the auto
          // save request and the arrival SSE event.
          if (!this.cardService.clientRequestIds.has(data.clientRequestId)) {
            for (let resource of resources) {
              // when we have a running card we merge the new state into the current instance
              resource.reload.perform(liveCard);
            }
          }
        } else if (!this.identityContext.get(invalidation)) {
          for (let resource of resources) {
            // load the card using just the ID because we don't have a running card on hand
            resource.loadModel.perform(invalidation);
          }
        }
      }
    }
  };

  subscribeFor(resource: CardResource) {
    if (!resource.url) {
      throw new Error(
        `Cannot subscribe to card resource that does not have an id`,
      );
    }
    let realmURL = this.realm.realmOfURL(new URL(resource.url));
    if (!realmURL) {
      console.warn(
        `could not determine realm for card ${resource.url} when trying to subscribe to realm`,
      );
      return;
    }
    let realm = realmURL.href;
    let subscriber = this.subscribers.get(resource.url);
    if (!subscriber) {
      subscriber = {
        resources: [],
        realm,
      };
      this.subscribers.set(resource.url, subscriber);
    }
    subscriber.resources.push(resource);
    let subscription = this.subscriptions.get(realm);
    if (!subscription) {
      this.subscriptions.set(realm, {
        unsubscribe: this.messageService.subscribe(
          realm,
          this.handleInvalidations,
        ),
      });
    }
  }
}
