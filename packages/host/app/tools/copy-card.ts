import { service } from '@ember/service';

import { RealmPaths, ri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';
import type * as BaseToolModule from '@cardstack/base/command';

export default class CopyCardToRealmTool extends HostBaseTool<
  typeof BaseToolModule.CopyCardToRealmInput,
  typeof BaseToolModule.CopyCardResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  description =
    'Copy a card to a realm. The result card holds newCardId, the URL of the copy.';
  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CopyCardToRealmInput } = commandModule;
    return CopyCardToRealmInput;
  }

  requireInputFields = ['sourceCard', 'targetRealm'];

  // Instances that are created via this method are eligible for garbage
  // collection--meaning that it will be detached from the store. This means you
  // MUST consume the instance IMMEDIATELY! it should not live in the state of
  // the consumer.
  protected async run(
    input: BaseToolModule.CopyCardToRealmInput,
  ): Promise<BaseToolModule.CopyCardResult> {
    let targetRealm =
      input.targetRealm || this.realm.defaultWritableRealm?.path;
    if (!targetRealm) {
      throw new Error('No writable realm available to copy card to');
    }

    if (!this.realm.canWrite(targetRealm)) {
      throw new Error(`Do not have write permissions to ${targetRealm}`);
    }
    let localDir = resolveLocalDir(targetRealm, input.localDir);
    let doc = await this.cardService.serializeCard(input.sourceCard, {
      useAbsoluteURL: true,
    });
    delete doc.data.id;
    let newCardId = await this.store.create(doc, {
      realm: targetRealm,
      localDir,
    });
    if (typeof newCardId !== 'string') {
      throw new Error(
        `unable to save copied card instance: ${JSON.stringify(
          newCardId,
          null,
          2,
        )}`,
      );
    }
    let commandModule = await this.loadToolModule();
    const { CopyCardResult } = commandModule;
    return new CopyCardResult({ newCardId });
  }
}

// localDir is joined onto the realm URL by URL resolution, so a leading slash
// or a `..` segment would aim the save outside targetRealm, past the write
// check in `run`, which only looks at targetRealm. A leading slash is read as
// the realm root; a `.` or `..` segment, or anything else that resolves outside
// the realm, is refused.
function resolveLocalDir(
  targetRealm: string,
  localDir: string | undefined,
): string | undefined {
  let trimmed = localDir?.replace(/^\/+/, '');
  if (!trimmed) {
    return undefined;
  }
  let segments = trimmed.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  let paths = new RealmPaths(ri(targetRealm));
  if (
    segments.some((segment) => segment === '.' || segment === '..') ||
    !paths.inRealm(paths.directoryRRI(trimmed))
  ) {
    throw new Error(
      `localDir "${localDir}" is not a folder inside ${targetRealm}`,
    );
  }
  return trimmed;
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CopyCardToRealmTool as CopyCardToRealmCommand };
