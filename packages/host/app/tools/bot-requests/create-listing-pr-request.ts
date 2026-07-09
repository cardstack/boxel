import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type { Listing } from '@cardstack/runtime-common';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../../lib/host-base-tool';

import UseAiAssistantTool from '../ai-assistant';

import SendBotTriggerEventTool from './send-bot-trigger-event';

import type MatrixService from '../../services/matrix-service';
import type StoreService from '../../services/store';

export default class CreateListingPRRequestTool extends HostBaseTool<
  typeof BaseToolModule.CreateListingPRRequestInput
> {
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;

  description =
    'Request a GitHub PR from a catalog listing and notify the bot runner.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CreateListingPRRequestInput } = commandModule;
    return CreateListingPRRequestInput;
  }

  requireInputFields = ['realm', 'listingId'];

  protected async run(
    input: BaseToolModule.CreateListingPRRequestInput,
  ): Promise<undefined> {
    await this.matrixService.ready;

    let { realm, listingId } = input;
    let listingName: string | undefined;
    let listingSummary: string | undefined;
    let listing = await this.store.get<Listing>(listingId);
    if (listing && isCardInstance(listing)) {
      listingName = listing.name ?? listing.id;
      listingSummary = listing.summary ?? undefined;
    }

    let useAiAssistantCommand = new UseAiAssistantTool(this.commandContext);
    let createRoomResult = await useAiAssistantCommand.execute({
      roomId: 'new',
      roomName: `PR: ${listingName ?? listingId ?? 'Listing'}`,
      openRoom: false,
    });
    let roomId = createRoomResult.roomId;

    let submissionBotId = this.matrixService.submissionBotUserId;
    if (!(await this.matrixService.isUserInRoom(roomId, submissionBotId))) {
      await this.matrixService.inviteUserToRoom(roomId, submissionBotId);
    }

    let submittedBy = this.matrixService.userId ?? undefined;

    await new SendBotTriggerEventTool(this.commandContext).execute({
      roomId,
      realm,
      type: 'pr-listing-create',
      input: {
        roomId,
        realm,
        listingId,
        ...(listingName ? { listingName } : {}),
        ...(listingSummary ? { listingSummary } : {}),
        ...(submittedBy ? { submittedBy } : {}),
      },
    });
  }
}
