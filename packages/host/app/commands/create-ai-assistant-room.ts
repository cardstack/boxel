import { service } from '@ember/service';

import format from 'date-fns/format';

import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_LLM_MODE,
  APP_BOXEL_INITIAL_PROMPT_EVENT_TYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  DEFAULT_LLM,
} from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type {
  FileDef,
  SerializedFileDef,
} from 'https://cardstack.com/base/file-api';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

type InitialStateEvent =
  | {
      type: typeof APP_BOXEL_ACTIVE_LLM;
      content: {
        model: string;
        toolsSupported?: boolean;
        reasoningEffort?: string;
      };
    }
  | {
      type: typeof APP_BOXEL_LLM_MODE;
      content: {
        mode: string;
      };
    }
  | {
      type: typeof APP_BOXEL_ROOM_SKILLS_EVENT_TYPE;
      content: {
        enabledSkillCards: SerializedFileDef[];
        disabledSkillCards: SerializedFileDef[];
        commandDefinitions: SerializedFileDef[];
      };
    }
  | {
      type: typeof APP_BOXEL_INITIAL_PROMPT_EVENT_TYPE;
      content: {
        prompt: string;
      };
    };

export default class CreateAiAssistantRoomCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateAIAssistantRoomInput,
  typeof BaseCommandModule.CreateAIAssistantRoomResult
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Create';

  private getDefaultModelConfiguration() {
    let systemCard = this.matrixService.systemCard;
    return (
      systemCard?.defaultModelConfiguration ??
      systemCard?.modelConfigurations?.[0]
    );
  }

  private getDefaultLLMDetails() {
    let configuration = this.getDefaultModelConfiguration();
    return {
      model: configuration?.modelId ?? DEFAULT_LLM,
      toolsSupported: Boolean(configuration?.toolsSupported),
      reasoningEffort: configuration?.reasoningEffort ?? undefined,
    };
  }

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateAIAssistantRoomInput } = commandModule;
    return CreateAIAssistantRoomInput;
  }

  protected async run(
    input: BaseCommandModule.CreateAIAssistantRoomInput,
  ): Promise<BaseCommandModule.CreateAIAssistantRoomResult> {
    let { matrixService } = this;
    let userId = matrixService.userId;
    let aiBotFullId = matrixService.aiBotUserId;

    if (!userId) {
      throw new Error(
        'Requires userId to execute CreateAiAssistantRoomCommand',
      );
    }
    let { enabledSkills, disabledSkills } = input;
    let enabledSkillFileDefs: FileDef[] | undefined;
    let commandFileDefs: FileDef[] | undefined;
    let disabledSkillFileDefs: FileDef[] | undefined;

    if (enabledSkills?.length) {
      enabledSkillFileDefs = await matrixService.uploadCards(enabledSkills);
    }
    if (disabledSkills?.length) {
      disabledSkillFileDefs = await matrixService.uploadCards(disabledSkills);
    } else {
      disabledSkillFileDefs = [];
    }

    const uniqueCommandDefinitions = matrixService.getUniqueCommandDefinitions([
      ...(enabledSkills?.flatMap((skill) => skill.commands) || []),
      ...(disabledSkills?.flatMap((skill) => skill.commands) || []),
    ]);

    if (uniqueCommandDefinitions.length) {
      commandFileDefs = await matrixService.uploadCommandDefinitions(
        uniqueCommandDefinitions,
      );
    }

    // Run room creation and module loading in parallel
    let initialState: InitialStateEvent[] = [
      {
        type: APP_BOXEL_ACTIVE_LLM,
        content: {
          ...this.getDefaultLLMDetails(),
        },
      },
      {
        type: APP_BOXEL_LLM_MODE,
        content: {
          mode: input.llmMode || 'ask',
        },
      },
      {
        type: APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
        content: {
          enabledSkillCards:
            enabledSkillFileDefs?.map((skillFileDef) =>
              skillFileDef.serialize(),
            ) ?? [],
          disabledSkillCards:
            disabledSkillFileDefs?.map((skillFileDef) =>
              skillFileDef.serialize(),
            ) ?? [],
          commandDefinitions:
            commandFileDefs?.map((commandFileDef) =>
              commandFileDef.serialize(),
            ) ?? [],
        },
      },
    ];

    if (input.initialPrompt?.trim()) {
      initialState.push({
        type: APP_BOXEL_INITIAL_PROMPT_EVENT_TYPE,
        content: {
          prompt: input.initialPrompt.trim(),
        },
      });
    }

    const [roomResult, commandModule] = await Promise.all([
      await matrixService.createRoom({
        preset: matrixService.privateChatPreset,
        invite: [aiBotFullId],
        name: input.name,
        room_alias_name: encodeURIComponent(
          `${input.name} - ${format(
            new Date(),
            "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
          )} - ${userId}`,
        ),
        power_level_content_override: {
          users: {
            [userId]: 100,
            [aiBotFullId]: matrixService.aiBotPowerLevel,
          },
        },
        initial_state: initialState,
      }),
      await this.loadCommandModule(),
    ]);

    const { room_id: roomId } = roomResult;
    const { CreateAIAssistantRoomResult } = commandModule;
    return new CreateAIAssistantRoomResult({ roomId });
  }
}
