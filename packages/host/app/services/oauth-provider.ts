import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import type NetworkService from './network';
import type RealmServerService from './realm-server';

// The realm server's OAuth authorization server metadata (RFC 8414), which it
// serves only while its OAuth provider is on.
const DISCOVERY_PATH = '/.well-known/oauth-authorization-server';

// Whether the realm server's OAuth provider is on, which decides whether the
// app offers Connected apps (the secure origin's page listing the apps
// connected to the user's Boxel account).
//
// The realm server's own setting turns the provider on, and with it the
// provider's discovery document; with the provider off, the document's path
// answers 404. So the app learns the setting by reading that document, and
// keeps no setting of its own. The provider is on when the document is JSON
// naming this realm server as its issuer.
//
// The answer doesn't change while the realm server runs, so a definite one
// (the document, or a 404 or anything else that isn't it) is kept for the
// app's lifetime. A request that fails, or a 5xx, leaves it unknown, and the
// next check asks again.
export default class OAuthProviderService extends Service {
  @service declare private network: NetworkService;
  @service declare private realmServer: RealmServerService;

  // `undefined` until the realm server has answered.
  @tracked isOn: boolean | undefined;

  #checking: Promise<boolean | undefined> | undefined;

  // Asks the realm server once its answer is unknown, and answers what is
  // known after that: `undefined` when it couldn't be asked.
  check(): Promise<boolean | undefined> {
    if (this.isOn !== undefined) {
      return Promise.resolve(this.isOn);
    }
    if (!this.#checking) {
      this.#checking = this.#ask().finally(() => {
        this.#checking = undefined;
      });
    }
    return this.#checking;
  }

  async #ask(): Promise<boolean | undefined> {
    let issuer = this.realmServer.url.origin;
    let response: Response;
    try {
      response = await this.network.fetch(
        new URL(DISCOVERY_PATH, this.realmServer.url).href,
        { headers: { Accept: 'application/json' } },
      );
    } catch (e) {
      console.warn(`Could not check whether OAuth is on: ${e}`);
      return undefined;
    }
    if (response.status >= 500) {
      console.warn(
        `Could not check whether OAuth is on: the realm server answered ${response.status}`,
      );
      return undefined;
    }
    let isOn = false;
    if (
      response.ok &&
      response.headers.get('content-type')?.includes('application/json')
    ) {
      try {
        let body = (await response.json()) as { issuer?: unknown };
        isOn = body.issuer === issuer;
      } catch {
        isOn = false;
      }
    }
    this.isOn = isOn;
    return isOn;
  }
}

declare module '@ember/service' {
  interface Registry {
    'oauth-provider': OAuthProviderService;
  }
}
