import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import {
  type PatchData,
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  CardTypeFilter,
  Query,
  assertQuery,
} from '@cardstack/runtime-common/query';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { BaseDef } from 'https://cardstack.com/base/card-api';
import { CommandField } from 'https://cardstack.com/base/command';

import { SearchCommandResult } from 'https://cardstack.com/base/command-result';

import { Message } from '../lib/matrix-classes/message';
import { getSearchResults } from '../resources/search';

import CardService from './card-service';

const deserializeToQuery = (payload: SearchPayload) => {
  let maybeCodeRef = codeRefWithAbsoluteURL(
    payload.filter.type,
    new URL(payload.card_id),
  );
  if (!isResolvedCodeRef(maybeCodeRef)) {
    throw new Error('Query returned by ai bot is not fully resolved');
  }
  payload.filter.type = maybeCodeRef;

  return { filter: payload.filter };
};

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}

export default class CommandService extends Service {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;
  @tracked query: Query = {};

  searchCardResource = getSearchResults(this, () => this.query);

  run = task(async (command: CommandField, roomId: string) => {
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
        this.query = deserializeToQuery(payload);
        await this.searchCardResource.loaded;
        let promises = this.searchCardResource.instances.map((c) =>
          this.cardService.serializeCard(c),
        );
        res = await Promise.all(promises);
        console.log(res);
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

  getCommandResultComponent(message: Message) {
    if (message.command && message.command.result) {
      if (message.command.name === 'searchCard') {
        return getComponent(message.command.result as SearchCommandResult);
      }
    }
    return;
  }
}

type PatchPayload = { card_id: string } & PatchData;
type SearchPayload = { card_id: string; filter: CardTypeFilter };

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
