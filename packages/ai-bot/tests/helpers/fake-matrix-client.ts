import { IContent } from 'matrix-js-sdk';
import { MatrixClient } from '../../lib/matrix';

export class FakeMatrixClient implements MatrixClient {
  private eventId = 0;
  private sentEvents: {
    eventId: string;
    roomId: string;
    eventType: string;
    content: IContent;
  }[] = [];

  async sendEvent(
    roomId: string,
    eventType: string,
    content: IContent,
  ): Promise<{ event_id: string }> {
    const messageEventId = this.eventId.toString();
    this.sentEvents.push({
      eventId: messageEventId,
      roomId,
      eventType,
      content,
    });
    this.eventId++;
    return { event_id: messageEventId.toString() };
  }

  async setRoomName(
    _roomId: string,
    _title: string,
  ): Promise<{ event_id: string }> {
    this.eventId++;
    return { event_id: this.eventId.toString() };
  }

  getSentEvents() {
    return this.sentEvents;
  }

  sendStateEvent(
    _roomId: string,
    _eventType: string,
    _content: IContent,
    _stateKey: string,
  ): Promise<{ event_id: string }> {
    throw new Error('Method not implemented.');
  }

  resetSentEvents() {
    this.sentEvents = [];
    this.eventId = 0;
  }

  getAccessToken() {
    return 'fake-access-token';
  }
}
