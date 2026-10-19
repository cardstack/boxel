import type { IContent, MatrixClient } from 'matrix-js-sdk';
import { Method } from 'matrix-js-sdk';
import { uniq } from 'lodash-es';
import { uint8ArrayToBase64 } from '../base64.ts';
import { logger } from '../log.ts';
import { OpenAIError } from 'openai/error';
import type { ToolRequest } from '../commands.ts';
import { encodeToolRequests } from '../commands.ts';
import {
  APP_BOXEL_TOOL_REQUESTS_KEY,
  APP_BOXEL_RELOAD_BILLING_DATA_KEY,
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_ACTIVE_LLM,
  isToolResultEventType,
  isToolResultRelType,
} from '../matrix-constants.ts';
import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { PromptParts } from './types.ts';
import { encodeUri } from 'matrix-js-sdk/lib/utils.js';
import type { SerializedFileDef } from '@cardstack/base/file-api';
import { isTextBasedContentType } from './modality.ts';
import {
  compactionCarriesEarlierHistory,
  getLatestCompaction,
} from './compaction.ts';

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
  toolRequests: Partial<ToolRequest>[] = [],
  reasoning: string | undefined = undefined,
) {
  getLog().debug('sending message', body);
  let contentObject: IContent = {
    ...{
      body,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      [APP_BOXEL_REASONING_CONTENT_KEY]: reasoning,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: encodeToolRequests(toolRequests),
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
  opts?: { reloadBillingData?: boolean },
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
        [APP_BOXEL_RELOAD_BILLING_DATA_KEY]: opts?.reloadBillingData ?? false,
      },
    );
  } catch (e) {
    // We've had a problem sending the error message back to the user
    // Log and continue
    getLog().error(`Error sending error message back to user: ${e}`);
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
    'Debug: attached the event list.\n\n' + customMessage,
    {
      attachedFiles: [
        {
          sourceUrl: '',
          url: client.mxcUrlToHttp(
            sharedFile.content_uri,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            true,
          ),
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
          url: client.mxcUrlToHttp(
            sharedFile.content_uri,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            true,
          ),
          name: 'debug-event.json',
          contentType: 'text/plain',
        },
      ],
    },
  );
}

