import { getOwner, setOwner } from '@ember/owner';

import { debounce } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import Ajv from 'ajv';

import { task, timeout, all } from 'ember-concurrency';

import { TrackedSet } from 'tracked-built-ins';
import { v4 as uuidv4 } from 'uuid';

import type { Command, CommandContext } from '@cardstack/runtime-common';
import {
  Deferred,
  CommandContextStamp,
  delay,
  getClass,
  identifyCard,
  type PatchData,
} from '@cardstack/runtime-common';

import { basicMappings } from '@cardstack/runtime-common/helpers/ai';

import CheckCorrectnessCommand from '@cardstack/host/commands/check-correctness';
import PatchCodeCommand from '@cardstack/host/commands/patch-code';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type Realm from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import { waitForRealmState } from '../commands/utils';
import LimitedSet from '../lib/limited-set';

import type LoaderService from './loader-service';
import type OperatorModeStateService from './operator-mode-state-service';
import type RealmServerService from './realm-server';
import type StoreService from './store';
import type { CodeData } from '../lib/formatted-message/utils';
import type MessageCodePatchResult from '../lib/matrix-classes/message-code-patch-result';
import type MessageCommand from '../lib/matrix-classes/message-command';
import type { IEvent } from 'matrix-js-sdk';

const DELAY_FOR_APPLYING_UI = isTesting() ? 50 : 500;
const CHECK_CORRECTNESS_COMMAND_NAME = 'checkCorrectness';

type GenericCommand = Command<
  typeof CardDef | undefined,
  typeof CardDef | undefined
>;

export default class CommandService extends Service {
  @service declare private loaderService: LoaderService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: Realm;
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;
  currentlyExecutingCommandRequestIds = new TrackedSet<string>();
  executedCommandRequestIds = new TrackedSet<string>();
  acceptingAllRoomIds = new TrackedSet<string>();
  private aiAssistantClientRequestIdsByRoom = new Map<
    string,
    LimitedSet<string>
  >();
  private aiAssistantInvalidations = new Map<
    string,
    {
      clientRequestId: string;
      roomId: string;
      targetHref: string;
      deferred: Deferred<void>;
    }
  >();
  private commandProcessingEventQueue: string[] = [];
  private codePatchProcessingEventQueue: string[] = [];
  private flushCommandProcessingQueue: Promise<void> | undefined;
  private flushCodePatchProcessingQueue: Promise<void> | undefined;

  registerAiAssistantClientRequestId(action: string, roomId: string): string {
    let encodedRoom = encodeURIComponent(roomId);
    let clientRequestId = `bot-patch:${encodedRoom}:${action}:${uuidv4()}`;

    let roomSet = this.aiAssistantClientRequestIdsByRoom.get(roomId!);
    if (!roomSet) {
      roomSet = new LimitedSet<string>(250);
      this.aiAssistantClientRequestIdsByRoom.set(roomId!, roomSet);
    }
    roomSet.add(clientRequestId);

    return clientRequestId;
  }

  trackAiAssistantCardRequest({
    action,
    roomId,
    fileUrl,
  }: {
    action: string;
    roomId: string;
    fileUrl: string;
  }): string | undefined {
    if (!action || !roomId || !fileUrl) {
      return;
    }
    let clientRequestId = this.registerAiAssistantClientRequestId(
      action,
      roomId,
    );
    // We only track invalidations for card instances and card definitions
    if (!fileUrl.endsWith('.gts') && !fileUrl.endsWith('.json')) {
      return clientRequestId;
    }
    let normalizedTarget = fileUrl.endsWith('.json')
      ? fileUrl.replace(/\.json$/, '')
      : fileUrl;
    let key = `${roomId}::${normalizedTarget}`;

    let realmURL: URL | undefined;
    try {
      realmURL = this.realm.realmOfURL(new URL(fileUrl)) ?? undefined;
    } catch (_e) {
      return clientRequestId;
    }
    if (!realmURL) {
      return clientRequestId;
    }

    let deferred = new Deferred<void>();
    this.aiAssistantInvalidations.set(key, {
      clientRequestId,
      roomId,
      targetHref: normalizedTarget,
      deferred,
    });

    waitForRealmState(
      this.commandContext,
      realmURL.href,
      (event) => {
        return Boolean(
          event &&
            event.eventName === 'index' &&
            event.indexType === 'incremental' &&
            event.clientRequestId === clientRequestId,
        );
      },
      { timeoutMs: 5 * 60 * 1000 },
    )
      .then(() => {
        let current = this.aiAssistantInvalidations.get(key);
        current?.deferred.fulfill();
      })
      .catch(() => {
        this.aiAssistantInvalidations.delete(key);
      });
    return clientRequestId;
  }

