import Helper from '@ember/component/helper';

import { isEqual } from 'lodash';

import { subscribeToRealm } from '@cardstack/runtime-common';

interface Signature {
  Args: {
    Positional: [
      realms: string[],
      callback: (ev: MessageEvent, realmURL: string) => void,
    ];
  };
  Return: void;
}

export default class SubscribeToRealmsHelper extends Helper<Signature> {
  private subscriptions: { realm: string; unsubscribe: () => void }[] = [];

  private get subscribedRealms() {
    return new Set(this.subscriptions.map((s) => s.realm));
  }
  compute([
    realms,
    callback,
  ]: Signature['Args']['Positional']): Signature['Return'] {
    if (isEqual(new Set(realms), this.subscribedRealms)) {
      return;
    }

    this.clearSubscriptions();

    this.subscriptions = realms.map((realm) => {
      return {
        realm,
        unsubscribe: subscribeToRealm(`${realm}_message`, (ev) =>
          callback(ev, realm),
        ),
      };
    });
  }

  willDestroy() {
    this.clearSubscriptions();
  }

  private clearSubscriptions() {
    for (let subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }
}
