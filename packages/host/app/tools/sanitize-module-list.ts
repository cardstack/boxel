import {
  isScopedCSSRequest,
  rri,
  trimExecutableExtension,
} from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import CanReadRealmTool from './can-read-realm';
import GetRealmOfResourceIdentifierTool from './get-realm-of-resource-identifier';

const GLOBAL_URL_STEMS = [
  'https://cardstack.com',
  'https://packages',
  'https://boxel-icons.boxel.ai',
];

export default class SanitizeModuleListTool extends HostBaseTool<
  typeof BaseCommandModule.SanitizeModuleListInput,
  typeof BaseCommandModule.SanitizeModuleListResult
> {
  description =
    'Filter and deduplicate a list of module URLs, removing globals and unreadable realms';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SanitizeModuleListInput } = commandModule;
    return SanitizeModuleListInput;
  }

  requireInputFields = ['moduleIdentifiers'];

  protected async run(
    input: BaseCommandModule.SanitizeModuleListInput,
  ): Promise<BaseCommandModule.SanitizeModuleListResult> {
    // Normalize to extensionless URLs before deduplication so that e.g.
    // "https://…/foo.gts" and "https://…/foo" don't produce separate entries.
    const seen = new Map<string, string>(); // normalized → original
    for (const m of input.moduleIdentifiers) {
      const normalized = trimExecutableExtension(rri(m));
      if (!seen.has(normalized)) {
        seen.set(normalized, m);
      }
    }
    let uniqueModules = Array.from(seen.values());

    const results = await Promise.all(
      uniqueModules.map(async (dep) => {
        // Exclude scoped CSS requests
        if (isScopedCSSRequest(dep)) {
          return null;
        }
        // Exclude known global/package/icon sources
        if (GLOBAL_URL_STEMS.some((urlStem) => dep.startsWith(urlStem))) {
          return null;
        }

        // Only allow modules that belong to a realm we can read
        const { realmIdentifier } = await new GetRealmOfResourceIdentifierTool(
          this.commandContext,
        ).execute({ resourceIdentifier: dep });
        if (!realmIdentifier) {
          return null;
        }
        const { canRead } = await new CanReadRealmTool(
          this.commandContext,
        ).execute({ realmIdentifier });
        return canRead ? dep : null;
      }),
    );

    const moduleIdentifiers = results.filter(
      (dep): dep is string => dep !== null,
    );

    let commandModule = await this.loadCommandModule();
    const { SanitizeModuleListResult } = commandModule;
    return new SanitizeModuleListResult({ moduleIdentifiers });
  }
}
