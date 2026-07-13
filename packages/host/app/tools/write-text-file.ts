import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import { findNonConflictingFilename } from '../utils/file-name';

import type CardService from '../services/card-service';
import type { SaveType } from '../services/card-service';
import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

export default class WriteTextFileTool extends HostBaseTool<
  typeof BaseToolModule.WriteTextFileInput,
  typeof BaseToolModule.FileIdentifierCard
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;

  description = `Write a text file to a realm, such as a module or a card.`;
  static actionVerb = 'Write';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { WriteTextFileInput } = commandModule;
    return WriteTextFileInput;
  }

  requireInputFields = ['path', 'content'];

  protected async run(
    input: BaseToolModule.WriteTextFileInput,
  ): Promise<BaseToolModule.FileIdentifierCard> {
    if (input.overwrite && input.useNonConflictingFilename) {
      throw new Error(
        'Cannot use both overwrite and useNonConflictingFilename.',
      );
    }
    let realm;
    if (input.realm) {
      realm = this.realm.realmOf(rri(input.realm));
      if (!realm) {
        throw new Error(`Invalid or unknown realm provided: ${input.realm}`);
      }
    }
    let path = input.path;
    if (path.startsWith('/')) {
      path = path.slice(1);
    }
    let url = new URL(path, realm);
    let finalUrl = url;
    let shouldWrite = true;
    if (!input.overwrite) {
      if (input.useNonConflictingFilename) {
        let existing = await this.cardService.getSource(url);
        if (existing.status === 404) {
          shouldWrite = true;
        } else if (existing.status === 200) {
          if (existing.content.trim() !== '') {
            let nonConflictingUrl = await findNonConflictingFilename(
              url.href,
              (candidateUrl) => this.fileExists(candidateUrl),
            );
            finalUrl = new URL(nonConflictingUrl);
          } else {
            shouldWrite = input.content.trim() !== '';
          }
        } else {
          throw new Error(
            `Error checking if file exists at ${url}: ${existing.status}`,
          );
        }
      } else {
        let existing = await this.cardService.getSource(url);
        if (existing.status === 200 || existing.status === 406) {
          throw new Error(`File already exists: ${path}`);
        }

        if (existing.status !== 404) {
          let errorDetails = existing.content?.trim()
            ? `${existing.content} (${existing.status})`
            : `${existing.status}`;
          throw new Error(
            `Error checking if file exists at ${path}: ${errorDetails}`,
          );
        }
      }
    }
    if (shouldWrite) {
      let saveType: SaveType = input.overwrite ? 'editor' : 'create-file';
      await this.cardService.saveSource(finalUrl, input.content, saveType);
    }

    let commandModule = await this.loadToolModule();
    const { FileIdentifierCard } = commandModule;
    return new FileIdentifierCard({ fileIdentifier: finalUrl.href });
  }

  private async fileExists(fileUrl: string): Promise<boolean> {
    let getSourceResult = await this.cardService.getSource(rri(fileUrl));
    return getSourceResult.status !== 404;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { WriteTextFileTool as WriteTextFileCommand };
