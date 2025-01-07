import { tracked } from '@glimmer/tracking';

import { type IEvent } from 'matrix-js-sdk';

import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_SUPPORTED_LLM_LIST,
  DEFAULT_LLM,
} from '@cardstack/runtime-common/matrix-constants';

import type {
  ActiveLLMEvent,
  MatrixEvent as DiscreteMatrixEvent,
  SupportedLLMListEvent,
} from 'https://cardstack.com/base/matrix-event';

import Mutex from '../mutex';

import type * as MatrixSDK from 'matrix-js-sdk';

export type TempEvent = Partial<IEvent> & {
  status: MatrixSDK.EventStatus | null;
  error?: MatrixSDK.MatrixError;
};

export type SkillsConfig = {
  enabledEventIds: string[];
  disabledEventIds: string[];
};

export default class Room {
  @tracked private _events: DiscreteMatrixEvent[] = [];
  @tracked private _roomState: MatrixSDK.RoomState | undefined;

  readonly mutex = new Mutex();

  get events() {
    return this._events;
  }

  get name() {
    return this._roomState?.events.get('m.room.name')?.get('')?.event.content
      ?.name;
  }

  notifyRoomStateUpdated(rs: MatrixSDK.RoomState) {
    this._roomState = rs; // this is usually the same object, but some internal state has changed. This assignment kicks off reactivity.
  }

  get hasRoomState() {
    return this._roomState !== undefined;
  }

  get skillsConfig() {
    return (
      this._roomState?.events.get(APP_BOXEL_ROOM_SKILLS_EVENT_TYPE)?.get('')
        ?.event.content ?? {
        enabledEventIds: [],
        disabledEventIds: [],
      }
    );
  }

  get supportedLLMs() {
    let event = this._roomState?.events
      .get(APP_BOXEL_SUPPORTED_LLM_LIST)
      ?.get('')?.event;
    return (event as SupportedLLMListEvent)?.content.models ?? [];
  }

  get activeLLM() {
    let event = this._roomState?.events.get(APP_BOXEL_ACTIVE_LLM)?.get('')
      ?.event;
    return (event as ActiveLLMEvent)?.content.model ?? DEFAULT_LLM;
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
