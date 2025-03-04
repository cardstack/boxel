import { getOwner, setOwner } from '@ember/owner';
import Service, { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import { task, timeout, all } from 'ember-concurrency';

import { IEvent } from 'matrix-js-sdk';

import { TrackedSet } from 'tracked-built-ins';
import { v4 as uuidv4 } from 'uuid';

import {
  Command,
  type PatchData,
  CommandContext,
  CommandContextStamp,
  ResolvedCodeRef,
  isResolvedCodeRef,
  getClass,
} from '@cardstack/runtime-common';

import { APP_BOXEL_COMMAND_REQUESTS_KEY } from '@cardstack/runtime-common/matrix-constants';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type Realm from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { SearchCardsByTypeAndTitleCommand } from '../commands/search-cards';
import MessageCommand from '../lib/matrix-classes/message-command';
import { shortenUuid } from '../utils/uuid';

import CardService from './card-service';
import RealmServerService from './realm-server';

import type LoaderService from './loader-service';

const DELAY_FOR_APPLYING_UI = isTesting() ? 50 : 500;

type GenericCommand = Command<
  typeof CardDef | undefined,
  typeof CardDef | undefined
>;

export default class CommandService extends Service {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;
  @service declare private cardService: CardService;
  @service declare private loaderService: LoaderService;
  @service declare private realm: Realm;
  @service declare private realmServer: RealmServerService;
  currentlyExecutingCommandRequestIds = new TrackedSet<string>();

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

  public async executeCommandEventsIfNeeded(event: Partial<IEvent>) {
    let eventId = event.event_id;
    if (event.content?.['m.relates_to']?.rel_type === 'm.replace') {
      eventId = event.content?.['m.relates_to']!.event_id;
    }
    if (!eventId) {
      throw new Error(
        'No event id found for command event, this should not happen',
      );
    }
    // examine the tool_call and see if it's a command that we know how to run
    let commandRequest = event?.content?.[APP_BOXEL_COMMAND_REQUESTS_KEY]?.[0];
    if (!commandRequest) {
      return;
    }
    // TODO: check whether this commandRequest  was already executed and exit if so
    let { name } = commandRequest;
    let { command, autoExecute } = this.commands.get(name) ?? {};
    if (!command || !autoExecute) {
      return;
    }
    this.currentlyExecutingCommandRequestIds.add(commandRequest.id);
    try {
      // Get the input type and validate/construct the payload
      let InputType = await command.getInputType();

      // Construct a new instance of the input type with the
      // The input is undefined if the command has no input type
      let typedInput;
      if (InputType) {
        typedInput = new InputType({
          ...commandRequest.arguments.attributes,
          ...commandRequest.arguments.relationships,
        });
      } else {
        typedInput = undefined;
      }
      let resultCard = await command.execute(typedInput as any);
      await this.matrixService.sendCommandResultEvent(
        event.room_id!,
        eventId,
        commandRequest.id,
        resultCard,
      );
    } catch (e) {
      console.error(e);
      this.matrixService.failedCommandState.set(
        commandRequest.id,
        e instanceof Error
          ? e
          : new Error('Command failed. ' + (e as any).toString?.()),
      );
    } finally {
      this.currentlyExecutingCommandRequestIds.delete(commandRequest.id);
    }
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
        // Get the input type and validate/construct the payload
        let InputType = await commandToRun.getInputType();
        // Construct a new instance of the input type with the payload
        // The input is undefined if the command has no input type
        let typedInput;
        if (InputType) {
          typedInput = new InputType({
            ...payload!.attributes,
            ...payload!.relationships,
          });
        } else {
          typedInput = undefined;
        }
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
        await this.operatorModeStateService.patchCard.perform(
          payload?.attributes?.cardId,
          {
            attributes: payload?.attributes?.patch?.attributes,
            relationships: payload?.attributes?.patch?.relationships,
          },
        );
      } else if (command.name === 'searchCardsByTypeAndTitle') {
        if (!hasSearchData(payload)) {
          throw new Error(
            "Search command can't run because it doesn't have all the arguments returned by open ai",
          );
        }
        let command = new SearchCardsByTypeAndTitleCommand(this.commandContext);
        resultCard = await command.execute({
          title: payload.attributes.title,
          cardType: payload.attributes.cardType,
          type: payload.attributes.type,
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
      console.warn(error);
      await timeout(DELAY_FOR_APPLYING_UI); // leave a beat for the "applying" state of the UI to be shown
      this.matrixService.failedCommandState.set(commandRequestId!, error);
    } finally {
      this.currentlyExecutingCommandRequestIds.delete(commandRequestId!);
    }
  });
}

type PatchPayload = { attributes: { cardId: string; patch: PatchData } };
type SearchPayload = {
  attributes: { cardType?: string; title?: string; type?: ResolvedCodeRef };
};

function hasPatchData(payload: any): payload is PatchPayload {
  return (
    payload.attributes?.cardId &&
    (payload.attributes?.patch?.attributes ||
      payload.attributes?.patch?.relationships)
  );
}

function hasSearchData(payload: any): payload is SearchPayload {
  return (
    isResolvedCodeRef(payload.attributes?.type) ||
    payload.attributes?.title ||
    payload.attributes?.cardType
  );
}