function getErrorMessage(error: any): string {
  let providerError = getProviderError(error);
  if (providerError) {
    return `${providerError.name} error: ${providerError.message}`;
  }
  if (error instanceof OpenAIError) {
    return `${error.name} - ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error?.message) {
    return error.message;
  }
  return 'Unknown error';
}

function getProviderError(
  error: any,
): { name: string; message: string } | null {
  let metadata = error?.error?.metadata;
  if (metadata) {
    try {
      let raw = JSON.parse(metadata.raw);
      return {
        name: metadata.provider_name,
        message: raw.error.message,
      };
    } catch {
      return null;
    }
  }

  return null;
}

interface CacheEntry {
  content: string;
  timestamp: number;
}

const fileCache: Map<string, CacheEntry> = new Map();
const CACHE_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes
// In-flight fetch promises keyed by URL so concurrent requests dedupe
const inFlightFetches: Map<string, Promise<string>> = new Map();

function cleanupCache() {
  const now = Date.now();
  for (const [url, entry] of fileCache.entries()) {
    if (now - entry.timestamp > CACHE_EXPIRATION_MS) {
      fileCache.delete(url);
    }
  }
}

async function fetchMatrixMediaWithFallback(
  client: MatrixClient,
  url: string,
): Promise<Response> {
  let headers = {
    Authorization: `Bearer ${client.getAccessToken()}`,
  };

  let primaryError: unknown;
  try {
    let primaryResponse = await (globalThis as any).fetch(url, { headers });
    if (primaryResponse.ok) {
      return primaryResponse;
    }
    primaryError = new Error(`HTTP error. Status: ${primaryResponse.status}`);
  } catch (err) {
    primaryError = err;
  }

  let canonical = canonicalizeMatrixMediaKey(url);
  let fallbackUrl =
    canonical?.startsWith('mxc://') && canonical !== url
      ? client.mxcUrlToHttp(
          canonical,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          true,
        )
      : null;
  if (!fallbackUrl || fallbackUrl === url) {
    throw primaryError;
  }

  let fallbackResponse = await (globalThis as any).fetch(fallbackUrl, {
    headers,
  });
  if (!fallbackResponse.ok) {
    throw new Error(`HTTP error. Status: ${fallbackResponse.status}`);
  }

  return fallbackResponse;
}

// Synapse caps a /messages page at 1000 events.
export const ROOM_EVENTS_PAGE_SIZE = 1000;
// How far back the history window pages in a room with no compaction to stop
// at (or only ones that carry nothing forward). A room this long without one
// has not hit the model's context limit since compactions started carrying.
export const ROOM_EVENTS_MAX_PAGES = 10;
// Room config events: the host writes them when it creates the room and again
// only when they change, so they can be older than any history window.
export const ROOM_CONFIG_EVENT_TYPES = [
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  APP_BOXEL_ACTIVE_LLM,
  'm.room.name',
];
const ROOM_CONFIG_MAX_PAGES = 5;

interface MessagesPage {
  chunk?: DiscreteMatrixEvent[];
  end?: string;
}

/**
 * Pages a room's /messages backwards from its latest event, never including
 * edits (`m.replace`).
 * @param onPage - Called with every event fetched so far, newest first, after
 *                 each page short of the start of the room. Returning true
 *                 stops paging.
 * @returns The events fetched, newest first, and whether paging reached the
 *          start of the room.
 */
export async function fetchRoomEventsBackwards(
  roomId: string,
  client: MatrixClient,
  opts: {
    types?: string[];
    limit?: number;
    maxPages?: number;
    onPage?: (eventsNewestFirst: DiscreteMatrixEvent[]) => boolean;
  } = {},
): Promise<{ events: DiscreteMatrixEvent[]; reachedStart: boolean }> {
  const messagesPath = encodeUri('/rooms/$roomId/messages', {
    $roomId: roomId,
  });
  let filter: Record<string, unknown> = {
    'org.matrix.msc3874.not_rel_types': ['m.replace'],
  };
  if (opts.types) {
    filter.types = opts.types;
  }
  let events: DiscreteMatrixEvent[] = [];
  let from: string | undefined;
  for (let page = 0; page < (opts.maxPages ?? Infinity); page++) {
    let response: MessagesPage | undefined = await (
      client as any
    ).http.authedRequest(Method.Get, messagesPath, {
      dir: 'b',
      limit: String(opts.limit ?? ROOM_EVENTS_PAGE_SIZE),
      filter: JSON.stringify(filter),
      ...(from ? { from } : {}),
    });
    let chunk = response?.chunk ?? [];
    events.push(...chunk);
    // Synapse leaves out `end` only on an empty page, past the start of the
    // room, so the room's create event (its oldest) is the sooner sign. A
    // page can be empty and still carry `end`, when every event in it was
    // filtered out.
    let end = response?.end;
    if (
      !end ||
      end === from ||
      chunk[chunk.length - 1]?.type === 'm.room.create'
    ) {
      return { events, reachedStart: true };
    }
    if (opts.onPage?.(events)) {
      return { events, reachedStart: false };
    }
    from = end;
  }
  return { events, reachedStart: false };
}

/**
 * The room history the ai-bot works from: events up to and including
 * `lastEventId`, oldest first, never including edits (`m.replace`).
 *
 * The history starts at the latest compaction's cut point (the cut event
 * itself is kept), because the prompt never uses anything older. That
 * needs a compaction that carries the room's tools, used tool-call ids and
 * read skill files (`compactionCarriesEarlierHistory`); with none, the
 * history reaches back to the start of the room, or `ROOM_EVENTS_MAX_PAGES`
 * pages. When the
 * history does not start at the start of the room, the events older than it
 * that the prompt still needs are put ahead of it, in time order: the room
 * config events (`ROOM_CONFIG_EVENT_TYPES`), so the room's skills, model and
 * title are still known, the events the compaction lists as having
 * contributed the room's tools (`toolSourceEventIds`), and the readRealmFile
 * results whose skill files the prompt carries (`skillFileEventIds`).
 *
 * @param lastEventId - The event that triggered the response; events after
 *                      it are left out. When it is not among the fetched
 *                      events (a local echo the server has not indexed yet),
 *                      every fetched event is kept.
 * @param opts.wholeRoom - Page to the start of the room, ignoring compaction
 *                         and the page cap.
 */
export async function getRoomEvents(
  roomId: string,
  client: MatrixClient,
  lastEventId?: string,
  opts: { wholeRoom?: boolean } = {},
): Promise<DiscreteMatrixEvent[]> {
  let aiBotUserId = client.getUserId() ?? undefined;
  // Splits the fetched events, oldest first, at the trigger.
  let splitAtTrigger = (eventsNewestFirst: DiscreteMatrixEvent[]) => {
    let chronological = [...eventsNewestFirst].reverse();
    let triggerIndex = lastEventId
      ? chronological.findIndex((event) => event.event_id === lastEventId)
      : -1;
    return triggerIndex === -1
      ? { history: chronological, afterTrigger: [] }
      : {
          history: chronological.slice(0, triggerIndex + 1),
          afterTrigger: chronological.slice(triggerIndex + 1),
        };
  };
  // The latest compaction, when the history before its cut can be left out.
  let latestCompaction = (history: DiscreteMatrixEvent[]) => {
    let compaction = aiBotUserId
      ? getLatestCompaction(history, aiBotUserId)
      : undefined;
    return compaction && compactionCarriesEarlierHistory(compaction)
      ? compaction
      : undefined;
  };
  // Where the latest compaction cuts the history, or -1.
  let cutIndex = (history: DiscreteMatrixEvent[]) => {
    let compaction = latestCompaction(history);
    return compaction
      ? history.findIndex((event) => event.event_id === compaction.upToEventId)
      : -1;
  };

  let { events, reachedStart } = await fetchRoomEventsBackwards(
    roomId,
    client,
    opts.wholeRoom
      ? {}
      : {
          maxPages: ROOM_EVENTS_MAX_PAGES,
          onPage: (eventsNewestFirst) =>
            cutIndex(splitAtTrigger(eventsNewestFirst).history) !== -1,
        },
  );
  let { history, afterTrigger } = splitAtTrigger(events);
  if (opts.wholeRoom) {
    return history;
  }
  let cut = cutIndex(history);
  if (cut === -1 && !reachedStart) {
    getLog().warn(
      `Room ${roomId}'s history stops after ${ROOM_EVENTS_MAX_PAGES} pages, short of the start of the room and of a compaction cut that carries the earlier tools, tool-call ids and skill file reads`,
    );
  }
  if (cut <= 0 && reachedStart) {
    return history;
  }
  let beforeCut = cut > 0 ? history.slice(0, cut) : [];
  if (cut > 0) {
    history = history.slice(cut);
  }
  if (history.length === 0) {
    return history;
  }

  let excludedIds = new Set(
    [...history, ...afterTrigger].map((event) => event.event_id),
  );
  let trigger = history[history.length - 1];
  let compaction = latestCompaction(history);
  let [configEvents, carriedEvents] = await Promise.all([
    reachedStart
      ? // Paging reached the start of the room, so the config events older
        // than the cut are already in hand.
        beforeCut.filter((event) =>
          ROOM_CONFIG_EVENT_TYPES.includes(event.type),
        )
      : fetchRoomEventsBackwards(roomId, client, {
          types: ROOM_CONFIG_EVENT_TYPES,
          maxPages: ROOM_CONFIG_MAX_PAGES,
        }).then(({ events: configEvents }) =>
          configEvents.filter(
            (event) =>
              !excludedIds.has(event.event_id) &&
              // Not one that arrived after the history was fetched.
              event.origin_server_ts <= trigger.origin_server_ts,
          ),
        ),
    fetchRoomEventsById(
      roomId,
      client,
      uniq([
        ...(compaction?.toolSourceEventIds ?? []),
        ...(compaction?.skillFileEventIds ?? []),
      ]).filter((eventId) => !excludedIds.has(eventId)),
      // Paging may already have fetched some, before the cut.
      events,
    ),
  ]);
  // In time order, as `getTools` reads the room's tools in one
  // chronological pass, and their order is part of the cached prompt.
  let olderEvents = [...configEvents, ...carriedEvents].sort(
    (a, b) => a.origin_server_ts - b.origin_server_ts,
  );
  return [...olderEvents, ...history];
}

