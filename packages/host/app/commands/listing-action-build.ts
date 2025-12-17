import { service } from '@ember/service';

import { DEFAULT_CODING_LLM } from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';
import { devSkillId, envSkillId } from '../lib/utils';

import CreateAiAssistantRoomCommand from './create-ai-assistant-room';
import OpenAiAssistantRoomCommand from './open-ai-assistant-room';
import SendAiAssistantMessageCommand from './send-ai-assistant-message';
import SetActiveLLMCommand from './set-active-llm';
import SwitchSubmodeCommand from './switch-submode';
import UpdateRoomSkillsCommand from './update-room-skills';

import type StoreService from '../services/store';

import type { Listing } from '@cardstack/catalog/listing/listing';

export default class ListingActionBuildCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingBuildInput
> {
  @service declare private store: StoreService;

  description = 'Catalog listing build command';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingBuildInput } = commandModule;
    return ListingBuildInput;
  }

  requireInputFields = ['realm', 'listing'];

  protected async run(
    input: BaseCommandModule.ListingBuildInput,
  ): Promise<undefined> {
    let { realm: realmUrl, listing: listingInput } = input;

    const listing = listingInput as Listing;

    const prompt = `Generate .gts card definition for "${listing.name}" implementing all requirements from the attached listing specification. Then preview the final code in playground panel.`;

    const { roomId } = await new CreateAiAssistantRoomCommand(
      this.commandContext,
    ).execute({
      name: `Build ${listing.name}`,
    });

    const defaultSkills = [devSkillId, envSkillId];

    if (roomId) {
      await new SetActiveLLMCommand(this.commandContext).execute({
        roomId,
        model: DEFAULT_CODING_LLM,
        mode: 'act',
      });

      await new UpdateRoomSkillsCommand(this.commandContext).execute({
        roomId,
        skillCardIdsToActivate: defaultSkills,
      });

      await new SwitchSubmodeCommand(this.commandContext).execute({
        submode: 'code',
        codePath: `${realmUrl}index.json`,
      });

      await new SendAiAssistantMessageCommand(this.commandContext).execute({
        roomId,
        prompt,
        attachedCards: [listing],
      });

      await new OpenAiAssistantRoomCommand(this.commandContext).execute({
        roomId,
      });
    }
  }
}
