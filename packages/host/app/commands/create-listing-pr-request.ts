import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import UseAiAssistantCommand from './ai-assistant';
import SendBotTriggerEventCommand from './send-bot-trigger-event';

import type MatrixService from '../services/matrix-service';
import type StoreService from '../services/store';
import type { Listing } from '@cardstack/catalog/listing/listing';

export default class CreateListingPRRequestCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateListingPRRequestInput
> {
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;

  description =
    'Request a GitHub PR from a catalog listing and notify the bot runner.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateListingPRRequestInput } = commandModule;
    return CreateListingPRRequestInput;
  }

  requireInputFields = ['realm', 'listingId'];

  protected async run(
    input: BaseCommandModule.CreateListingPRRequestInput,
  ): Promise<undefined> {
    await this.matrixService.ready;

    let { realm, listingId } = input;
    let roomId = input.roomId;
    let listingName: string | undefined;

    if (!roomId) {
      let listing = await this.store.get<Listing>(listingId);
      if (listing && isCardInstance(listing)) {
        listingName = listing.name ?? listing.id;
      }
      let useAiAssistantCommand = new UseAiAssistantCommand(
        this.commandContext,
      );
      let createRoomResult = await useAiAssistantCommand.execute({
        roomId: 'new',
        roomName: `PR: ${listingName ?? listingId ?? 'Listing'}`,
        openRoom: true,
      });
      roomId = createRoomResult.roomId;
    }

    let botRunnerId = this.matrixService.botRunnerUserId;
    if (!(await this.matrixService.isUserInRoom(roomId, botRunnerId))) {
      await this.matrixService.inviteUserToRoom(roomId, botRunnerId);
    }

    await new SendBotTriggerEventCommand(this.commandContext).execute({
      roomId,
      type: 'create-listing-pr',
      input: {
        roomId,
        realm,
        listingId,
      },
    });
  }
}
