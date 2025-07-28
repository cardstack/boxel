import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';
import { DEFAULT_CODING_LLM } from '@cardstack/runtime-common/matrix-constants';

import * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';
import { skillCardURL } from '../lib/utils';

import AddSkillsToRoomCommand from './add-skills-to-room';
import CreateAiAssistantRoomCommand from './create-ai-assistant-room';
import OpenAiAssistantRoomCommand from './open-ai-assistant-room';
import SendAiAssistantMessageCommand from './send-ai-assistant-message';
import SetActiveLLMCommand from './set-active-llm';
import SwitchSubmodeCommand from './switch-submode';

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

  protected async run(
    input: BaseCommandModule.ListingBuildInput,
  ): Promise<undefined> {
    let { realm: realmUrl, listing: listingInput } = input;

    const listing = listingInput as Listing;

    const prompt = `Create gts file for the ${listing.name}. First, create the complete gts file with all the code. After the code is fully generated, then switch to code mode and show preview.`;

    const { roomId } = await new CreateAiAssistantRoomCommand(
      this.commandContext,
    ).execute({
      name: `Build ${listing.name}`,
    });

    const defaultSkills = [
      skillCardURL('boxel-environment'),
      skillCardURL('boxel-development'),
      skillCardURL('source-code-editing'),
    ];

    const loadedSkills = await Promise.all(
      defaultSkills.map(async (skillCardURL) => {
        let maybeCard = await this.store.get<Skill>(skillCardURL);
        return isCardInstance(maybeCard) ? maybeCard : undefined;
      }),
    );
    const skills = loadedSkills.filter(
      (skill) => skill !== undefined,
    ) as Skill[];

    if (roomId) {
      await new SwitchSubmodeCommand(this.commandContext).execute({
        submode: 'code',
        codePath: `${realmUrl}index.json`,
      });

      await new SetActiveLLMCommand(this.commandContext).execute({
        roomId,
        model: DEFAULT_CODING_LLM,
      });

      await new AddSkillsToRoomCommand(this.commandContext).execute({
        roomId,
        skills,
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
