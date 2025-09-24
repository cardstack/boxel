import { service } from '@ember/service';

import {
  ensureExtension,
  identifyCard,
  moduleFrom,
} from '@cardstack/runtime-common';

import { isBaseInstance, realmURL } from '@cardstack/runtime-common/constants';

import type { CardDef, FieldDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import SendAiAssistantMessageCommand from './send-ai-assistant-message';

import type AiAssistantPanelService from '../services/ai-assistant-panel-service';
import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';
import type StoreService from '../services/store';

export default class PopulateWithSampleDataCommand extends HostBaseCommand<
  typeof BaseCommandModule.CardIdCard,
  undefined
> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private commandService: CommandService;
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;

  static actionVerb = 'Populate Sample Data';
  description = 'Fill in the card with sample data';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  protected get prompt() {
    return `Fill in sample data for the attached card instance.`;
  }

  protected getAttachedFileURLs(card: CardDef) {
    const codeRef = identifyCard(card.constructor);
    let cardModuleURL = codeRef
      ? ensureExtension(moduleFrom(codeRef), { default: '.gts' })
      : undefined;
    return cardModuleURL ? [cardModuleURL] : [];
  }

  protected async run(input: BaseCommandModule.CardIdCard): Promise<undefined> {
    if (!input.cardId) {
      throw new Error('Card is required');
    }

    await this.aiAssistantPanelService.openPanel();
    let card = await this.store.get<CardDef>(input.cardId);
    if (!isCard(card)) {
      throw new Error(`Could not load card: ${card.message}`);
    }

    let sendMessageCommand = new SendAiAssistantMessageCommand(
      this.commandContext,
    );

    await sendMessageCommand.execute({
      roomId: this.matrixService.currentRoomId,
      prompt: this.prompt,
      attachedCards: [card],
      attachedFileURLs: this.getAttachedFileURLs(card),
      realmUrl: card[realmURL]?.href,
    });
  }
}

function isCardOrField(card: any): card is CardDef | FieldDef {
  return card && typeof card === 'object' && isBaseInstance in card;
}

function isCard(card: any): card is CardDef {
  return isCardOrField(card) && !('isFieldDef' in card.constructor);
}
