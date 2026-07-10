import { getOwner } from '@ember/owner';

import {
  getToolRequests,
  isToolResultEventType,
  isToolResultRelType,
  decodeCommandRequest,
  type ToolContext,
  type ToolRequest,
} from '@cardstack/runtime-common';

import {
  basicMappings,
  generateJsonSchemaForCardType,
  getPatchTool,
} from '@cardstack/runtime-common/helpers/ai';

import GetEventsFromRoomTool from './get-events-from-room';

import type LoaderService from '../services/loader-service';
import type MessageService from '../services/message-service';
import type { CardDef } from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';
import type {
  CardMessageEvent,
  ToolResultEvent,
  EncodedToolRequest,
  MatrixEvent,
  RealmEventContent,
  Tool,
} from '@cardstack/base/matrix-event';

export async function waitForMatrixEvent(
  toolContext: ToolContext,
  roomId: string,
  callback: (matrixEvents: MatrixEvent[]) => boolean,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  let timeoutMs = options.timeoutMs ?? 1000 * 60 * 20; // default to 20 minutes
  let getEventsFromRoomCommand = new GetEventsFromRoomTool(toolContext);
  let done = false;
  let allMatrixEvents: MatrixEvent[] = [];
  let lastEventId: string | undefined = undefined;
  let startTime = Date.now();
  while (!done) {
    // if there are no new events since the provided eventId, this command blocks until a new event appears or a timeout is reached
    let result = await getEventsFromRoomCommand.execute({
      roomId,
      sinceEventId: lastEventId,
    });
    let matrixEvents = result.matrixEvents as MatrixEvent[];
    allMatrixEvents = allMatrixEvents.concat(matrixEvents);

    if (callback(allMatrixEvents)) {
      done = true;
    } else {
      lastEventId = matrixEvents[matrixEvents.length - 1]?.event_id;
    }
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timed out waiting for events in room ${roomId}`);
    }
  }
}

export async function waitForCompletedCommandRequest(
  toolContext: ToolContext,
  roomId: string,
  commandRequestPredicate: (toolRequest: Partial<ToolRequest>) => boolean,
  options: { timeoutMs?: number; afterEventId?: string } = {},
): Promise<ToolResultEvent | undefined> {
  let result: ToolResultEvent | undefined = undefined;
  await waitForMatrixEvent(
    toolContext,
    roomId,
    (matrixEvents: MatrixEvent[]) => {
      let events = options.afterEventId
        ? matrixEvents.slice(
            matrixEvents.findIndex((e) => e.event_id === options.afterEventId) +
              1,
          )
        : matrixEvents;
      let commandResultEvents = events.filter(
        (e) =>
          isToolResultEventType(e.type) &&
          isToolResultRelType(
            (e as ToolResultEvent).content['m.relates_to']?.rel_type,
          ) &&
          (e as ToolResultEvent).content['m.relates_to']?.key === 'applied',
      ) as ToolResultEvent[];
      return commandResultEvents.some((toolResultEvent) => {
        let eventWithRequest = events.find(
          (e) =>
            e.event_id === toolResultEvent.content['m.relates_to']?.event_id,
        ) as CardMessageEvent | undefined;
        if (!eventWithRequest) {
          return false;
        }
        let toolRequests =
          getToolRequests<Partial<EncodedToolRequest>>(
            eventWithRequest.content,
          ) ?? [];
        let toolRequest = toolRequests.find(
          (toolRequest) =>
            toolRequest.id === toolResultEvent.content.commandRequestId,
        );
        if (
          toolRequest &&
          commandRequestPredicate(decodeCommandRequest(toolRequest))
        ) {
          result = toolResultEvent;
          return true;
        }
        return false;
      });
    },
    { timeoutMs: options.timeoutMs },
  );
  return result;
}

export async function addPatchTools(
  toolContext: ToolContext,
  patchableCards: CardDef[],
  cardAPI: typeof CardAPI,
): Promise<Tool[]> {
  let results: Tool[] = [];
  let loader = (
    getOwner(toolContext)!.lookup('service:loader-service') as LoaderService
  ).loader;
  let mappings = await basicMappings(loader);
  for (const patchableCard of patchableCards) {
    let patchSpec = generateJsonSchemaForCardType(
      patchableCard.constructor as typeof CardDef,
      cardAPI,
      mappings,
    );
    results.push(getPatchTool(patchableCard.id, patchSpec));
  }
  return results;
}

export async function waitForRealmState(
  toolContext: ToolContext,
  realmId: string,
  predicate: (ev: RealmEventContent | undefined) => boolean,
  options: { timeoutMs?: number; keepRealmSubscription?: boolean } = {},
): Promise<void> {
  let timeoutMs = options.timeoutMs ?? 1000 * 60 * 20; // default to 20 minutes
  let keepRealmSubscription = options.keepRealmSubscription ?? false;
  if (predicate(undefined)) {
    return;
  }
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Timed out waiting for realm state in ${realmId}`));
    }, timeoutMs);
  });

  const messageService = getOwner(toolContext)?.lookup(
    'service:message-service',
  ) as MessageService | undefined;
  if (!messageService) {
    throw new Error('MessageService not found');
  }
  let unsubscribe: () => void = () => {};
  const predicateSucceededPromise = new Promise<void>((resolve) => {
    unsubscribe = messageService.subscribe(realmId, (ev) => {
      if (predicate(ev)) {
        if (!keepRealmSubscription) {
          unsubscribe?.();
        }
        resolve();
      }
    });
  });
  return Promise.race([predicateSucceededPromise, timeoutPromise]).finally(
    () => {
      unsubscribe?.();
    },
  );
}
