import { service } from '@ember/service';

import { isCardInstance, realmURL } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../../lib/host-base-command';

import UseAiAssistantCommand from '../ai-assistant';

import SendBotTriggerEventCommand from './send-bot-trigger-event';

import type MatrixService from '../../services/matrix-service';
import type StoreService from '../../services/store';

export default class CreateShowCardRequestCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateShowCardRequestInput
> {
  // TODO: remove this command once the temporary card menu item is removed.
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;

  description = 'Request showing a card via the bot runner.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateShowCardRequestInput } = commandModule;
    return CreateShowCardRequestInput;
  }

  requireInputFields = ['cardId'];

  protected async run(
    input: BaseCommandModule.CreateShowCardRequestInput,
  ): Promise<undefined> {
    await this.matrixService.ready;

    let { cardId, format, roomId } = input;
    let cardTitle: string | undefined;
    let targetRealm: string | undefined;

    if (!roomId) {
      let card = await this.store.get<CardDef>(cardId);
      if (card && isCardInstance(card)) {
        cardTitle = card.cardTitle ?? card.id;
        targetRealm = card[realmURL]?.href;
      }
      let useAiAssistantCommand = new UseAiAssistantCommand(
        this.commandContext,
      );
      let createRoomResult = await useAiAssistantCommand.execute({
        roomId: 'new',
        roomName: `Rename Card: ${cardTitle ?? cardId ?? 'Card'}`,
        openRoom: true,
      });
      roomId = createRoomResult.roomId;
    }

    let submissionBotId = this.matrixService.submissionBotUserId;
    if (!(await this.matrixService.isUserInRoom(roomId, submissionBotId))) {
      await this.matrixService.inviteUserToRoom(roomId, submissionBotId);
    }

    if (!targetRealm) {
      let card = await this.store.get<CardDef>(cardId);
      if (card && isCardInstance(card)) {
        targetRealm = card[realmURL]?.href;
      }
    }

    if (!targetRealm) {
      throw new Error('Realm URL is required to request show card');
    }

    await new SendBotTriggerEventCommand(this.commandContext).execute({
      roomId,
      realm: targetRealm,
      type: 'show-card',
      input: {
        cardId,
        format,
      },
    });
  }
}
