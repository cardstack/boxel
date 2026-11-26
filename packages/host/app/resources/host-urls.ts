import type Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { service } from '@ember/service';

import { Resource } from 'ember-modify-based-class-resource';

import type HostURLService from '@cardstack/host/services/host-url-service';
import type { HostURL } from '@cardstack/host/services/realm-server';

interface Args {
  named: { realmURL: string | undefined; owner: Owner };
}

// A realm's host URLs, from the host URL service. The first use reads them
// from the realm server; the service reads each realm once, and a change made
// through the service reads it again. With no realm URL there are none, and
// nothing is read.
export class HostURLsResource extends Resource<Args> {
  @service declare private hostUrlService: HostURLService;

  private realmURL: string | undefined;

  modify(_positional: never[], named: Args['named']) {
    setOwner(this, named.owner);
    this.realmURL = named.realmURL;
    if (named.realmURL) {
      this.hostUrlService.load(named.realmURL);
    }
  }

  get hostURLs(): HostURL[] {
    return this.realmURL ? this.hostUrlService.hostURLsFor(this.realmURL) : [];
  }
}

export function loadHostURLs(
  parent: object,
  owner: Owner,
  realmURL: () => string | undefined,
) {
  return HostURLsResource.from(parent, () => ({
    named: { realmURL: realmURL(), owner },
  }));
}
