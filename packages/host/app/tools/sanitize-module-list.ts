import { service } from '@ember/service';

import {
  CATALOG_REALM_PREFIX,
  PREFIX_REALM_PREFIXES,
  RealmPaths,
  isScopedCSSRequest,
  ri,
  rri,
  trimExecutableExtension,
} from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import CanReadRealmTool from './can-read-realm';
import GetRealmOfResourceIdentifierTool from './get-realm-of-resource-identifier';

import type NetworkService from '../services/network';
import type * as BaseToolModule from '@cardstack/base/command';

const GLOBAL_URL_STEMS = [
  'https://cardstack.com',
  'https://packages',
  'https://boxel-icons.boxel.ai',
];

// The platform's own realms (base, Pret UI, skills and the rest). The catalog
// is left in: a catalog card's listing is made from catalog modules.
const PLATFORM_REALM_PATHS = PREFIX_REALM_PREFIXES.filter(
  (prefix) => prefix !== CATALOG_REALM_PREFIX,
).map((prefix) => new RealmPaths(ri(prefix)));

export default class SanitizeModuleListTool extends HostBaseTool<
  typeof BaseToolModule.SanitizeModuleListInput,
  typeof BaseToolModule.SanitizeModuleListResult
> {
  @service declare private network: NetworkService;

  description =
    'Filter and deduplicate a list of module URLs, removing globals, platform realm modules and unreadable realms';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { SanitizeModuleListInput } = commandModule;
    return SanitizeModuleListInput;
  }

  requireInputFields = ['moduleIdentifiers'];

  protected async run(
    input: BaseToolModule.SanitizeModuleListInput,
  ): Promise<BaseToolModule.SanitizeModuleListResult> {
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
        // Readable, but never a listing's own code, whether spelled by prefix
        // or by the URL the realm is served at.
        let unresolved = this.network.virtualNetwork.unresolveURL(dep);
        if (PLATFORM_REALM_PATHS.some((paths) => paths.inRealm(unresolved))) {
          return null;
        }

        // Only allow modules that belong to a realm we can read
        const { realmIdentifier } = await new GetRealmOfResourceIdentifierTool(
          this.toolContext,
        ).execute({ resourceIdentifier: dep });
        if (!realmIdentifier) {
          return null;
        }
        const { canRead } = await new CanReadRealmTool(
          this.toolContext,
        ).execute({ realmIdentifier });
        return canRead ? dep : null;
      }),
    );

    const moduleIdentifiers = results.filter(
      (dep): dep is string => dep !== null,
    );

    let commandModule = await this.loadToolModule();
    const { SanitizeModuleListResult } = commandModule;
    return new SanitizeModuleListResult({ moduleIdentifiers });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SanitizeModuleListTool as SanitizeModuleListCommand };
