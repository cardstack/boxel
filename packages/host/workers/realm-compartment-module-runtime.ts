import 'ses';

import * as decoratorRuntime from 'decorator-transforms/runtime-esm';

import RealmCompartmentModuleRuntime, {
  type SandboxTemplateBundle,
} from '../app/lib/realm-compartment-module-runtime';
import type {
  WorkerModuleFetchResponse,
  WorkerRuntimeInbound,
  WorkerRuntimeOperation,
  WorkerRuntimeOutbound,
} from '../app/lib/realm-worker-compartment-protocol';

interface WorkerScope {
  postMessage(message: WorkerRuntimeOutbound): void;
  onmessage: ((event: MessageEvent<WorkerRuntimeInbound>) => void) | null;
}

let scope = globalThis as unknown as WorkerScope;
let runtime: RealmCompartmentModuleRuntime | undefined;
let fetchSequence = 0;
let pendingFetches = new Map<
  string,
  {
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }
>();

function resolveWorkerImport(moduleIdentifier: string): string {
  // Loader resolves relative dependencies against the module that declared
  // them after this hook runs. Preserve those specifiers verbatim here. The
  // main-thread runtime gets this behavior from VirtualNetwork.resolveImport;
  // without it, sibling card modules and generated glimmer-scoped-css imports
  // are mistaken for bare package specifiers and routed to boxel.invalid.
  if (
    moduleIdentifier.startsWith('./') ||
    moduleIdentifier.startsWith('../') ||
    moduleIdentifier.startsWith('/')
  ) {
    return moduleIdentifier;
  }
  try {
    return new URL(moduleIdentifier).href;
  } catch {
    // Trusted bare specifiers are installed as inert facades by the runtime.
    // Giving them a stable URL lets Loader key those shims without granting
    // the worker any host package resolver authority.
    return `https://boxel.invalid/module/${encodeURIComponent(moduleIdentifier)}`;
  }
}

function fetchModule(input: RequestInfo | URL, init?: RequestInit) {
  let request = input instanceof Request ? input : new Request(input, init);
  let requestId = `module-fetch-${++fetchSequence}`;
  let result = new Promise<Response>((resolve, reject) => {
    pendingFetches.set(requestId, { resolve, reject });
  });
  scope.postMessage({
    type: 'module-fetch-request',
    requestId,
    url: request.url,
    init: {
      method: request.method,
      headers: [...request.headers.entries()],
    },
  });
  return result;
}

function receiveFetchResponse(message: WorkerModuleFetchResponse) {
  let pending = pendingFetches.get(message.requestId);
  if (!pending) {
    return;
  }
  pendingFetches.delete(message.requestId);
  if (message.error || !message.response) {
    pending.reject(new Error(message.error ?? 'Host returned no response'));
    return;
  }
  let response = new Response(message.response.body, {
    headers: message.response.headers,
    status: message.response.status,
    statusText: message.response.statusText,
  });
  try {
    Object.defineProperty(response, 'url', { value: message.response.url });
  } catch {
    // Response.url is diagnostic only. Loader can operate with the requested
    // module URL when a browser does not allow this property to be shadowed.
  }
  pending.resolve(response);
}

function materializeGetters(
  bundle: SandboxTemplateBundle,
  args: Record<string, unknown>,
): SandboxTemplateBundle {
  if (!runtime) {
    throw new Error('Worker runtime has not initialized');
  }
  for (let descriptor of Object.values(bundle.templates)) {
    for (let property of descriptor.instance.getters) {
      descriptor.instance.state[property] = runtime.readComponentProperty(
        descriptor.instance.handle,
        property,
        args,
      );
    }
    descriptor.instance.getters = [];
  }
  return bundle;
}

async function perform(operation: WorkerRuntimeOperation) {
  if (!runtime) {
    throw new Error('Worker runtime has not initialized');
  }
  switch (operation.name) {
    case 'evaluate-template':
      return materializeGetters(
        await runtime.evaluateTemplate(
          operation.moduleIdentifier,
          operation.exportName,
          operation.format,
        ),
        operation.args,
      );
    case 'evaluate-card-type-metadata':
      return await runtime.evaluateCardTypeMetadata(
        operation.moduleIdentifier,
        operation.exportName,
      );
    case 'ambient-report':
      return runtime.ambientReport;
    case 'stats':
      return runtime.stats;
  }
}

scope.onmessage = async (event) => {
  let message = event.data;
  if (message.type === 'module-fetch-response') {
    receiveFetchResponse(message);
    return;
  }
  if (message.type === 'init') {
    try {
      runtime = new RealmCompartmentModuleRuntime(message.principal, {
        fetch: fetchModule,
        resolveImport: resolveWorkerImport,
        decoratorRuntime,
        isTrustedImport: (moduleIdentifier) =>
          message.trustedImports.exact.includes(moduleIdentifier) ||
          message.trustedImports.prefixes.some((prefix) =>
            moduleIdentifier.startsWith(prefix),
          ),
      });
      scope.postMessage({ type: 'ready' });
    } catch (error) {
      scope.postMessage({
        type: 'worker-error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  try {
    scope.postMessage({
      type: 'runtime-result',
      callId: message.callId,
      value: await perform(message.operation),
    });
  } catch (error) {
    scope.postMessage({
      type: 'runtime-result',
      callId: message.callId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
