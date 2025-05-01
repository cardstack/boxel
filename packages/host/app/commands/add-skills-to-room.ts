import { service } from '@ember/service';

import { APP_BOXEL_ROOM_SKILLS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class AddSkillsToRoomCommand extends HostBaseCommand<
  typeof BaseCommandModule.AddSkillsToRoomInput
> {
  @service declare private matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { AddSkillsToRoomInput } = commandModule;
    return AddSkillsToRoomInput;
  }

  protected async run(
    input: BaseCommandModule.AddSkillsToRoomInput,
  ): Promise<undefined> {
    let { matrixService } = this;
    let { roomId, skills } = input;
    let skillFileDefs = await matrixService.uploadCards(skills);
    const commandDefinitions = skills.flatMap((skill) => skill.commands);
    let commandFileDefs =
      await matrixService.uploadCommandDefinitions(commandDefinitions);

    await matrixService.updateStateEvent(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      '',
      async (oldContent: Record<string, any>) => {
        let enabledSkillCards = [...(oldContent.enabledSkillCards || [])];

        const newCards = skillFileDefs
          .map((fileDef) => fileDef.serialize())
          .filter(
            (newCard) =>
              !enabledSkillCards.some(
                (existingCard) => existingCard.sourceUrl === newCard.sourceUrl,
              ),
          );
        const updatedEnabledCards = [...enabledSkillCards, ...newCards];

        let commandDefinitions = [...(oldContent.commandDefinitions || [])];
        const newCommandDefinitions = commandFileDefs
          .map((fileDef) => fileDef.serialize())
          .filter(
            (newCommandDefinition) =>
              !commandDefinitions.some(
                (commandDefinition) =>
                  commandDefinition.name === newCommandDefinition.name,
              ),
          );
        const updatedCommandDefinitions = [
          ...commandDefinitions,
          ...newCommandDefinitions,
        ];
        return {
          enabledSkillCards: updatedEnabledCards,
          disabledSkillCards: [...(oldContent.disabledSkillCards || [])],
          commandDefinitions: updatedCommandDefinitions,
        };
      },
    );
  }
}
