import { getService } from '@universal-ember/test-support';

import ENV from '@cardstack/host/config/environment';
import type {
  ClaimedDomain,
  HomePageCheck,
  HostURL,
} from '@cardstack/host/services/realm-server';
import { HostURLRequestError } from '@cardstack/host/services/realm-server';

import { testRealmURL } from './index';

const spaceDomain = ENV.publishedRealmBoxelSpaceDomain;

// The Boxel Space URL the server gives for the test realm, in the realm
// owner's Space.
export const SPACE_URL = `https://testuser.${spaceDomain}/test/`;

export const VIEWABLE: HomePageCheck = {
  homeCardId: `${testRealmURL}index`,
  homeCardReadable: true,
  homeCardStatus: 200,
  unloadableModules: [],
  anonymousCanView: true,
};

// A stand-in for the realm server's `/_host-urls` endpoints, set on the
// realm-server service's methods. It keeps the realm's host URLs, records
// each change in `calls`, and counts the reads of the list in `listCalls`.
export class FakeHostURLs {
  hostURLs: HostURL[] = [];
  boxelSpaceURL: string | undefined = SPACE_URL;
  homePage: HomePageCheck = VIEWABLE;
  calls: string[] = [];
  listCalls = 0;
  refusal: string | undefined;
  claimedDomain: ClaimedDomain | null = null;
  #nextId = 1;
  #restore: (() => void)[] = [];

  install() {
    let realmServer = getService('realm-server') as any;
    let stub = (name: string, fn: (...args: any[]) => unknown) => {
      let original = realmServer[name];
      realmServer[name] = fn;
      this.#restore.push(() => (realmServer[name] = original));
    };
    stub('listHostURLs', async () => {
      this.listCalls++;
      return {
        hostURLs: this.hostURLs.map((h) => ({ ...h })),
        boxelSpaceURL: this.boxelSpaceURL,
      };
    });
    stub('checkHomePage', async () => this.homePage);
    stub('fetchBoxelClaimedDomain', async () => this.claimedDomain);
    stub('mountHostURL', async (_realmURL: string, url: string) => {
      this.calls.push(`mount ${url}`);
      if (this.refusal) {
        throw new HostURLRequestError(422, this.refusal);
      }
      let hostURL: HostURL = {
        id: `host-url-${this.#nextId++}`,
        url,
        kind: url.includes(spaceDomain) ? 'boxel-space' : 'custom-domain',
        isCanonical: this.hostURLs.length === 0,
      };
      this.hostURLs.push(hostURL);
      return hostURL;
    });
    stub('setCanonicalHostURL', async (id: string) => {
      this.calls.push(`canonical ${id}`);
      for (let hostURL of this.hostURLs) {
        hostURL.isCanonical = hostURL.id === id;
      }
    });
    stub('unpublishRealm', async (publishedRealmURL: string) => {
      this.calls.push(`unpublish ${publishedRealmURL}`);
      return { sourceRealmURL: null, publishedRealmURL, lastPublishedAt: null };
    });
    stub('unmountHostURL', async (id: string) => {
      this.calls.push(`unmount ${id}`);
      // Unmounting a site name frees its claim.
      if (this.hostURLs.find((h) => h.id === id)?.kind === 'site-name') {
        this.claimedDomain = null;
      }
      this.hostURLs = this.hostURLs.filter((h) => h.id !== id);
    });
  }

  restore() {
    for (let restore of this.#restore) {
      restore();
    }
  }
}
