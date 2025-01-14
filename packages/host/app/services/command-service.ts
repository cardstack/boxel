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
  baseRealm,
  ResolvedCodeRef,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type Realm from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import { SearchCardsByTypeAndTitleCommand } from '../commands/search-cards';
import MessageCommand from '../lib/matrix-classes/message-command';
import { shortenUuid } from '../utils/uuid';

import CardService from './card-service';
import RealmServerService from './realm-server';

import type LoaderService from './loader-service';

const DELAY_FOR_APPLYING_UI = isTesting() ? 50 : 500;

export default class CommandService extends Service {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
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

      // Construct a new instance of the input type with the
      // The input is undefined if the command has no input type
      let typedInput;
      if (InputType) {
        typedInput = new InputType({
          ...toolCall.arguments.attributes,
          ...toolCall.arguments.relationships,
        });
      } else {
        typedInput = undefined;
      }
      let resultCard = await command.execute(typedInput);
      await this.matrixService.sendCommandResultEvent(
        event.room_id!,
        event.event_id!,
        resultCard,
      );
    } finally {
      this.currentlyExecutingCommandEventIds.delete(event.event_id!);
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
    let { payload, eventId } = command;
    let resultCard: CardDef | undefined;
    try {
      this.matrixService.failedCommandState.delete(eventId);
      this.currentlyExecutingCommandEventIds.add(eventId);

      // lookup command
      let { command: commandToRun } = this.commands.get(command.name) ?? {};

      if (commandToRun) {
        // Get the input type and validate/construct the payload
        let InputType = await commandToRun.getInputType();
        // Construct a new instance of the input type with the payload
        // The input is undefined if the command has no input type
        let typedInput;
        if (InputType) {
          typedInput = new InputType({
            ...payload.attributes,
            ...payload.relationships,
          });
        } else {
          typedInput = undefined;
        }
        [resultCard] = await all([
          await commandToRun.execute(typedInput),
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
        let commandModule = await this.loaderService.loader.import<
          typeof BaseCommandModule
        >(`${baseRealm.url}command`);
        let { LegacyGenerateAppModuleResult } = commandModule;
        await this.cardService.saveSource(new URL(`${moduleId}.gts`), content);
        resultCard = new LegacyGenerateAppModuleResult({
          moduleId: `${moduleId}.gts`,
          source: content,
        });
        if (!payload.attached_card_id) {
          throw new Error(
            `Could not update 'moduleURL' with a link to the generated module.`,
          );
        }
        await this.operatorModeStateService.patchCard.perform(
          String(payload.attached_card_id),
          { attributes: { moduleURL: moduleId } },
        );
      } else {
        // Unrecognized command. This can happen if a programmatically-provided command is no longer available due to a browser refresh.
        throw new Error(
          `Unrecognized command: ${command.name}. This command may have been associated with a previous browser session.`,
        );
      }
      await this.matrixService.sendCommandResultEvent(
        command.message.roomId,
        eventId,
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
      this.matrixService.failedCommandState.set(eventId, error);
    } finally {
      this.currentlyExecutingCommandEventIds.delete(eventId);
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
