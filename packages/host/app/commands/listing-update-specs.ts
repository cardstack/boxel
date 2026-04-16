import { isScopedCSSRequest } from 'glimmer-scoped-css';

import { isCardInstance, SupportedMimeType } from '@cardstack/runtime-common';

import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { Spec } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';

import AuthedFetchCommand from './authed-fetch';
import CanReadRealmCommand from './can-read-realm';
import CreateSpecCommand from './create-specs';
import GetRealmOfUrlCommand from './get-realm-of-url';

export default class ListingUpdateSpecsCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingUpdateSpecsInput,
  typeof BaseCommandModule.ListingUpdateSpecsResult
> {
  static actionVerb = 'Update';
  description = 'Update listing specs based on example dependencies';
  requireInputFields = ['listing'];

  async getInputType() {
    const commandModule = await this.loadCommandModule();
    let { ListingUpdateSpecsInput } = commandModule;
    return ListingUpdateSpecsInput;
  }

  private async sanitizeDeps(deps: string[]): Promise<string[]> {
    const results = await Promise.all(
      deps.map(async (dep) => {
        if (isScopedCSSRequest(dep)) {
          return null;
        }
        if (
          [
            'https://cardstack.com',
            'https://packages',
            'https://boxel-icons.boxel.ai',
          ].some((urlStem) => dep.startsWith(urlStem))
        ) {
          return null;
        }
        try {
          const { realmUrl } = await new GetRealmOfUrlCommand(
            this.commandContext,
          ).execute({ url: dep });
          if (!realmUrl) {
            return null;
          }
          const { canRead } = await new CanReadRealmCommand(
            this.commandContext,
          ).execute({ realmUrl });
          return canRead ? dep : null;
        } catch {
          return null;
        }
      }),
    );
    return results.filter((dep): dep is string => dep !== null);
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

    const { ok, body: jsonApiResponse } = await new AuthedFetchCommand(
      this.commandContext,
    ).execute({
      url: `${targetRealm}_dependencies?url=${encodeURIComponent(exampleId)}`,
      acceptHeader: SupportedMimeType.JSONAPI,
    });
    if (!ok) {
      throw new Error('Failed to fetch dependencies for listing');
    }

    // Extract dependencies from all entries in the JSONAPI response
    const deps: string[] = [];
    const responseData = (
      jsonApiResponse as {
        data?: Array<{ attributes?: { dependencies?: string[] } }>;
      }
    ).data;
    if (responseData && Array.isArray(responseData)) {
      for (const entry of responseData) {
        if (
          entry.attributes?.dependencies &&
          Array.isArray(entry.attributes.dependencies)
        ) {
          deps.push(...entry.attributes.dependencies);
        }
      }
    }

    const sanitizedDeps = await this.sanitizeDeps(deps);
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
