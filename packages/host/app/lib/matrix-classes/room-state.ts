import { tracked } from '@glimmer/tracking';

import type { Skill } from '@cardstack/host/components/ai-assistant/skill-menu';

import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';

export default class RoomState {
  @tracked private _events: DiscreteMatrixEvent[] = [];
  @tracked skills: Skill[] = [];

  get events() {
    return this._events;
  }

  addEvent(event: DiscreteMatrixEvent, oldEventId?: string) {
    let eventId = event.event_id;

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
      this._events = [...this._events, event];
      return;
    }
    let eventToReplace = matchingEvents[0];
    let eventIndex = this._events.indexOf(eventToReplace);
    this._events[eventIndex] = event;
    this._events = [...this._events];
  }
}
