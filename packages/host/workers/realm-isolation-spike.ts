import 'ses';

import { createRealmSandboxCompartment } from './realm-isolation-module-evaluator';

lockdown();

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

interface CapabilityReply {
  type: 'capability-reply';
  requestId: string;
  value?: unknown;
  error?: string;
}

interface InitMessage {
  type: 'init';
  realmURL: string;
  programSource: string;
  grants: { aiProxy: boolean };
}

interface InvokeMessage {
  type: 'invoke';
  invocationId: string;
  action: string;
  args: unknown[];
}

type InboundMessage = CapabilityReply | InitMessage | InvokeMessage;

type Program = Record<string, (...args: unknown[]) => unknown>;

let scope = globalThis as unknown as WorkerScope;
let program: Program | undefined;
let requestSequence = 0;
let pendingCapabilities = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function capabilityCall(operation: string, args: unknown[]) {
  let requestId = `capability-${++requestSequence}`;
  let promise = new Promise<unknown>((resolve, reject) => {
    pendingCapabilities.set(requestId, { resolve, reject });
  });
  scope.postMessage({
    type: 'capability-request',
    requestId,
    operation,
    args,
  });
  return promise;
}

scope.onmessage = async (event: MessageEvent<InboundMessage>) => {
  let message = event.data;

  if (message.type === 'capability-reply') {
    let pending = pendingCapabilities.get(message.requestId);
    if (!pending) {
      return;
    }
    pendingCapabilities.delete(message.requestId);
    if (message.error) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(harden(message.value));
    }
    return;
  }

  if (message.type === 'init') {
    try {
      let capabilities = harden({
        readOwnCard: () => capabilityCall('read-own-card', []),
        writeOwnCard: (patch: unknown) =>
          capabilityCall('write-own-card', [patch]),
        readCard: (targetCardURL: string) =>
          capabilityCall('read-card', [targetCardURL]),
        readRecipe: () => capabilityCall('read-recipe', []),
        queryOwnCards: () => capabilityCall('query-own', []),
        runOwnCommand: (commandName: string) =>
          capabilityCall('run-own-command', [commandName]),
        runRecipeCommand: (commandName: string, input: unknown) =>
          capabilityCall('run-recipe-command', [commandName, input]),
      });
      let proxyFetch = harden(async (targetURL: string, init: unknown = {}) => {
        let reply = (await capabilityCall('proxy-fetch', [
          targetURL,
          init,
        ])) as {
          ok: boolean;
          status: number;
          statusText: string;
          body: string;
        };
        return harden({
          ok: reply.ok,
          status: reply.status,
          statusText: reply.statusText,
          text: async () => reply.body,
          json: async () => JSON.parse(reply.body),
        });
      });
      let globals = {
        capabilities,
        ...(message.grants.aiProxy ? { fetch: proxyFetch } : {}),
      };
      let { moduleEvaluator } = createRealmSandboxCompartment(
        `Boxel realm ${message.realmURL}`,
        globals,
      );
      let moduleIdentifier = `${message.realmURL}__realm_program__.js`;
      let registration = moduleEvaluator(
        `define(${JSON.stringify(moduleIdentifier)}, ['exports'], function(exports) {
          exports.default = ${message.programSource};
        });`,
        moduleIdentifier,
      );
      let moduleExports: { default?: Program } = Object.create(null);
      registration.implementation(moduleExports);
      if (!moduleExports.default) {
        throw new Error('Realm program module has no default export');
      }
      program = moduleExports.default;
      scope.postMessage({ type: 'ready' });
    } catch (error) {
      scope.postMessage({
        type: 'worker-error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (message.type === 'invoke') {
    try {
      if (!program) {
        throw new Error('Realm program has not initialized');
      }
      let action = program[message.action];
      if (typeof action !== 'function') {
        throw new Error(
          `Unknown realm action: ${message.action}. Available actions: ${Object.keys(program).join(', ') || '(none)'}`,
        );
      }
      let value = await action(...message.args);
      scope.postMessage({
        type: 'invocation-result',
        invocationId: message.invocationId,
        value,
      });
    } catch (error) {
      scope.postMessage({
        type: 'invocation-result',
        invocationId: message.invocationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
