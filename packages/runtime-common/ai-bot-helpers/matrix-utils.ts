import { IContent, MatrixClient, Method } from 'matrix-js-sdk';
import { REPLACE_MARKER, SEARCH_MARKER, SEPARATOR_MARKER } from '../constants';
import { logger } from '../log';
import { OpenAIError } from 'openai/error';
import * as Sentry from '@sentry/node';
import { CommandRequest, encodeCommandRequests } from '../commands';
import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
} from '../matrix-constants';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import { MatrixEvent } from 'matrix-js-sdk';
import { PromptParts } from './types';
import { encodeUri } from 'matrix-js-sdk/lib/utils';
import { SerializedFileDef } from 'https://cardstack.com/base/file-api';

function getLog() {
  return logger('ai-bot');
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
  getLog().debug('sending event', content);
  return await client.sendEvent(roomId, eventType, content);
}

export async function sendMessageEvent(
  client: MatrixClient,
  roomId: string,
  body: string,
  eventIdToReplace: string | undefined,
  data: any = {},
  commandRequests: Partial<CommandRequest>[] = [],
  reasoning: string | undefined = undefined,
) {
  getLog().debug('sending message', body);
  let contentObject: IContent = {
    ...{
      body,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      [APP_BOXEL_REASONING_CONTENT_KEY]: reasoning,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: encodeCommandRequests(commandRequests),
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
    getLog().error(errorMessage);
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
    getLog().error(`Error sending error message back to user: ${e}`);
    Sentry.captureException(e);
  }
}

export async function sendDebugMessage(
  client: MatrixClient,
  roomId: string,
  body: string,
  data: any = {},
) {
  await client.sendEvent(roomId, APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE, {
    msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
    body,
    isStreamingFinished: true,
    data: JSON.stringify(data),
  });
}

export async function sendEventListAsDebugMessage(
  client: MatrixClient,
  roomId: string,
  eventList: DiscreteMatrixEvent[],
  customMessage: string = '',
) {
  let stringContent = JSON.stringify(eventList);
  let sharedFile = await client.uploadContent(stringContent, {
    type: 'text/plain',
  });
  await sendDebugMessage(
    client,
    roomId,
    'Debug: attached the raw event list.\n\n' + customMessage,
    {
      attachedFiles: [
        {
          sourceUrl: '',
          url: client.mxcUrlToHttp(sharedFile.content_uri),
          name: 'debug-event.json',
          contentType: 'text/plain',
        },
      ],
    },
  );
}

export async function sendPromptAsDebugMessage(
  client: MatrixClient,
  roomId: string,
  promptParts: PromptParts,
  customMessage: string = '',
) {
  let stringContent = JSON.stringify(promptParts);
  let sharedFile = await client.uploadContent(stringContent, {
    type: 'text/plain',
  });
  await sendDebugMessage(
    client,
    roomId,
    'Debug: attached the prompt sent to the AI.\n\n' + customMessage,
    {
      attachedFiles: [
        {
          sourceUrl: '',
          url: client.mxcUrlToHttp(sharedFile.content_uri),
          name: 'debug-event.json',
          contentType: 'text/plain',
        },
      ],
    },
  );
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

/**
 * Retrieves the last 1000 non-replace events from a Matrix room
 * @param roomId - The ID of the Matrix room
 * @param client - Matrix client instance used to make authenticated requests
 * @param lastEventId - Optional ID of the last event to retrieve events up to - use to filter
 *                      out events that came in after the one that triggered the response
 * @returns Array of Matrix events. If lastEventId is provided, returns events up to and including that event.
 *          If lastEventId is not found or not provided, returns all available events.
 */
export async function getRoomEvents(
  roomId: string,
  client: MatrixClient,
  lastEventId?: string,
) {
  const messagesPath = encodeUri('/rooms/$roomId/messages', {
    $roomId: roomId,
  });
  let response = await (client as any).http.authedRequest(
    Method.Get,
    messagesPath,
    {
      dir: 'f',
      limit: '1000',
      filter: JSON.stringify({
        'org.matrix.msc3874.not_rel_types': ['m.replace'],
      }),
    },
  );
  let events = (response?.chunk || []) as DiscreteMatrixEvent[];
  if (!lastEventId) {
    // return all events
    return events;
  }
  let eventIndex = events.findIndex(
    (listEvent) => listEvent.event_id === lastEventId,
  );
  if (eventIndex == -1) {
    return events;
  }
  return events.slice(0, eventIndex + 1);
}

export async function downloadFile(
  client: MatrixClient,
  attachedFile: SerializedFileDef,
): Promise<string> {
  if (
    !attachedFile?.contentType?.includes('text/') &&
    !attachedFile.contentType?.includes('application/vnd.card+json')
  ) {
    throw new Error(
      `Unsupported file type: ${attachedFile.contentType}. For now, only text files are supported.`,
    );
  }

  const cachedEntry = fileCache.get(attachedFile.url!);
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

  fileCache.set(attachedFile.url!, {
    content,
    timestamp: Date.now(),
  });

  if (fileCache.size > 100) {
    cleanupCache();
  }

  return content;
}

export function isCommandOrCodePatchResult(
  event: MatrixEvent | DiscreteMatrixEvent,
): boolean {
  let type =
    (event as DiscreteMatrixEvent).type || (event as MatrixEvent).getType?.();
  return (
    type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE ||
    type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE
  );
}

export function extractCodePatchBlocks(s: string) {
  let matches = [
    ...s.matchAll(
      new RegExp(
        `${SEARCH_MARKER}.*?${SEPARATOR_MARKER}.*?${REPLACE_MARKER}`,
        'gs',
      ),
    ),
  ];
  return matches.map((match) => match[0]);
}
