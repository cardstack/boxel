import { service } from '@ember/service';

import { RealmPaths, ri, rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import { findNonConflictingFilename } from '../utils/file-name';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

export default class CopyFileToRealmTool extends HostBaseTool<
  typeof BaseToolModule.CopyFileToRealmInput,
  typeof BaseToolModule.CopyFileToRealmResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;

  description = 'Copy a file to a realm';
  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CopyFileToRealmInput } = commandModule;
    return CopyFileToRealmInput;
  }

  requireInputFields = ['sourceFileIdentifier', 'targetRealm'];

  protected async run(
    input: BaseToolModule.CopyFileToRealmInput,
  ): Promise<BaseToolModule.CopyFileToRealmResult> {
    let targetRealm =
      input.targetRealm || this.realm.defaultWritableRealm?.path;
    if (!targetRealm) {
      throw new Error('No writable realm available to copy file to');
    }

    if (!this.realm.canWrite(targetRealm)) {
      throw new Error(`Do not have write permissions to ${targetRealm}`);
    }

    // Both identifiers stay in the form they were given, so a realm
    // registered under a prefix gets a prefix-form file identifier back.
    let sourceId = rri(input.sourceFileIdentifier);
    let sourcePath = sourceId.split(/[?#]/)[0];
    let filename = decodeURIComponent(sourcePath.split('/').pop() ?? '');
    if (!filename) {
      throw new Error(
        `sourceFileIdentifier does not name a file: ${input.sourceFileIdentifier}`,
      );
    }

    let destinationId = new RealmPaths(ri(targetRealm)).fileRRI(filename);

    let existing = await this.cardService.getSource(destinationId);
    if (existing.status === 200 || existing.status === 406) {
      destinationId = rri(
        await findNonConflictingFilename(destinationId, (candidateId) =>
          this.fileExists(candidateId),
        ),
      );
    } else if (existing.status !== 404) {
      throw new Error(
        `Error checking if file exists at ${destinationId}: ${existing.status}`,
      );
    }

    let result = await this.cardService.copySource(sourceId, destinationId);
    if (!result.ok) {
      throw new Error(
        `Failed to copy file from ${input.sourceFileIdentifier} to ${destinationId}`,
      );
    }

    let commandModule = await this.loadToolModule();
    const { CopyFileToRealmResult } = commandModule;
    return new CopyFileToRealmResult({
      newFileIdentifier: destinationId,
    });
  }

  private async fileExists(fileUrl: string): Promise<boolean> {
    let getSourceResult = await this.cardService.getSource(rri(fileUrl));
    return getSourceResult.status !== 404;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CopyFileToRealmTool as CopyFileToRealmCommand };
