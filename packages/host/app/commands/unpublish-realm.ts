import { service } from '@ember/service';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';

import config from '@cardstack/host/config/environment';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';
import {
  resolvePublishedRealmUrl,
  type PublishTargetType,
} from '../lib/published-realm-url';

import type RealmService from '../services/realm';

// Unpublishes a realm from a single published destination. Resolves once the
// realm-server accepts the request; there is no reindex on unpublish (the
// published realm is removed), so v1 has no completion-wait.
export default class UnpublishRealmCommand extends HostBaseCommand<
  typeof BaseCommandModule.UnpublishRealmInput,
  typeof BaseCommandModule.UnpublishRealmResult
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Unpublish';
  description = 'Unpublish a realm from a published destination';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    return commandModule.UnpublishRealmInput;
  }

  requireInputFields = ['realmURL'];

  protected async run(
    input: BaseCommandModule.UnpublishRealmInput,
  ): Promise<BaseCommandModule.UnpublishRealmResult> {
    let commandModule = await this.loadCommandModule();
    let { UnpublishRealmResult } = commandModule;

    // Normalize so the cached RealmResource (token/claims, _unPublishingRealms
    // tracking the UI observes) is the one the request acts on.
    let realmURL = ensureTrailingSlash(input.realmURL);
    let publishedRealmURL = this.resolvePublishedRealmURL(input, realmURL);

    // Go through RealmService.unpublish so the UI's reactive unpublish state
    // (_unPublishingRealms, info.lastPublishedAt) updates. It now propagates
    // failures, which we map to an error result.
    try {
      await this.realm.unpublish(realmURL, publishedRealmURL);
      return new UnpublishRealmResult({
        publishedRealmURL,
        status: 'unpublished',
      });
    } catch (e) {
      return new UnpublishRealmResult({
        publishedRealmURL,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private resolvePublishedRealmURL(
    input: BaseCommandModule.UnpublishRealmInput,
    realmURL: string,
  ): string {
    if (input.publishedRealmURL) {
      return input.publishedRealmURL;
    }
    if (!input.target) {
      throw new Error(
        'Provide either a `target` or a `publishedRealmURL` to unpublish',
      );
    }
    let userId = this.realm.getOrCreateRealmResource(realmURL).claims?.user;
    return resolvePublishedRealmUrl(
      {
        type: input.target.type as PublishTargetType,
        name: input.target.name,
      },
      {
        sourceRealmURL: realmURL,
        matrixUsername: userId ? getMatrixUsername(userId) : undefined,
        spaceDomain: config.publishedRealmBoxelSpaceDomain,
      },
    );
  }
}
