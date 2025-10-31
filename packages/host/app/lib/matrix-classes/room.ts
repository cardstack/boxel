import { cached, tracked } from '@glimmer/tracking';

import EventEmitter from 'eventemitter3';

import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_LLM_MODE,
  type LLMMode,
} from '@cardstack/runtime-common/matrix-constants';

import type { SerializedFile } from 'https://cardstack.com/base/file-api';
import type {
  ActiveLLMEvent,
  MatrixEvent as DiscreteMatrixEvent,
} from 'https://cardstack.com/base/matrix-event';

import Mutex from '../mutex';

import type { IEvent } from 'matrix-js-sdk';

import type * as MatrixSDK from 'matrix-js-sdk';

export type TempEvent = Partial<IEvent> & {
  status: MatrixSDK.EventStatus | null;
  error?: MatrixSDK.MatrixError;
};

export type SkillsConfig = {
  enabledSkillCards: SerializedFile[];
  disabledSkillCards: SerializedFile[];
  commandDefinitions: SerializedFile[];
};

export default class Room {
  @tracked private _events: DiscreteMatrixEvent[] = [];
  @tracked private _roomState: MatrixSDK.RoomState | undefined;

  constructor(public readonly roomId: string) {}

  readonly mutex = new Mutex();
  private readonly emitter = new EventEmitter();

  waitForNextEvent(): Promise<void> {
    return new Promise((resolve) => {
      this.emitter.once('event.added', resolve);
    });
  }

  get events() {
    return this._events;
  }

  get name() {
    return this._roomState?.events.get('m.room.name')?.get('')?.event.content
      ?.name;
  }

  @cached
  get memberIds(): string[] {
    let memberEvents = (this._roomState?.events
      .get('m.room.member')
      ?.values() ?? []) as MatrixSDK.MatrixEvent[];
    let memberIds = [...memberEvents.map((ev) => ev.event.state_key)];
    return memberIds.filter((id) => id !== undefined) as string[];
  }

  notifyRoomStateUpdated(rs: MatrixSDK.RoomState) {
    this._roomState = rs; // this is usually the same object, but some internal state has changed. This assignment kicks off reactivity.
  }

  get hasRoomState() {
    return this._roomState !== undefined;
  }

  get skillsConfig() {
    const content = this._roomState?.events
      .get(APP_BOXEL_ROOM_SKILLS_EVENT_TYPE)
      ?.get('')?.event.content ?? {
      enabledSkillCards: [],
      disabledSkillCards: [],
      commandDefinitions: [],
    };

    return {
      enabledSkillCards: content.enabledSkillCards
        ? content.enabledSkillCards
        : [],
      disabledSkillCards: content.disabledSkillCards
        ? content.disabledSkillCards
        : [],
      commandDefinitions: content.commandDefinitions ?? [],
    } as {
      enabledSkillCards: SerializedFile[];
      disabledSkillCards: SerializedFile[];
      commandDefinitions: SerializedFile[];
    };
  }

  get activeLLM() {
    let event = this._roomState?.events
      .get(APP_BOXEL_ACTIVE_LLM)
      ?.get('')?.event;
    return (event as ActiveLLMEvent)?.content.model;
  }

  get activeLLMMode(): LLMMode {
    let event = this._roomState?.events.get(APP_BOXEL_LLM_MODE)?.get('')?.event;
    return event && (event as any).content?.mode
      ? ((event as any).content.mode as LLMMode)
      : 'ask';
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
    this.emitter.emit('event.added');
  }
}
