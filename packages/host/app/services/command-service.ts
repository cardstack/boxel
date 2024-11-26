import { getOwner, setOwner } from '@ember/owner';
import Service, { service } from '@ember/service';

import { task } from 'ember-concurrency';

import flatMap from 'lodash/flatMap';

import { IEvent } from 'matrix-js-sdk';

import { TrackedSet } from 'tracked-built-ins';
import { v4 as uuidv4 } from 'uuid';

import {
  Command,
  type LooseSingleCardDocument,
  type PatchData,
  baseRealm,
  CommandContext,
} from '@cardstack/runtime-common';
import {
  type CardTypeFilter,
  type EqFilter,
  assertQuery,
} from '@cardstack/runtime-common/query';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type Realm from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { CommandResult } from 'https://cardstack.com/base/command-result';
import type {
  CommandEvent,
  CommandResultEvent,
} from 'https://cardstack.com/base/matrix-event';

import MessageCommand from '../lib/matrix-classes/message-command';
import { shortenUuid } from '../utils/uuid';

import CardService from './card-service';
import RealmServerService from './realm-server';

export default class CommandService extends Service {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;
  @service private declare realm: Realm;
  @service private declare realmServer: RealmServerService;
  currentlyExecutingCommandEventIds = new TrackedSet<string>();

  private commands: Map<
    string,
    { command: Command<any, any, any>; autoExecute: boolean }
  > = new Map();

  public registerCommand(
    command: Command<any, any, any>,
    autoExecute: boolean,
  ) {
    let name = `${command.name}_${shortenUuid(uuidv4())}`;
    this.commands.set(name, { command, autoExecute });
    return name;
  }

  public async executeCommandEventIfNeeded(event: Partial<IEvent>) {
    // examine the tool_call and see if it's a command that we know how to run
    let toolCall = event?.content?.data?.toolCall;
    if (!toolCall) {
      return;
    }
    // TODO: check whether this toolCall was already executed and exit if so
    let { name } = toolCall;
    let { command, autoExecute } = this.commands.get(name) ?? {};
    if (!command || !autoExecute) {
      return;
    }
    this.currentlyExecutingCommandEventIds.add(event.event_id!);
    try {
      // Get the input type and validate/construct the payload
      let InputType = await command.getInputType();

      // Construct a new instance of the input type with the payload
      let typedInput = new InputType({
        ...toolCall.arguments.attributes,
        ...toolCall.arguments.relationships,
      });
      let res = await command.execute(typedInput);
      await this.matrixService.sendReactionEvent(
        event.room_id!,
        event.event_id!,
        'applied',
      );
      if (res) {
        await this.matrixService.sendCommandResultMessage(
          event.room_id!,
          event.event_id!,
          res,
        );
      }
    } finally {
      this.currentlyExecutingCommandEventIds.delete(event.event_id!);
    }
  }

  get commandContext(): CommandContext {
    let result = {
      sendAiAssistantMessage: (
        ...args: Parameters<MatrixService['sendAiAssistantMessage']>
      ) => this.matrixService.sendAiAssistantMessage(...args),
    };
    setOwner(result, getOwner(this)!);

    return result;
  }

