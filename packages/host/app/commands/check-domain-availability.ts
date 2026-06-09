import { service } from '@ember/service';

import config from '@cardstack/host/config/environment';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';
import { resolvePublishedRealmUrl } from '../lib/published-realm-url';

import type RealmServerService from '../services/realm-server';

// Checks whether a custom published-realm subdomain is available to claim, and
// reports the published-realm URL it would map to. Only custom Boxel Site
// subdomains have a server-side availability check; subdirectory Boxel Spaces
// are namespaced to the owner and have no contention, so they are not checked
// here.
export default class CheckDomainAvailabilityCommand extends HostBaseCommand<
  typeof BaseCommandModule.CheckDomainAvailabilityInput,
  typeof BaseCommandModule.CheckDomainAvailabilityResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Check Availability';
  description =
    'Check whether a custom published-realm domain is available to claim';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    return commandModule.CheckDomainAvailabilityInput;
  }

  requireInputFields = ['type', 'name'];

  protected async run(
    input: BaseCommandModule.CheckDomainAvailabilityInput,
  ): Promise<BaseCommandModule.CheckDomainAvailabilityResult> {
    let commandModule = await this.loadCommandModule();
    let { CheckDomainAvailabilityResult } = commandModule;

    if (input.type !== 'custom') {
      throw new Error(
        `Availability checks apply to custom domains only; got type '${input.type}'`,
      );
    }

    // `name` is the subdomain (e.g. "my-site"); the result URL appends the
    // configured custom-site base domain.
    let result = await this.realmServer.checkDomainAvailability(input.name);
    let publishedRealmURL = resolvePublishedRealmUrl({
      type: 'custom',
      name: `${input.name}.${config.publishedRealmBoxelSiteDomain}`,
    });

    return new CheckDomainAvailabilityResult({
      available: result.available,
      publishedRealmURL,
      reason: result.error,
    });
  }
}
