import { Resource } from 'ember-resources';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import type CardService from '@cardstack/host/services/card-service';
import type { Card } from 'https://cardstack.com/base/card-api';
import { logger } from '@cardstack/runtime-common';

const log = logger('resource:card');

interface Args {
  named: {
    url: URL;
    onStateChange?: (state: CardResource['state']) => void;
  };
}

export interface Loading {
  state: 'loading';
}

export interface ServerError {
  state: 'server-error';
  url: string;
}

export interface NotFound {
  state: 'not-found';
  url: string;
}

export interface Ready {
  state: 'ready';
  card: Card;
}

export type CardResource = Loading | ServerError | NotFound | Ready;

class _CardResource extends Resource<Args> {
  @service declare cardService: CardService;

  @tracked private innerState: CardResource = {
    state: 'loading',
  };

  get state() {
    return this.innerState.state;
  }

  get card() {
    if (this.isReady) {
      return (this.innerState as unknown as Ready).card;
    }

    return undefined;
  }

  get isReady() {
    return this.innerState.state === 'ready';
  }

  modify(_positional: never[], named: Args['named']) {
    this.cardService.loadModel(named.url).then((card) => {
      console.log('got a card in card resource', card);
      this.innerState = { state: 'ready', card };
    });
  }
}

export function card(parent: object, args: () => Args['named']): CardResource {
  return _CardResource.from(parent, () => ({
    named: args(),
  })) as unknown as CardResource;
}
