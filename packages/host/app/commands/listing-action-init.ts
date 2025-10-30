import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';
import { DEFAULT_REMIX_LLM } from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';
import { skillCardURL } from '../lib/utils';

import AddSkillsToRoomCommand from './add-skills-to-room';
import CreateAiAssistantRoomCommand from './create-ai-assistant-room';
import OpenAiAssistantRoomCommand from './open-ai-assistant-room';
import SendAiAssistantMessageCommand from './send-ai-assistant-message';
import SetActiveLLMCommand from './set-active-llm';

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

  requireInputFields = ['actionType', 'listing'];

  protected async run(
    input: BaseCommandModule.ListingActionInput,
  ): Promise<undefined> {
    let {
      realm: realmUrl,
      actionType,
      listing: listingInput,
      attachedCard,
    } = input;

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
      case 'create':
        roomName = `Create listing`;
        break;
      default:
        throw new Error(`Invalid listing action type: ${actionType}`);
    }

    const { roomId } = await new CreateAiAssistantRoomCommand(
      this.commandContext,
    ).execute({
      name: roomName,
    });

    const listingSkillCardId = skillCardURL('catalog-listing');
    const fetchSkillCard = await this.store.get<Skill>(listingSkillCardId);
    let listingSkillCard = isCardInstance(fetchSkillCard)
      ? fetchSkillCard
      : undefined;

    if (listingSkillCard) {
      await new AddSkillsToRoomCommand(this.commandContext).execute({
        roomId,
        skills: [listingSkillCard],
      });
    }

    let prompt = `I would like to create a new listing`;
    if (actionType !== 'create') {
      prompt = `I would like to ${actionType} this ${listing.name} under the following realm: ${realmUrl}`;
    }

    let openCardIds: string[] = [];
    if (actionType === 'create') {
      openCardIds = [attachedCard.id!];
    } else {
      openCardIds = [listing.id!];
    }

    if (roomId) {
      let setActiveLLMCommand = new SetActiveLLMCommand(this.commandContext);

      await setActiveLLMCommand.execute({
        roomId,
        model: DEFAULT_REMIX_LLM,
      });

      await new SendAiAssistantMessageCommand(this.commandContext).execute({
        roomId,
        prompt,
        openCardIds,
        attachedCards: actionType === 'create' ? [attachedCard] : [listing],
      });

      await new OpenAiAssistantRoomCommand(this.commandContext).execute({
        roomId,
      });
    }
  }
}
