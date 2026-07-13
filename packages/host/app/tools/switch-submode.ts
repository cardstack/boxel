import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import { Submodes } from '../components/submode-switcher';

import HostBaseTool from '../lib/host-base-tool';

import WriteTextFileTool from './write-text-file';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type StoreService from '../services/store';
import type * as BaseToolModule from '@cardstack/base/command';

export default class SwitchSubmodeTool extends HostBaseTool<
  typeof BaseToolModule.SwitchSubmodeInput,
  typeof BaseToolModule.SwitchSubmodeResult | undefined
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private store: StoreService;

  static actionVerb = 'Switch';

  description =
    'Navigate the UI to another submode. Possible values for submode are "interact" and "code".';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { SwitchSubmodeInput } = commandModule;
    return SwitchSubmodeInput;
  }

  requireInputFields = ['submode'];

  private get allStackItems() {
    return this.operatorModeStateService.state?.stacks.flat() ?? [];
  }

  private get lastStackItem() {
    if (this.allStackItems.length <= 0) {
      return null;
    }
    return this.allStackItems[this.allStackItems.length - 1];
  }

  private get lastCardInRightMostStack() {
    let stackItem = this.lastStackItem;
    if (!stackItem) {
      return null;
    }
    return this.store.peek(stackItem.id)?.id;
  }

  protected async run(
    input: BaseToolModule.SwitchSubmodeInput,
  ): Promise<BaseToolModule.SwitchSubmodeResult | undefined> {
    let resultCard: BaseToolModule.SwitchSubmodeResult | undefined;
    switch (input.submode) {
      case Submodes.Interact:
        await this.operatorModeStateService.updateCodePath(null);
        break;
      case Submodes.Code: {
        let lastId = this.lastCardInRightMostStack;
        let codePath =
          input.codePath ??
          (lastId
            ? this.lastStackItem?.type === 'file'
              ? lastId
              : lastId + '.json'
            : null);
        let codeRRI = codePath ? rri(codePath) : null;
        let currentSubmode = this.operatorModeStateService.state.submode;
        let finalCodePath = codeRRI;
        if (
          codeRRI &&
          input.createFile &&
          currentSubmode === Submodes.Interact
        ) {
          let writeTextFileCommand = new WriteTextFileTool(this.toolContext);
          let writeResult = await writeTextFileCommand.execute({
            path: codeRRI,
            content: '',
            useNonConflictingFilename: true,
          });
          if (writeResult.fileIdentifier !== codeRRI) {
            finalCodePath = rri(writeResult.fileIdentifier);

            let commandModule = await this.loadToolModule();
            const { SwitchSubmodeResult } = commandModule;
            resultCard = new SwitchSubmodeResult({
              codePath: finalCodePath,
            });
          }
        }
        await this.operatorModeStateService.updateCodePath(finalCodePath);
        break;
      }
      default:
        throw new Error(`invalid submode specified: ${input.submode}`);
    }

    await this.operatorModeStateService.updateSubmode(input.submode);
    if (this.operatorModeStateService.workspaceChooserOpened) {
      this.operatorModeStateService.closeWorkspaceChooser();
    }

    return resultCard;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SwitchSubmodeTool as SwitchSubmodeCommand };
