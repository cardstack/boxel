import { service } from '@ember/service';

import { ensureTrailingSlash } from '@cardstack/runtime-common';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';

// Lists a source realm's published destinations and when each was last
// published. The data comes from the source realm's `_info` response, whose
// `lastPublishedAt` is a { publishedRealmURL: lastPublishedAt } map populated
// server-side from the realm_registry.
export default class GetPublishedRealmsTool extends HostBaseTool<
  typeof BaseToolModule.GetPublishedRealmsInput,
  typeof BaseToolModule.GetPublishedRealmsResult
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Get Published Realms';
  description =
    "Get a source realm's published destinations and when each was last published";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.GetPublishedRealmsInput;
  }

  requireInputFields = ['realmURL'];

  protected async run(
    input: BaseToolModule.GetPublishedRealmsInput,
  ): Promise<BaseToolModule.GetPublishedRealmsResult> {
    let commandModule = await this.loadToolModule();
    let { GetPublishedRealmsResult, PublishedRealmInfo } = commandModule;

    let realmURL = ensureTrailingSlash(input.realmURL);
    // Force a fresh _info fetch so lastPublishedAt reflects the registry.
    await this.realm.ensureRealmMeta(realmURL);
    let { lastPublishedAt } = this.realm.info(realmURL);

    // For a source realm lastPublishedAt is a { publishedRealmURL: at } map; a
    // plain string (the realm is itself a published realm) or null means no
    // publications to report. A published destination is reported even if its
    // timestamp is missing — coerce to a string so the result keeps the
    // declared StringField contract rather than dropping a real publication.
    let results =
      lastPublishedAt && typeof lastPublishedAt === 'object'
        ? Object.entries(lastPublishedAt).map(
            ([publishedRealmURL, at]) =>
              new PublishedRealmInfo({
                publishedRealmURL,
                lastPublishedAt: at == null ? '' : String(at),
              }),
          )
        : [];

    return new GetPublishedRealmsResult({ results });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { GetPublishedRealmsTool as GetPublishedRealmsCommand };
