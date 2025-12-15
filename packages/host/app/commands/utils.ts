import { getOwner } from '@ember/owner';

import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  decodeCommandRequest,
  type CommandContext,
  type CommandRequest,
} from '@cardstack/runtime-common';

import {
  basicMappings,
  generateJsonSchemaForCardType,
  getPatchTool,
} from '@cardstack/runtime-common/helpers/ai';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type {
  CardMessageEvent,
  CommandResultEvent,
  MatrixEvent,
  RealmEventContent,
  Tool,
} from 'https://cardstack.com/base/matrix-event';

import GetEventsFromRoomCommand from './get-events-from-room';

import type LoaderService from '../services/loader-service';
import type MessageService from '../services/message-service';

export async function waitForMatrixEvent(
  commandContext: CommandContext,
  roomId: string,
  callback: (matrixEvents: MatrixEvent[]) => boolean,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  let timeoutMs = options.timeoutMs ?? 1000 * 60 * 20; // default to 20 minutes
  let getEventsFromRoomCommand = new GetEventsFromRoomCommand(commandContext);
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
  commandContext: CommandContext,
  roomId: string,
  commandRequestPredicate: (commandRequest: Partial<CommandRequest>) => boolean,
  options: { timeoutMs?: number; afterEventId?: string } = {},
): Promise<CommandResultEvent | undefined> {
  let result: CommandResultEvent | undefined = undefined;
  await waitForMatrixEvent(
    commandContext,
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
          e.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
          e.content['m.relates_to']?.rel_type ===
            APP_BOXEL_COMMAND_RESULT_REL_TYPE &&
          e.content['m.relates_to']?.key === 'applied',
      ) as CommandResultEvent[];
      return commandResultEvents.some((commandResultEvent) => {
        let eventWithRequest = events.find(
          (e) =>
            e.event_id === commandResultEvent.content['m.relates_to']?.event_id,
        ) as CardMessageEvent | undefined;
        if (!eventWithRequest) {
          return false;
        }
        let commandRequests =
          eventWithRequest.content[APP_BOXEL_COMMAND_REQUESTS_KEY] ?? [];
        let commandRequest = commandRequests.find(
          (commandRequest) =>
            commandRequest.id === commandResultEvent.content.commandRequestId,
        );
        if (
          commandRequest &&
          commandRequestPredicate(decodeCommandRequest(commandRequest))
        ) {
          result = commandResultEvent;
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
  commandContext: CommandContext,
  patchableCards: CardDef[],
  cardAPI: typeof CardAPI,
): Promise<Tool[]> {
  let results: Tool[] = [];
  let loader = (
    getOwner(commandContext)!.lookup('service:loader-service') as LoaderService
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
  commandContext: CommandContext,
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

  const messageService = getOwner(commandContext)?.lookup(
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
