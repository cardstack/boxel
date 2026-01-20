import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import { Submodes } from '../components/submode-switcher';

import HostBaseCommand from '../lib/host-base-command';

import { findNonConflictingFilename } from '../utils/file-name';

import type CardService from '../services/card-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type StoreService from '../services/store';

export default class SwitchSubmodeCommand extends HostBaseCommand<
  typeof BaseCommandModule.SwitchSubmodeInput,
  typeof BaseCommandModule.SwitchSubmodeResult | undefined
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private cardService: CardService;
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

  private get lastCardInRightMostStack() {
    if (this.allStackItems.length <= 0) {
      return null;
    }

    return this.store.peek(this.allStackItems[this.allStackItems.length - 1].id)
      ?.id;
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
        let codePath =
          input.codePath ??
          (this.lastCardInRightMostStack
            ? this.lastCardInRightMostStack + '.json'
            : null);
        let codeUrl = codePath ? new URL(codePath) : null;
        let currentSubmode = this.operatorModeStateService.state.submode;
        let finalCodeUrl = codeUrl;
        if (
          codeUrl &&
          input.createFile &&
          currentSubmode === Submodes.Interact
        ) {
          let { status, content } = await this.cardService.getSource(codeUrl);
          if (status === 404) {
            await this.cardService.saveSource(codeUrl, '', 'create-file');
          } else if (status === 200) {
            if (content.trim() !== '') {
              let nonConflictingUrl = await findNonConflictingFilename(
                codeUrl.href,
                (candidateUrl) => this.fileExists(candidateUrl),
              );
              let newCodeUrl = new URL(nonConflictingUrl);
              await this.cardService.saveSource(newCodeUrl, '', 'create-file');
              finalCodeUrl = newCodeUrl;

              let commandModule = await this.loadCommandModule();
              const { SwitchSubmodeResult } = commandModule;
              resultCard = new SwitchSubmodeResult({
                codePath: newCodeUrl.href,
                requestedCodePath: codeUrl.href,
              });
            }
          } else {
            throw new Error(
              `Error checking if file exists at ${codeUrl}: ${status}`,
            );
          }
        }
        await this.operatorModeStateService.updateCodePath(finalCodeUrl);
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

  private async fileExists(fileUrl: string): Promise<boolean> {
    let getSourceResult = await this.cardService.getSource(new URL(fileUrl));
    return getSourceResult.status !== 404;
  }
}
