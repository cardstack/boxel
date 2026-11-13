import { service } from '@ember/service';

import {
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  getToolDefinitions,
} from '@cardstack/runtime-common/matrix-constants';

import { isSkillCard } from '../lib/file-def-manager';

import HostBaseTool from '../lib/host-base-tool';
import { getSkillSourceTools, type SkillSource } from '../lib/skill-tools';
import { loadSkillWithLayoutFallback } from '../lib/skills-layout-fallback';

import type MatrixService from '../services/matrix-service';
import type NetworkService from '../services/network';
import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';
import type { FileDef, SerializedFile } from '@cardstack/base/file-api';
import type * as SkillModule from '@cardstack/base/skill';

export default class UpdateRoomSkillsTool extends HostBaseTool<
  typeof BaseToolModule.UpdateRoomSkillsInput
> {
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private store: StoreService;

  static actionVerb = 'Update';
  description = 'Updates the enabled and disabled skills for a room';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { UpdateRoomSkillsInput } = commandModule;
    return UpdateRoomSkillsInput;
  }

  requireInputFields = ['roomId'];

  protected async run(
    input: BaseToolModule.UpdateRoomSkillsInput,
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
        // A skill is matched by the key its id folds to, not by its spelling.
        // A room stores a markdown skill by the URL it is served at, and a
        // caller can name the same skill by its prefix-form id. The keys stay
        // in this function: the room state keeps each skill's stored id.
        let { virtualNetwork } = this.network;
        let keyOf = (id: string) => virtualNetwork.keyForIdentifier(id);
        let enabledSkillCardMap = new Map<string, SerializedFile>();
        let disabledSkillCardMap = new Map<string, SerializedFile>();

        for (let fileDef of currentSkillsConfig.enabledSkillCards ?? []) {
          if (fileDef?.sourceUrl) {
            enabledSkillCardMap.set(keyOf(fileDef.sourceUrl), fileDef);
          }
        }

        for (let fileDef of currentSkillsConfig.disabledSkillCards ?? []) {
          if (fileDef?.sourceUrl) {
            disabledSkillCardMap.set(keyOf(fileDef.sourceUrl), fileDef);
          }
        }

        for (let skillId of new Set(skillCardIdsToDeactivate)) {
          let key = keyOf(skillId);
          let fileDef = enabledSkillCardMap.get(key);
          if (fileDef) {
            enabledSkillCardMap.delete(key);
            disabledSkillCardMap.set(key, fileDef);
          }
        }

        let skillSourceCache = new Map<string, SkillSource>();
        // Skill cards re-upload their serialized card content; skill markdown
        // files re-upload their file content. Both produce the FileDef stored
        // in the room's enabled-skills config.
        let skillCardsNeedingUpload: SkillModule.Skill[] = [];
        let markdownSkillsNeedingUpload: FileDef[] = [];

        for (let skillId of new Set(skillCardIdsToActivate)) {
          let key = keyOf(skillId);
          if (enabledSkillCardMap.has(key)) {
            continue;
          }
          let disabledFileDef = disabledSkillCardMap.get(key);
          if (disabledFileDef) {
            disabledSkillCardMap.delete(key);
            enabledSkillCardMap.set(key, disabledFileDef);
            continue;
          }

          try {
            // TEMPORARY: skills layout fallback, see lib/skills-layout-fallback.ts.
            // The uploaded file keeps the id it loaded from, so the room
            // stores that id.
            let source = (
              await loadSkillWithLayoutFallback(this.store, skillId)
            )?.source;
            if (source) {
              skillSourceCache.set(key, source);
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
            let key = keyOf(serialized.sourceUrl);
            enabledSkillCardMap.set(key, serialized);
            disabledSkillCardMap.delete(key);
          }
        }

        // Ensure skills that ended up enabled are not left in the disabled map
        for (let key of enabledSkillCardMap.keys()) {
          disabledSkillCardMap.delete(key);
        }

        let enabledSkills = Array.from(enabledSkillCardMap.entries());
        let loadedEnabledSkills = await Promise.all(
          enabledSkills.map(async ([key, { sourceUrl: skillId }]) => {
            let cached = skillSourceCache.get(key);
            if (cached) {
              return cached;
            }
            try {
              // TEMPORARY: skills layout fallback, see lib/skills-layout-fallback.ts.
              let source = (
                await loadSkillWithLayoutFallback(this.store, skillId)
              )?.source;
              if (source) {
                skillSourceCache.set(key, source);
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
        } else if (enabledSkills.length === 0) {
          serializedCommandDefinitions = [];
        }

        // Write only the tool-named key; a pre-rename room's state may carry
        // `toolDefinitionFileDefs`, which must not survive the rewrite or it would
        // shadow nothing but confuse readers of raw state.
        let {
          toolDefinitionFileDefs: _legacyDefinitions,
          ...restOfSkillsConfig
        } = currentSkillsConfig;
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

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { UpdateRoomSkillsTool as UpdateRoomSkillsCommand };