  async waitForInvalidationAfterAIAssistantRequest(
    roomId: string,
    targetHref: string,
    timeoutMs?: number,
  ): Promise<void> {
    if (!roomId || !targetHref) {
      return;
    }
    let normalizedTarget = targetHref.endsWith('.json')
      ? targetHref.replace(/\.json$/, '')
      : targetHref;
    let key = `${roomId}::${normalizedTarget}`;
    let existing = this.aiAssistantInvalidations.get(key);
    if (!existing) {
      return;
    }

    let waitPromise: Promise<void> = existing.deferred.promise;
    if (timeoutMs) {
      waitPromise = Promise.race([
        waitPromise,
        delay(timeoutMs).then(() => {}),
      ]);
    }
    await waitPromise;
    this.aiAssistantInvalidations.delete(key);
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

  public queueEventForCodePatchProcessing(event: Partial<IEvent>) {
    let eventId = event.event_id;
    if (event.content?.['m.relates_to']?.rel_type === 'm.replace') {
      eventId = event.content?.['m.relates_to']!.event_id;
    }
    if (!eventId) {
      throw new Error(
        'No event id found for event with code patches, this should not happen',
      );
    }
    let roomId = event.room_id;
    if (!roomId) {
      throw new Error(
        'No room id found for event with code patches, this should not happen',
      );
    }
    let compoundKey = `${roomId}|${eventId}`;
    if (this.codePatchProcessingEventQueue.includes(compoundKey)) {
      return;
    }

    this.codePatchProcessingEventQueue.push(compoundKey);

    debounce(this, this.drainCodePatchProcessingQueue, 100);
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
      if (message.agentId !== this.matrixService.agentId) {
        // This command was sent by another agent, so we will not auto-execute it
        continue;
      }

      // Collect all ready commands for this message
      let readyCommands: any[] = [];
      for (let messageCommand of message.commands) {
        if (this.currentlyExecutingCommandRequestIds.has(messageCommand.id!)) {
          continue;
        }
        if (this.executedCommandRequestIds.has(messageCommand.id!)) {
          continue;
        }
        if (
          messageCommand.status === 'applied' ||
          messageCommand.status === 'invalid'
        ) {
          continue;
        }
        if (!messageCommand.name) {
          continue;
        }

        let isValid = await this.validate(messageCommand);
        if (!isValid) {
          continue;
        }

        // Get the LLM mode that was active when this message was created
        let messageTimestamp = message.created.getTime();
        let activeModeAtMessageTime =
          roomResource.getActiveLLMModeAtTimestamp(messageTimestamp);

        // Auto-execute if LLM mode is 'act' AND the command came after the LLM mode was set to 'act',
        // or if requiresApproval is false
        let shouldAutoExecute = false;
        let isCheckCorrectnessCommand =
          messageCommand.name === CHECK_CORRECTNESS_COMMAND_NAME;

        if (
          isCheckCorrectnessCommand ||
          messageCommand.requiresApproval === false ||
          activeModeAtMessageTime === 'act'
        ) {
          shouldAutoExecute = true;
        }

        if (shouldAutoExecute) {
          readyCommands.push(messageCommand);
        }
      }

      // Execute ready commands, tracking accept-all state if multiple commands
      if (readyCommands.length > 0) {
        // This is an "accept all" operation - multiple commands ready for execution
        this.acceptingAllRoomIds.add(roomId!);
        try {
          for (let command of readyCommands) {
            this.run.perform(command);
          }
        } finally {
          this.acceptingAllRoomIds.delete(roomId!);
        }
      }
    }
    finishedProcessingCommands!();
  }

