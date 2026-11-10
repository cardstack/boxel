import type {
  IContent,
  IHttpOpts,
  IRequestOpts,
  MatrixHttpApi,
  StateEvents,
  Method,
} from 'matrix-js-sdk';
import { getHttpUriForMxc, MatrixClient } from 'matrix-js-sdk';
import { recursiveMapToObject } from 'matrix-js-sdk/lib/utils.js';

export const FAKE_HOMESERVER_URL = 'https://example.com';

// The homeserver download URL for a Matrix media item, as the host stores it
// on an attachment: the URL `FakeMatrixClient.mxcUrlToHttp` builds for the
// item on the authenticated media endpoint, which is the only URL the bot
// downloads the item from.
export function matrixMediaUrl(mxcUrl: string): string {
  let url = getHttpUriForMxc(
    FAKE_HOMESERVER_URL,
    mxcUrl,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    true,
  );
  if (!url) {
    throw new Error(`Not a valid mxc:// URL: ${mxcUrl}`);
  }
  return url;
}

export class FakeMatrixClient extends MatrixClient {
  private eventId = 0;
  private sentEvents: {
    eventId: string;
    roomId: string;
    eventType: string;
    content: IContent;
  }[] = [];
  private sentToDeviceEvents: {
    eventType: string;
    contentMap: Record<string, Record<string, IContent>>;
  }[] = [];

  baseUrl = FAKE_HOMESERVER_URL;

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

  async sendToDevice(
    eventType: string,
    contentMap: Map<string, Map<string, IContent>>,
    _txnId?: string,
  ): Promise<any> {
    // The real matrix-js-sdk client requires a nested Map and iterates it
    // internally (via recursiveMapToObject + `for...of`), throwing
    // `TypeError: contentMap is not iterable` on a plain object. Enforce the
    // same contract here so a plain-object payload fails the test the way it
    // fails in production. Store the normalized plain object for assertions.
    if (!(contentMap instanceof Map)) {
      throw new TypeError('sendToDevice contentMap must be a Map');
    }
    this.sentToDeviceEvents.push({
      eventType,
      contentMap: recursiveMapToObject(contentMap),
    });
    return {};
  }

  getSentToDeviceEvents() {
    return this.sentToDeviceEvents;
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
    this.sentToDeviceEvents = [];
    this.eventId = 0;
  }

  getAccessToken() {
    return 'fake-access-token';
  }
}
