import { service } from '@ember/service';

import { resolvePublishedRealmUrl } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';

// Checks whether a custom published-realm subdomain is available to claim, and
// reports the published-realm URL it would map to. Only custom Boxel Site
// subdomains have a server-side availability check; subdirectory Boxel Spaces
// are namespaced to the owner and have no contention, so they are not checked
// here.
export default class CheckDomainAvailabilityTool extends HostBaseTool<
  typeof BaseToolModule.CheckDomainAvailabilityInput,
  typeof BaseToolModule.CheckDomainAvailabilityResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Check Availability';
  description =
    'Check whether a custom published-realm domain is available to claim';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.CheckDomainAvailabilityInput;
  }

  requireInputFields = ['type', 'name'];

  protected async run(
    input: BaseToolModule.CheckDomainAvailabilityInput,
  ): Promise<BaseToolModule.CheckDomainAvailabilityResult> {
    let commandModule = await this.loadToolModule();
    let { CheckDomainAvailabilityResult } = commandModule;

    if (input.type !== 'custom') {
      throw new Error(
        `Availability checks apply to custom domains only; got type '${input.type}'`,
      );
    }

    // `name` is the subdomain (e.g. "my-site"). The server returns the
    // canonical hostname (built from its own custom-site base domain); use it
    // so the published URL can't drift from the server's config, falling back
    // to the client config only if it's somehow absent.
    let result = await this.realmServer.checkDomainAvailability(input.name);
    let hostname =
      result.hostname ||
      `${input.name}.${config.publishedRealmBoxelSiteDomain}`;
    let publishedRealmURL = resolvePublishedRealmUrl({
      type: 'custom',
      name: hostname,
    });

    return new CheckDomainAvailabilityResult({
      available: result.available,
      publishedRealmURL,
      // The server only returns an error for a rejected (e.g. invalid) name;
      // pass it through as the reason, omitting it otherwise.
      ...(result.error ? { reason: result.error } : {}),
    });
  }
}
