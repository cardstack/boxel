import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';
import { DEFAULT_CODING_LLM } from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
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

    const defaultSkills = [
      skillCardURL('boxel-development'),
      skillCardURL('catalog-listing'),
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
      await new SetActiveLLMCommand(this.commandContext).execute({
        roomId,
        model: DEFAULT_CODING_LLM,
        mode: 'act',
      });

      await new AddSkillsToRoomCommand(this.commandContext).execute({
        roomId,
        skills,
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
