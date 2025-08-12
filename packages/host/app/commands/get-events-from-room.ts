import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { MatrixEvent } from 'https://cardstack.com/base/matrix-event';

import HostBaseCommand from '../lib/host-base-command';

import type { RoomResource } from '../resources/room';
import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class GetEventsFromRoomCommand extends HostBaseCommand<
  typeof BaseCommandModule.GetEventsFromRoomInput,
  typeof BaseCommandModule.GetEventsFromRoomResult
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Listen';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { GetEventsFromRoomInput } = commandModule;
    return GetEventsFromRoomInput;
  }

  requireInputFields = ['roomId'];

  protected async run(
    input: BaseCommandModule.GetEventsFromRoomInput,
  ): Promise<BaseCommandModule.GetEventsFromRoomResult> {
    let { matrixService } = this;
    let roomId = input.roomId;
    let sinceEventId = input.sinceEventId;

    let commandModule = await this.loadCommandModule();
    const { GetEventsFromRoomResult } = commandModule;

    let roomResource = matrixService.roomResources.get(roomId);
    if (!roomResource) {
      return new GetEventsFromRoomResult({ matrixEvents: [] });
    }
    let matrixEvents = getEventsSince(roomResource, sinceEventId);
    if (matrixEvents.length === 0) {
      await roomResource.waitForNextEvent();
      matrixEvents = getEventsSince(roomResource, sinceEventId);
    }
    return new GetEventsFromRoomResult({ matrixEvents });
  }
}

function getEventsSince(
  roomResource: RoomResource,
  sinceEventId?: string,
): MatrixEvent[] {
  let matrixEvents: MatrixEvent[] = roomResource.events;
  if (sinceEventId) {
    let sinceIndex = matrixEvents.findIndex(
      (event) => event.event_id === sinceEventId,
    );
    if (sinceIndex === -1) {
      throw new Error(
        `Event with ID ${sinceEventId} not found in room ${roomResource.roomId}`,
      );
    }
    matrixEvents = matrixEvents.slice(sinceIndex + 1);
  }
  return matrixEvents;
}
