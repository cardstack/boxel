import { getOwner, setOwner } from '@ember/owner';
import { debounce } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import { task, timeout, all } from 'ember-concurrency';

import { IEvent } from 'matrix-js-sdk';

import { TrackedSet } from 'tracked-built-ins';
import { v4 as uuidv4 } from 'uuid';

import {
  type PatchData,
  Command,
  CommandContext,
  CommandContextStamp,
  getClass,
  identifyCard,
  delay,
} from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type Realm from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import MessageCommand from '../lib/matrix-classes/message-command';
import { shortenUuid } from '../utils/uuid';

import type LoaderService from './loader-service';
import type RealmServerService from './realm-server';
import type StoreService from './store';

const DELAY_FOR_APPLYING_UI = isTesting() ? 50 : 500;

type GenericCommand = Command<
  typeof CardDef | undefined,
  typeof CardDef | undefined
>;

export default class CommandService extends Service {
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;
  @service declare private loaderService: LoaderService;
  @service declare private realm: Realm;
  @service declare private realmServer: RealmServerService;
  currentlyExecutingCommandRequestIds = new TrackedSet<string>();
  private commandProcessingEventQueue: string[] = [];
  private flushCommandProcessingQueue: Promise<void> | undefined;

  private commands: Map<
    string,
    {
      command: GenericCommand;
      autoExecute: boolean;
    }
  > = new Map();

  public registerCommand(command: GenericCommand, autoExecute: boolean) {
    let name = `${command.name}_${shortenUuid(uuidv4())}`;
    this.commands.set(name, { command, autoExecute });
    return name;
  }

  public queueEventForCommandProcessing(event: Partial<IEvent>) {
    let eventId = event.event_id;
    if (event.content?.['m.relates_to']?.rel_type === 'm.replace') {
      eventId = event.content?.['m.relates_to']!.event_id;
    }
    if (!eventId) {
      throw new Error(
        'No event id found for event with commands, this should not happen',
      );
    }
    let roomId = event.room_id;
    if (!roomId) {
      throw new Error(
        'No room id found for event with commands, this should not happen',
      );
    }
    let compoundKey = `${roomId}|${eventId}`;
    if (this.commandProcessingEventQueue.includes(compoundKey)) {
      return;
    }

    this.commandProcessingEventQueue.push(compoundKey);

    debounce(this, this.drainCommandProcessingQueue, 100);
  }

  private async drainCommandProcessingQueue() {
    await this.flushCommandProcessingQueue;

    let finishedProcessingCommands: () => void;
    this.flushCommandProcessingQueue = new Promise(
      (res) => (finishedProcessingCommands = res),
    );

    let commandSpecs = [...this.commandProcessingEventQueue];
    this.commandProcessingEventQueue = [];

    while (commandSpecs.length > 0) {
      let [roomId, eventId] = commandSpecs.shift()!.split('|');

      let roomResource = this.matrixService.roomResources.get(roomId!);
      if (!roomResource) {
        throw new Error(
          `Room resource not found for room id ${roomId}, this should not happen`,
        );
      }
      let timeout = Date.now() + 60_000; // reset the timer to avoid a long wait if the room resource is processing
      let currentRoomProcessingTimestamp = roomResource.processingLastStartedAt;
      while (
        roomResource.isProcessing &&
        currentRoomProcessingTimestamp ===
          roomResource.processingLastStartedAt &&
        Date.now() < timeout
      ) {
        // wait for the room resource to finish processing
        await delay(100);
      }
      if (
        roomResource.isProcessing &&
        currentRoomProcessingTimestamp === roomResource.processingLastStartedAt
      ) {
        // room seems to be stuck processing, so we will log and skip this event
        console.error(
          `Room resource for room ${roomId} seems to be stuck processing, skipping event ${eventId}`,
        );
        continue;
      }

      let message = roomResource.messages.find((m) => m.eventId === eventId);
      if (!message) {
        continue;
      }
      for (let messageCommand of message.commands) {
        if (this.currentlyExecutingCommandRequestIds.has(messageCommand.id!)) {
          continue;
        }
        if (messageCommand.commandResultCardEventId) {
          continue;
        }
        if (!messageCommand.name) {
          continue;
        }
        let { command, autoExecute } =
          this.commands.get(messageCommand.name) ?? {};
        if (
          messageCommand.requiresApproval === false ||
          (command && autoExecute)
        ) {
          this.run.perform(messageCommand);
        }
      }
    }
    finishedProcessingCommands!();
  }

