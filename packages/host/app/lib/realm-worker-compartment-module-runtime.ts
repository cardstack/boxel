import type {
  CompartmentAmbientReport,
  SandboxCardTypeMetadata,
  SandboxTemplateBundle,
} from '@cardstack/host/lib/realm-compartment-module-runtime';
import type {
  WorkerModuleFetchRequest,
  WorkerRuntimeOperation,
  WorkerRuntimeOutbound,
  WorkerRuntimeResult,
} from '@cardstack/host/lib/realm-worker-compartment-protocol';

import RealmCompartmentWorkerURL from '../../workers/realm-compartment-module-runtime.ts?worker&url';

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export default class RealmWorkerCompartmentModuleRuntime {
  readonly executionLocation = 'worker';

  private worker: Worker;
  private callSequence = 0;
  private pendingCalls = new Map<string, PendingCall>();
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(
    readonly principal: string,
    private fetchModule: typeof fetch,
    trustedImports: { exact: string[]; prefixes: string[] },
  ) {
    this.worker = new Worker(RealmCompartmentWorkerURL, { type: 'module' });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.addEventListener('message', this.onMessage);
    this.worker.addEventListener('error', this.onWorkerError);
    this.worker.postMessage({ type: 'init', principal, trustedImports });
  }

  async evaluateTemplate(
    moduleIdentifier: string,
    exportName: string,
    format: string,
    args: Record<string, unknown>,
  ): Promise<SandboxTemplateBundle> {
    return (await this.call({
      name: 'evaluate-template',
      moduleIdentifier,
      exportName,
      format,
      args,
    })) as SandboxTemplateBundle;
  }

  async evaluateCardTypeMetadata(
    moduleIdentifier: string,
    exportName: string,
  ): Promise<SandboxCardTypeMetadata> {
    return (await this.call({
      name: 'evaluate-card-type-metadata',
      moduleIdentifier,
      exportName,
    })) as SandboxCardTypeMetadata;
  }

  async ambientReport(): Promise<CompartmentAmbientReport> {
    return (await this.call({
      name: 'ambient-report',
    })) as CompartmentAmbientReport;
  }

  async stats(): Promise<{
    moduleEvaluations: number;
    moduleCacheHits: number;
  }> {
    return (await this.call({ name: 'stats' })) as {
      moduleEvaluations: number;
      moduleCacheHits: number;
    };
  }

  destroy() {
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onWorkerError);
    this.worker.terminate();
    let error = new Error('Realm worker runtime was destroyed');
    this.rejectReady(error);
    for (let pending of this.pendingCalls.values()) {
      pending.reject(error);
    }
    this.pendingCalls.clear();
  }

  private async call(operation: WorkerRuntimeOperation): Promise<unknown> {
    await this.readyPromise;
    let callId = `runtime-call-${++this.callSequence}`;
    let result = new Promise<unknown>((resolve, reject) => {
      this.pendingCalls.set(callId, { resolve, reject });
    });
    this.worker.postMessage({ type: 'runtime-call', callId, operation });
    return await result;
  }

  private onWorkerError = (event: ErrorEvent) => {
    let error = new Error(event.message || 'Realm worker failed');
    this.rejectReady(error);
    for (let pending of this.pendingCalls.values()) {
      pending.reject(error);
    }
    this.pendingCalls.clear();
  };

  private onMessage = async (event: MessageEvent<WorkerRuntimeOutbound>) => {
    let message = event.data;
    if (message.type === 'ready') {
      this.resolveReady();
      return;
    }
    if (message.type === 'worker-error') {
      this.rejectReady(new Error(message.error));
      return;
    }
    if (message.type === 'module-fetch-request') {
      await this.handleModuleFetch(message);
      return;
    }
    this.resolveCall(message);
  };

  private async handleModuleFetch(message: WorkerModuleFetchRequest) {
    try {
      let response = await this.fetchModule(message.url, {
        method: message.init?.method,
        headers: message.init?.headers,
      });
      this.worker.postMessage({
        type: 'module-fetch-response',
        requestId: message.requestId,
        response: {
          body: [204, 205, 304].includes(response.status)
            ? null
            : await response.text(),
          headers: [...response.headers.entries()],
          status: response.status,
          statusText: response.statusText,
          url: response.url || message.url,
        },
      });
    } catch (error) {
      this.worker.postMessage({
        type: 'module-fetch-response',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private resolveCall(message: WorkerRuntimeResult) {
    let pending = this.pendingCalls.get(message.callId);
    if (!pending) {
      return;
    }
    this.pendingCalls.delete(message.callId);
    if (message.error) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(message.value);
    }
  }
}
