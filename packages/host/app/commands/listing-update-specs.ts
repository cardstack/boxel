import { isCardInstance, SupportedMimeType } from '@cardstack/runtime-common';

import { realmURL as realmURLSymbol } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { Spec } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';

import AuthedFetchCommand from './authed-fetch';
import CreateSpecCommand from './create-specs';
import SanitizeModuleListCommand from './sanitize-module-list';

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
    const { moduleIdentifiers } = await new SanitizeModuleListCommand(
      this.commandContext,
    ).execute({ moduleIdentifiers: deps });
    return moduleIdentifiers;
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