  get commandContext(): CommandContext {
    let result = {
      [CommandContextStamp]: true,
    };
    setOwner(result, getOwner(this)!);

    return result;
  }

  //TODO: Convert to non-EC async method after fixing CS-6987
  run = task(async (command: MessageCommand) => {
    let { arguments: payload, eventId, id: commandRequestId } = command;
    let resultCard: CardDef | undefined;
    try {
      this.matrixService.failedCommandState.delete(commandRequestId!);
      this.currentlyExecutingCommandRequestIds.add(commandRequestId!);

      // lookup command
      let { command: commandToRun } =
        this.commands.get(command.commandRequest.name ?? '') ?? {};

      // If we don't find it in the one-offs, start searching for
      // one in the skills we can construct
      if (!commandToRun) {
        let commandCodeRef = command.codeRef;
        if (commandCodeRef) {
          let CommandConstructor = (await getClass(
            commandCodeRef,
            this.loaderService.loader,
          )) as { new (context: CommandContext): Command<any, any> };
          commandToRun = new CommandConstructor(this.commandContext);
        }
      }

      if (commandToRun) {
        let typedInput = await this.instantiateCommandInput(
          commandToRun,
          payload?.attributes,
          payload?.relationships,
        );
        [resultCard] = await all([
          await commandToRun.execute(typedInput as any),
          await timeout(DELAY_FOR_APPLYING_UI), // leave a beat for the "applying" state of the UI to be shown
        ]);
      } else if (command.name === 'patchCard') {
        if (!hasPatchData(payload)) {
          throw new Error(
            "Patch command can't run because it doesn't have all the fields in arguments returned by open ai",
          );
        }
        await this.store.patch(payload?.attributes?.cardId, {
          attributes: payload?.attributes?.patch?.attributes,
          relationships: payload?.attributes?.patch?.relationships,
        });
      } else {
        // Unrecognized command. This can happen if a programmatically-provided command is no longer available due to a browser refresh.
        throw new Error(
          `Unrecognized command: ${command.name}. This command may have been associated with a previous browser session.`,
        );
      }
      await this.matrixService.sendCommandResultEvent(
        command.message.roomId,
        eventId,
        commandRequestId!,
        resultCard,
      );
    } catch (e) {
      let error =
        typeof e === 'string'
          ? new Error(e)
          : e instanceof Error
            ? e
            : new Error('Command failed.');
      console.error(error);
      await timeout(DELAY_FOR_APPLYING_UI); // leave a beat for the "applying" state of the UI to be shown
      this.matrixService.failedCommandState.set(commandRequestId!, error);
    } finally {
      this.currentlyExecutingCommandRequestIds.delete(commandRequestId!);
    }
  });

  // Construct a new instance of the input type with the
  // The input is undefined if the command has no input type
  private async instantiateCommandInput(
    command: GenericCommand,
    attributes: Record<string, any> | undefined,
    relationships: Record<string, any> | undefined,
  ) {
    // Get the input type and validate/construct the payload
    let typedInput;
    let InputType = await command.getInputType();
    if (InputType) {
      let adoptsFrom = identifyCard(InputType);
      if (adoptsFrom) {
        let inputDoc = {
          type: 'card',
          data: {
            meta: {
              adoptsFrom,
            },
            attributes: attributes ?? {},
            relationships: relationships ?? {},
          },
        };
        typedInput = await this.store.add(inputDoc, { doNotPersist: true });
      } else {
        // identifyCard can fail in some circumstances where the input type is not exported
        // in that case, we'll fall back to this less reliable method of constructing the input type
        typedInput = new InputType({ ...attributes, ...relationships });
      }
    } else {
      typedInput = undefined;
    }
    return typedInput;
  }
}

type PatchPayload = { attributes: { cardId: string; patch: PatchData } };

function hasPatchData(payload: any): payload is PatchPayload {
  return (
    payload.attributes?.cardId &&
    (payload.attributes?.patch?.attributes ||
      payload.attributes?.patch?.relationships)
  );
}