  //TODO: Convert to non-EC async method after fixing CS-6987
  run = task(async (command: MessageCommand, roomId: string) => {
    let { payload, eventId } = command;
    let res: any;
    try {
      this.matrixService.failedCommandState.delete(eventId);
      this.currentlyExecutingCommandEventIds.add(eventId);

      // lookup command
      let { command: commandToRun } = this.commands.get(command.name) ?? {};

      if (commandToRun) {
        // Get the input type and validate/construct the payload
        let InputType = await commandToRun.getInputType();
        // Construct a new instance of the input type with the payload
        let typedInput = new InputType({
          ...payload.attributes,
          ...payload.relationships,
        });
        res = await commandToRun.execute(typedInput);
      } else if (command.name === 'patchCard') {
        if (!hasPatchData(payload)) {
          throw new Error(
            "Patch command can't run because it doesn't have all the fields in arguments returned by open ai",
          );
        }
        res = await this.operatorModeStateService.patchCard.perform(
          payload?.attributes?.cardId,
          {
            attributes: payload?.attributes?.patch?.attributes,
            relationships: payload?.attributes?.patch?.relationships,
          },
        );
      } else if (command.name === 'searchCard') {
        if (!hasSearchData(payload)) {
          throw new Error(
            "Search command can't run because it doesn't have all the arguments returned by open ai",
          );
        }
        let query = { filter: payload.attributes.filter };
        let realmUrls = this.realmServer.availableRealmURLs;
        let instances: CardDef[] = flatMap(
          await Promise.all(
            realmUrls.map(
              async (realm) =>
                await this.cardService.search(query, new URL(realm)),
            ),
          ),
        );
        res = await Promise.all(
          instances.map((c) => this.cardService.serializeCard(c)),
        );
      } else if (command.name === 'generateAppModule') {
        let realmURL = this.operatorModeStateService.realmURL;

        if (!realmURL) {
          throw new Error(
            `Cannot generate app module without a writable realm`,
          );
        }

        let timestamp = Date.now();
        let fileName =
          (payload.appTitle as string)?.replace(/ /g, '-').toLowerCase() ??
          `untitled-app-${timestamp}`;
        let moduleId = `${realmURL}AppModules/${fileName}-${timestamp}`;
        let content = (payload.moduleCode as string) ?? '';
        res = await this.cardService.saveSource(
          new URL(`${moduleId}.gts`),
          content,
        );
        if (!payload.attached_card_id) {
          throw new Error(
            `Could not update 'moduleURL' with a link to the generated module.`,
          );
        }
        await this.operatorModeStateService.patchCard.perform(
          String(payload.attached_card_id),
          { attributes: { moduleURL: moduleId } },
        );
      }
      await this.matrixService.sendReactionEvent(roomId, eventId, 'applied');
      if (res) {
        await this.matrixService.sendCommandResultMessage(roomId, eventId, res);
      }
    } catch (e) {
      let error =
        typeof e === 'string'
          ? new Error(e)
          : e instanceof Error
          ? e
          : new Error('Command failed.');
      this.matrixService.failedCommandState.set(eventId, error);
    } finally {
      this.currentlyExecutingCommandEventIds.delete(eventId);
    }
  });

  async createCommandResult(args: Record<string, any>) {
    return await this.matrixService.createCard<typeof CommandResult>(
      {
        name: 'CommandResult',
        module: `${baseRealm.url}command-result`,
      },
      args,
    );
  }

  deserializeResults(event: CommandResultEvent) {
    let serializedResults: LooseSingleCardDocument[] =
      typeof event?.content?.result === 'string'
        ? JSON.parse(event.content.result)
        : event.content.result;
    return Array.isArray(serializedResults) ? serializedResults : [];
  }

  async createCommandResultArgs(
    commandEvent: CommandEvent,
    commandResultEvent: CommandResultEvent,
  ) {
    let toolCall = commandEvent.content.data.toolCall;
    if (toolCall.name === 'searchCard') {
      let results = this.deserializeResults(commandResultEvent);
      return {
        toolCallName: toolCall.name,
        toolCallId: toolCall.id,
        toolCallArgs: toolCall.arguments,
        cardIds: results.map((r) => r.data.id),
      };
    } else if (toolCall.name === 'patchCard') {
      return {
        toolCallName: toolCall.name,
        toolCallId: toolCall.id,
        toolCallArgs: toolCall.arguments,
      };
    }
    return;
  }
}

type PatchPayload = { attributes: { cardId: string; patch: PatchData } };
type SearchPayload = {
  attributes: { cardId: string; filter: CardTypeFilter | EqFilter };
};

function hasPatchData(payload: any): payload is PatchPayload {
  return (
    payload.attributes?.cardId &&
    (payload.attributes?.patch?.attributes ||
      payload.attributes?.patch?.relationships)
  );
}

function hasSearchData(payload: any): payload is SearchPayload {
  assertQuery({ filter: payload.attributes.filter });
  return payload;
}
