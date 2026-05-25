import { service } from '@ember/service';

import { isCardErrorJSONAPI, isCardInstance } from '@cardstack/runtime-common';
import { APP_BOXEL_ROOM_SKILLS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { SerializedFile } from 'https://cardstack.com/base/file-api';

import type * as SkillModule from 'https://cardstack.com/base/skill';

import { isSkillCard } from '../lib/file-def-manager';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';
import type StoreService from '../services/store';

export default class UpdateRoomSkillsCommand extends HostBaseCommand<
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

        let skillCardCache = new Map<string, SkillModule.Skill>();
        let skillsNeedingUpload: SkillModule.Skill[] = [];
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
            let maybeSkillCard =
              await this.store.get<SkillModule.Skill>(skillId);
            if (
              isCardInstance(maybeSkillCard) &&
              Object.prototype.hasOwnProperty.call(maybeSkillCard, isSkillCard)
            ) {
              let skillCard = maybeSkillCard as SkillModule.Skill;
              skillCardCache.set(skillId, skillCard);
              skillsNeedingUpload.push(skillCard);
            } else {
              console.warn(
                `[UpdateRoomSkillsCommand] skipping activation of "${skillId}": ${describeStoreResult(maybeSkillCard)}`,
              );
            }
          } catch (err) {
            console.warn(
              `[UpdateRoomSkillsCommand] skipping activation of "${skillId}": store.get threw: ${errorSummary(err)}`,
            );
          }
        }

        if (skillsNeedingUpload.length > 0) {
          let uploadedSkillFileDefs = await this.matrixService.uploadCards(
            skillsNeedingUpload as CardDef[],
          );
          for (let uploaded of uploadedSkillFileDefs) {
            let serialized = uploaded.serialize();
            if (serialized.sourceUrl) {
              enabledSkillCardMap.set(serialized.sourceUrl, serialized);
              disabledSkillCardMap.delete(serialized.sourceUrl);
            }
          }
        }

        // Ensure skills that ended up enabled are not left in the disabled map
        for (let skillId of enabledSkillCardMap.keys()) {
          disabledSkillCardMap.delete(skillId);
        }

        let enabledSkillIds = Array.from(enabledSkillCardMap.keys());
        let loadedEnabledSkills = await Promise.all(
          enabledSkillIds.map(async (skillId) => {
            if (skillCardCache.has(skillId)) {
              return skillCardCache.get(skillId)!;
            }
            try {
              let maybeSkillCard =
                await this.store.get<SkillModule.Skill>(skillId);
              if (
                isCardInstance(maybeSkillCard) &&
                Object.prototype.hasOwnProperty.call(
                  maybeSkillCard,
                  isSkillCard,
                )
              ) {
                let skillCard = maybeSkillCard as SkillModule.Skill;
                skillCardCache.set(skillId, skillCard);
                return skillCard;
              }
              console.warn(
                `[UpdateRoomSkillsCommand] cannot rehydrate enabled skill "${skillId}": ${describeStoreResult(maybeSkillCard)}`,
              );
            } catch (err) {
              console.warn(
                `[UpdateRoomSkillsCommand] cannot rehydrate enabled skill "${skillId}": store.get threw: ${errorSummary(err)}`,
              );
            }
            return undefined;
          }),
        );

        let validEnabledSkills = loadedEnabledSkills.filter(
          (skill): skill is SkillModule.Skill => Boolean(skill),
        );

        let previousCommandDefinitions =
          (currentSkillsConfig.commandDefinitions ?? []) as SerializedFile[];
        let serializedCommandDefinitions: SerializedFile[] = [
          ...previousCommandDefinitions,
        ];

        if (validEnabledSkills.length > 0) {
          let allCommandDefinitions = validEnabledSkills.flatMap(
            (skill) => skill.commands ?? [],
          );

          if (allCommandDefinitions.length > 0) {
            let uniqueCommandDefinitions =
              this.matrixService.getUniqueCommandDefinitions(
                allCommandDefinitions,
              );
            let uploadedCommandDefs =
              await this.matrixService.uploadCommandDefinitions(
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

        return {
          ...currentSkillsConfig,
          enabledSkillCards: Array.from(enabledSkillCardMap.values()),
          disabledSkillCards: Array.from(disabledSkillCardMap.values()),
          commandDefinitions: serializedCommandDefinitions,
        };
      },
    );
  }
}

// Stable, redaction-safe one-line summary of whatever `store.get` produced for
// a skill. Avoids dumping the full instance / error payload (which can be
// large and may carry user content) while still naming the failure mode.
function describeStoreResult(result: unknown): string {
  if (result == null) {
    return `store.get returned ${result === null ? 'null' : 'undefined'}`;
  }
  if (isCardErrorJSONAPI(result)) {
    let status = (result as { status?: number }).status;
    let title = (result as { title?: string }).title;
    return `store.get returned a CardErrorJSONAPI (status=${status ?? 'n/a'}, title=${JSON.stringify(title ?? '')})`;
  }
  if (isCardInstance(result)) {
    return `store.get returned a card instance that is not a Skill (id=${
      (result as { id?: string }).id ?? '<no id>'
    })`;
  }
  return `store.get returned an unrecognized value of type ${typeof result}`;
}

function errorSummary(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  return typeof err === 'string' ? err : `<${typeof err}>`;
}
