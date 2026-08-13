import { RealmPaths, ri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import GetAvailableRealmIdentifiersTool from './get-available-realm-identifiers';

import type * as BaseToolModule from '@cardstack/base/command';

export default class ValidateRealmTool extends HostBaseTool<
  typeof BaseToolModule.ValidateRealmInput,
  typeof BaseToolModule.ValidateRealmResult
> {
  description = 'Validate that a realm URL is available and normalize it';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ValidateRealmInput } = commandModule;
    return ValidateRealmInput;
  }

  requireInputFields = ['realmIdentifier'];

  protected async run(
    input: BaseToolModule.ValidateRealmInput,
  ): Promise<BaseToolModule.ValidateRealmResult> {
    // Normalizing the input is part of this tool's contract, and the input is
    // model-authored, so an equivalent-but-non-canonical URL spelling — host
    // casing, `..` segments, a default port — has to resolve to the realm it
    // names rather than be reported invalid. Parsing is what canonicalizes a
    // URL; a scoped prefix identifier has no such spelling variance and
    // doesn't parse as one, so it is taken as written.
    let canonical = input.realmIdentifier;
    try {
      canonical = new URL(input.realmIdentifier).href;
    } catch {
      // not URL-shaped — a scoped prefix identifier
    }
    let realmIdentifier = new RealmPaths(ri(canonical)).url;

    let { realmIdentifiers } = await new GetAvailableRealmIdentifiersTool(
      this.toolContext,
    ).execute();

    if (!realmIdentifiers.includes(realmIdentifier)) {
      throw new Error(`Invalid realm: ${realmIdentifier}`);
    }

    let commandModule = await this.loadToolModule();
    const { ValidateRealmResult } = commandModule;
    return new ValidateRealmResult({ realmIdentifier });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { ValidateRealmTool as ValidateRealmCommand };
