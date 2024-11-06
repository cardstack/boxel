import Service, { service } from '@ember/service';

import { task } from 'ember-concurrency';

import flatMap from 'lodash/flatMap';

import {
  type LooseSingleCardDocument,
  type PatchData,
  baseRealm,
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
import type { CommandCard } from 'https://cardstack.com/base/command';
import type { CommandResult } from 'https://cardstack.com/base/command-result';
import type {
  CommandEvent,
  CommandResultEvent,
} from 'https://cardstack.com/base/matrix-event';

import CardService from './card-service';
import RealmServerService from './realm-server';

export default class CommandService extends Service {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;
  @service private declare realm: Realm;
  @service private declare realmServer: RealmServerService;

  //TODO: Convert to non-EC async method after fixing CS-6987
  run = task(async (command: CommandCard, roomId: string) => {
    let { payload, eventId } = command;
    let res: any;
    try {
      this.matrixService.failedCommandState.delete(eventId);
      if (command.name === 'patchCard') {
        if (!hasPatchData(payload)) {
          throw new Error(
            "Patch command can't run because it doesn't have all the fields in arguments returned by open ai",
          );
        }
        res = await this.operatorModeStateService.patchCard.perform(
          payload.card_id,
          {
            attributes: payload.attributes,
            relationships: payload.relationships,
          },
        );
      } else if (command.name === 'searchCard') {
        if (!hasSearchData(payload)) {
          throw new Error(
            "Search command can't run because it doesn't have all the arguments returned by open ai",
          );
        }
        let query = { filter: payload.filter };
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

  async createCommand(args: Record<string, any>) {
    return await this.matrixService.createCard<typeof CommandCard>(
      {
        name: 'CommandCard',
        module: `${baseRealm.url}command`,
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

type PatchPayload = { card_id: string } & PatchData;
type SearchPayload = { card_id: string; filter: CardTypeFilter | EqFilter };

function hasPatchData(payload: any): payload is PatchPayload {
  return (
    (typeof payload === 'object' &&
      payload !== null &&
      'card_id' in payload &&
      'attributes' in payload) ||
    (typeof payload === 'object' &&
      payload !== null &&
      'card_id' in payload &&
      'relationships' in payload)
  );
}

function hasSearchData(payload: any): payload is SearchPayload {
  assertQuery({ filter: payload.filter });
  return payload;
}