// How many events `fetchRoomEventsById` requests at once.
const EVENT_FETCH_CONCURRENCY = 10;

// The events with these ids, in the same order. An event the server doesn't
// have or won't show the bot is left out; any other failure throws, since
// dropping an event that contributes tools or skill files would change the
// prompt.
async function fetchRoomEventsById(
  roomId: string,
  client: MatrixClient,
  eventIds: string[],
  alreadyFetched: DiscreteMatrixEvent[],
): Promise<DiscreteMatrixEvent[]> {
  let fetched = new Map(alreadyFetched.map((event) => [event.event_id, event]));
  let fetchOne = async (eventId: string) => {
    if (fetched.has(eventId)) {
      return fetched.get(eventId);
    }
    try {
      return (await (client as any).http.authedRequest(
        Method.Get,
        encodeUri('/rooms/$roomId/event/$eventId', {
          $roomId: roomId,
          $eventId: eventId,
        }),
      )) as DiscreteMatrixEvent;
    } catch (error: any) {
      if (
        error?.errcode === 'M_NOT_FOUND' ||
        error?.errcode === 'M_FORBIDDEN'
      ) {
        getLog().warn(`Could not fetch event ${eventId} in ${roomId}`, error);
        return undefined;
      }
      throw error;
    }
  };
  let events: (DiscreteMatrixEvent | undefined)[] = [];
  for (let i = 0; i < eventIds.length; i += EVENT_FETCH_CONCURRENCY) {
    events.push(
      ...(await Promise.all(
        eventIds.slice(i, i + EVENT_FETCH_CONCURRENCY).map(fetchOne),
      )),
    );
  }
  return events.filter((event): event is DiscreteMatrixEvent => !!event);
}

