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

/* Example usage:
 *
 * ```hbs
 * <SubscribeToRealms @realms={{this.realms}} @callback={{this.handleMessage}} />
 * ```
 *
 * The `handleMessage` function will be called with the `MessageEvent` and the realm URL
 * when a SSE event is received from any of the realms in the `realms` array.
 */

export default class SubscribeToRealms extends Helper<Signature> {
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
        unsubscribe: subscribeToRealm(realm, (ev) => callback(ev, realm)),
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
