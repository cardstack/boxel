import { service } from '@ember/service';

import { ensureTrailingSlash } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmService from '../services/realm';

// Lists a source realm's published destinations and when each was last
// published. The data comes from the source realm's `_info` response, whose
// `lastPublishedAt` is a { publishedRealmURL: lastPublishedAt } map populated
// server-side from the realm_registry.
export default class GetPublishedRealmsCommand extends HostBaseCommand<
  typeof BaseCommandModule.GetPublishedRealmsInput,
  typeof BaseCommandModule.GetPublishedRealmsResult
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Get Published Realms';
  description =
    "Get a source realm's published destinations and when each was last published";

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    return commandModule.GetPublishedRealmsInput;
  }

  requireInputFields = ['realmURL'];

  protected async run(
    input: BaseCommandModule.GetPublishedRealmsInput,
  ): Promise<BaseCommandModule.GetPublishedRealmsResult> {
    let commandModule = await this.loadCommandModule();
    let { GetPublishedRealmsResult, PublishedRealmInfo } = commandModule;

    let realmURL = ensureTrailingSlash(input.realmURL);
    // Force a fresh _info fetch so lastPublishedAt reflects the registry.
    await this.realm.ensureRealmMeta(realmURL);
    let { lastPublishedAt } = this.realm.info(realmURL);

    // For a source realm lastPublishedAt is a { publishedRealmURL: at } map; a
    // plain string (the realm is itself a published realm) or null means no
    // publications to report.
    let results =
      lastPublishedAt && typeof lastPublishedAt === 'object'
        ? Object.entries(lastPublishedAt).map(
            ([publishedRealmURL, at]) =>
              new PublishedRealmInfo({
                publishedRealmURL,
                lastPublishedAt: at,
              }),
          )
        : [];

    return new GetPublishedRealmsResult({ results });
  }
}
