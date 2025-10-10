import { service } from '@ember/service';

import { ensureExtension } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import SendAiAssistantMessageCommand from './send-ai-assistant-message';

import type AiAssistantPanelService from '../services/ai-assistant-panel-service';
import type MatrixService from '../services/matrix-service';
import type RealmService from '../services/realm';

export default class GenerateExampleCardsCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateInstancesInput,
  undefined
> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private realm: RealmService;

  static actionVerb = 'Generate Example Cards';
  description = 'Create new cards populated with sample data';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateInstancesInput } = commandModule;
    return CreateInstancesInput;
  }

  protected getPrompt(count: number) {
    return `Generate ${count} additional instances of the specified card definition, populated with sample data.`;
  }

  protected getAttachedFileURLs(input: BaseCommandModule.CreateInstancesInput) {
    let cardModuleURL = ensureExtension(input.codeRef.module, {
      default: '.gts',
    });
    return cardModuleURL ? [cardModuleURL] : [];
  }

  protected async run(
    input: BaseCommandModule.CreateInstancesInput,
  ): Promise<undefined> {
    if (!input.codeRef) {
      throw new Error('Module is required');
    }
    let realm = input.realm || this.realm.defaultWritableRealm?.path;

    await this.aiAssistantPanelService.openPanel();

    let sendMessageCommand = new SendAiAssistantMessageCommand(
      this.commandContext,
    );

    await sendMessageCommand.execute({
      roomId: this.matrixService.currentRoomId,
      prompt: this.getPrompt(input.count || 1),
      attachedCards: input.exampleCard ? [input.exampleCard] : [],
      attachedFileURLs: this.getAttachedFileURLs(input),
      realmUrl: realm,
    });
  }
}
