import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';
import { findNonConflictingFilename } from '../utils/file-name';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';

export default class CopyFileToRealmCommand extends HostBaseCommand<
  typeof BaseCommandModule.CopyFileToRealmInput,
  typeof BaseCommandModule.CopyFileToRealmResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;

  description = 'Copy a file to a realm';
  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CopyFileToRealmInput } = commandModule;
    return CopyFileToRealmInput;
  }

  requireInputFields = ['sourceFileIdentifier', 'targetRealm'];

  protected async run(
    input: BaseCommandModule.CopyFileToRealmInput,
  ): Promise<BaseCommandModule.CopyFileToRealmResult> {
    let targetRealm =
      input.targetRealm || this.realm.defaultWritableRealm?.path;
    if (!targetRealm) {
      throw new Error('No writable realm available to copy file to');
    }

    if (!this.realm.canWrite(targetRealm)) {
      throw new Error(`Do not have write permissions to ${targetRealm}`);
    }

    let sourceUrl = new URL(input.sourceFileIdentifier);
    let filename = decodeURIComponent(
      sourceUrl.pathname.split('/').pop() ?? sourceUrl.pathname,
    );

    let destinationUrl = new URL(filename, targetRealm);

    let existing = await this.cardService.getSource(destinationUrl);
    if (existing.status === 200 || existing.status === 406) {
      let nonConflictingUrl = await findNonConflictingFilename(
        destinationUrl.href,
        (candidateUrl) => this.fileExists(candidateUrl),
      );
      destinationUrl = new URL(nonConflictingUrl);
    } else if (existing.status !== 404) {
      throw new Error(
        `Error checking if file exists at ${destinationUrl}: ${existing.status}`,
      );
    }

    let result = await this.cardService.copySource(sourceUrl, destinationUrl);
    if (!result.ok) {
      throw new Error(
        `Failed to copy file from ${input.sourceFileIdentifier} to ${destinationUrl.href}`,
      );
    }

    let commandModule = await this.loadCommandModule();
    const { CopyFileToRealmResult } = commandModule;
    return new CopyFileToRealmResult({
      newFileIdentifier: destinationUrl.href,
    });
  }

  private async fileExists(fileUrl: string): Promise<boolean> {
    let getSourceResult = await this.cardService.getSource(rri(fileUrl));
    return getSourceResult.status !== 404;
  }
}
