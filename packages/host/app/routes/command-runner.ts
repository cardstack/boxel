import { getOwner, setOwner } from '@ember/owner';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import type {
  Command,
  CommandContext,
  CommandInvocation,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  CommandContextStamp,
  getClass,
  parseBoxelHostCommandSpecifier,
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

  model(params: {
    command: string;
    input: string;
    nonce: string;
  }): CommandRunnerModel {
    let model = new CommandRunState(params.nonce);
    let command = parseCommandParam(params.command);
    let commandInput = parseCommandInput(params.input);

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
    command: ResolvedCodeRef,
    commandInput: Record<string, unknown> | undefined,
  ) {
    try {
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

function parseJSONish(raw: string | undefined): unknown {
  if (!raw || raw === 'null' || raw === 'undefined') {
    return undefined;
  }

  // Support both raw JSON path segments and URI-encoded JSON segments.
  try {
    return JSON.parse(raw);
  } catch {
    // noop
  }

  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return undefined;
  }
}

function parseCommandParam(
  raw: string | undefined,
): ResolvedCodeRef | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  let value = safeDecodeURIComponent(raw).trim();
  if (!value) {
    return undefined;
  }

  let specifier = parseBoxelHostCommandSpecifier(value);
  if (specifier) {
    return specifier;
  }
  if (isBoxelHostCommandSpecifierWithoutExport(value)) {
    return undefined;
  }

  try {
    let url = new URL(value);
    let pathname = url.pathname.replace(/\/+$/, '');
    let index = pathname.lastIndexOf('/');
    if (index <= 0 || index >= pathname.length - 1) {
      return undefined;
    }
    return {
      module: `${url.origin}${pathname.slice(0, index)}`,
      name: pathname.slice(index + 1),
    };
  } catch {
    // Accept module specifier forms like "<module>/<exportName>".
  }

  let index = value.lastIndexOf('/');
  if (index <= 0 || index >= value.length - 1) {
    return undefined;
  }
  return {
    module: value.slice(0, index),
    name: value.slice(index + 1),
  };
}

function isBoxelHostCommandSpecifierWithoutExport(value: string): boolean {
  return /^@?cardstack\/boxel-host\/commands\/[^/?#\s]+$/.test(value);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCommandInput(
  raw: string | undefined,
): Record<string, unknown> | undefined {
  let parsed = parseJSONish(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}
