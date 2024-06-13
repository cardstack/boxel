import Service, { service } from '@ember/service';

import { task } from 'ember-concurrency';

import { PatchData } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

export default class CommandService extends Service {
  @service declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;

  run = task(async (command: any, roomId: string) => {
    let { payload, eventId } = command;
    try {
      this.matrixService.failedCommandState.delete(eventId);
      if (command.commandType === 'patchCard') {
        await this.operatorModeStateService.patchCard.perform(
          payload.card_id,
          {
            attributes: payload.attributes,
            relationships: payload.relationships,
          } as PatchData, //extracting patch here
        );
      }
      await this.matrixService.sendReactionEvent(roomId, eventId, 'applied');
    } catch (e) {
      let error =
        typeof e === 'string'
          ? new Error(e)
          : e instanceof Error
          ? e
          : new Error('Command failed.');
      this.matrixService.failedCommandState.set(eventId, error);
    }
  });
}
