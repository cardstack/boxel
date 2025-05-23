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

export default class ListingInitCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInput
> {
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;

  description = 'Catalog listing use command';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingInput } = commandModule;
    return ListingInput;
  }

  protected async run(
    input: BaseCommandModule.ListingInput,
  ): Promise<undefined> {
    let { realm: realmUrl, listing: listingInput } = input;

    const listing = listingInput as Listing;

    const { roomId } = await new CreateAiAssistantRoomCommand(
      this.commandContext,
    ).execute({
      name: listing.name ? `Remix of ${listing.name}` : 'Remix',
    });

    const remixSkillCardId = `${baseRealm.url}Skill/remix`;
    const remixSkillCard = (await this.store.peek(remixSkillCardId)) as Skill;

    if (remixSkillCard) {
      await new AddSkillsToRoomCommand(this.commandContext).execute({
        roomId,
        skills: [remixSkillCard],
      });
    }

    if (roomId) {
      await new SendAiAssistantMessageCommand(this.commandContext).execute({
        roomId,
        prompt: `I would like to remix this ${listing.name} under the following realm: ${realmUrl}`,
        openCardIds: [listing.id!],
        attachedCards: [listing],
      });

      await new OpenAiAssistantRoomCommand(this.commandContext).execute({
        roomId,
      });
    }
  }
}
