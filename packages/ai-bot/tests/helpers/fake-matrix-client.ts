import type {
  IContent,
  IHttpOpts,
  IRequestOpts,
  MatrixHttpApi,
  StateEvents,
} from 'matrix-js-sdk';
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
    // Core request methods
    authedRequest: async (
      _method: Method,
      _path: string,
      _queryParams: any,
      _body?: any,
      _opts?: any,
    ) => {
      return { chunk: [] };
    },
  } as unknown as MatrixHttpApi<IHttpOpts & { onlyData: true }>;

  sendEvent(
    roomId: string,
    eventType: string,
    content: IContent,
    txnId?: string,
  ): Promise<{ event_id: string }>;
  sendEvent(
    roomId: string,
    threadId: string | null,
    eventType: string,
    content: IContent,
    txnId?: string,
  ): Promise<{ event_id: string }>;
  async sendEvent(...args: any[]): Promise<{ event_id: string }> {
    const messageEventId = this.eventId.toString();

    let roomId: string;
    let eventType: string;
    let content: IContent;

    if (typeof args[2] === 'object') {
      // First overload: (roomId, eventType, content, txnId?)
      [roomId, eventType, content] = args;
    } else {
      // Second overload: (roomId, threadId, eventType, content, txnId?)
      [roomId, , eventType, content] = args;
    }

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

  sendStateEvent<K extends keyof StateEvents>(
    _roomId: string,
    _eventType: K,
    _content: StateEvents[K],
    _stateKey?: string | undefined,
    _opts?: IRequestOpts | undefined,
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
