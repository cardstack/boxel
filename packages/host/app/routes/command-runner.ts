import { registerDestructor } from '@ember/destroyable';
import { getOwner, setOwner } from '@ember/owner';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import type {
  Command,
  ToolContext,
  CommandInvocation,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  ToolContextStamp,
  getClass,
  isCardInstance,
  parseBoxelHostCommandSpecifier,
  rri,
} from '@cardstack/runtime-common';

import { registerBoxelTransitionTo } from '../utils/register-boxel-transition';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';
import type { CardDef, CardDefConstructor } from '@cardstack/base/card-api';

const commandRequestStorageKeyPrefix = 'boxel-command-request:';
const commandRequestTtlMs = 5 * 60 * 1000;

interface StoredCommandRequest {
  command: string;
  input?: unknown;
  nonce?: string;
  createdAt?: number;
}

type GenericCommand = Command<
  CardDefConstructor | undefined,
  CardDefConstructor
>;
type GenericCommandConstructor = {
  new (context: ToolContext): GenericCommand;
};

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
  @service declare store: StoreService;

  async beforeModel() {
    registerBoxelTransitionTo(this.router, this);
    (globalThis as any).__boxelRenderContext = true;
    registerDestructor(this, () => {
      if (isTesting()) {
        (globalThis as any).__boxelRenderContext = undefined;
      }
    });
    this.realm.restoreSessionsFromStorage();
  }

  deactivate() {
    if (isTesting()) {
      (globalThis as any).__boxelRenderContext = undefined;
    }
  }

  model(params: { request_id: string; nonce: string }): CommandRunnerModel {
    let model = new CommandRunState(params.nonce);
    let request = this.#consumeStoredCommandRequest(
      params.request_id,
      params.nonce,
    );
    let command = parseCommandParam(request?.command);
    let toolInput = parseCommandInputValue(request?.input);

    if (!command) {
      model.status = 'error';
      model.error = new Error('Missing, expired, or invalid command request');
      return model;
    }

    void this.#runCommand(model, command, toolInput);
    return model;
  }

  get toolContext(): ToolContext {
    let result = {
      [ToolContextStamp]: true,
    } as ToolContext;
    setOwner(result, getOwner(this)!);
    return result;
  }

  async #runCommand(
    model: CommandRunState,
    command: ResolvedCodeRef,
    toolInput: Record<string, unknown> | undefined,
  ) {
    try {
      let ToolConstructor = (await getClass(
        command,
        this.loaderService.loader,
      )) as GenericCommandConstructor | undefined;
      if (!ToolConstructor) {
        throw new Error('Command not found for provided CodeRef');
      }

      let toolInstance = new ToolConstructor(this.toolContext);
      let resultCard: CardDef | undefined;
      if (toolInput) {
        let InputType = await toolInstance.getInputType();
        let resolvedInput = InputType
          ? await this.#resolveLinkedInputs(InputType, toolInput)
          : toolInput;
        resultCard = await toolInstance.execute(resolvedInput);
      } else {
        resultCard = await toolInstance.execute();
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

  // The stored input arrives as raw JSON (e.g. from `run-command --input`), so
  // a `linksTo`/`linksToMany` field is expressed as a card ID string (or array
  // of them) rather than a card instance. `Tool.execute` assigns each value
  // straight onto its field via `new InputType(...)`, which can't turn an ID
  // into a card — so we resolve those IDs to instances here first, matching how
  // `LinksTo.deserialize` resolves a relationship through the store.
  async #resolveLinkedInputs(
    InputType: CardDefConstructor,
    toolInput: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let cardApi = await this.cardService.getAPI();
    let fields = cardApi.getFields(InputType, {
      usedLinksToFieldsOnly: false,
      includeComputeds: false,
    });
    let resolved: Record<string, unknown> = { ...toolInput };
    for (let [fieldName, value] of Object.entries(toolInput)) {
      let field = fields[fieldName];
      if (!field) {
        continue;
      }
      if (field.fieldType === 'linksTo' && typeof value === 'string') {
        resolved[fieldName] = await this.#resolveCardId(value, fieldName);
      } else if (
        field.fieldType === 'linksToMany' &&
        Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string')
      ) {
        resolved[fieldName] = await Promise.all(
          (value as string[]).map((id) => this.#resolveCardId(id, fieldName)),
        );
      }
    }
    return resolved;
  }

  async #resolveCardId(id: string, fieldName: string): Promise<CardDef> {
    let instance = await this.store.get(id);
    if (!instance || !isCardInstance<CardDef>(instance)) {
      let detail = instance ? ` (${instance.status}: ${instance.message})` : '';
      throw new Error(
        `Could not resolve card "${id}" for input field "${fieldName}"${detail}`,
      );
    }
    return instance;
  }

  #consumeStoredCommandRequest(
    requestId: string | undefined,
    expectedNonce: string,
  ): StoredCommandRequest | undefined {
    if (typeof window === 'undefined' || !window.localStorage) {
      return undefined;
    }
    if (!requestId || typeof requestId !== 'string') {
      return undefined;
    }
    let key = `${commandRequestStorageKeyPrefix}${requestId}`;
    let raw = window.localStorage.getItem(key);
    if (!raw) {
      return undefined;
    }
    window.localStorage.removeItem(key);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    let request = parsed as StoredCommandRequest;
    if (
      typeof request.nonce === 'string' &&
      request.nonce.trim() !== expectedNonce
    ) {
      return undefined;
    }
    if (typeof request.createdAt === 'number') {
      let ageMs = Date.now() - request.createdAt;
      if (ageMs > commandRequestTtlMs) {
        return undefined;
      }
    }
    return request;
  }
}

function parseCommandParam(
  raw: string | undefined | unknown,
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
      module: rri(`${url.origin}${pathname.slice(0, index)}`),
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
    module: rri(value.slice(0, index)),
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

function parseCommandInputValue(
  parsed: unknown,
): Record<string, unknown> | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}