export async function downloadFile(
  client: MatrixClient,
  attachedFile: SerializedFileDef,
): Promise<string> {
  let fileUrl = attachedFile?.url;
  if (!fileUrl) {
    throw new Error('Attached file URL is missing');
  }
  if (!isTextBasedContentType(attachedFile?.contentType)) {
    throw new Error(
      `Unsupported file type: ${attachedFile.contentType}. For now, only text files are supported.`,
    );
  }

  const canonicalKey = canonicalizeMatrixMediaKey(fileUrl);

  // Check cache by canonical key first
  const cachedEntry = canonicalKey
    ? fileCache.get(canonicalKey)
    : fileCache.get(fileUrl);
  if (cachedEntry) {
    // cache hit - minimal logging
    cachedEntry.timestamp = Date.now();
    return cachedEntry.content;
  }

  // If a fetch for this canonical key is already in-flight, wait for it instead
  const inFlightKey = canonicalKey || fileUrl;
  const inFlight = inFlightFetches.get(inFlightKey);
  if (inFlight) {
    return await inFlight;
  }

  // cache miss

  // create an in-flight promise and store it so others can await
  const fetchPromise = (async () => {
    let response = await fetchMatrixMediaWithFallback(client, fileUrl);

    const content = await response.text();

    // store in cache under canonical key when available
    const cacheKey = canonicalKey || fileUrl;
    fileCache.set(cacheKey, {
      content,
      timestamp: Date.now(),
    });
    if (fileCache.size > 100) {
      cleanupCache();
    }

    return content;
  })();

  inFlightFetches.set(inFlightKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightFetches.delete(inFlightKey);
  }
}

export async function downloadFileAsBase64DataUrl(
  client: MatrixClient,
  url: string,
  contentType: string,
): Promise<string> {
  let response = await fetchMatrixMediaWithFallback(client, url);
  let buffer = await response.arrayBuffer();
  let base64 = uint8ArrayToBase64(new Uint8Array(buffer));
  return `data:${contentType};base64,${base64}`;
}

// A tool result: a tool-result event type that relates to its request with a
// tool-result relation. Accepts both the discrete event shape and a
// matrix-js-sdk MatrixEvent.
export function isToolResult(
  event: MatrixEvent | DiscreteMatrixEvent,
): boolean {
  let type =
    (event as DiscreteMatrixEvent).type || (event as MatrixEvent).getType?.();
  let content = ((event as DiscreteMatrixEvent).content ??
    (event as MatrixEvent).getContent?.()) as
    | { 'm.relates_to'?: { rel_type?: string } }
    | undefined;
  return (
    isToolResultEventType(type) &&
    isToolResultRelType(content?.['m.relates_to']?.rel_type)
  );
}

// Normalize a Matrix media URL (HTTP download URL or mxc://) into a canonical key.
// Returns an mxc://host/id style canonical key when possible; otherwise returns the input URL.
export function canonicalizeMatrixMediaKey(url?: string | null): string | null {
  if (!url) return null;
  // If it's already an mxc URL, return as-is
  if (url.startsWith('mxc://')) return url;

  try {
    const u = new URL(url);

    // Strip query params and trailing filename segments for normalization
    // so that URLs like /download/<host>/<id>/<fileName>?v=1 and
    // /download/<host>/<id> map to the same canonical key.
    const pathname = u.pathname.replace(/\/+$|\?.*$/g, '');
    const parts = pathname.split('/').filter(Boolean);

    // Look for the download segment
    const downloadIdx = parts.indexOf('download');
    if (downloadIdx !== -1 && parts.length >= downloadIdx + 3) {
      const host = parts[downloadIdx + 1];
      const id = parts[downloadIdx + 2];
      return `mxc://${host}/${id}`;
    }

    // Handle thumbnail path variants
    const thumbIdx = parts.indexOf('thumbnail');
    if (thumbIdx !== -1 && parts.length >= thumbIdx + 3) {
      const host = parts[thumbIdx + 1];
      const id = parts[thumbIdx + 2];
      return `mxc://${host}/${id}`;
    }
  } catch (e) {
    // fall through and return original URL
  }

  return url;
}