  private async drainCodePatchProcessingQueue() {
    await this.flushCodePatchProcessingQueue;

    let finishedProcessingCodePatches: () => void;
    this.flushCodePatchProcessingQueue = new Promise(
      (res) => (finishedProcessingCodePatches = res),
    );

    let codePatchSpecs = [...this.codePatchProcessingEventQueue];
    this.codePatchProcessingEventQueue = [];

    while (codePatchSpecs.length > 0) {
      let [roomId, eventId] = codePatchSpecs.shift()!.split('|');

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
          `Room resource for room ${roomId} seems to be stuck processing, skipping code patch event ${eventId}`,
        );
        continue;
      }
      let message = roomResource.messages.find((m) => m.eventId === eventId);
      if (!message) {
        continue;
      }
      if (message.agentId !== this.matrixService.agentId) {
        // This code patch was sent by another agent, so we will not auto-execute it
        continue;
      }

      // Get the LLM mode that was active when this message was created
      let messageTimestamp = message.created.getTime();
      let activeModeAtMessageTime =
        roomResource.getActiveLLMModeAtTimestamp(messageTimestamp);
      // Only auto-apply if in 'act' mode
      if (activeModeAtMessageTime !== 'act') {
        continue;
      }

      // Auto-apply all ready code patches from this message
      if (message.htmlParts) {
        let readyCodePatches = this.getReadyCodePatches(message.htmlParts);
        let uniqueFiles = new Set(
          readyCodePatches.map((patch) => patch.fileUrl),
        );

        if (readyCodePatches.length > 0 || uniqueFiles.size > 0) {
          // This is an "accept all" operation - multiple patches OR patches across multiple files
          this.acceptingAllRoomIds.add(roomId!);
          try {
            await this.executeReadyCodePatches(roomId!, message.htmlParts);
          } finally {
            this.acceptingAllRoomIds.delete(roomId!);
          }
        }
      }
    }
    finishedProcessingCodePatches!();
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
    // There may be some race conditions where the command is already being executed when this task starts
    if (
      this.currentlyExecutingCommandRequestIds.has(commandRequestId!) ||
      this.executedCommandRequestIds.has(commandRequestId!)
    ) {
      return; // already executing this command
    }
    try {
      this.matrixService.failedCommandState.delete(commandRequestId!);
      this.currentlyExecutingCommandRequestIds.add(commandRequestId!);

      let commandToRun;

      // If we don't find it in the one-offs, start searching for
      // one in the skills we can construct
      let commandCodeRef = command.codeRef;
      if (commandCodeRef) {
        let CommandConstructor = (await getClass(
          commandCodeRef,
          this.loaderService.loader,
        )) as { new (context: CommandContext): Command<any, any> };
        commandToRun = new CommandConstructor(this.commandContext);
      }

      if (!commandToRun && command.name === CHECK_CORRECTNESS_COMMAND_NAME) {
        commandToRun = new CheckCorrectnessCommand(this.commandContext);
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
      } else if (command.name === 'patchCardInstance') {
        if (!hasPatchData(payload)) {
          throw new Error(
            "Patch command can't run because it doesn't have all the fields in arguments returned by open ai",
          );
        }
        let cardId = payload.attributes.cardId;

        await this.store.patch(
          cardId,
          {
            attributes: payload?.attributes?.patch?.attributes,
            relationships: payload?.attributes?.patch?.relationships,
          },
          { doNotWaitForPersist: true },
        );
      } else {
        // Unrecognized command. This can happen if a programmatically-provided command is no longer available due to a browser refresh.
        throw new Error(
          `Unrecognized command: ${command.name}. This command may have been associated with a previous browser session.`,
        );
      }
      this.executedCommandRequestIds.add(commandRequestId!);
      await this.matrixService.updateSkillsAndCommandsIfNeeded(
        command.message.roomId,
      );
      let userContextForAiBot =
        await this.operatorModeStateService.getSummaryForAIBot();

      await this.matrixService.sendCommandResultEvent({
        roomId: command.message.roomId,
        invokedToolFromEventId: eventId,
        toolCallId: commandRequestId!,
        status: 'applied',
        resultCard,
        context: userContextForAiBot,
      });
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

  async validate(command: MessageCommand): Promise<boolean> {
    let error: string | undefined;
    if (!command.name) {
      console.warn(
        `Command with id ${command.id} has no name, skipping validation`,
      );
      return false;
    }

    if (command.name === 'patchCardInstance') {
      // special case for patchCardInstance command
      return true;
    }

    let commandCodeRef = command.codeRef;
    let commandInstance: GenericCommand | undefined;

    if (command.name === CHECK_CORRECTNESS_COMMAND_NAME) {
      commandInstance = new CheckCorrectnessCommand(this.commandContext);
    } else if (!commandCodeRef) {
      error = `No command for the name "${command.name}" was found`;
    } else {
      let CommandConstructor = (await getClass(
        commandCodeRef,
        this.loaderService.loader,
      )) as { new (context: CommandContext): Command<any, any> };
      if (!CommandConstructor) {
        error = `No command for the name "${command.name}" was found`;
      } else {
        commandInstance = new CommandConstructor(this.commandContext);
      }
    }

    if (commandInstance && !error) {
      let loader = (
        getOwner(this.commandContext)!.lookup(
          'service:loader-service',
        ) as LoaderService
      ).loader;
      let mappings = await basicMappings(loader);
      let jsonSchema = {
        type: 'object',
        properties: {
          description: {
            type: 'string',
          },
          ...(await commandInstance.getInputJsonSchema(
            this.matrixService.cardAPI,
            mappings,
          )),
        },
        required: ['attributes', 'description'],
        additionalProperties: false,
      };
      const ajv = new Ajv();
      const valid = ajv.validate(jsonSchema, command.arguments);
      if (!valid) {
        error = `Command "${command.name}" validation failed: ${ajv.errorsText()}`;
      }
    }
    if (error) {
      await this.matrixService.sendCommandResultEvent({
        roomId: command.message.roomId,
        invokedToolFromEventId: command.eventId,
        toolCallId: command.commandRequest.id!,
        status: 'invalid',
        failureReason: error,
        context: await this.operatorModeStateService.getSummaryForAIBot(),
      });
      return false;
    }

    return true;
  }

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

  patchCode = async (
    roomId: string,
    fileUrl: string | null,
    codeDataItems: {
      searchReplaceBlock?: string | null;
      eventId: string;
      codeBlockIndex: number;
    }[],
  ) => {
    if (!fileUrl) {
      throw new Error('File URL is required to patch code');
    }
    for (const codeData of codeDataItems) {
      this.currentlyExecutingCommandRequestIds.add(
        `${codeData.eventId}:${codeData.codeBlockIndex}`,
      );
    }
    let finalFileUrl: string | undefined;

    try {
      let patchCodeCommand = new PatchCodeCommand(this.commandContext);

      let patchCodeResult = await patchCodeCommand.execute({
        fileUrl,
        codeBlocks: codeDataItems.map(
          (codeData) => codeData.searchReplaceBlock!,
        ),
        roomId,
      });
      finalFileUrl = patchCodeResult.finalFileUrl;

      for (let i = 0; i < codeDataItems.length; i++) {
        const codeData = codeDataItems[i];
        const patchResult = patchCodeResult.results[i];
        if (patchResult.status === 'applied') {
          this.executedCommandRequestIds.add(
            `${codeData.eventId}:${codeData.codeBlockIndex}`,
          );
        }
      }

      await this.matrixService.updateSkillsAndCommandsIfNeeded(roomId);
      let fileDef = this.matrixService.fileAPI.createFileDef({
        sourceUrl: finalFileUrl ?? fileUrl,
        name: fileUrl.split('/').pop(),
      });

      let context = await this.operatorModeStateService.getSummaryForAIBot();

      let resultSends: Promise<unknown>[] = [];
      for (let i = 0; i < codeDataItems.length; i++) {
        const codeData = codeDataItems[i];
        const result = patchCodeResult.results[i];
        resultSends.push(
          this.matrixService.sendCodePatchResultEvent(
            roomId,
            codeData.eventId,
            codeData.codeBlockIndex,
            result.status as CodePatchStatus,
            [],
            [fileDef],
            context,
            result.failureReason,
          ),
        );
      }
      await Promise.all(resultSends);
    } finally {
      // remove the code blocks from the currently executing command request ids
      for (const codeData of codeDataItems) {
        this.currentlyExecutingCommandRequestIds.delete(
          `${codeData.eventId}:${codeData.codeBlockIndex}`,
        );
      }
    }
  };

  getReadyCodePatches = (
    htmlParts: Array<{ codeData: CodeData | null }>,
  ): CodeData[] => {
    let result: CodeData[] = [];
    for (let i = 0; i < htmlParts.length; i++) {
      let htmlPart = htmlParts[i];
      let codeData = htmlPart.codeData;
      if (!codeData || !codeData.searchReplaceBlock) continue;
      let status = this.getCodePatchStatus(codeData);
      if (status && status === 'ready') {
        result.push(codeData);
      }
    }
    return result;
  };

  executeReadyCodePatches = async (
    roomId: string,
    htmlParts: Array<{ codeData: CodeData | null }>,
  ) => {
    let readyCodePatches = this.getReadyCodePatches(htmlParts);

    // Group code patches by fileUrl and apply them
    let grouped: Record<string, CodeData[]> = {};
    for (let codeData of readyCodePatches) {
      if (!codeData.fileUrl) continue;
      if (!grouped[codeData.fileUrl]) grouped[codeData.fileUrl] = [];
      grouped[codeData.fileUrl].push(codeData);
    }

    for (let [fileUrl, codeDataItems] of Object.entries(grouped)) {
      let patchItems = codeDataItems.map((codeData) => ({
        searchReplaceBlock: codeData.searchReplaceBlock,
        eventId: codeData.eventId,
        codeBlockIndex: codeData.codeBlockIndex,
      }));
      await this.patchCode(roomId, fileUrl, patchItems);
    }
  };

  private isCodeBlockApplying(codeData: {
    eventId: string;
    codeBlockIndex: number;
  }) {
    return this.currentlyExecutingCommandRequestIds.has(
      `${codeData.eventId}:${codeData.codeBlockIndex}`,
    );
  }

  private isCodeBlockRecentlyApplied(codeBlock: {
    eventId: string;
    codeBlockIndex: number;
  }) {
    return this.executedCommandRequestIds.has(
      `${codeBlock.eventId}:${codeBlock.codeBlockIndex}`,
    );
  }

  getCodePatchStatus = (codeData: {
    roomId: string;
    eventId: string;
    codeBlockIndex: number;
  }): CodePatchStatus | 'applying' | 'ready' => {
    if (this.isCodeBlockApplying(codeData)) {
      return 'applying';
    }
    if (this.isCodeBlockRecentlyApplied(codeData)) {
      return 'applied';
    }
    return this.getCodePatchResult(codeData)?.status ?? 'ready';
  };

  getCodePatchResult = (codeData: {
    roomId: string;
    eventId: string;
    codeBlockIndex: number;
  }): MessageCodePatchResult | undefined => {
    let roomResource = this.matrixService.roomResources.get(codeData.roomId);
    if (!roomResource) {
      return undefined;
    }
    let message = roomResource.messages.find(
      (m) => m.eventId === codeData.eventId,
    );
    return message?.codePatchResults?.find(
      (c) => c.index === codeData.codeBlockIndex,
    );
  };

  isPerformingAcceptAllForRoom(roomId: string): boolean {
    return this.acceptingAllRoomIds.has(roomId);
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

declare module '@ember/service' {
  interface Registry {
    'command-service': CommandService;
  }
}
