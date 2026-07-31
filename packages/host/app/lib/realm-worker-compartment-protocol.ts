import type {
  CompartmentAmbientReport,
  SandboxCardTypeMetadata,
  SandboxTemplateBundle,
} from '@cardstack/host/lib/realm-compartment-module-runtime';

export interface WorkerModuleFetchRequest {
  type: 'module-fetch-request';
  requestId: string;
  url: string;
  init?: {
    method?: string;
    headers?: [string, string][];
  };
}

export interface WorkerModuleFetchResponse {
  type: 'module-fetch-response';
  requestId: string;
  response?: {
    body: string | null;
    headers: [string, string][];
    status: number;
    statusText: string;
    url: string;
  };
  error?: string;
}

export interface WorkerRuntimeInit {
  type: 'init';
  principal: string;
  trustedImports: {
    exact: string[];
    prefixes: string[];
  };
}

export type WorkerRuntimeOperation =
  | {
      name: 'evaluate-template';
      moduleIdentifier: string;
      exportName: string;
      format: string;
      args: Record<string, unknown>;
    }
  | {
      name: 'evaluate-card-type-metadata';
      moduleIdentifier: string;
      exportName: string;
    }
  | { name: 'ambient-report' }
  | { name: 'stats' };

export interface WorkerRuntimeCall {
  type: 'runtime-call';
  callId: string;
  operation: WorkerRuntimeOperation;
}

export interface WorkerRuntimeResult {
  type: 'runtime-result';
  callId: string;
  value?:
    | SandboxTemplateBundle
    | SandboxCardTypeMetadata
    | CompartmentAmbientReport
    | { moduleEvaluations: number; moduleCacheHits: number };
  error?: string;
}

export type WorkerRuntimeInbound =
  | WorkerRuntimeInit
  | WorkerRuntimeCall
  | WorkerModuleFetchResponse;

export type WorkerRuntimeOutbound =
  | { type: 'ready' }
  | { type: 'worker-error'; error: string }
  | WorkerModuleFetchRequest
  | WorkerRuntimeResult;
