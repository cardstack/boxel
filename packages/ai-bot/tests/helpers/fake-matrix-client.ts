import type { IContent } from 'matrix-js-sdk';
import { Method, MatrixClient } from 'matrix-js-sdk';

export class FakeMatrixClient extends MatrixClient {
  private eventId = 0;
  private sentEvents: {
    eventId: string;
    roomId: string;
    eventType: string;
    content: IContent;
  }[] = [];

  baseUrl = 'https://example.com';

  constructor() {
    super({ baseUrl: 'test' });
  }

  async uploadContent(
    _content: string,
    _opts?: {
      type: string;
    },
  ): Promise<{ content_uri: string }> {
    return {
      content_uri: 'https://example.com/content',
    };
  }

  http = {
    authedRequest: async (
      _method: Method,
      _path: string,
      _queryParams: any,
    ) => {
      return { chunk: [] };
    },
  } as any;

  sendEvent = (async (
    roomId: string,
    eventType: string,
    content: IContent,
    _txnId?: string,
  ): Promise<{ event_id: string }> => {
    const messageEventId = this.eventId.toString();
    this.sentEvents.push({
      eventId: messageEventId,
      roomId,
      eventType,
      content,
    });
    this.eventId++;
    return { event_id: messageEventId.toString() };
  }) as any;

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
