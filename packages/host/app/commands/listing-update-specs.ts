import { service } from '@ember/service';

import { isScopedCSSRequest } from 'glimmer-scoped-css';

import { isCardInstance, SupportedMimeType } from '@cardstack/runtime-common';

import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { Spec } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';

import CreateSpecCommand from './create-specs';

import type NetworkService from '../services/network';
import type RealmService from '../services/realm';

export default class ListingUpdateSpecsCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingUpdateSpecsInput,
  typeof BaseCommandModule.ListingUpdateSpecsResult
> {
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  static actionVerb = 'Update';
  description = 'Update listing specs based on example dependencies';
  requireInputFields = ['listing'];

  async getInputType() {
    const commandModule = await this.loadCommandModule();
    let { ListingUpdateSpecsInput } = commandModule;
    return ListingUpdateSpecsInput;
  }

  private sanitizeDeps(deps: string[]) {
    return deps.filter((dep) => {
      if (isScopedCSSRequest(dep)) {
        return false;
      }
      if (
        [
          'https://cardstack.com',
          'https://packages',
          'https://boxel-icons.boxel.ai',
        ].some((urlStem) => dep.startsWith(urlStem))
      ) {
        return false;
      }
      try {
        const url = new URL(dep);
        const realmURL = this.realm.realmOfURL(url);
        if (!realmURL) {
          return false;
        }
        return this.realm.canRead(realmURL.href);
      } catch {
        return false;
      }
    });
  }

  protected async run(
    input: BaseCommandModule.ListingUpdateSpecsInput,
  ): Promise<BaseCommandModule.ListingUpdateSpecsResult> {
    const listing = input.listing;
    if (!listing) {
      throw new Error('listing is required');
    }
    if (!isCardInstance(listing)) {
      throw new Error('listing must be a valid card instance');
    }

    const targetRealm = (listing as any)?.[realmURLSymbol]?.href;

    if (!targetRealm) {
      throw new Error('targetRealm is required to update specs');
    }

    const exampleId = (listing as any).examples?.[0]?.id;
    if (!exampleId) {
      throw new Error('No example found in listing to derive specs from');
    }

    const response = await this.network.authedFetch(
      `${targetRealm}_dependencies?url=${encodeURIComponent(exampleId)}`,
      { headers: { Accept: SupportedMimeType.JSONAPI } },
    );
    if (!response.ok) {
      throw new Error('Failed to fetch dependencies for listing');
    }

    const jsonApiResponse = (await response.json()) as {
      data?: Array<{
        type: string;
        id: string;
        attributes?: {
          dependencies?: string[];
        };
      }>;
    };

    // Extract dependencies from all entries in the JSONAPI response
    const deps: string[] = [];
    if (jsonApiResponse.data && Array.isArray(jsonApiResponse.data)) {
      for (const entry of jsonApiResponse.data) {
        if (
          entry.attributes?.dependencies &&
          Array.isArray(entry.attributes.dependencies)
        ) {
          deps.push(...entry.attributes.dependencies);
        }
      }
    }

    console.log('updated listing deps', deps);

    const sanitizedDeps = this.sanitizeDeps(deps);
    const commandModule = await this.loadCommandModule();
    if (!sanitizedDeps.length) {
      (listing as any).specs = [];
      return new commandModule.ListingUpdateSpecsResult({
        listing,
        specs: [],
      });
    }

    const createSpecCommand = new CreateSpecCommand(this.commandContext);
    const specResults = await Promise.all(
      sanitizedDeps.map((dep) =>
        createSpecCommand
          .execute({ module: dep, targetRealm, autoGenerateReadme: true })
          .catch((e) => {
            console.warn('Failed to create spec(s) for', dep, e);
            return undefined;
          }),
      ),
    );

    const specs: Spec[] = [];
    for (const res of specResults) {
      if (res?.specs) {
        specs.push(...res.specs);
      }
    }
    (listing as any).specs = specs;
    return new commandModule.ListingUpdateSpecsResult({ listing, specs });
  }
}
