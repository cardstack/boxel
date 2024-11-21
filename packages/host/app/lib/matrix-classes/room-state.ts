import { tracked } from '@glimmer/tracking';

import { type IEvent } from 'matrix-js-sdk';

import type { Skill } from '@cardstack/host/components/ai-assistant/skill-menu';

import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';

import type * as MatrixSDK from 'matrix-js-sdk';

export type TempEvent = Partial<IEvent> & {
  status: MatrixSDK.EventStatus | null;
  error?: MatrixSDK.MatrixError;
};

export default class RoomState {
  @tracked private _events: DiscreteMatrixEvent[] = [];
  @tracked skills: Skill[] = [];

  get events() {
    return this._events;
  }

  addEvent(event: TempEvent, oldEventId?: string) {
    let { event_id: eventId, state_key: stateKey } = event;
    eventId = eventId ?? stateKey; // room state may not necessary have an event ID

    // If we are receiving an event which contains
    // a data field, we may need to parse it
    // because matrix doesn't support all json types
    // Corresponding encoding is done in
    // sendEvent in the matrix-service
    if (event.content?.data) {
      if (typeof event.content.data === 'string') {
        event.content.data = JSON.parse(event.content.data);
      }
    }
    eventId = eventId ?? stateKey; // room state may not necessary have an event ID
    if (!eventId) {
      throw new Error(
        `bug: event ID is undefined for event ${JSON.stringify(
          event,
          null,
          2,
        )}`,
      );
    }
    // duplicate events may be emitted from matrix, as well as the resolved room card might already contain this event
    let matchingEvents = this._events.filter(
      (e) => e.event_id === eventId || e.event_id === oldEventId,
    );
    if (matchingEvents.length > 1) {
      throw new Error(
        `bug: ${matchingEvents.length} events with the same event_id(s): ${eventId}, ${oldEventId}, expected a maximum of 1`,
      );
    }
    if (matchingEvents.length === 0) {
      this._events = [
        ...(this._events ?? []),
        event as unknown as DiscreteMatrixEvent,
      ];
      return;
    }
    let eventToReplace = matchingEvents[0];
    let eventIndex = this._events.indexOf(eventToReplace);
    this._events[eventIndex] = event as unknown as DiscreteMatrixEvent;
    this._events = [...this._events];
  }
}
