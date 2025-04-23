import { IContent } from 'matrix-js-sdk';
import { logger } from '@cardstack/runtime-common';
import { OpenAIError } from 'openai/error';
import * as Sentry from '@sentry/node';
import { CommandRequest } from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

let log = logger('ai-bot');

export interface MatrixClient {
  sendEvent(
    roomId: string,
    eventType: string,
    content: IContent,
  ): Promise<{ event_id: string }>;

  sendStateEvent(
    roomId: string,
    eventType: string,
    content: IContent,
    stateKey: string,
  ): Promise<{ event_id: string }>;

  setRoomName(roomId: string, title: string): Promise<{ event_id: string }>;

  getAccessToken(): string | null;
}

export interface SerializedFileDef {
  url: string;
  sourceUrl: string;
  name: string;
  contentType: string;
  content?: string;
  error?: string;
}

export async function sendMatrixEvent(
  client: MatrixClient,
  roomId: string,
  eventType: string,
  content: IContent,
  eventIdToReplace: string | undefined,
) {
  if (content.data) {
    content.data = JSON.stringify(content.data);
  }
  if (eventIdToReplace) {
    content['m.relates_to'] = {
      rel_type: 'm.replace',
      event_id: eventIdToReplace,
    };
  }
  log.debug('sending event', content);
  return await client.sendEvent(roomId, eventType, content);
}

// TODO we might want to think about how to handle patches that are larger than
// 65KB (the maximum matrix event size), such that we split them into fragments
// like we split cards into fragments
export async function sendMessageEvent(
  client: MatrixClient,
  roomId: string,
  body: string,
  eventIdToReplace: string | undefined,
  data: any = {},
  commandRequests: Partial<CommandRequest>[] = [],
  reasoning: string | undefined = undefined,
) {
  log.debug('sending message', body);
  let contentObject: IContent = {
    ...{
      body,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      [APP_BOXEL_REASONING_CONTENT_KEY]: reasoning,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: commandRequests,
    },
    ...data,
  };
  return await sendMatrixEvent(
    client,
    roomId,
    'm.room.message',
    contentObject,
    eventIdToReplace,
  );
}

export async function sendErrorEvent(
  client: MatrixClient,
  roomId: string,
  error: any,
  eventIdToReplace: string | undefined,
) {
  try {
    let errorMessage = getErrorMessage(error);
    log.error(errorMessage);
    await sendMessageEvent(
      client,
      roomId,
      'There was an error processing your request, please try again later.',
      eventIdToReplace,
      {
        isStreamingFinished: true,
        errorMessage,
      },
    );
  } catch (e) {
    // We've had a problem sending the error message back to the user
    // Log and continue
    log.error(`Error sending error message back to user: ${e}`);
    Sentry.captureException(e);
  }
}

function getErrorMessage(error: any): string {
  if (error instanceof OpenAIError) {
    return `OpenAI error: ${error.name} - ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

interface CacheEntry {
  content: string;
  timestamp: number;
}

const fileCache: Map<string, CacheEntry> = new Map();
const CACHE_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes

function cleanupCache() {
  const now = Date.now();
  for (const [url, entry] of fileCache.entries()) {
    if (now - entry.timestamp > CACHE_EXPIRATION_MS) {
      fileCache.delete(url);
    }
  }
}

export async function downloadFile(
  client: MatrixClient,
  attachedFile: SerializedFileDef,
): Promise<string> {
  if (!attachedFile?.contentType?.includes('text/')) {
    throw new Error(
      `Unsupported file type: ${attachedFile.contentType}. For now, only text files are supported.`,
    );
  }

  const cachedEntry = fileCache.get(attachedFile.url);
  if (cachedEntry) {
    cachedEntry.timestamp = Date.now();
    return cachedEntry.content;
  }

  // Download the file if not in cache
  let response = await (globalThis as any).fetch(attachedFile.url, {
    headers: {
      Authorization: `Bearer ${client.getAccessToken()}`,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP error. Status: ${response.status}`);
  }

  const content = await response.text();

  fileCache.set(attachedFile.url, {
    content,
    timestamp: Date.now(),
  });

  if (fileCache.size > 100) {
    cleanupCache();
  }

  return content;
}
