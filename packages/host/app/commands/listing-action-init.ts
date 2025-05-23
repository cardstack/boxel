import { service } from '@ember/service';

import { baseRealm } from '@cardstack/runtime-common';

import * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';

import AddSkillsToRoomCommand from './add-skills-to-room';
import CreateAiAssistantRoomCommand from './create-ai-assistant-room';
import OpenAiAssistantRoomCommand from './open-ai-assistant-room';
import SendAiAssistantMessageCommand from './send-ai-assistant-message';

import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

import type { Listing } from '@cardstack/catalog/listing/listing';

export default class ListingActionInitCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingActionInput
> {
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;

  description = 'Catalog listing use command';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingActionInput } = commandModule;
    return ListingActionInput;
  }

  protected async run(
    input: BaseCommandModule.ListingActionInput,
  ): Promise<undefined> {
    let { realm: realmUrl, actionType, listing: listingInput } = input;

    const listing = listingInput as Listing;

    let roomName = '';
    switch (actionType) {
      case 'remix':
        roomName = `Remix of ${listing.name}`;
        break;
      case 'use':
        roomName = `Use of ${listing.name}`;
        break;
      case 'install':
        roomName = `Install of ${listing.name}`;
        break;
      default:
        throw new Error(`Invalid listing action type: ${actionType}`);
    }

    const { roomId } = await new CreateAiAssistantRoomCommand(
      this.commandContext,
    ).execute({
      name: roomName,
    });

    const listingSkillCardId = `${baseRealm.url}Skill/listing`;
    const listingSkillCard = (await this.store.peek(
      listingSkillCardId,
    )) as Skill;

    if (listingSkillCard) {
      await new AddSkillsToRoomCommand(this.commandContext).execute({
        roomId,
        skills: [listingSkillCard],
      });
    }

    if (roomId) {
      await new SendAiAssistantMessageCommand(this.commandContext).execute({
        roomId,
        prompt: `I would like to ${actionType} this ${listing.name} under the following realm: ${realmUrl}`,
        openCardIds: [listing.id!],
        attachedCards: [listing],
      });

      await new OpenAiAssistantRoomCommand(this.commandContext).execute({
        roomId,
      });
    }
  }
}
