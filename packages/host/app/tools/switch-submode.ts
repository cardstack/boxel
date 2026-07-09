import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import { Submodes } from '../components/submode-switcher';

import HostBaseTool from '../lib/host-base-tool';

import WriteTextFileTool from './write-text-file';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type StoreService from '../services/store';

export default class SwitchSubmodeTool extends HostBaseTool<
  typeof BaseCommandModule.SwitchSubmodeInput,
  typeof BaseCommandModule.SwitchSubmodeResult | undefined
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private store: StoreService;

  static actionVerb = 'Switch';

  description =
    'Navigate the UI to another submode. Possible values for submode are "interact" and "code".';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
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
    input: BaseCommandModule.SwitchSubmodeInput,
  ): Promise<BaseCommandModule.SwitchSubmodeResult | undefined> {
    let resultCard: BaseCommandModule.SwitchSubmodeResult | undefined;
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
          let writeTextFileCommand = new WriteTextFileTool(this.commandContext);
          let writeResult = await writeTextFileCommand.execute({
            path: codeRRI,
            content: '',
            useNonConflictingFilename: true,
          });
          if (writeResult.fileIdentifier !== codeRRI) {
            finalCodePath = rri(writeResult.fileIdentifier);

            let commandModule = await this.loadCommandModule();
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
