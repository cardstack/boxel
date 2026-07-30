import type {
  SpikeProgramView,
  SpikeRealmConfig,
  WorkerCapabilityRequest,
  WorkerInvocationResult,
} from '@cardstack/host/lib/realm-isolation-spike';

import RealmIsolationWorkerURL from '../../workers/realm-isolation-spike.ts?worker&url';

export type RealmIsolationCapabilityHandler = (
  request: WorkerCapabilityRequest,
) => Promise<unknown>;

export default class RealmIsolationWorkerRuntime {
  private worker: Worker;
  private invocationSequence = 0;
  private pendingInvocations = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(
    realmConfig: SpikeRealmConfig,
    programSource: string,
    private handleCapability: RealmIsolationCapabilityHandler,
  ) {
    this.worker = new Worker(RealmIsolationWorkerURL, { type: 'module' });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.addEventListener('message', this.onMessage);
    this.worker.addEventListener('error', this.onWorkerError);
    this.worker.postMessage({
      type: 'init',
      realmURL: realmConfig.realmURL,
      programSource,
      grants: { aiProxy: realmConfig.canUseAIProxy },
    });
  }

  private onWorkerError = (event: ErrorEvent) => {
    this.rejectReady(new Error(event.message));
  };

  private onMessage = async (event: MessageEvent) => {
    let message = event.data as
      | WorkerCapabilityRequest
      | WorkerInvocationResult
      | { type: 'ready' }
      | { type: 'worker-error'; error: string };

    if (message.type === 'ready') {
      this.resolveReady();
      return;
    }
    if (message.type === 'worker-error') {
      this.rejectReady(new Error(message.error));
      return;
    }
    if (message.type === 'capability-request') {
      try {
        let value = await this.handleCapability(message);
        this.worker.postMessage({
          type: 'capability-reply',
          requestId: message.requestId,
          value,
        });
      } catch (error) {
        this.worker.postMessage({
          type: 'capability-reply',
          requestId: message.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    let pending = this.pendingInvocations.get(message.invocationId);
    if (!pending) {
      return;
    }
    this.pendingInvocations.delete(message.invocationId);
    if (message.error) {
      pending.reject(new Error(message.error));
    } else if ('value' in message) {
      pending.resolve(message.value);
    } else {
      pending.reject(new Error('Realm program returned no view'));
    }
  };

  async invoke<T = SpikeProgramView>(action: string, ...args: unknown[]) {
    await this.readyPromise;
    let invocationId = `invocation-${++this.invocationSequence}`;
    let result = new Promise<unknown>((resolve, reject) => {
      this.pendingInvocations.set(invocationId, { resolve, reject });
    });
    this.worker.postMessage({
      type: 'invoke',
      invocationId,
      action,
      args,
    });
    return (await result) as T;
  }

  destroy() {
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onWorkerError);
    this.worker.terminate();
    for (let pending of this.pendingInvocations.values()) {
      pending.reject(new Error('Realm runtime was destroyed'));
    }
    this.pendingInvocations.clear();
  }
}
