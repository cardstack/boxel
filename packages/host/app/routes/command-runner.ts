import { getOwner, setOwner } from '@ember/owner';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import type {
  Command,
  CommandContext,
  CommandInvocation,
  CodeRef,
} from '@cardstack/runtime-common';
import {
  assertIsResolvedCodeRef,
  CommandContextStamp,
  getClass,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';

import type {
  CardDef,
  CardDefConstructor,
} from 'https://cardstack.com/base/card-api';

import { registerBoxelTransitionTo } from '../utils/register-boxel-transition';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';
import type RealmService from '../services/realm';

class CommandRunState implements CommandInvocation<CardDefConstructor> {
  @tracked status: CommandInvocation<CardDefConstructor>['status'] = 'pending';
  @tracked cardResult: CardDef | null = null;
  @tracked error: Error | null = null;
  @tracked cardResultString: string | null = null;
  @tracked commandRef: string | null = null;
  @tracked commandInput: string | null = null;

  constructor(readonly nonce: string) {}

  get isSuccess() {
    return this.status === 'success';
  }

  get isLoading() {
    return this.status === 'pending';
  }

  get prerenderStatus(): 'ready' | 'error' | undefined {
    if (this.status === 'success') {
      return 'ready';
    }
    if (this.status === 'error') {
      return 'error';
    }
    return undefined;
  }
}

export type CommandRunnerModel = CommandRunState;

export default class CommandRunnerRoute extends Route<CommandRunnerModel> {
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare realm: RealmService;

  async beforeModel() {
    registerBoxelTransitionTo(this.router);
    (globalThis as any).__boxelRenderContext = true;
    this.realm.restoreSessionsFromStorage();
  }

  deactivate() {
    (globalThis as any).__boxelRenderContext = undefined;
  }

  model(params: { nonce: string }, transition: Transition): CommandRunnerModel {
    let model = new CommandRunState(params.nonce);
    let queryParams = transition?.to?.queryParams ?? {};
    let command = parseResolvedCodeRef(getQueryParam(queryParams, 'command'));
    let commandInput = parseJson(getQueryParam(queryParams, 'input'));

    if (command) {
      model.commandRef = JSON.stringify(command);
    }
    if (commandInput) {
      model.commandInput = JSON.stringify(commandInput);
    }

    if (!command) {
      model.status = 'error';
      model.error = new Error('Missing or invalid command');
      return model;
    }

    void this.#runCommand(model, command, commandInput);
    return model;
  }

  get commandContext(): CommandContext {
    let result = {
      [CommandContextStamp]: true,
    } as CommandContext;
    setOwner(result, getOwner(this)!);
    return result;
  }

  async #runCommand(
    model: CommandRunState,
    command: CodeRef,
    commandInput: Record<string, unknown> | undefined,
  ) {
    try {
      if (!isResolvedCodeRef(command)) {
        throw new Error('Command must be a resolved code ref');
      }
      let CommandConstructor = (await getClass(
        command,
        this.loaderService.loader,
      )) as { new (context: CommandContext): Command<any, any> } | undefined;
      if (!CommandConstructor) {
        throw new Error('Command not found for provided CodeRef');
      }

      let commandInstance = new CommandConstructor(this.commandContext);
      let resultCard: CardDef | undefined;
      if (commandInput) {
        resultCard = await commandInstance.execute(commandInput as any);
      } else {
        resultCard = await commandInstance.execute();
      }

      model.cardResult = resultCard ?? null;
      let serialized = resultCard
        ? await this.cardService.serializeCard(resultCard)
        : null;
      model.cardResultString = serialized
        ? JSON.stringify(serialized, null, 2)
        : '';
      model.status = 'success';
    } catch (error) {
      console.error('Command runner failed', {
        command,
        error,
      });
      model.error = error instanceof Error ? error : new Error(String(error));
      model.status = 'error';
    }
  }
}

function parseResolvedCodeRef(raw: string | undefined): CodeRef | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    let decoded = decodeURIComponent(raw);
    let parsed = JSON.parse(decoded) as CodeRef;
    assertIsResolvedCodeRef(parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

function parseJson(
  raw: string | undefined,
): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    let decoded = decodeURIComponent(raw);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function getQueryParam(
  queryParams: Record<string, unknown>,
  key: string,
): string | undefined {
  let value = queryParams[key];
  return typeof value === 'string' ? value : undefined;
}
