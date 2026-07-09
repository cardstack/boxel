import { service } from '@ember/service';

import {
  ensureExtension,
  identifyCard,
  moduleFrom,
} from '@cardstack/runtime-common';

import { isBaseInstance, realmURL } from '@cardstack/runtime-common/constants';

import type { CardDef, FieldDef } from 'https://cardstack.com/base/card-api';
import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import SendAiAssistantMessageTool from './send-ai-assistant-message';

import type AiAssistantPanelService from '../services/ai-assistant-panel-service';
import type MatrixService from '../services/matrix-service';
import type StoreService from '../services/store';
import type ToolService from '../services/tool-service';

export default class PopulateWithSampleDataTool extends HostBaseTool<
  typeof BaseToolModule.CardIdCard,
  undefined
> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private toolService: ToolService;
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;

  static actionVerb = 'Populate Sample Data';
  description = 'Fill in the card with sample data';

  async getInputType() {
    let commandModule = await this.loadToolModule();
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

  protected async run(input: BaseToolModule.CardIdCard): Promise<undefined> {
    if (!input.cardId) {
      throw new Error('Card is required');
    }

    await this.aiAssistantPanelService.openPanel();
    let card = await this.store.get<CardDef>(input.cardId);
    if (!isCard(card)) {
      throw new Error(`Could not load card: ${card.message}`);
    }

    let sendMessageCommand = new SendAiAssistantMessageTool(
      this.commandContext,
    );

    await sendMessageCommand.execute({
      roomId: this.matrixService.currentRoomId,
      prompt: this.prompt,
      attachedCards: [card],
      attachedFileIdentifiers: this.getAttachedFileURLs(card),
      realmIdentifier: card[realmURL]?.href,
    });
  }
}

function isCardOrField(card: any): card is CardDef | FieldDef {
  return card && typeof card === 'object' && isBaseInstance in card;
}

function isCard(card: any): card is CardDef {
  return isCardOrField(card) && !('isFieldDef' in card.constructor);
}
