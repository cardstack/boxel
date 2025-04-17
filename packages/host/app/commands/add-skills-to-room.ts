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
        let enabledCards = [...(oldContent.enabledCards || [])];

        const newCards = skillFileDefs
          .map((fileDef) => fileDef.serialize())
          .filter(
            (newCard) =>
              !enabledCards.some(
                (existingCard) => existingCard.sourceUrl === newCard.sourceUrl,
              ),
          );
        const updatedEnabledCards = [...enabledCards, ...newCards];

        let commandDefinitions = [...(oldContent.commandDefinitions || [])];
        const newCommandDefinitions = commandFileDefs
          .map((fileDef) => fileDef.serialize())
          .filter(
            (newCommandDefinition) =>
              !commandDefinitions.some(
                (commandDefinition) =>
                  commandDefinition.sourceUrl ===
                  newCommandDefinition.sourceUrl,
              ),
          );
        const updatedCommandDefinitions = [
          ...commandDefinitions,
          ...newCommandDefinitions,
        ];
        return {
          enabledCards: updatedEnabledCards,
          disabledCards: [...(oldContent.disabledCards || [])],
          commandDefinitions: updatedCommandDefinitions,
        };
      },
    );
  }
}
