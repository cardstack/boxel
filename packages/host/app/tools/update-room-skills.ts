import { service } from '@ember/service';

import {
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  getToolDefinitions,
} from '@cardstack/runtime-common/matrix-constants';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type {
  FileDef,
  SerializedFile,
} from 'https://cardstack.com/base/file-api';

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

export default class UpdateRoomSkillsTool extends HostBaseTool<
  typeof BaseCommandModule.UpdateRoomSkillsInput
> {
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;

  static actionVerb = 'Update';
  description = 'Updates the enabled and disabled skills for a room';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { UpdateRoomSkillsInput } = commandModule;
    return UpdateRoomSkillsInput;
  }

  requireInputFields = ['roomId'];

  protected async run(
    input: BaseCommandModule.UpdateRoomSkillsInput,
  ): Promise<undefined> {
    let {
      roomId,
      skillCardIdsToActivate = [],
      skillCardIdsToDeactivate = [],
    } = input;

    await this.matrixService.updateStateEvent(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      '',
      async (currentSkillsConfig: Record<string, any> = {}) => {
        let enabledSkillCardMap = new Map<string, SerializedFile>();
        let disabledSkillCardMap = new Map<string, SerializedFile>();

        for (let fileDef of currentSkillsConfig.enabledSkillCards ?? []) {
          if (fileDef?.sourceUrl) {
            enabledSkillCardMap.set(fileDef.sourceUrl, fileDef);
          }
        }

        for (let fileDef of currentSkillsConfig.disabledSkillCards ?? []) {
          if (fileDef?.sourceUrl) {
            disabledSkillCardMap.set(fileDef.sourceUrl, fileDef);
          }
        }

        let skillIdsToDeactivate = new Set(skillCardIdsToDeactivate);
        for (let skillId of skillIdsToDeactivate) {
          if (enabledSkillCardMap.has(skillId)) {
            let fileDef = enabledSkillCardMap.get(skillId)!;
            enabledSkillCardMap.delete(skillId);
            disabledSkillCardMap.set(skillId, fileDef);
          }
        }

        let skillSourceCache = new Map<string, SkillSource>();
        // Skill cards re-upload their serialized card content; skill markdown
        // files re-upload their file content. Both produce the FileDef stored
        // in the room's enabled-skills config.
        let skillCardsNeedingUpload: SkillModule.Skill[] = [];
        let markdownSkillsNeedingUpload: FileDef[] = [];
        let skillIdsToActivate = new Set(skillCardIdsToActivate);

        for (let skillId of skillIdsToActivate) {
          if (enabledSkillCardMap.has(skillId)) {
            continue;
          }
          if (disabledSkillCardMap.has(skillId)) {
            let fileDef = disabledSkillCardMap.get(skillId)!;
            disabledSkillCardMap.delete(skillId);
            enabledSkillCardMap.set(skillId, fileDef);
            continue;
          }

          try {
            let source = await loadSkillSource(this.store, skillId);
            if (source) {
              skillSourceCache.set(skillId, source);
              if (isSkillCard in source) {
                skillCardsNeedingUpload.push(source as SkillModule.Skill);
              } else {
                markdownSkillsNeedingUpload.push(source as FileDef);
              }
            } else {
              console.warn(
                `[UpdateRoomSkillsTool] skipping activation of "${skillId}": not a skill card or skill markdown file`,
              );
            }
          } catch (err) {
            console.warn(
              `[UpdateRoomSkillsTool] skipping activation of "${skillId}": store.get threw: ${errorSummary(err)}`,
            );
          }
        }

        let uploadedSkillFileDefs: FileDef[] = [];
        if (skillCardsNeedingUpload.length > 0) {
          uploadedSkillFileDefs = uploadedSkillFileDefs.concat(
            await this.matrixService.uploadCards(
              skillCardsNeedingUpload as CardDef[],
            ),
          );
        }
        if (markdownSkillsNeedingUpload.length > 0) {
          uploadedSkillFileDefs = uploadedSkillFileDefs.concat(
            await this.matrixService.uploadFiles(markdownSkillsNeedingUpload),
          );
        }
        for (let uploaded of uploadedSkillFileDefs) {
          let serialized = uploaded.serialize();
          if (serialized.sourceUrl) {
            enabledSkillCardMap.set(serialized.sourceUrl, serialized);
            disabledSkillCardMap.delete(serialized.sourceUrl);
          }
        }

        // Ensure skills that ended up enabled are not left in the disabled map
        for (let skillId of enabledSkillCardMap.keys()) {
          disabledSkillCardMap.delete(skillId);
        }

        let enabledSkillIds = Array.from(enabledSkillCardMap.keys());
        let loadedEnabledSkills = await Promise.all(
          enabledSkillIds.map(async (skillId) => {
            if (skillSourceCache.has(skillId)) {
              return skillSourceCache.get(skillId)!;
            }
            try {
              let source = await loadSkillSource(this.store, skillId);
              if (source) {
                skillSourceCache.set(skillId, source);
                return source;
              }
              console.warn(
                `[UpdateRoomSkillsTool] cannot rehydrate enabled skill "${skillId}": not a skill card or skill markdown file`,
              );
            } catch (err) {
              console.warn(
                `[UpdateRoomSkillsTool] cannot rehydrate enabled skill "${skillId}": store.get threw: ${errorSummary(err)}`,
              );
            }
            return undefined;
          }),
        );

        let validEnabledSkills = loadedEnabledSkills.filter(
          (skill): skill is SkillSource => Boolean(skill),
        );

        let previousCommandDefinitions = (getToolDefinitions(
          currentSkillsConfig,
        ) ?? []) as SerializedFile[];
        let serializedCommandDefinitions: SerializedFile[] = [
          ...previousCommandDefinitions,
        ];

        if (validEnabledSkills.length > 0) {
          let allCommandDefinitions = validEnabledSkills.flatMap((skill) =>
            getSkillSourceTools(skill),
          );

          if (allCommandDefinitions.length > 0) {
            let uniqueCommandDefinitions =
              this.matrixService.getUniqueToolDefinitions(
                allCommandDefinitions,
              );
            let uploadedCommandDefs =
              await this.matrixService.uploadToolDefinitions(
                uniqueCommandDefinitions,
              );
            serializedCommandDefinitions = uploadedCommandDefs.map((fileDef) =>
              fileDef.serialize(),
            );
          } else {
            serializedCommandDefinitions = [];
          }
        } else if (enabledSkillIds.length === 0) {
          serializedCommandDefinitions = [];
        }

        // Write only the tool-named key; a pre-rename room's state may carry
        // `commandDefinitions`, which must not survive the rewrite or it would
        // shadow nothing but confuse readers of raw state.
        let { commandDefinitions: _legacyDefinitions, ...restOfSkillsConfig } =
          currentSkillsConfig;
        return {
          ...restOfSkillsConfig,
          enabledSkillCards: Array.from(enabledSkillCardMap.values()),
          disabledSkillCards: Array.from(disabledSkillCardMap.values()),
          toolDefinitions: serializedCommandDefinitions,
        };
      },
    );
  }
}

function errorSummary(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  return typeof err === 'string' ? err : `<${typeof err}>`;
}
