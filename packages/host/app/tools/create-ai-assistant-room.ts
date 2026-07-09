import { service } from '@ember/service';

import format from 'date-fns/format';

import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_LLM_MODE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  DEFAULT_FALLBACK_MODEL_ID,
} from '@cardstack/runtime-common/matrix-constants';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseToolModule from 'https://cardstack.com/base/command';

import type { FileDef } from 'https://cardstack.com/base/file-api';
import type * as SkillModule from 'https://cardstack.com/base/skill';

import { isSkillCard } from '../lib/file-def-manager';

import HostBaseTool from '../lib/host-base-tool';
import {
  getSkillSourceTools,
  loadSkillSource,
  type SkillSource,
} from '../lib/skill-tools';

import type MatrixService from '../services/matrix-service';
import type StoreService from '../services/store';

export default class CreateAiAssistantRoomTool extends HostBaseTool<
  typeof BaseToolModule.CreateAIAssistantRoomInput,
  typeof BaseToolModule.CreateAIAssistantRoomResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;

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
      model: configuration?.modelId ?? DEFAULT_FALLBACK_MODEL_ID,
      toolsSupported: Boolean(configuration?.toolsSupported),
      reasoningEffort: configuration?.reasoningEffort ?? undefined,
    };
  }

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CreateAIAssistantRoomInput } = commandModule;
    return CreateAIAssistantRoomInput;
  }

  // Collect skill ids from both the id fields (preferred, kind-agnostic) and
  // the legacy loaded-`Skill`-card fields, de-duped. A skill listed as both
  // enabled and disabled is treated as enabled.
  private collectSkillIds(input: BaseToolModule.CreateAIAssistantRoomInput): {
    enabledIds: string[];
    disabledIds: string[];
  } {
    let idsOf = (
      ids: string[] | undefined,
      cards: SkillModule.Skill[] | undefined,
    ): string[] => [
      ...(ids ?? []),
      ...(cards ?? [])
        .map((c) => c.id)
        .filter((id): id is NonNullable<typeof id> => Boolean(id)),
    ];

    let enabledIds = Array.from(
      new Set(idsOf(input.enabledSkillIds, input.enabledSkills)),
    );
    let enabledSet = new Set(enabledIds);
    let disabledIds = Array.from(
      new Set(idsOf(input.disabledSkillIds, input.disabledSkills)),
    ).filter((id) => !enabledSet.has(id));

    return { enabledIds, disabledIds };
  }

  // Resolve skill ids to their room-skills-config file defs, uploading skill
  // cards and `.md` skill files by their respective paths (mirrors the split in
  // `UpdateRoomSkillsTool`). Returns the uploaded FileDefs plus the resolved
  // skill sources so the caller can gather commands.
  private async resolveSkills(ids: string[]): Promise<{
    fileDefs: FileDef[];
    sources: SkillSource[];
  }> {
    let skillCardsToUpload: SkillModule.Skill[] = [];
    let markdownSkillsToUpload: FileDef[] = [];
    let sources: SkillSource[] = [];

    await Promise.all(
      ids.map(async (id) => {
        try {
          let source = await loadSkillSource(this.store, id);
          if (!source) {
            console.warn(
              `[CreateAiAssistantRoomTool] skipping skill "${id}": not a skill card or skill markdown file`,
            );
            return;
          }
          sources.push(source);
          if (isSkillCard in source) {
            skillCardsToUpload.push(source as SkillModule.Skill);
          } else {
            markdownSkillsToUpload.push(source as FileDef);
          }
        } catch (e) {
          console.warn(
            `[CreateAiAssistantRoomTool] skipping skill "${id}": ${e}`,
          );
        }
      }),
    );

    let fileDefs: FileDef[] = [];
    if (skillCardsToUpload.length) {
      fileDefs = fileDefs.concat(
        await this.matrixService.uploadCards(skillCardsToUpload as CardDef[]),
      );
    }
    if (markdownSkillsToUpload.length) {
      fileDefs = fileDefs.concat(
        await this.matrixService.uploadFiles(markdownSkillsToUpload),
      );
    }
    return { fileDefs, sources };
  }

  protected async run(
    input: BaseToolModule.CreateAIAssistantRoomInput,
  ): Promise<BaseToolModule.CreateAIAssistantRoomResult> {
    let { matrixService } = this;
    let userId = matrixService.userId;
    let aiBotFullId = matrixService.aiBotUserId;

    if (!userId) {
      throw new Error('Requires userId to execute CreateAiAssistantRoomTool');
    }

    let { enabledIds, disabledIds } = this.collectSkillIds(input);
    let [enabled, disabled] = await Promise.all([
      this.resolveSkills(enabledIds),
      this.resolveSkills(disabledIds),
    ]);

    let toolDefinitionFileDefs = [
      ...enabled.sources,
      ...disabled.sources,
    ].flatMap((source) => getSkillSourceTools(source));
    let commandFileDefs: FileDef[] = [];
    if (toolDefinitionFileDefs.length) {
      commandFileDefs = await matrixService.uploadToolDefinitions(
        matrixService.getUniqueToolDefinitions(toolDefinitionFileDefs),
      );
    }

    // Run room creation and module loading in parallel
    const [roomResult, commandModule] = await Promise.all([
      matrixService.createRoom({
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
        initial_state: [
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
              enabledSkillCards: enabled.fileDefs.map((fileDef) =>
                fileDef.serialize(),
              ),
              disabledSkillCards: disabled.fileDefs.map((fileDef) =>
                fileDef.serialize(),
              ),
              toolDefinitions: commandFileDefs.map((commandFileDef) =>
                commandFileDef.serialize(),
              ),
            },
          },
        ],
      }),
      this.loadToolModule(),
    ]);

    const { room_id: roomId } = roomResult;
    const { CreateAIAssistantRoomResult } = commandModule;
    return new CreateAIAssistantRoomResult({ roomId });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CreateAiAssistantRoomTool as CreateAiAssistantRoomCommand };
