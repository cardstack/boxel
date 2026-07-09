import type { Listing } from '@cardstack/runtime-common';
import { DEFAULT_CODING_LLM } from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';
import { devSkillId, skillCardURL } from '../lib/utils';

import CreateAiAssistantRoomTool from './create-ai-assistant-room';
import OpenAiAssistantRoomTool from './open-ai-assistant-room';
import SendAiAssistantMessageTool from './send-ai-assistant-message';
import SetActiveLLMTool from './set-active-llm';
import SwitchSubmodeTool from './switch-submode';
import UpdateRoomSkillsTool from './update-room-skills';

export default class ListingActionBuildTool extends HostBaseTool<
  typeof BaseCommandModule.ListingBuildInput
> {
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

    const { roomId } = await new CreateAiAssistantRoomTool(
      this.commandContext,
    ).execute({
      name: `Build ${listing.name}`,
    });

    const defaultSkills = [
      devSkillId,
      skillCardURL('catalog-listing'),
      skillCardURL('source-code-editing'),
    ];

    if (roomId) {
      await new SetActiveLLMTool(this.commandContext).execute({
        roomId,
        model: DEFAULT_CODING_LLM,
        mode: 'act',
      });

      await new UpdateRoomSkillsTool(this.commandContext).execute({
        roomId,
        skillCardIdsToActivate: defaultSkills,
      });

      await new SwitchSubmodeTool(this.commandContext).execute({
        submode: 'code',
        codePath: `${realmUrl}index.json`,
      });

      await new SendAiAssistantMessageTool(this.commandContext).execute({
        roomId,
        prompt,
        attachedCards: [listing],
      });

      await new OpenAiAssistantRoomTool(this.commandContext).execute({
        roomId,
      });
    }
  }
}
