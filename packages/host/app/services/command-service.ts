import Service, { service } from '@ember/service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import { task } from 'ember-concurrency';
import type MatrixService from '@cardstack/host/services/matrix-service';

export default class CommandService extends Service {
  @service declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;

  run = task(async (command: any, roomId: string) => {
    let { payload, eventId } = command;
    try {
      this.matrixService.failedCommandState.delete(eventId);
      if (command.commandType === 'patchCard') {
        await this.operatorModeStateService.patchCard.perform(
          payload.id,
          payload.patch, //extracting patch here
        );
      }
      await this.matrixService.sendReactionEvent(roomId, eventId, 'applied');
    } catch (e) {
      let error =
        typeof e === 'string'
          ? new Error(e)
          : e instanceof Error
          ? e
          : new Error('Patch failed.');
      this.matrixService.failedCommandState.set(eventId, error);
    }
  });
}
